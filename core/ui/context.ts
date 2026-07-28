import type { State } from "../lib/storage";
import type { UiState } from "../lib/uiState";

/** Platform-specific "act on a real browser tab" operations — opening a
 * URL as a tab (optionally in the background) and closing tabs by id.
 * Deliberately narrow: it's exactly what this package's builder code
 * needs, not a wrapper around chrome.tabs. The extension implements
 * this via chrome.tabs.create/remove (see extension/src/lib/
 * chromeTabActions.ts); a future web build would implement `open` via
 * window.open and likely no-op `close` — a web page has no way to close
 * an arbitrary tab by id, unlike a browser extension. */
export interface TabActions {
  open(url: string, opts: { active: boolean }): void;
  close(tabIds: number[]): void;
}

/** Shared mutable app state passed to every builder function, so the
 * newtab UI can be split across files without a framework: each module
 * reads/writes the same ctx object rather than closing over its own copy
 * of module-level state. */
export interface AppContext {
  state: State;
  uiState: UiState;
  activeWorkspaceId: string;
  searchQuery: string;
  /** Whether the main area shows the trash instead of the active
   * workspace's folders. Transient navigation state, not persisted —
   * always starts back on the folder view. */
  showTrash: boolean;
  /** Ids of open-tabs-panel tabs currently checked for a multi-select
   * action (save-to-folder, multi-drag). Transient, not persisted —
   * pruned down to still-open tab ids on every live tabs refresh. */
  selectedTabIds: Set<number>;
  /** Ids of entries currently checked for a multi-select action (delete,
   * open as tabs, move, multi-drag). Global across every visible folder,
   * not scoped to one — same rationale as selectedTabIds being global
   * across windows. Transient, not persisted. */
  selectedEntryIds: Set<string>;
  /** Composite `"<kind>:<id>"` keys of trash rows currently checked for a
   * multi-select action (restore, permanently delete). Checking a group
   * row (a trashed workspace/folder) adds its current descendants' keys
   * too, so the Set stays the single source of truth for "is this
   * selected" with no separately-computed ancestor-coverage logic.
   * Transient, not persisted. */
  selectedTrashIds: Set<string>;
  /** Composite `"<kind>:<id>"` keys of trash group rows (trashed
   * workspaces/folders with descendants still in the trash) currently
   * expanded to show those descendants. Exploratory browsing state, not
   * an organizational preference — transient like the above, not
   * persisted the way `uiState.collapsedFolderIds` is. */
  expandedTrashGroupIds: Set<string>;
  /** Re-render from current in-memory state, without persisting. */
  render: () => void;
  /** Persist state, then re-render. */
  rerender: () => Promise<void>;
  /** Persist uiState only (collapsed folders, showOnNewTab, etc). */
  persistUiState: () => Promise<void>;
  /** Platform-specific tab operations — see TabActions above. */
  tabActions: TabActions;
  /** Navigate to wherever configuration lives — chrome.runtime
   * .openOptionsPage() on the extension, a plain route on the web. */
  openSettings: () => void;
}
