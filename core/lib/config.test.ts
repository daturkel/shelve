import { beforeEach, describe, expect, it } from "vitest";
import { getConfig, setConfig, isValidWorkerUrl } from "./config";
import { setStore } from "./store";
import { createMemoryStore } from "./testStore";

describe("getConfig", () => {
  beforeEach(() => setStore(createMemoryStore()));

  it("returns null when nothing is stored yet", async () => {
    await expect(getConfig()).resolves.toBeNull();
  });

  it("returns null when workerUrl is missing", async () => {
    const store = createMemoryStore();
    await store.set("shelve_config", { apiToken: "t" });
    setStore(store);
    await expect(getConfig()).resolves.toBeNull();
  });

  it("returns null when apiToken is missing", async () => {
    const store = createMemoryStore();
    await store.set("shelve_config", { workerUrl: "https://w" });
    setStore(store);
    await expect(getConfig()).resolves.toBeNull();
  });

  it("round-trips a full config via setConfig", async () => {
    const config = { workerUrl: "https://worker.example", apiToken: "secret" };
    await setConfig(config);
    await expect(getConfig()).resolves.toEqual(config);
  });
});

describe("isValidWorkerUrl", () => {
  it("accepts https:// URLs", () => {
    expect(isValidWorkerUrl("https://shelve-worker.example.workers.dev")).toBe(true);
  });

  it("accepts http:// URLs (e.g. a local wrangler dev instance)", () => {
    expect(isValidWorkerUrl("http://localhost:8787")).toBe(true);
  });

  it("rejects a URL missing its scheme entirely", () => {
    // The exact failure mode that motivated this check: fetch() doesn't
    // reject a schemeless string outright, it silently resolves it as a
    // same-origin relative path instead — so this must be caught before
    // ever being saved, not left to fail confusingly downstream.
    expect(isValidWorkerUrl("shelve-worker.example.workers.dev")).toBe(false);
  });

  it("rejects other schemes", () => {
    expect(isValidWorkerUrl("ftp://example.com")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isValidWorkerUrl("not a url at all")).toBe(false);
  });
});
