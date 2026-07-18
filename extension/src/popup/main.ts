import type { Folder } from "@shelve/shared";
import { type State, loadState, saveState, createEntry, pickDefaultWorkspaceId } from "@shelve/core/lib/storage";
import { pushResource } from "@shelve/core/lib/sync";
import { createFolderInteractive } from "@shelve/core/lib/actions";
import { getUiState } from "@shelve/core/lib/uiState";
import { applyTheme } from "@shelve/core/lib/theme";
import { setStore } from "@shelve/core/lib/store";
import { chromeStore } from "../lib/chromeStore";

type SaveMode = "current" | "all";
type View = "menu" | { mode: SaveMode };

setStore(chromeStore);
applyTheme((await getUiState()).theme);

const app = document.getElementById("app")!;
let view: View = "menu";

async function render() {
  app.replaceChildren(view === "menu" ? buildMenu() : await buildPicker(view.mode));
}

function menuButton(label: string, onclick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "menu-btn";
  btn.textContent = label;
  btn.onclick = onclick;
  return btn;
}

function buildMenu(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "popup";

  const title = document.createElement("div");
  title.className = "popup-title";
  title.textContent = "Shelve";
  wrap.appendChild(title);

  wrap.appendChild(
    menuButton("Save current tab", () => {
      view = { mode: "current" };
      render();
    }),
  );
  wrap.appendChild(
    menuButton("Save all tabs in this window", () => {
      view = { mode: "all" };
      render();
    }),
  );
  wrap.appendChild(
    menuButton("Open full UI", () => {
      // Independent of the "show on new tab" setting (see
      // extension/src/background/background.ts) — this always works,
      // whether or not new tabs are configured to open Shelve.
      chrome.tabs.create({ url: chrome.runtime.getURL("newtab/index.html") });
      window.close();
    }),
  );

  return wrap;
}

async function buildPicker(mode: SaveMode): Promise<HTMLElement> {
  const wrap = document.createElement("div");
  wrap.className = "popup";

  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = "← Back";
  backBtn.onclick = () => {
    view = "menu";
    render();
  };
  wrap.appendChild(backBtn);

  const title = document.createElement("div");
  title.className = "popup-title";
  title.textContent = mode === "current" ? "Save current tab to…" : "Save all tabs to…";
  wrap.appendChild(title);

  const state = await loadState();
  const workspaces = state.workspaces.filter((w) => w.deleted_at === null).sort((a, b) => a.position - b.position);

  const list = document.createElement("div");
  list.className = "folder-list";

  for (const ws of workspaces) {
    const folders = state.folders
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
      item.onclick = () => saveTo(state, folder, mode, status);
      list.appendChild(item);
    }
  }
  wrap.appendChild(list);

  const newFolderBtn = document.createElement("button");
  newFolderBtn.className = "menu-btn";
  newFolderBtn.textContent = "+ New Folder";
  newFolderBtn.onclick = async () => {
    const targetWorkspaceId = pickDefaultWorkspaceId(state);
    if (!targetWorkspaceId) return;
    const folder = await createFolderInteractive(state, targetWorkspaceId);
    if (!folder) return;
    await saveTo(state, folder, mode, status);
  };
  wrap.appendChild(newFolderBtn);

  const status = document.createElement("div");
  status.className = "popup-status";
  wrap.appendChild(status);

  return wrap;
}

async function saveTo(state: State, folder: Folder, mode: SaveMode, status: HTMLElement): Promise<void> {
  const tabs =
    mode === "current"
      ? await chrome.tabs.query({ active: true, currentWindow: true })
      : await chrome.tabs.query({ currentWindow: true });

  for (const tab of tabs) {
    if (!tab.url) continue;
    const entry = createEntry(state, folder.id, {
      url: tab.url,
      title: tab.title ?? tab.url,
      favicon_url: tab.favIconUrl ?? null,
    });
    void pushResource("entries", entry);
  }
  await saveState(state);

  status.textContent = `Saved to "${folder.name}".`;
  setTimeout(() => window.close(), 700);
}

render();
