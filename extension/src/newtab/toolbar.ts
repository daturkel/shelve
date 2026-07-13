import { createFolderInteractive } from "../lib/actions";
import type { AppContext } from "./context";

// ---------- Toolbar: search, new folder, panel toggles ----------

export function buildToolbar(ctx: AppContext): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const railToggle = document.createElement("button");
  railToggle.className = "icon-btn";
  railToggle.textContent = "☰";
  railToggle.title = "Toggle workspaces";
  railToggle.onclick = () => {
    ctx.leftCollapsed = !ctx.leftCollapsed;
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

  const tabsToggle = document.createElement("button");
  tabsToggle.className = "icon-btn";
  tabsToggle.textContent = "⧉";
  tabsToggle.title = "Toggle open tabs";
  tabsToggle.onclick = () => {
    ctx.rightCollapsed = !ctx.rightCollapsed;
    ctx.render();
  };
  toolbar.appendChild(tabsToggle);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "icon-btn";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Settings";
  settingsBtn.onclick = () => chrome.runtime.openOptionsPage();
  toolbar.appendChild(settingsBtn);

  return toolbar;
}
