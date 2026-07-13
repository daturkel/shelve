import type { Folder } from "@shelve/shared";
import { type State, createFolder } from "./storage";
import { pushResource } from "./sync";
import { showPrompt } from "./modal";

/** Prompt for a folder name and create it, pushing the new record to sync.
 * Shared by every "+ New Folder" entry point (newtab toolbar, newtab
 * empty-state tab drop, popup) so the prompt/create/push sequence lives in
 * one place. Returns null if the user cancels the prompt. */
export async function createFolderInteractive(
  state: State,
  workspaceId: string,
): Promise<Folder | null> {
  const name = await showPrompt("New folder");
  if (!name) return null;
  const folder = createFolder(state, workspaceId, name);
  void pushResource("folders", folder);
  return folder;
}
