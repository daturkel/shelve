// Shared read-only Cloudflare-state lookups, used by both status.mjs and
// deploy.mjs's discovery steps. Every runCommand() call here is
// readOnly: true — nothing in this file can change anything.
import { runCommand } from "./exec.mjs";
import { warn } from "./style.mjs";

/** Parses a JSON array out of wrangler's stdout, tolerating leading noise
 * (npm/wrangler banner lines) before the array itself starts. Also unwraps a
 * Cloudflare-API-style `{"result": [...], "success": true}` envelope if
 * that's what's found instead of a bare array — `--json` output has been a
 * bare array for every command this file uses, confirmed against a real
 * account, but the two shapes are easy to confuse and a bare-array-only
 * parser would otherwise silently see "found nothing" instead of erroring
 * loudly if that ever changes. Returns [] rather than throwing on anything
 * still unparseable after that — callers treat "couldn't tell" the same as
 * "found nothing", which is the safe fallback for a discovery step, not the
 * safe fallback for a write. */
export function parseJsonArray(stdout) {
  const start = stdout.indexOf("[");
  const objStart = stdout.indexOf("{");
  const useObject = objStart !== -1 && (start === -1 || objStart < start);

  if (useObject) {
    try {
      const parsed = JSON.parse(stdout.slice(objStart));
      if (Array.isArray(parsed.result)) return parsed.result;
    } catch {
      // falls through to the bare-array attempt below
    }
  }

  try {
    return start === -1 ? [] : JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
}

/** D1's `d1 list --json` entries use different key names across wrangler
 * versions/output shapes for the same field — this checks all of them.
 * Returns undefined (not throws) when none match, so callers can decide
 * what "couldn't determine the id" means for their own situation. */
export function extractDatabaseId(db) {
  return db.uuid ?? db.database_id ?? db.id;
}

export async function checkLogin(ctx, wrangler, cwd) {
  const { stdout } = await runCommand(ctx, {
    description: "Checking Cloudflare login status.",
    cmd: wrangler,
    args: ["whoami"],
    cwd,
    capture: true,
    readOnly: true,
  });
  return !/not authenticated/i.test(stdout);
}

export async function listD1Databases(ctx, wrangler, cwd) {
  const { stdout } = await runCommand(ctx, {
    description: "Checking for existing D1 databases.",
    cmd: wrangler,
    args: ["d1", "list", "--json"],
    cwd,
    capture: true,
    quiet: true,
    readOnly: true,
  });
  return parseJsonArray(stdout);
}

export async function listPagesProjects(ctx, wrangler) {
  const { stdout } = await runCommand(ctx, {
    description: "Checking for existing Cloudflare Pages projects.",
    cmd: wrangler,
    args: ["pages", "project", "list", "--json"],
    capture: true,
    quiet: true,
    readOnly: true,
  });
  return parseJsonArray(stdout);
}

/** Checks whether a *specific* Worker name already has deployments —
 * `wrangler deployments list --name <name> --json` works standalone, with no
 * local wrangler.toml needed, unlike `deployments list` used without --name.
 * There's no account-wide "list all Workers" command, so this is the
 * narrowest question we can actually answer: not "what Workers exist", only
 * "does *this* name already exist".
 *
 * A name with zero deployments makes the command itself exit non-zero
 * (confirmed against a real account: "This Worker does not exist on your
 * account. [code: 10007]") — but runCommand() doesn't capture stderr, so a
 * genuinely-unrelated failure (not logged in yet, a network blip, an
 * unexpected API error) throws the exact same shape of error and can't be
 * told apart here. Rather than silently treating every failure as "safe,
 * doesn't exist" — which would quietly disable the overwrite warning this
 * function exists to provide, for exactly the failure modes where it
 * matters most — any error is surfaced with a warning before falling back to
 * "doesn't exist", so the fallback is visible instead of silent. */
export async function checkWorkerExists(ctx, wrangler, cwd, name) {
  try {
    const { stdout } = await runCommand(ctx, {
      description: `Checking whether a Worker named "${name}" already exists.`,
      cmd: wrangler,
      args: ["deployments", "list", "--name", name, "--json"],
      cwd,
      capture: true,
      quiet: true,
      readOnly: true,
    });
    return parseJsonArray(stdout).length > 0;
  } catch (e) {
    warn(
      `Couldn't check whether a Worker named "${name}" already exists (${e.message}) — proceeding as if it doesn't. ` +
        `If it does, deploying will redeploy over it without the usual warning.`,
    );
    return false;
  }
}
