// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { applyTheme } from "./theme";

describe("applyTheme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("sets data-theme to 'light'", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("sets data-theme to 'dark'", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("clears data-theme for 'auto', including a previously-set value", () => {
    document.documentElement.dataset.theme = "light";
    applyTheme("auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
