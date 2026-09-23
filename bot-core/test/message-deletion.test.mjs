import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELETION_CAP_PER_PEER,
  createDeletionLedger,
  createExtensionGate,
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

// ---------- extension gate ----------

test("sending an extension needs evidence from that peer, once per peer", () => {
  const gate = createExtensionGate();
  assert.equal(gate.enabled("bob", "deleted"), false);
  assert.equal(gate.observe("bob", "deleted"), true, "first evidence is reported (logged once)");
  assert.equal(gate.observe("bob", "deleted"), false);
  assert.equal(gate.enabled("bob", "deleted"), true);
  assert.equal(gate.enabled("alice", "deleted"), false, "evidence is per peer");
  const restored = createExtensionGate();
  restored.restore("bob", gate.snapshot("bob"));
  assert.equal(restored.enabled("bob", "deleted"), true, "evidence survives a restart");
  restored.restore("carol", ["not-an-extension"]);
  assert.equal(restored.snapshot("carol"), null);
});

test("BOT_PROTOCOL_EXTENSIONS forces an extension on for every peer", () => {
  assert.deepEqual([...parseProtocolExtensions("").enabled], []);
  assert.deepEqual([...parseProtocolExtensions(undefined).enabled], []);
  const parsed = parseProtocolExtensions(" deleted , bogus ");
  assert.deepEqual([...parsed.enabled], ["deleted"]);
  assert.deepEqual(parsed.unknown, ["bogus"]);
  const gate = createExtensionGate({ forced: parsed.enabled });
  assert.equal(gate.enabled("anyone", "deleted"), true);
});

// Spec 0006: a peer that sent ANY extension kind renders kinds its app did
// not ship with, so buttons may go to it. Deletion keeps its own, narrower
// rule: a typing indicator does not prove the peer applies deletions.
test("buttons are enabled by any extension evidence; deletion only by a deletion", () => {
  const gate = createExtensionGate();
  assert.equal(gate.enabled("bob", "buttons"), false, "no evidence: the fallback text goes out");
  gate.observe("bob", "extension"); // e.g. a typing (240) from bob
  assert.equal(gate.enabled("bob", "buttons"), true);
  assert.equal(gate.enabled("bob", "deleted"), false);
  gate.observe("carol", "deleted");
  assert.equal(gate.enabled("carol", "buttons"), true, "kind 21 is extension evidence too");
  gate.observe("dave", "buttons");
  assert.equal(gate.enabled("dave", "buttons"), true);
  const restored = createExtensionGate();
  restored.restore("bob", JSON.parse(JSON.stringify(gate.snapshot("bob"))));
  assert.equal(restored.enabled("bob", "buttons"), true, "evidence survives a restart");
  const forced = createExtensionGate({ forced: parseProtocolExtensions("buttons").enabled });
  assert.equal(forced.enabled("anyone", "buttons"), true);
  assert.equal(forced.enabled("anyone", "deleted"), false);
});

// ---------- sender path over real outbound lanes ----------

// In-memory lanes as in outbound-lanes.test.mjs, but the slot holds the real
// opaque bytes, so a test can decode which content kinds went on the wire.
const makeSender = ({ forced = new Set(), maxPayloadBytes = 10_000 } = {}) => {
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
  const gate = createExtensionGate({ forced });
  const events = [];
  const deleteMessage = createMessageDeleter({
    outbound,
    gate,
    encode: encodeOpaqueDeletedMessage,
    makeId: () => `DEL-${++mid}`,
    log: (event, extra) => events.push({ event, ...extra }),
  });
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const decoded = (statement) => statement.opaques.map((hex) => decodeOpaqueMessageAt(Buffer.from(hex, "hex"), 0).value);
  const wire = () => submits.flatMap(decoded);
  const slot = () => decoded(submits.at(-1));
  const text = (messageId) => outbound.enqueue("bob", encodeOpaqueTextMessage({ messageId, text: messageId }), { messageId });
  return { outbound, gate, deleteMessage, events, settle, wire, slot, text, submits };
};

test("no deletion goes out to a peer without evidence", async () => {
  const s = makeSender();
  s.text("M1");
  await s.settle();
  const result = await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.equal(result.outcome, "unsupported");
  assert.ok(s.wire().every((m) => m.kind !== "deleted"), "an old phone would show an unsupported bubble");
  assert.deepEqual(s.slot().map((m) => m.messageId), ["M1"], "the slot is left as it was");
  assert.equal(s.events.at(-1).event, "BOT_DELETE_SKIPPED");
});

test("after evidence, an un-ACKed target leaves the slot and the deletion replaces it", async () => {
  const s = makeSender();
  s.text("M1");
  s.text("M2");
  await s.settle();
  s.gate.observe("bob", "deleted");
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
  s.gate.observe("bob", "deleted");
  await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.deepEqual(s.slot().map((m) => [m.kind, m.targetMessageId]), [["deleted", "M1"]]);
});

test("a queued message that was never submitted is removed with no wire trace", async () => {
  // A tiny payload cap: M2 cannot extend M1's statement, so it waits in the queue.
  const s = makeSender({ forced: new Set(["deleted"]), maxPayloadBytes: 90 });
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

test("the env override sends a deletion without evidence", async () => {
  const s = makeSender({ forced: parseProtocolExtensions("deleted").enabled });
  s.text("M1");
  await s.settle();
  const result = await s.deleteMessage("bob", "M1");
  await s.settle();
  assert.equal(result.outcome, "sent");
  assert.deepEqual(s.slot().map((m) => m.kind), ["deleted"]);
  assert.equal(s.slot()[0].messageId.startsWith("DEL-"), true);
  assert.equal(DELETED_CONTENT_KIND, 21);
});
