import type { TabActions } from "@shelve/core/ui/context";

/** The web app's TabActions implementation. `opts.active` is ignored —
 * window.open() always focuses the new tab, with no way for a web page
 * to background it (the same limitation chrome.tabs.create was
 * introduced to get around in the extension). `close` is a no-op — a
 * web page has no way to close an arbitrary tab by id either, unlike a
 * browser extension (this is the documented, anticipated gap in
 * TabActions's own doc comment). closeTabOnSave becomes silently inert
 * as a result, so the settings view never exposes that toggle on web. */
export const webTabActions: TabActions = {
  open: (url) => void window.open(url, "_blank"),
  close: () => {},
};
