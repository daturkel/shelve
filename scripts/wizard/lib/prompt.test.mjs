import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, confirm, select, WizardInputRequired } from "./prompt.mjs";

// ctx.rl is left null throughout the --yes tests below — a real attempt to
// call rl.question() on it would throw a TypeError, which doubles as an
// implicit assertion that the short-circuit never touches rl at all.

test("ask() returns the default silently under --yes when one is given", async () => {
  const ctx = { yes: true, rl: null };
  assert.equal(await ask(ctx, "Name?", "shelve-db"), "shelve-db");
});

test("ask() throws WizardInputRequired under --yes with no default", async () => {
  const ctx = { yes: true, rl: null };
  await assert.rejects(() => ask(ctx, "Name?", undefined), WizardInputRequired);
});

test("ask()'s WizardInputRequired message includes the flag hint when given", async () => {
  const ctx = { yes: true, rl: null };
  await assert.rejects(() => ask(ctx, "Name?", undefined, { flagHint: "--database" }), /--database/);
});

test("ask()'s empty-string default counts as defined, not missing", async () => {
  const ctx = { yes: true, rl: null };
  assert.equal(await ask(ctx, "Token?", ""), "");
});

test("ask() prompts interactively and returns the typed value when not --yes", async () => {
  const ctx = { yes: false, rl: { question: async () => "typed value" } };
  assert.equal(await ask(ctx, "Name?", "default"), "typed value");
});

test("ask() falls back to the default on an empty interactive answer", async () => {
  const ctx = { yes: false, rl: { question: async () => "" } };
  assert.equal(await ask(ctx, "Name?", "default"), "default");
});

test("confirm() returns its default silently under --yes (true case)", async () => {
  const ctx = { yes: true, rl: null };
  assert.equal(await confirm(ctx, "Proceed?", true), true);
});

test("confirm() returns its default silently under --yes (false case)", async () => {
  const ctx = { yes: true, rl: null };
  assert.equal(await confirm(ctx, "Rotate?", false), false);
});

test("confirm() prompts interactively and parses y/n", async () => {
  const ctxYes = { yes: false, rl: { question: async () => "y" } };
  assert.equal(await confirm(ctxYes, "Proceed?", false), true);
  const ctxNo = { yes: false, rl: { question: async () => "n" } };
  assert.equal(await confirm(ctxNo, "Proceed?", true), false);
});

test("select() always throws under --yes, even with a single choice", async () => {
  const ctx = { yes: true, rl: null };
  await assert.rejects(() => select(ctx, "Pick one", ["only option"]), WizardInputRequired);
});

test("select()'s WizardInputRequired message includes the flag hint when given", async () => {
  const ctx = { yes: true, rl: null };
  await assert.rejects(() => select(ctx, "Pick one", ["a", "b"], { flagHint: "--database" }), /--database/);
});

test("select() prompts interactively and returns a 0-based index", async () => {
  const ctx = { yes: false, rl: { question: async () => "2" } };
  assert.equal(await select(ctx, "Pick one", ["a", "b", "c"]), 1);
});
