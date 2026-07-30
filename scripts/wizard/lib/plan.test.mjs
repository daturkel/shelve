import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlan, confirmAndRun } from "./plan.mjs";
import { WizardAborted } from "./exec.mjs";

test("createPlan()'s add/isEmpty bookkeeping", () => {
  const plan = createPlan();
  assert.equal(plan.isEmpty, true);
  plan.add("do a thing", () => {});
  assert.equal(plan.isEmpty, false);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].label, "do a thing");
});

test("confirmAndRun() is a no-op for an empty plan, regardless of mode", async () => {
  const ctx = { yes: false, dryRun: false, rl: null, phaseConfirmed: false };
  await confirmAndRun(ctx, createPlan()); // would throw on rl.question if it tried to prompt
});

test("confirmAndRun() under --dry-run prints the plan but runs no steps", async () => {
  let ran = false;
  const plan = createPlan().add("step one", () => {
    ran = true;
  });
  const ctx = { yes: false, dryRun: true, rl: null, phaseConfirmed: false };
  await confirmAndRun(ctx, plan);
  assert.equal(ran, false);
});

test("confirmAndRun() under --yes runs every step without touching ctx.rl", async () => {
  const order = [];
  const plan = createPlan()
    .add("step one", () => order.push(1))
    .add("step two", () => order.push(2));
  const ctx = { yes: true, dryRun: false, rl: null, phaseConfirmed: false };
  await confirmAndRun(ctx, plan);
  assert.deepEqual(order, [1, 2]);
});

test("confirmAndRun() sets ctx.phaseConfirmed true only while steps run", async () => {
  let sawConfirmedDuring;
  const ctx = { yes: true, dryRun: false, rl: null, phaseConfirmed: false };
  const plan = createPlan().add("step", () => {
    sawConfirmedDuring = ctx.phaseConfirmed;
  });
  await confirmAndRun(ctx, plan);
  assert.equal(sawConfirmedDuring, true);
  assert.equal(ctx.phaseConfirmed, false); // reset after
});

test("confirmAndRun() resets ctx.phaseConfirmed even if a step throws", async () => {
  const plan = createPlan().add("step", () => {
    throw new Error("boom");
  });
  const ctx = { yes: true, dryRun: false, rl: null, phaseConfirmed: false };
  await assert.rejects(() => confirmAndRun(ctx, plan), /boom/);
  assert.equal(ctx.phaseConfirmed, false);
});

test("confirmAndRun() interactively asks once, then runs all steps on 'y'", async () => {
  const order = [];
  const plan = createPlan()
    .add("step one", () => order.push(1))
    .add("step two", () => order.push(2));
  const ctx = { yes: false, dryRun: false, rl: { question: async () => "y" }, phaseConfirmed: false };
  await confirmAndRun(ctx, plan);
  assert.deepEqual(order, [1, 2]);
});

test("confirmAndRun() throws WizardAborted and runs nothing on 'n'", async () => {
  let ran = false;
  const plan = createPlan().add("step", () => {
    ran = true;
  });
  const ctx = { yes: false, dryRun: false, rl: { question: async () => "n" }, phaseConfirmed: false };
  await assert.rejects(() => confirmAndRun(ctx, plan), WizardAborted);
  assert.equal(ran, false);
});
