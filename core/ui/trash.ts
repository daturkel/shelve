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
        })),
    ];
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
      }));
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
      for (const d of item.descendants) descendantsList.appendChild(buildLeafRowEl(ctx, d));
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

  row.appendChild(buildDeletedAtEl(item.deletedAt));
  row.appendChild(buildRestoreButton(ctx, item.kind, item.id));
  row.appendChild(buildDeleteForeverButton(ctx, item.kind, item.id, item.name, descendants.length));

  return row;
}

function buildLeafRowEl(ctx: AppContext, leaf: TrashLeaf): HTMLElement {
  const row = document.createElement("div");
  row.className = "trash-item trash-item-descendant";

  const key = trashKey(leaf.kind, leaf.id);
  row.appendChild(
    buildCheckbox(ctx, key, (checked) => {
      if (checked) ctx.selectedTrashIds.add(key);
      else ctx.selectedTrashIds.delete(key);
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
  row.appendChild(buildRestoreButton(ctx, leaf.kind, leaf.id));
  row.appendChild(buildDeleteForeverButton(ctx, leaf.kind, leaf.id, leaf.name, 0));

  return row;
}

function buildDeletedAtEl(deletedAt: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "trash-deleted-at";
  el.textContent = new Date(deletedAt).toLocaleString();
  return el;
}

function buildRestoreButton(ctx: AppContext, kind: ResourceKind, id: string): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "trash-restore-btn";
  btn.textContent = "Restore";
  btn.onclick = async () => {
    restoreTopLevel(ctx, kind, id);
  };
  return btn;
}

function buildDeleteForeverButton(
  ctx: AppContext,
  kind: ResourceKind,
  id: string,
  name: string,
  descendantCount: number,
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
    await ctx.rerender();
    void pushPermanentDelete(workerKind(kind), id);
  };
  return btn;
}

// ---------- Mutations shared by single-row and bulk actions ----------

async function restoreTopLevel(ctx: AppContext, kind: ResourceKind, id: string): Promise<void> {
  if (kind === "workspace") {
    const { workspace, folders, entries } = restoreWorkspace(ctx.state, id);
    await ctx.rerender();
    void pushResource("workspaces", workspace);
    for (const f of folders) void pushResource("folders", f);
    for (const e of entries) void pushResource("entries", e);
  } else if (kind === "folder") {
    const { folder, entries, restoredWorkspace } = restoreFolder(ctx.state, id);
    await ctx.rerender();
    void pushResource("folders", folder);
    for (const e of entries) void pushResource("entries", e);
    if (restoredWorkspace) void pushResource("workspaces", restoredWorkspace);
  } else {
    const { entry, restoredFolder, restoredWorkspace } = restoreEntry(ctx.state, id);
    await ctx.rerender();
    void pushResource("entries", entry);
    if (restoredFolder) void pushResource("folders", restoredFolder);
    if (restoredWorkspace) void pushResource("workspaces", restoredWorkspace);
  }
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
 * whichever of its descendants are individually selected act on their own. */
function computeSelectionPlan(ctx: AppContext, items: TrashItem[]): { kind: ResourceKind; id: string }[] {
  const plan: { kind: ResourceKind; id: string }[] = [];
  for (const item of items) {
    if (ctx.selectedTrashIds.has(trashKey(item.kind, item.id))) {
      plan.push({ kind: item.kind, id: item.id });
      continue;
    }
    if (item.kind === "entry") continue;
    for (const d of item.descendants) {
      if (ctx.selectedTrashIds.has(trashKey(d.kind, d.id))) plan.push({ kind: d.kind, id: d.id });
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
    for (const { kind, id } of plan) await restoreTopLevel(ctx, kind, id);
    ctx.selectedTrashIds.clear();
    await ctx.rerender();
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
