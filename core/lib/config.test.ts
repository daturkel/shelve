import { beforeEach, describe, expect, it } from "vitest";
import { getConfig, setConfig } from "./config";
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
