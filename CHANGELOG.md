# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/) once it reaches its first release.

## [Unreleased]

### Added

- Rename an entry's title via a pencil button that appears on hover, next to the existing delete button.
- Rename a folder via the same hover pencil button, next to "(delete)" — double-click on the folder name still works too.
- Drag-to-reorder entries within a folder, with an insertion line showing exactly where they'll land. Dragging an entry into a different folder now also lands at a precise spot instead of always appending to the end.
- README hero screenshot, generated from a real running build via `npm run screenshot` (`extension/scripts/generate-readme-screenshot.mjs`) rather than a hand-captured image — re-run it whenever the UI changes enough to make the screenshot stale.
- Trash view: a global (not per-workspace), flat list of every deleted folder and entry, sorted by delete time, with a Restore button on each. Restoring an entry whose folder is also trashed restores that folder too, rather than leaving the entry orphaned or fabricating a duplicate folder. Restore-only for now — see [KNOWN_GAPS.md](KNOWN_GAPS.md).

### Changed

- Dragging a folder to reorder it now shows a single insertion line that snaps to the nearest folder boundary, instead of highlighting whichever whole folder the cursor happened to be over. Also fixes not being able to drop a folder at the very end of the list.
- Workspace rail / open-tabs panel collapse state now survives a reload (moved into the same device-local `UiState` that already persists collapsed folders) instead of resetting to open every time.

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
