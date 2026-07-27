import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWizardConfig, writeWizardConfig } from "./wizardConfig.mjs";

test("readWizardConfig returns {} when .shelve/wizard.json doesn't exist", () => {
  const root = mkdtempSync(join(tmpdir(), "shelve-wizard-test-"));
  assert.deepEqual(readWizardConfig(root), {});
  rmSync(root, { recursive: true, force: true });
});

test("writeWizardConfig creates the file and round-trips values", () => {
  const root = mkdtempSync(join(tmpdir(), "shelve-wizard-test-"));
  writeWizardConfig(root, { pagesProjectName: "shelve-web" });
  assert.deepEqual(readWizardConfig(root), { pagesProjectName: "shelve-web" });
  rmSync(root, { recursive: true, force: true });
});

test("writeWizardConfig merges with existing values rather than overwriting the whole file", () => {
  const root = mkdtempSync(join(tmpdir(), "shelve-wizard-test-"));
  writeWizardConfig(root, { pagesProjectName: "shelve-web" });
  writeWizardConfig(root, { someOtherField: 42 });
  assert.deepEqual(readWizardConfig(root), { pagesProjectName: "shelve-web", someOtherField: 42 });
  rmSync(root, { recursive: true, force: true });
});
