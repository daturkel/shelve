// The "discover everything, build an ordered write list, print it once,
// confirm once, execute" pattern shared by every phase (worker, web) in
// deploy.mjs — replaces asking "Run this?" once per individual write with a
// single "Proceed with these N steps?" for the whole phase.
import { confirm } from "./prompt.mjs";
import { WizardAborted } from "./exec.mjs";
import * as ui from "./style.mjs";

export function createPlan() {
  const steps = [];
  return {
    steps,
    add(label, run) {
      steps.push({ label, run });
      return this;
    },
    get isEmpty() {
      return steps.length === 0;
    },
  };
}

/** Prints the plan, gets one confirmation (skipped under --yes), then runs
 * every step with per-step confirmation suppressed via ctx.phaseConfirmed —
 * each step's own command is still printed as it runs (runCommand's own
 * `$ ...` line), only the individual "Run this?" gate is skipped. Under
 * --dry-run, prints the plan and returns without running anything; callers
 * whose later code depends on a step's output (e.g. a deploy URL parsed from
 * stdout) must check ctx.dryRun themselves before using it. */
export async function confirmAndRun(ctx, plan, { phaseLabel = "Plan" } = {}) {
  if (plan.isEmpty) return;

  ui.heading(phaseLabel);
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.label}`));

  if (ctx.dryRun) {
    console.log(ui.dim("(dry run — nothing executed)"));
    return;
  }

  if (!ctx.yes) {
    const proceed = await confirm(ctx, `Proceed with these ${plan.steps.length} step(s)?`, true);
    if (!proceed) {
      throw new WizardAborted("Aborted — re-run any time, already-completed steps will be detected and skipped.");
    }
  }

  ctx.phaseConfirmed = true;
  try {
    for (const s of plan.steps) await s.run();
  } finally {
    ctx.phaseConfirmed = false;
  }
}
