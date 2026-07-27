import { type State, loadState, saveState, pickDefaultWorkspaceId } from "@shelve/core/lib/storage";
import { pullAndMerge, pushAll, onSyncStatusChange } from "@shelve/core/lib/sync";
import { getUiState, setUiState } from "@shelve/core/lib/uiState";
import { applyTheme } from "@shelve/core/lib/theme";
import { setStore } from "@shelve/core/lib/store";
import type { AppContext } from "@shelve/core/ui/context";
import { buildRail } from "@shelve/core/ui/rail";
import { buildToolbar } from "@shelve/core/ui/toolbar";
import { buildFolders } from "@shelve/core/ui/folders";
import { buildTrash } from "@shelve/core/ui/trash";
import { buildTabsPanel, watchTabs } from "./tabsPanel";
import { chromeStore } from "../lib/chromeStore";
import { chromeTabActions } from "../lib/chromeTabActions";

setStore(chromeStore);

let state: State = await loadState();
// The rest of startup (render() further down) must run even if the
// initial sync pull fails outright — an uncaught exception here is a
// top-level await rejection, which aborts the entire module and leaves
// #app permanently empty rather than falling back to local-only state
// (e.g. a misconfigured Worker URL causing an unexpected response shape,
// or any other unanticipated failure mode).
try {
  const merged = await pullAndMerge(state);
  if (merged) {
    state = merged;
    await saveState(state);
  }
} catch (e) {
  console.error("shelve: initial sync pull failed, continuing with local state", e);
}
// Catches records created locally but never successfully synced — most
// notably the default "Home" workspace from first run.
void pushAll(state);

const app = document.getElementById("app")!;

const uiState = await getUiState();
applyTheme(uiState.theme);

const ctx: AppContext = {
  state,
  uiState,
  activeWorkspaceId: pickDefaultWorkspaceId(state),
  searchQuery: "",
  showTrash: false,
  selectedTabIds: new Set(),
  selectedEntryIds: new Set(),
  render,
  rerender,
  persistUiState,
  tabActions: chromeTabActions,
  openSettings: () => chrome.runtime.openOptionsPage(),
};

// One-time: registers chrome.tabs.on* listeners for the live-updating
// tabs panel. Must run once at module scope, not from inside
// buildTabsPanel (which runs on every render) — registering there would
// stack a duplicate listener on every re-render.
watchTabs(ctx);

// One-time: re-renders the toolbar's sync status dot whenever a push/pull
// resolves — pushResource/pushDelete are fire-and-forget, so nothing else
// would otherwise trigger a render once one settles after the fact.
onSyncStatusChange(() => ctx.render());

// One-time: "/" focuses search from anywhere, unless a modal or the
// search box itself already has focus — otherwise it'd hijack typing "/"
// into a rename prompt, add-link URL field, etc. Queries fresh each
// keypress rather than caching a reference, since render() tears down
// and rebuilds the whole toolbar (including the search input) every time.
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "/") return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
  ev.preventDefault();
  document.querySelector<HTMLInputElement>(".search-input")?.focus();
});

async function rerender() {
  await saveState(ctx.state);
  render();
}

async function persistUiState() {
  await setUiState(ctx.uiState);
}

function render() {
  app.replaceChildren(buildLayout());
}

function buildLayout(): HTMLElement {
  const layout = document.createElement("div");
  layout.className = "layout";
  layout.appendChild(buildRail(ctx));
  layout.appendChild(buildMain());
  layout.appendChild(buildTabsPanel(ctx));
  return layout;
}

function buildMain(): HTMLElement {
  const main = document.createElement("div");
  main.className = "main";
  main.appendChild(buildToolbar(ctx));
  main.appendChild(ctx.showTrash ? buildTrash(ctx) : buildFolders(ctx));
  return main;
}

render();
