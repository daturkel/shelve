---
name: run-extension
description: Build, load, and drive the Shelve Chrome extension (MV3 — newtab page, options page, toolbar popup, background worker) in a real Chromium instance. Use when asked to run, build, test, or screenshot the extension, or to verify a UI change.
---

The Shelve extension has no dev server — it's a built, unpacked MV3
extension loaded via `--load-extension`. There is no `chromium-cli`
support for extension loading (custom launch flags required), so this
skill ships its own Playwright REPL driver.

The extension has **no static `chrome_url_overrides.newtab`** — taking
over the new-tab page is an opt-in runtime redirect done by the
background service worker (`extension/src/background/background.ts`),
gated by a user preference. All three UI surfaces (`newtab/index.html`,
`options/index.html`, `popup/index.html`) are reached via the driver's
`goto` command, not by navigating to `chrome://newtab/`.

All paths below are relative to `extension/` (this skill's grandparent
directory).

## Prerequisites

None beyond the workspace's own `npm install` — `playwright` is a
devDependency of `@shelve/extension` and its Chromium binary is
downloaded automatically as part of that install. If it's missing:

```bash
npx playwright install chromium
```

## Build

```bash
npm run build   # vite build + copies manifest.json → dist/
```

Verifies `dist/manifest.json`, `dist/newtab/index.html`,
`dist/options/index.html`, `dist/popup/index.html`, and `dist/background.js`
exist. The driver's `launch` command checks for `dist/manifest.json` and
refuses to start if the build hasn't been run.

## Run (agent path)

```bash
node .claude/skills/run-extension/driver.mjs
```

It's a line-oriented REPL: type a command, see output, repeat. Pipe a
heredoc for a scripted run (this is how it was verified — see
Troubleshooting for a queuing gotcha this required fixing):

```bash
node .claude/skills/run-extension/driver.mjs <<'EOF'
launch
goto newtab/index.html
ss 01-empty
click-text + New Folder
fill .modal-input -> Reading List
click-text OK
ss 02-folder
drag .tab-item -> .folder-section
ss 03-dragged
storage
reload
ss 04-reload
quit
EOF
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`). The
extension's Chrome profile persists at `/tmp/shelve-ext-profile`
(override: `PROFILE_DIR`) — delete it between runs for a clean slate
(no workspaces/folders/entries carried over).

### Commands

| command | what it does |
|---|---|
| `launch` | load `dist/` unpacked into a persistent Chromium context; forwards page `console.*` and uncaught errors to the driver's stdout; discovers the extension id off the MV3 service worker (`context.serviceWorkers()`) for `goto` |
| `goto <relativePath>` | navigate to `chrome-extension://<id>/<relativePath>` — e.g. `goto newtab/index.html`, `goto options/index.html`, `goto popup/index.html` |
| `fill <css-sel> -> <value>` | `page.fill()` a real input — e.g. `fill input[type="password"] -> some-token`. Same `->` separator as `drag` (values may contain spaces) |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `dialog <text>` | arm the *next native* `window.prompt()`/`confirm()` to auto-accept with `<text>` — **not used anywhere in this app**, all dialogs are the in-window modal now (see Gotchas); kept in case a future flow ever needs a real browser dialog |
| `click <css-sel>` | Playwright `.click()` on a CSS selector — **fails on elements that are only visible on `:hover`** (see Gotchas); use `eval` instead for those |
| `click-text <text>` | click the first element whose text contains `<text>` — same hover-visibility caveat as `click`. Modal buttons are `OK`/`Cancel`/`Delete` |
| `dblclick <css-sel>` | double-click — how rename is triggered (`.folder-name`, `.rail-item`) |
| `drag <fromSel> -> <toSel>` | drag-and-drop `fromSel` onto `toSel` — **note the `->` separator**, not a space (see Gotchas) |
| `eval <js>` | `page.evaluate()`, prints JSON. Also the escape hatch for clicking hover-only elements: `eval document.querySelector(".folder-delete").click()` bypasses Playwright's visibility check since it's a plain DOM method call |
| `wait <ms>` | sleep before the next command (default 500ms) — needed after any mutation before `quit` or checking sync state, since sync pushes are fire-and-forget (see Gotchas) |
| `storage` | dumps `chrome.storage.local.get("shelve_state")` — the actual persisted app state |
| `text <css-sel>` | prints `innerText` of the first match |
| `reload` | reloads the current page |
| `quit` | closes the browser context, exits |

