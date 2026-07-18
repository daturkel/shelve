// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { webTabActions } from "./webTabActions";

describe("webTabActions", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { ...window, open: vi.fn() });
  });

  it("open() calls window.open with the url in a new tab", () => {
    webTabActions.open("https://example.com", { active: true });
    expect(window.open).toHaveBeenCalledWith("https://example.com", "_blank");
  });

  it("open() ignores the active flag — window.open has no way to honor it", () => {
    webTabActions.open("https://example.com", { active: false });
    expect(window.open).toHaveBeenCalledWith("https://example.com", "_blank");
  });

  it("close() is a no-op", () => {
    expect(() => webTabActions.close([1, 2, 3])).not.toThrow();
  });
});
