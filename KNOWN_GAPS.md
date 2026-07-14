# Known gaps

Things that are missing or incomplete right now, tracked here instead of in [CHANGELOG.md](CHANGELOG.md) since they're about the current state of the project rather than what changed in a given release.
Not blocking — just not built yet.

- Notes UI (creating/editing note-only entries) is built at the data layer but currently disabled in the UI pending a better interaction design.
- Open-tabs panel is read-only browsing plus drag-to-save — no click-to-focus, close button, tab reordering, or multi-select yet.
- No tags or screenshots-per-entry.
- Trash is restore-only — no way to permanently delete a trashed folder/entry (or empty the trash) yet. Soft-deleted records just accumulate forever; there's no hard-delete anywhere in the sync protocol or the Worker's API for this to call.
- No Chrome Web Store listing — load-unpacked only.
- Switching a device's Worker URL/token doesn't clean-swap the local experience: `chrome.storage.local`'s cached state isn't cleared on change, so the next sync merges (unions) local data into the new Worker rather than starting fresh against it — see `mergeState()` in `extension/src/lib/sync.ts`.
