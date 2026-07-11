import type { Folder, Entry } from "@shelve/shared";
import {
  type State,
  loadState,
  saveState,
  createWorkspace,
  renameWorkspace,
  createFolder,
  renameFolder,
  reorderFolders,
  deleteFolder,
  createEntry,
  moveEntry,
  deleteEntry,
} from "../lib/storage";
import { pushResource, pushDelete, pullAndMerge, pushAll } from "../lib/sync";
import { getUiState, setUiState } from "../lib/uiState";
import { showPrompt, showConfirm } from "../lib/modal";
import { fetchLinkMetadata } from "../lib/linkMetadata";

const TAB_MIME = "application/x-shelve-tab";
const ENTRY_MIME = "application/x-shelve-entry";
const FOLDER_MIME = "application/x-shelve-folder";

/** A real favicon, or a fixed-size placeholder — so entries/tabs without
 * one don't shift their title out of alignment with ones that have an
 * icon. */
function buildPlaceholderFavicon(): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "favicon favicon-placeholder";
  return placeholder;
}

function buildFaviconEl(url: string | null | undefined): HTMLElement {
  if (url) {
    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.src = url;
    // A manually-added link's favicon.ico guess (linkMetadata.ts) often
    // doesn't exist — swap to the same placeholder used for no-favicon
    // entries rather than showing a broken-image icon.
    icon.onerror = () => icon.replaceWith(buildPlaceholderFavicon());
    return icon;
  }
  return buildPlaceholderFavicon();
}

let state: State = await loadState();
const merged = await pullAndMerge(state);
if (merged) {
  state = merged;
  await saveState(state);
}
// Catches records created locally but never successfully synced — most
// notably the default "Home" workspace from first run.
void pushAll(state);

let uiState = await getUiState();

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

