// Every Wrangler-touching action goes through runCommand(): print the exact
// command, confirm before running it, then execute. Nothing runs silently.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { confirm } from "./prompt.mjs";
import { dim, step } from "./style.mjs";

export class WizardAborted extends Error {}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {{description?: string, cmd: string, args?: string[], cwd?: string,
 *   capture?: boolean, stdinInput?: string}} opts
 *   `capture: true` tees stdout to the terminal while also returning it as a
 *   string, for the handful of calls the wizard needs to parse (a deploy
 *   URL, a generated database_id). `stdinInput` pipes a value into the
 *   child's stdin instead of inheriting the real terminal's stdin — used
 *   only for `wrangler secret put`, so the user never has to paste the
 *   generated API token by hand.
 */
export async function runCommand(rl, { description, cmd, args = [], cwd, capture = false, stdinInput = null }) {
  if (description) step(description);
  console.log(dim(`$ ${[cmd, ...args].join(" ")}${cwd ? `  (in ${cwd})` : ""}`));
  const proceed = await confirm(rl, "Run this?", true);
  if (!proceed) {
    throw new WizardAborted("Aborted — re-run any time, already-completed steps will be detected and skipped.");
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
        process.stdout.write(chunk);
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
 * whenever it isn't already there, means `pages deploy` never has to ask. */
export async function ensurePagesProjectExists(rl, wrangler, projectName) {
  const { stdout: listOut } = await runCommand(rl, {
    description: `Checking whether the Cloudflare Pages project "${projectName}" already exists.`,
    cmd: wrangler,
    args: ["pages", "project", "list", "--json"],
    capture: true,
  });

  let existingProjects = [];
  try {
    const jsonStart = listOut.indexOf("[");
    existingProjects = jsonStart === -1 ? [] : JSON.parse(listOut.slice(jsonStart));
  } catch {
    // Falls through and attempts a create below — `pages project create`
    // on an already-existing name just errors clearly, which is safer than
    // silently assuming it doesn't exist and hitting the interactive prompt.
  }

  if (existingProjects.some((p) => p["Project Name"] === projectName)) return;

  await runCommand(rl, {
    description: `Creating Cloudflare Pages project "${projectName}".`,
    cmd: wrangler,
    args: ["pages", "project", "create", projectName, "--production-branch", "main"],
  });
}
