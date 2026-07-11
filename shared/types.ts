export interface Workspace {
  id: string;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
  /** Soft-delete marker. Set (and updated_at bumped) instead of a hard
   * delete, so the deletion itself propagates to other devices via the
   * same "newer updated_at wins" sync merge as any other field. UI code
   * should filter out records where this is non-null. */
  deleted_at: number | null;
}

export interface Folder {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface Entry {
  id: string;
  folder_id: string;
  url: string | null;
  title: string | null;
  favicon_url: string | null;
  note: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type ResourceKind = "workspaces" | "folders" | "entries";
