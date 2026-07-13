import { type State, loadState, saveState } from "../lib/storage";
import { pullAndMerge, pushAll } from "../lib/sync";
import { getUiState, setUiState } from "../lib/uiState";
import type { AppContext } from "./context";
import { buildRail } from "./rail";
import { buildToolbar } from "./toolbar";
import { buildFolders } from "./folders";
import { buildTabsPanel } from "./tabsPanel";

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
  leftCollapsed: false,
  rightCollapsed: false,
  searchQuery: "",
  render,
  rerender,
  persistUiState,
};

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
  main.appendChild(buildFolders(ctx));
  return main;
}

render();
