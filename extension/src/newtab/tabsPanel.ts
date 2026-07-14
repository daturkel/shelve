import type { Folder } from "@shelve/shared";
import { createEntry } from "../lib/storage";
import { pushResource } from "../lib/sync";
import { createFolderInteractive } from "../lib/actions";
import { buildOverlay } from "../lib/modal";
import { buildFaviconEl } from "../lib/favicon";
import type { AppContext } from "./context";

const TAB_MIME = "application/x-shelve-tab";
const REORDER_TAB_MIME = "application/x-shelve-tab-reorder";

interface DraggedTab {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
}

// ---------- Live updates ----------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Registers chrome.tabs.on* listeners once, so the panel reflects tabs
 * closed/reordered/created elsewhere without a manual reload. Must be
 * called exactly once at module scope (see main.ts) — calling it from
 * buildTabsPanel, which runs on every render, would stack a duplicate
 * listener on every re-render. onUpdated in particular fires many times
 * per navigation (loading, favicon, title), so renders are debounced
 * rather than triggered per event. */
export function watchTabs(ctx: AppContext): void {
  const refresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const tabs = await chrome.tabs.query({});
      const liveIds = new Set(tabs.map((t) => t.id).filter((id): id is number => id !== undefined));
      for (const id of ctx.selectedTabIds) {
        if (!liveIds.has(id)) ctx.selectedTabIds.delete(id);
      }
      ctx.render();
    }, 150);
  };

  chrome.tabs.onCreated.addListener(refresh);
  chrome.tabs.onRemoved.addListener(refresh);
  chrome.tabs.onUpdated.addListener(refresh);
  chrome.tabs.onMoved.addListener(refresh);
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onAttached.addListener(refresh);
  chrome.tabs.onDetached.addListener(refresh);
}

// ---------- Right panel: live open tabs ----------

export function buildTabsPanel(ctx: AppContext): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "tabs-panel" + (ctx.uiState.rightCollapsed ? " collapsed" : "");

  const header = document.createElement("div");
  header.className = "tabs-panel-header";
  header.textContent = "OPEN TABS";
  panel.appendChild(header);

  chrome.tabs.query({}).then((tabs) => {
    const byWindow = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of tabs) {
      const windowId = tab.windowId ?? 0;
      if (!byWindow.has(windowId)) byWindow.set(windowId, []);
      byWindow.get(windowId)!.push(tab);
    }

    let windowIndex = 1;
    for (const [, windowTabs] of byWindow) {
      const windowSection = document.createElement("div");
      windowSection.className = "tab-window";

      const windowTitle = document.createElement("div");
      windowTitle.className = "tab-window-title";
      windowTitle.textContent = `Window ${windowIndex++}`;
      windowSection.appendChild(windowTitle);

      for (const tab of windowTabs) {
        windowSection.appendChild(buildTabItem(ctx, tab, tabs));
      }

      panel.appendChild(windowSection);
    }

    setUpTabReordering(panel);

    if (ctx.selectedTabIds.size > 0) {
      panel.appendChild(buildSelectionBar(ctx, tabs));
    }
  });

  return panel;
}

