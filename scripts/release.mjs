#!/usr/bin/env node
// Bumps the version in every package.json plus extension/manifest.json
// (hand-duplicated across all of them — see worker/src/version.ts for why),
// and promotes CHANGELOG.md's [Unreleased] section to a dated release
// section with a fresh empty [Unreleased] above it.
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
// Usage: node scripts/release.mjs 0.2.0   (no leading "v")

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/release.mjs <version>  (e.g. 0.2.0, no leading 'v')");
  process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// A surgical regex replace rather than JSON.parse + stringify — the
// latter reformats manifest.json's inline arrays onto multiple lines,
// turning a one-line version bump into unrelated diff noise.
function bumpVersionField(relPath) {
  const path = join(root, relPath);
  const content = readFileSync(path, "utf8");
  const updated = content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  if (updated === content) {
    console.error(`Couldn't find a "version" field to bump in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, updated);
}

for (const relPath of [
  "package.json",
  "shared/package.json",
  "worker/package.json",
  "extension/package.json",
  "extension/manifest.json",
]) {
  bumpVersionField(relPath);
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

const updated = `${before}${unreleasedHeading}\n\n## [${version}] - ${date}${after}`;
writeFileSync(changelogPath, updated);

console.log(`Bumped to ${version} across package.json/manifest.json and updated CHANGELOG.md.`);
console.log("Review the diff, then:");
console.log(`  git add -A && git commit -m "Release v${version}"`);
console.log(`  git tag v${version} && git push && git push --tags`);
