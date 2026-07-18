import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Regression test for a real gap: extension/package.json imported from
// @shelve/core extensively without ever declaring it as a dependency —
// it only worked because npm workspaces hoists every workspace member
// into the root node_modules regardless of declaration. Scans actual
// imports rather than hardcoding a package name, so it also catches any
// future undeclared @shelve/* workspace dependency, not just this one.

const SRC_DIR = join(import.meta.dirname, "..");
const PACKAGE_JSON_PATH = join(import.meta.dirname, "../../package.json");

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTsFiles(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function importedShelvePackages(): Set<string> {
  const packages = new Set<string>();
  for (const file of collectTsFiles(SRC_DIR)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/from\s+["']@shelve\/([a-zA-Z0-9_-]+)/g)) {
      packages.add(`@shelve/${match[1]}`);
    }
  }
  return packages;
}

describe("extension/package.json dependencies", () => {
  it("declares every @shelve/* package actually imported under src/", () => {
    const declared = Object.keys(JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).dependencies ?? {});
    const imported = importedShelvePackages();

    // Sanity check the scan itself isn't vacuous (e.g. a path typo
    // silently walking an empty directory).
    expect(imported.size).toBeGreaterThan(0);

    for (const pkg of imported) {
      expect(declared, `${pkg} is imported under src/ but not declared in package.json`).toContain(pkg);
    }
  });
});
