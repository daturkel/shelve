import { createWorkspace, renameWorkspace } from "../lib/storage";
import { pushResource } from "../lib/sync";
import { showPrompt } from "../lib/modal";
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
    item.textContent = ws.name;
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
  trashBtn.textContent = "🗑 Trash";
  trashBtn.onclick = () => {
    ctx.showTrash = !ctx.showTrash;
    ctx.render();
  };
  rail.appendChild(trashBtn);

  return rail;
}