## Run (human path)

`chrome://extensions` → enable Developer mode → "Load unpacked" →
select `extension/dist`. Toolbar icon opens the popup; new tab shows
Shelve only if "Show Shelve when opening a new tab" is on in the
options page (default: on). No auto-reload on rebuild — click the
extension's reload icon in `chrome://extensions` after each
`npm run build`.

## Testing sync end-to-end

Sync needs the extension's options page configured with a Worker URL +
token. **Never point this at the real production Worker/token from
automation** — use a local `wrangler dev` instance instead (same code,
same D1 schema, harmless local-only token):

```bash
cd ../../../../worker   # from this skill dir, i.e. worker/
npx wrangler dev --port 8787   # uses worker/.dev.vars's API_TOKEN
```

Then drive the extension against it:

```bash
node .claude/skills/run-extension/driver.mjs <<'EOF'
launch
goto options/index.html
fill input[type="text"] -> http://localhost:8787
fill input[type="password"] -> local-dev-test-token
click-text Save
goto newtab/index.html
wait 1000
click-text + New Folder
fill .modal-input -> Test Folder
click-text OK
wait 500
drag .tab-item -> .folder-section
wait 1500
storage
quit
EOF
```

Then verify server-side state directly: `curl -H "Authorization: Bearer local-dev-test-token" http://localhost:8787/state`.

To test delete propagation to a *second* device that never deleted
anything itself (the actual scenario the soft-delete design exists
for), rerun with a different `PROFILE_DIR` — it gets its own local
state but talks to the same Worker:

```bash
PROFILE_DIR=/tmp/shelve-ext-profile-device2 node .claude/skills/run-extension/driver.mjs <<'EOF'
launch
goto options/index.html
fill input[type="text"] -> http://localhost:8787
fill input[type="password"] -> local-dev-test-token
click-text Save
wait 1000
storage
quit
EOF
```

## Testing the popup

The popup (`extension/src/popup/`) is driven the same way via
`goto popup/index.html`, but it calls `window.close()` after a
successful save (~700ms delay) — correct real-world behavior for an
actual toolbar popup, but it kills the driver's page mid-script since
we're loading it as a regular tab, not a real popup surface. Capture
whatever you need to check *before* that timer fires (e.g. `wait 200`
right after the save action, not `wait 1000+`), then verify persistence
in a **separate** `launch` afterward:

```bash
node .claude/skills/run-extension/driver.mjs <<'EOF'
launch
goto popup/index.html
click-text Save current tab
wait 300
click-text + New Folder
fill .modal-input -> Quick Save
click-text OK
wait 200
ss popup-saved
quit
EOF
# then, separately:
node .claude/skills/run-extension/driver.mjs <<'EOF'
launch
goto newtab/index.html
storage
quit
EOF
```

## Gotchas

- **`drag` can silently no-op right after another re-render** (e.g. a
  collapse-toggle click immediately before a folder-reorder `drag`).
  Playwright's synthetic drag reports success (no error, "dragged ..."
  logs normally) but the drop handler never actually fires — observed
  once during folder-reorder testing, gone on a clean retry with no
  other change. Suspected cause: the drag's start/target coordinates get
  computed against DOM elements that were mid-replacement from the prior
  render. Not an app bug (confirmed via unit tests + a clean re-run that
  worked and persisted correctly) — just insert a `wait` between an
  unrelated mutation and a `drag` if you see this.
