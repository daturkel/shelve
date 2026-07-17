import { describe, it, expect, vi, beforeEach } from "vitest";
import type { State } from "./storage";

const showPromptMock = vi.fn();
const pushResourceMock = vi.fn();

vi.mock("./modal", () => ({
  showPrompt: (...args: unknown[]) => showPromptMock(...args),
}));
vi.mock("./sync", () => ({
  pushResource: (...args: unknown[]) => pushResourceMock(...args),
}));

const { createFolderInteractive } = await import("./actions");

function emptyState(): State {
  return { workspaces: [], folders: [], entries: [] };
}

describe("createFolderInteractive", () => {
  beforeEach(() => {
    showPromptMock.mockReset();
    pushResourceMock.mockReset();
  });

  it("creates and pushes a folder when the user enters a name", async () => {
    showPromptMock.mockResolvedValue("My Folder");
    const state = emptyState();

    const folder = await createFolderInteractive(state, "ws1");

    expect(folder).not.toBeNull();
    expect(folder?.name).toBe("My Folder");
    expect(folder?.workspace_id).toBe("ws1");
    expect(state.folders).toContain(folder);
    expect(pushResourceMock).toHaveBeenCalledWith("folders", folder);
  });

  it("returns null and creates nothing when the prompt is cancelled", async () => {
    showPromptMock.mockResolvedValue(null);
    const state = emptyState();

    const folder = await createFolderInteractive(state, "ws1");

    expect(folder).toBeNull();
    expect(state.folders).toHaveLength(0);
    expect(pushResourceMock).not.toHaveBeenCalled();
  });
});
