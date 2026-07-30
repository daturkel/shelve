import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeArray,
  mergeState,
  countUnsyncedState,
  fetchWorkerHealth,
  fetchRemoteState,
  isWorkerSchemaCompatible,
} from "./sync";
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

  it("drops a local soft-deleted record that's absent from a full remote snapshot (permanently deleted elsewhere)", () => {
    const local = [ws({ id: "a", updated_at: 20, deleted_at: 20 })];
    const merged = mergeArray(local, []);
    expect(merged).toEqual([]);
  });

  it("keeps a local-only, never-soft-deleted record absent from remote (not yet pushed)", () => {
    const local = [ws({ id: "a", updated_at: 20, deleted_at: null })];
    const merged = mergeArray(local, []);
    expect(merged).toEqual(local);
  });

  it("a freshly-initialized bootstrap record (updated_at: 0) never resurrects an already-deleted remote record with the same id", () => {
    // Simulates initState()'s default "Home" workspace on a fresh/wiped
    // device, syncing against a Worker where that same well-known id was
    // already intentionally soft-deleted at some point in the past.
    const local = [ws({ id: "default", name: "Home", updated_at: 0, deleted_at: null })];
    const remote = [ws({ id: "default", name: "Home", updated_at: 555_000, deleted_at: 555_000 })];
    const merged = mergeArray(local, remote);
    expect(merged[0].deleted_at).toBe(555_000);
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

describe("countUnsyncedState", () => {
  it("counts a local-only record as unsynced", () => {
    const local: State = { workspaces: [ws({ id: "a", updated_at: 5 })], folders: [], entries: [] };
    const remote = { workspaces: [], folders: [], entries: [] };
    expect(countUnsyncedState(local, remote).workspaces).toBe(1);
  });

  it("counts a locally-newer record as unsynced", () => {
    const local: State = { workspaces: [ws({ id: "a", updated_at: 5 })], folders: [], entries: [] };
    const remote = { workspaces: [ws({ id: "a", updated_at: 1 })], folders: [], entries: [] };
    expect(countUnsyncedState(local, remote).workspaces).toBe(1);
  });

  it("doesn't count a record remote already matches or exceeds", () => {
    const local: State = { workspaces: [ws({ id: "a", updated_at: 5 })], folders: [], entries: [] };
    const remoteSame = { workspaces: [ws({ id: "a", updated_at: 5 })], folders: [], entries: [] };
    const remoteNewer = { workspaces: [ws({ id: "a", updated_at: 9 })], folders: [], entries: [] };
    expect(countUnsyncedState(local, remoteSame).workspaces).toBe(0);
    expect(countUnsyncedState(local, remoteNewer).workspaces).toBe(0);
  });

  it("counts each of workspaces/folders/entries independently", () => {
    const local: State = {
      workspaces: [ws({ id: "w", updated_at: 5 })],
      folders: [],
      entries: [],
    };
    const remote = { workspaces: [], folders: [], entries: [] };
    expect(countUnsyncedState(local, remote)).toEqual({ workspaces: 1, folders: 0, entries: 0 });
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

  it("returns null (rather than throwing) when a 200 response body isn't valid JSON", async () => {
    // The exact failure mode a misconfigured Worker URL (e.g. missing its
    // http(s) scheme) can produce: the request resolves to some other
    // server entirely, one that happens to respond 200 with an HTML body
    // instead of failing outright.
    await installConfigMock({ workerUrl: "https://worker.test", apiToken: "tok" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response),
    );
    await expect(fetchWorkerHealth()).resolves.toBeNull();
  });
});

describe("fetchRemoteState", () => {
  it("returns null (rather than throwing) when a 200 response body isn't valid JSON", async () => {
    await installConfigMock({ workerUrl: "https://worker.test", apiToken: "tok" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response),
    );
    await expect(fetchRemoteState()).resolves.toBeNull();
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

  it("re-checks compatibility after switching to a different Worker, rather than reusing the old Worker's cached verdict", async () => {
    // beforeEach configures "https://worker.test" as the initial Worker,
    // and it reports a compatible schema — this is the "old" Worker whose
    // verdict must not leak into a request made after switching.
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://worker.test/health") {
        return {
          ok: true,
          json: async () => ({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION }),
        } as Response;
      }
      if (url === "https://worker-b.test/health") {
        return {
          ok: true,
          json: async () => ({ ok: true, version: "0.1.0", schemaVersion: SCHEMA_VERSION - 1 }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, applied: true }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await import("./sync");
    // Primes the compatibility cache against the old, compatible Worker.
    await fresh.pushResource("workspaces", { id: "a", updated_at: 1 });

    const { setConfig } = await import("./config");
    await setConfig({ workerUrl: "https://worker-b.test", apiToken: "tok" });

    await fresh.pushResource("workspaces", { id: "b", updated_at: 1 });

    // The new Worker's schema is behind, so its health must actually be
    // checked (not assumed compatible from the old Worker's cached
    // verdict), and the write to it must be skipped.
    const newWorkerHealthCalls = fetchMock.mock.calls.filter(([url]) => url === "https://worker-b.test/health");
    expect(newWorkerHealthCalls).toHaveLength(1);
    const newWorkerWrites = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("worker-b.test/workspaces"),
    );
    expect(newWorkerWrites).toHaveLength(0);
  });
});
