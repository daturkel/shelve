import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonArray, extractDatabaseId } from "./discovery.mjs";

test("parseJsonArray() parses a clean JSON array", () => {
  assert.deepEqual(parseJsonArray('[{"name":"a"}]'), [{ name: "a" }]);
});

test("parseJsonArray() skips leading noise before the array", () => {
  const stdout = 'npm notice run shelve@0.5.0 npx\nSome banner text\n[{"name":"a"}]';
  assert.deepEqual(parseJsonArray(stdout), [{ name: "a" }]);
});

test("parseJsonArray() returns [] when there's no array at all", () => {
  assert.deepEqual(parseJsonArray("nothing here"), []);
});

test("parseJsonArray() returns [] on malformed JSON rather than throwing", () => {
  assert.deepEqual(parseJsonArray("[{not valid json"), []);
});

test("parseJsonArray() returns [] for an empty string", () => {
  assert.deepEqual(parseJsonArray(""), []);
});

test("parseJsonArray() unwraps a {result: [...]} envelope if that's what's found instead of a bare array", () => {
  const stdout = '{"result":[{"name":"a"}],"success":true}';
  assert.deepEqual(parseJsonArray(stdout), [{ name: "a" }]);
});

test("parseJsonArray() falls back to [] for an envelope whose result isn't an array", () => {
  assert.deepEqual(parseJsonArray('{"error":"nope"}'), []);
});

test("parseJsonArray() still parses a bare array when a '{' happens to appear inside it first", () => {
  // The normal shape every command actually returns: a bare array whose
  // first element is an object, so a naive "whichever bracket comes first"
  // check must not mistake this for an envelope.
  const stdout = '[{"name":"a"},{"name":"b"}]';
  assert.deepEqual(parseJsonArray(stdout), [{ name: "a" }, { name: "b" }]);
});

test("extractDatabaseId() checks uuid, then database_id, then id", () => {
  assert.equal(extractDatabaseId({ uuid: "u1" }), "u1");
  assert.equal(extractDatabaseId({ database_id: "d1" }), "d1");
  assert.equal(extractDatabaseId({ id: "i1" }), "i1");
  assert.equal(extractDatabaseId({ uuid: "u1", database_id: "d1" }), "u1"); // uuid wins
});

test("extractDatabaseId() returns undefined when none of the known keys are present", () => {
  assert.equal(extractDatabaseId({ name: "shelve-db" }), undefined);
});
