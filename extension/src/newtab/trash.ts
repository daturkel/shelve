import { restoreFolder, restoreEntry } from "../lib/storage";
import { pushResource } from "../lib/sync";
import { buildFaviconEl } from "../lib/favicon";
import type { AppContext } from "./context";

// ---------- Trash: a flat, global list of deleted folders and entries ----------

type TrashItem =
  | { kind: "folder"; id: string; name: string; deletedAt: number }
  | { kind: "entry"; id: string; name: string; deletedAt: number; faviconUrl: string | null };

export function buildTrash(ctx: AppContext): HTMLElement {
  const container = document.createElement("div");
  container.className = "trash";

  const heading = document.createElement("div");
  heading.className = "trash-heading";
  heading.textContent = "TRASH";
  container.appendChild(heading);

  const items: TrashItem[] = [
    ...ctx.state.folders
      .filter((f) => f.deleted_at !== null)
      .map((f) => ({ kind: "folder" as const, id: f.id, name: f.name || "Untitled folder", deletedAt: f.deleted_at! })),
    ...ctx.state.entries
      .filter((e) => e.deleted_at !== null)
      .map((e) => ({
        kind: "entry" as const,
        id: e.id,
        name: e.title || e.url || e.note || "Untitled",
        deletedAt: e.deleted_at!,
        faviconUrl: e.favicon_url,
      })),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

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
    list.appendChild(buildTrashItemEl(ctx, item));
  }
  container.appendChild(list);

  return container;
}

function buildTrashItemEl(ctx: AppContext, item: TrashItem): HTMLElement {
  const row = document.createElement("div");
  row.className = "trash-item";

  if (item.kind === "folder") {
    const icon = document.createElement("div");
    icon.className = "favicon trash-folder-icon";
    // A plain Unicode glyph, same as the rest of the UI's icons (✕, ▾/▸,
    // ⚙, ⧉, ☰, ▤ for note entries) — flat and monochrome via `color`,
    // unlike an emoji like 📁 which renders in full color regardless.
    icon.textContent = "▢";
    row.appendChild(icon);
  } else {
    row.appendChild(buildFaviconEl(item.faviconUrl));
  }

  const name = document.createElement("div");
  name.className = "trash-name";
  name.textContent = item.name;
  row.appendChild(name);

  const deletedAt = document.createElement("div");
  deletedAt.className = "trash-deleted-at";
  deletedAt.textContent = new Date(item.deletedAt).toLocaleString();
  row.appendChild(deletedAt);

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "trash-restore-btn";
  restoreBtn.textContent = "Restore";
  restoreBtn.onclick = async () => {
    if (item.kind === "folder") {
      const { folder, entries } = restoreFolder(ctx.state, item.id);
      await ctx.rerender();
      void pushResource("folders", folder);
      for (const entry of entries) void pushResource("entries", entry);
    } else {
      const { entry, restoredFolder } = restoreEntry(ctx.state, item.id);
      await ctx.rerender();
      void pushResource("entries", entry);
      if (restoredFolder) void pushResource("folders", restoredFolder);
    }
  };
  row.appendChild(restoreBtn);

  return row;
}
