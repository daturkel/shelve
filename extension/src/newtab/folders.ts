import type { Folder, Entry } from "@shelve/shared";
import {
  createEntry,
  renameFolder,
  reorderFolders,
  deleteFolder,
  moveEntryToPosition,
  deleteEntry,
  updateEntryTitle,
} from "../lib/storage";
import { pushResource, pushDelete } from "../lib/sync";
import { showPrompt, showConfirm } from "../lib/modal";
import { fetchLinkMetadata } from "../lib/linkMetadata";
import { buildFaviconEl } from "../lib/favicon";
import { createFolderInteractive } from "../lib/actions";
import { normalizeUrl } from "../lib/url";
import { showFolderPickerModal } from "./folderPicker";
import type { AppContext } from "./context";

const TAB_MIME = "application/x-shelve-tab";
const ENTRY_MIME = "application/x-shelve-entry";
const FOLDER_MIME = "application/x-shelve-folder";

interface DraggedTab {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
}

/** Shared by both TAB_MIME drop targets below. The payload is always a
 * JSON array (tabsPanel.ts sends a one-element array for a single-tab
 * drag too), so there's one code path regardless of how many tabs were
 * dragged in. */
async function createEntriesFromDraggedTabs(ctx: AppContext, folder: Folder, tabData: string): Promise<void> {
  const tabs = JSON.parse(tabData) as DraggedTab[];
  const created = tabs.map((tab) =>
    createEntry(ctx.state, folder.id, {
      url: tab.url,
      title: tab.title,
      favicon_url: tab.favIconUrl ?? null,
    }),
  );
  await ctx.rerender();
  for (const entry of created) void pushResource("entries", entry);

  if (ctx.uiState.closeTabOnSave) {
    void chrome.tabs.remove(tabs.map((tab) => tab.id));
  }
}

/** Shared by both ENTRY_MIME drop targets below. `entryIds` lands
 * consecutively starting at `targetIndex`, preserving their relative
 * order — moveEntryToPosition re-reads state.entries fresh on every
 * call, so passing the same very-large targetIndex for every id (the
 * "append to the end" fallback drop) still works correctly: each one
 * clamps to whatever the current end is, which grows by one after each
 * previous entry in the loop has already landed there. */
async function moveEntriesToPosition(
  ctx: AppContext,
  folder: Folder,
  entryIds: string[],
  targetIndex: number,
): Promise<void> {
  const allChanged: Entry[] = [];
  entryIds.forEach((id, i) => {
    allChanged.push(...moveEntryToPosition(ctx.state, id, folder.id, targetIndex + i));
  });
  await ctx.rerender();
  for (const e of allChanged) void pushResource("entries", e);
  for (const id of entryIds) ctx.selectedEntryIds.delete(id);
}

// ---------- Main: folder list ----------

export function buildFolders(ctx: AppContext): HTMLElement {
  const container = document.createElement("div");
  container.className = "folders";

  const folders = ctx.state.folders
    .filter((f) => f.workspace_id === ctx.activeWorkspaceId && f.deleted_at === null)
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

      const folder = await createFolderInteractive(ctx.state, ctx.activeWorkspaceId);
      if (!folder) return;
      await createEntriesFromDraggedTabs(ctx, folder, tabData);
    };

    container.appendChild(hint);
    return container;
  }

  const query = ctx.searchQuery.trim().toLowerCase();

  for (const folder of folders) {
    container.appendChild(buildFolderSection(ctx, folder, query));
  }

  setUpFolderReordering(ctx, container, folders);

  if (ctx.selectedEntryIds.size > 0) {
    container.appendChild(buildEntrySelectionBar(ctx));
  }

  return container;
}

// ---------- Multi-select action bar (Open tabs / Move / Delete) ----------

