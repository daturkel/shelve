import { createFolderInteractive } from "../lib/actions";
import { getSyncStatus } from "../lib/sync";
import type { AppContext } from "./context";

// ---------- Toolbar: search, new folder, panel toggles ----------

function formatRelativeTime(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function buildToolbar(ctx: AppContext): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const railToggle = document.createElement("button");
  railToggle.className = "icon-btn";
  railToggle.textContent = "☰";
  railToggle.title = "Toggle workspaces";
  railToggle.onclick = async () => {
    ctx.uiState.leftCollapsed = !ctx.uiState.leftCollapsed;
    await ctx.persistUiState();
    ctx.render();
  };
  toolbar.appendChild(railToggle);

  const search = document.createElement("input");
  search.className = "search-input";
  search.type = "text";
  search.placeholder = "Search...";
  search.value = ctx.searchQuery;
  search.oninput = () => {
    ctx.searchQuery = search.value;
    ctx.render();
    search.focus();
  };
  // Re-rendering with an empty query already drops focus naturally (the
  // whole toolbar, including this input, gets torn down and rebuilt) —
  // no explicit .blur() needed.
  search.onkeydown = (ev) => {
    if (ev.key !== "Escape") return;
    ctx.searchQuery = "";
    ctx.render();
  };
  toolbar.appendChild(search);

  const newFolderBtn = document.createElement("button");
  newFolderBtn.className = "new-folder-btn";
  newFolderBtn.textContent = "+ New Folder";
  newFolderBtn.onclick = async () => {
    const folder = await createFolderInteractive(ctx.state, ctx.activeWorkspaceId);
    if (!folder) return;
    await ctx.rerender();
  };
  toolbar.appendChild(newFolderBtn);

  const { status, lastSyncedAt } = getSyncStatus();
  const syncDot = document.createElement("div");
  syncDot.className = `sync-status sync-status-${status}`;
  syncDot.title =
    status === "unconfigured"
      ? "Sync not configured — see Settings"
      : status === "connected"
        ? `Synced${lastSyncedAt ? ` — last synced ${formatRelativeTime(lastSyncedAt)}` : ""}`
        : `Sync error${lastSyncedAt ? ` — last synced ${formatRelativeTime(lastSyncedAt)}` : " — never synced"}`;
  toolbar.appendChild(syncDot);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "icon-btn";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Settings";
  settingsBtn.onclick = () => chrome.runtime.openOptionsPage();
  toolbar.appendChild(settingsBtn);

  const tabsToggle = document.createElement("button");
  tabsToggle.className = "icon-btn";
  tabsToggle.textContent = "⧉";
  tabsToggle.title = "Toggle open tabs";
  tabsToggle.onclick = async () => {
    ctx.uiState.rightCollapsed = !ctx.uiState.rightCollapsed;
    await ctx.persistUiState();
    ctx.render();
  };
  toolbar.appendChild(tabsToggle);

  return toolbar;
}
