import type { LinkMetadata } from "./linkMetadata";

let modalTitleCounter = 0;

/** Exported so custom modal-shaped UI (e.g. the tabs-panel folder picker)
 * can build on the same overlay/box shell without duplicating it. */
export function buildOverlay(): { overlay: HTMLElement; box: HTMLElement } {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "modal-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  overlay.appendChild(box);

  document.body.appendChild(overlay);
  return { overlay, box };
}

/** Gives `heading` a unique id and points `box`'s aria-labelledby at it, so
 * assistive tech announces the dialog's title on open. */
function labelBoxWithHeading(box: HTMLElement, heading: HTMLElement): void {
  heading.id = `modal-title-${modalTitleCounter++}`;
  box.setAttribute("aria-labelledby", heading.id);
}

/** Keeps Tab/Shift+Tab cycling within `box` instead of letting focus
 * escape to the page behind the overlay once it reaches the last (or
 * first, shift-tabbing) focusable element. Queries `box` fresh on every
 * keydown rather than snapshotting focusable elements up front, since a
 * modal can mutate its own contents after opening (e.g.
 * showLinkTitlePrompt removes its spinner once metadata resolves). Safe
 * to call right after buildOverlay(), before the modal's own content is
 * appended, for exactly that reason. */
function trapFocus(box: HTMLElement): void {
  box.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab") return;
    const focusable = Array.from(
      box.querySelectorAll<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });
}

/** In-window replacement for window.prompt() — same result shape (string
 * or null on cancel), but rendered inside the page instead of as native
 * browser chrome. Shared by newtab and popup — both load the same
 * .modal-* CSS in their respective stylesheets. */
export function showPrompt(title: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const trigger = document.activeElement as HTMLElement | null;
    const { overlay, box } = buildOverlay();
    trapFocus(box);

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = title;
    box.appendChild(heading);
    labelBoxWithHeading(box, heading);

    const input = document.createElement("input");
    input.className = "modal-input";
    input.type = "text";
    input.value = defaultValue;
    box.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "modal-btn modal-btn-primary";
    okBtn.textContent = "OK";
    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);

    const cleanup = (result: string | null) => {
      overlay.remove();
      trigger?.focus();
      resolve(result);
    };

    okBtn.onclick = () => cleanup(input.value.trim() || null);
    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (ev) => {
      if (ev.target === overlay) cleanup(null);
    };
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") cleanup(input.value.trim() || null);
      if (ev.key === "Escape") cleanup(null);
    };

    input.focus();
    input.select();
  });
}

/** Title prompt for the "add link" flow, shown when metadata fetching is
 * taking long enough that the user shouldn't just be staring at nothing
 * (see core/ui/folders.ts's buildAddLinkTile — it races the metadata fetch
 * against a short timeout and only falls back to this when that timeout
 * wins). Opens immediately with the URL as a placeholder title and a
 * spinner, and lets the user type/submit right away rather than blocking
 * on `metadata`. If `metadata` resolves with a title before the user has
 * edited the input or submitted, it's filled in automatically. */
export function showLinkTitlePrompt(url: string, metadata: Promise<LinkMetadata>): Promise<string | null> {
  return new Promise((resolve) => {
    const trigger = document.activeElement as HTMLElement | null;
    const { overlay, box } = buildOverlay();
    trapFocus(box);

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = "Title";
    box.appendChild(heading);
    labelBoxWithHeading(box, heading);

    const inputRow = document.createElement("div");
    inputRow.className = "modal-input-row";
    box.appendChild(inputRow);

    const input = document.createElement("input");
    input.className = "modal-input";
    input.type = "text";
    input.value = url;
    inputRow.appendChild(input);

    const spinner = document.createElement("span");
    spinner.className = "modal-spinner";
    spinner.setAttribute("role", "status");
    spinner.setAttribute("aria-label", "Fetching title…");
    inputRow.appendChild(spinner);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "modal-btn modal-btn-primary";
    okBtn.textContent = "OK";
    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);

    let settled = false;
    let userEdited = false;
    input.oninput = () => {
      userEdited = true;
    };

    const cleanup = (result: string | null) => {
      settled = true;
      overlay.remove();
      trigger?.focus();
      resolve(result);
    };

    okBtn.onclick = () => cleanup(input.value.trim() || null);
    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (ev) => {
      if (ev.target === overlay) cleanup(null);
    };
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") cleanup(input.value.trim() || null);
      if (ev.key === "Escape") cleanup(null);
    };

    input.focus();
    input.select();

    void metadata.then((meta) => {
      spinner.remove();
      if (!settled && !userEdited && meta.title) {
        input.value = meta.title;
        input.select();
      }
    });
  });
}

