#!/usr/bin/env node
// Root package.json's "version" is the source of truth — bump it by hand
// whenever during development. This script syncs that version into every
// other place it's hand-duplicated (shared/worker/extension's
// package.json, extension/manifest.json, worker/src/version.ts), and
// promotes CHANGELOG.md's [Unreleased] section to a dated release section
// with a fresh empty [Unreleased] above it.
//
// Refuses to run if a `vX.Y.Z` tag for the current version already
// exists, so forgetting to bump the version before re-running this fails
// loudly instead of silently no-op'ing.
//
// This only edits files — it doesn't commit, tag, or push. Review the
// diff, then:
//   git add -A && git commit -m "Release vX.Y.Z"
//   git tag vX.Y.Z && git push && git push --tags
// Pushing the tag triggers .github/workflows/release.yml, which builds
// the extension and attaches it to a GitHub Release — it doesn't touch
// versioning or the changelog itself, so the tag you push always exactly
// matches what this script already committed.
//
// Usage: node scripts/release.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const rootPackageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = rootPackageJson.version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json's "version" (${JSON.stringify(version)}) isn't a plain X.Y.Z semver — fix that first.`);
  process.exit(1);
}

const tag = `v${version}`;
// Local-only check — fine for a single-clone, single-maintainer workflow;
// this doesn't guard against a tag existing on a remote you haven't fetched.
const existingTag = execFileSync("git", ["tag", "--list", tag], { cwd: root, encoding: "utf8" }).trim();
if (existingTag) {
  console.error(`Tag ${tag} already exists — bump package.json's "version" before releasing again.`);
  process.exit(1);
}

// Surgical regex replaces rather than JSON.parse + stringify — the latter
// reformats manifest.json's inline arrays onto multiple lines, turning a
// one-line version bump into unrelated diff noise.
const jsonVersionPattern = /"version":\s*"[^"]*"/;

function syncJsonVersion(relPath) {
  const path = join(root, relPath);
  const content = readFileSync(path, "utf8");
  if (!jsonVersionPattern.test(content)) {
    console.error(`Couldn't find a "version" field to sync in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, content.replace(jsonVersionPattern, `"version": "${version}"`));
}

for (const relPath of ["shared/package.json", "worker/package.json", "extension/package.json", "extension/manifest.json"]) {
  syncJsonVersion(relPath);
}

const workerVersionPath = join(root, "worker/src/version.ts");
const workerVersionPattern = /export const WORKER_VERSION = "[^"]*";/;
const workerVersionContent = readFileSync(workerVersionPath, "utf8");
if (!workerVersionPattern.test(workerVersionContent)) {
  console.error(`Couldn't find WORKER_VERSION to sync in worker/src/version.ts`);
  process.exit(1);
}
writeFileSync(
  workerVersionPath,
  workerVersionContent.replace(workerVersionPattern, `export const WORKER_VERSION = "${version}";`),
);

const changelogPath = join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");

const unreleasedHeading = "## [Unreleased]";
const idx = changelog.indexOf(unreleasedHeading);
if (idx === -1) {
  console.error(`Couldn't find "${unreleasedHeading}" in CHANGELOG.md — nothing to release.`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const before = changelog.slice(0, idx);
// One-time: strip the placeholder line used before any release existed.
const after = changelog
  .slice(idx + unreleasedHeading.length)
  .replace(/\n\nEverything so far — no release has been cut yet\./, "");

const updatedChangelog = `${before}${unreleasedHeading}\n\n## [${version}] - ${date}${after}`;
writeFileSync(changelogPath, updatedChangelog);

console.log(`Synced ${version} across shared/worker/extension and promoted CHANGELOG.md to ${tag}.`);
console.log("Review the diff, then:");
console.log(`  git add -A && git commit -m "Release ${tag}"`);
console.log(`  git tag ${tag} && git push && git push --tags`);
