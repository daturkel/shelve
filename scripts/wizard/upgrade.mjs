#!/usr/bin/env node
// Interactive upgrade for an already-set-up install: applies any new
// migrations, redeploys the Worker, and optionally rebuilds/redeploys the
// web app if it was set up before. Same confirm-before-running posture as
// setup.mjs.
//
// Usage: npm run upgrade

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { ask, confirm } from "./lib/prompt.mjs";
import { runCommand, wranglerBin, WizardAborted } from "./lib/exec.mjs";
import { readWranglerToml } from "./lib/wranglerToml.mjs";
import { readWizardConfig } from "./lib/wizardConfig.mjs";
import * as ui from "./lib/style.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const workerDir = join(root, "worker");
const webDir = join(root, "web");

const collected = {};

function printSummary() {
  ui.heading("Summary");
  if (collected.workerUrl) console.log(`Worker URL:  ${ui.bold(collected.workerUrl)}`);
  if (collected.pagesUrl) console.log(`Web app URL: ${ui.bold(collected.pagesUrl)}`);
}

async function upgradeWorker(rl) {
  ui.heading("Worker");
  const config = readWranglerToml(root);
  if (!config?.configured) {
    throw new Error("worker/wrangler.toml isn't configured yet — run `npm run setup` first.");
  }

  const wrangler = wranglerBin(root);
  await runCommand(rl, {
    description: "Applying any new database migrations (a no-op if there aren't any).",
    cmd: wrangler,
    args: ["d1", "migrations", "apply", config.databaseName, "--remote"],
    cwd: workerDir,
  });

  const { stdout } = await runCommand(rl, {
    description: "Deploying the Worker.",
    cmd: wrangler,
    args: ["deploy"],
    cwd: workerDir,
    capture: true,
  });
  const workerUrl = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev\S*/)?.[0];
  if (!workerUrl) {
    ui.warn("Couldn't find the Worker's URL in `wrangler deploy`'s output — check it above.");
    return;
  }
  collected.workerUrl = workerUrl;

  // Not stored anywhere (see wizardConfig.mjs) — every route including
  // /health requires it (worker/src/index.ts's isAuthorized() runs before
  // any route match), so there's no way to check without asking.
  const apiToken = await ask(rl, "\nAPI_TOKEN, to verify the deploy via /health (leave blank to skip)");
  if (!apiToken) return;

  const repoVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  ui.step(`Checking ${workerUrl}/health ...`);
  try {
    const res = await fetch(`${workerUrl}/health`, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (res.status === 401) {
      ui.warn("That token was rejected (401) — skipping the version comparison.");
      return;
    }
    const body = await res.json();
    if (body.version === repoVersion) ui.success(`Worker is running v${body.version}, matching this checkout.`);
    else
      ui.warn(
        `Worker reports v${body.version}, but this checkout is v${repoVersion} — deploy may still be propagating.`,
      );
  } catch (e) {
    ui.warn(`Health check failed: ${e.message}`);
  }
}

async function upgradeWeb(rl) {
  const wizardConfig = readWizardConfig(root);
  if (!wizardConfig.pagesProjectName) {
    // Nothing recorded doesn't mean nothing's deployed — it just means it
    // wasn't deployed via this wizard (e.g. MANUAL_SETUP.md's Option B), so
    // there's no project name to act on. Say so rather than skipping silently.
    ui.info(
      "\nNo web app deployment recorded by this wizard — if you deployed it manually, rebuild and redeploy it yourself (see MANUAL_SETUP.md#upgrading).",
    );
    return;
  }

  const wantWeb = await confirm(rl, `\nAlso upgrade the web app (project "${wizardConfig.pagesProjectName}")?`, true);
  if (!wantWeb) return;

  ui.heading("Web app");
  await runCommand(rl, {
    description: "Building the web app.",
    cmd: "npm",
    args: ["run", "build", "--workspace=web"],
    cwd: root,
  });

  const wrangler = wranglerBin(root);
  const { stdout } = await runCommand(rl, {
    description: "Deploying to Cloudflare Pages.",
    cmd: wrangler,
    args: ["pages", "deploy", "dist", "--project-name", wizardConfig.pagesProjectName],
    cwd: webDir,
    capture: true,
  });

  const pagesUrl = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.pages\.dev\S*/)?.[0];
  if (pagesUrl) {
    collected.pagesUrl = pagesUrl;
    ui.success(`Web app deployed to ${pagesUrl}`);
  } else {
    ui.warn("Couldn't find the Pages URL in the deploy output above.");
  }
}

function printExtensionInstructions() {
  ui.heading("Chrome extension");
  console.log("Manual, same as setup:");
  console.log(`  1. cd extension && npm run build   (or download the new zip from Releases)`);
  console.log(`  2. chrome://extensions -> reload Shelve's card (or Remove + Load unpacked again)`);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  ui.heading("Shelve upgrade wizard");
  console.log("Every command below is printed before it runs, and asks for confirmation first.\n");
  try {
    await upgradeWorker(rl);
    await upgradeWeb(rl);
    printExtensionInstructions();
    printSummary();
  } catch (e) {
    if (e instanceof WizardAborted) {
      console.log(`\n${e.message}`);
    } else {
      ui.error(e.message);
      printSummary();
      process.exitCode = 1;
    }
  } finally {
    rl.close();
  }
}

main();
