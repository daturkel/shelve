import { getUiState } from "../lib/uiState";

const NEWTAB_URL = "chrome://newtab/";

// Optional new-tab takeover, implemented as a conditional redirect rather
// than a static `chrome_url_overrides.newtab` manifest entry. Chrome has
// no supported way to dynamically toggle a manifest-level override, and
// once one is declared there's no way back to Chrome's real default
// new-tab page short of the user disabling the extension — so instead we
// never declare the override at all, and redirect here only when the
// user's "show on new tab" preference is on. Off means we simply do
// nothing and Chrome's real NTP shows, untouched.
chrome.tabs.onCreated.addListener(async (tab) => {
  const url = tab.pendingUrl ?? tab.url;
  if (url !== NEWTAB_URL || !tab.id) return;

  const uiState = await getUiState();
  if (!uiState.showOnNewTab) return;

  chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("newtab/index.html") });
});
