#!/usr/bin/env node
// Adaptive deploy: creates fresh, reconnects to an existing Worker/database,
// or just migrates+redeploys — whichever matches current local/Cloudflare
// state. Replaces the old setup.mjs/upgrade.mjs split: setUpWorker()'s
// "already configured" branch always just called the same migrate-then-
// deploy logic upgradeWorker() used, so the two scripts already behaved like
// one command wearing two names. See docs/SETUP.md.
//
// Usage:
//   npm run wizard:deploy
//   npm run wizard:deploy -- --yes --database=shelve-db --worker-name=shelve-worker
//   npm run wizard:deploy -- --dry-run
//   npm run wizard:deploy -- --web --pages-project=my-app
//   npm run wizard:deploy -- --no-extension

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ask, confirm, select, WizardInputRequired } from "./lib/prompt.mjs";
import { ensurePagesProjectExists, runCommand, warnIfNotProduction, wranglerBin, WizardAborted } from "./lib/exec.mjs";
import { createContext } from "./lib/context.mjs";
import { parseArgs } from "./lib/args.mjs";
import { createPlan, confirmAndRun } from "./lib/plan.mjs";
import { checkLogin, listD1Databases, extractDatabaseId, checkWorkerExists } from "./lib/discovery.mjs";
import { readWranglerToml, writeWranglerToml } from "./lib/wranglerToml.mjs";
import { readWizardConfig, writeWizardConfig } from "./lib/wizardConfig.mjs";
import { randomProjectName } from "./lib/randomName.mjs";
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
  if (collected.pagesUrl) console.log(`Web app URL:       ${ui.bold(collected.pagesUrl)} (this deploy)`);
  if (collected.pagesProjectName) {
    console.log(`Pages project:     ${collected.pagesProjectName}`);
    console.log(`Web app URL:       ${ui.bold(`https://${collected.pagesProjectName}.pages.dev`)} (always latest)`);
  }
}

// ---------- Worker phase ----------

function migrationsArgs(wrangler, databaseName) {
  return {
    description:
      'Applying any new database migrations (a no-op if there aren\'t any). Wrangler may ask "...continue?" — answer it, then hit Enter again if it looks stuck afterward.',
    cmd: wrangler,
    args: ["d1", "migrations", "apply", databaseName, "--remote"],
    cwd: workerDir,
  };
}

