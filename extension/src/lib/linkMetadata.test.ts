// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkMetadata } from "./linkMetadata";

function mockFetch(html: string, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, text: async () => html } as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLinkMetadata", () => {
  it("extracts the title and resolves a relative favicon href against the page URL", async () => {
    mockFetch('<html><head><title> My Page </title><link rel="icon" href="/static/icon.png"></head></html>');
    const meta = await fetchLinkMetadata("https://example.com/path");
    expect(meta.title).toBe("My Page");
    expect(meta.faviconUrl).toBe("https://example.com/static/icon.png");
  });

  it("falls back to /favicon.ico when there is no icon link", async () => {
    mockFetch("<html><head><title>Page</title></head></html>");
    const meta = await fetchLinkMetadata("https://example.com/path");
    expect(meta.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("treats a 'data:,' icon href as no icon and falls back to /favicon.ico", async () => {
    mockFetch('<html><head><title>Page</title><link rel="icon" href="data:,"></head></html>');
    const meta = await fetchLinkMetadata("https://example.com/path");
    expect(meta.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("returns a null title when there is no <title> tag", async () => {
    mockFetch("<html><head></head></html>");
    const meta = await fetchLinkMetadata("https://example.com/path");
    expect(meta.title).toBeNull();
  });

  it("returns nulls on a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const meta = await fetchLinkMetadata("https://example.com/path");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });

  it("aborts and returns nulls if the fetch exceeds the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    const meta = await fetchLinkMetadata("https://example.com/path", 5);
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });
});
