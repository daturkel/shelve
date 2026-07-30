# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/) once it reaches its first release.

## [Unreleased]

### Changed

- `npm run setup`/`npm run upgrade` are now `npm run wizard:deploy` (does both, adapting to whatever's already configured — the old scripts' "already configured" branch always just called the same migrate-and-redeploy logic anyway) and `npm run wizard:status` (new — a pure read-only report of what's already deployed, no prompts). The wizard now only asks for confirmation before something that can actually change your Cloudflare account: read-only lookups (`wrangler whoami`, `d1 list`, `pages project list`, a local `npm run build`) no longer prompt at all, and each phase's writes are grouped into one plan confirmed once instead of a question per command. It never auto-picks an existing Cloudflare resource, even when there's only one candidate — it always asks, or (new) takes explicit `--database=`/`--worker-name=`/`--pages-project=` flags for non-interactive/scripted use via a new `--yes` flag, which itself requires one of those flags rather than guessing whenever the corresponding resource isn't already known. Also new: `--dry-run` (print the plan, run nothing), `--web`/`--no-web` and `--extension`/`--no-extension` (skip the interactive prompts for those phases), `--rotate-token`/`--no-rotate-token`, and a check for whether a given `--worker-name` already has live deployments before redeploying over it (`wrangler deploy` is silently create-or-update with no distinction surfaced otherwise). `npm run wizard:deploy` can now also build the Chrome extension itself (`--no-extension` to skip), rather than only ever telling you to build it yourself. See [SETUP.md](docs/SETUP.md#flags) for the full flag list.

### Added

- Switching a device to a different Worker URL now prompts for confirmation and resets local state to a fresh single-workspace state before saving the new config (`resetState()`, `core/lib/storage.ts`), in both the web app and extension options pages — previously local state was left untouched, so the next sync pull merged the old backend's data into the new one instead of starting fresh. The reset only happens once the new Worker is confirmed reachable, so a bad or unreachable URL/token can't wipe local data with no way to recover it. The confirm dialog itself (`buildSwitchWarning()`, factored out of both settings screens into `core/lib/sync.ts` since it was byte-identical in each) checks the _old_ Worker for whether local state actually has anything unsynced to it, via a new `countUnsyncedState()`, and tailors its wording to what's genuinely at risk instead of a blanket warning — falling back to the generic wording if the old Worker can't be reached to check.

### Fixed

- Switching to a different Worker mid-session without a page reload (the extension's options page) kept applying the old Worker's schema-compatibility verdict to the new one, since `checkCompatibility()`'s cache had no key — silently letting writes through to an incompatible Worker, or blocking a compatible one. Now keyed by Worker URL.
- A fresh or wiped device could resurrect an intentionally-deleted default workspace. `initState()`'s auto-created "Home" workspace uses a fixed, well-known id (`"default"`) so two never-before-synced devices converge on the same record instead of ending up with two separate "Home" workspaces — but it stamped `updated_at` with `Date.now()`, and both `mergeArray()` and the Worker's own upsert-by-recency let the newer `updated_at` win, so that timestamp would always out-recency (and silently undo) a soft-delete of that same id that had happened at any point in the past on another device. Now stamped with `0` instead: it still converges devices that have never synced anything for that id, but always loses to any genuine remote record — deleted or not — since nothing real can have `updated_at` less than `0`. `created_at` is unaffected (still the real creation time; nothing keys merge/recency off it).
- Storage-write failures in the folder-browser UI (create/rename/delete/move/reorder on folders, entries, and workspaces, plus trash restore/permanent-delete) are no longer silent. Every mutation there is optimistic — state is mutated and re-rendered before the write to persistent storage is known to have succeeded — so a rejected write (storage quota exceeded, a blocked IndexedDB/`chrome.storage.local` transaction) previously left the change looking like it worked, only to quietly revert on the next reload with no indication anything had gone wrong. `ctx.rerender()`/`ctx.persistUiState()` (`web/src/main.ts`, `extension/src/newtab/main.ts`) now catch that failure via a shared `persistOrRevert()` helper (`core/lib/persist.ts`): the in-memory state is rolled back to whatever's actually persisted and a dismissible error toast (`core/lib/modal.ts`'s `showErrorToast()`) reports it immediately, matching how the settings screens' Save/Disconnect already surfaced this class of failure. `ctx.rerender()` now also reports back whether the write succeeded, so callers that push the same mutation to the sync server afterward (`core/ui/folders.ts`, `rail.ts`, `trash.ts`) skip that push on a reverted write instead of pushing a change to the Worker that the local copy just undid.

## [0.5.0] - 2026-07-29

### Added

- The web app's manual "Add link" flow now auto-fetches a title and favicon like the extension does, via a new Worker route (`GET /link-metadata`, `worker/src/linkMetadata.ts`) that fetches the target URL server-side using the native `HTMLRewriter` API — Workers aren't subject to browser CORS, unlike a plain client-side fetch from a web page, which fails for most ordinary sites. Prefers `og:title`/`twitter:title` over `<title>` when present. Same bearer-token auth as every other route, and the same best-effort-degrades-to-nulls contract the direct-fetch version already had, so the manual-title fallback still exists for whatever it can't find. The extension is unchanged — its direct fetch already works better there (no extra hop, no Worker dependency for a feature that has none today) — via a new swappable seam in `core/lib/linkMetadata.ts` (`setLinkMetadataFetcher()`, same shape as `Store`/`setStore()`).

## [0.4.0] - 2026-07-28

### Added

- Permanently delete from Trash — per-item ("Delete forever"), multi-select, and "Empty trash" — cascading to everything under a permanently-deleted workspace/folder via a new `folders.workspace_id`/`entries.folder_id ON DELETE CASCADE` (`worker/migrations/0003_cascade_delete.sql`, `SCHEMA_VERSION` 2 → 3), so a single request removes an entire subtree atomically rather than the client having to compute and order a multi-request cascade itself. Only ever valid on an already-soft-deleted record — the Worker enforces this server-side too, as a backstop. The trash view now groups a deleted workspace/folder's still-trashed descendants into one collapsible row ("Folder X — N items") instead of listing every one individually, to avoid flooding the view; expanding shows each descendant individually, still restorable/permanently-deletable on its own.
- The app now reopens on whichever workspace was last active on that device (`UiState.lastActiveWorkspaceId`), instead of always defaulting to whichever workspace sorts first — so a device mostly used for one particular workspace (e.g. a work computer) naturally stays there across reloads. Device-local, same as other UI preferences; falls back to the old first-by-position behavior if the last-active workspace no longer exists.
- The setup wizard (`npm run setup`/`npm run upgrade`) now checks that a Pages deploy actually landed as Production and warns with the specific mismatched branch if not — `--production-branch main` only takes effect when a Pages project is first created, so it silently no-ops against a project that already existed, and a deploy could land as Preview with the stable `<project>.pages.dev` URL never updating and no error shown anywhere.

### Fixed

- A permanently-deleted record (trash → "Delete forever"/"Empty trash") could come back on every other device that had already synced it before the deletion — `mergeArray()`'s pull-side merge never dropped a record just because it was absent from a pull (by design, to protect not-yet-pushed local records), but that same rule meant a hard-removed row had no `updated_at` to win a merge with, so it could never disappear anywhere except the device that deleted it. Now dropped locally when it's already soft-deleted and missing from a full remote snapshot — the only way that combination can occur, since `GET /state` always includes soft-deleted rows.
- The trash view's expand/collapse arrow (▸/▾) rendered noticeably smaller than the same glyph in the main folder list — it had never gotten the folder view's font-size/alignment treatment.
- The workspace rail no longer leaves a workspace looking selected while Trash (which is global, not scoped to any one workspace) is open.
- The web app's Settings screen could get stuck in an apparent infinite loop of `/health` requests when opened: `apiFetch()` flipped the app's sync status on every request including diagnostic `/health` checks, which triggered a full re-render — and since Settings re-checks `/health` on every mount, that re-render triggered another check, forever. `/health` no longer affects sync status.
- Both settings screens (extension options, web app) now use a real `<form>` with `id`/`name`/`autocomplete` on the Worker URL and API token fields, so password managers can actually recognize and fill them — previously there was nothing to key off besides the token field's `type="password"`.
- The "schema is out of date" warning on both settings screens referenced "README.md's Upgrading section" as plain, unclickable text (and pointed at the wrong file besides — that section has since moved to docs/SETUP.md). Now a real link, straight to the section on GitHub.
- The web app's Settings screen could silently wipe its own "Saved, but couldn't connect" message before you could read it: a failed connection-test request flipped sync status, which triggered a full re-render even though Settings doesn't show the toolbar's status dot it was meant to update.

## [0.3.0] - 2026-07-27

### Added

- Unit tests for `lib/uiState.ts`, `lib/config.ts`, `lib/actions.ts`, and `lib/favicon.ts` (previously untested), plus new `lib/url.ts`, `lib/time.ts`, and `lib/backupFile.ts` modules extracted from DOM-heavy builder files (`newtab/folders.ts`, `newtab/toolbar.ts`, `options/main.ts`) so their pure logic is testable in isolation — no behavior change.
- A small Playwright end-to-end smoke suite (`extension/e2e/`) that loads the real built extension into a real Chromium instance and drives it through the UI — folder/link creation and reload-persistence, and entry multi-select's action bar and delete flow — now running as its own CI job (`npm run test:e2e --workspace=extension`, under `xvfb` since loading an MV3 extension needs headed Chromium).
- Light/dark/auto theme toggle on the options page, applied consistently across newtab, popup, and options. "Auto" (the default) follows the OS-level `prefers-color-scheme`; "Light"/"Dark" override it explicitly. The choice is device-local (not synced), same as other UI preferences.
- New `core/` workspace holding everything platform-agnostic — local storage/CRUD, sync, the in-window modal, Toby import/export, link metadata, ui state, and nearly all of the folder-browser's DOM-builder code — extracted from the extension behind two small seams (`Store` for persistence, `TabActions` for opening/closing real browser tabs) so a future lightweight web/PWA surface is purely additive (new adapter implementations + a new entry point) rather than a further refactor. No user-visible behavior change; see [ARCHITECTURE.md](docs/ARCHITECTURE.md#code-layout) for the design.
- A responsive web app (`web/`), optional to deploy (via Cloudflare Pages — see [README.md](README.md#setup)), sharing `core/` with the extension: full folder/entry CRUD (create/rename/delete/move, search, trash/restore), the same light/dark/auto theme and visual design as the extension, and a settings screen for Worker URL/token, backup, and Toby import/export. Local-first via IndexedDB (mirroring the extension's `chrome.storage.local`), with a `BroadcastChannel`-based reconciliation so multiple open tabs pick up each other's changes rather than silently diverging. The extension's `chrome.tabs`-only features (the live open-tabs panel, one-click popup save, drag-and-drop reordering) have no web equivalent — see [KNOWN_GAPS.md](docs/KNOWN_GAPS.md) for what's intentionally deferred.
- CORS support on the Worker (`worker/src/index.ts`) — required for the web app above, since a web page (unlike the extension) is subject to normal browser cross-origin restrictions. Existing deployments need a fresh `wrangler deploy` to pick this up if they plan to use the web app; the extension itself is unaffected.
- `npm run setup`/`npm run upgrade` (`scripts/wizard/`) — interactive wizards that drive Worker/D1/web-app deployment and upgrades, printing and confirming every command before running it, generating and setting `API_TOKEN` directly, detecting existing D1 databases/Worker config so re-running is safe, and adopting a manually-deployed web app into future upgrades if you tell it the Pages project name. The full manual step-by-step now lives in [SETUP.md](docs/SETUP.md).
- Delete a workspace (rail sidebar, hover-revealed "×", with a confirm dialog) — soft-deletes it and cascades to its folders/entries the same way deleting a folder cascades to its entries, restorable from Trash with everything intact. Hidden whenever it's the only remaining workspace, since nothing in the UI expects a workspace-less state. Also fixes: the app picking whichever workspace happened to be first in local array order (reflecting merge/sync history, not display order) as the default active one on load, instead of the first by display position — most noticeable after a device's very first sync, or once a stray/duplicate workspace is deleted.

### Fixed

- Both settings screens now validate the Worker URL has an `http(s)://` scheme before saving — previously a typo like a missing `https://` failed silently (`fetch()` resolves a schemeless string as a same-origin relative path rather than rejecting it), leaving the app stuck with no clear error. `fetchWorkerHealth`/`fetchRemoteState` also now handle a non-JSON response body gracefully instead of throwing, and both app entry points wrap their initial sync pull in a try/catch so an unexpected startup failure can no longer leave the page permanently blank.
- On the web app's mobile drawer layout, the toolbar no longer visually covers the open workspace list, and the drawer's close toggle no longer overlaps the settings gear icon — both were fallout from earlier same-session fixes for the toggle being unreachable while the drawer was open.

## [0.2.0] - 2026-07-16

### Added

- Rename an entry's title via a pencil button that appears on hover, next to the existing delete button.
- Rename a folder via the same hover pencil button, next to "(delete)" — double-click on the folder name still works too.
- Drag-to-reorder entries within a folder, with an insertion line showing exactly where they'll land. Dragging an entry into a different folder now also lands at a precise spot instead of always appending to the end.
- README hero screenshot, generated from a real running build via `npm run screenshot` (`extension/scripts/generate-readme-screenshot.mjs`) rather than a hand-captured image — re-run it whenever the UI changes enough to make the screenshot stale.
- Trash view: a global (not per-workspace), flat list of every deleted folder and entry, sorted by delete time, with a Restore button on each. Restoring an entry whose folder is also trashed restores that folder too, rather than leaving the entry orphaned or fabricating a duplicate folder. Restore-only for now — see [KNOWN_GAPS.md](docs/KNOWN_GAPS.md).
- Open-tabs panel is now fully interactive and stays live: it reflects tabs opened/closed/moved elsewhere without a reload, clicking a tab focuses it, a hover close button closes it, and dragging a tab within the panel reorders it — including across windows.
- Multi-select in the open-tabs panel: a checkbox per tab (visible on hover, or always once checked) drives an "N selected" bar with "Add to folder" (a picker matching the popup's folder list) and "New folder", and dragging any one of several selected tabs now saves all of them, not just the one dragged — with a small "N tabs" badge as the drag image so it's clear more than one is coming along, instead of the browser's default single-tile drag preview.
- New "Close tabs after saving them" option (off by default) on the options page — when on, saving a tab via drag or the new multi-select actions closes the source tab afterward.
- Sync status dot in the newtab toolbar — gray (not configured), green (connected, with a "last synced" tooltip), or red (error) — reflecting the outcome of the most recent sync request, updating live as pushes/pulls resolve in the background.
- `/` focuses search from anywhere on the page (unless a modal or the search box itself already has focus), and Escape clears it while it's focused.
- Cmd/Ctrl-click (or middle-click) an entry to open it in a background tab instead of always stealing focus, matching normal browser link behavior.
- Multi-select for entries: a checkbox per entry (sharing the favicon's hover-reveal slot, same as the open-tabs panel) drives an "N selected" bar docked to the bottom of the main content area, with "Open tabs" (opens every selected entry's URL in the background), "Move" (a folder picker, shared with the open-tabs panel's "Add to folder"), and "Delete". Selection is global across every visible folder, not scoped to one. Dragging any one of several selected entries moves all of them together, with a "N links" badge as the drag image so it's clear more than one is coming along.

### Changed

- Dragging a folder to reorder it now shows a single insertion line that snaps to the nearest folder boundary, instead of highlighting whichever whole folder the cursor happened to be over. Also fixes not being able to drop a folder at the very end of the list.
- Workspace rail / open-tabs panel collapse state now survives a reload (moved into the same device-local `UiState` that already persists collapsed folders) instead of resetting to open every time.

### Fixed

- Search now matches an entry's title, URL, and note together. It previously only searched whichever one of those the display fallback (`title || url || note`) picked, so an entry with a title set was unsearchable by its URL.
- Search lost focus after every single keystroke — it called `ctx.render()` (which tears down and rebuilds the whole app, including the search input itself) and then refocused the now-detached old element, a no-op for the live page.
- Open-tabs panel: the checkbox no longer reserves its own always-empty column next to every tab. It now shares the favicon's slot, swapping in over it on hover/selected instead — same approach Toby uses.
- Open-tabs panel: some real-world favicons rendered at their native size instead of the intended 16px and overlapped neighboring rows, since `inset: 0` alone doesn't reliably constrain a `position: absolute` `<img>`'s size for every favicon.
- Dragging an entry within a folder to the spot right before its own current position moved it to the very front of the folder instead of leaving it where it was.

## [0.1.0] - 2026-07-13

### Added

- **Backend:** Cloudflare Worker + D1 database.
  Bearer-token auth, `GET /state` for full reads, per-resource `POST`/`PATCH`/`DELETE` for writes, upsert-by-recency conflict resolution, and soft-delete (`deleted_at`) so sync can never destroy data.
  Schema changes are numbered migrations (`worker/migrations/`), applied via `wrangler d1 migrations apply` on both fresh installs and upgrades.
- **Schema versioning:** the Worker reports its version and schema version via `GET /health`; the extension checks compatibility once per page load and pauses sync (rather than risk data loss) if the Worker hasn't caught up on a migration yet — surfaced clearly on the options page instead of just a console warning.
- **Extension core:** Manifest V3 folder-browser UI (workspaces → folders → entries), local-first via `chrome.storage.local`, drag-and-drop throughout (save a tab, reorder folders, move entries between folders).
- **Sync:** push-on-mutation plus pull-and-merge against the Worker, last-write-wins by `updated_at`, safe against both accidental data loss and delete propagation.
- **Toolbar popup:** save the current tab or every tab in the window (via a folder picker), or open the full UI.
- **Optional new-tab takeover:** on by default, but a real toggle — implemented as a conditional background-worker redirect rather than a static manifest override, so turning it off restores Chrome's actual default new-tab page.
- **Options page:** Worker URL/token configuration with an immediate connectivity check, the extension's and (when connected) the Worker's version, the new-tab toggle, and a Data section for backup and Toby migration.
- **Toby migration:** import from Toby's JSON export, export back to Toby's format, plus a native Shelve backup export/import for device migration or safekeeping.
- **Manual link entry:** a small "+" affordance to add a link by URL (for links not currently open as a tab), with automatic title/favicon fetching.
- **In-window modal UI:** replaces native `window.prompt()`/`confirm()` throughout, for rename, delete-confirm, and folder/workspace creation.
- **Folder organization:** rename, drag-to-reorder, and collapse/expand (collapse state is device-local, not synced).
- **Testing:** Worker tests against a real D1 instance (`@cloudflare/vitest-pool-workers`); extension unit tests (Vitest) and a Playwright-driven skill for exercising the built extension in a real Chromium instance.
- **Docs:** [README.md](README.md) (setup + FAQ) and [ARCHITECTURE.md](docs/ARCHITECTURE.md) (internals).
