import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWranglerJson } from "./parseWranglerJson.mjs";

const fixturesDir = join(fileURLToPath(import.meta.url), "..", "__fixtures__");
function fixture(name) {
  return readFileSync(join(fixturesDir, name), "utf8");
}

test("parses `d1 list --json` output past a leading warning banner", () => {
  const result = parseWranglerJson(fixture("d1-list.txt"), "[");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "shelve-db");
  assert.equal(result[0].uuid, "00000000-0000-0000-0000-000000000001");
});

test("parses an empty `d1 list --json` array", () => {
  const result = parseWranglerJson(fixture("d1-list-empty.txt"), "[");
  assert.deepEqual(result, []);
});

test("parses `d1 create --json` output past banner text and success messages", () => {
  const result = parseWranglerJson(fixture("d1-create.txt"), "{");
  assert.equal(result.uuid, "00000000-0000-0000-0000-000000000002");
});

test("returns null when the expected marker never appears", () => {
  assert.equal(parseWranglerJson("Authentication error: not logged in.", "["), null);
});

test("returns null (not a thrown error) on malformed JSON after the marker", () => {
  assert.equal(parseWranglerJson("prefix [not valid json", "["), null);
});

// Known limitation: if a noise line before the real payload contains the
// marker character itself (e.g. a `[WARNING]` tag), the naive
// first-occurrence scan latches onto that instead of the real payload and
// parsing fails. This test documents the current behavior so a future
// Wrangler release that adds this kind of noise is caught here rather than
// silently breaking the wizard — if `parseWranglerJson` is made smarter
// about this case, update this assertion rather than deleting it.
test("known limitation: a bracket inside a banner line breaks the scan", () => {
  const result = parseWranglerJson(fixture("d1-list-with-bracket-in-banner.txt"), "[");
  assert.equal(result, null);
});

test("a brace inside banner noise doesn't interfere when scanning for a different marker", () => {
  const result = parseWranglerJson(fixture("d1-list-with-brace-in-banner.txt"), "[");
  assert.equal(result.length, 1);
  assert.equal(result[0].uuid, "00000000-0000-0000-0000-000000000001");
});
