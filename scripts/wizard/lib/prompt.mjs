// Thin wrapper over node:readline/promises — no prompts/inquirer/@clack
// dependency for something used only at setup/upgrade time, matching
// scripts/bump-version.mjs and scripts/release.mjs already being
// dependency-free plain Node scripts in this repo.
import { dim } from "./style.mjs";

export async function ask(rl, question, defaultValue) {
  const suffix = defaultValue !== undefined ? dim(` (${defaultValue})`) : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

export async function confirm(rl, question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

/** choices: non-empty string[]. Loops until the user enters a valid 1-based
 * number, then returns it as a 0-based index — there's no "abort" option;
 * include one as a regular choice if a caller needs it (setup.mjs's "Create
 * a new database" entry is exactly this pattern). */
export async function select(rl, question, choices) {
  console.log(question);
  choices.forEach((choice, i) => console.log(`  ${i + 1}) ${choice}`));
  while (true) {
    const answer = (await rl.question(`Enter a number (1-${choices.length}): `)).trim();
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
    console.log(dim(`Enter a number between 1 and ${choices.length}.`));
  }
}
