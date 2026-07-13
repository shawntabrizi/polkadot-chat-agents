import assert from "node:assert/strict";
import test from "node:test";
import { t3amsDirectCapacityDefaults } from "../lib/t3ams-direct-capacity.mjs";

test("T3ams public direct bots default to a bounded model-turn budget", () => {
  assert.deepEqual(t3amsDirectCapacityDefaults({ publicDirect: true }), {
    maxConcurrentTurns: 2,
    maxQueuedTurns: 20,
  });
});

test("T3ams private direct bots retain the existing capacity defaults", () => {
  assert.deepEqual(t3amsDirectCapacityDefaults(), {
    maxConcurrentTurns: 4,
    maxQueuedTurns: 100,
  });
});
