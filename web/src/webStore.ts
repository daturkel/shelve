import type { Store } from "@shelve/core/lib/store";

const DB_NAME = "shelve";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const CHANNEL_NAME = "shelve-store";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // A transient failure (a blocked upgrade from another open tab, a
      // one-time quota error) shouldn't poison the store forever — reset
      // the cached promise so the next get()/set() call retries opening
      // the database instead of permanently re-rejecting with this
      // same stale error for the rest of the page's lifetime.
      dbPromise = null;
      reject(request.error as Error);
    };
  });
  return dbPromise;
}

// Reduces eviction risk under browser storage pressure — best-effort, not
// guaranteed by any browser, so failures here are silently ignored rather
// than surfaced (nothing meaningful for the UI to do about a "no" beyond
// what already happens if a write later fails).
void navigator.storage?.persist();

// No native cross-tab change event for IndexedDB the way `localStorage`
// has (window's "storage" event is localStorage/sessionStorage-only) —
// BroadcastChannel is the equivalent primitive. See onRemoteChange below.
const channel = new BroadcastChannel(CHANNEL_NAME);

/** The web app's Store implementation, backed by IndexedDB rather than
 * localStorage — Store's interface is already Promise-based (designed
 * around chrome.storage.local's async shape), so this is a drop-in
 * backend swap with no interface changes, and it sidesteps
 * localStorage's small (~5-10MB) quota and synchronous
 * QuotaExceededError throw in favor of IndexedDB's much larger
 * best-effort browser storage quota. Errors from a failed write are
 * allowed to propagate, not swallowed. */
export const webStore: Store = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error as Error);
    });
  },

  async set(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error as Error);
      // A transaction can abort without a corresponding request error
      // (e.g. under storage pressure) — without this, that case would
      // leave the promise pending forever, hanging any awaited caller
      // (saveState/setUiState/setConfig) indefinitely.
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
    channel.postMessage({ key });
  },
};

/** Reload in-memory state and re-render when another same-origin tab
 * changes the store — closes the "silently diverged with zero feedback
 * until a manual reload" gap for concurrent tabs left open (see
 * KNOWN_GAPS.md). Not full conflict merging: two tabs saving within the
 * same instant still last-write-wins at the storage layer, same failure
 * class as the extension's analogous two-newtab-windows risk. */
export function onRemoteChange(listener: (key: string) => void): void {
  channel.addEventListener("message", (ev: MessageEvent<{ key: string }>) => listener(ev.data.key));
}
