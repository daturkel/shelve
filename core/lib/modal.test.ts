// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPrompt, showTextarea, showConfirm, showErrorToast } from "./modal";

// Each show*() call appends its own overlay and only removes it once
// resolved. Scoping every query to the most recently opened overlay (rather
// than a bare document-wide selector) keeps tests independent even if a
// previous test's modal was left unresolved.
function latestOverlay(): HTMLElement {
  const overlays = document.querySelectorAll<HTMLElement>(".modal-overlay");
  return overlays[overlays.length - 1];
}

function primaryBtn(): HTMLButtonElement {
  return latestOverlay().querySelector(".modal-btn-primary")!;
}

function cancelBtn(): HTMLButtonElement {
  return latestOverlay().querySelector(".modal-btn:not(.modal-btn-primary):not(.modal-btn-danger)")!;
}

describe("showPrompt", () => {
  it("resolves with the trimmed input value on OK", async () => {
    const result = showPrompt("Name", "default");
    const input = latestOverlay().querySelector(".modal-input") as HTMLInputElement;
    input.value = "  a name  ";
    primaryBtn().click();
    expect(await result).toBe("a name");
  });

  it("resolves with null on cancel", async () => {
    const result = showPrompt("Name");
    cancelBtn().click();
    expect(await result).toBeNull();
  });

  it("resolves with null when the trimmed value is empty", async () => {
    const result = showPrompt("Name");
    const input = latestOverlay().querySelector(".modal-input") as HTMLInputElement;
    input.value = "   ";
    primaryBtn().click();
    expect(await result).toBeNull();
  });

  it("removes its overlay from the document after resolving", async () => {
    const result = showPrompt("Name");
    const overlay = latestOverlay();
    cancelBtn().click();
    await result;
    expect(overlay.isConnected).toBe(false);
  });
});

describe("showTextarea", () => {
  it("pre-fills the textarea with the default value", async () => {
    const result = showTextarea("Note", "existing note");
    const textarea = latestOverlay().querySelector(".modal-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("existing note");
    cancelBtn().click();
    await result;
  });

  it("resolves with the trimmed value when Save is clicked", async () => {
    const result = showTextarea("Note");
    const textarea = latestOverlay().querySelector(".modal-textarea") as HTMLTextAreaElement;
    textarea.value = "  multi\nline  ";
    primaryBtn().click();
    expect(await result).toBe("multi\nline");
  });

  it("resolves with null on cancel", async () => {
    const result = showTextarea("Note");
    cancelBtn().click();
    expect(await result).toBeNull();
  });

  it("submits on Cmd/Ctrl+Enter but not plain Enter", async () => {
    const result = showTextarea("Note");
    const overlay = latestOverlay();
    const textarea = overlay.querySelector(".modal-textarea") as HTMLTextAreaElement;
    textarea.value = "draft";
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(overlay.isConnected).toBe(true);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(await result).toBe("draft");
  });

  it("resolves with null on Escape", async () => {
    const result = showTextarea("Note");
    const textarea = latestOverlay().querySelector(".modal-textarea") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await result).toBeNull();
  });
});

describe("showConfirm", () => {
  it("resolves true when confirmed", async () => {
    const result = showConfirm("Delete this?");
    (latestOverlay().querySelector(".modal-btn-danger") as HTMLButtonElement).click();
    expect(await result).toBe(true);
  });

  it("resolves false on cancel", async () => {
    const result = showConfirm("Delete this?");
    (latestOverlay().querySelector(".modal-btn:not(.modal-btn-danger)") as HTMLButtonElement).click();
    expect(await result).toBe(false);
  });

  it("resolves false on Escape", async () => {
    const result = showConfirm("Delete this?");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await result).toBe(false);
  });

  it("uses the custom confirm label when provided", async () => {
    const result = showConfirm("Archive this?", "Archive");
    const danger = latestOverlay().querySelector(".modal-btn-danger") as HTMLButtonElement;
    expect(danger.textContent).toBe("Archive");
    danger.click();
    await result;
  });

  it("wraps Tab from the last focusable element back to the first", async () => {
    const result = showConfirm("Delete this?");
    const box = latestOverlay().querySelector(".modal-box")!;
    const buttons = box.querySelectorAll<HTMLButtonElement>(".modal-btn");
    const [first, last] = [buttons[0], buttons[buttons.length - 1]];
    last.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(first);
    cancelBtn().click();
    await result;
  });

  it("wraps Shift+Tab from the first focusable element back to the last", async () => {
    const result = showConfirm("Delete this?");
    const box = latestOverlay().querySelector(".modal-box")!;
    const buttons = box.querySelectorAll<HTMLButtonElement>(".modal-btn");
    const [first, last] = [buttons[0], buttons[buttons.length - 1]];
    first.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(document.activeElement).toBe(last);
    cancelBtn().click();
    await result;
  });
});

describe("showErrorToast", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll(".shelve-toast").forEach((el) => el.remove());
  });

  it("renders the message as an assertive alert", () => {
    showErrorToast("Couldn't save your change: quota exceeded");
    const toast = document.querySelector(".shelve-toast")!;
    expect(toast.textContent).toContain("Couldn't save your change: quota exceeded");
    expect(toast.getAttribute("role")).toBe("alert");
    expect(toast.getAttribute("aria-live")).toBe("assertive");
  });

  it("replaces a still-visible previous toast rather than stacking", () => {
    showErrorToast("first");
    showErrorToast("second");
    const toasts = document.querySelectorAll(".shelve-toast");
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toContain("second");
  });

  it("auto-dismisses after a few seconds", () => {
    vi.useFakeTimers();
    showErrorToast("transient failure");
    expect(document.querySelector(".shelve-toast")).not.toBeNull();
    vi.advanceTimersByTime(6000);
    expect(document.querySelector(".shelve-toast")).toBeNull();
  });

  it("dismisses immediately when its dismiss button is clicked", () => {
    showErrorToast("transient failure");
    (document.querySelector(".shelve-toast-dismiss") as HTMLButtonElement).click();
    expect(document.querySelector(".shelve-toast")).toBeNull();
  });

  it("a leftover auto-dismiss timer from a replaced toast doesn't clear the new one", () => {
    vi.useFakeTimers();
    showErrorToast("first");
    vi.advanceTimersByTime(3000);
    showErrorToast("second");
    // "first"'s 6s timer would fire here if it hadn't been cleared on replacement.
    vi.advanceTimersByTime(3000);
    expect(document.querySelector(".shelve-toast")?.textContent).toContain("second");
  });
});
