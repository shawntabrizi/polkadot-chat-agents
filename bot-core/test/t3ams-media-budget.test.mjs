import { test } from "node:test";
import assert from "node:assert/strict";
import { createT3amsMediaAnalysisBudget } from "../lib/t3ams-media-budget.mjs";

test("media budget consumes both global and per-sender tokens, then refills deterministically", () => {
  let now = 0;
  const budget = createT3amsMediaAnalysisBudget({
    senderCapacity: 2,
    senderWindowMs: 1_000,
    globalCapacity: 3,
    globalWindowMs: 1_000,
    now: () => now,
  });
  assert.equal(budget.reserve("alice").allowed, true);
  assert.equal(budget.reserve("alice").allowed, true);
  const senderDenied = budget.reserve("alice");
  assert.deepEqual(senderDenied, { allowed: false, reason: "sender", retryAfterMs: 500 });
  assert.equal(budget.reserve("bob").allowed, true);
  const globalDenied = budget.reserve("charlie");
  assert.equal(globalDenied.allowed, false);
  assert.equal(globalDenied.reason, "global");
  now = 1_000;
  assert.equal(budget.reserve("alice").allowed, true);
});

test("media budget restores bounded state without attachment or prompt data", () => {
  let now = 10;
  const source = createT3amsMediaAnalysisBudget({ senderCapacity: 1, globalCapacity: 2, now: () => now });
  source.reserve("sender-a");
  const snapshot = source.snapshot();
  assert.deepEqual(Object.keys(snapshot), ["v", "global", "senders"]);
  assert.deepEqual(Object.keys(snapshot.senders[0]), ["sender", "tokens", "at"]);
  const restored = createT3amsMediaAnalysisBudget({ senderCapacity: 1, globalCapacity: 2, initial: snapshot, now: () => now });
  assert.equal(restored.reserve("sender-a").allowed, false);
  assert.equal(restored.reserve("sender-b").allowed, true);
});

test("media budget validates limits and bounds remembered senders", () => {
  assert.throws(() => createT3amsMediaAnalysisBudget({ senderCapacity: 0 }), /invalid integer/);
  let now = 0;
  const budget = createT3amsMediaAnalysisBudget({ senderCap: 2, globalCapacity: 10, now: () => now });
  budget.reserve("a"); budget.reserve("b"); budget.reserve("c");
  assert.ok(budget.snapshot().senders.length <= 2);
});

test("global exhaustion does not churn per-sender buckets and restore rolls back a tentative spend", () => {
  let now = 0;
  const budget = createT3amsMediaAnalysisBudget({
    senderCapacity: 2,
    globalCapacity: 1,
    senderCap: 2,
    now: () => now,
  });
  const before = budget.snapshot();
  assert.equal(budget.reserve("alice").allowed, true);
  const spent = budget.snapshot();
  const denied = budget.reserve("unknown-sender");
  assert.equal(denied.reason, "global");
  assert.deepEqual(budget.snapshot().senders.map((entry) => entry.sender), ["alice"]);
  budget.restore(before);
  assert.equal(budget.reserve("alice").allowed, true);
  budget.restore(spent);
  assert.equal(budget.reserve("alice").reason, "global");
});
