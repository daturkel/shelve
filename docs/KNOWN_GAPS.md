# Known gaps

Things that are missing or incomplete. Not blocking, just not built yet.

- **Notes UI** — note-only entries work end to end at the data layer, but there's no UI to create or edit them yet.
- **No tags or per-entry screenshots.**
- **No Chrome Web Store listing** — load-unpacked only.
- **No automatic trash expiry.** Permanent delete is manual (per-item, bulk, or empty-trash); a scheduled auto-expiry would need a Cron Trigger on the Worker, which doesn't exist yet.
- **Thin test coverage on the DOM-orchestration layer** (`core/ui/*.ts`, extension options/popup/background). `core/lib/*` is well unit-tested; a small Playwright e2e suite covers two smoke flows (folder/link creation, entry multi-select + delete). Drag-reorder, tabs-panel multi-select, and trash restore have no automated coverage.
- **No keyboard-shortcut help modal.** Not worth it yet — there's only `/` for search and Escape to clear it.
- **No touch drag-and-drop on the web app.** Desktop drag-and-drop reordering works; touch devices can still create/rename/delete/move items via buttons and modals, just not reorder by dragging.
- **No PWA support on the web app** — no install manifest, no service worker, no offline support beyond the browser's HTTP cache.
- **Multi-tab write races on the web app, partially mitigated.** Two tabs saving at the same instant still last-write-wins with no true merge; a `BroadcastChannel` reconciliation keeps tabs from silently diverging, but doesn't add real conflict resolution.
- **The wizard parses `wrangler` CLI output** rather than using a stable API, so a future Wrangler output-format change could break it. Failures degrade to a warning rather than a crash.
- **The toolbar's sync status dot is a weaker signal than it looks.** It reflects only whether the _most recent_ Worker request succeeded, not whether all local data has actually synced — `pushResource()` is fire-and-forget with no retry, so one write can fail silently while a later, unrelated write flips the dot back to green. There's also no distinct "syncing" state and no periodic re-check while idle, so a stale "Synced" can sit uncorrected until the next write happens to fail. Per-record sync/failure tracking (or at least surfacing failed pushes instead of swallowing them) would be a real improvement.
