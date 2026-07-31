// Shared state threaded through every wizard primitive (ask/confirm/select in
// prompt.mjs, runCommand/ensurePagesProjectExists/warnIfNotProduction in
// exec.mjs, confirmAndRun in plan.mjs) instead of a bare readline Interface —
// those all need to agree on whether we're in --yes/--dry-run mode and
// whether a plan's single confirmation already covers the write about to
// run, not just how to prompt.

/** @typedef {ReturnType<typeof createContext>} WizardContext */

export function createContext({ rl = null, flags = {} } = {}) {
  return {
    rl,
    yes: Boolean(flags.yes),
    dryRun: Boolean(flags.dryRun),
    flags,
    // Set true by plan.mjs's confirmAndRun() while executing an
    // already-confirmed plan's steps, so runCommand() knows not to ask
    // "Run this?" again for each individual write.
    phaseConfirmed: false,
  };
}