/** Multi-line variant of showPrompt(), for note content. Ctrl/Cmd+Enter
 * submits (plain Enter needs to stay newline-friendly in a textarea). */
export function showTextarea(title: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const trigger = document.activeElement as HTMLElement | null;
    const { overlay, box } = buildOverlay();
    trapFocus(box);

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = title;
    box.appendChild(heading);
    labelBoxWithHeading(box, heading);

    const textarea = document.createElement("textarea");
    textarea.className = "modal-textarea";
    textarea.value = defaultValue;
    textarea.rows = 5;
    box.appendChild(textarea);

    const hint = document.createElement("div");
    hint.className = "modal-hint";
    hint.textContent = "Cmd/Ctrl+Enter to save";
    box.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "modal-btn modal-btn-primary";
    okBtn.textContent = "Save";
    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);

    const cleanup = (result: string | null) => {
      overlay.remove();
      trigger?.focus();
      resolve(result);
    };

    okBtn.onclick = () => cleanup(textarea.value.trim() || null);
    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (ev) => {
      if (ev.target === overlay) cleanup(null);
    };
    textarea.onkeydown = (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) cleanup(textarea.value.trim() || null);
      if (ev.key === "Escape") cleanup(null);
    };

    textarea.focus();
    textarea.select();
  });
}

let dismissActiveToast: (() => void) | null = null;

/** Transient, dismissible error banner. Storage writes throughout the
 * folder/rail/trash UI are optimistic — state is mutated and re-rendered
 * before the write to persistent storage is known to have succeeded — so
 * a rejected write (e.g. storage quota exceeded, or a blocked
 * transaction) previously left the user looking at a change that quietly
 * reverted itself on the next reload with no indication anything had gone
 * wrong. This surfaces that failure immediately instead. */
export function showErrorToast(message: string): void {
  dismissActiveToast?.();

  const toast = document.createElement("div");
  toast.className = "shelve-toast";
  // role="alert" + aria-live: an assistive-tech user gets no other signal
  // that anything happened — the failure here is exactly a silently
  // reverted optimistic UI change, so this is the one place that matters.
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "assertive");

  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  const dismiss = document.createElement("button");
  dismiss.className = "shelve-toast-dismiss";
  dismiss.textContent = "✕";
  dismiss.title = "Dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.onclick = () => cleanup();
  toast.appendChild(dismiss);

  document.body.appendChild(toast);

  const timer = setTimeout(cleanup, 6000);

  function cleanup(): void {
    clearTimeout(timer);
    toast.remove();
    if (dismissActiveToast === cleanup) dismissActiveToast = null;
  }

  dismissActiveToast = cleanup;
}

/** In-window replacement for window.confirm(). */
export function showConfirm(title: string, confirmLabel = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    const trigger = document.activeElement as HTMLElement | null;
    const { overlay, box } = buildOverlay();
    trapFocus(box);

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = title;
    box.appendChild(heading);
    labelBoxWithHeading(box, heading);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "modal-btn modal-btn-danger";
    okBtn.textContent = confirmLabel;
    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);

    const cleanup = (result: boolean) => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
      trigger?.focus();
      resolve(result);
    };
    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cleanup(false);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    overlay.onclick = (ev) => {
      if (ev.target === overlay) cleanup(false);
    };
    document.addEventListener("keydown", onKeydown);

    okBtn.focus();
  });
}
