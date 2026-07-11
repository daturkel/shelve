function buildOverlay(): { overlay: HTMLElement; box: HTMLElement } {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "modal-box";
  overlay.appendChild(box);

  document.body.appendChild(overlay);
  return { overlay, box };
}

/** In-window replacement for window.prompt() — same result shape (string
 * or null on cancel), but rendered inside the page instead of as native
 * browser chrome. Shared by newtab and popup — both load the same
 * .modal-* CSS in their respective stylesheets. */
export function showPrompt(title: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = title;
    box.appendChild(heading);

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

/** Multi-line variant of showPrompt(), for note content. Ctrl/Cmd+Enter
 * submits (plain Enter needs to stay newline-friendly in a textarea). */
export function showTextarea(title: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = title;
    box.appendChild(heading);

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

/** In-window replacement for window.confirm(). */
export function showConfirm(title: string, confirmLabel = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();

    const heading = document.createElement("div");
    heading.className = "modal-title";
    heading.textContent = title;
    box.appendChild(heading);

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