function buildEntrySelectionBar(ctx: AppContext): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "entry-selection-bar";

  const count = document.createElement("div");
  count.className = "entry-selection-count";
  count.textContent = `${ctx.selectedEntryIds.size} selected`;
  bar.appendChild(count);

  const actions = document.createElement("div");
  actions.className = "entry-selection-actions";

  const openBtn = document.createElement("button");
  openBtn.className = "entry-selection-btn";
  openBtn.textContent = "Open tabs";
  openBtn.onclick = () => {
    const selected = ctx.state.entries.filter((e) => ctx.selectedEntryIds.has(e.id) && e.url);
    for (const e of selected) void chrome.tabs.create({ url: e.url!, active: false });
    ctx.selectedEntryIds.clear();
    ctx.render();
  };
  actions.appendChild(openBtn);

  const moveBtn = document.createElement("button");
  moveBtn.className = "entry-selection-btn";
  moveBtn.textContent = "Move";
  moveBtn.onclick = () => {
    const n = ctx.selectedEntryIds.size;
    showFolderPickerModal(ctx, `Move ${n} link${n === 1 ? "" : "s"} to…`, (folder) =>
      moveEntriesToPosition(ctx, folder, Array.from(ctx.selectedEntryIds), Number.MAX_SAFE_INTEGER),
    );
  };
  actions.appendChild(moveBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "entry-selection-btn entry-selection-btn-danger";
  deleteBtn.textContent = "Delete";
  deleteBtn.onclick = async () => {
    const ids = Array.from(ctx.selectedEntryIds);
    const ok = await showConfirm(`Delete ${ids.length} link${ids.length === 1 ? "" : "s"}?`);
    if (!ok) return;
    for (const id of ids) deleteEntry(ctx.state, id);
    ctx.selectedEntryIds.clear();
    await ctx.rerender();
    for (const id of ids) void pushDelete("entries", id);
  };
  actions.appendChild(deleteBtn);

  const clearBtn = document.createElement("button");
  clearBtn.className = "entry-selection-clear";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear selection";
  clearBtn.onclick = () => {
    ctx.selectedEntryIds.clear();
    ctx.render();
  };
  actions.appendChild(clearBtn);

  bar.appendChild(actions);
  return bar;
}

// Folder reordering: drag one folder's header onto the list to reorder
// within the workspace. Handled once at the container level rather than
// per-header — there's no meaningful difference in the UI between
// "after folder #2" and "before folder #3", so this tracks a single
// insertion line that snaps to whichever folder boundary is closest to
// the cursor, rather than highlighting whichever whole folder happens to
// be underneath it.
function setUpFolderReordering(ctx: AppContext, container: HTMLElement, workspaceFolders: Folder[]): void {
  const indicator = document.createElement("div");
  indicator.className = "folder-drop-indicator";

  function closestBoundary(ev: DragEvent): HTMLElement | null {
    const sections = Array.from(container.querySelectorAll<HTMLElement>(".folder-section"));
    return (
      sections.find((section) => {
        const rect = section.getBoundingClientRect();
        return ev.clientY < rect.top + rect.height / 2;
      }) ?? null
    );
  }

  container.ondragover = (ev) => {
    if (!ev.dataTransfer?.types.includes(FOLDER_MIME)) return;
    ev.preventDefault();
    container.insertBefore(indicator, closestBoundary(ev));
  };
  container.ondragleave = (ev) => {
    if (!container.contains(ev.relatedTarget as Node | null)) indicator.remove();
  };
  container.ondrop = async (ev) => {
    const draggedId = ev.dataTransfer?.getData(FOLDER_MIME);
    const target = closestBoundary(ev);
    indicator.remove();
    if (!draggedId) return;
    ev.preventDefault();
    if (draggedId === target?.dataset.folderId) return;

    const orderedIds = workspaceFolders.map((f) => f.id).filter((id) => id !== draggedId);
    const targetIndex = target ? orderedIds.indexOf(target.dataset.folderId!) : orderedIds.length;
    orderedIds.splice(targetIndex, 0, draggedId);

    const changed = reorderFolders(ctx.state, ctx.activeWorkspaceId, orderedIds);
    await ctx.rerender();
    for (const f of changed) void pushResource("folders", f);
  };
}

