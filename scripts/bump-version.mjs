#!/usr/bin/env node
// Bumps the project version across every place it's hand-duplicated:
// root/shared/worker/extension's package.json, extension/manifest.json,
// and worker/src/version.ts's WORKER_VERSION. Extension and worker share
// one project-wide version (see README's "Upgrading" section) even
// though they're deployed independently, so this keeps the extension's
// self-reported version and the Worker's /health version — which the
// compatibility check on the options page reasons about directly —
// consistent with each other during development, not just at release
// time.
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
  "extension/package.json",
  "extension/manifest.json",
]) {
  bumpJsonVersion(relPath);
}

const workerVersionPath = join(root, "worker/src/version.ts");
const workerVersionPattern = /export const WORKER_VERSION = "[^"]*";/;
const workerVersionContent = readFileSync(workerVersionPath, "utf8");
if (!workerVersionPattern.test(workerVersionContent)) {
  console.error("Couldn't find WORKER_VERSION to bump in worker/src/version.ts");
  process.exit(1);
}
writeFileSync(
  workerVersionPath,
  workerVersionContent.replace(workerVersionPattern, `export const WORKER_VERSION = "${version}";`),
);

console.log(`Bumped to ${version} everywhere. This is a normal dev commit — review the diff and commit whenever you like.`);
