import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutboundLanes } from "../lib/outbound-lanes.mjs";

// Encode: JSON of the batch, so payload size tracks message count and tests
// can decode what would sit in the channel slot.
const makeHarness = ({ maxPayloadBytes = 10_000, maxExtensions = 8, maxQueued = 200, failSubmits = 0, ackGraceMs = 3_600_000 } = {}) => {
  const submits = []; // { peerHex, batch: { requestId, opaques, forceIdentity } }
  let rid = 0;
  let failures = failSubmits;
  const lanes = createOutboundLanes({
    encodeBatch: (peerHex, requestId, opaques, { forceIdentity }) => {
      if (peerHex === "no-session") throw new Error("no active session for peer");
      return Buffer.from(JSON.stringify({ requestId, opaques, forceIdentity }));
    },
    submitPayload: async (peerHex, payload) => {
      if (failures > 0) { failures -= 1; throw new Error("submit failed"); }
      submits.push({ peerHex, batch: JSON.parse(payload.toString()) });
    },
    makeRequestId: () => `RID-${++rid}`,
    maxPayloadBytes,
    maxExtensions,
    maxQueued,
    ackGraceMs,
  });
  const settle = () => new Promise((r) => setTimeout(r, 5)); // let setImmediate + submits run
  const slot = () => submits[submits.length - 1]?.batch ?? null; // what the channel slot holds
  return { lanes, submits, settle, slot };
};

test("one statement per peer until ACKed; queue drains on ACK", async () => {
  const h = makeHarness({ maxPayloadBytes: 60 }); // fits ~1 short message per batch
  const a = h.lanes.enqueue("peer", "m1", { messageId: "M1" });
  await h.settle();
  const b = h.lanes.enqueue("peer", "m2", { messageId: "M2" });
  await h.settle();
  // m2 cannot extend (cap) — it waits; the slot still holds only m1.
  assert.equal(h.submits.length, 1);
  assert.deepEqual(h.slot().opaques, ["m1"]);
  await a.submitted;
  // ACK of the current statement frees the slot and m2 goes out.
  h.lanes.onAck("peer", h.slot().requestId);
  assert.equal(await a.delivered, true);
  await h.settle();
  assert.equal(h.submits.length, 2);
  assert.deepEqual(h.slot().opaques, ["m2"]);
  h.lanes.onAck("peer", h.slot().requestId);
  assert.equal(await b.delivered, true);
});

test("messages arriving while un-ACKed extend the statement losslessly", async () => {
  const h = makeHarness();
  h.lanes.enqueue("peer", "m1", { messageId: "M1" });
  await h.settle();
  assert.deepEqual(h.slot().opaques, ["m1"]);
  h.lanes.enqueue("peer", "m2", { messageId: "M2" });
  await h.settle();
  // The replacement statement carries BOTH messages (new requestId).
  assert.deepEqual(h.slot().opaques, ["m1", "m2"]);
  assert.notEqual(h.submits[0].batch.requestId, h.slot().requestId);
});

test("an ACK for a superseded requestId does not advance the lane", async () => {
  const h = makeHarness();
  const a = h.lanes.enqueue("peer", "m1", { messageId: "M1" });
  await h.settle();
  const oldRid = h.slot().requestId;
  h.lanes.enqueue("peer", "m2", { messageId: "M2" });
  await h.settle();
  h.lanes.onAck("peer", oldRid); // peer fetched the OLD statement only
  await h.settle();
  assert.equal(h.lanes.depth("peer"), 2); // still waiting on the current rid
  h.lanes.onAck("peer", h.slot().requestId);
  assert.equal(await a.delivered, true);
  assert.equal(h.lanes.depth("peer"), 0);
});

test("a same-tick burst rides one statement", async () => {
  const h = makeHarness();
  for (let i = 1; i <= 5; i += 1) h.lanes.enqueue("peer", `part${i}`, { messageId: `M${i}` });
  await h.settle();
  assert.equal(h.submits.length, 1);
  assert.deepEqual(h.slot().opaques, ["part1", "part2", "part3", "part4", "part5"]);
});

test("supersedes drops a never-fetched message from the batch", async () => {
  const h = makeHarness();
  const ph = h.lanes.enqueue("peer", "placeholder", { messageId: "PH" });
  await h.settle();
  assert.deepEqual(h.slot().opaques, ["placeholder"]);
  const ans = h.lanes.enqueue("peer", "answer", { messageId: "ANS", supersedes: ["PH"] });
  await h.settle();
  // The extension replaces the placeholder instead of stacking a second bubble.
  assert.deepEqual(h.slot().opaques, ["answer"]);
  assert.equal(await ph.delivered, false);
  h.lanes.onAck("peer", h.slot().requestId);
  assert.equal(await ans.delivered, true);
});

