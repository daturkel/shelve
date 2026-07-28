import { fetchMock } from "cloudflare:test";
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { fetchLinkMetadata, handleLinkMetadata } from "./linkMetadata";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockHtml(origin: string, path: string, html: string, opts: { status?: number; contentType?: string } = {}) {
  fetchMock
    .get(origin)
    .intercept({ path, method: "GET" })
    .reply(opts.status ?? 200, html, { headers: { "content-type": opts.contentType ?? "text/html" } });
}

describe("fetchLinkMetadata", () => {
  it("prefers og:title over twitter:title and <title>", async () => {
    mockHtml(
      "https://example.com",
      "/page",
      `<html><head>
        <title>Fallback Title</title>
        <meta name="twitter:title" content="Twitter Title">
        <meta property="og:title" content="OG Title">
        <link rel="icon" href="/icon.png">
      </head></html>`,
    );
    const meta = await fetchLinkMetadata("https://example.com/page");
    expect(meta.title).toBe("OG Title");
    expect(meta.faviconUrl).toBe("https://example.com/icon.png");
  });

  it("falls back to twitter:title when there's no og:title", async () => {
    mockHtml(
      "https://example.com",
      "/page",
      `<html><head><title>Fallback Title</title><meta name="twitter:title" content="Twitter Title"></head></html>`,
    );
    const meta = await fetchLinkMetadata("https://example.com/page");
    expect(meta.title).toBe("Twitter Title");
  });

  it("falls back to <title> when there's no og:title or twitter:title", async () => {
    mockHtml("https://example.com", "/page", `<html><head><title> Plain Title </title></head></html>`);
    const meta = await fetchLinkMetadata("https://example.com/page");
    expect(meta.title).toBe("Plain Title");
  });

  it("returns a null title when nothing is found", async () => {
    mockHtml("https://example.com", "/page", `<html><head></head></html>`);
    const meta = await fetchLinkMetadata("https://example.com/page");
    expect(meta.title).toBeNull();
  });

  it("resolves a relative favicon href against the page URL", async () => {
    mockHtml(
      "https://example.com",
      "/deep/page",
      `<html><head><link rel="icon" href="/static/icon.png"></head></html>`,
    );
    const meta = await fetchLinkMetadata("https://example.com/deep/page");
    expect(meta.faviconUrl).toBe("https://example.com/static/icon.png");
  });

  it("falls back to /favicon.ico when there is no icon link", async () => {
    mockHtml("https://example.com", "/page", `<html><head><title>Page</title></head></html>`);
    const meta = await fetchLinkMetadata("https://example.com/page");
    expect(meta.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("treats a 'data:,' icon href as no icon and falls back to /favicon.ico", async () => {
    mockHtml("https://example.com", "/page", `<html><head><link rel="icon" href="data:,"></head></html>`);
    const meta = await fetchLinkMetadata("https://example.com/page");
    expect(meta.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("returns nulls for a non-HTML response", async () => {
    mockHtml("https://example.com", "/page.json", `{"not":"html"}`, { contentType: "application/json" });
    const meta = await fetchLinkMetadata("https://example.com/page.json");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });

  it("returns nulls on a non-OK response", async () => {
    mockHtml("https://example.com", "/missing", `not found`, { status: 404 });
    const meta = await fetchLinkMetadata("https://example.com/missing");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });

  it("returns nulls for a non-http(s) URL instead of throwing", async () => {
    const meta = await fetchLinkMetadata("javascript:alert(1)");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });

  it("returns nulls for an unparseable URL instead of throwing", async () => {
    const meta = await fetchLinkMetadata("not a url");
    expect(meta).toEqual({ title: null, faviconUrl: null });
  });
});

describe("handleLinkMetadata", () => {
  it("400s when the url query parameter is missing", async () => {
    const res = await handleLinkMetadata(new Request("https://worker.test/link-metadata"));
    expect(res.status).toBe(400);
  });

  it("400s when the url query parameter isn't a valid http(s) URL", async () => {
    const res = await handleLinkMetadata(new Request("https://worker.test/link-metadata?url=not-a-url"));
    expect(res.status).toBe(400);
  });

  it("200s with extracted metadata for a valid url", async () => {
    mockHtml("https://example.com", "/page", `<html><head><title>Page</title></head></html>`);
    const res = await handleLinkMetadata(
      new Request(`https://worker.test/link-metadata?url=${encodeURIComponent("https://example.com/page")}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Page", faviconUrl: "https://example.com/favicon.ico" });
  });
});
