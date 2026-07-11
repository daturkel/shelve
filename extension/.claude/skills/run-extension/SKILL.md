---
name: run-extension
description: Build, load, and drive the Shelve Chrome extension (MV3, newtab override) in a real Chromium instance. Use when asked to run, build, test, or screenshot the extension, or to verify a UI change to the newtab folder-browser page.
---

The Shelve extension has no dev server — it's a built, unpacked MV3
extension loaded via `--load-extension`. There is no `chromium-cli`
support for extension loading (custom launch flags required), so this
skill ships its own Playwright REPL driver.

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

Verifies `dist/manifest.json` and `dist/newtab/index.html` exist. The
driver's `launch` command checks for `dist/manifest.json` and refuses
to start if the build hasn't been run.

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
newtab
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
| `launch` | load `dist/` unpacked into a persistent Chromium context; also forwards page `console.*` and uncaught errors to the driver's stdout |
| `newtab` | navigate a page to `chrome://newtab/` (resolves to the extension's override); also discovers and caches the extension id for `goto` |
| `goto <relativePath>` | navigate to `chrome-extension://<id>/<relativePath>` — e.g. `goto options/index.html`. Discovers the extension id via `newtab` first if not already known |
| `fill <css-sel> -> <value>` | `page.fill()` a real input — e.g. `fill input[type="password"] -> some-token`. Same `->` separator as `drag` (values may contain spaces) |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `dialog <text>` | arm the *next native* `window.prompt()`/`confirm()` to auto-accept with `<text>` — **not used by create/rename/delete-folder anymore**, those are in-window modals now (see Gotchas); still here for any future flow that uses a real browser dialog |
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
select `extension/dist`. Then open a new tab. No auto-reload on
rebuild — click the extension's reload icon in `chrome://extensions`
after each `npm run build`.

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
newtab
wait 1000
dialog Test Folder
click-text + New Folder
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
newtab
wait 1000
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
- **Native `window.prompt()`/`confirm()` are gone from the newtab page**
  as of the in-window modal (folder/workspace create, rename, and
  folder-delete confirm all use `extension/src/newtab/modal.ts` now).
  The `dialog` command (arms a native dialog auto-accept) no longer
  applies to any of these flows — use `fill .modal-input -> <value>`
  then `click-text OK` (or `click-text Delete`/`click-text Cancel`)
  instead. `dialog` still matters if a future flow reintroduces a native
  dialog.
- **Rename is a double-click**, not a click: `dblclick .folder-name` or
  `dblclick .rail-item`. A plain `click` on `.rail-item` just switches
  the active workspace instead.
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
- **The default "Home" workspace's id isn't stable across devices** (as
  of this writing — flagged as an open item in the design doc,
  `plans/shelve-extension.md`). Each fresh profile's first `launch`
  auto-creates its own "Home" with a random id; syncing two fresh
  profiles together produces two separate "Home" entries in the rail,
  not one. Confirmed via the two-profile test above — not a driver bug,
  a real product gap.
- **Headless (`HEADLESS=true`) breaks the newtab override.**
  `page.goto("chrome://newtab/")` throws `net::ERR_INVALID_URL` under
  Chromium's new headless architecture, even though the extension
  loads and everything else works. The driver defaults to **headed**
  for this reason. On a display-less Linux box, don't set
  `HEADLESS=true` — instead run the whole driver under `xvfb-run -a`
  to get a real (virtual) display while keeping headed mode.
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
  resolves, so unserialized handlers ran `newtab` concurrently with
  `launch`, before the browser context existed. Fixed with a promise
  queue (`queue = queue.then(...)`) so commands execute strictly in
  order.
- **`readline` auto-closes on stdin EOF**, independent of that queue —
  a heredoc's closing line fires `rl`'s `'close'` event immediately,
  which used to call `quit()`/`process.exit(0)` before the queued
  commands had actually run. Fixed by awaiting the queue inside the
  `close` handler before tearing down, plus a `rlClosed` guard so
  in-flight commands don't call `rl.prompt()` on an already-closed
  interface.
- **`window.prompt()` blocks real navigation** — folder/workspace
  creation both use it. Always send `dialog <text>` on the line
  *before* the `click`/`click-text` that triggers the prompt; without
  an armed handler Playwright auto-dismisses the dialog and the
  create silently no-ops.

## Troubleshooting

- **`ERROR: dist/manifest.json missing`** on `launch` → run
  `npm run build` first.
- **`ERR_INVALID_URL` on `newtab`** → you're running headless. See the
  headless Gotcha above; unset `HEADLESS` or run under `xvfb-run -a`.
- **`chrome is not defined` from `eval`/`storage`** → you're not on an
  extension-origin page yet (e.g. still on `about:blank` because
  `newtab` failed above). Fix the underlying navigation first.
