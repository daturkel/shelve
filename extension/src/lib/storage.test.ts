import { beforeEach, describe, expect, it } from "vitest";
import type { State } from "./storage";
import {
  loadState,
  createWorkspace,
  renameWorkspace,
  createFolder,
  renameFolder,
  reorderFolders,
  deleteFolder,
  createEntry,
  moveEntry,
  deleteEntry,
  updateEntryNote,
} from "./storage";

// Minimal in-memory mock of chrome.storage.local, just enough for
// loadState()'s get/set round-trip.
function installChromeStorageMock() {
  const store = new Map<string, unknown>();
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
      },
    },
  };
}

function emptyState(): State {
  return { workspaces: [], folders: [], entries: [] };
}

describe("loadState", () => {
  beforeEach(() => installChromeStorageMock());

  it("auto-creates a single 'Home' workspace on first run", async () => {
    const state = await loadState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe("Home");
    expect(state.workspaces[0].deleted_at).toBeNull();
    expect(state.folders).toEqual([]);
    expect(state.entries).toEqual([]);
  });

  it("returns the same state on a second call (persisted, not re-initialized)", async () => {
    const first = await loadState();
    const second = await loadState();
    expect(second.workspaces[0].id).toBe(first.workspaces[0].id);
  });

  it("uses a fixed id for the default workspace, so separate devices converge on sync", async () => {
    // Simulates two devices that have never synced with each other yet —
    // each independently auto-creates its own "Home" workspace on first
    // run. If the id were random (crypto.randomUUID()), these would sync
    // as two distinct workspaces instead of merging into one.
    installChromeStorageMock();
    const deviceA = await loadState();
    installChromeStorageMock();
    const deviceB = await loadState();
    expect(deviceA.workspaces[0].id).toBe(deviceB.workspaces[0].id);
  });
});

describe("createWorkspace / createFolder / createEntry", () => {
  it("assigns incrementing positions within their scope", () => {
    const state = emptyState();
    const wsA = createWorkspace(state, "A");
    const wsB = createWorkspace(state, "B");
    expect(wsA.position).toBe(0);
    expect(wsB.position).toBe(1);

    const folderA = createFolder(state, wsA.id, "Folder A");
    const folderB = createFolder(state, wsA.id, "Folder B");
    expect(folderA.position).toBe(0);
    expect(folderB.position).toBe(1);

    const entry1 = createEntry(state, folderA.id, { url: "https://a.example" });
    const entry2 = createEntry(state, folderA.id, { url: "https://b.example" });
    expect(entry1.position).toBe(0);
    expect(entry2.position).toBe(1);
  });

  it("new records start with deleted_at: null", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "F");
    const entry = createEntry(state, folder.id, { note: "hi" });
    expect(ws.deleted_at).toBeNull();
    expect(folder.deleted_at).toBeNull();
    expect(entry.deleted_at).toBeNull();
  });
});

describe("moveEntry", () => {
  it("moves an entry to a new folder and bumps updated_at", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folderA = createFolder(state, ws.id, "A");
    const folderB = createFolder(state, ws.id, "B");
    const entry = createEntry(state, folderA.id, { url: "https://example.com" });
    const originalUpdatedAt = entry.updated_at;

    moveEntry(state, entry.id, folderB.id);

    expect(entry.folder_id).toBe(folderB.id);
    expect(entry.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it("is a no-op when moving to the same folder", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "A");
    const entry = createEntry(state, folder.id, { url: "https://example.com" });
    const originalUpdatedAt = entry.updated_at;

    moveEntry(state, entry.id, folder.id);

    expect(entry.updated_at).toBe(originalUpdatedAt);
  });
});

describe("deleteEntry", () => {
  it("soft-deletes: keeps the record, sets deleted_at, bumps updated_at", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "A");
    const entry = createEntry(state, folder.id, { url: "https://example.com" });

    const deleted = deleteEntry(state, entry.id);

    expect(state.entries).toHaveLength(1); // still present
    expect(deleted.id).toBe(entry.id);
    expect(deleted.deleted_at).not.toBeNull();
    expect(deleted.updated_at).toBe(deleted.deleted_at);
  });
});

