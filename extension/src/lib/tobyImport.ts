import type { Entry, Folder, Workspace } from "@shelve/shared";
import { type State, createWorkspace, createFolder, createEntry } from "./storage";

// Toby's own JSON export/import format (Settings -> Data -> Export/Import,
// "JSON" option), verified against a real export. Tags (`labels`/
// `labelIds`) are intentionally not represented: Shelve has no tags
// concept yet, so they're silently ignored on import.
export interface TobyCard {
  title: string;
  url: string;
  favIconUrl: string;
  customTitle: string;
  customDescription: string;
  description: string;
}

export interface TobyList {
  title: string;
  cards: TobyCard[];
  labelIds: string[];
}

export interface TobyGroup {
  name: string;
  type: string;
  lists: TobyList[];
}

export interface TobyExport {
  version: number;
  groups: TobyGroup[];
  labels: Record<string, unknown>;
}

export function isTobyExport(value: unknown): value is TobyExport {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { groups?: unknown }).groups)
  );
}

export interface ImportResult {
  workspaces: Workspace[];
  folders: Folder[];
  entries: Entry[];
}

/** Import a Toby export into local state. Every group/list/card becomes a
 * fresh workspace/folder/entry with a new id — Toby's data has no id
 * compatible with ours, so (unlike the native Shelve backup import) this
 * can never merge with existing records, only add alongside them. */
export function importToby(state: State, toby: TobyExport): ImportResult {
  const result: ImportResult = { workspaces: [], folders: [], entries: [] };

  for (const group of toby.groups) {
    const workspace = createWorkspace(state, group.name || "Imported from Toby");
    result.workspaces.push(workspace);

    for (const list of group.lists ?? []) {
      const folder = createFolder(state, workspace.id, list.title || "Untitled");
      result.folders.push(folder);

      for (const card of list.cards ?? []) {
        if (!card.url) continue; // Toby cards are always URL-backed in practice, but be defensive
        const entry = createEntry(state, folder.id, {
          url: card.url,
          title: card.customTitle || card.title || card.url,
          favicon_url: card.favIconUrl || null,
          note: card.customDescription || card.description || null,
        });
        result.entries.push(entry);
      }
    }
  }

  return result;
}

/** Export local state to Toby's format, for going back or sharing with
 * someone still on Toby. Note-only entries (no url) are dropped — Toby's
 * card format has no equivalent, it's always URL-backed. */
export function exportToby(state: State): TobyExport {
  const workspaces = state.workspaces.filter((w) => w.deleted_at === null);

  return {
    version: 4,
    groups: workspaces.map((ws) => ({
      name: ws.name,
      type: "private",
      lists: state.folders
        .filter((f) => f.workspace_id === ws.id && f.deleted_at === null)
        .map((folder) => ({
          title: folder.name,
          cards: state.entries
            .filter((e) => e.folder_id === folder.id && e.deleted_at === null && e.url !== null)
            .map((e) => ({
              title: e.title || e.url!,
              url: e.url!,
              favIconUrl: e.favicon_url || "",
              customTitle: "",
              customDescription: "",
              description: e.note || "",
            })),
          labelIds: [] as string[],
        })),
    })),
    labels: {},
  };
}
