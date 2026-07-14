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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
  },
} satisfies ExportedHandler<Env>;
