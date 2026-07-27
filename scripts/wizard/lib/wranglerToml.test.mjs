import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWranglerToml, writeWranglerToml, PLACEHOLDER_DATABASE_ID } from "./wranglerToml.mjs";

function makeFakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "shelve-wizard-test-"));
  mkdirSync(join(root, "worker"));
  writeFileSync(
    join(root, "worker", "wrangler.toml.example"),
    `name = "shelve-worker"\nmain = "src/index.ts"\ncompatibility_date = "2026-07-11"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "shelve-db"\ndatabase_id = "${PLACEHOLDER_DATABASE_ID}"\n`,
  );
  return root;
}

test("readWranglerToml returns null when wrangler.toml doesn't exist yet", () => {
  const root = makeFakeRoot();
  assert.equal(readWranglerToml(root), null);
  rmSync(root, { recursive: true, force: true });
});

test("writeWranglerToml copies from the example and fills in fields", () => {
  const root = makeFakeRoot();
  writeWranglerToml(root, { name: "my-worker", databaseName: "my-db", databaseId: "abc-123" });

  const result = readWranglerToml(root);
  assert.deepEqual(result, {
    name: "my-worker",
    databaseName: "my-db",
    databaseId: "abc-123",
    configured: true,
  });
  rmSync(root, { recursive: true, force: true });
});

test("readWranglerToml reports configured: false while database_id is still the placeholder", () => {
  const root = makeFakeRoot();
  writeFileSync(join(root, "worker", "wrangler.toml"), readFileSync(join(root, "worker", "wrangler.toml.example")));

  const result = readWranglerToml(root);
  assert.equal(result.configured, false);
  assert.equal(result.databaseId, PLACEHOLDER_DATABASE_ID);
  rmSync(root, { recursive: true, force: true });
});

test("writeWranglerToml only touches the fields it's given", () => {
  const root = makeFakeRoot();
  writeWranglerToml(root, { name: "my-worker", databaseName: "my-db", databaseId: "abc-123" });
  writeWranglerToml(root, { databaseId: "xyz-999" });

  const result = readWranglerToml(root);
  assert.equal(result.name, "my-worker");
  assert.equal(result.databaseName, "my-db");
  assert.equal(result.databaseId, "xyz-999");
  rmSync(root, { recursive: true, force: true });
});
