#!/usr/bin/env node
// Interactive first-time setup for the Worker (required) and, optionally,
// the web app. Walks the same steps as README's "Setup" section, but drives
// them: every Wrangler command is printed and confirmed before running (see
// lib/exec.mjs), and already-completed steps are detected and skipped so
// re-running after an interruption is always safe.
//
// Usage: npm run setup

import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ask, confirm, select } from "./lib/prompt.mjs";
import { runCommand, wranglerBin, WizardAborted } from "./lib/exec.mjs";
import { readWranglerToml, writeWranglerToml } from "./lib/wranglerToml.mjs";
import { readWizardConfig, writeWizardConfig } from "./lib/wizardConfig.mjs";
import * as ui from "./lib/style.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const workerDir = join(root, "worker");
const webDir = join(root, "web");

const collected = {}; // everything worth showing in the final summary

function printSummary() {
  ui.heading("Summary — save these now");
  if (collected.workerUrl) console.log(`Worker URL:        ${ui.bold(collected.workerUrl)}`);
  if (collected.databaseName) console.log(`D1 database:       ${collected.databaseName}`);
  if (collected.apiToken) {
    console.log(`API_TOKEN:         ${ui.bold(collected.apiToken)}`);
    ui.warn("Cloudflare will not show this token again — save it now (e.g. in a password manager).");
  }
  if (collected.pagesUrl) console.log(`Web app URL:       ${ui.bold(collected.pagesUrl)}`);
  if (collected.pagesProjectName) console.log(`Pages project:     ${collected.pagesProjectName}`);
}

async function setUpWorker(rl) {
  ui.heading("Worker");
  const existing = readWranglerToml(root);

  if (existing?.configured) {
    ui.success(`Already configured — Worker "${existing.name}", database "${existing.databaseName}".`);
    collected.databaseName = existing.databaseName;
    await applyMigrationsAndDeploy(rl, existing.databaseName);
    return;
  }

  const wrangler = wranglerBin(root);

  const { stdout: whoamiOut } = await runCommand(rl, {
    description: "Checking Cloudflare login status.",
    cmd: wrangler,
    args: ["whoami"],
    cwd: workerDir,
    capture: true,
  });
  if (/not authenticated/i.test(whoamiOut)) {
    await runCommand(rl, {
      description: "Not logged in — logging in to Cloudflare.",
      cmd: wrangler,
      args: ["login"],
      cwd: workerDir,
    });
  } else {
    ui.success("Already logged in.");
  }

  const { stdout: listOut } = await runCommand(rl, {
    description: "Checking for existing D1 databases.",
    cmd: wrangler,
    args: ["d1", "list", "--json"],
    cwd: workerDir,
    capture: true,
  });

  let existingDbs = [];
  try {
    const jsonStart = listOut.indexOf("[");
    existingDbs = jsonStart === -1 ? [] : JSON.parse(listOut.slice(jsonStart));
  } catch {
    ui.warn("Couldn't parse `d1 list --json` output — proceeding as if there are no existing databases.");
  }

  let databaseName;
  let databaseId;

  if (existingDbs.length > 0) {
    const choices = [...existingDbs.map((db) => `Use existing: ${db.name}`), "Create a new database"];
    const choice = await select(rl, "Found existing D1 database(s):", choices);
    if (choice < existingDbs.length) {
      const db = existingDbs[choice];
      databaseName = db.name;
      databaseId = db.uuid ?? db.database_id ?? db.id;
      if (!databaseId)
        throw new Error(`Couldn't determine the database_id for "${databaseName}" from d1 list's output.`);
    }
  }

  if (!databaseName) {
    databaseName = await ask(rl, "Name for the new D1 database", "shelve-db");
    const { stdout: createOut } = await runCommand(rl, {
      description: `Creating D1 database "${databaseName}".`,
      cmd: wrangler,
      args: ["d1", "create", databaseName],
      cwd: workerDir,
      capture: true,
    });
    databaseId = createOut.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
    if (!databaseId) throw new Error("Couldn't find database_id in `d1 create`'s output — check it above.");
  }

  const workerName = await ask(rl, "Name for the Worker", existing?.name ?? "shelve-worker");
  writeWranglerToml(root, { name: workerName, databaseName, databaseId });
  ui.success(`Wrote worker/wrangler.toml (name="${workerName}", database_name="${databaseName}").`);

  collected.databaseName = databaseName;

  await runCommand(rl, {
    description: "Applying database migrations.",
    cmd: wrangler,
    args: ["d1", "migrations", "apply", databaseName, "--remote"],
    cwd: workerDir,
  });

  const apiToken = randomBytes(32).toString("hex");
  collected.apiToken = apiToken;
  ui.warn("Generated a new API_TOKEN — it will be shown again in the summary at the end, but save it once set.");
  await runCommand(rl, {
    description: "Setting the API_TOKEN secret.",
    cmd: wrangler,
    args: ["secret", "put", "API_TOKEN"],
    cwd: workerDir,
    stdinInput: `${apiToken}\n`,
  });

  await deployWorkerAndCheckHealth(rl, wrangler, apiToken);
}

