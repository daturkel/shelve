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
dialog Reading List
click-text + New Folder
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
| `launch` | load `dist/` unpacked into a persistent Chromium context |
| `newtab` | navigate a page to `chrome://newtab/` (resolves to the extension's override) |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `dialog <text>` | arm the *next* `window.prompt()`/`confirm()` to auto-accept with `<text>` — call this the line before the click that triggers it (folder/workspace creation both use `prompt()`) |
| `click <css-sel>` | Playwright `.click()` on a CSS selector |
| `click-text <text>` | click the first element whose text contains `<text>` |
| `drag <fromSel> -> <toSel>` | drag-and-drop `fromSel` onto `toSel` — **note the `->` separator**, not a space (see Gotchas) |
| `eval <js>` | `page.evaluate()`, prints JSON |
| `storage` | dumps `chrome.storage.local.get("shelve_state")` — the actual persisted app state |
| `text <css-sel>` | prints `innerText` of the first match |
| `reload` | reloads the current page |
| `quit` | closes the browser context, exits |

## Run (human path)

`chrome://extensions` → enable Developer mode → "Load unpacked" →
select `extension/dist`. Then open a new tab. No auto-reload on
rebuild — click the extension's reload icon in `chrome://extensions`
after each `npm run build`.

## Gotchas

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
