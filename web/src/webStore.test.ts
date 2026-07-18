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