function buildFolderSection(ctx: AppContext, folder: Folder, query: string): HTMLElement {
  const collapsed = ctx.uiState.collapsedFolderIds.includes(folder.id);

  const section = document.createElement("div");
  section.className = "folder-section";
  section.dataset.folderId = folder.id;

  const header = document.createElement("div");
  header.className = "folder-header";
  header.draggable = true;
  header.title = collapsed ? "Click to expand" : "Click to collapse";
  // The whole bar toggles collapse — not just the tiny chevron — so it's
  // not a precision-targeting exercise. name/del opt out via
  // stopPropagation so rename (dblclick) and delete still work normally.
  header.onclick = async () => {
    if (collapsed) {
      ctx.uiState.collapsedFolderIds = ctx.uiState.collapsedFolderIds.filter((id) => id !== folder.id);
    } else {
      ctx.uiState.collapsedFolderIds.push(folder.id);
    }
    await ctx.persistUiState();
    ctx.render();
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
  const renameFolderInteractive = async () => {
    const newName = await showPrompt("Rename folder", folder.name);
    if (!newName || newName === folder.name) return;
    renameFolder(ctx.state, folder.id, newName);
    await ctx.rerender();
    void pushResource("folders", folder);
  };
  name.ondblclick = async (ev) => {
    ev.stopPropagation();
    await renameFolderInteractive();
  };
  header.appendChild(name);

  // Positioned right after the name (not pushed to the far edge of the
  // bar) so revealing it on hover doesn't require crossing a long
  // invisible strip to reach it.
  const edit = document.createElement("div");
  edit.className = "folder-edit";
  edit.textContent = "✎";
  edit.title = "Rename folder";
  edit.onclick = async (ev) => {
    ev.stopPropagation();
    await renameFolderInteractive();
  };
  header.appendChild(edit);

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
    const { entries: cascadedEntries } = deleteFolder(ctx.state, folder.id);
    await ctx.rerender();
    void pushDelete("folders", folder.id);
    for (const entry of cascadedEntries) void pushDelete("entries", entry.id);
  };
  header.appendChild(del);

  // Folder reordering: drag one folder's header to start the drag; the
  // container-level handler in setUpFolderReordering tracks the drop
  // target and insertion line.
  header.ondragstart = (ev) => {
    ev.stopPropagation();
    ev.dataTransfer?.setData(FOLDER_MIME, folder.id);
    ev.dataTransfer!.effectAllowed = "move";
  };

  section.appendChild(header);

  if (!collapsed) {
    const grid = document.createElement("div");
    grid.className = "entry-grid";

    let entries = ctx.state.entries
      .filter((e) => e.folder_id === folder.id && e.deleted_at === null)
      .sort((a, b) => a.position - b.position);

    if (query) {
      // Matches across all three fields, not just whichever one the
      // display fallback (title || url || note) happens to pick — an
      // entry with a title set was previously unsearchable by its URL.
      entries = entries.filter((e) => [e.title, e.url, e.note].some((field) => field?.toLowerCase().includes(query)));
    }

    for (const entry of entries) {
      grid.appendChild(buildEntryEl(ctx, entry));
    }

    if (!query) {
      grid.appendChild(buildAddLinkTile(ctx, folder));
      // Precise drag-to-reorder needs the full, unfiltered set of
      // entries to compute positions against — disabled while a search
      // query narrows what's actually shown.
      setUpEntryReordering(ctx, grid, folder);
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
      await createEntriesFromDraggedTabs(ctx, folder, tabData);
      return;
    }

    // Fallback for when there's no visible grid to drop onto precisely
    // (folder collapsed, or search filtering it out) — appends at the
    // end. When the grid is visible, setUpEntryReordering's own drop
    // handler on the grid handles this instead, with stopPropagation so
    // this doesn't also fire.
    const entryData = ev.dataTransfer?.getData(ENTRY_MIME);
    if (entryData) {
      const entryIds = JSON.parse(entryData) as string[];
      await moveEntriesToPosition(ctx, folder, entryIds, Number.MAX_SAFE_INTEGER);
    }
  };

  return section;
}