function buildTabItem(ctx: AppContext, tab: chrome.tabs.Tab, allTabs: chrome.tabs.Tab[]): HTMLElement {
  const selected = tab.id !== undefined && ctx.selectedTabIds.has(tab.id);

  const el = document.createElement("div");
  el.className = "tab-item" + (selected ? " selected" : "");
  el.draggable = true;
  if (tab.id !== undefined) el.dataset.tabId = String(tab.id);
  if (tab.windowId !== undefined) el.dataset.windowId = String(tab.windowId);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "tab-checkbox";
  checkbox.checked = selected;
  checkbox.onclick = (ev) => {
    ev.stopPropagation();
    if (tab.id === undefined) return;
    if (checkbox.checked) ctx.selectedTabIds.add(tab.id);
    else ctx.selectedTabIds.delete(tab.id);
    ctx.render();
  };
  el.appendChild(checkbox);

  el.appendChild(buildFaviconEl(tab.favIconUrl));

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = tab.title || tab.url || "Untitled";
  el.appendChild(title);

  const close = document.createElement("div");
  close.className = "tab-close";
  close.textContent = "✕";
  close.title = "Close tab";
  close.onclick = (ev) => {
    ev.stopPropagation();
    if (tab.id !== undefined) void chrome.tabs.remove(tab.id);
  };
  el.appendChild(close);

  // Click anywhere else on the row focuses the tab (and its window) —
  // checkbox/close opt out via stopPropagation above, same guard style
  // as .entry's click handler skipping its own edit/delete buttons.
  el.onclick = (ev) => {
    if (ev.target === checkbox || ev.target === close) return;
    if (tab.id !== undefined) void chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) void chrome.windows.update(tab.windowId, { focused: true });
  };

  // Sets both MIME types on one drag gesture: TAB_MIME (dropped on a
  // folder → save) and REORDER_TAB_MIME (dropped within this panel →
  // reorder/move). Each drop zone only reads the one it cares about.
  el.ondragstart = (ev) => {
    if (tab.id === undefined) return;
    const draggedTabs =
      selected && ctx.selectedTabIds.size > 1
        ? allTabs.filter((t) => t.id !== undefined && ctx.selectedTabIds.has(t.id))
        : [tab];
    const payload: DraggedTab[] = draggedTabs.map((t) => ({
      id: t.id!,
      url: t.url ?? "",
      title: t.title || t.url || "Untitled",
      favIconUrl: t.favIconUrl,
    }));
    ev.dataTransfer?.setData(TAB_MIME, JSON.stringify(payload));
    ev.dataTransfer?.setData(REORDER_TAB_MIME, String(tab.id));
    ev.dataTransfer!.effectAllowed = "copyMove";

    // Otherwise the browser's default drag image is just this one tile,
    // giving no hint that dragging it is actually about to bring several
    // tabs along. setDragImage needs the element attached and rendered
    // (even off-screen) at the moment it's called — the browser snapshots
    // it synchronously, so it's safe to remove right after.
    if (draggedTabs.length > 1) {
      const badge = document.createElement("div");
      badge.className = "tab-drag-badge";
      badge.textContent = `${draggedTabs.length} tabs`;
      document.body.appendChild(badge);
      ev.dataTransfer?.setDragImage(badge, 16, 16);
      setTimeout(() => badge.remove(), 0);
    }
  };

  return el;
}

// Tab-reorder insertion line — same single-shared-indicator/
// closestBoundary shape as setUpFolderReordering in folders.ts, but tab
// items are nested one level deeper (panel > .tab-window > .tab-item,
// not direct children of the drop container), so the indicator has to
// be inserted into the target's own parent rather than the panel itself.
function setUpTabReordering(panel: HTMLElement): void {
  const indicator = document.createElement("div");
  indicator.className = "folder-drop-indicator";

  function closestBoundary(ev: DragEvent): HTMLElement | null {
    const items = Array.from(panel.querySelectorAll<HTMLElement>(".tab-item"));
    return (
      items.find((item) => {
        const rect = item.getBoundingClientRect();
        return ev.clientY < rect.top + rect.height / 2;
      }) ?? null
    );
  }

  function showIndicator(target: HTMLElement | null): void {
    if (target) {
      target.parentElement!.insertBefore(indicator, target);
      return;
    }
    const windows = panel.querySelectorAll<HTMLElement>(".tab-window");
    windows[windows.length - 1]?.appendChild(indicator);
  }

  panel.ondragover = (ev) => {
    if (!ev.dataTransfer?.types.includes(REORDER_TAB_MIME)) return;
    ev.preventDefault();
    showIndicator(closestBoundary(ev));
  };
  panel.ondragleave = (ev) => {
    if (!panel.contains(ev.relatedTarget as Node | null)) indicator.remove();
  };
  panel.ondrop = async (ev) => {
    const draggedIdStr = ev.dataTransfer?.getData(REORDER_TAB_MIME);
    const target = closestBoundary(ev);
    indicator.remove();
    if (!draggedIdStr) return;
    ev.preventDefault();

    const draggedId = Number(draggedIdStr);
    if (target?.dataset.tabId === draggedIdStr) return; // dropped back on itself

    const allItems = Array.from(panel.querySelectorAll<HTMLElement>(".tab-item"));
    const targetWindowId = target
      ? Number(target.dataset.windowId)
      : Number(allItems[allItems.length - 1]?.dataset.windowId);
    if (Number.isNaN(targetWindowId)) return;

    const targetWindowTabIds = allItems
      .filter((el) => Number(el.dataset.windowId) === targetWindowId)
      .map((el) => Number(el.dataset.tabId))
      .filter((id) => id !== draggedId);
    const targetIndex = target ? targetWindowTabIds.indexOf(Number(target.dataset.tabId)) : targetWindowTabIds.length;

    await chrome.tabs.move(draggedId, { windowId: targetWindowId, index: targetIndex });
  };
}

