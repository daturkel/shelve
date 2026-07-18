// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { webStore, onRemoteChange } from "./webStore";

describe("webStore", () => {
  it("returns undefined for a key that was never set", async () => {
    await expect(webStore.get("missing-key")).resolves.toBeUndefined();
  });

  it("round-trips a value through set/get", async () => {
    await webStore.set("round-trip", { a: 1, b: [2, 3] });
    await expect(webStore.get("round-trip")).resolves.toEqual({ a: 1, b: [2, 3] });
  });

  it("keeps separate keys independent", async () => {
    await webStore.set("key-a", "value-a");
    await webStore.set("key-b", "value-b");
    await expect(webStore.get("key-a")).resolves.toBe("value-a");
    await expect(webStore.get("key-b")).resolves.toBe("value-b");
  });

  it("overwrites a previously-set value for the same key", async () => {
    await webStore.set("overwrite-me", "first");
    await webStore.set("overwrite-me", "second");
    await expect(webStore.get("overwrite-me")).resolves.toBe("second");
  });
});

describe("recovers from a transient IndexedDB open failure", () => {
  it("retries opening the database on the next call instead of permanently re-rejecting", async () => {
    vi.resetModules();
    const originalOpen = indexedDB.open.bind(indexedDB);
    let calls = 0;

    // A minimal fake IDBOpenDBRequest whose onerror setter auto-fires,
    // simulating a transient open failure on the first attempt only —
    // every subsequent call delegates to the real indexedDB.
    vi.spyOn(indexedDB, "open").mockImplementation((...args) => {
      calls++;
      if (calls > 1) return originalOpen(...(args as Parameters<typeof originalOpen>));
      const fakeRequest: Record<string, unknown> = { error: new Error("simulated transient failure") };
      Object.defineProperty(fakeRequest, "onerror", {
        set(fn: (ev: Event) => void) {
          queueMicrotask(() => fn(new Event("error")));
        },
      });
      Object.defineProperty(fakeRequest, "onsuccess", { set() {} });
      Object.defineProperty(fakeRequest, "onupgradeneeded", { set() {} });
      return fakeRequest as unknown as IDBOpenDBRequest;
    });

    const { webStore: freshStore } = await import("./webStore");

    await expect(freshStore.get("x")).rejects.toThrow("simulated transient failure");
    // If dbPromise weren't reset on failure, this second call would
    // re-reject with the same stale error instead of actually retrying.
    await expect(freshStore.get("x")).resolves.toBeUndefined();

    vi.restoreAllMocks();
  });
});

describe("cross-tab BroadcastChannel notification", () => {
  it("set() broadcasts the changed key for other tabs to observe", async () => {
    const received: string[] = [];
    const listenerChannel = new BroadcastChannel("shelve-store");
    listenerChannel.onmessage = (ev: MessageEvent<{ key: string }>) => received.push(ev.data.key);

    await webStore.set("broadcast-key", "value");

    await vi.waitFor(() => expect(received).toEqual(["broadcast-key"]));
    listenerChannel.close();
  });

  it("onRemoteChange fires when another tab's channel posts a message", async () => {
    const received: string[] = [];
    onRemoteChange((key) => received.push(key));

    const otherTabChannel = new BroadcastChannel("shelve-store");
    otherTabChannel.postMessage({ key: "some-key" });

    await vi.waitFor(() => expect(received).toEqual(["some-key"]));
    otherTabChannel.close();
  });
});
