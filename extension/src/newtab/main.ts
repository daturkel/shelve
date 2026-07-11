import type { Folder, Entry } from "@shelve/shared";
import {
  type State,
  loadState,
  saveState,
  createWorkspace,
  createFolder,
  deleteFolder,
  createEntry,
  moveEntry,
  deleteEntry,
} from "../lib/storage";

const TAB_MIME = "application/x-shelve-tab";
const ENTRY_MIME = "application/x-shelve-entry";

let state: State = await loadState();
let activeWorkspaceId: string = state.workspaces[0]?.id ?? "";
let leftCollapsed = false;
let rightCollapsed = false;
let searchQuery = "";

const app = document.getElementById("app")!;

async function persist() {
  await saveState(state);
}

async function rerender() {
  await persist();
  render();
}

function render() {
  app.replaceChildren(buildLayout());
}

function buildLayout(): HTMLElement {
  const layout = document.createElement("div");
  layout.className = "layout";
  layout.appendChild(buildRail());
  layout.appendChild(buildMain());
  layout.appendChild(buildTabsPanel());
  return layout;
}

// ---------- Left rail: workspace switcher ----------

function buildRail(): HTMLElement {
  const rail = document.createElement("div");
  rail.className = "rail" + (leftCollapsed ? " collapsed" : "");

  for (const ws of [...state.workspaces].sort((a, b) => a.position - b.position)) {
    const item = document.createElement("div");
    item.className = "rail-item" + (ws.id === activeWorkspaceId ? " active" : "");
    item.textContent = ws.name;
    item.onclick = () => {
      activeWorkspaceId = ws.id;
      render();
    };
    rail.appendChild(item);
  }

  const addBtn = document.createElement("div");
  addBtn.className = "rail-add";
  addBtn.textContent = "+ New workspace";
  addBtn.onclick = async () => {
    const name = prompt("Workspace name?");
    if (!name) return;
    const ws = createWorkspace(state, name);
    activeWorkspaceId = ws.id;
    await rerender();
  };
  rail.appendChild(addBtn);

  return rail;
}

// ---------- Main: toolbar + folders ----------

function buildMain(): HTMLElement {
  const main = document.createElement("div");
  main.className = "main";
  main.appendChild(buildToolbar());
  main.appendChild(buildFolders());
  return main;
}

function buildToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const railToggle = document.createElement("button");
  railToggle.className = "icon-btn";
  railToggle.textContent = "☰";
  railToggle.title = "Toggle workspaces";
  railToggle.onclick = () => {
    leftCollapsed = !leftCollapsed;
    render();
  };
  toolbar.appendChild(railToggle);

  const search = document.createElement("input");
  search.className = "search-input";
  search.type = "text";
  search.placeholder = "Search...";
  search.value = searchQuery;
  search.oninput = () => {
    searchQuery = search.value;
    render();
    search.focus();
  };
  toolbar.appendChild(search);

  const newFolderBtn = document.createElement("button");
  newFolderBtn.className = "new-folder-btn";
  newFolderBtn.textContent = "+ New Folder";
  newFolderBtn.onclick = async () => {
    const name = prompt("Folder name?");
    if (!name) return;
    createFolder(state, activeWorkspaceId, name);
    await rerender();
  };
  toolbar.appendChild(newFolderBtn);

  const tabsToggle = document.createElement("button");
  tabsToggle.className = "icon-btn";
  tabsToggle.textContent = "⧉";
  tabsToggle.title = "Toggle open tabs";
  tabsToggle.onclick = () => {
    rightCollapsed = !rightCollapsed;
    render();
  };
  toolbar.appendChild(tabsToggle);

  return toolbar;
}

function buildFolders(): HTMLElement {
  const container = document.createElement("div");
  container.className = "folders";

  const folders = state.folders
    .filter((f) => f.workspace_id === activeWorkspaceId)
    .sort((a, b) => a.position - b.position);

  if (folders.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "No folders yet. Create one to start saving tabs.";
    container.appendChild(hint);
    return container;
  }

  const query = searchQuery.trim().toLowerCase();

  for (const folder of folders) {
    container.appendChild(buildFolderSection(folder, query));
  }

  return container;
}

function buildFolderSection(folder: Folder, query: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "folder-section";

  const header = document.createElement("div");
  header.className = "folder-header";

  const name = document.createElement("div");
  name.className = "folder-name";
  name.textContent = folder.name;
  header.appendChild(name);

  const del = document.createElement("div");
  del.className = "folder-delete";
  del.textContent = "Delete";
  del.onclick = async () => {
    if (!confirm(`Delete folder "${folder.name}" and its entries?`)) return;
    deleteFolder(state, folder.id);
    await rerender();
  };
  header.appendChild(del);

  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "entry-grid";

  let entries = state.entries
    .filter((e) => e.folder_id === folder.id)
    .sort((a, b) => a.position - b.position);

  if (query) {
    entries = entries.filter((e) => (e.title ?? e.url ?? e.note ?? "").toLowerCase().includes(query));
  }

  for (const entry of entries) {
    grid.appendChild(buildEntryEl(entry));
  }

  section.appendChild(grid);

  section.ondragover = (ev) => {
    if (ev.dataTransfer?.types.includes(TAB_MIME) || ev.dataTransfer?.types.includes(ENTRY_MIME)) {
      ev.preventDefault();
      section.classList.add("drag-over");
    }
  };
  section.ondragleave = () => section.classList.remove("drag-over");
  section.ondrop = async (ev) => {
    ev.preventDefault();
    section.classList.remove("drag-over");

    const tabData = ev.dataTransfer?.getData(TAB_MIME);
    if (tabData) {
      const tab = JSON.parse(tabData) as { url: string; title: string; favIconUrl?: string };
      createEntry(state, folder.id, {
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favIconUrl ?? null,
      });
      await rerender();
      return;
    }

    const entryId = ev.dataTransfer?.getData(ENTRY_MIME);
    if (entryId) {
      moveEntry(state, entryId, folder.id);
      await rerender();
    }
  };

  return section;
}

function buildEntryEl(entry: Entry): HTMLElement {
  const el = document.createElement("div");
  el.className = "entry";
  el.draggable = true;

  if (entry.favicon_url) {
    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.src = entry.favicon_url;
    el.appendChild(icon);
  }

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = entry.title || entry.url || entry.note || "Untitled";
  el.appendChild(title);

  const del = document.createElement("div");
  del.className = "entry-delete";
  del.textContent = "✕";
  del.onclick = async (ev) => {
    ev.stopPropagation();
    deleteEntry(state, entry.id);
    await rerender();
  };
  el.appendChild(del);

  el.onclick = (ev) => {
    if (ev.target === del) return;
    if (entry.url) window.open(entry.url, "_blank");
  };

  el.ondragstart = (ev) => {
    ev.dataTransfer?.setData(ENTRY_MIME, entry.id);
    ev.dataTransfer!.effectAllowed = "move";
  };

  return el;
}

// ---------- Right panel: live open tabs ----------

function buildTabsPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "tabs-panel" + (rightCollapsed ? " collapsed" : "");

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

  if (tab.favIconUrl) {
    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.src = tab.favIconUrl;
    el.appendChild(icon);
  }

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

render();
