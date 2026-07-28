import { SCHEMA_VERSION } from "@shelve/shared";
import { env, SELF, fetchMock } from "cloudflare:test";
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { WORKER_VERSION } from "./version";
import worker, { type Env } from "./index";
// @ts-expect-error -- raw text import, handled by the vite/esbuild layer
import initSql from "../migrations/0001_init.sql?raw";
// @ts-expect-error -- raw text import, handled by the vite/esbuild layer
import addDeletedAtSql from "../migrations/0002_add_deleted_at.sql?raw";
// @ts-expect-error -- raw text import, handled by the vite/esbuild layer
import cascadeDeleteSql from "../migrations/0003_cascade_delete.sql?raw";

const TOKEN = "test-token";

beforeAll(async () => {
  // Applies the full migration sequence in order, same as
  // `wrangler d1 migrations apply` would against a real deployment — so
  // these tests exercise the same schema a fresh production DB ends up
  // with, rather than a hand-maintained duplicate of it. D1's exec()
  // splits on newlines, not semicolons, so it chokes on our
  // multi-line-formatted CREATE TABLE statements; split into individual
  // statements and run them as a batch instead.
  const statements = [initSql as string, addDeletedAtSql as string, cascadeDeleteSql as string]
    .flatMap((sql) => sql.split(";"))
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));

  // Only /link-metadata makes an outbound fetch() — mocked here (rather than
  // left to hit the real network) so those tests are hermetic and fast.
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

function authedHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function put(path: string, body: Record<string, unknown>, token = TOKEN, method = "POST") {
  return SELF.fetch(`https://worker.test${path}`, {
    method,
    headers: { ...authedHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createWorkspace(id: string) {
  return put(`/workspaces/${id}`, { name: id, position: 0, created_at: 1, updated_at: 1 });
}

async function createFolder(id: string, workspaceId: string) {
  return put(`/folders/${id}`, {
    workspace_id: workspaceId,
    name: id,
    position: 0,
    created_at: 1,
    updated_at: 1,
  });
}

describe("CORS", () => {
  it("responds to a preflight OPTIONS request without requiring auth", async () => {
    const res = await SELF.fetch("https://worker.test/state", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("includes CORS headers on a successful authenticated response", async () => {
    const res = await SELF.fetch("https://worker.test/health", { headers: authedHeaders(TOKEN) });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes CORS headers on a 401, so a browser can expose the error instead of blocking it", async () => {
    const res = await SELF.fetch("https://worker.test/health");
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes CORS headers on a 404", async () => {
    const res = await SELF.fetch("https://worker.test/nope", { headers: authedHeaders(TOKEN) });
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes CORS headers even when route() throws — a genuine server error shouldn't bypass withCors", async () => {
    // A direct unit-level call (not through SELF/Miniflare's real D1) so a
    // thrown DB error is cheap to force, exercising fetch()'s try/catch
    // around route() without needing a real D1 failure scenario.
    const throwingEnv: Env = {
      DB: {
        prepare: () => {
          throw new Error("simulated D1 failure");
        },
      } as unknown as Env["DB"],
      API_TOKEN: TOKEN,
    };
    const request = new Request("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const res = await worker.fetch(request, throwingEnv);
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("auth", () => {
  it("rejects requests with no token", async () => {
    const res = await SELF.fetch("https://worker.test/health");
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong token", async () => {
    const res = await SELF.fetch("https://worker.test/health", {
      headers: authedHeaders("wrong-token"),
    });
    expect(res.status).toBe(401);
  });

  it("accepts requests with the right token", async () => {
    const res = await SELF.fetch("https://worker.test/health", { headers: authedHeaders(TOKEN) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: WORKER_VERSION, schemaVersion: SCHEMA_VERSION });
  });

  it("404s unknown routes", async () => {
    const res = await SELF.fetch("https://worker.test/nope", { headers: authedHeaders(TOKEN) });
    expect(res.status).toBe(404);
  });
});

describe("GET /state", () => {
  it("returns empty arrays when nothing has been synced", async () => {
    const res = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaces: [], folders: [], entries: [] });
  });

  it("reflects created resources", async () => {
    await createWorkspace("ws-1");

    const res = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await res.json()) as { workspaces: Array<{ id: string; name: string }> };
    expect(state.workspaces).toEqual([expect.objectContaining({ id: "ws-1", name: "ws-1" })]);
  });
});

describe("upsert-by-recency", () => {
  it("creates a new resource via POST", async () => {
    await createWorkspace("ws-x");
    const res = await createFolder("f-1", "ws-x");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true });
  });

  it("applies an update with a newer updated_at", async () => {
    await createWorkspace("ws-x");
    await put("/folders/f-2", {
      workspace_id: "ws-x",
      name: "Old Name",
      position: 0,
      created_at: 10,
      updated_at: 10,
    });

    const res = await put(
      "/folders/f-2",
      { workspace_id: "ws-x", name: "New Name", position: 0, created_at: 10, updated_at: 20 },
      TOKEN,
      "PATCH",
    );
    expect(await res.json()).toEqual({ ok: true, applied: true });

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { folders: Array<{ id: string; name: string }> };
    expect(state.folders.find((f) => f.id === "f-2")?.name).toBe("New Name");
  });

  it("rejects a stale write with an older updated_at, keeping the newer data", async () => {
    await createWorkspace("ws-x");
    await put("/folders/f-3", {
      workspace_id: "ws-x",
      name: "Current",
      position: 0,
      created_at: 10,
      updated_at: 100,
    });

    const staleRes = await put(
      "/folders/f-3",
      { workspace_id: "ws-x", name: "Stale", position: 0, created_at: 10, updated_at: 50 },
      TOKEN,
      "PATCH",
    );
    expect(await staleRes.json()).toEqual({ ok: true, applied: false });

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { folders: Array<{ id: string; name: string }> };
    expect(state.folders.find((f) => f.id === "f-3")?.name).toBe("Current");
  });

  it("rejects a body whose id disagrees with the URL id", async () => {
    const res = await put("/folders/f-4", { id: "different-id", workspace_id: "ws-x", updated_at: 1 });
    expect(res.status).toBe(400);
  });
});

describe("DELETE", () => {
  it("soft-deletes exactly the targeted resource, leaving its content intact", async () => {
    await createWorkspace("ws-x");
    await createFolder("f-x", "ws-x");
    await put("/entries/e-1", {
      folder_id: "f-x",
      url: "https://example.com",
      title: "Example",
      position: 0,
      created_at: 1,
      updated_at: 1,
    });
    await put("/entries/e-2", {
      folder_id: "f-x",
      url: "https://example.org",
      title: "Other",
      position: 1,
      created_at: 1,
      updated_at: 1,
    });

    const delRes = await SELF.fetch("https://worker.test/entries/e-1", {
      method: "DELETE",
      headers: authedHeaders(TOKEN),
    });
    expect(delRes.status).toBe(200);

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as {
      entries: Array<{ id: string; title: string | null; deleted_at: number | null }>;
    };
    // Still present (content retained — e.g. for a future trash view), but
    // tombstoned via deleted_at. The untouched sibling has deleted_at null.
    const deleted = state.entries.find((e) => e.id === "e-1");
    const kept = state.entries.find((e) => e.id === "e-2");
    expect(deleted?.deleted_at).not.toBeNull();
    expect(deleted?.title).toBe("Example");
    expect(kept?.deleted_at).toBeNull();
  });

  it("bumps updated_at on delete, so the deletion wins a recency merge", async () => {
    await createWorkspace("ws-x");
    await createFolder("f-old", "ws-x");

    const delRes = await SELF.fetch("https://worker.test/folders/f-old", {
      method: "DELETE",
      headers: authedHeaders(TOKEN),
    });
    expect(delRes.status).toBe(200);

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as {
      folders: Array<{ id: string; updated_at: number; deleted_at: number | null }>;
    };
    const folder = state.folders.find((f) => f.id === "f-old")!;
    expect(folder.deleted_at).not.toBeNull();
    expect(folder.updated_at).toBe(folder.deleted_at);
    expect(folder.updated_at).toBeGreaterThan(1); // created with updated_at: 1
  });

  it("does not touch unrelated data — deleting one id never affects others", async () => {
    await createWorkspace("ws-keep");

    await SELF.fetch("https://worker.test/workspaces/does-not-exist", {
      method: "DELETE",
      headers: authedHeaders(TOKEN),
    });

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { workspaces: Array<{ id: string; deleted_at: number | null }> };
    const keep = state.workspaces.find((w) => w.id === "ws-keep");
    expect(keep?.deleted_at).toBeNull();
  });
});

describe("DELETE ?permanent=true", () => {
  async function permanentDelete(path: string) {
    return SELF.fetch(`https://worker.test${path}?permanent=true`, {
      method: "DELETE",
      headers: authedHeaders(TOKEN),
    });
  }

  it("404s a nonexistent id", async () => {
    const res = await permanentDelete("/entries/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("rejects (400) a record that isn't soft-deleted yet", async () => {
    await createWorkspace("ws-perm-1");
    const res = await permanentDelete("/workspaces/ws-perm-1");
    expect(res.status).toBe(400);

    // Untouched — still there, still not deleted.
    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { workspaces: Array<{ id: string; deleted_at: number | null }> };
    expect(state.workspaces.find((w) => w.id === "ws-perm-1")?.deleted_at).toBeNull();
  });

  it("actually removes the row, not just its deleted_at marker", async () => {
    await createWorkspace("ws-perm-2");
    await SELF.fetch("https://worker.test/workspaces/ws-perm-2", { method: "DELETE", headers: authedHeaders(TOKEN) });

    const res = await permanentDelete("/workspaces/ws-perm-2");
    expect(res.status).toBe(200);

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { workspaces: Array<{ id: string }> };
    expect(state.workspaces.find((w) => w.id === "ws-perm-2")).toBeUndefined();
  });

  it("cascades: permanently deleting a workspace removes its folders and entries too, with no FK error", async () => {
    await createWorkspace("ws-perm-3");
    await createFolder("f-perm-3", "ws-perm-3");
    await put("/entries/e-perm-3", {
      folder_id: "f-perm-3",
      url: "https://example.com",
      position: 0,
      created_at: 1,
      updated_at: 1,
    });
    await SELF.fetch("https://worker.test/workspaces/ws-perm-3", { method: "DELETE", headers: authedHeaders(TOKEN) });

    const res = await permanentDelete("/workspaces/ws-perm-3");
    expect(res.status).toBe(200);

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as {
      workspaces: Array<{ id: string }>;
      folders: Array<{ id: string }>;
      entries: Array<{ id: string }>;
    };
    expect(state.workspaces.find((w) => w.id === "ws-perm-3")).toBeUndefined();
    expect(state.folders.find((f) => f.id === "f-perm-3")).toBeUndefined();
    expect(state.entries.find((e) => e.id === "e-perm-3")).toBeUndefined();
  });

  it("cascades even to a descendant that was never itself soft-deleted (a real race: another device creates an entry in a folder after it's been deleted elsewhere, before syncing)", async () => {
    await createWorkspace("ws-perm-4");
    await createFolder("f-perm-4", "ws-perm-4");
    // Soft-delete the folder first...
    await SELF.fetch("https://worker.test/folders/f-perm-4", { method: "DELETE", headers: authedHeaders(TOKEN) });
    // ...then simulate a late write from a device that hadn't learned about
    // that deletion yet: a brand-new, non-deleted entry landing in it.
    await put("/entries/e-perm-4", {
      folder_id: "f-perm-4",
      url: "https://example.com",
      position: 0,
      created_at: 1,
      updated_at: 1,
    });

    const res = await permanentDelete("/folders/f-perm-4");
    expect(res.status).toBe(200);

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { entries: Array<{ id: string }> };
    expect(state.entries.find((e) => e.id === "e-perm-4")).toBeUndefined();
  });

  it("does not affect unrelated data", async () => {
    await createWorkspace("ws-keep-2");
    await createWorkspace("ws-perm-5");
    await SELF.fetch("https://worker.test/workspaces/ws-perm-5", { method: "DELETE", headers: authedHeaders(TOKEN) });

    await permanentDelete("/workspaces/ws-perm-5");

    const stateRes = await SELF.fetch("https://worker.test/state", { headers: authedHeaders(TOKEN) });
    const state = (await stateRes.json()) as { workspaces: Array<{ id: string; deleted_at: number | null }> };
    expect(state.workspaces.find((w) => w.id === "ws-keep-2")?.deleted_at).toBeNull();
  });
});

describe("/link-metadata", () => {
  // Route-level wiring only (auth, CORS, request/response plumbing) —
  // extraction logic itself is covered in linkMetadata.test.ts.
  function urlFor(target: string): string {
    return `https://worker.test/link-metadata?url=${encodeURIComponent(target)}`;
  }

  it("rejects requests with no token, same as every other route", async () => {
    const res = await SELF.fetch(urlFor("https://example.com/page"));
    expect(res.status).toBe(401);
  });

  it("400s when the url query parameter is missing", async () => {
    const res = await SELF.fetch("https://worker.test/link-metadata", { headers: authedHeaders(TOKEN) });
    expect(res.status).toBe(400);
  });

  it("returns extracted metadata with CORS headers for a valid, authenticated request", async () => {
    fetchMock
      .get("https://example.com")
      .intercept({ path: "/page", method: "GET" })
      .reply(200, `<html><head><title>Example Page</title></head></html>`, {
        headers: { "content-type": "text/html" },
      });

    const res = await SELF.fetch(urlFor("https://example.com/page"), { headers: authedHeaders(TOKEN) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ title: "Example Page", faviconUrl: "https://example.com/favicon.ico" });
  });
});
