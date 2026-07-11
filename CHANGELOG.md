# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/) once it reaches its first release.

## [Unreleased]

Everything so far — no release has been cut yet.

### Added

- **Backend:** Cloudflare Worker + D1 database.
  Bearer-token auth, `GET /state` for full reads, per-resource `POST`/`PATCH`/`DELETE` for writes, upsert-by-recency conflict resolution, and soft-delete (`deleted_at`) so sync can never destroy data.
- **Extension core:** Manifest V3 folder-browser UI (workspaces → folders → entries), local-first via `chrome.storage.local`, drag-and-drop throughout (save a tab, reorder folders, move entries between folders).
- **Sync:** push-on-mutation plus pull-and-merge against the Worker, last-write-wins by `updated_at`, safe against both accidental data loss and delete propagation.
- **Toolbar popup:** save the current tab or every tab in the window (via a folder picker), or open the full UI.
- **Optional new-tab takeover:** on by default, but a real toggle — implemented as a conditional background-worker redirect rather than a static manifest override, so turning it off restores Chrome's actual default new-tab page.
- **Options page:** Worker URL/token configuration with an immediate connectivity check, the new-tab toggle, and a Data section for backup and Toby migration.
- **Toby migration:** import from Toby's JSON export, export back to Toby's format, plus a native Shelve backup export/import for device migration or safekeeping.
- **Manual link entry:** a small "+" affordance to add a link by URL (for links not currently open as a tab), with automatic title/favicon fetching.
- **In-window modal UI:** replaces native `window.prompt()`/`confirm()` throughout, for rename, delete-confirm, and folder/workspace creation.
- **Folder organization:** rename, drag-to-reorder, and collapse/expand (collapse state is device-local, not synced).
- **Testing:** Worker tests against a real D1 instance (`@cloudflare/vitest-pool-workers`); extension unit tests (Vitest) and a Playwright-driven skill for exercising the built extension in a real Chromium instance.
- **Docs:** [README.md](README.md) (setup + FAQ) and [ARCHITECTURE.md](ARCHITECTURE.md) (internals).

### Known gaps (tracked, not blocking)

- Notes UI (creating/editing note-only entries) is built at the data layer but currently disabled in the UI pending a better interaction design.
- Open-tabs panel is read-only browsing plus drag-to-save — no click-to-focus, close button, tab reordering, or multi-select yet.
- No browsable trash view, tags, or screenshots-per-entry.
- No Chrome Web Store listing — load-unpacked only.
