// Device-local UI/behavior preferences (which folders are collapsed,
// whether Shelve takes over the new-tab page). Deliberately NOT part of
// shared/types.ts's Folder shape, the synced `shelve_state`, or the D1
// schema — this is per-device presentation/preference state, not data
// that should ever sync between devices.

const UI_STATE_KEY = "shelve_ui_state";

export interface UiState {
  collapsedFolderIds: string[];
  /** Whether the background worker redirects a fresh chrome://newtab/ tab
   * to Shelve's full UI. Defaults to true (matches the original
   * chrome_url_overrides-based behavior). When false, opening a new tab
   * shows Chrome's real default new-tab page untouched — there is no way
   * to get that back once a static manifest override has claimed it, so
   * "optional" is implemented as a conditional runtime redirect instead
   * of a static override. */
  showOnNewTab: boolean;
  /** Workspace rail / open-tabs panel collapse state. */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** When on, dragging (or multi-select-saving) a tab from the open-tabs
   * panel into a folder closes the source tab once it's saved. Off by
   * default — saving a tab is meant to be non-destructive unless you
   * explicitly opt into this. */
  closeTabOnSave: boolean;
}

const DEFAULTS: UiState = {
  collapsedFolderIds: [],
  showOnNewTab: true,
  leftCollapsed: false,
  rightCollapsed: false,
  closeTabOnSave: false,
};

export async function getUiState(): Promise<UiState> {
  const result = await chrome.storage.local.get(UI_STATE_KEY);
  const stored = result[UI_STATE_KEY] as Partial<UiState> | undefined;
  return { ...DEFAULTS, ...stored };
}

export async function setUiState(state: UiState): Promise<void> {
  await chrome.storage.local.set({ [UI_STATE_KEY]: state });
}
