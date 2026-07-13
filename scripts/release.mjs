#!/usr/bin/env node
// Cuts a release of whatever version is currently set across the repo
// (see scripts/bump-version.mjs to change it first). Validates that
// every hand-duplicated version location actually agrees, refuses to
// run if a `vX.Y.Z` tag for that version already exists, and promotes
// CHANGELOG.md's [Unreleased] section to a dated release section with a
// fresh empty [Unreleased] above it.
//
// This only edits CHANGELOG.md — it doesn't bump versions, commit, tag,
// or push. Review the diff, then:
//   git add -A && git commit -m "Release vX.Y.Z"
//   git tag vX.Y.Z && git push && git push --tags
// Pushing the tag triggers .github/workflows/release.yml, which builds
// the extension and attaches it to a GitHub Release.
//
// Usage: node scripts/release.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const jsonVersionPattern = /"version":\s*"([^"]*)"/;
const workerVersionPattern = /export const WORKER_VERSION = "([^"]*)";/;

function readVersion(relPath, pattern) {
  const content = readFileSync(join(root, relPath), "utf8");
  const match = content.match(pattern);
  if (!match) {
    console.error(`Couldn't find a version in ${relPath}`);
    process.exit(1);
  }
  return match[1];
}

const versions = {
  "package.json": readVersion("package.json", jsonVersionPattern),
  "shared/package.json": readVersion("shared/package.json", jsonVersionPattern),
  "worker/package.json": readVersion("worker/package.json", jsonVersionPattern),
  "extension/package.json": readVersion("extension/package.json", jsonVersionPattern),
  "extension/manifest.json": readVersion("extension/manifest.json", jsonVersionPattern),
  "worker/src/version.ts": readVersion("worker/src/version.ts", workerVersionPattern),
};

const version = versions["package.json"];
const mismatches = Object.entries(versions).filter(([, v]) => v !== version);
if (mismatches.length > 0) {
  console.error(`Version mismatch — package.json says ${version}, but:`);
  for (const [file, v] of mismatches) console.error(`  ${file}: ${v}`);
  console.error("Run `node scripts/bump-version.mjs <version>` to sync them before releasing.");
  process.exit(1);
}

const tag = `v${version}`;
// Local-only check — fine for a single-clone, single-maintainer workflow;
// this doesn't guard against a tag existing on a remote you haven't fetched.
const existingTag = execFileSync("git", ["tag", "--list", tag], { cwd: root, encoding: "utf8" }).trim();
if (existingTag) {
  console.error(`Tag ${tag} already exists — bump the version (scripts/bump-version.mjs) before releasing again.`);
  process.exit(1);
}

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

console.log(`Promoted CHANGELOG.md to ${tag}.`);
console.log("Review the diff, then:");
console.log(`  git add -A && git commit -m "Release ${tag}"`);
console.log(`  git tag ${tag} && git push && git push --tags`);
