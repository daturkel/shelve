// Every Wrangler-touching action goes through runCommand(): print the exact
// command, then execute — confirming first unless it's read-only, the
// current plan phase was already confirmed as a whole, or --yes is set.
// Nothing runs silently: the command is always printed, even when the
// confirmation itself is skipped.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ask, confirm } from "./prompt.mjs";
import { dim, step, warn } from "./style.mjs";

export class WizardAborted extends Error {}

/** Whether runCommand() should ask "Run this?" before executing — extracted
 * as its own pure predicate so the whole readOnly/yes/phaseConfirmed gating
 * matrix (the entire point of this refactor) can be tested directly, rather
 * than only provable by tracing every call site by hand. */
export function needsConfirmation({ readOnly, yes, phaseConfirmed }) {
  return !readOnly && !yes && !phaseConfirmed;
}

/**
 * @param {import("./context.mjs").WizardContext} ctx
 * @param {{description?: string, cmd: string, args?: string[], cwd?: string,
 *   capture?: boolean, quiet?: boolean, stdinInput?: string, readOnly?: boolean}} opts
 *   `capture: true` tees stdout to the terminal while also returning it as a
 *   string, for the handful of calls the wizard needs to parse (a deploy
 *   URL, a generated database_id). `quiet: true` (only meaningful alongside
 *   `capture`) still captures the output for parsing but doesn't tee it to
 *   the terminal — for `--json` calls whose raw output is a technical
 *   fixture, not something a user should have to read; the caller prints
 *   its own human-readable summary of whatever it parses out instead.
 *   `stdinInput` pipes a value into the child's stdin instead of inheriting
 *   the real terminal's stdin — used only for `wrangler secret put`, so the
 *   user never has to paste the generated API token by hand. `readOnly: true`
 *   means this command can't change anything (a `list`/`whoami`-style
 *   lookup, or a purely local build) — it always skips the "Run this?" gate,
 *   regardless of ctx.yes/ctx.phaseConfirmed.
 */
export async function runCommand(
  ctx,
  { description, cmd, args = [], cwd, capture = false, quiet = false, stdinInput = null, readOnly = false },
) {
  if (description) step(description);
  console.log(dim(`$ ${[cmd, ...args].join(" ")}${cwd ? `  (in ${cwd})` : ""}`));

  if (needsConfirmation({ readOnly, yes: ctx.yes, phaseConfirmed: ctx.phaseConfirmed })) {
    const proceed = await confirm(ctx, "Run this?", true);
    if (!proceed) {
      throw new WizardAborted("Aborted — re-run any time, already-completed steps will be detected and skipped.");
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: [stdinInput !== null ? "pipe" : "inherit", capture ? "pipe" : "inherit", "inherit"],
    });

    let stdout = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!quiet) process.stdout.write(chunk);
      });
    }
    if (stdinInput !== null) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`\`${cmd} ${args.join(" ")}\` exited with code ${code}`));
        return;
      }
      resolve({ stdout });
    });
  });
}

/** Resolves the workspace-hoisted `wrangler` binary directly, rather than
 * going through `npx` — sidesteps npx's own noise on stdout, which would
 * otherwise corrupt the `--json` output the wizard needs to parse. */
export function wranglerBin(root) {
  const bin = join(root, "node_modules", ".bin", "wrangler");
  if (!existsSync(bin)) {
    throw new Error(`Couldn't find ${bin} — run \`npm install\` from the repo root first.`);
  }
  return bin;
}

/** `wrangler pages deploy` interactively prompts to create the project the
 * first time it's used against a name that doesn't exist yet — a prompt
 * that needs a real TTY on stdout, which piping stdout (to extract the
 * deployed URL afterward) breaks. Creating the project explicitly first,
 * whenever it isn't already there, means `pages deploy` never has to ask.
 *
 * Pages project names are unique across *every* Cloudflare account, not
 * just the current one, so creation can fail purely because someone else
 * already has that name — not a bug in the wizard, not something a retry
 * of the same name would ever fix. Rather than crash the whole wizard on
 * that, this loops interactively: on any creation failure, ask for a
 * different name and try again. Returns the project name that actually
 * succeeded, which may differ from the one passed in.
 *
 * Under --yes, there's no one to ask for a different name — a taken name
 * fails immediately with a clear error naming --pages-project, rather than
 * looping (impossible non-interactively) or auto-appending a random suffix
 * (would silently deploy under a different name than what was requested). */
