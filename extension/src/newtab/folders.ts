import type { Folder, Entry } from "@shelve/shared";
import {
  createEntry,
  renameFolder,
  reorderFolders,
  deleteFolder,
  moveEntry,
  deleteEntry,
  updateEntryTitle,
} from "../lib/storage";
import { pushResource, pushDelete } from "../lib/sync";
import { showPrompt, showConfirm } from "../lib/modal";
import { fetchLinkMetadata } from "../lib/linkMetadata";
import { buildFaviconEl } from "../lib/favicon";
import { createFolderInteractive } from "../lib/actions";
import type { AppContext } from "./context";

const TAB_MIME = "application/x-shelve-tab";
const ENTRY_MIME = "application/x-shelve-entry";
const FOLDER_MIME = "application/x-shelve-folder";

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
      const tab = JSON.parse(tabData) as { url: string; title: string; favIconUrl?: string };
      const entry = createEntry(ctx.state, folder.id, {
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favIconUrl ?? null,
      });
      await ctx.rerender();
      void pushResource("entries", entry);
    };

    container.appendChild(hint);
    return container;
  }

  const query = ctx.searchQuery.trim().toLowerCase();

  for (const folder of folders) {
    container.appendChild(buildFolderSection(ctx, folder, query, folders));
  }

  return container;
}

function buildFolderSection(
  ctx: AppContext,
  folder: Folder,
  query: string,
  workspaceFolders: Folder[],
): HTMLElement {
  const collapsed = ctx.uiState.collapsedFolderIds.includes(folder.id);

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
  name.ondblclick = async (ev) => {
    ev.stopPropagation();
    const newName = await showPrompt("Rename folder", folder.name);
    if (!newName || newName === folder.name) return;
    renameFolder(ctx.state, folder.id, newName);
    await ctx.rerender();
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
    const { entries: cascadedEntries } = deleteFolder(ctx.state, folder.id);
    await ctx.rerender();
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

    const changed = reorderFolders(ctx.state, ctx.activeWorkspaceId, orderedIds);
    await ctx.rerender();
    for (const f of changed) void pushResource("folders", f);
  };

  section.appendChild(header);

  if (!collapsed) {
    const grid = document.createElement("div");
    grid.className = "entry-grid";

    let entries = ctx.state.entries
      .filter((e) => e.folder_id === folder.id && e.deleted_at === null)
      .sort((a, b) => a.position - b.position);

    if (query) {
      entries = entries.filter((e) =>
        (e.title || e.url || e.note || "").toLowerCase().includes(query),
      );
    }

    for (const entry of entries) {
      grid.appendChild(buildEntryEl(ctx, entry));
    }

    if (!query) {
      grid.appendChild(buildAddLinkTile(ctx, folder));
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
      const entry = createEntry(ctx.state, folder.id, {
        url: tab.url,
        title: tab.title,
        favicon_url: tab.favIconUrl ?? null,
      });
      await ctx.rerender();
      void pushResource("entries", entry);
      return;
    }

    const entryId = ev.dataTransfer?.getData(ENTRY_MIME);
    if (entryId) {
      moveEntry(ctx.state, entryId, folder.id);
      await ctx.rerender();
      const moved = ctx.state.entries.find((e) => e.id === entryId);
      if (moved) void pushResource("entries", moved);
    }
  };

  return section;
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

function normalizeUrl(input: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
}

function buildEntryEl(ctx: AppContext, entry: Entry): HTMLElement {
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
    await ctx.rerender();
    void pushDelete("entries", entry.id);
  };
  el.appendChild(del);

  el.onclick = (ev) => {
    if (ev.target === del || ev.target === edit) return;
    if (entry.url) window.open(entry.url, "_blank");
  };

  el.ondragstart = (ev) => {
    ev.dataTransfer?.setData(ENTRY_MIME, entry.id);
    ev.dataTransfer!.effectAllowed = "move";
  };

  return el;
}
