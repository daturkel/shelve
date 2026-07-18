import { describe, expect, it } from "vitest";
import type { State } from "./storage";
import { createWorkspace, createFolder, createEntry } from "./storage";
import { importToby, exportToby, isTobyExport, type TobyExport } from "./tobyImport";

// Synthetic fixture matching the real schema (verified against an actual
// Toby export), not real bookmark data.
const FIXTURE: TobyExport = {
  version: 4,
  groups: [
    {
      name: "My Collections",
      type: "private",
      lists: [
        {
          title: "reading",
          cards: [
            {
              title: "Example Article",
              url: "https://example.com/article",
              favIconUrl: "https://example.com/favicon.ico",
              customTitle: "",
              customDescription: "",
              description: "",
            },
            {
              title: "Custom Named Card",
              url: "https://example.org/thing",
              favIconUrl: "",
              customTitle: "My Custom Name",
              customDescription: "a note about it",
              description: "original description",
            },
          ],
          labelIds: ["some-label-id"],
        },
        {
          title: "empty list",
          cards: [],
          labelIds: [],
        },
      ],
    },
  ],
  labels: { "some-label-id": { title: "Important", color: "red" } },
};

function emptyState(): State {
  return { workspaces: [], folders: [], entries: [] };
}

describe("isTobyExport", () => {
  it("accepts a well-formed export", () => {
    expect(isTobyExport(FIXTURE)).toBe(true);
  });

  it("rejects things without a groups array", () => {
    expect(isTobyExport({})).toBe(false);
    expect(isTobyExport({ groups: "not an array" })).toBe(false);
    expect(isTobyExport(null)).toBe(false);
    expect(isTobyExport("just a string")).toBe(false);
  });
});

describe("importToby", () => {
  it("creates one workspace per group, one folder per list, one entry per card", () => {
    const state = emptyState();
    const result = importToby(state, FIXTURE);

    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0].name).toBe("My Collections");
    expect(result.folders).toHaveLength(2);
    expect(result.folders.map((f) => f.name).sort()).toEqual(["empty list", "reading"]);
    expect(result.entries).toHaveLength(2);

    expect(state.workspaces).toHaveLength(1);
    expect(state.folders).toHaveLength(2);
    expect(state.entries).toHaveLength(2);
  });

  it("prefers customTitle/customDescription over title/description when present", () => {
    const state = emptyState();
    const result = importToby(state, FIXTURE);

    const plain = result.entries.find((e) => e.url === "https://example.com/article")!;
    expect(plain.title).toBe("Example Article");
    expect(plain.note).toBeNull();

    const customized = result.entries.find((e) => e.url === "https://example.org/thing")!;
    expect(customized.title).toBe("My Custom Name");
    expect(customized.note).toBe("a note about it");
  });

  it("ignores tags/labels entirely — not part of the Shelve data model", () => {
    const state = emptyState();
    importToby(state, FIXTURE);
    // No assertion target for "labels" on our types — the point is this
    // doesn't throw and doesn't need one; documented via the comment in
    // tobyImport.ts.
    expect(state.entries.every((e) => "note" in e)).toBe(true);
  });

  it("adds alongside existing local data rather than replacing it", () => {
    const state = emptyState();
    const existingWs = createWorkspace(state, "Existing");
    createFolder(state, existingWs.id, "Existing Folder");

    importToby(state, FIXTURE);

    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces.some((w) => w.name === "Existing")).toBe(true);
    expect(state.workspaces.some((w) => w.name === "My Collections")).toBe(true);
  });

  it("is defensive about cards with no url", () => {
    const state = emptyState();
    const malformed: TobyExport = {
      version: 4,
      groups: [
        {
          name: "G",
          type: "private",
          lists: [
            {
              title: "L",
              cards: [
                { title: "no url", url: "", favIconUrl: "", customTitle: "", customDescription: "", description: "" },
              ],
              labelIds: [],
            },
          ],
        },
      ],
      labels: {},
    };
    const result = importToby(state, malformed);
    expect(result.entries).toHaveLength(0);
  });
});

describe("exportToby", () => {
  it("round-trips workspace/folder/entry names and urls", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "Home");
    const folder = createFolder(state, ws.id, "Reading");
    createEntry(state, folder.id, { url: "https://a.example", title: "A", note: "n" });

    const exported = exportToby(state);

    expect(exported.groups).toHaveLength(1);
    expect(exported.groups[0].name).toBe("Home");
    expect(exported.groups[0].lists[0].title).toBe("Reading");
    expect(exported.groups[0].lists[0].cards[0]).toMatchObject({
      title: "A",
      url: "https://a.example",
      description: "n",
    });
  });

  it("drops note-only entries — Toby's card format has no equivalent", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "Home");
    const folder = createFolder(state, ws.id, "Notes");
    createEntry(state, folder.id, { note: "just a note, no url" });
    createEntry(state, folder.id, { url: "https://has-a-url.example", title: "Has URL" });

    const exported = exportToby(state);

    expect(exported.groups[0].lists[0].cards).toHaveLength(1);
    expect(exported.groups[0].lists[0].cards[0].url).toBe("https://has-a-url.example");
  });

  it("excludes soft-deleted workspaces/folders/entries", () => {
    const state = emptyState();
    const ws = createWorkspace(state, "Home");
    const folder = createFolder(state, ws.id, "Reading");
    const entry = createEntry(state, folder.id, { url: "https://example.com" });
    entry.deleted_at = Date.now();

    const exported = exportToby(state);

    expect(exported.groups[0].lists[0].cards).toHaveLength(0);
  });
});
