-- Adds ON DELETE CASCADE to folders.workspace_id and entries.folder_id, so
-- permanently deleting a workspace/folder (see index.ts's ?permanent=true)
-- automatically removes everything under it in one statement, rather than
-- the Worker having to manually compute and order a multi-statement
-- descendant delete itself. SQLite has no ALTER TABLE support for changing
-- an existing foreign key's action, so this uses the standard
-- recreate-the-table migration pattern.
--
-- Ordering avoids ever dropping a table that's still referenced by a live
-- foreign key (entries.folder_id references folders, so folders can't be
-- dropped while entries still exists) — entries is staged into a plain
-- holding table and dropped first (entries itself has no incoming
-- references, so that drop is always safe), then folders is recreated
-- (now safe to drop, nothing references it), then entries is recreated
-- fresh against the new folders table and its data restored.
--
-- workspaces is untouched — nothing references it via a foreign key that
-- needs a cascade action added.

CREATE TABLE entries_backup AS
  SELECT id, folder_id, url, title, favicon_url, note, position, created_at, updated_at, deleted_at
  FROM entries;

DROP TABLE entries;

CREATE TABLE folders_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO folders_new (id, workspace_id, name, position, created_at, updated_at, deleted_at)
  SELECT id, workspace_id, name, position, created_at, updated_at, deleted_at FROM folders;

DROP TABLE folders;

ALTER TABLE folders_new RENAME TO folders;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  url TEXT,
  title TEXT,
  favicon_url TEXT,
  note TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (url IS NOT NULL OR note IS NOT NULL)
);

INSERT INTO entries (id, folder_id, url, title, favicon_url, note, position, created_at, updated_at, deleted_at)
  SELECT id, folder_id, url, title, favicon_url, note, position, created_at, updated_at, deleted_at
  FROM entries_backup;

DROP TABLE entries_backup;
