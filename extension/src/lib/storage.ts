import type { Workspace, Folder, Entry } from "@shelve/shared";

export interface State {
  workspaces: Workspace[];
  folders: Folder[];
  entries: Entry[];
}

const STORAGE_KEY = "shelve_state";

export async function loadState(): Promise<State> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const state = result[STORAGE_KEY] as State | undefined;
  if (state) return state;
  return initState();
}

async function initState(): Promise<State> {
  const now = Date.now();
  const home: Workspace = {
    id: crypto.randomUUID(),
    name: "Home",
    position: 0,
    created_at: now,
    updated_at: now,
  };
  const state: State = { workspaces: [home], folders: [], entries: [] };
  await saveState(state);
  return state;
}

export async function saveState(state: State): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export function createWorkspace(state: State, name: string): Workspace {
  const now = Date.now();
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    position: state.workspaces.length,
    created_at: now,
    updated_at: now,
  };
  state.workspaces.push(workspace);
  return workspace;
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
  };
  state.folders.push(folder);
  return folder;
}

export function deleteFolder(state: State, folderId: string): void {
  state.folders = state.folders.filter((f) => f.id !== folderId);
  state.entries = state.entries.filter((e) => e.folder_id !== folderId);
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
  };
  state.entries.push(entry);
  return entry;
}

export function moveEntry(state: State, entryId: string, targetFolderId: string): void {
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry || entry.folder_id === targetFolderId) return;
  entry.folder_id = targetFolderId;
  entry.position = state.entries.filter(
    (e) => e.folder_id === targetFolderId && e.id !== entryId,
  ).length;
  entry.updated_at = Date.now();
}

export function deleteEntry(state: State, entryId: string): void {
  state.entries = state.entries.filter((e) => e.id !== entryId);
}
