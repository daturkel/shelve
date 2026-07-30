import { test } from "node:test";
import assert from "node:assert/strict";
import { needsConfirmation } from "./exec.mjs";

// runCommand() itself shells out via child_process.spawn and isn't unit
// tested (matches this repo's convention for I/O-heavy top-level logic —
// see setup.mjs/upgrade.mjs before it, deploy.mjs/status.mjs now). But the
// entire point of this refactor is the readOnly/yes/phaseConfirmed gating
// decision, so that decision is pulled out into its own pure predicate and
// exhaustively tested here rather than only provable by tracing every call
// site by hand.

test("readOnly always skips confirmation, regardless of yes/phaseConfirmed", () => {
  assert.equal(needsConfirmation({ readOnly: true, yes: false, phaseConfirmed: false }), false);
  assert.equal(needsConfirmation({ readOnly: true, yes: true, phaseConfirmed: false }), false);
  assert.equal(needsConfirmation({ readOnly: true, yes: false, phaseConfirmed: true }), false);
});

test("--yes skips confirmation for a write", () => {
  assert.equal(needsConfirmation({ readOnly: false, yes: true, phaseConfirmed: false }), false);
});

test("a confirmed plan phase skips confirmation for its own writes", () => {
  assert.equal(needsConfirmation({ readOnly: false, yes: false, phaseConfirmed: true }), false);
});

test("a plain write, outside any of the above, needs confirmation", () => {
  assert.equal(needsConfirmation({ readOnly: false, yes: false, phaseConfirmed: false }), true);
});
