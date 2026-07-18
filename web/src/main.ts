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
import { webStore, onRemoteChange } from "./webStore";
import { webTabActions } from "./webTabActions";
import { buildSettings } from "./settings";

setStore(webStore);

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

const uiState = await getUiState();
applyTheme(uiState.theme);

// uiState.leftCollapsed's persisted default is false (sized for the
// extension's fixed desktop layout) — on a narrow viewport the rail
// renders as a position: fixed overlay drawer (see style.css), so
// "not collapsed" means it covers most of the screen on first load.
// Force it closed on mobile every session rather than persisting this
// as a real preference override — matches how virtually every mobile
// drawer nav starts closed, regardless of a desktop session's setting.
if (window.matchMedia("(max-width: 768px)").matches) {
  uiState.leftCollapsed = true;
}

// Web-only view state — openSettings toggles this rather than being a
// new field on the shared AppContext, mirroring how popup/main.ts
// already keeps its own local `view` state outside any AppContext.
let showSettings = false;

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
  tabActions: webTabActions,
  openSettings: () => {
    showSettings = true;
    void render();
  },
};

// One-time: re-renders the toolbar's sync status dot whenever a push/pull
// resolves — pushResource/pushDelete are fire-and-forget, so nothing else
// would otherwise trigger a render once one settles after the fact.
onSyncStatusChange(() => void render());

// One-time: reload in-memory state and re-render when another same-origin
// tab changes the store — see webStore.ts's onRemoteChange doc comment.
// Skipped while a modal is open: a handler like folders.ts's
// renameFolderInteractive captures a record reference, awaits the modal,
// then mutates and pushes that same reference — if ctx.state were
// wholesale-replaced with a fresh object graph while the modal is open,
// the mutation would land on the new graph but the push would still use
// the old, now-orphaned, unmutated reference, sending stale data to the
// Worker. Deferring the reload until no modal is open (it'll pick up the
// change on the next natural render instead) closes that window.
onRemoteChange(() => {
  void (async () => {
    if (document.querySelector(".modal-overlay")) return;
    ctx.state = await loadState();
    await render();
  })();
});

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
  await render();
}

async function persistUiState() {
  // core/ui/toolbar.ts's ☰ toggle (shared with the extension) flips and
  // persists uiState.leftCollapsed unconditionally — the same field
  // main.ts overloads as "is the mobile drawer open" on narrow
  // viewports. Persisting a mobile drawer toggle as-is would clobber
  // the desktop sidebar-visibility preference stored under that same
  // key, surprising a user who later opens the same browser profile at
  // desktop width. On mobile, persist everything else but keep
  // whatever was last saved for leftCollapsed.
  if (window.matchMedia("(max-width: 768px)").matches) {
    const stored = await getUiState();
    await setUiState({ ...ctx.uiState, leftCollapsed: stored.leftCollapsed });
    return;
  }
  await setUiState(ctx.uiState);
}

async function render() {
  app.replaceChildren(await buildLayout());
}

async function buildLayout(): Promise<HTMLElement> {
  const layout = document.createElement("div");
  layout.className = "layout";
  layout.appendChild(buildRail(ctx));
  layout.appendChild(await buildMain());
  return layout;
}

async function buildMain(): Promise<HTMLElement> {
  const main = document.createElement("div");
  main.className = "main";
  if (showSettings) {
    main.appendChild(
      await buildSettings(ctx.uiState, () => {
        showSettings = false;
        void render();
      }),
    );
    return main;
  }
  main.appendChild(buildToolbar(ctx));
  main.appendChild(ctx.showTrash ? buildTrash(ctx) : buildFolders(ctx));
  return main;
}

await render();
