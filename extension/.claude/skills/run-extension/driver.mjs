// REPL driver for the Shelve Chrome extension.
// Loads extension/dist unpacked into a real Chromium instance (Playwright
// launchPersistentContext + --load-extension) and lets an agent drive its
// pages (newtab, options, popup) programmatically via `goto`.
//
// Usage: node driver.mjs   (then type commands, one per line)
import { chromium } from "playwright";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const EXT_ROOT = path.resolve(import.meta.dirname, "../../..");
const DIST_DIR = path.join(EXT_ROOT, "dist");
const PROFILE_DIR = process.env.PROFILE_DIR || "/tmp/shelve-ext-profile";
const SHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

let context = null;
let page = null;
let pendingDialogText = null;
let extensionId = null;

const COMMANDS = {
  async launch() {
    if (context) return console.log("already launched");
    if (!fs.existsSync(path.join(DIST_DIR, "manifest.json"))) {
      return console.log("ERROR: dist/manifest.json missing — run `npm run build` first");
    }
    // Headless (new architecture) doesn't reliably register the extension's
    // MV3 service worker — context.serviceWorkers() comes back empty, so
    // extension id discovery (below) fails outright. Default to headed; on
    // a display-less Linux box run this whole driver under `xvfb-run -a`
    // instead of forcing HEADLESS=true.
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: process.env.HEADLESS === "true",
      args: [
        `--disable-extensions-except=${DIST_DIR}`,
        `--load-extension=${DIST_DIR}`,
      ],
    });
    await new Promise((r) => setTimeout(r, 1000));
    page = await context.newPage();
    page.on("console", (msg) => console.log(`[console.${msg.type()}]`, msg.text()));
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));
    page.on("dialog", async (dialog) => {
      const text = pendingDialogText;
      pendingDialogText = null;
      if (text !== null) await dialog.accept(text);
      else await dialog.dismiss();
    });

    // Extension id discovery: there is no static chrome_url_overrides.newtab
    // anymore (the new-tab takeover is an opt-in runtime redirect via the
    // background worker — see extension/src/background/background.ts), so
    // we can no longer read the id off a redirected newtab page. Instead
    // read it off the extension's own MV3 service worker, which Playwright
    // exposes via context.serviceWorkers(). Poll briefly since the worker
    // can take a moment to register after launch.
    for (let i = 0; i < 20 && !extensionId; i++) {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
      if (worker) extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)\//)?.[1] ?? null;
      if (!extensionId) await new Promise((r) => setTimeout(r, 200));
    }
    console.log("launched. profile:", PROFILE_DIR, "extensionId:", extensionId);
  },

  // Navigate to an arbitrary extension-relative path, e.g. "options/index.html".
  async goto(relativePath) {
    if (!page) return console.log("ERROR: launch first");
    if (!extensionId) return console.log("ERROR: could not determine extension id");
    await page.goto(`chrome-extension://${extensionId}/${relativePath}`, { waitUntil: "load" });
    console.log("goto →", page.url());
  },

  // Usage: fill <cssSelector> -> <value>. Same "->" convention as drag,
  // since values may contain spaces.
  async fill(arg) {
    if (!page) return console.log("ERROR: launch first");
    const [sel, ...rest] = (arg || "").split("->");
    const value = rest.join("->").trim();
    if (!sel?.trim()) return console.log("usage: fill <cssSelector> -> <value>");
    await page.fill(sel.trim(), value);
    console.log("filled", sel.trim(), "with", JSON.stringify(value));
  },

  async ss(name) {
    if (!page) return console.log("ERROR: launch first");
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + ".png");
    await page.screenshot({ path: f });
    console.log("screenshot:", f);
  },

  // Usage: upload <cssSelector> -> <absolute file path>. Sets an
  // <input type="file">'s files without needing a real file picker dialog.
  async upload(arg) {
    if (!page) return console.log("ERROR: launch first");
    const [sel, ...rest] = (arg || "").split("->");
    const filePath = rest.join("->").trim();
    if (!sel?.trim() || !filePath) return console.log("usage: upload <cssSelector> -> <filePath>");
    await page.locator(sel.trim()).setInputFiles(filePath);
    console.log("uploaded", filePath, "to", sel.trim());
  },

  async dialog(text) {
    // Arms the next window.prompt()/confirm() to auto-accept with `text`.
    // Must be called on the line BEFORE the click that triggers the dialog.
    pendingDialogText = text || "";
    console.log("armed dialog accept with:", JSON.stringify(pendingDialogText));
  },

  async click(sel) {
    if (!page) return console.log("ERROR: launch first");
    await page.click(sel);
    console.log("clicked:", sel);
  },

  async "click-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    await page.getByText(text, { exact: false }).first().click();
    console.log("clicked text:", text);
  },

  async dblclick(sel) {
    if (!page) return console.log("ERROR: launch first");
    await page.dblclick(sel);
    console.log("double-clicked:", sel);
  },

  async drag(arg) {
    // Args come in joined as one string (see dispatch below), and CSS
    // selectors may contain spaces — so split source/target on "->" rather
    // than whitespace. Usage: drag <fromSel> -> <toSel>
    if (!page) return console.log("ERROR: launch first");
    const [fromSel, toSel] = (arg || "").split("->").map((s) => s.trim());
    if (!fromSel || !toSel) return console.log("usage: drag <fromSel> -> <toSel>");
    await page.locator(fromSel).first().dragTo(page.locator(toSel).first());
    console.log("dragged", fromSel, "→", toSel);
  },

  async eval(expr) {
    if (!page) return console.log("ERROR: launch first");
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  },

  async storage() {
    if (!page) return console.log("ERROR: launch first");
    const state = await page.evaluate(() => chrome.storage.local.get("shelve_state"));
    console.log(JSON.stringify(state, null, 2));
  },

  async text(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(await page.evaluate((s) => document.querySelector(s)?.innerText ?? "(null)", sel));
  },

  async wait(ms) {
    // Sync pushes (pushResource/pushDelete in extension/src/lib/sync.ts)
    // are fire-and-forget — quitting right after a mutation can abort the
    // in-flight fetch before it lands. Insert a wait before `quit`/`storage`
    // when you need to observe the push's actual effect.
    await new Promise((r) => setTimeout(r, Number(ms) || 500));
    console.log("waited", ms || 500, "ms");
  },

  async reload() {
    if (!page) return console.log("ERROR: launch first");
    await page.reload({ waitUntil: "load" });
    console.log("reloaded");
  },

  async quit() {
    if (context) await context.close().catch(() => {});
    context = null;
    page = null;
  },

  help() {
    console.log("commands:", Object.keys(COMMANDS).join(", "));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync("/dev/stdin", "r") });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: "driver> " });

// Serialize: readline emits all buffered lines synchronously, before the
// first command's await resolves. Without this queue, piped multi-line
// input (the common agent usage) runs every command concurrently against
// the same page/context.
let queue = Promise.resolve();
let rlClosed = false; // readline auto-closes on stdin EOF (piped heredoc),
                       // independent of our queue — guard prompt() after that.
const safePrompt = () => {
  if (!rlClosed) rl.prompt();
};

rl.on("line", (line) => {
  queue = queue.then(async () => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    if (!cmd) return safePrompt();
    const fn = COMMANDS[cmd];
    if (!fn) {
      console.log("unknown:", cmd, "— try: help");
      return safePrompt();
    }
    try {
      await fn(rest.join(" "));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
    if (cmd === "quit") {
      process.exit(0);
    }
    safePrompt();
  });
});
rl.on("close", async () => {
  rlClosed = true;
  // Wait for any commands still in the queue (e.g. piped heredoc input,
  // where EOF/close fires immediately, well before the queued async
  // commands have actually run) before tearing down.
  await queue;
  await COMMANDS.quit();
  process.exit(0);
});

console.log("shelve extension driver — 'help' for commands, 'launch' to start");
rl.prompt();
