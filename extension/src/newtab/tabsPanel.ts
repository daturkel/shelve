import { buildFaviconEl } from "../lib/favicon";
import type { AppContext } from "./context";

const TAB_MIME = "application/x-shelve-tab";

// ---------- Right panel: live open tabs ----------

export function buildTabsPanel(ctx: AppContext): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "tabs-panel" + (ctx.uiState.rightCollapsed ? " collapsed" : "");

  const header = document.createElement("div");
  header.className = "tabs-panel-header";
  header.textContent = "OPEN TABS";
  panel.appendChild(header);

  chrome.tabs.query({}).then((tabs) => {
    const byWindow = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of tabs) {
      const windowId = tab.windowId ?? 0;
      if (!byWindow.has(windowId)) byWindow.set(windowId, []);
      byWindow.get(windowId)!.push(tab);
    }

    let windowIndex = 1;
    for (const [, windowTabs] of byWindow) {
      const windowSection = document.createElement("div");
      windowSection.className = "tab-window";

      const windowTitle = document.createElement("div");
      windowTitle.className = "tab-window-title";
      windowTitle.textContent = `Window ${windowIndex++}`;
      windowSection.appendChild(windowTitle);

      for (const tab of windowTabs) {
        windowSection.appendChild(buildTabItem(tab));
      }

      panel.appendChild(windowSection);
    }
  });

  return panel;
}

function buildTabItem(tab: chrome.tabs.Tab): HTMLElement {
  const el = document.createElement("div");
  el.className = "tab-item";
  el.draggable = true;

  el.appendChild(buildFaviconEl(tab.favIconUrl));

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = tab.title || tab.url || "Untitled";
  el.appendChild(title);

  el.ondragstart = (ev) => {
    ev.dataTransfer?.setData(
      TAB_MIME,
      JSON.stringify({ url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl }),
    );
    ev.dataTransfer!.effectAllowed = "copy";
  };

  return el;
}