// ---------- Multi-select action bar + folder picker ----------

function buildSelectionBar(ctx: AppContext, tabs: chrome.tabs.Tab[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "tabs-selection-bar";

  const count = document.createElement("div");
  count.className = "tabs-selection-count";
  const n = ctx.selectedTabIds.size;
  count.textContent = `${n} selected`;
  bar.appendChild(count);

  const actions = document.createElement("div");
  actions.className = "tabs-selection-actions";

  const addBtn = document.createElement("button");
  addBtn.className = "tabs-selection-btn";
  addBtn.textContent = "Add to folder";
  addBtn.onclick = () => showFolderPickerModal(ctx, tabs);
  actions.appendChild(addBtn);

  const newFolderBtn = document.createElement("button");
  newFolderBtn.className = "tabs-selection-btn";
  newFolderBtn.textContent = "New folder";
  newFolderBtn.onclick = async () => {
    const folder = await createFolderInteractive(ctx.state, ctx.activeWorkspaceId);
    if (!folder) return;
    await saveSelectedTabsTo(ctx, folder, tabs);
  };
  actions.appendChild(newFolderBtn);

  const clearBtn = document.createElement("button");
  clearBtn.className = "tabs-selection-clear";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear selection";
  clearBtn.onclick = () => {
    ctx.selectedTabIds.clear();
    ctx.render();
  };
  actions.appendChild(clearBtn);

  bar.appendChild(actions);
  return bar;
}

/** Same workspace-grouped folder list + "+ New Folder" shape as
 * popup/main.ts's buildPicker, rebuilt here rather than shared — the two
 * contexts save different things (selected tabs vs. current/all tabs)
 * and live in separate pages. */
function showFolderPickerModal(ctx: AppContext, tabs: chrome.tabs.Tab[]): void {
  const { overlay, box } = buildOverlay();

  const title = document.createElement("div");
  title.className = "modal-title";
  const n = ctx.selectedTabIds.size;
  title.textContent = `Add ${n} tab${n === 1 ? "" : "s"} to…`;
  box.appendChild(title);

  const list = document.createElement("div");
  list.className = "folder-list";

  const workspaces = ctx.state.workspaces
    .filter((w) => w.deleted_at === null)
    .sort((a, b) => a.position - b.position);

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
        await saveSelectedTabsTo(ctx, folder, tabs);
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
    await saveSelectedTabsTo(ctx, folder, tabs);
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

async function saveSelectedTabsTo(ctx: AppContext, folder: Folder, tabs: chrome.tabs.Tab[]): Promise<void> {
  const selected = tabs.filter((t) => t.id !== undefined && ctx.selectedTabIds.has(t.id));

  const created = selected.map((t) =>
    createEntry(ctx.state, folder.id, {
      url: t.url,
      title: t.title || t.url,
      favicon_url: t.favIconUrl ?? null,
    }),
  );
  await ctx.rerender();
  for (const entry of created) void pushResource("entries", entry);

  if (ctx.uiState.closeTabOnSave) {
    const ids = selected.map((t) => t.id).filter((id): id is number => id !== undefined);
    if (ids.length > 0) void chrome.tabs.remove(ids);
  }

  ctx.selectedTabIds.clear();
  ctx.render();
}
