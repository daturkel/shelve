import { beforeEach, describe, expect, it } from "vitest";
import { getUiState, setUiState, type UiState } from "./uiState";
import { setStore } from "./store";
import { createMemoryStore } from "./testStore";

describe("getUiState", () => {
  beforeEach(() => setStore(createMemoryStore()));

  it("returns defaults on first run, with nothing stored yet", async () => {
    const state = await getUiState();
    expect(state).toEqual({
      collapsedFolderIds: [],
      showOnNewTab: true,
      leftCollapsed: false,
      rightCollapsed: false,
      closeTabOnSave: false,
      theme: "auto",
    });
  });

  it("merges a partial stored value over the defaults", async () => {
    const store = createMemoryStore();
    await store.set("shelve_ui_state", { showOnNewTab: false });
    setStore(store);
    const state = await getUiState();
    expect(state.showOnNewTab).toBe(false);
    expect(state.leftCollapsed).toBe(false);
  });
});

describe("setUiState / getUiState round-trip", () => {
  beforeEach(() => setStore(createMemoryStore()));

  it("persists a full UiState and reads it back unchanged", async () => {
    const custom: UiState = {
      collapsedFolderIds: ["f1", "f2"],
      showOnNewTab: false,
      leftCollapsed: true,
      rightCollapsed: true,
      closeTabOnSave: true,
      theme: "dark",
    };
    await setUiState(custom);
    await expect(getUiState()).resolves.toEqual(custom);
  });
});
