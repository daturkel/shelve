// Thin wrapper over node:readline/promises — no prompts/inquirer/@clack
// dependency for something used only at setup/upgrade time, matching
// scripts/bump-version.mjs and scripts/release.mjs already being
// dependency-free plain Node scripts in this repo.
import { dim } from "./style.mjs";

/** Thrown when --yes mode reaches a question with no safe default to fall
 * back on — a genuine human decision (per the "never guess" rule: even a
 * single matching candidate must be explicitly confirmed, not auto-picked)
 * that non-interactive mode can't answer on its own. Callers should name the
 * CLI flag that supplies the missing information. */
export class WizardInputRequired extends Error {}

export async function ask(ctx, question, defaultValue, { flagHint } = {}) {
  if (ctx.yes) {
    if (defaultValue !== undefined) return defaultValue;
    throw new WizardInputRequired(
      `--yes needs an answer for "${question}"` + (flagHint ? ` — pass ${flagHint}=<value>.` : "."),
    );
  }
  const suffix = defaultValue !== undefined ? dim(` (${defaultValue})`) : "";
  const answer = (await ctx.rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

export async function confirm(ctx, question, defaultYes = true) {
  // Every confirm() call site is expected to have a deliberately-chosen,
  // safe default (e.g. "rotate the token?" defaults to false) — --yes
  // silently accepting it is exactly the intended non-interactive behavior,
  // not a heuristic guess.
  if (ctx.yes) return defaultYes;
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await ctx.rl.question(`${question} [${hint}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

/** choices: non-empty string[]. Loops until the user enters a valid 1-based
 * number, then returns it as a 0-based index — there's no "abort" option;
 * include one as a regular choice if a caller needs it (setup.mjs's "Create
 * a new database" entry is exactly this pattern).
 *
 * Always throws under --yes, regardless of how many choices there are — this
 * is exactly the "never auto-pick, even with one candidate" rule; every
 * select() call site must have a corresponding CLI flag that bypasses it
 * entirely rather than falling through here. */
export async function select(ctx, question, choices, { flagHint } = {}) {
  if (ctx.yes) {
    throw new WizardInputRequired(
      `--yes can't make this choice automatically: "${question}"` + (flagHint ? ` — pass ${flagHint}=<value>.` : "."),
    );
  }
  console.log(question);
  choices.forEach((choice, i) => console.log(`  ${i + 1}) ${choice}`));
  while (true) {
    const answer = (await ctx.rl.question(`Enter a number (1-${choices.length}): `)).trim();
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
    console.log(dim(`Enter a number between 1 and ${choices.length}.`));
  }
}
