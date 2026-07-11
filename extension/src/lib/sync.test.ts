import { describe, expect, it } from "vitest";
import { mergeArray, mergeState } from "./sync";
import type { State } from "./storage";
import type { Workspace } from "@shelve/shared";

function ws(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    name: "ws",
    position: 0,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    ...overrides,
  };
}

describe("mergeArray", () => {
  it("keeps local-only records untouched", () => {
    const local = [ws({ id: "a", updated_at: 5 })];
    const merged = mergeArray(local, []);
    expect(merged).toEqual(local);
  });

  it("adds remote-only records (new from another device)", () => {
    const remote = [ws({ id: "b", updated_at: 5 })];
    const merged = mergeArray([], remote);
    expect(merged).toEqual(remote);
  });

  it("keeps the newer of two conflicting versions, by updated_at", () => {
    const local = [ws({ id: "a", name: "old local", updated_at: 10 })];
    const remote = [ws({ id: "a", name: "newer remote", updated_at: 20 })];
    const merged = mergeArray(local, remote);
    expect(merged).toEqual([ws({ id: "a", name: "newer remote", updated_at: 20 })]);
  });

  it("keeps local when local is newer than remote", () => {
    const local = [ws({ id: "a", name: "newer local", updated_at: 20 })];
    const remote = [ws({ id: "a", name: "stale remote", updated_at: 10 })];
    const merged = mergeArray(local, remote);
    expect(merged).toEqual([ws({ id: "a", name: "newer local", updated_at: 20 })]);
  });

  it("propagates a soft-delete: a remote deleted_at wins over a local non-deleted copy when newer", () => {
    // This is the scenario that drove the soft-delete design: device A
    // deletes a workspace, device B pulls and must see it disappear.
    const local = [ws({ id: "a", name: "still here locally", updated_at: 10, deleted_at: null })];
    const remote = [ws({ id: "a", name: "still here locally", updated_at: 20, deleted_at: 20 })];
    const merged = mergeArray(local, remote);
    expect(merged[0].deleted_at).toBe(20);
  });

  it("does NOT resurrect a local soft-delete when remote hasn't caught up yet", () => {
    const local = [ws({ id: "a", updated_at: 20, deleted_at: 20 })];
    const remote = [ws({ id: "a", updated_at: 10, deleted_at: null })];
    const merged = mergeArray(local, remote);
    expect(merged[0].deleted_at).toBe(20);
  });
});

describe("mergeState", () => {
  it("merges each of workspaces/folders/entries independently", () => {
    const local: State = {
      workspaces: [ws({ id: "w1", updated_at: 1 })],
      folders: [],
      entries: [],
    };
    const remote = {
      workspaces: [ws({ id: "w1", updated_at: 1 }), ws({ id: "w2", updated_at: 1 })],
      folders: [],
      entries: [],
    };
    const merged = mergeState(local, remote);
    expect(merged.workspaces.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
  });

  it("a record absent from a GET /state response is left alone, never deleted by omission", () => {
    // Core safety property: pulling never deletes local data just because
    // the remote payload doesn't mention a record (e.g. not pushed yet).
    // Only an explicit deleted_at (set via DELETE) can remove it.
    const local: State = {
      workspaces: [ws({ id: "not-yet-pushed", updated_at: 5 })],
      folders: [],
      entries: [],
    };
    const remote = { workspaces: [], folders: [], entries: [] };
    const merged = mergeState(local, remote);
    expect(merged.workspaces).toHaveLength(1);
    expect(merged.workspaces[0].id).toBe("not-yet-pushed");
  });
});
