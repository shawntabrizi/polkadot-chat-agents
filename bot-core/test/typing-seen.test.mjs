import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEEN_MIN_INTERVAL_MS,
  TYPING_MIN_INTERVAL_MS,
  TYPING_TTL_MS,
  createTypingAndSeen,
} from "../lib/typing-seen.mjs";
import { parseProtocolExtensions } from "../lib/message-deletion.mjs";
import { createOutboundLanes } from "../lib/outbound-lanes.mjs";
import {
  decodeOpaqueMessageAt,
  encodeOpaqueSeenMessage,
  encodeOpaqueTextMessage,
  encodeOpaqueTypingMessage,
} from "../vendor/app-chat-codec.mjs";

const decode = (opaque) => decodeOpaqueMessageAt(opaque, 0).value;

// A fake clock: timers fire only when the test advances time.
const fakeClock = (start = 1_720_000_000_000) => {
  let t = start;
  let pending = [];
  return {
    now: () => t,
    timers: {
      set: (fn, ms) => { const h = { at: t + ms, fn }; pending.push(h); return h; },
      clear: (h) => { pending = pending.filter((x) => x !== h); },
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const next = pending[0];
        if (!next || next.at > end) break;
        pending.shift();
        t = next.at;
        next.fn();
      }
      t = end;
    },
  };
};

// Records every entry the module puts into the lane. `delivered` stays open
// until the test ACKs it, like a peer that has not fetched the statement yet.
const makeSignals = ({ extensions, ...options } = {}) => {
  const clock = fakeClock();
  const sent = [];
  const events = [];
  let id = 0;
  const enabled = parseProtocolExtensions(extensions).enabled;
  const signals = createTypingAndSeen({
    typing: enabled.has("typing"),
    seen: enabled.has("seen"),
    enqueue: (peerHex, opaque, { messageId, supersedes }) => {
      let ack;
      const delivered = new Promise((resolve) => { ack = resolve; });
      sent.push({ peerHex, at: clock.now(), messageId, supersedes, ack, m: decode(opaque) });
      return { submitted: Promise.resolve(), delivered };
    },
    encodeTyping: encodeOpaqueTypingMessage,
    encodeSeen: encodeOpaqueSeenMessage,
    makeId: () => `SIG-${++id}`,
    now: clock.now,
    timers: clock.timers,
    log: (event, extra) => events.push({ event, ...extra }),
    ...options,
  });
  const typings = () => sent.filter((e) => e.m.kind === "typing");
  const ackAll = async () => { for (const e of sent) e.ack(true); await new Promise((r) => setImmediate(r)); };
  return { clock, sent, events, signals, typings, ackAll };
};

test("a turn sends typing{working} at once, then refreshes every 4 s while it runs", async () => {
  const s = makeSignals();
  s.signals.turnStarted("bob");
  assert.equal(s.typings().length, 1);
  const first = s.typings()[0].m;
  assert.equal(first.typingKind, 1, "an agent turn is `working`");
  assert.equal(first.until, s.clock.now() + TYPING_TTL_MS, "the hint expires 6 s ahead");
  for (let i = 0; i < 3; i += 1) {
    await s.ackAll(); // the peer fetched the last hint
    s.clock.advance(TYPING_MIN_INTERVAL_MS);
  }
  assert.equal(s.typings().length, 4, "one refresh per 4 s; 6 s hints leave no gap");
  const gaps = s.typings().slice(1).map((e, i) => e.at - s.typings()[i].at);
  assert.deepEqual(gaps, [4000, 4000, 4000]);
  // The log tells an operator a turn showed typing, not every refresh.
  assert.equal(s.events.filter((e) => e.event === "BOT_SENT_TYPING").length, 1);
});

test("never more than one typing per 4 s per peer, across turns too", async () => {
  const s = makeSignals();
  s.signals.turnStarted("bob");
  await s.ackAll();
  s.clock.advance(1000);
  s.signals.turnEnded("bob"); // no reply: a `stopped` is owed, but not before 4 s
  s.clock.advance(500);
  s.signals.turnStarted("bob"); // the next turn starts at once
  s.clock.advance(20_000);
  await s.ackAll();
  s.clock.advance(20_000);
  const times = s.typings().map((e) => e.at);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] >= TYPING_MIN_INTERVAL_MS, `typing gap ${times[i] - times[i - 1]} ms`);
  assert.ok(s.typings().every((e) => e.m.typingKind === 1), "the new turn cancelled the old turn's `stopped`");
  // Other peers have their own limit.
  s.signals.turnStarted("carol");
  assert.equal(s.typings().at(-1).peerHex, "carol");
});

test("no refresh while the last hint is still un-ACKed", () => {
  const s = makeSignals();
  s.signals.turnStarted("bob");
  s.clock.advance(TYPING_MIN_INTERVAL_MS * 5);
  // A peer that fetches nothing would otherwise spend the lane's in-slot
  // extensions on hints alone.
  assert.equal(s.typings().length, 1);
});

