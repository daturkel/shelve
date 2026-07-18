import type { Folder } from "@shelve/shared";
import { createFolderInteractive } from "../lib/actions";
import { buildOverlay } from "../lib/modal";
import type { AppContext } from "./context";

/** Same workspace-grouped folder list + "+ New Folder" shape as
 * popup/main.ts's buildPicker, generalized for reuse by any multi-select
 * "move/save to a folder" action (tabs-panel and entry selection both use
 * this) — the caller decides what actually happens once a folder is
 * picked, via `onPick`, rather than this knowing about tabs vs. entries. */
export function showFolderPickerModal(
  ctx: AppContext,
  title: string,
  onPick: (folder: Folder) => void | Promise<void>,
): void {
  const { overlay, box } = buildOverlay();

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = title;
  box.appendChild(titleEl);

  const list = document.createElement("div");
  list.className = "folder-list";

  const workspaces = ctx.state.workspaces.filter((w) => w.deleted_at === null).sort((a, b) => a.position - b.position);

  for (const ws of workspaces) {
    const folders = ctx.state.folders
      .filter((f) => f.workspace_id === ws.id && f.deleted_at === null)
      .sort((a, b) => a.position - b.position);
    if (folders.length === 0) continue;

    const wsLabel = document.createElement("div");
    wsLabel.className = "workspace-label";
    wsLabel.textContent = ws.name;
    list.appendChild(wsLabel);

    for (const folder of folders) {
      const item = document.createElement("div");
      item.className = "folder-item";
      item.textContent = folder.name;
      item.onclick = async () => {
        overlay.remove();
        await onPick(folder);
      };
      list.appendChild(item);
    }
  }
  box.appendChild(list);

  const newFolderBtn = document.createElement("button");
  newFolderBtn.className = "new-folder-btn";
  newFolderBtn.textContent = "+ New Folder";
  newFolderBtn.onclick = async () => {
    const folder = await createFolderInteractive(ctx.state, ctx.activeWorkspaceId);
    if (!folder) return;
    overlay.remove();
    await onPick(folder);
  };
  box.appendChild(newFolderBtn);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "modal-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  actions.appendChild(cancelBtn);
  box.appendChild(actions);

  overlay.onclick = (ev) => {
    if (ev.target === overlay) overlay.remove();
  };
}
