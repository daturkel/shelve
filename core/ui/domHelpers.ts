/** Icon-only control (rename/delete glyphs in folders.ts and rail.ts)
 * built as a focusable, keyboard-operable element rather than a plain
 * `<div onclick>` — those were unreachable via Tab and invisible to
 * screen readers as interactive elements. `onActivate` fires on click
 * and on Enter/Space, matching native `<button>` behavior, and
 * stopPropagation is handled here so call sites don't each need their
 * own (these controls always sit inside a larger clickable row that
 * shouldn't also fire). */
export function buildIconButton(opts: {
  className: string;
  text: string;
  title?: string;
  onActivate: (ev: MouseEvent | KeyboardEvent) => void | Promise<void>;
}): HTMLElement {
  const el = document.createElement("div");
  el.className = opts.className;
  el.textContent = opts.text;
  if (opts.title) el.title = opts.title;
  el.tabIndex = 0;
  el.setAttribute("role", "button");

  el.onclick = (ev) => {
    ev.stopPropagation();
    void opts.onActivate(ev);
  };
  el.onkeydown = (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    ev.stopPropagation();
    void opts.onActivate(ev);
  };

  return el;
}
