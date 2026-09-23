import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELETION_CAP_PER_PEER,
  createDeletionLedger,
  createExtensionObserver,
  createMessageDeleter,
  parseProtocolExtensions,
} from "../lib/message-deletion.mjs";
import { createOutboundLanes } from "../lib/outbound-lanes.mjs";
import {
  DELETED_CONTENT_KIND,
  decodeOpaqueMessageAt,
  encodeOpaqueDeletedMessage,
  encodeOpaqueTextMessage,
} from "../vendor/app-chat-codec.mjs";

// ---------- recipient rules ----------

test("a deletion that arrives before its target suppresses the target on arrival", () => {
  const ledger = createDeletionLedger();
  // The target is not known yet (resends and compaction reorder delivery).
  assert.equal(ledger.record("bob", "M1", { known: false }), "pending");
  // The target shows up later: the bot must drop it, never answer it.
  assert.equal(ledger.arrived("bob", "M1"), true);
  // And a resend of the same target stays dropped.
  assert.equal(ledger.arrived("bob", "M1"), true);
  // Unrelated messages are untouched.
  assert.equal(ledger.arrived("bob", "M2"), false);
});

test("a known target is tombstoned, and a later edit cannot revive it", () => {
  const ledger = createDeletionLedger();
  assert.equal(ledger.record("bob", "M1", { known: true }), "applied");
  // RFC: deletion is terminal; an `edited` for the target must be ignored.
  assert.equal(ledger.isDeleted("bob", "M1"), true);
});

test("a duplicate deletion is a no-op", () => {
  const ledger = createDeletionLedger();
  assert.equal(ledger.record("bob", "M1", { known: true }), "applied");
  assert.equal(ledger.record("bob", "M1", { known: true }), "duplicate");
  assert.equal(ledger.record("bob", "P1", { known: false }), "pending");
  assert.equal(ledger.record("bob", "P1", { known: false }), "duplicate");
});

test("a deletion never reaches another peer's message or the bot's own", () => {
  const ledger = createDeletionLedger();
  // Bob names a message Alice sent (or one the bot sent): it is not known
  // from Bob, so it can only land in Bob's own pending set.
  assert.equal(ledger.record("bob", "ALICE-MSG", { known: false }), "pending");
  assert.equal(ledger.arrived("alice", "ALICE-MSG"), false, "Alice's message must still be answered");
  assert.equal(ledger.isDeleted("alice", "ALICE-MSG"), false);
});

test("the pending set is bounded per peer; eviction drops the oldest", () => {
  const ledger = createDeletionLedger();
  for (let i = 0; i <= DELETION_CAP_PER_PEER; i += 1) ledger.record("bob", `P${i}`, { known: false });
  assert.equal(DELETION_CAP_PER_PEER, 500);
  assert.equal(ledger.snapshot("bob").p.length, 500);
  assert.equal(ledger.arrived("bob", "P0"), false, "the oldest entry was evicted (safe: its target is then shown)");
  assert.equal(ledger.arrived("bob", `P${DELETION_CAP_PER_PEER}`), true);
});

test("tombstones and pending deletions survive a restart", () => {
  const before = createDeletionLedger();
  before.record("bob", "DONE", { known: true });
  before.record("bob", "LATER", { known: false });
  const after = createDeletionLedger();
  after.restore("bob", JSON.parse(JSON.stringify(before.snapshot("bob"))));
  assert.equal(after.isDeleted("bob", "DONE"), true);
  assert.equal(after.arrived("bob", "LATER"), true);
  assert.equal(after.snapshot("carol"), null);
});

// ---------- extension switch (development-mode rule) ----------

// Owner decision 2026-09-23: every client is in development, so each
// extension goes to every peer unless the operator turns it off. A peer's own
// extension kinds are logged, never required.
test("BOT_PROTOCOL_EXTENSIONS: unset is all, none is none, a list restricts", () => {
  const all = ["deleted", "buttons", "typing", "seen", "botinfo", "txref"];
  assert.deepEqual([...parseProtocolExtensions(undefined).enabled], all);
  assert.deepEqual([...parseProtocolExtensions("").enabled], all);
  assert.deepEqual([...parseProtocolExtensions(" none ").enabled], []);
  const parsed = parseProtocolExtensions(" deleted , bogus ,typing");
  assert.deepEqual([...parsed.enabled], ["deleted", "typing"]);
  assert.deepEqual(parsed.unknown, ["bogus"]);
});

