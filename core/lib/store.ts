/** The persistence backend core code reads/writes small state blobs
 * through — `chrome.storage.local` on the extension, `localStorage`/
 * IndexedDB on a future web build. Only 6 functions across storage.ts/
 * uiState.ts/config.ts ever touch this (everything else, e.g.
 * createEntry/deleteEntry, mutates an already-loaded State object in
 * memory), and each HTML page is its own JS realm with one obvious
 * answer for "which backend" — so a module-level singleton set once at
 * page startup is simpler than threading a Store through every call,
 * and matches the existing applyTheme()-once-per-load convention. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

let activeStore: Store | undefined;

export function setStore(store: Store): void {
  activeStore = store;
}

export function getStore(): Store {
  if (!activeStore) throw new Error("Store not configured — call setStore() before any storage access");
  return activeStore;
}