async function deployWorkerStep(ctx, wrangler) {
  const { stdout } = await runCommand(ctx, {
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
}

async function checkWorkerHealth(workerUrl, apiToken) {
  ui.step(`Checking ${workerUrl}/health ...`);
  try {
    const res = await fetch(`${workerUrl}/health`, { headers: { Authorization: `Bearer ${apiToken}` } });
    const body = await res.json();
    if (res.ok) ui.success(`Worker is live — version ${body.version}, schema v${body.schemaVersion}.`);
    else ui.warn(`Health check returned ${res.status}: ${JSON.stringify(body)}`);
  } catch (e) {
    ui.warn(`Health check failed: ${e.message}`);
  }
}

async function checkWorkerHealthAgainstRepoVersion(workerUrl, apiToken) {
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

/** Old upgrade.mjs's "ask for a token to verify via /health, blank to
 * skip" — "" as the default (not undefined) means --yes silently skips it
 * rather than erroring, since this is optional verification, not a required
 * input. */
async function verifyWorkerHealthOptional(ctx) {
  if (!collected.workerUrl) return;
  const apiToken = await ask(ctx, "\nAPI_TOKEN, to verify the deploy via /health (leave blank to skip)", "");
  if (!apiToken) return;
  await checkWorkerHealthAgainstRepoVersion(collected.workerUrl, apiToken);
}

async function resolveDatabaseChoice(ctx, wrangler, existingDbs) {
  if (ctx.flags.database) {
    const match = existingDbs.find((db) => db.name === ctx.flags.database);
    if (match) {
      const id = extractDatabaseId(match);
      if (!id) throw new Error(`Couldn't determine the database_id for "${match.name}" from d1 list's output.`);
      return { name: match.name, id, reused: true };
    }
    return { name: ctx.flags.database, id: null, reused: false };
  }

  if (ctx.yes) {
    throw new WizardInputRequired(
      "--yes requires --database=<name> when worker/wrangler.toml isn't configured yet (fresh install, or " +
        "reconnecting after lost config). Run `npm run wizard:status` to see existing D1 databases, then re-run " +
        "with --database=<name>.",
    );
  }

  if (existingDbs.length > 0) {
    // Never auto-pick, even with exactly one candidate — no signal proves a
    // database belongs to this project, so the choice always stays explicit.
    const choices = [...existingDbs.map((db) => `Use existing: ${db.name}`), "Create a new database"];
    const choice = await select(ctx, "Found existing D1 database(s):", choices, { flagHint: "--database" });
    if (choice < existingDbs.length) {
      const db = existingDbs[choice];
      const id = extractDatabaseId(db);
      if (!id) throw new Error(`Couldn't determine the database_id for "${db.name}" from d1 list's output.`);
      return { name: db.name, id, reused: true };
    }
  }

  const name = await ask(ctx, "Name for the new D1 database", "shelve-db");
  return { name, id: null, reused: false };
}

/** Once a Worker name is resolved, checks whether a Worker already exists
 * under it — wrangler deploy is silently create-or-update with no
 * distinction surfaced, so deploying under a name that's already a live
 * Worker (yours from something unrelated, or someone else's in a shared
 * account) would overwrite it with zero warning otherwise. */
async function resolveWorkerName(ctx, wrangler, existingName) {
  const name = ctx.flags.workerName ?? (await resolveWorkerNameValue(ctx, existingName));

  const exists = await checkWorkerExists(ctx, wrangler, workerDir, name);
  if (!exists) return name;

  if (ctx.yes) {
    ui.warn(
      `A Worker named "${name}" already has deployments — proceeding to redeploy over it (--worker-name was explicit).`,
    );
    return name;
  }
  const proceed = await confirm(
    ctx,
    `A Worker named "${name}" already has deployments — deploying will redeploy over it. Continue?`,
    false,
  );
  if (!proceed) throw new WizardAborted("Aborted — pick a different --worker-name, or re-run to try again.");
  return name;
}

async function resolveWorkerNameValue(ctx, existingName) {
  if (ctx.yes) {
    throw new WizardInputRequired(
      "--yes requires --worker-name=<name> when worker/wrangler.toml isn't configured yet. Run " +
        "`npm run wizard:status`, then re-run with --worker-name=<name>.",
    );
  }
  return ask(ctx, "Name for the Worker", existingName ?? "shelve-worker");
}

async function resolveRotateToken(ctx) {
  if (ctx.flags.rotateToken !== undefined) return ctx.flags.rotateToken;
  // Default "no": rotating silently 401s every already-configured client
  // (extension/web settings) still pointed at the old token. Safe under
  // --yes too — confirm() auto-accepts this same default.
  return confirm(
    ctx,
    "\nGenerate a new API_TOKEN for this database? Say no if a Worker is already deployed against it with " +
      "clients configured — rotating it now would silently invalidate their access.",
    false,
  );
}

async function setUpOrUpgradeWorker(ctx) {
  ui.heading("Worker");
  const wrangler = wranglerBin(root);
  const existing = readWranglerToml(root);

  if (existing?.configured) {
    // worker/wrangler.toml already fully determines the database/Worker name
    // — --database/--worker-name have nothing to resolve here, unlike the
    // fresh/reconnect path below. Warn rather than silently no-op'ing an
    // explicit flag, so passing one by habit after a first successful setup
    // doesn't look like it was ignored for no reason.
    if (ctx.flags.database !== undefined || ctx.flags.workerName !== undefined) {
      ui.warn("--database/--worker-name are ignored once worker/wrangler.toml is already configured.");
    }
    collected.databaseName = existing.databaseName;
    const plan = createPlan()
      .add("Apply any new D1 migrations", () => runCommand(ctx, migrationsArgs(wrangler, existing.databaseName)))
      .add("Deploy the Worker", () => deployWorkerStep(ctx, wrangler));
    await confirmAndRun(ctx, plan, { phaseLabel: "Worker: migrate + redeploy" });
    if (ctx.dryRun) return;
    await verifyWorkerHealthOptional(ctx);
    return;
  }

  // Fresh install OR reconnect-after-lost-config — same discovery either way.
  // Not logged in yet means existingDbs comes back empty even if the account
  // genuinely has one matching --database=<name>; resolveDatabaseChoice then
  // treats it as brand-new and `d1 create` fails safe (wrangler rejects an
  // already-taken name) rather than silently reusing or misidentifying it.
  const loggedIn = await checkLogin(ctx, wrangler, workerDir);
  const existingDbs = loggedIn ? await listD1Databases(ctx, wrangler, workerDir) : [];

  const {
    name: databaseName,
    id: existingDatabaseId,
    reused,
  } = await resolveDatabaseChoice(ctx, wrangler, existingDbs);
  const workerName = await resolveWorkerName(ctx, wrangler, existing?.name);

  const plan = createPlan();
  if (!loggedIn) {
    plan.add("Log in to Cloudflare", () =>
      runCommand(ctx, { description: "Logging in to Cloudflare.", cmd: wrangler, args: ["login"], cwd: workerDir }),
    );
  }

  let databaseId = existingDatabaseId;
  if (!reused) {
    plan.add(`Create D1 database "${databaseName}"`, async () => {
      const { stdout } = await runCommand(ctx, {
        description: `Creating D1 database "${databaseName}".`,
        cmd: wrangler,
        args: ["d1", "create", databaseName, "--json"],
        cwd: workerDir,
        capture: true,
        quiet: true,
      });
      const jsonStart = stdout.indexOf("{");
      let parsed;
      try {
        parsed = jsonStart === -1 ? null : JSON.parse(stdout.slice(jsonStart));
      } catch {
        parsed = null; // falls through to the same "couldn't find it" error below
      }
      databaseId = extractDatabaseId(parsed ?? {});
      if (!databaseId) throw new Error("Couldn't find database_id in `d1 create --json`'s output — check it above.");
      ui.success(`Created database "${databaseName}" (id: ${databaseId}).`);
    });
  }

  plan.add(`Write worker/wrangler.toml (name="${workerName}")`, () => {
    writeWranglerToml(root, { name: workerName, databaseName, databaseId });
    ui.success(`Wrote worker/wrangler.toml (name="${workerName}", database_name="${databaseName}").`);
  });

  plan.add("Apply D1 migrations", () => runCommand(ctx, migrationsArgs(wrangler, databaseName)));

  // A brand-new database always needs a token generated — there's nothing to
  // "rotate" yet — so --rotate-token/--no-rotate-token doesn't apply here.
  // Warn rather than silently ignoring an explicit flag, so a user who
  // passed --no-rotate-token isn't left wondering why a token got set anyway.
  if (!reused && ctx.flags.rotateToken !== undefined) {
    ui.warn("--rotate-token/--no-rotate-token doesn't apply to a brand-new database — it always gets a fresh token.");
  }
  const rotate = reused ? await resolveRotateToken(ctx) : true;
  let apiToken;
  if (rotate) {
    apiToken = randomBytes(32).toString("hex");
    plan.add("Set the API_TOKEN secret", async () => {
      await runCommand(ctx, {
        description: "Setting the API_TOKEN secret.",
        cmd: wrangler,
        args: ["secret", "put", "API_TOKEN"],
        cwd: workerDir,
        stdinInput: `${apiToken}\n`,
      });
      // Only recorded for the summary once the secret is actually live —
      // not at plan-build time, so a declined/aborted/--dry-run run never
      // prints a token that was never really set.
      collected.apiToken = apiToken;
    });
  }
  plan.add("Deploy the Worker", () => deployWorkerStep(ctx, wrangler));

  collected.databaseName = databaseName;

  await confirmAndRun(ctx, plan, { phaseLabel: "Worker: first-time setup / reconnect" });
  if (ctx.dryRun) return;
  if (apiToken) await checkWorkerHealth(collected.workerUrl, apiToken);
  else await verifyWorkerHealthOptional(ctx);
}

// ---------- Web phase ----------

async function resolveWantWeb(ctx) {
  if (ctx.flags.web !== undefined) return ctx.flags.web;
  if (ctx.yes) {
    ui.warn(
      "Skipping the web app under --yes (neither --web nor --no-web given). Pass --web --pages-project=<name> to include it.",
    );
    return false;
  }
  return confirm(ctx, "\nSet up the web app too?", true);
}

async function resolvePagesProjectName(ctx, wizardConfig) {
  if (ctx.flags.pagesProject) return ctx.flags.pagesProject;
  if (wizardConfig.pagesProjectName) return wizardConfig.pagesProjectName;
  if (ctx.yes) {
    throw new WizardInputRequired(
      "--yes with --web requires --pages-project=<name> (no project recorded in .shelve/wizard.json yet). Run " +
        "`npm run wizard:status`, then re-run with --pages-project=<name>.",
    );
  }
  const suggested = randomProjectName();
  return ask(ctx, "Cloudflare Pages project name (must be globally unique across all Cloudflare accounts)", suggested);
}

async function setUpOrUpgradeWeb(ctx) {
  const wantWeb = await resolveWantWeb(ctx);
  if (!wantWeb) return;

  ui.heading("Web app");
  const wrangler = wranglerBin(root);
  const wizardConfig = readWizardConfig(root);
  const requestedName = await resolvePagesProjectName(ctx, wizardConfig);

  let projectName = requestedName;
  const plan = createPlan();
  plan.add(`Ensure Cloudflare Pages project "${requestedName}" exists`, async () => {
    projectName = await ensurePagesProjectExists(ctx, wrangler, requestedName);
  });
  plan.add("Build the web app", () =>
    runCommand(ctx, {
      description: "Building the web app.",
      cmd: "npm",
      args: ["run", "build", "--workspace=web"],
      cwd: root,
      readOnly: true, // local filesystem write only, no Cloudflare side effect
    }),
  );
  plan.add("Deploy to Cloudflare Pages", async () => {
    const { stdout } = await runCommand(ctx, {
      description: "Deploying to Cloudflare Pages.",
      cmd: wrangler,
      args: ["pages", "deploy", "dist", "--project-name", projectName],
      cwd: webDir,
      capture: true,
    });
    collected.pagesUrl = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.pages\.dev\S*/)?.[0];
  });
  plan.add("Record the Pages project name locally", () => {
    writeWizardConfig(root, { pagesProjectName: projectName });
    collected.pagesProjectName = projectName;
  });

  await confirmAndRun(ctx, plan, { phaseLabel: "Web app" });
  if (ctx.dryRun) return;

  if (collected.pagesUrl) {
    ui.success(`Web app deployed to ${collected.pagesUrl}`);
    console.log("Open it, go to Settings, and enter the Worker URL/token from above.");
    await warnIfNotProduction(ctx, wrangler, webDir, projectName, collected.pagesUrl);
  } else {
    ui.warn("Couldn't find the Pages URL in the deploy output above.");
  }
}

// ---------- Extension phase ----------

async function resolveWantExtension(ctx) {
  if (ctx.flags.extension !== undefined) return ctx.flags.extension;
  if (ctx.yes) return true; // no account resource to resolve, unlike --web — safe to default on
  return confirm(ctx, "\nBuild the extension too?", true);
}

async function setUpExtension(ctx) {
  const wantExtension = await resolveWantExtension(ctx);
  let built = false;

  if (wantExtension) {
    ui.heading("Chrome extension");
    const plan = createPlan().add("Build the extension", () =>
      runCommand(ctx, {
        description: "Building the extension.",
        cmd: "npm",
        args: ["run", "build", "--workspace=extension"],
        cwd: root,
        readOnly: true, // local filesystem write only, no Cloudflare side effect
      }),
    );
    await confirmAndRun(ctx, plan, { phaseLabel: "Extension" });
    if (ctx.dryRun) return;
    built = true;
  } else {
    ui.heading("Chrome extension");
  }

  console.log("This part is a manual browser flow — nothing else to automate:");
  if (built) {
    console.log(`  1. chrome://extensions -> enable Developer mode -> Load unpacked -> select extension/dist`);
    console.log(`  2. Click the Shelve icon -> gear icon -> enter the Worker URL/token from above -> Save`);
  } else {
    console.log(`  1. cd extension && npm run build`);
    console.log(`     (or download a prebuilt zip from the Releases page)`);
    console.log(`  2. chrome://extensions -> enable Developer mode -> Load unpacked -> select extension/dist`);
    console.log(`  3. Click the Shelve icon -> gear icon -> enter the Worker URL/token from above -> Save`);
  }
}

// ---------- Entry point ----------

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ctx = createContext({ rl, flags });

  ui.heading("Shelve deploy wizard");
  if (ctx.yes) console.log("--yes: non-interactive. Every write step still prints before it runs.\n");
  else if (ctx.dryRun) console.log("--dry-run: printing the plan, running nothing.\n");
  else
    console.log(
      "Read-only checks run without asking; each phase's writes are grouped into one plan and confirmed once.\n",
    );

  try {
    await setUpOrUpgradeWorker(ctx);
    await setUpOrUpgradeWeb(ctx);
    await setUpExtension(ctx);
  } catch (e) {
    if (e instanceof WizardAborted) {
      console.log(`\n${e.message}`);
    } else if (e instanceof WizardInputRequired) {
      ui.error(e.message);
      process.exitCode = 1;
    } else {
      ui.error(e.message);
      process.exitCode = 1;
    }
  } finally {
    // Always shown, even on abort/error: an earlier phase (most often the
    // Worker phase) can have already genuinely generated and set a live
    // API_TOKEN before a later phase throws — Cloudflare never shows that
    // value again, so losing it here because a later, unrelated step failed
    // or was declined would be a real, unrecoverable loss, not just a
    // cosmetic one. printSummary() only prints whatever was actually
    // collected, so this is a no-op (just the heading) when nothing was.
    printSummary();
    rl.close();
  }
}

main();
