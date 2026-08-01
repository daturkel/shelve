import { createFolderInteractive } from "../lib/actions";
import { getSyncStatus } from "../lib/sync";
import { formatRelativeTime } from "../lib/time";
import type { AppContext } from "./context";

// ---------- Toolbar: search, new folder, panel toggles ----------

export function buildToolbar(ctx: AppContext): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const railToggle = document.createElement("button");
  // The extra class is a no-op everywhere except web's mobile drawer layout
  // (see web/src/style.css) — it floats the toggle above the open drawer so
  // it's always reachable to close it, without needing the rest of the
  // toolbar to sit above (and visually cover) the drawer's own content.
  railToggle.className = "icon-btn" + (ctx.uiState.leftCollapsed ? "" : " icon-btn-rail-open");
  railToggle.textContent = "☰";
  railToggle.title = "Toggle workspaces";
  railToggle.setAttribute("aria-label", "Toggle workspaces");
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
    // ctx.render() tears down and rebuilds the whole app (including this
    // very input), so `search` is now a detached element — focusing it
    // is a no-op for the live page. Query the fresh one render() just
    // created instead, and restore the cursor to where typing left it
    // rather than letting a freshly-created input default to position 0.
    const fresh = document.querySelector<HTMLInputElement>(".search-input");
    fresh?.focus();
    fresh?.setSelectionRange(fresh.value.length, fresh.value.length);
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
  syncDot.setAttribute("role", "status");
  const syncStatusText =
    status === "unconfigured"
      ? "Sync not configured — see Settings"
      : status === "connected"
        ? `Synced${lastSyncedAt ? ` — last synced ${formatRelativeTime(lastSyncedAt)}` : ""}`
        : `Sync error${lastSyncedAt ? ` — last synced ${formatRelativeTime(lastSyncedAt)}` : " — never synced"}`;
  syncDot.title = syncStatusText;
  syncDot.setAttribute("aria-label", syncStatusText);
  toolbar.appendChild(syncDot);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "icon-btn";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Settings";
  settingsBtn.setAttribute("aria-label", "Settings");
  settingsBtn.onclick = () => ctx.openSettings();
  toolbar.appendChild(settingsBtn);

  const tabsToggle = document.createElement("button");
  tabsToggle.className = "icon-btn";
  tabsToggle.textContent = "⧉";
  tabsToggle.title = "Toggle open tabs";
  tabsToggle.setAttribute("aria-label", "Toggle open tabs");
  tabsToggle.onclick = async () => {
    ctx.uiState.rightCollapsed = !ctx.uiState.rightCollapsed;
    await ctx.persistUiState();
    ctx.render();
  };
  toolbar.appendChild(tabsToggle);

  return toolbar;
}
