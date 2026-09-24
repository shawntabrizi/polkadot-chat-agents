// The identifier wait: a chat request from a fresh signup arrives before the
// People chain shows the sender's identifier key. It must be held and
// retried, not dropped (the 2026-09-24 demo: a new identity's "Start chats
// with all" was dropped by every bot), and a key that never appears must
// still end the wait, so an unregistered sender cannot hold a slot for ever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_IDENTIFIER_RETRY_MS, IDENTIFIER_RETRY_STEPS_MS, createIdentifierWait, identifierRetryDelay } from "../lib/identifier-wait.mjs";

// A manual clock: timers fire only when the test advances time.
const fakeClock = () => {
  let t = 0;
  const timers = new Set();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const timer = { fn, due: t + ms }; timers.add(timer); return timer; },
    clearTimer: (timer) => { timers.delete(timer); },
    /** Advance to the next timer and run it; returns the time it fired at. */
    async next() {
      const timer = [...timers].sort((a, b) => a.due - b.due)[0];
      if (!timer) return null;
      timers.delete(timer);
      t = timer.due;
      await timer.fn();
      await new Promise((r) => setImmediate(r));
      return t;
    },
    get pending() { return timers.size; },
  };
};

test("the retry backoff is 5 s, 10 s, 20 s, 40 s, 60 s, then 60 s for ever, in a 10-minute window", () => {
  assert.deepEqual(IDENTIFIER_RETRY_STEPS_MS, [5_000, 10_000, 20_000, 40_000, 60_000]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map(identifierRetryDelay), [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 60_000]);
  assert.equal(DEFAULT_IDENTIFIER_RETRY_MS, 600_000);
});

test("a sender whose key appears after two retries is found on the third, and the request is replayed once", async () => {
  const clock = fakeClock();
  let lookups = 0;
  const found = [];
  const wait = createIdentifierWait({
    ...clock,
    lookup: async () => (++lookups >= 3 ? "key" : null),
    onFound: (entry) => found.push(entry),
    onExpired: () => assert.fail("the window must not close"),
  });
  assert.equal(wait.hold("stmt-1", "0xabc", "payload"), true);
  assert.equal(wait.status("stmt-1"), "waiting", "held, not dropped");
  assert.equal(await clock.next(), 5_000);
  assert.equal(await clock.next(), 15_000);
  assert.equal(found.length, 0, "two misses: still waiting");
  assert.equal(wait.status("stmt-1"), "waiting");
  assert.equal(await clock.next(), 35_000);
  assert.equal(found.length, 1);
  assert.deepEqual({ sender: found[0].sender, data: found[0].data, attempts: found[0].attempts }, { sender: "0xabc", data: "payload", attempts: 3 });
  assert.equal(wait.status("stmt-1"), null, "released: the replay reaches the normal accept path");
  assert.equal(clock.pending, 0, "no retry left behind");
});

test("a sender whose key never appears is dropped when the window closes, not before", async () => {
  const clock = fakeClock();
  const expired = [];
  const fired = [];
  const wait = createIdentifierWait({
    ...clock,
    lookup: async () => null,
    onFound: () => assert.fail("no key exists"),
    onExpired: (entry) => expired.push(entry),
  });
  wait.hold("stmt-2", "0xdef", "payload");
  for (let at = await clock.next(); at != null; at = await clock.next()) fired.push(at);
  // 5, 15, 35, 75, 135, then each 60 s; the last retry is clamped to the window's end.
  assert.deepEqual(fired, [5_000, 15_000, 35_000, 75_000, 135_000, 195_000, 255_000, 315_000, 375_000, 435_000, 495_000, 555_000, 600_000]);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].attempts, fired.length);
  assert.equal(wait.status("stmt-2"), "expired", "the next sight of the request drops it");
});

test("a miss is never remembered past one retry interval: each retry asks the directory again", async () => {
  const clock = fakeClock();
  const asked = [];
  const wait = createIdentifierWait({ ...clock, maxMs: 30_000, lookup: async (sender) => { asked.push([clock.now(), sender]); return null; } });
  wait.hold("stmt-3", "0x123", null);
  while (await clock.next() != null);
  assert.deepEqual(asked, [[5_000, "0x123"], [15_000, "0x123"], [30_000, "0x123"]]);
});

test("a lookup failure counts as a miss, and the wait is bounded", async () => {
  const clock = fakeClock();
  let calls = 0;
  const found = [];
  const wait = createIdentifierWait({ ...clock, cap: 1, lookup: async () => { calls += 1; if (calls === 1) throw new Error("rpc down"); return "key"; }, onFound: (e) => found.push(e) });
  assert.equal(wait.hold("a", "0x1", null), true);
  assert.equal(wait.hold("a", "0x1", null), true, "the same request is held once");
  assert.equal(wait.hold("b", "0x2", null), false, "full: the caller defers");
  await clock.next();
  await clock.next();
  assert.equal(found.length, 1);
  wait.hold("c", "0x3", null);
  wait.stop();
  assert.equal(clock.pending, 0, "stop clears every timer");
  assert.equal(wait.status("c"), null);
});