async function persistUiState() {
  await setUiState(uiState);
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

  const workspaces = state.workspaces
    .filter((ws) => ws.deleted_at === null)
    .sort((a, b) => a.position - b.position);

  for (const ws of workspaces) {
    const item = document.createElement("div");
    item.className = "rail-item" + (ws.id === activeWorkspaceId ? " active" : "");
    item.textContent = ws.name;
    item.title = "Double-click to rename";
    item.onclick = () => {
      activeWorkspaceId = ws.id;
      render();
    };
    item.ondblclick = async (ev) => {
      ev.stopPropagation();
      const name = await showPrompt("Rename workspace", ws.name);
      if (!name || name === ws.name) return;
      renameWorkspace(state, ws.id, name);
      await rerender();
      void pushResource("workspaces", ws);
    };
    rail.appendChild(item);
  }

  const addBtn = document.createElement("div");
  addBtn.className = "rail-add";
  addBtn.textContent = "+ New workspace";
  addBtn.onclick = async () => {
    const name = await showPrompt("New workspace");
    if (!name) return;
    const ws = createWorkspace(state, name);
    activeWorkspaceId = ws.id;
    await rerender();
    void pushResource("workspaces", ws);
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
    const name = await showPrompt("New folder");
    if (!name) return;
    const folder = createFolder(state, activeWorkspaceId, name);
    await rerender();
    void pushResource("folders", folder);
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

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "icon-btn";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Settings";
  settingsBtn.onclick = () => chrome.runtime.openOptionsPage();
  toolbar.appendChild(settingsBtn);

  return toolbar;
}

function buildFolders(): HTMLElement {
  const container = document.createElement("div");
  container.className = "folders";

  const folders = state.folders
    .filter((f) => f.workspace_id === activeWorkspaceId && f.deleted_at === null)
    .sort((a, b) => a.position - b.position);

  if (folders.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "No folders yet. Create one to start saving tabs, or drag a tab here.";

    // Dragging a tab in when there's nowhere to put it yet: prompt for a
    // folder name and create both the folder and the entry in one step,
    // instead of making the user go create a folder first and retry the
    // drag.
    hint.ondragover = (ev) => {
      if (ev.dataTransfer?.types.includes(TAB_MIME)) {
        ev.preventDefault();
        hint.classList.add("drag-over");
      }
    };
    hint.ondragleave = () => hint.classList.remove("drag-over");
    hint.ondrop = async (ev) => {
      ev.preventDefault();
      hint.classList.remove("drag-over");
      const tabData = ev.dataTransfer?.getData(TAB_MIME);
      if (!tabData) return;

      const name = await showPrompt("New folder");
      if (!name) return;
      const tab = JSON.parse(tabData) as { url: string; title: string; favIconUrl?: string };
      const folder = createFolder(state, activeWorkspaceId, name);
      const entry = createEntry(state, folder.id, {
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favIconUrl ?? null,
      });
      await rerender();
      void pushResource("folders", folder);
      void pushResource("entries", entry);
    };

    container.appendChild(hint);
    return container;
  }

  const query = searchQuery.trim().toLowerCase();

  for (const folder of folders) {
    container.appendChild(buildFolderSection(folder, query, folders));
  }

  return container;
}

function buildFolderSection(folder: Folder, query: string, workspaceFolders: Folder[]): HTMLElement {
  const collapsed = uiState.collapsedFolderIds.includes(folder.id);

  const section = document.createElement("div");
  section.className = "folder-section";

  const header = document.createElement("div");
  header.className = "folder-header";
  header.draggable = true;
  header.title = collapsed ? "Click to expand" : "Click to collapse";
  // The whole bar toggles collapse — not just the tiny chevron — so it's
  // not a precision-targeting exercise. name/del opt out via
  // stopPropagation so rename (dblclick) and delete still work normally.
  header.onclick = async () => {
    if (collapsed) {
      uiState.collapsedFolderIds = uiState.collapsedFolderIds.filter((id) => id !== folder.id);
    } else {
      uiState.collapsedFolderIds.push(folder.id);
    }
    await persistUiState();
    render();
  };

  const collapseToggle = document.createElement("div");
  collapseToggle.className = "collapse-toggle";
  collapseToggle.textContent = collapsed ? "▸" : "▾";
  header.appendChild(collapseToggle);

  const name = document.createElement("div");
  name.className = "folder-name";
  name.textContent = folder.name;
  name.title = "Double-click to rename";
  name.onclick = (ev) => ev.stopPropagation();
  name.ondblclick = async (ev) => {
    ev.stopPropagation();
    const newName = await showPrompt("Rename folder", folder.name);
    if (!newName || newName === folder.name) return;
    renameFolder(state, folder.id, newName);
    await rerender();
    void pushResource("folders", folder);
  };
  header.appendChild(name);

  // Positioned right after the name (not pushed to the far edge of the
  // bar) so revealing it on hover doesn't require crossing a long
  // invisible strip to reach it.
  const del = document.createElement("div");
  del.className = "folder-delete";
  del.textContent = "(delete)";
  // Without its own title, this inherits the header's "Click to
  // expand/collapse" tooltip (title attributes cascade to children that
  // don't set their own) — confusing since hovering delete looked like it
  // would toggle collapse instead.
  del.title = "Delete folder and its entries";
  del.onclick = async (ev) => {
    ev.stopPropagation();
    const ok = await showConfirm(`Delete folder "${folder.name}" and its entries?`);
    if (!ok) return;
    const { entries: cascadedEntries } = deleteFolder(state, folder.id);
    await rerender();
    void pushDelete("folders", folder.id);
    for (const entry of cascadedEntries) void pushDelete("entries", entry.id);
  };
  header.appendChild(del);

  // Folder reordering: drag one folder's header onto another's to reorder
  // within the workspace. Distinct MIME type from tab/entry drags, handled
  // only on the header (not the whole section) to keep it unambiguous.
  header.ondragstart = (ev) => {
    ev.stopPropagation();
    ev.dataTransfer?.setData(FOLDER_MIME, folder.id);
    ev.dataTransfer!.effectAllowed = "move";
  };
  header.ondragover = (ev) => {
    if (ev.dataTransfer?.types.includes(FOLDER_MIME)) {
      ev.preventDefault();
      ev.stopPropagation();
      header.classList.add("drag-over");
    }
  };
  header.ondragleave = () => header.classList.remove("drag-over");
  header.ondrop = async (ev) => {
    const draggedId = ev.dataTransfer?.getData(FOLDER_MIME);
    if (!draggedId) return;
    ev.preventDefault();
    ev.stopPropagation();
    header.classList.remove("drag-over");
    if (draggedId === folder.id) return;

    const orderedIds = workspaceFolders.map((f) => f.id).filter((id) => id !== draggedId);
    const targetIndex = orderedIds.indexOf(folder.id);
    orderedIds.splice(targetIndex, 0, draggedId);

    const changed = reorderFolders(state, activeWorkspaceId, orderedIds);
    await rerender();
    for (const f of changed) void pushResource("folders", f);
  };

  section.appendChild(header);

  if (!collapsed) {
    const grid = document.createElement("div");
    grid.className = "entry-grid";

    let entries = state.entries
      .filter((e) => e.folder_id === folder.id && e.deleted_at === null)
      .sort((a, b) => a.position - b.position);

    if (query) {
      entries = entries.filter((e) =>
        (e.title ?? e.url ?? e.note ?? "").toLowerCase().includes(query),
      );
    }

    for (const entry of entries) {
      grid.appendChild(buildEntryEl(entry));
    }

    if (!query) {
      grid.appendChild(buildAddLinkTile(folder));
    }

    section.appendChild(grid);
  }

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
      const entry = createEntry(state, folder.id, {
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favIconUrl ?? null,
      });
      await rerender();
      void pushResource("entries", entry);
      return;
    }

    const entryId = ev.dataTransfer?.getData(ENTRY_MIME);
    if (entryId) {
      moveEntry(state, entryId, folder.id);
      await rerender();
      const moved = state.entries.find((e) => e.id === entryId);
      if (moved) void pushResource("entries", moved);
    }
  };

  return section;
}

