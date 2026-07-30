import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.mjs";

test("defaults yes/dryRun to false and leaves everything else undefined with no args", () => {
  const flags = parseArgs([]);
  assert.equal(flags.yes, false);
  assert.equal(flags.dryRun, false);
  assert.equal(flags.database, undefined);
  assert.equal(flags.web, undefined);
});

test("--yes and its -y alias both set yes: true", () => {
  assert.equal(parseArgs(["--yes"]).yes, true);
  assert.equal(parseArgs(["-y"]).yes, true);
});

test("--dry-run sets dryRun: true", () => {
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
});

test("--web/--no-web and --extension/--no-extension set explicit true/false, not just presence", () => {
  assert.equal(parseArgs(["--web"]).web, true);
  assert.equal(parseArgs(["--no-web"]).web, false);
  assert.equal(parseArgs(["--extension"]).extension, true);
  assert.equal(parseArgs(["--no-extension"]).extension, false);
});

test("--rotate-token/--no-rotate-token set explicit true/false", () => {
  assert.equal(parseArgs(["--rotate-token"]).rotateToken, true);
  assert.equal(parseArgs(["--no-rotate-token"]).rotateToken, false);
});

test("parses =-valued flags", () => {
  const flags = parseArgs(["--database=shelve-db", "--worker-name=shelve-worker", "--pages-project=my-app"]);
  assert.equal(flags.database, "shelve-db");
  assert.equal(flags.workerName, "shelve-worker");
  assert.equal(flags.pagesProject, "my-app");
});

test("a value containing '=' is preserved past the first '='", () => {
  assert.equal(parseArgs(["--database=a=b"]).database, "a=b");
});

test("throws when a value flag is given without '='", () => {
  assert.throws(() => parseArgs(["--database"]), /needs a value/);
});

test("throws on an unrecognized argument", () => {
  assert.throws(() => parseArgs(["--bogus"]), /Unrecognized argument/);
});

test("combines multiple flags", () => {
  const flags = parseArgs(["--yes", "--database=shelve-db", "--no-web"]);
  assert.equal(flags.yes, true);
  assert.equal(flags.database, "shelve-db");
  assert.equal(flags.web, false);
});

test("a conflicting pair of a flag and its --no- negation resolves last-one-wins, not an error", () => {
  // Not validated as a hard conflict — same convention as most CLI parsers
  // (the last occurrence of a repeated/conflicting flag decides).
  assert.equal(parseArgs(["--web", "--no-web"]).web, false);
  assert.equal(parseArgs(["--no-web", "--web"]).web, true);
});
