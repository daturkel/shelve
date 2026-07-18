// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Folder } from "@shelve/shared";
import type { State } from "@shelve/core/lib/storage";
import { setStore } from "@shelve/core/lib/store";
import { createMemoryStore } from "@shelve/core/lib/testStore";
import type { AppContext, TabActions } from "@shelve/core/ui/context";
import { buildTabsPanel, saveSelectedTabsTo } from "./tabsPanel";

// Regression coverage for a real bug: both of these call sites used to
// call chrome.tabs.remove directly instead of the ctx.tabActions.close
// seam this repo introduced specifically so tab-closing goes through one
// platform-agnostic path — see extension/src/lib/chromeTabActions.ts.

function emptyState(): State {
  return { workspaces: [], folders: [], entries: [] };
}

function fakeTabActions(): TabActions {
  return { open: vi.fn(), close: vi.fn() };
}

function fakeContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    state: emptyState(),
    uiState: {
      collapsedFolderIds: [],
      showOnNewTab: true,
      leftCollapsed: false,
      rightCollapsed: false,
      closeTabOnSave: false,
      theme: "auto",
    },
    activeWorkspaceId: "",
    searchQuery: "",
    showTrash: false,
    selectedTabIds: new Set(),
    selectedEntryIds: new Set(),
    render: vi.fn(),
    rerender: vi.fn().mockResolvedValue(undefined),
    persistUiState: vi.fn().mockResolvedValue(undefined),
    tabActions: fakeTabActions(),
    openSettings: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  setStore(createMemoryStore());
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, windowId: 1, title: "Example", url: "https://example.com" }]),
      remove: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      onCreated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
      onMoved: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
      onAttached: { addListener: vi.fn() },
      onDetached: { addListener: vi.fn() },
    },
  };
});

describe("buildTabsPanel's close button", () => {
  it("closes a tab via ctx.tabActions.close, not chrome.tabs.remove directly", async () => {
    const ctx = fakeContext();
    const panel = buildTabsPanel(ctx);
    document.body.appendChild(panel);
    await vi.waitFor(() => expect(panel.querySelector(".tab-close")).not.toBeNull());

    panel.querySelector<HTMLElement>(".tab-close")!.click();

    expect(ctx.tabActions.close).toHaveBeenCalledWith([1]);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });
});

describe("saveSelectedTabsTo", () => {
  it("closes saved tabs via ctx.tabActions.close when closeTabOnSave is on, not chrome.tabs.remove directly", async () => {
    const ctx = fakeContext({ selectedTabIds: new Set([1]) });
    ctx.uiState.closeTabOnSave = true;
    const folder: Folder = {
      id: "f1",
      workspace_id: "ws1",
      name: "Folder",
      position: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
    };
    const tabs = [{ id: 1, windowId: 1, title: "Example", url: "https://example.com" }] as chrome.tabs.Tab[];

    await saveSelectedTabsTo(ctx, folder, tabs);

    expect(ctx.tabActions.close).toHaveBeenCalledWith([1]);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it("does not close tabs when closeTabOnSave is off", async () => {
    const ctx = fakeContext({ selectedTabIds: new Set([1]) });
    const folder: Folder = {
      id: "f1",
      workspace_id: "ws1",
      name: "Folder",
      position: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
    };
    const tabs = [{ id: 1, windowId: 1, title: "Example", url: "https://example.com" }] as chrome.tabs.Tab[];

    await saveSelectedTabsTo(ctx, folder, tabs);

    expect(ctx.tabActions.close).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });
});
