import type { TabActions } from "@shelve/core/ui/context";

/** The extension's TabActions implementation, backed by chrome.tabs. */
export const chromeTabActions: TabActions = {
  open: (url, { active }) => void chrome.tabs.create({ url, active }),
  close: (tabIds) => void chrome.tabs.remove(tabIds),
};
