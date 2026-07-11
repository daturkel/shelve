ALTER TABLE workspaces ADD COLUMN deleted_at INTEGER;
ALTER TABLE folders ADD COLUMN deleted_at INTEGER;
ALTER TABLE entries ADD COLUMN deleted_at INTEGER;
