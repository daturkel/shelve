import { beforeEach, describe, expect, it } from "vitest";
import { getConfig, setConfig } from "./config";

function installChromeStorageMock() {
  const store = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
      },
    },
  };
}

describe("getConfig", () => {
  beforeEach(() => installChromeStorageMock());

  it("returns null when nothing is stored yet", async () => {
    await expect(getConfig()).resolves.toBeNull();
  });

  it("returns null when workerUrl is missing", async () => {
    (globalThis as Record<string, unknown>).chrome = {
      storage: { local: { get: async () => ({ shelve_config: { apiToken: "t" } }), set: async () => {} } },
    };
    await expect(getConfig()).resolves.toBeNull();
  });

  it("returns null when apiToken is missing", async () => {
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        local: { get: async () => ({ shelve_config: { workerUrl: "https://w" } }), set: async () => {} },
      },
    };
    await expect(getConfig()).resolves.toBeNull();
  });

  it("round-trips a full config via setConfig", async () => {
    const config = { workerUrl: "https://worker.example", apiToken: "secret" };
    await setConfig(config);
    await expect(getConfig()).resolves.toEqual(config);
  });
});