export async function ensurePagesProjectExists(ctx, wrangler, initialProjectName) {
  let projectName = initialProjectName;

  while (true) {
    const { stdout: listOut } = await runCommand(ctx, {
      description: `Checking whether the Cloudflare Pages project "${projectName}" already exists.`,
      cmd: wrangler,
      args: ["pages", "project", "list", "--json"],
      capture: true,
      quiet: true,
      readOnly: true,
    });

    let existingProjects = [];
    try {
      const jsonStart = listOut.indexOf("[");
      existingProjects = jsonStart === -1 ? [] : JSON.parse(listOut.slice(jsonStart));
    } catch {
      // Falls through and attempts a create below — `pages project create`
      // on an already-existing name just errors clearly, which is safer
      // than silently assuming it doesn't exist and hitting the
      // interactive prompt.
    }

    if (existingProjects.some((p) => p["Project Name"] === projectName)) {
      console.log(dim(`Found it — "${projectName}" already exists in your account.`));
      return projectName;
    }
    console.log(dim(`Not found — "${projectName}" isn't one of your existing Pages projects yet.`));

    try {
      await runCommand(ctx, {
        description: `Creating Cloudflare Pages project "${projectName}".`,
        cmd: wrangler,
        args: ["pages", "project", "create", projectName, "--production-branch", "main"],
      });
      return projectName;
    } catch (e) {
      if (e instanceof WizardAborted) throw e; // declining to run it should abort, not retry
      if (ctx.yes) {
        throw new Error(
          `Couldn't create Cloudflare Pages project "${projectName}" — the name may already be taken by another ` +
            `Cloudflare account (Pages project names are globally unique). Re-run with a different --pages-project=<name>.`,
          { cause: e },
        );
      }
      warn(
        `Couldn't create project "${projectName}" — the name may already be taken by another Cloudflare account (Pages project names are globally unique, not just within your account).`,
      );
      let retryName = "";
      while (!retryName) retryName = await ask(ctx, "Try a different Cloudflare Pages project name");
      projectName = retryName;
    }
  }
}

/** `--production-branch main` (above) only takes effect when *creating* a
 * project — it's a no-op against a project that already existed before this
 * wizard touched it (e.g. one set up manually, or created while some other
 * branch was checked out). A deploy from `main` then silently lands as a
 * Preview deployment instead of Production, and the stable
 * `<project>.pages.dev` alias never updates — with no error, just a Pages
 * dashboard that quietly doesn't match what was just deployed.
 *
 * Confirms the deployment we just made (identified by its unique per-deploy
 * URL) actually landed as Production, by re-listing deployments and checking
 * its Environment. Warns with the fix (Pages dashboard -> Settings -> Builds
 * & deployments -> Production branch) rather than letting it pass silently. */
export async function warnIfNotProduction(ctx, wrangler, cwd, projectName, deployUrl) {
  if (!deployUrl) return;
  let stdout;
  try {
    ({ stdout } = await runCommand(ctx, {
      description: "Checking whether that deploy landed as Production.",
      cmd: wrangler,
      args: ["pages", "deployment", "list", "--project-name", projectName, "--json"],
      cwd,
      capture: true,
      quiet: true,
      readOnly: true,
    }));
  } catch {
    return; // not worth failing the whole wizard over a post-deploy sanity check
  }

  let deployments;
  try {
    const jsonStart = stdout.indexOf("[");
    deployments = jsonStart === -1 ? [] : JSON.parse(stdout.slice(jsonStart));
  } catch {
    return;
  }

  const deployment = deployments.find((d) => d["Deployment"] === deployUrl);
  if (!deployment || deployment["Environment"] === "Production") return;

  warn(
    `That deploy landed as Preview (branch "${deployment["Branch"]}"), not Production — ` +
      `"${projectName}.pages.dev" still points at whatever was last deployed to this project's ` +
      `actual production branch, not this deploy. Fix it in the Cloudflare dashboard: Pages -> ` +
      `${projectName} -> Settings -> Builds & deployments -> Production branch -> set to "main" -> redeploy.`,
  );
}
