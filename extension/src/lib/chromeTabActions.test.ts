import { describe, it, expect, vi, beforeEach } from "vitest";
import { chromeTabActions } from "./chromeTabActions";

describe("chromeTabActions", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).chrome = {
      tabs: {
        create: vi.fn(),
        remove: vi.fn(),
      },
    };
  });

  it("open() calls chrome.tabs.create with the url and active flag", () => {
    chromeTabActions.open("https://example.com", { active: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://example.com", active: true });
  });

  it("open() passes active: false through unchanged", () => {
    chromeTabActions.open("https://example.com", { active: false });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://example.com", active: false });
  });

  it("close() calls chrome.tabs.remove with the given tab ids", () => {
    chromeTabActions.close([1, 2, 3]);
    expect(chrome.tabs.remove).toHaveBeenCalledWith([1, 2, 3]);
  });
});
