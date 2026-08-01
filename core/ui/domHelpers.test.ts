// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { buildIconButton } from "./domHelpers";

describe("buildIconButton", () => {
  it("is focusable and exposes a button role", () => {
    const el = buildIconButton({ className: "x", text: "✎", onActivate: () => {} });
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("role")).toBe("button");
  });

  it("fires onActivate on click without bubbling to an ancestor's click handler", () => {
    const onActivate = vi.fn();
    const parentOnClick = vi.fn();
    const parent = document.createElement("div");
    parent.onclick = parentOnClick;
    const el = buildIconButton({ className: "x", text: "✎", onActivate });
    parent.appendChild(el);

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(parentOnClick).not.toHaveBeenCalled();
  });

  it("fires onActivate on Enter and Space, but not other keys", () => {
    const onActivate = vi.fn();
    const el = buildIconButton({ className: "x", text: "✎", onActivate });

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onActivate).not.toHaveBeenCalled();

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
