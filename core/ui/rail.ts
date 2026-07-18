import { createWorkspace, renameWorkspace, deleteWorkspace, pickDefaultWorkspaceId } from "../lib/storage";
import { pushResource, pushDelete } from "../lib/sync";
import { showPrompt, showConfirm } from "../lib/modal";
import type { AppContext } from "./context";

// ---------- Left rail: workspace switcher ----------

export function buildRail(ctx: AppContext): HTMLElement {
  const rail = document.createElement("div");
  rail.className = "rail" + (ctx.uiState.leftCollapsed ? " collapsed" : "");

  const workspaces = ctx.state.workspaces
    .filter((ws) => ws.deleted_at === null)
    .sort((a, b) => a.position - b.position);

  for (const ws of workspaces) {
    const item = document.createElement("div");
    item.className = "rail-item" + (ws.id === ctx.activeWorkspaceId ? " active" : "");
    item.title = "Double-click to rename";
    item.onclick = () => {
      ctx.activeWorkspaceId = ws.id;
      ctx.showTrash = false;
      ctx.render();
    };
    item.ondblclick = async (ev) => {
      ev.stopPropagation();
      const name = await showPrompt("Rename workspace", ws.name);
      if (!name || name === ws.name) return;
      renameWorkspace(ctx.state, ws.id, name);
      await ctx.rerender();
      void pushResource("workspaces", ws);
    };

    const label = document.createElement("span");
    label.className = "rail-item-label";
    label.textContent = ws.name;
    item.appendChild(label);

    // Hidden whenever it's the last remaining workspace — nothing in the
    // UI expects (or can recover from) a workspace-less state, matching
    // deleteWorkspace's own refusal to allow it at the data layer.
    if (workspaces.length > 1) {
      const del = document.createElement("span");
      del.className = "rail-item-delete";
      del.textContent = "×";
      del.title = "Delete workspace and everything in it";
      del.onclick = async (ev) => {
        ev.stopPropagation();
        const ok = await showConfirm(`Delete workspace "${ws.name}" and everything in it?`);
        if (!ok) return;
        const { workspace, folders, entries } = deleteWorkspace(ctx.state, ws.id);
        if (ctx.activeWorkspaceId === ws.id) {
          ctx.activeWorkspaceId = pickDefaultWorkspaceId(ctx.state);
        }
        await ctx.rerender();
        void pushDelete("workspaces", workspace.id);
        for (const folder of folders) void pushDelete("folders", folder.id);
        for (const entry of entries) void pushDelete("entries", entry.id);
      };
      item.appendChild(del);
    }

    rail.appendChild(item);
  }

  const addBtn = document.createElement("div");
  addBtn.className = "rail-add";
  addBtn.textContent = "+ New workspace";
  addBtn.onclick = async () => {
    const name = await showPrompt("New workspace");
    if (!name) return;
    const ws = createWorkspace(ctx.state, name);
    ctx.activeWorkspaceId = ws.id;
    await ctx.rerender();
    void pushResource("workspaces", ws);
  };
  rail.appendChild(addBtn);

  // Global (not per-workspace) — trash isn't scoped to whichever
  // workspace happens to be active, since you may not remember where
  // something you're looking for was deleted from.
  const trashBtn = document.createElement("div");
  trashBtn.className = "rail-item rail-trash" + (ctx.showTrash ? " active" : "");
  trashBtn.textContent = "Trash";
  trashBtn.onclick = () => {
    ctx.showTrash = !ctx.showTrash;
    ctx.render();
  };
  rail.appendChild(trashBtn);

  return rail;
}
