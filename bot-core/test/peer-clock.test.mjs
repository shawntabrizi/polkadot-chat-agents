import { test } from "node:test";
import assert from "node:assert/strict";
import { createPeerClock } from "../lib/peer-clock.mjs";

test("replies never sort before the message they answer, even with a fast peer clock", () => {
  let t = 1_000_000;
  const clock = createPeerClock({ now: () => t });
  clock.observe("peer", 1_000_400); // the phone is 400ms ahead of us
  assert.equal(clock.next("peer"), 1_000_401n, "reply lands just after the peer's message");
  assert.equal(clock.next("peer"), 1_000_402n, "our own consecutive messages stay ordered");
  t = 1_002_000;
  assert.equal(clock.next("peer"), 1_002_000n, "real time wins once it has caught up");
  assert.equal(clock.next("other"), 1_002_000n, "floors are per peer");
});

test("a broken peer clock cannot drag our timestamps far into the future", () => {
  const t = 1_000_000;
  const clock = createPeerClock({ now: () => t });
  clock.observe("peer", t + 2 * 24 * 60 * 60 * 1000);
  assert.equal(clock.next("peer"), BigInt(t));
  clock.observe("peer", NaN); clock.observe("peer", -5); clock.observe("peer", 0);
  assert.equal(clock.next("peer"), BigInt(t + 1));
});