test("a turn that ends without a reply sends typing{stopped}; after a reply it does not", async () => {
  const s = makeSignals();
  s.signals.turnStarted("bob");
  s.clock.advance(TYPING_MIN_INTERVAL_MS);
  s.signals.turnEnded("bob");
  const stopped = s.typings().at(-1);
  assert.equal(stopped.m.typingKind, 2);
  assert.deepEqual(stopped.supersedes, [s.typings()[0].messageId], "the stale `working` leaves the slot if unfetched");

  const r = makeSignals();
  r.signals.turnStarted("bob");
  const ids = r.signals.replyGoingOut("bob");
  assert.deepEqual(ids, [r.typings()[0].messageId], "the reply supersedes the un-ACKed typing");
  r.signals.turnEnded("bob");
  r.clock.advance(60_000);
  assert.equal(r.typings().length, 1, "no `stopped` once a reply went out");
});

test("a turn with no end (a silent bridge harness) stops refreshing after maxTurnMs", async () => {
  const s = makeSignals({ maxTurnMs: 30_000 });
  s.signals.turnStarted("bob");
  for (let i = 0; i < 20; i += 1) { await s.ackAll(); s.clock.advance(TYPING_MIN_INTERVAL_MS); }
  assert.equal(s.typings().at(-1).m.typingKind, 2);
  assert.equal(s.signals.typingActive("bob"), false);
  assert.ok(s.typings().length <= 30_000 / TYPING_MIN_INTERVAL_MS + 2);
});

test("BOT_PROTOCOL_EXTENSIONS=none: no typing and no seen", () => {
  const s = makeSignals({ extensions: "none" });
  s.signals.turnStarted("bob");
  s.signals.consumed("bob", "MSG-1");
  s.clock.advance(60_000);
  s.signals.turnEnded("bob");
  assert.equal(s.sent.length, 0);
  assert.deepEqual(s.signals.replyGoingOut("bob"), []);
});

test("a comma list restricts: typing only", () => {
  const s = makeSignals({ extensions: "typing" });
  s.signals.turnStarted("bob");
  s.signals.consumed("bob", "MSG-1");
  assert.deepEqual(s.sent.map((e) => e.m.kind), ["typing"]);
});

test("seen goes out at once, then batches to one per 2 s carrying the latest id", async () => {
  const s = makeSignals();
  s.signals.consumed("bob", "MSG-1");
  s.clock.advance(500);
  s.signals.consumed("bob", "MSG-2");
  s.clock.advance(500);
  s.signals.consumed("bob", "MSG-3");
  const seens = () => s.sent.filter((e) => e.m.kind === "seen");
  assert.deepEqual(seens().map((e) => e.m.upTo), ["MSG-1"]);
  s.clock.advance(SEEN_MIN_INTERVAL_MS);
  assert.deepEqual(seens().map((e) => e.m.upTo), ["MSG-1", "MSG-3"], "MSG-2 is covered by MSG-3");
  assert.equal(seens()[1].at - seens()[0].at, SEEN_MIN_INTERVAL_MS);
  assert.equal(seens()[1].m.at, seens()[1].at);
  // upTo covers everything before it, so an unfetched older seen is dropped.
  assert.deepEqual(seens()[1].supersedes, [seens()[0].messageId]);
  s.signals.consumed("carol", "MSG-9");
  assert.equal(seens().at(-1).peerHex, "carol", "the batch window is per peer");
});

// Over real outbound lanes: the reply drops an unfetched typing from the slot,
// and the ephemeral entries never claim to be an answer.
test("the real reply supersedes an un-ACKed typing in the lane", async () => {
  const submits = [];
  let rid = 0;
  const outbound = createOutboundLanes({
    encodeBatch: (peerHex, requestId, opaques) =>
      Buffer.from(JSON.stringify({ requestId, opaques: opaques.map((o) => Buffer.from(o).toString("hex")) })),
    submitPayload: async (peerHex, payload) => { submits.push(JSON.parse(payload.toString())); },
    makeRequestId: () => `RID-${++rid}`,
    ackGraceMs: 3_600_000,
  });
  let id = 0;
  const signals = createTypingAndSeen({
    enqueue: (peerHex, opaque, options) => outbound.enqueue(peerHex, opaque, options),
    encodeTyping: encodeOpaqueTypingMessage,
    encodeSeen: encodeOpaqueSeenMessage,
    makeId: () => `SIG-${++id}`,
    timers: { set: () => null, clear: () => {} },
  });
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const slot = () => submits.at(-1).opaques.map((hex) => decode(Buffer.from(hex, "hex")));

  signals.consumed("bob", "MSG-1");
  signals.turnStarted("bob");
  await settle();
  assert.deepEqual(slot().map((m) => m.kind), ["seen", "typing"]);
  // The answer, as submitMessage sends it.
  const supersedes = signals.replyGoingOut("bob");
  outbound.enqueue("bob", encodeOpaqueTextMessage({ messageId: "ANSWER", text: "hi" }), { messageId: "ANSWER", supersedes });
  await settle();
  assert.deepEqual(slot().map((m) => m.kind), ["seen", "text"], "the typing left the slot; the seen stays");
  signals.turnEnded("bob");
  await settle();
  assert.deepEqual(slot().map((m) => m.kind), ["seen", "text"], "no `stopped` after a reply");
});
