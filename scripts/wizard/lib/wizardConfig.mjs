// A small gitignored file for the one bit of wizard state that has nowhere
// else to live: the Cloudflare Pages project name (there's no
// wrangler.toml-equivalent for Pages the way there is for the Worker/D1).
// Worker URL/API token are deliberately NOT stored here — they already live
// only in the browser-side settings screens (extension options page, web
// app settings), which is the correct trust boundary for a secret.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function configPath(root) {
  return join(root, ".shelve", "wizard.json");
}

export function readWizardConfig(root) {
  const path = configPath(root);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeWizardConfig(root, updates) {
  const path = configPath(root);
  const current = readWizardConfig(root);
  const next = { ...current, ...updates };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
