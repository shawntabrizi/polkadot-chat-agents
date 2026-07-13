import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeyedDispatcher } from "../lib/keyed-dispatcher.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("preserves order within a key while independent keys run concurrently", async () => {
  const dispatcher = createKeyedDispatcher({ concurrency: 2, maxQueued: 10 });
  const first = deferred();
  const seen = [];
  const a1 = dispatcher.run("a", async () => { seen.push("a1-start"); await first.promise; seen.push("a1-end"); });
  const a2 = dispatcher.run("a", async () => { seen.push("a2"); });
  const b1 = dispatcher.run("b", async () => { seen.push("b1"); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["a1-start", "b1"]);
  first.resolve();
  await Promise.all([a1, a2, b1]);
  assert.deepEqual(seen, ["a1-start", "b1", "a1-end", "a2"]);
});

test("rejects new work once the bounded backlog is full", async () => {
  const dispatcher = createKeyedDispatcher({ concurrency: 1, maxQueued: 1 });
  const gate = deferred();
  const first = dispatcher.run("a", () => gate.promise);
  await new Promise((resolve) => setImmediate(resolve));
  const second = dispatcher.run("b", async () => {});
  const overflow = dispatcher.run("c", async () => {});
  assert.ok(first);
  assert.ok(second);
  assert.equal(overflow, null);
  gate.resolve();
  await Promise.all([first, second]);
});
