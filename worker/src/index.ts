import { SCHEMA_VERSION, type Entry, type Folder, type ResourceKind, type Workspace } from "@shelve/shared";
import { WORKER_VERSION } from "./version";

export interface Env {
  DB: D1Database;
  API_TOKEN: string;
}

function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  return token === env.API_TOKEN;
}

// The extension bypasses CORS entirely via manifest.json's host_permissions,
// but a web client (a different origin than the Worker) is subject to normal
// browser CORS — without these headers, every fetch() from it fails outright.
// `*` rather than a specific allowed origin: isAuthorized() above is already
// a flat bearer-token check with zero origin-awareness, so the token — not
// same-origin policy — is the real security boundary here. Never pair this
// with Access-Control-Allow-Credentials (irrelevant anyway, since auth is a
// manually-attached header, not cookies — and it's spec-incompatible with
// "*" regardless).
const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// Every response — including error paths like the 401 below — needs these
// headers, not just success ones. Without them on a real cross-origin 401,
// the browser blocks it from JS entirely and fetch() surfaces an opaque
// "Failed to fetch" instead of a readable 401, making "bad token" and
// "worker unreachable" indistinguishable to a web client.
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

async function getState(db: D1Database): Promise<{
  workspaces: Workspace[];
  folders: Folder[];
  entries: Entry[];
}> {
  // Includes soft-deleted rows (deleted_at set) — sync needs to see them so
  // a deletion can win a merge on another device via the same "newer
  // updated_at wins" rule as any other field. Callers that render UI filter
  // deleted_at-set records out themselves.
  const [workspaces, folders, entries] = await Promise.all([
    db.prepare("SELECT * FROM workspaces ORDER BY position").all<Workspace>(),
    db.prepare("SELECT * FROM folders ORDER BY position").all<Folder>(),
    db.prepare("SELECT * FROM entries ORDER BY position").all<Entry>(),
  ]);
  return {
    workspaces: workspaces.results,
    folders: folders.results,
    entries: entries.results,
  };
}

const TABLES: Record<ResourceKind, string> = {
  workspaces: "workspaces",
  folders: "folders",
  entries: "entries",
};

const COLUMNS: Record<ResourceKind, string[]> = {
  workspaces: ["id", "name", "position", "created_at", "updated_at", "deleted_at"],
  folders: ["id", "workspace_id", "name", "position", "created_at", "updated_at", "deleted_at"],
  entries: [
    "id",
    "folder_id",
    "url",
    "title",
    "favicon_url",
    "note",
    "position",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
};

async function upsertResource(
  db: D1Database,
  kind: ResourceKind,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const table = TABLES[kind];
  const columns = COLUMNS[kind];

  if (body.id !== undefined && body.id !== id) {
    return new Response("id in body must match id in URL", { status: 400 });
  }
  const updatedAt = body.updated_at;
  if (typeof updatedAt !== "number") {
    return new Response("updated_at is required and must be a number", { status: 400 });
  }

  const existing = await db
    .prepare(`SELECT updated_at FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ updated_at: number }>();

  // Upsert-by-recency: only write if this is a new record, or the incoming
  // version is newer than what's stored. Never destructive — a stale/late
  // write from another device just silently loses the race.
  if (existing && existing.updated_at >= updatedAt) {
    return Response.json({ ok: true, applied: false });
  }

  const values = columns.map((col) => (col === "id" ? id : (body[col] ?? null)));
  const placeholders = columns.map(() => "?").join(", ");
  const updateAssignments = columns
    .filter((c) => c !== "id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  await db
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateAssignments}`,
    )
    .bind(...values)
    .run();

  return Response.json({ ok: true, applied: true });
}

async function deleteResource(db: D1Database, kind: ResourceKind, id: string): Promise<Response> {
  const table = TABLES[kind];
  const now = Date.now();
  // Soft-delete: a single targeted UPDATE by id, same shape as any other
  // write — never a bulk/destructive operation. deleted_at then flows
  // through the exact same "newer updated_at wins" merge as any other
  // field, so the deletion itself propagates on the next sync without any
  // special-cased tombstone bookkeeping. Content is retained, so a future
  // trash view is just "rows where deleted_at IS NOT NULL".
  await db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id).run();
  return Response.json({ ok: true });
}

const RESOURCE_PATTERN = /^\/(workspaces|folders|entries)\/([^/]+)$/;

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (!isAuthorized(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (pathname === "/health") {
    return Response.json({ ok: true, version: WORKER_VERSION, schemaVersion: SCHEMA_VERSION });
  }

  if (pathname === "/state" && request.method === "GET") {
    const state = await getState(env.DB);
    return Response.json(state);
  }

  const match = pathname.match(RESOURCE_PATTERN);
  if (match) {
    const kind = match[1] as ResourceKind;
    const id = match[2];

    if (request.method === "POST" || request.method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      return upsertResource(env.DB, kind, id, body);
    }

    if (request.method === "DELETE") {
      return deleteResource(env.DB, kind, id);
    }
  }

  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Preflight requests never carry Authorization — handling this before
    // route()'s auth check is required, not just an optimization, or every
    // preflight would 401 and no cross-origin request would ever get past it.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    // route() itself isn't wrapped in a try/catch, so an uncaught
    // exception (a D1 failure, any other runtime bug) would otherwise
    // propagate past withCors entirely — the Workers runtime's own
    // generic error response carries no CORS headers, so the browser
    // blocks it from JS and a web client sees an opaque "Failed to
    // fetch" instead of a readable error, exactly the failure mode this
    // CORS work exists to fix, for precisely the case (server errors)
    // where it matters most.
    try {
      return withCors(await route(request, env));
    } catch (e) {
      console.error("shelve worker: unhandled error", e);
      return withCors(new Response("Internal error", { status: 500 }));
    }
  },
} satisfies ExportedHandler<Env>;