// Entry reordering within (or into, at a precise spot) a folder's grid.
// Unlike the single-column folder list, entries wrap into rows/columns,
// so "nearest boundary" is 2D: the closest tile's center decides the
// row, and cursor.x relative to that tile's center decides before/after.
// The indicator is absolutely positioned rather than inserted as a real
// grid item, since a real item would claim a full 180px+ column track
// (per .entry-grid's minmax sizing) and shove every later tile aside.
function setUpEntryReordering(ctx: AppContext, grid: HTMLElement, folder: Folder): void {
  const indicator = document.createElement("div");
  indicator.className = "entry-drop-indicator";

  function closestTile(ev: DragEvent): { el: HTMLElement; side: "before" | "after" } | null {
    const tiles = Array.from(grid.querySelectorAll<HTMLElement>(".entry:not(.entry-add-link)"));
    let best: HTMLElement | null = null;
    let bestSide: "before" | "after" = "before";
    let bestDist = Infinity;
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = tile;
        bestSide = ev.clientX < cx ? "before" : "after";
      }
    }
    return best ? { el: best, side: bestSide } : null;
  }

  function showIndicator(target: { el: HTMLElement; side: "before" | "after" } | null): void {
    if (!target) {
      indicator.remove();
      return;
    }
    const gridRect = grid.getBoundingClientRect();
    const rect = target.el.getBoundingClientRect();
    const edge = target.side === "before" ? rect.left : rect.right;
    indicator.style.top = `${rect.top - gridRect.top}px`;
    indicator.style.height = `${rect.height}px`;
    indicator.style.left = `${edge - gridRect.left - 1}px`;
    grid.appendChild(indicator);
  }

  grid.ondragover = (ev) => {
    if (!ev.dataTransfer?.types.includes(ENTRY_MIME)) return;
    ev.preventDefault();
    ev.stopPropagation();
    showIndicator(closestTile(ev));
  };
  grid.ondragleave = (ev) => {
    if (!grid.contains(ev.relatedTarget as Node | null)) indicator.remove();
  };
  grid.ondrop = async (ev) => {
    const entryData = ev.dataTransfer?.getData(ENTRY_MIME);
    const target = closestTile(ev);
    indicator.remove();
    if (!entryData) return;
    ev.preventDefault();
    ev.stopPropagation();
    const entryIds = JSON.parse(entryData) as string[];
    // The closest tile can be one of the dragged entries' own — e.g.
    // dropping (part of) a selection right back where it started.
    // siblingIds below excludes every dragged id, so an unguarded lookup
    // would come back -1 and (after clamping) send it to the very front
    // instead of leaving it where it was.
    if (target && entryIds.includes(target.el.dataset.entryId!)) return;

    const siblingIds = Array.from(grid.querySelectorAll<HTMLElement>(".entry:not(.entry-add-link)"))
      .map((el) => el.dataset.entryId!)
      .filter((id) => !entryIds.includes(id));
    let targetIndex = siblingIds.length;
    if (target) {
      const idx = siblingIds.indexOf(target.el.dataset.entryId!);
      targetIndex = target.side === "after" ? idx + 1 : idx;
    }

    await moveEntriesToPosition(ctx, folder, entryIds, targetIndex);
  };
}

/** Small "+" tile for manually adding a link, for URLs you have but
 * aren't currently open as a tab (drag-from-open-tabs is the other way
 * to add an entry, but only covers what's already open). */
function buildAddLinkTile(ctx: AppContext, folder: Folder): HTMLElement {
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
    const entry = createEntry(ctx.state, folder.id, { url, title, favicon_url: meta.faviconUrl });
    await ctx.rerender();
    void pushResource("entries", entry);
  };
  return el;
}