/** Small "+" tile for manually adding a link, for URLs you have but
 * aren't currently open as a tab (drag-from-open-tabs is the other way
 * to add an entry, but only covers what's already open). */
function buildAddLinkTile(folder: Folder): HTMLElement {
  const el = document.createElement("div");
  el.className = "entry entry-add-link";
  el.textContent = "+";
  el.title = "Add a link";
  el.onclick = async () => {
    const rawUrl = await showPrompt("Add link (URL)");
    if (!rawUrl) return;
    const url = normalizeUrl(rawUrl);
    const meta = await fetchLinkMetadata(url);
    // One Enter should be enough for the common case: if the fetch found
    // a real page title, use it directly rather than asking again with
    // it as the default. Only fall back to a second prompt when the
    // fetch didn't get a title (blocked, timed out, no <title> tag).
    const title = meta.title ?? (await showPrompt("Title", url));
    if (!title) return;
    const entry = createEntry(state, folder.id, { url, title, favicon_url: meta.faviconUrl });
    await rerender();
    void pushResource("entries", entry);
  };
  return el;
}

function normalizeUrl(input: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
}

function buildEntryEl(entry: Entry): HTMLElement {
  const el = document.createElement("div");
  el.className = "entry";
  el.draggable = true;

  // Note-only entries (no url) get a distinct glyph instead of the
  // generic favicon placeholder, so they read as "a note" at a glance
  // rather than looking like a URL entry that's merely missing its icon.
  // (Creating/editing notes via the UI is temporarily disabled — see
  // design doc — but existing note-only entries, e.g. from a native
  // backup import, still render correctly.)
  if (entry.url) {
    el.appendChild(buildFaviconEl(entry.favicon_url));
  } else {
    const noteIcon = document.createElement("div");
    noteIcon.className = "favicon note-icon";
    noteIcon.textContent = "▤";
    el.appendChild(noteIcon);
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
    void pushDelete("entries", entry.id);
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

render();
