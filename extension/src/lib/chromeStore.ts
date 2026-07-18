import type { Store } from "@shelve/core/lib/store";

/** The extension's Store implementation, backed by chrome.storage.local.
 * Wired in once per page (newtab/popup/options) via setStore() at
 * startup, before any core code that reads/writes state runs. */
export const chromeStore: Store = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
};
