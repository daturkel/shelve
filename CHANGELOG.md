# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/) once it reaches its first release.

## [Unreleased]

### Added

- Unit tests for `lib/uiState.ts`, `lib/config.ts`, `lib/actions.ts`, and `lib/favicon.ts` (previously untested), plus new `lib/url.ts`, `lib/time.ts`, and `lib/backupFile.ts` modules extracted from DOM-heavy builder files (`newtab/folders.ts`, `newtab/toolbar.ts`, `options/main.ts`) so their pure logic is testable in isolation — no behavior change.
- A small Playwright end-to-end smoke suite (`extension/e2e/`) that loads the real built extension into a real Chromium instance and drives it through the UI — folder/link creation and reload-persistence, and entry multi-select's action bar and delete flow — now running as its own CI job (`npm run test:e2e --workspace=extension`, under `xvfb` since loading an MV3 extension needs headed Chromium).
- Light/dark/auto theme toggle on the options page, applied consistently across newtab, popup, and options. "Auto" (the default) follows the OS-level `prefers-color-scheme`; "Light"/"Dark" override it explicitly. The choice is device-local (not synced), same as other UI preferences.
- New `core/` workspace holding everything platform-agnostic — local storage/CRUD, sync, the in-window modal, Toby import/export, link metadata, ui state, and nearly all of the folder-browser's DOM-builder code — extracted from the extension behind two small seams (`Store` for persistence, `TabActions` for opening/closing real browser tabs) so a future lightweight web/PWA surface is purely additive (new adapter implementations + a new entry point) rather than a further refactor. No user-visible behavior change; see [ARCHITECTURE.md](ARCHITECTURE.md#the-core-package) for the design.

## [0.2.0] - 2026-07-16

### Added

- Rename an entry's title via a pencil button that appears on hover, next to the existing delete button.
- Rename a folder via the same hover pencil button, next to "(delete)" — double-click on the folder name still works too.
- Drag-to-reorder entries within a folder, with an insertion line showing exactly where they'll land. Dragging an entry into a different folder now also lands at a precise spot instead of always appending to the end.
- README hero screenshot, generated from a real running build via `npm run screenshot` (`extension/scripts/generate-readme-screenshot.mjs`) rather than a hand-captured image — re-run it whenever the UI changes enough to make the screenshot stale.
- Trash view: a global (not per-workspace), flat list of every deleted folder and entry, sorted by delete time, with a Restore button on each. Restoring an entry whose folder is also trashed restores that folder too, rather than leaving the entry orphaned or fabricating a duplicate folder. Restore-only for now — see [KNOWN_GAPS.md](KNOWN_GAPS.md).
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
- **Docs:** [README.md](README.md) (setup + FAQ) and [ARCHITECTURE.md](ARCHITECTURE.md) (internals).
