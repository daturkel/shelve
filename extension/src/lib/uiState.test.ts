import { beforeEach, describe, expect, it } from "vitest";
import { getUiState, setUiState, type UiState } from "./uiState";

// Same minimal in-memory chrome.storage.local mock as storage.test.ts.
function installChromeStorageMock() {
  const store = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
      },
    },
  };
}

describe("getUiState", () => {
  beforeEach(() => installChromeStorageMock());

  it("returns defaults on first run, with nothing stored yet", async () => {
    const state = await getUiState();
    expect(state).toEqual({
      collapsedFolderIds: [],
      showOnNewTab: true,
      leftCollapsed: false,
      rightCollapsed: false,
      closeTabOnSave: false,
    });
  });

  it("merges a partial stored value over the defaults", async () => {
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: async () => ({ shelve_ui_state: { showOnNewTab: false } }),
          set: async () => {},
        },
      },
    };
    const state = await getUiState();
    expect(state.showOnNewTab).toBe(false);
    expect(state.leftCollapsed).toBe(false);
  });
});

describe("setUiState / getUiState round-trip", () => {
  beforeEach(() => installChromeStorageMock());

  it("persists a full UiState and reads it back unchanged", async () => {
    const custom: UiState = {
      collapsedFolderIds: ["f1", "f2"],
      showOnNewTab: false,
      leftCollapsed: true,
      rightCollapsed: true,
      closeTabOnSave: true,
    };
    await setUiState(custom);
    await expect(getUiState()).resolves.toEqual(custom);
  });
});
