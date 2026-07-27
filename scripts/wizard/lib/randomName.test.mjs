import { test } from "node:test";
import assert from "node:assert/strict";
import { randomProjectName } from "./randomName.mjs";

test("randomProjectName returns an adjective-noun-NN triple matching the expected shape", () => {
  const name = randomProjectName();
  assert.match(name, /^[a-z]+-[a-z]+-\d{2}$/);
});

test("randomProjectName varies across calls", () => {
  // Not a strict guarantee (two calls could coincidentally match), but with
  // 20 adjectives x 18 nouns x 100 suffixes = 36,000 combinations,
  // collecting a decent sample and asserting more than one distinct value
  // is a reliable enough smoke test that this isn't hardcoded to one name.
  const names = new Set(Array.from({ length: 20 }, () => randomProjectName()));
  assert.ok(names.size > 1);
});
