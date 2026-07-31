// Dependency-free flag parser — no yargs/commander, matching
// scripts/bump-version.mjs and scripts/release.mjs's existing convention for
// scripts that only run at setup/upgrade time.

const BOOLEAN_FLAGS = {
  "--yes": ["yes", true],
  "-y": ["yes", true],
  "--dry-run": ["dryRun", true],
  "--web": ["web", true],
  "--no-web": ["web", false],
  "--extension": ["extension", true],
  "--no-extension": ["extension", false],
  "--rotate-token": ["rotateToken", true],
  "--no-rotate-token": ["rotateToken", false],
};

const VALUE_FLAGS = {
  "--database": "database",
  "--worker-name": "workerName",
  "--pages-project": "pagesProject",
};

/** Every flag defaults to undefined except the two plain booleans (yes,
 * dryRun), which default to false so callers can use them directly without
 * an undefined check. web/extension/rotateToken stay undefined-by-default —
 * that "not specified" state is meaningful (see deploy.mjs's --yes fallback
 * behavior, which differs per flag). */
export function parseArgs(argv) {
  const flags = { yes: false, dryRun: false };

  for (const arg of argv) {
    if (arg in BOOLEAN_FLAGS) {
      const [key, value] = BOOLEAN_FLAGS[arg];
      flags[key] = value;
      continue;
    }

    const eq = arg.indexOf("=");
    const flagName = eq === -1 ? arg : arg.slice(0, eq);
    if (flagName in VALUE_FLAGS) {
      if (eq === -1) throw new Error(`"${flagName}" needs a value, e.g. "${flagName}=<value>".`);
      flags[VALUE_FLAGS[flagName]] = arg.slice(eq + 1);
      continue;
    }

    throw new Error(`Unrecognized argument: "${arg}".`);
  }

  return flags;
}
