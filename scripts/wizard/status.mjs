#!/usr/bin/env node
// Pure read-only status report: local worker/wrangler.toml state, the
// account-wide D1 database and Cloudflare Pages project listings (for
// recall), and whatever .shelve/wizard.json has recorded. Zero prompts, zero
// writes, zero confirmations — every call this makes is readOnly, so
// nothing here is ever gated. Doesn't do an authenticated /health check
// (that needs an API token, and this command must stay zero-prompt).
//
// Usage: npm run wizard:status

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createContext } from "./lib/context.mjs";
import { wranglerBin } from "./lib/exec.mjs";
import { checkLogin, listD1Databases, listPagesProjects, extractDatabaseId } from "./lib/discovery.mjs";
import { readWranglerToml } from "./lib/wranglerToml.mjs";
import { readWizardConfig } from "./lib/wizardConfig.mjs";
import * as ui from "./lib/style.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const workerDir = join(root, "worker");

async function main() {
  const ctx = createContext({ flags: { yes: true } }); // no rl: every call here is readOnly
  const wrangler = wranglerBin(root);

  ui.heading("Worker (local config)");
  const toml = readWranglerToml(root);
  if (!toml) {
    console.log("No worker/wrangler.toml yet — never configured, or gitignored so it didn't survive a fresh clone.");
  } else if (!toml.configured) {
    console.log(`worker/wrangler.toml exists but isn't filled in yet (name="${toml.name}").`);
  } else {
    console.log(`Configured — Worker "${toml.name}", database "${toml.databaseName}" (id: ${toml.databaseId}).`);
  }

  ui.heading("Cloudflare account");
  const loggedIn = await checkLogin(ctx, wrangler, workerDir);
  console.log(loggedIn ? "Logged in." : "Not logged in — run `npm run wizard:deploy` to log in.");

  if (loggedIn) {
    const dbs = await listD1Databases(ctx, wrangler, workerDir);
    ui.heading("D1 databases (account-wide)");
    if (dbs.length === 0) console.log("None found.");
    else dbs.forEach((db) => console.log(`  - ${db.name} (id: ${extractDatabaseId(db) ?? "unknown"})`));

    const pages = await listPagesProjects(ctx, wrangler);
    ui.heading("Cloudflare Pages projects (account-wide)");
    if (pages.length === 0) console.log("None found.");
    else pages.forEach((p) => console.log(`  - ${p["Project Name"]}`));
  }

  ui.heading("Wizard-recorded config (.shelve/wizard.json)");
  const wizardConfig = readWizardConfig(root);
  console.log(wizardConfig.pagesProjectName ? `Pages project: ${wizardConfig.pagesProjectName}` : "Nothing recorded.");

  ui.heading("Note");
  console.log(
    "Cloudflare's CLI has no account-wide \"list all Workers\" command, so this can't show existing Worker " +
      "names the way it can for D1/Pages. Check the Cloudflare dashboard's Workers & Pages section if you need " +
      "to find one, or pass --worker-name=<name> to `wizard:deploy` directly.",
  );
}

main().catch((e) => {
  ui.error(e.message);
  process.exitCode = 1;
});
