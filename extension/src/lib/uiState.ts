// Device-local UI presentation state (which folders are collapsed).
// Deliberately NOT part of shared/types.ts's Folder shape or the synced
// `shelve_state` — this is pure per-device display state, not data, so it
// has no business in the sync payload or the D1 schema.

const UI_STATE_KEY = "shelve_ui_state";

export interface UiState {
  collapsedFolderIds: string[];
}

export async function getUiState(): Promise<UiState> {
  const result = await chrome.storage.local.get(UI_STATE_KEY);
  return (result[UI_STATE_KEY] as UiState | undefined) ?? { collapsedFolderIds: [] };
}

export async function setUiState(state: UiState): Promise<void> {
  await chrome.storage.local.set({ [UI_STATE_KEY]: state });
}