test("the extension observer reports each peer's kind once and enables nothing", () => {
  const observer = createExtensionObserver();
  assert.equal(observer.observe("bob", "typing"), true);
  assert.equal(observer.observe("bob", "typing"), false);
  assert.equal(observer.observe("bob", "deleted"), true);
  assert.equal(observer.observe("alice", "typing"), true, "per peer");
  assert.equal("enabled" in observer, false, "no gate: sending does not depend on it");
});

// ---------- sender path over real outbound lanes ----------

// In-memory lanes as in outbound-lanes.test.mjs, but the slot holds the real
// opaque bytes, so a test can decode which content kinds went on the wire.
const makeSender = ({ enabled = true, maxPayloadBytes = 10_000 } = {}) => {
  const submits = [];
  let rid = 0;
  let mid = 0;
  const outbound = createOutboundLanes({
    encodeBatch: (peerHex, requestId, opaques) =>
      Buffer.from(JSON.stringify({ requestId, opaques: opaques.map((o) => Buffer.from(o).toString("hex")) })),
    submitPayload: async (peerHex, payload) => { submits.push(JSON.parse(payload.toString())); },
    makeRequestId: () => `RID-${++rid}`,
    maxPayloadBytes,
    ackGraceMs: 3_600_000,
  });
  const events = [];
  const deleteMessage = createMessageDeleter({
    outbound,
    enabled,
    encode: encodeOpaqueDeletedMessage,
    makeId: () => `DEL-${++mid}`,
    log: (event, extra) => events.push({ event, ...extra }),
  });
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const decoded = (statement) => statement.opaques.map((hex) => decodeOpaqueMessageAt(Buffer.from(hex, "hex"), 0).value);
  const wire = () => submits.flatMap(decoded);
  const slot = () => decoded(submits.at(-1));
  const text = (messageId) => outbound.enqueue("bob", encodeOpaqueTextMessage({ messageId, text: messageId }), { messageId });
  return { outbound, deleteMessage, events, settle, wire, slot, text, submits };
};

test("no deletion goes out when the deleted extension is off", async () => {
  const s = makeSender({ enabled: parseProtocolExtensions("none").enabled.has("deleted") });
  s.text("M1");
  await s.settle();
  const result = await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.equal(result.outcome, "unsupported");
  assert.ok(s.wire().every((m) => m.kind !== "deleted"), "the operator turned the extension off");
  assert.deepEqual(s.slot().map((m) => m.messageId), ["M1"], "the slot is left as it was");
  assert.equal(s.events.at(-1).event, "BOT_DELETE_SKIPPED");
});

test("an un-ACKed target leaves the slot and the deletion replaces it", async () => {
  const s = makeSender();
  s.text("M1");
  s.text("M2");
  await s.settle();
  const result = await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.equal(result.outcome, "sent");
  // RFC case 2 + 3 in one statement: the target is gone, its deletion rides along.
  const slot = s.slot();
  assert.deepEqual(slot.map((m) => m.kind), ["text", "deleted"]);
  assert.equal(slot[0].messageId, "M2");
  assert.deepEqual([slot[1].messageId, slot[1].targetMessageId], [result.messageId, "M1"]);
  assert.equal(s.events.at(-1).droppedFromSlot, true);
});

test("after the target was ACKed, only the deletion goes out", async () => {
  const s = makeSender();
  s.text("M1");
  await s.settle();
  s.outbound.onAck("bob", s.submits.at(-1).requestId);
  await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.deepEqual(s.slot().map((m) => [m.kind, m.targetMessageId]), [["deleted", "M1"]]);
});

test("a queued message that was never submitted is removed with no wire trace", async () => {
  // A tiny payload cap: M2 cannot extend M1's statement, so it waits in the queue.
  const s = makeSender({ maxPayloadBytes: 90 });
  s.text("M1");
  await s.settle();
  const queued = s.text("M2");
  await s.settle();
  assert.equal(s.outbound.depth("bob"), 2);
  const result = await s.deleteMessage("bob", "M2");
  assert.equal(result.outcome, "unsent");
  assert.equal(await queued.delivered, false);
  s.outbound.onAck("bob", s.submits.at(-1).requestId);
  await s.settle();
  assert.ok(s.wire().every((m) => m.messageId !== "M2" && m.kind !== "deleted"), "RFC case 1: no deletion is emitted");
});

test("by default a deletion goes out with no evidence from the peer", async () => {
  const s = makeSender({ enabled: parseProtocolExtensions(undefined).enabled.has("deleted") });
  s.text("M1");
  await s.settle();
  const result = await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.equal(result.outcome, "sent");
  assert.deepEqual(s.slot().map((m) => m.kind), ["deleted"]);
  assert.equal(s.slot()[0].messageId.startsWith("DEL-"), true);
  assert.equal(DELETED_CONTENT_KIND, 21);
});