- **Native `window.prompt()`/`confirm()` are gone from the whole app**
  — folder/workspace create, rename, and delete-confirm all use the
  shared in-window modal (`extension/src/lib/modal.ts`, used by both
  newtab and popup). The `dialog` command (arms a native dialog
  auto-accept) doesn't apply to any current flow — use
  `fill .modal-input -> <value>` then `click-text OK` (or
  `click-text Delete`/`click-text Cancel`) instead.
- **Rename is a double-click**, not a click: `dblclick .folder-name` or
  `dblclick .rail-item`. A plain `click` on `.rail-item` just switches
  the active workspace instead.
- **The popup closes itself (`window.close()`) ~700ms after a
  successful save.** See "Testing the popup" above — capture state
  before that fires, verify persistence in a fresh `launch`.
- **Sync pushes are fire-and-forget.** `pushResource`/`pushDelete` in
  `extension/src/lib/sync.ts` aren't awaited by their callers (the UI
  shouldn't block on network). `quit` closing the browser context right
  after a mutation can abort the in-flight fetch before it completes —
  a `POST /folders/...` that should have landed silently doesn't. Always
  `wait` (500–1500ms) after a mutation before `quit` or checking
  `storage`/curling the Worker.
- **Delete buttons are hover-only** (`.folder-delete`, `.entry-delete`
  have `visibility: hidden` until `.folder-header:hover`/`.entry:hover`).
  Playwright's `click`/`click-text` fail with "element is not visible"
  since there's no real mouse hover happening. Use
  `eval document.querySelector(".folder-delete").click()` instead — a
  plain DOM method call bypasses the visibility actionability check
  entirely.
- **Headless (`HEADLESS=true`) doesn't reliably register the
  extension's MV3 service worker** — `context.serviceWorkers()` comes
  back empty, so extension id discovery in `launch` fails outright and
  `goto` can't resolve a `chrome-extension://` URL. The driver defaults
  to **headed** for this reason. On a display-less Linux box, don't set
  `HEADLESS=true` — instead run the whole driver under `xvfb-run -a` to
  get a real (virtual) display while keeping headed mode.
- **`drag` needs `->`, not a space, between selectors.** The command
  dispatcher joins all trailing words into one string before calling
  the handler (so `click-text + New Folder` works as a single
  argument). A naive `drag <sel1> <sel2>` signature silently received
  `undefined` for the second selector and hung for the full 30s
  Playwright timeout waiting on a bogus locator — `->` sidesteps the
  ambiguity since CSS selectors can themselves contain spaces
  (descendant combinators).
- **Piped heredoc input can race past `launch`.** `readline` emits
  every buffered `line` event before the first command's `await`
  resolves, so unserialized handlers ran subsequent commands
  concurrently with `launch`, before the browser context existed.
  Fixed with a promise queue (`queue = queue.then(...)`) so commands
  execute strictly in order.
- **`readline` auto-closes on stdin EOF**, independent of that queue —
  a heredoc's closing line fires `rl`'s `'close'` event immediately,
  which used to call `quit()`/`process.exit(0)` before the queued
  commands had actually run. Fixed by awaiting the queue inside the
  `close` handler before tearing down, plus a `rlClosed` guard so
  in-flight commands don't call `rl.prompt()` on an already-closed
  interface.

## Troubleshooting

- **`ERROR: dist/manifest.json missing`** on `launch` → run
  `npm run build` first.
- **`ERROR: could not determine extension id`** on `goto` → the
  background service worker hasn't registered yet, or you're running
  headless (see Gotchas). Rerun headed, or add a short `wait` after
  `launch`.
- **`chrome is not defined` from `eval`/`storage`** → you're not on an
  extension-origin page yet (e.g. `goto` was never called, or navigation
  failed above). Fix the underlying navigation first.
- **`Target page, context or browser has been closed` after a popup
  save** → the popup's `window.close()` fired. See "Testing the popup."
