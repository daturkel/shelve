import { type State, loadState, saveState } from "../lib/storage";
import { pullAndMerge, pushAll, onSyncStatusChange } from "../lib/sync";
import { getUiState, setUiState } from "../lib/uiState";
import type { AppContext } from "./context";
import { buildRail } from "./rail";
import { buildToolbar } from "./toolbar";
import { buildFolders } from "./folders";
import { buildTabsPanel, watchTabs } from "./tabsPanel";
import { buildTrash } from "./trash";

let state: State = await loadState();
const merged = await pullAndMerge(state);
if (merged) {
  state = merged;
  await saveState(state);
}
// Catches records created locally but never successfully synced — most
// notably the default "Home" workspace from first run.
void pushAll(state);

const app = document.getElementById("app")!;

const ctx: AppContext = {
  state,
  uiState: await getUiState(),
  activeWorkspaceId: state.workspaces[0]?.id ?? "",
  searchQuery: "",
  showTrash: false,
  selectedTabIds: new Set(),
  selectedEntryIds: new Set(),
  render,
  rerender,
  persistUiState,
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