describe("deleteFolder", () => {
  it("soft-deletes the folder and cascades to its non-deleted entries", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "A");
    const otherFolder = createFolder(state, ws.id, "B");
    const entry1 = createEntry(state, folder.id, { url: "https://a.example" });
    const entry2 = createEntry(state, folder.id, { url: "https://b.example" });
    const unrelatedEntry = createEntry(state, otherFolder.id, { url: "https://c.example" });

    const result = deleteFolder(state, folder.id);

    expect(result.folder.deleted_at).not.toBeNull();
    expect(result.entries.map((e) => e.id).sort()).toEqual([entry1.id, entry2.id].sort());

    // Cascaded entries are soft-deleted in place too.
    const e1 = state.entries.find((e) => e.id === entry1.id)!;
    const e2 = state.entries.find((e) => e.id === entry2.id)!;
    const unrelated = state.entries.find((e) => e.id === unrelatedEntry.id)!;
    expect(e1.deleted_at).not.toBeNull();
    expect(e2.deleted_at).not.toBeNull();
    expect(unrelated.deleted_at).toBeNull(); // untouched
  });

  it("does not re-cascade to entries that were already deleted", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "A");
    const entry = createEntry(state, folder.id, { url: "https://example.com" });
    deleteEntry(state, entry.id);
    const deletedAtFromEarlierDelete = state.entries[0].deleted_at;

    const result = deleteFolder(state, folder.id);

    expect(result.entries).toHaveLength(0); // already-deleted entry isn't re-reported
    expect(state.entries[0].deleted_at).toBe(deletedAtFromEarlierDelete);
  });
});

describe("renameWorkspace / renameFolder", () => {
  it("updates the name and bumps updated_at", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "Old");
    const originalUpdatedAt = ws.updated_at;

    const renamed = renameWorkspace(state, ws.id, "New");

    expect(renamed.name).toBe("New");
    expect(renamed.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it("renames a folder the same way", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "Old Folder");

    const renamed = renameFolder(state, folder.id, "New Folder");

    expect(renamed.name).toBe("New Folder");
    expect(state.folders[0].name).toBe("New Folder");
  });
});

describe("reorderFolders", () => {
  it("reassigns positions to match the given order", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const a = createFolder(state, ws.id, "A");
    const b = createFolder(state, ws.id, "B");
    const c = createFolder(state, ws.id, "C");
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    // Move C to the front.
    const changed = reorderFolders(state, ws.id, [c.id, a.id, b.id]);

    expect(c.position).toBe(0);
    expect(a.position).toBe(1);
    expect(b.position).toBe(2);
    // a and b's positions did change too (1->... wait a: 0->1, b: 1->2), so
    // all three should be reported as changed.
    expect(changed.map((f) => f.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("only reports folders whose position actually changed", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const a = createFolder(state, ws.id, "A");
    const b = createFolder(state, ws.id, "B");

    // Same order as already assigned — nothing should move.
    const changed = reorderFolders(state, ws.id, [a.id, b.id]);

    expect(changed).toHaveLength(0);
  });

  it("does not affect folders in a different workspace", () => {
    const state = emptyState();
    const wsA = createWorkspace(state, "A");
    const wsB = createWorkspace(state, "B");
    const a1 = createFolder(state, wsA.id, "A1");
    const b1 = createFolder(state, wsB.id, "B1");
    const originalB1Position = b1.position;

    reorderFolders(state, wsA.id, [a1.id]);

    expect(b1.position).toBe(originalB1Position);
  });
});

describe("note-only entries", () => {
  it("createEntry supports a note with no url", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "Notes");

    const entry = createEntry(state, folder.id, { note: "just a note" });

    expect(entry.url).toBeNull();
    expect(entry.note).toBe("just a note");
  });

  it("updateEntryNote sets the note and bumps updated_at", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "A");
    const folder = createFolder(state, ws.id, "Notes");
    const entry = createEntry(state, folder.id, { url: "https://example.com" });
    const originalUpdatedAt = entry.updated_at;

    const updated = updateEntryNote(state, entry.id, "attached note");

    expect(updated.note).toBe("attached note");
    expect(updated.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt);
  });
});