test("forceIdentity batches never mix with device batches", async () => {
  const h = makeHarness();
  h.lanes.enqueue("peer", "accept", { messageId: "A", forceIdentity: true });
  await h.settle();
  h.lanes.enqueue("peer", "hello", { messageId: "B" });
  await h.settle();
  // The device-encrypted message must NOT extend the identity statement.
  assert.equal(h.submits.length, 1);
  assert.equal(h.slot().forceIdentity, true);
  h.lanes.onAck("peer", h.slot().requestId);
  await h.settle();
  assert.equal(h.slot().forceIdentity, false);
  assert.deepEqual(h.slot().opaques, ["hello"]);
});

test("a submit failure fails the new entries but keeps the slot batch valid", async () => {
  const h = makeHarness({ failSubmits: 1 });
  const a = h.lanes.enqueue("peer", "m1", { messageId: "M1" });
  await h.settle();
  await assert.rejects(a.submitted, /submit failed/);
  assert.equal(await a.delivered, false);
  // The lane recovers for the next message.
  const b = h.lanes.enqueue("peer", "m2", { messageId: "M2" });
  await h.settle();
  assert.deepEqual(h.slot().opaques, ["m2"]);
  h.lanes.onAck("peer", h.slot().requestId);
  assert.equal(await b.delivered, true);
});

test("an unencodable message (no session) rejects without wedging the lane", async () => {
  const h = makeHarness();
  const a = h.lanes.enqueue("no-session", "m1", { messageId: "M1" });
  await h.settle();
  await assert.rejects(a.submitted, /no active session/);
  assert.equal(await a.delivered, false);
  assert.equal(h.lanes.depth("no-session"), 0);
});

test("peers do not block each other", async () => {
  const h = makeHarness({ maxPayloadBytes: 60 });
  h.lanes.enqueue("peer1", "m1", { messageId: "M1" });
  await h.settle();
  h.lanes.enqueue("peer1", "m2", { messageId: "M2" }); // queued behind un-ACKed m1
  h.lanes.enqueue("peer2", "n1", { messageId: "N1" });
  await h.settle();
  assert.deepEqual(h.submits.map((s) => s.peerHex), ["peer1", "peer2"]);
});

test("queue overflow rejects loudly instead of leaking", async () => {
  const h = makeHarness({ maxPayloadBytes: 60, maxQueued: 3 });
  h.lanes.enqueue("peer", "m0", { messageId: "M0" });
  await h.settle(); // m0 occupies the slot, un-ACKed
  for (let i = 1; i <= 3; i += 1) h.lanes.enqueue("peer", `m${i}`, { messageId: `M${i}` });
  const overflow = h.lanes.enqueue("peer", "m4", { messageId: "M4" });
  await assert.rejects(overflow.submitted, /queue full/);
  assert.equal(await overflow.delivered, false);
});

test("grace takeover: a blocked queue claims the slot after the un-ACKed window", async () => {
  const h = makeHarness({ ackGraceMs: 40 });
  // Identity statement (never ACKed) blocks a device-encrypted message.
  const accept = h.lanes.enqueue("peer", "accept", { messageId: "A", forceIdentity: true });
  await h.settle();
  const hello = h.lanes.enqueue("peer", "hello", { messageId: "B" });
  await h.settle();
  assert.equal(h.submits.length, 1, "device message must not extend the identity batch");
  // After the grace window the queued message takes the slot; the dropped
  // batch resolves delivered=false.
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await accept.delivered, false);
  assert.deepEqual(h.slot().opaques, ["hello"]);
  h.lanes.onAck("peer", h.slot().requestId);
  assert.equal(await hello.delivered, true);
});

test("grace does NOT fire when nothing is queued", async () => {
  const h = makeHarness({ ackGraceMs: 30 });
  h.lanes.enqueue("peer", "only", { messageId: "M" });
  await h.settle();
  await new Promise((r) => setTimeout(r, 80));
  // The lone statement stays current, waiting for the peer indefinitely.
  assert.equal(h.submits.length, 1);
  assert.equal(h.lanes.depth("peer"), 1);
});

test("an expired session releases an unacknowledged lane", async () => {
  const h = makeHarness();
  const message = h.lanes.enqueue("peer", "old", { messageId: "OLD" });
  await h.settle();
  assert.equal(h.lanes.hasPending("peer"), true);
  assert.equal(h.lanes.expire("peer"), true);
  assert.equal(await message.delivered, false);
  assert.equal(h.lanes.hasPending("peer"), false);
  assert.equal(h.lanes.depth("peer"), 0);
});
