import { test } from "node:test";
import assert from "node:assert/strict";
import {
  T3AMS_STATEMENT_TTL_SECONDS,
  createSerializedSubmitter,
  createT3amsPriorityClock,
  restoreT3amsPriority,
} from "../lib/t3ams-submission.mjs";

test("T3ams priorities use a 24-hour expiry and remain monotonic across restores", () => {
  const advances = [];
  const clock = createT3amsPriorityClock({ nowSeconds: () => 100, onAdvance: (value) => advances.push(value) });
  const first = clock.nextPriority();
  assert.equal(first, BigInt(100 + T3AMS_STATEMENT_TTL_SECONDS) << 32n);
  const second = clock.nextPriority();
  assert.equal(second, first + 1n);

  const restarted = createT3amsPriorityClock({ initialPriority: second, nowSeconds: () => 100 });
  assert.equal(restarted.nextPriority(), second + 1n);
  assert.equal(advances.length, 2);
});

test("T3ams priority rejection advances the next statement beyond the chain hint", () => {
  const clock = createT3amsPriorityClock({ nowSeconds: () => 100 });
  const first = clock.nextPriority();
  assert.equal(clock.noteRejectedPriority(first + 50n), true);
  assert.equal(clock.nextPriority(), first + 51n);
  assert.equal(clock.noteRejectedPriority(first), false);
});

test("invalid persisted priorities safely reset to zero", () => {
  assert.equal(restoreT3amsPriority("not-a-number"), 0n);
  assert.equal(restoreT3amsPriority(-1n), 0n);
  assert.equal(restoreT3amsPriority("42"), 42n);
});

test("serialized submitter never overlaps sends and recovers after a failure", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const submit = createSerializedSubmitter(async (value) => {
    events.push(`start:${value}`);
    if (value === "first") await firstGate;
    if (value === "broken") throw new Error("expected");
    events.push(`finish:${value}`);
    return value;
  });

  const first = submit("first");
  const second = submit("second");
  await Promise.resolve();
  assert.deepEqual(events, ["start:first"]);
  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(events, ["start:first", "finish:first", "start:second", "finish:second"]);

  await assert.rejects(submit("broken"), /expected/);
  assert.equal(await submit("after"), "after");
  assert.deepEqual(events.slice(-3), ["start:broken", "start:after", "finish:after"]);
});
