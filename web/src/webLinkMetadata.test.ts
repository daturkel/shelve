// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { setStore } from "@shelve/core/lib/store";
import { createMemoryStore } from "@shelve/core/lib/testStore";
import { setConfig } from "@shelve/core/lib/config";
import { webFetchLinkMetadata } from "./webLinkMetadata";

beforeEach(() => setStore(createMemoryStore()));
afterEach(() => vi.unstubAllGlobals());

describe("webFetchLinkMetadata", () => {
  it("returns nulls without ever fetching when unconfigured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const meta = await webFetchLinkMetadata("https://example.com/page");

    expect(meta).toEqual({ title: null, faviconUrl: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the Worker's /link-metadata endpoint with the bearer token and encoded url", async () => {
    await setConfig({ workerUrl: "https://worker.example", apiToken: "secret-token" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Example", faviconUrl: "https://example.com/favicon.ico" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const meta = await webFetchLinkMetadata("https://example.com/page?a=b");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://worker.example/link-metadata?url=https%3A%2F%2Fexample.com%2Fpage%3Fa%3Db",
      { headers: { Authorization: "Bearer secret-token" } },
    );
    expect(meta).toEqual({ title: "Example", faviconUrl: "https://example.com/favicon.ico" });
  });

  it("returns nulls on a non-OK response", async () => {
    await setConfig({ workerUrl: "https://worker.example", apiToken: "secret-token" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const meta = await webFetchLinkMetadata("https://example.com/page");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });

  it("returns nulls on a network failure instead of throwing", async () => {
    await setConfig({ workerUrl: "https://worker.example", apiToken: "secret-token" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const meta = await webFetchLinkMetadata("https://example.com/page");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });
});
