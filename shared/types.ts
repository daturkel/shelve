export interface Workspace {
  id: string;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface Folder {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
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
}
