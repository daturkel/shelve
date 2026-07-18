import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeArray, mergeState, fetchWorkerHealth, isWorkerSchemaCompatible } from "./sync";
import type { State } from "./storage";
import { SCHEMA_VERSION, type Workspace } from "@shelve/shared";

// Dynamic imports (not static top-of-file ones) so this always targets
// whichever ./store module instance is *currently* registered — the
// "sync's compatibility gate" tests below call vi.resetModules() to get
// a fresh sync.ts (clearing its once-per-module-instance compatibility
// cache), which transitively gives ./store a fresh singleton too. A
// static import's binding wouldn't follow that reset.
async function installConfigMock(config: { workerUrl: string; apiToken: string } | null): Promise<void> {
  const { setStore } = await import("./store");
  const { createMemoryStore } = await import("./testStore");
  const store = createMemoryStore();
  if (config) await store.set("shelve_config", config);
  setStore(store);
}

function ws(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    name: "ws",
    position: 0,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    ...overrides,
  };
}

describe("mergeArray", () => {
  it("keeps local-only records untouched", () => {
    const local = [ws({ id: "a", updated_at: 5 })];
    const merged = mergeArray(local, []);
    expect(merged).toEqual(local);
  });

  it("adds remote-only records (new from another device)", () => {
    const remote = [ws({ id: "b", updated_at: 5 })];
    const merged = mergeArray([], remote);
    expect(merged).toEqual(remote);
  });

  it("keeps the newer of two conflicting versions, by updated_at", () => {
    const local = [ws({ id: "a", name: "old local", updated_at: 10 })];
    const remote = [ws({ id: "a", name: "newer remote", updated_at: 20 })];
    const merged = mergeArray(local, remote);
    expect(merged).toEqual([ws({ id: "a", name: "newer remote", updated_at: 20 })]);
  });

  it("keeps local when local is newer than remote", () => {
    const local = [ws({ id: "a", name: "newer local", updated_at: 20 })];
    const remote = [ws({ id: "a", name: "stale remote", updated_at: 10 })];
    const merged = mergeArray(local, remote);
    expect(merged).toEqual([ws({ id: "a", name: "newer local", updated_at: 20 })]);
  });

  it("propagates a soft-delete: a remote deleted_at wins over a local non-deleted copy when newer", () => {
    // This is the scenario that drove the soft-delete design: device A
    // deletes a workspace, device B pulls and must see it disappear.
    const local = [ws({ id: "a", name: "still here locally", updated_at: 10, deleted_at: null })];
    const remote = [ws({ id: "a", name: "still here locally", updated_at: 20, deleted_at: 20 })];
    const merged = mergeArray(local, remote);
    expect(merged[0].deleted_at).toBe(20);
  });

  it("does NOT resurrect a local soft-delete when remote hasn't caught up yet", () => {
    const local = [ws({ id: "a", updated_at: 20, deleted_at: 20 })];
    const remote = [ws({ id: "a", updated_at: 10, deleted_at: null })];
    const merged = mergeArray(local, remote);
    expect(merged[0].deleted_at).toBe(20);
  });
});

describe("mergeState", () => {
  it("merges each of workspaces/folders/entries independently", () => {
    const local: State = {
      workspaces: [ws({ id: "w1", updated_at: 1 })],
      folders: [],
      entries: [],
    };
    const remote = {
      workspaces: [ws({ id: "w1", updated_at: 1 }), ws({ id: "w2", updated_at: 1 })],
      folders: [],
      entries: [],
    };
    const merged = mergeState(local, remote);
    expect(merged.workspaces.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
  });

  it("a record absent from a GET /state response is left alone, never deleted by omission", () => {
    // Core safety property: pulling never deletes local data just because
    // the remote payload doesn't mention a record (e.g. not pushed yet).
    // Only an explicit deleted_at (set via DELETE) can remove it.
    const local: State = {
      workspaces: [ws({ id: "not-yet-pushed", updated_at: 5 })],
      folders: [],
      entries: [],
    };
    const remote = { workspaces: [], folders: [], entries: [] };
    const merged = mergeState(local, remote);
    expect(merged.workspaces).toHaveLength(1);
    expect(merged.workspaces[0].id).toBe("not-yet-pushed");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWorkerHealth", () => {
  it("returns null when sync isn't configured", async () => {
    await installConfigMock(null);
    expect(await fetchWorkerHealth()).toBeNull();
  });

  it("returns the parsed health payload on success", async () => {
    await installConfigMock({ workerUrl: "https://worker.test", apiToken: "tok" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION }),
      } as Response),
    );
    expect(await fetchWorkerHealth()).toEqual({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION });
  });

  it("returns null on a failed response", async () => {
    await installConfigMock({ workerUrl: "https://worker.test", apiToken: "tok" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response));
    expect(await fetchWorkerHealth()).toBeNull();
  });
});

describe("isWorkerSchemaCompatible", () => {
  it("is compatible when the Worker's schema is at or ahead of what the client expects", () => {
    expect(isWorkerSchemaCompatible({ ok: true, version: "x", schemaVersion: SCHEMA_VERSION })).toBe(true);
    expect(isWorkerSchemaCompatible({ ok: true, version: "x", schemaVersion: SCHEMA_VERSION + 1 })).toBe(true);
  });

  it("is incompatible when the Worker's schema is behind", () => {
    expect(isWorkerSchemaCompatible({ ok: true, version: "x", schemaVersion: SCHEMA_VERSION - 1 })).toBe(false);
  });
});

describe("sync's compatibility gate", () => {
  beforeEach(async () => {
    vi.resetModules();
    await installConfigMock({ workerUrl: "https://worker.test", apiToken: "tok" });
  });

  it("skips a write to a Worker whose schema is behind, without ever sending it", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION - 1 }),
        } as Response;
      }
      throw new Error(`unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await import("./sync");
    await fresh.pushResource("workspaces", { id: "a", updated_at: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/health");
  });

  it("sends writes once the Worker reports a compatible schema", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, applied: true }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await import("./sync");
    await fresh.pushResource("workspaces", { id: "a", updated_at: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails open (still sends writes) when the health check itself fails, e.g. a transient network issue", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) throw new Error("network error");
      return { ok: true, json: async () => ({ ok: true, applied: true }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await import("./sync");
    await fresh.pushResource("workspaces", { id: "a", updated_at: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only checks compatibility once per module instance, not once per request", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, applied: true }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await import("./sync");
    await fresh.pushResource("workspaces", { id: "a", updated_at: 1 });
    await fresh.pushResource("workspaces", { id: "b", updated_at: 1 });

    const healthCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith("/health"));
    expect(healthCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
