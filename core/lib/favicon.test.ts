// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildFaviconEl, buildPlaceholderFavicon } from "./favicon";

describe("buildPlaceholderFavicon", () => {
  it("builds a placeholder div", () => {
    const el = buildPlaceholderFavicon();
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("favicon favicon-placeholder");
  });
});

describe("buildFaviconEl", () => {
  it("builds a placeholder when given null", () => {
    const el = buildFaviconEl(null);
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("favicon favicon-placeholder");
  });

  it("builds a placeholder when given undefined", () => {
    const el = buildFaviconEl(undefined);
    expect(el.tagName).toBe("DIV");
  });

  it("builds an img with the given src when given a URL", () => {
    const el = buildFaviconEl("https://example.com/favicon.ico") as HTMLImageElement;
    expect(el.tagName).toBe("IMG");
    expect(el.src).toBe("https://example.com/favicon.ico");
    expect(el.className).toBe("favicon");
  });

  it("swaps to a placeholder on image load error", () => {
    const el = buildFaviconEl("https://example.com/broken.ico") as HTMLImageElement;
    const parent = document.createElement("div");
    parent.appendChild(el);

    el.onerror?.(new Event("error"));

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].className).toBe("favicon favicon-placeholder");
  });
});
