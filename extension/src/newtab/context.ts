import type { State } from "../lib/storage";
import type { UiState } from "../lib/uiState";

/** Shared mutable app state passed to every builder function, so the
 * newtab UI can be split across files without a framework: each module
 * reads/writes the same ctx object rather than closing over its own copy
 * of module-level state. */
export interface AppContext {
  state: State;
  uiState: UiState;
  activeWorkspaceId: string;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  searchQuery: string;
  /** Re-render from current in-memory state, without persisting. */
  render: () => void;
  /** Persist state, then re-render. */
  rerender: () => Promise<void>;
  /** Persist uiState only (collapsed folders, showOnNewTab, etc). */
  persistUiState: () => Promise<void>;
}