function buildEntryEl(ctx: AppContext, entry: Entry): HTMLElement {
  const selected = ctx.selectedEntryIds.has(entry.id);

  const el = document.createElement("div");
  el.className = "entry" + (selected ? " selected" : "");
  el.draggable = true;
  el.dataset.entryId = entry.id;

  // Checkbox and favicon share one slot rather than each reserving their
  // own column, same as the open-tabs panel's .tab-icon-slot — swaps in
  // over the favicon on hover/selected (CSS) instead of leaving a
  // permanent gap next to every entry.
  const iconSlot = document.createElement("div");
  iconSlot.className = "entry-icon-slot";

  // Note-only entries (no url) get a distinct glyph instead of the
  // generic favicon placeholder, so they read as "a note" at a glance
  // rather than looking like a URL entry that's merely missing its icon.
  // (Creating/editing notes via the UI is temporarily disabled — see
  // design doc — but existing note-only entries, e.g. from a native
  // backup import, still render correctly.)
  if (entry.url) {
    iconSlot.appendChild(buildFaviconEl(entry.favicon_url));
  } else {
    const noteIcon = document.createElement("div");
    noteIcon.className = "favicon note-icon";
    noteIcon.textContent = "▤";
    iconSlot.appendChild(noteIcon);
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "entry-checkbox";
  checkbox.checked = selected;
  checkbox.onclick = (ev) => {
    ev.stopPropagation();
    if (checkbox.checked) ctx.selectedEntryIds.add(entry.id);
    else ctx.selectedEntryIds.delete(entry.id);
    ctx.render();
  };
  iconSlot.appendChild(checkbox);

  el.appendChild(iconSlot);

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = entry.title || entry.url || entry.note || "Untitled";
  el.appendChild(title);

  const edit = document.createElement("div");
  edit.className = "entry-edit";
  edit.textContent = "✎";
  edit.title = "Rename";
  edit.onclick = async (ev) => {
    ev.stopPropagation();
    const newTitle = await showPrompt("Rename", entry.title || entry.url || entry.note || "");
    if (!newTitle || newTitle === entry.title) return;
    updateEntryTitle(ctx.state, entry.id, newTitle);
    await ctx.rerender();
    void pushResource("entries", entry);
  };
  el.appendChild(edit);

  const del = document.createElement("div");
  del.className = "entry-delete";
  del.textContent = "✕";
  del.onclick = async (ev) => {
    ev.stopPropagation();
    deleteEntry(ctx.state, entry.id);
    ctx.selectedEntryIds.delete(entry.id);
    await ctx.rerender();
    void pushDelete("entries", entry.id);
  };
  el.appendChild(del);

  // chrome.tabs.create rather than window.open: the latter has no way to
  // open a tab without also focusing it, so Cmd/Ctrl-click (and
  // middle-click, which never fires a plain "click" — only "auxclick",
  // per spec) couldn't otherwise open in the background the way a normal
  // link does.
  el.onclick = (ev) => {
    if (ev.target === del || ev.target === edit || ev.target === checkbox) return;
    if (entry.url) void chrome.tabs.create({ url: entry.url, active: !(ev.metaKey || ev.ctrlKey) });
  };
  el.onauxclick = (ev) => {
    if (ev.button !== 1 || ev.target === del || ev.target === edit || ev.target === checkbox) return;
    if (entry.url) void chrome.tabs.create({ url: entry.url, active: false });
  };

  // A multi-select drag (this entry is part of a selection of more than
  // one) carries every selected entry's id, same array-payload approach
  // as the tabs panel's multi-drag — the single-entry case is just a
  // one-element array, so drop handlers have one code path either way.
  el.ondragstart = (ev) => {
    const draggedIds = selected && ctx.selectedEntryIds.size > 1 ? Array.from(ctx.selectedEntryIds) : [entry.id];
    ev.dataTransfer?.setData(ENTRY_MIME, JSON.stringify(draggedIds));
    ev.dataTransfer!.effectAllowed = "move";

    // Otherwise the browser's default drag image is just this one tile,
    // giving no hint that dragging it is actually about to bring several
    // links along — same technique as the tabs panel's multi-drag badge.
    if (draggedIds.length > 1) {
      const badge = document.createElement("div");
      badge.className = "tab-drag-badge";
      badge.textContent = `${draggedIds.length} links`;
      document.body.appendChild(badge);
      ev.dataTransfer?.setDragImage(badge, 16, 16);
      setTimeout(() => badge.remove(), 0);
    }
  };

  return el;
}
