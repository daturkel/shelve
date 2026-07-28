import {
  restoreFolder,
  restoreEntry,
  restoreWorkspace,
  hardDeleteEntry,
  hardDeleteFolder,
  hardDeleteWorkspace,
} from "../lib/storage";
import { pushResource, pushPermanentDelete } from "../lib/sync";
import { buildFaviconEl } from "../lib/favicon";
import { showConfirm } from "../lib/modal";
import type { AppContext } from "./context";

// ---------- Trash: grouped, expandable, multi-select ----------
//
// A trashed workspace or folder is a "group" row: its own currently-trashed
// descendants (folders/entries) are collapsed into a count by default
// rather than each getting their own top-level row (a folder deleted with
// 200 entries would otherwise flood the view) — expanding reveals every
// descendant, flattened one level deep (not nested accordions: expanding a
// workspace shows both its folders and their entries together in one list,
// not a folder row you then expand again). A folder/entry only gets its
// own top-level row if it was deleted independently (its parent is still
// live). Restore/permanent-delete on a group act on everything inside it,
// cascading exactly the way deleteWorkspace/deleteFolder's own cascades
// already do — this file only changes how trash is *displayed* and how
// hard-delete is wired in, not the underlying restore semantics.

type ResourceKind = "workspace" | "folder" | "entry";

interface TrashLeaf {
  kind: "folder" | "entry";
  id: string;
  name: string;
  deletedAt: number;
  faviconUrl?: string | null;
  /** Only set for an entry-kind leaf nested (via its folder) under a
   * workspace group, where a folder and its own entries are flattened as
   * siblings in the same one-level descendants list. Lets a descendant
   * folder's checkbox cascade to its own entries, and lets the selection
   * plan below avoid double-processing an entry whose folder is also
   * separately selected — both would otherwise be independently reachable
   * despite the folder's own hard-delete/restore already cascading to it. */
  folderId?: string;
}

type TrashItem =
  | { kind: "workspace"; id: string; name: string; deletedAt: number; descendants: TrashLeaf[] }
  | { kind: "folder"; id: string; name: string; deletedAt: number; descendants: TrashLeaf[] }
  | { kind: "entry"; id: string; name: string; deletedAt: number; faviconUrl: string | null };

function trashKey(kind: ResourceKind, id: string): string {
  return `${kind}:${id}`;
}

function entryName(entry: { title: string | null; url: string | null; note: string | null }): string {
  return entry.title || entry.url || entry.note || "Untitled";
}

