import type { Workspace, Folder, Entry } from "@shelve/shared";
import { getStore } from "./store";

export interface State {
  workspaces: Workspace[];
  folders: Folder[];
  entries: Entry[];
}

const STORAGE_KEY = "shelve_state";

// Fixed rather than crypto.randomUUID(): every fresh device auto-creates
// this exact workspace before it has ever synced. A random id meant two
// devices' default workspaces never recognized each other as the same
// record — they'd just coexist as two "Home" entries after the first
// sync. A shared, well-known id lets them converge on the same row.
const DEFAULT_WORKSPACE_ID = "default";

export async function loadState(): Promise<State> {
  const state = await getStore().get<State>(STORAGE_KEY);
  if (state) return state;
  return initState();
}

async function initState(): Promise<State> {
  const now = Date.now();
  const home: Workspace = {
    id: DEFAULT_WORKSPACE_ID,
    name: "Home",
    position: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  const state: State = { workspaces: [home], folders: [], entries: [] };
  await saveState(state);
  return state;
}

export async function saveState(state: State): Promise<void> {
  await getStore().set(STORAGE_KEY, state);
}

export function createWorkspace(state: State, name: string): Workspace {
  const now = Date.now();
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    position: state.workspaces.length,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  state.workspaces.push(workspace);
  return workspace;
}

export function renameWorkspace(state: State, workspaceId: string, name: string): Workspace {
  const workspace = state.workspaces.find((w) => w.id === workspaceId)!;
  workspace.name = name;
  workspace.updated_at = Date.now();
  return workspace;
}

export function renameFolder(state: State, folderId: string, name: string): Folder {
  const folder = state.folders.find((f) => f.id === folderId)!;
  folder.name = name;
  folder.updated_at = Date.now();
  return folder;
}

/** Reassign positions 0..n-1 to a workspace's folders in the given order.
 * Only bumps updated_at on folders whose position actually changed, and
 * returns just those — callers push only what changed rather than the
 * whole workspace's folders on every reorder. */
export function reorderFolders(state: State, workspaceId: string, orderedFolderIds: string[]): Folder[] {
  const now = Date.now();
  const changed: Folder[] = [];
  orderedFolderIds.forEach((folderId, index) => {
    const folder = state.folders.find((f) => f.id === folderId && f.workspace_id === workspaceId);
    if (!folder || folder.position === index) return;
    folder.position = index;
    folder.updated_at = now;
    changed.push(folder);
  });
  return changed;
}

export function createFolder(state: State, workspaceId: string, name: string): Folder {
  const now = Date.now();
  const position = state.folders.filter((f) => f.workspace_id === workspaceId).length;
  const folder: Folder = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    name,
    position,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  state.folders.push(folder);
  return folder;
}

/** Soft-delete: set deleted_at (and bump updated_at) rather than removing
 * the row, so the deletion propagates through sync the same way any other
 * edit does (newer updated_at wins), and content is retained for a future
 * trash view. Cascades to the folder's entries the same way. Returns the
 * folder and entries that were just soft-deleted, so callers can push the
 * deletion to the sync backend. */
export function deleteFolder(state: State, folderId: string): { folder: Folder; entries: Entry[] } {
  const now = Date.now();
  const folder = state.folders.find((f) => f.id === folderId)!;
  folder.deleted_at = now;
  folder.updated_at = now;

  const entries = state.entries.filter((e) => e.folder_id === folderId && e.deleted_at === null);
  for (const entry of entries) {
    entry.deleted_at = now;
    entry.updated_at = now;
  }

  return { folder, entries };
}

/** Restores a soft-deleted folder, cascading back every entry of its
 * currently in the trash — not just ones deleted in the same operation
 * as the folder (deleteFolder's shared `now` isn't a reliable enough
 * signal to distinguish "cascaded" from "independent" at Date.now()'s
 * 1ms resolution: two separate deletes landing in the same millisecond
 * is entirely plausible, not just a test artifact). Restoring a folder
 * meaning "bring back everything currently missing from it" is simpler
 * and avoids that fragility.
 *
 * Both the folder and its restored entries land at the end of their
 * respective lists (like a freshly created one) rather than keeping
 * their old position — other items may well have taken those positions
 * since, and a stale position risks colliding with one still in use. */
export function restoreFolder(state: State, folderId: string): { folder: Folder; entries: Entry[] } {
  const now = Date.now();
  const folder = state.folders.find((f) => f.id === folderId)!;
  folder.deleted_at = null;
  folder.updated_at = now;
  folder.position = state.folders.filter(
    (f) => f.workspace_id === folder.workspace_id && f.id !== folder.id && f.deleted_at === null,
  ).length;

  const entries = state.entries.filter((e) => e.folder_id === folderId && e.deleted_at !== null);
  let nextPosition = state.entries.filter((e) => e.folder_id === folderId && e.deleted_at === null).length;
  for (const entry of entries) {
    entry.deleted_at = null;
    entry.updated_at = now;
    entry.position = nextPosition++;
  }

  return { folder, entries };
}

/** Restores a soft-deleted entry. If its folder is also currently in the
 * trash, restores that folder too rather than leaving the entry orphaned
 * in a folder no view can reach, or fabricating a duplicate folder — same
 * id is preserved, and any other entries that were deleted independently
 * stay in the trash untouched. Both land at the end of their respective
 * lists rather than a stale old position — see restoreFolder for why. */
export function restoreEntry(state: State, entryId: string): { entry: Entry; restoredFolder: Folder | null } {
  const now = Date.now();
  const entry = state.entries.find((e) => e.id === entryId)!;
  entry.deleted_at = null;
  entry.updated_at = now;

  const folder = state.folders.find((f) => f.id === entry.folder_id) ?? null;
  let restoredFolder: Folder | null = null;
  if (folder && folder.deleted_at !== null) {
    folder.deleted_at = null;
    folder.updated_at = now;
    folder.position = state.folders.filter(
      (f) => f.workspace_id === folder.workspace_id && f.id !== folder.id && f.deleted_at === null,
    ).length;
    restoredFolder = folder;
  }

  entry.position = state.entries.filter(
    (e) => e.folder_id === entry.folder_id && e.id !== entry.id && e.deleted_at === null,
  ).length;

  return { entry, restoredFolder };
}

export interface NewEntryData {
  url?: string | null;
  title?: string | null;
  favicon_url?: string | null;
  note?: string | null;
}

export function createEntry(state: State, folderId: string, data: NewEntryData): Entry {
  const now = Date.now();
  const position = state.entries.filter((e) => e.folder_id === folderId).length;
  const entry: Entry = {
    id: crypto.randomUUID(),
    folder_id: folderId,
    url: data.url ?? null,
    title: data.title ?? null,
    favicon_url: data.favicon_url ?? null,
    note: data.note ?? null,
    position,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  state.entries.push(entry);
  return entry;
}

/** Sets an entry's note. `note` must be non-empty by the time it gets
 * here — there's deliberately no way to clear a note-only entry's note to
 * empty (that would violate the D1 CHECK(url IS NOT NULL OR note IS NOT
 * NULL) constraint). To remove a note-only entry, delete it; a url entry
 * can have its note cleared by passing an empty string since the row is
 * still valid without it — that path just isn't wired up in the UI yet. */
export function updateEntryNote(state: State, entryId: string, note: string): Entry {
  const entry = state.entries.find((e) => e.id === entryId)!;
  entry.note = note;
  entry.updated_at = Date.now();
  return entry;
}

export function updateEntryTitle(state: State, entryId: string, title: string): Entry {
  const entry = state.entries.find((e) => e.id === entryId)!;
  entry.title = title;
  entry.updated_at = Date.now();
  return entry;
}

/** Moves an entry to `targetIndex` within `targetFolderId`'s entries,
 * reassigning `folder_id` if that folder differs from where it already
 * was. `targetIndex` is clamped, so passing something like
 * `Number.MAX_SAFE_INTEGER` is a normal way to mean "append at the end".
 * Reindexes both the target folder (to make room) and, if the entry
 * changed folders, the source folder (to close the gap it left) — only
 * entries whose position or folder actually changed are returned, so a
 * drop that lands back where it started is a true no-op. */
export function moveEntryToPosition(
  state: State,
  entryId: string,
  targetFolderId: string,
  targetIndex: number,
): Entry[] {
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry) return [];

  const now = Date.now();
  const sourceFolderId = entry.folder_id;
  const changed: Entry[] = [];

  if (sourceFolderId !== targetFolderId) {
    entry.folder_id = targetFolderId;
    entry.updated_at = now;
    changed.push(entry);
  }

  const targetSiblingIds = state.entries
    .filter((e) => e.folder_id === targetFolderId && e.id !== entryId)
    .sort((a, b) => a.position - b.position)
    .map((e) => e.id);
  targetSiblingIds.splice(Math.max(0, Math.min(targetIndex, targetSiblingIds.length)), 0, entryId);
  targetSiblingIds.forEach((id, index) => {
    const e = id === entryId ? entry : state.entries.find((x) => x.id === id)!;
    if (e.position !== index) {
      e.position = index;
      e.updated_at = now;
      if (!changed.includes(e)) changed.push(e);
    }
  });

  if (sourceFolderId !== targetFolderId) {
    const sourceSiblings = state.entries
      .filter((e) => e.folder_id === sourceFolderId)
      .sort((a, b) => a.position - b.position);
    sourceSiblings.forEach((e, index) => {
      if (e.position !== index) {
        e.position = index;
        e.updated_at = now;
        if (!changed.includes(e)) changed.push(e);
      }
    });
  }

  return changed;
}

/** Soft-delete: see deleteFolder for why. Returns the deleted entry so
 * callers can push the deletion to the sync backend. */
export function deleteEntry(state: State, entryId: string): Entry {
  const now = Date.now();
  const entry = state.entries.find((e) => e.id === entryId)!;
  entry.deleted_at = now;
  entry.updated_at = now;
  return entry;
}
