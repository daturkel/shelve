import type { UiState } from "./uiState";

/** Applies the device-local theme preference to the current page by
 * setting (or clearing) documentElement's data-theme attribute. "auto"
 * clears it, so each page's `@media (prefers-color-scheme: light)` rule
 * takes over; "light"/"dark" set it explicitly, which each page's
 * `:root[data-theme="..."]` rule overrides the media query with. Called
 * once per page load (newtab, popup, options) — theme is read fresh from
 * storage on each page's own load rather than pushed live between
 * already-open pages. */
export function applyTheme(theme: UiState["theme"]): void {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