function computeTrashItems(state: AppContext["state"]): TrashItem[] {
  const deletedFolderIds = new Set(state.folders.filter((f) => f.deleted_at !== null).map((f) => f.id));
  const deletedWorkspaceIds = new Set(state.workspaces.filter((w) => w.deleted_at !== null).map((w) => w.id));

  const items: TrashItem[] = [];

  for (const w of state.workspaces) {
    if (w.deleted_at === null) continue;
    const descendantFolders = state.folders.filter((f) => f.workspace_id === w.id && f.deleted_at !== null);
    const descendantFolderIds = new Set(descendantFolders.map((f) => f.id));
    const descendants: TrashLeaf[] = [
      ...descendantFolders.map((f) => ({
        kind: "folder" as const,
        id: f.id,
        name: f.name || "Untitled folder",
        deletedAt: f.deleted_at!,
      })),
      ...state.entries
        .filter((e) => e.deleted_at !== null && descendantFolderIds.has(e.folder_id))
        .map((e) => ({
          kind: "entry" as const,
          id: e.id,
          name: entryName(e),
          deletedAt: e.deleted_at!,
          faviconUrl: e.favicon_url,
          folderId: e.folder_id,
        })),
    ].sort((a, b) => b.deletedAt - a.deletedAt);
    items.push({
      kind: "workspace",
      id: w.id,
      name: w.name || "Untitled workspace",
      deletedAt: w.deleted_at,
      descendants,
    });
  }

  for (const f of state.folders) {
    if (f.deleted_at === null || deletedWorkspaceIds.has(f.workspace_id)) continue; // else already a descendant above
    const descendants: TrashLeaf[] = state.entries
      .filter((e) => e.deleted_at !== null && e.folder_id === f.id)
      .map((e) => ({
        kind: "entry" as const,
        id: e.id,
        name: entryName(e),
        deletedAt: e.deleted_at!,
        faviconUrl: e.favicon_url,
      }))
      .sort((a, b) => b.deletedAt - a.deletedAt);
    items.push({ kind: "folder", id: f.id, name: f.name || "Untitled folder", deletedAt: f.deleted_at, descendants });
  }

  for (const e of state.entries) {
    if (e.deleted_at === null || deletedFolderIds.has(e.folder_id)) continue; // else already a descendant above
    items.push({ kind: "entry", id: e.id, name: entryName(e), deletedAt: e.deleted_at, faviconUrl: e.favicon_url });
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

export function buildTrash(ctx: AppContext): HTMLElement {
  const container = document.createElement("div");
  container.className = "trash";

  const items = computeTrashItems(ctx.state);

  const heading = document.createElement("div");
  heading.className = "trash-heading-row";
  const headingLabel = document.createElement("div");
  headingLabel.className = "trash-heading";
  headingLabel.textContent = "TRASH";
  heading.appendChild(headingLabel);

  if (items.length > 0) {
    const emptyTrashBtn = document.createElement("button");
    emptyTrashBtn.className = "trash-empty-btn";
    emptyTrashBtn.textContent = "Empty trash";
    emptyTrashBtn.onclick = async () => {
      const ok = await showConfirm(
        "Permanently delete everything in the trash? This cannot be undone.",
        "Delete forever",
      );
      if (!ok) return;
      for (const item of items) hardDeleteTopLevel(ctx, item);
      ctx.selectedTrashIds.clear();
      await ctx.rerender();
      for (const item of items) void pushPermanentDelete(workerKind(item.kind), item.id);
    };
    heading.appendChild(emptyTrashBtn);
  }
  container.appendChild(heading);

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "Trash is empty.";
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement("div");
  list.className = "trash-list";
  for (const item of items) {
    list.appendChild(buildTopLevelRowEl(ctx, item));
    if (
      item.kind !== "entry" &&
      item.descendants.length > 0 &&
      ctx.expandedTrashGroupIds.has(trashKey(item.kind, item.id))
    ) {
      const descendantsList = document.createElement("div");
      descendantsList.className = "trash-item-descendants";
      for (const d of item.descendants) descendantsList.appendChild(buildLeafRowEl(ctx, d, item.descendants));
      list.appendChild(descendantsList);
    }
  }
  container.appendChild(list);

  if (ctx.selectedTrashIds.size > 0) {
    container.appendChild(buildTrashSelectionBar(ctx, items));
  }

  return container;
}

function workerKind(kind: ResourceKind): "workspaces" | "folders" | "entries" {
  return kind === "workspace" ? "workspaces" : kind === "folder" ? "folders" : "entries";
}

function badgeLabel(kind: ResourceKind): string {
  return kind === "workspace" ? "Workspace" : "Folder";
}

// ---------- Row builders ----------

function buildCheckbox(ctx: AppContext, key: string, onToggle: (checked: boolean) => void): HTMLInputElement {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "trash-item-checkbox";
  checkbox.checked = ctx.selectedTrashIds.has(key);
  checkbox.onclick = (ev) => ev.stopPropagation();
  checkbox.onchange = () => onToggle(checkbox.checked);
  return checkbox;
}

function buildTopLevelRowEl(ctx: AppContext, item: TrashItem): HTMLElement {
  const row = document.createElement("div");
  row.className = "trash-item";

  const key = trashKey(item.kind, item.id);
  const descendants = item.kind === "entry" ? [] : item.descendants;

  row.appendChild(
    buildCheckbox(ctx, key, (checked) => {
      const keys = [key, ...descendants.map((d) => trashKey(d.kind, d.id))];
      for (const k of keys) {
        if (checked) ctx.selectedTrashIds.add(k);
        else ctx.selectedTrashIds.delete(k);
      }
      ctx.render();
    }),
  );

  if (descendants.length > 0) {
    const toggle = document.createElement("span");
    toggle.className = "trash-item-expand-toggle";
    const expanded = ctx.expandedTrashGroupIds.has(key);
    toggle.textContent = expanded ? "▾" : "▸";
    toggle.onclick = () => {
      if (expanded) ctx.expandedTrashGroupIds.delete(key);
      else ctx.expandedTrashGroupIds.add(key);
      ctx.render();
    };
    row.appendChild(toggle);
  }

  if (item.kind === "entry") {
    row.appendChild(buildFaviconEl(item.faviconUrl));
  } else {
    const badge = document.createElement("div");
    badge.className = "trash-folder-badge";
    badge.textContent = badgeLabel(item.kind);
    row.appendChild(badge);
  }

  const name = document.createElement("div");
  name.className = "trash-name";
  name.textContent =
    descendants.length > 0
      ? `${item.name} — ${descendants.length} item${descendants.length === 1 ? "" : "s"}`
      : item.name;
  row.appendChild(name);

  const descendantKeys = descendants.map((d) => trashKey(d.kind, d.id));
  row.appendChild(buildDeletedAtEl(item.deletedAt));
  row.appendChild(buildRestoreButton(ctx, item.kind, item.id, descendantKeys));
  row.appendChild(buildDeleteForeverButton(ctx, item.kind, item.id, item.name, descendants.length, descendantKeys));

  return row;
}

function buildLeafRowEl(ctx: AppContext, leaf: TrashLeaf, siblings: TrashLeaf[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "trash-item trash-item-descendant";

  const key = trashKey(leaf.kind, leaf.id);
  // A descendant *folder* (only possible when it's itself a descendant of a
  // trashed workspace, sitting alongside its own entries as flattened
  // siblings) cascades to those entries too, mirroring how a top-level
  // group's checkbox cascades to all its descendants — otherwise a folder
  // could be checked without its entries, understating the selection count
  // relative to what its own hard-delete/restore actually cascades to.
  const ownEntryKeys =
    leaf.kind === "folder"
      ? siblings.filter((s) => s.kind === "entry" && s.folderId === leaf.id).map((s) => trashKey(s.kind, s.id))
      : [];
  row.appendChild(
    buildCheckbox(ctx, key, (checked) => {
      for (const k of [key, ...ownEntryKeys]) {
        if (checked) ctx.selectedTrashIds.add(k);
        else ctx.selectedTrashIds.delete(k);
      }
      ctx.render();
    }),
  );

  if (leaf.kind === "entry") {
    row.appendChild(buildFaviconEl(leaf.faviconUrl ?? null));
  } else {
    const badge = document.createElement("div");
    badge.className = "trash-folder-badge";
    badge.textContent = "Folder";
    row.appendChild(badge);
  }

  const name = document.createElement("div");
  name.className = "trash-name";
  name.textContent = leaf.name;
  row.appendChild(name);

  row.appendChild(buildDeletedAtEl(leaf.deletedAt));
  row.appendChild(buildRestoreButton(ctx, leaf.kind, leaf.id, ownEntryKeys));
  row.appendChild(buildDeleteForeverButton(ctx, leaf.kind, leaf.id, leaf.name, ownEntryKeys.length, ownEntryKeys));

  return row;
}

function buildDeletedAtEl(deletedAt: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "trash-deleted-at";
  el.textContent = new Date(deletedAt).toLocaleString();
  return el;
}

/** `descendantKeys` — for a group row (a workspace/folder with descendants),
 * their keys too, so acting on the group via its own row button doesn't
 * leave their (now-meaningless, since the underlying records are gone or
 * restored) keys stranded in `selectedTrashIds` — only the bulk action bar
 * and Empty Trash previously cleaned up after themselves; a single row's
 * own buttons need to as well. */
function buildRestoreButton(
  ctx: AppContext,
  kind: ResourceKind,
  id: string,
  descendantKeys: string[] = [],
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "trash-restore-btn";
  btn.textContent = "Restore";
  btn.onclick = async () => {
    for (const k of [trashKey(kind, id), ...descendantKeys]) ctx.selectedTrashIds.delete(k);
    await restoreTopLevel(ctx, kind, id);
  };
  return btn;
}

function buildDeleteForeverButton(
  ctx: AppContext,
  kind: ResourceKind,
  id: string,
  name: string,
  descendantCount: number,
  descendantKeys: string[] = [],
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "trash-delete-forever-btn";
  btn.textContent = "Delete forever";
  btn.onclick = async () => {
    const message =
      descendantCount > 0
        ? `Permanently delete "${name}" and its ${descendantCount} item${descendantCount === 1 ? "" : "s"}? This cannot be undone.`
        : `Permanently delete "${name}"? This cannot be undone.`;
    const ok = await showConfirm(message, "Delete forever");
    if (!ok) return;
    hardDeleteTopLevel(ctx, { kind, id });
    for (const k of [trashKey(kind, id), ...descendantKeys]) ctx.selectedTrashIds.delete(k);
    await ctx.rerender();
    void pushPermanentDelete(workerKind(kind), id);
  };
  return btn;
}

// ---------- Mutations shared by single-row and bulk actions ----------

/** Local-state-only mutation (no rerender) — returns the pushResource calls
 * still to make, as thunks, so bulk callers can mutate everything first and
 * rerender/push once at the end instead of once per item (matching the
 * batching hardDeleteTopLevel's bulk callers already do). */
function mutateRestore(ctx: AppContext, kind: ResourceKind, id: string): Array<() => void> {
  if (kind === "workspace") {
    const { workspace, folders, entries } = restoreWorkspace(ctx.state, id);
    return [
      () => void pushResource("workspaces", workspace),
      ...folders.map((f) => () => void pushResource("folders", f)),
      ...entries.map((e) => () => void pushResource("entries", e)),
    ];
  } else if (kind === "folder") {
    const { folder, entries, restoredWorkspace } = restoreFolder(ctx.state, id);
    const pushes = [
      () => void pushResource("folders", folder),
      ...entries.map((e) => () => void pushResource("entries", e)),
    ];
    if (restoredWorkspace) pushes.push(() => void pushResource("workspaces", restoredWorkspace));
    return pushes;
  } else {
    const { entry, restoredFolder, restoredWorkspace } = restoreEntry(ctx.state, id);
    const pushes = [() => void pushResource("entries", entry)];
    if (restoredFolder) pushes.push(() => void pushResource("folders", restoredFolder));
    if (restoredWorkspace) pushes.push(() => void pushResource("workspaces", restoredWorkspace));
    return pushes;
  }
}

async function restoreTopLevel(ctx: AppContext, kind: ResourceKind, id: string): Promise<void> {
  const pushes = mutateRestore(ctx, kind, id);
  await ctx.rerender();
  for (const push of pushes) push();
}

/** Local-state-only mutation (no rerender/push) — bulk callers batch these
 * and rerender/push once at the end instead of once per item. */
function hardDeleteTopLevel(ctx: AppContext, item: Pick<TrashItem, "kind" | "id">): void {
  if (item.kind === "workspace") hardDeleteWorkspace(ctx.state, item.id);
  else if (item.kind === "folder") hardDeleteFolder(ctx.state, item.id);
  else hardDeleteEntry(ctx.state, item.id);
}

// ---------- Multi-select action bar ----------

/** For each top-level item, either it itself is selected (act on the whole
 * group, skip its descendants even if individually selected too — the
 * group's own restore/hard-delete already cascades to them) or, if not,
 * whichever of its descendants are individually selected act on their own —
 * except an entry whose own folder is *also* independently selected within
 * the same group, which is skipped the same way: that folder's own
 * restore/hard-delete will already cascade to it. Without this, both would
 * end up in the plan and get processed twice — for hard-delete specifically
 * that's not just redundant but unsafe (the second call would find the
 * entry already gone). buildLeafRowEl's checkbox cascade makes this the
 * normal case rather than a rare one, but this is the actual guarantee. */
function computeSelectionPlan(ctx: AppContext, items: TrashItem[]): { kind: ResourceKind; id: string }[] {
  const plan: { kind: ResourceKind; id: string }[] = [];
  for (const item of items) {
    if (ctx.selectedTrashIds.has(trashKey(item.kind, item.id))) {
      plan.push({ kind: item.kind, id: item.id });
      continue;
    }
    if (item.kind === "entry") continue;
    const selectedFolderIds = new Set(
      item.descendants
        .filter((d) => d.kind === "folder" && ctx.selectedTrashIds.has(trashKey(d.kind, d.id)))
        .map((d) => d.id),
    );
    for (const d of item.descendants) {
      if (!ctx.selectedTrashIds.has(trashKey(d.kind, d.id))) continue;
      if (d.kind === "entry" && d.folderId && selectedFolderIds.has(d.folderId)) continue;
      plan.push({ kind: d.kind, id: d.id });
    }
  }
  return plan;
}

function buildTrashSelectionBar(ctx: AppContext, items: TrashItem[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "trash-selection-bar";

  const count = document.createElement("div");
  count.className = "trash-selection-count";
  count.textContent = `${ctx.selectedTrashIds.size} selected`;
  bar.appendChild(count);

  const actions = document.createElement("div");
  actions.className = "trash-selection-actions";

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "trash-selection-btn";
  restoreBtn.textContent = "Restore";
  restoreBtn.onclick = async () => {
    const plan = computeSelectionPlan(ctx, items);
    const pushes = plan.flatMap(({ kind, id }) => mutateRestore(ctx, kind, id));
    ctx.selectedTrashIds.clear();
    await ctx.rerender();
    for (const push of pushes) push();
  };
  actions.appendChild(restoreBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "trash-selection-btn trash-selection-btn-danger";
  deleteBtn.textContent = "Delete forever";
  deleteBtn.onclick = async () => {
    const n = ctx.selectedTrashIds.size;
    const ok = await showConfirm(
      `Permanently delete ${n} item${n === 1 ? "" : "s"}? This cannot be undone.`,
      "Delete forever",
    );
    if (!ok) return;
    const plan = computeSelectionPlan(ctx, items);
    for (const item of plan) hardDeleteTopLevel(ctx, item);
    ctx.selectedTrashIds.clear();
    await ctx.rerender();
    for (const { kind, id } of plan) void pushPermanentDelete(workerKind(kind), id);
  };
  actions.appendChild(deleteBtn);

  const clearBtn = document.createElement("button");
  clearBtn.className = "trash-selection-clear";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear selection";
  clearBtn.onclick = () => {
    ctx.selectedTrashIds.clear();
    ctx.render();
  };
  actions.appendChild(clearBtn);

  bar.appendChild(actions);
  return bar;
}
