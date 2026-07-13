// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { showPrompt, showTextarea, showConfirm } from "./modal";

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
});
