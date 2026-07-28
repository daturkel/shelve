#!/usr/bin/env node
// Bumps the project version across every place it's hand-duplicated:
// root/shared/worker/extension/web's package.json, extension/manifest.json,
// worker/src/version.ts's WORKER_VERSION, and web/src/version.ts's
// WEB_VERSION. Extension, worker, and web share one project-wide version
// (see README's "Upgrading" section) even though they're deployed
// independently, so this keeps the extension's self-reported version, the
// Worker's /health version — which the compatibility check on the
// options/settings page reasons about directly — and the web app's own
// self-reported version consistent with each other during development, not
// just at release time.
//
// This only edits files — it doesn't commit anything. Run it whenever
// you're ready to start working towards a new version; committing the
// result is a normal dev commit, unrelated to actually cutting a
// release (see scripts/release.mjs for that).
//
// Usage: node scripts/bump-version.mjs 0.2.0   (no leading "v")

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <version>  (e.g. 0.2.0, no leading 'v')");
  process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Surgical regex replaces rather than JSON.parse + stringify — the
// latter reformats manifest.json's inline arrays onto multiple lines,
// turning a one-line version bump into unrelated diff noise.
const jsonVersionPattern = /"version":\s*"[^"]*"/;

function bumpJsonVersion(relPath) {
  const path = join(root, relPath);
  const content = readFileSync(path, "utf8");
  if (!jsonVersionPattern.test(content)) {
    console.error(`Couldn't find a "version" field to bump in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, content.replace(jsonVersionPattern, `"version": "${version}"`));
}

for (const relPath of [
  "package.json",
  "shared/package.json",
  "worker/package.json",
  "core/package.json",
  "extension/package.json",
  "extension/manifest.json",
  "web/package.json",
]) {
  bumpJsonVersion(relPath);
}

function bumpVersionConst(relPath, constName) {
  const path = join(root, relPath);
  const pattern = new RegExp(`export const ${constName} = "[^"]*";`);
  const content = readFileSync(path, "utf8");
  if (!pattern.test(content)) {
    console.error(`Couldn't find ${constName} to bump in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, content.replace(pattern, `export const ${constName} = "${version}";`));
}

bumpVersionConst("worker/src/version.ts", "WORKER_VERSION");
bumpVersionConst("web/src/version.ts", "WEB_VERSION");

console.log(
  `Bumped to ${version} everywhere. This is a normal dev commit — review the diff and commit whenever you like.`,
);
