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
      { headers: { Authorization: "Bearer secret-token" }, signal: expect.any(AbortSignal) },
    );
    expect(meta).toEqual({ title: "Example", faviconUrl: "https://example.com/favicon.ico" });
  });

  it("aborts and returns nulls if the fetch doesn't settle within the timeout", async () => {
    await setConfig({ workerUrl: "https://worker.example", apiToken: "secret-token" });
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const metaPromise = webFetchLinkMetadata("https://example.com/page", 50);
    await vi.advanceTimersByTimeAsync(50);
    const meta = await metaPromise;

    expect(meta).toEqual({ title: null, faviconUrl: null });
    vi.useRealTimers();
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
