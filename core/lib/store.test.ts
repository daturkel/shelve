import { describe, it, expect, vi } from "vitest";

// setStore/getStore hold module-level state, so re-import fresh per test
// via vi.resetModules() rather than sharing one import across the file —
// otherwise a store set by one test would leak into the next.
async function freshModule() {
  vi.resetModules();
  return import("./store");
}

describe("getStore", () => {
  it("throws if no store has been configured yet", async () => {
    const { getStore } = await freshModule();
    expect(() => getStore()).toThrow(/Store not configured/);
  });

  it("returns the store passed to setStore", async () => {
    const { setStore, getStore } = await freshModule();
    const fake = { get: vi.fn(), set: vi.fn() };
    setStore(fake);
    expect(getStore()).toBe(fake);
  });

  it("returns the most recently set store", async () => {
    const { setStore, getStore } = await freshModule();
    const first = { get: vi.fn(), set: vi.fn() };
    const second = { get: vi.fn(), set: vi.fn() };
    setStore(first);
    setStore(second);
    expect(getStore()).toBe(second);
  });
});
