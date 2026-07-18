import { describe, it, expect, beforeEach } from "vitest";
import { chromeStore } from "./chromeStore";

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

describe("chromeStore", () => {
  beforeEach(() => installChromeStorageMock());

  it("returns undefined for a key that was never set", async () => {
    await expect(chromeStore.get("missing")).resolves.toBeUndefined();
  });

  it("round-trips a value through set/get", async () => {
    await chromeStore.set("k", { a: 1 });
    await expect(chromeStore.get("k")).resolves.toEqual({ a: 1 });
  });

  it("unwraps chrome.storage.local.get's {[key]: value} response shape", async () => {
    // chrome.storage.local.get resolves an object keyed by every
    // requested key, even when only one was asked for — confirms
    // chromeStore.get correctly picks that one key back out rather than
    // returning the wrapper object itself.
    await chromeStore.set("only-this-key", "value");
    const result = await chromeStore.get("only-this-key");
    expect(result).toBe("value");
  });
});
