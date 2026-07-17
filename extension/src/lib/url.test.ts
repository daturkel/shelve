import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("prepends https:// to a bare domain", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  it("prepends https:// to a domain with a path", () => {
    expect(normalizeUrl("example.com/foo?bar=1")).toBe("https://example.com/foo?bar=1");
  });

  it("leaves an http:// URL untouched", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("leaves an https:// URL untouched", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("leaves a non-http scheme untouched", () => {
    expect(normalizeUrl("ftp://example.com")).toBe("ftp://example.com");
  });

  it("leaves a chrome-extension:// URL untouched", () => {
    expect(normalizeUrl("chrome-extension://abc/page.html")).toBe("chrome-extension://abc/page.html");
  });
});
