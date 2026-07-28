// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { directFetchLinkMetadata, fetchLinkMetadata, setLinkMetadataFetcher, type LinkMetadata } from "./linkMetadata";

function mockFetch(html: string, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, text: async () => html } as Response));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setLinkMetadataFetcher(directFetchLinkMetadata);
});

describe("directFetchLinkMetadata", () => {
  it("extracts the title and resolves a relative favicon href against the page URL", async () => {
    mockFetch('<html><head><title> My Page </title><link rel="icon" href="/static/icon.png"></head></html>');
    const meta = await directFetchLinkMetadata("https://example.com/path");
    expect(meta.title).toBe("My Page");
    expect(meta.faviconUrl).toBe("https://example.com/static/icon.png");
  });

  it("falls back to /favicon.ico when there is no icon link", async () => {
    mockFetch("<html><head><title>Page</title></head></html>");
    const meta = await directFetchLinkMetadata("https://example.com/path");
    expect(meta.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("treats a 'data:,' icon href as no icon and falls back to /favicon.ico", async () => {
    mockFetch('<html><head><title>Page</title><link rel="icon" href="data:,"></head></html>');
    const meta = await directFetchLinkMetadata("https://example.com/path");
    expect(meta.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("returns a null title when there is no <title> tag", async () => {
    mockFetch("<html><head></head></html>");
    const meta = await directFetchLinkMetadata("https://example.com/path");
    expect(meta.title).toBeNull();
  });

  it("returns nulls on a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const meta = await directFetchLinkMetadata("https://example.com/path");
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
    const meta = await directFetchLinkMetadata("https://example.com/path", 5);
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });
});

describe("fetchLinkMetadata / setLinkMetadataFetcher", () => {
  it("defaults to directFetchLinkMetadata when no fetcher has been installed", async () => {
    mockFetch("<html><head><title>Default Path</title></head></html>");
    const meta = await fetchLinkMetadata("https://example.com/path");
    expect(meta.title).toBe("Default Path");
  });

  it("delegates to whichever fetcher was installed via setLinkMetadataFetcher", async () => {
    const installed = vi.fn<(url: string) => Promise<LinkMetadata>>().mockResolvedValue({
      title: "From installed fetcher",
      faviconUrl: null,
    });
    setLinkMetadataFetcher(installed);

    const meta = await fetchLinkMetadata("https://example.com/path");

    expect(installed).toHaveBeenCalledWith("https://example.com/path");
    expect(meta.title).toBe("From installed fetcher");
  });
});