async function applyMigrationsAndDeploy(rl, databaseName) {
  const wrangler = wranglerBin(root);
  await runCommand(rl, {
    description: "Applying any new database migrations (a no-op if there aren't any).",
    cmd: wrangler,
    args: ["d1", "migrations", "apply", databaseName, "--remote"],
    cwd: workerDir,
  });
  await deployWorkerAndCheckHealth(rl, wrangler);
}

async function deployWorkerAndCheckHealth(rl, wrangler, apiTokenForHealthCheck) {
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

  if (!apiTokenForHealthCheck) return; // no token collected this run (e.g. already-configured path) — nothing to check with
  ui.step(`Checking ${workerUrl}/health ...`);
  try {
    const res = await fetch(`${workerUrl}/health`, { headers: { Authorization: `Bearer ${apiTokenForHealthCheck}` } });
    const body = await res.json();
    if (res.ok) ui.success(`Worker is live — version ${body.version}, schema v${body.schemaVersion}.`);
    else ui.warn(`Health check returned ${res.status}: ${JSON.stringify(body)}`);
  } catch (e) {
    ui.warn(`Health check failed: ${e.message}`);
  }
}

async function setUpWeb(rl) {
  const wantWeb = await confirm(rl, "\nSet up the web app too?", true);
  if (!wantWeb) return;

  ui.heading("Web app");
  const wizardConfig = readWizardConfig(root);
  const projectName = await ask(rl, "Cloudflare Pages project name", wizardConfig.pagesProjectName ?? "shelve-web");

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
    args: ["pages", "deploy", "dist", "--project-name", projectName],
    cwd: webDir,
    capture: true,
  });

  writeWizardConfig(root, { pagesProjectName: projectName });
  collected.pagesProjectName = projectName;

  const pagesUrl = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.pages\.dev\S*/)?.[0];
  if (pagesUrl) {
    collected.pagesUrl = pagesUrl;
    ui.success(`Web app deployed to ${pagesUrl}`);
    console.log(`Open it, go to Settings, and enter the Worker URL/token from above.`);
  } else {
    ui.warn("Couldn't find the Pages URL in the deploy output above.");
  }
}

function printExtensionInstructions() {
  ui.heading("Chrome extension");
  console.log("This part is a manual browser flow — nothing to automate:");
  console.log(`  1. cd extension && npm run build`);
  console.log(`     (or download a prebuilt zip from the Releases page)`);
  console.log(`  2. chrome://extensions -> enable Developer mode -> Load unpacked -> select extension/dist`);
  console.log(`  3. Click the Shelve icon -> gear icon -> enter the Worker URL/token from above -> Save`);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  ui.heading("Shelve setup wizard");
  console.log("Every command below is printed before it runs, and asks for confirmation first.\n");
  try {
    await setUpWorker(rl);
    await setUpWeb(rl);
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
