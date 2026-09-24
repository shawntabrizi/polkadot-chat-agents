import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEEN_INTERVAL_MS,
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
// The typing tests name `typing` explicitly: it is off by default.
const makeSignals = ({ extensions = "typing,seen", ...options } = {}) => {
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

// Owner ruling 2026-09-23: every standalone signal is one Statement Store
// submission, so a bot sends no typing unless the operator opts in.
test("default extensions: a turn sends no typing at all", () => {
  const s = makeSignals({ extensions: "" }) // "" = the defaults;
  s.signals.turnStarted("bob");
  s.clock.advance(60_000);
  s.signals.turnEnded("bob");
  assert.equal(s.typings().length, 0);
  assert.deepEqual(s.signals.replyGoingOut("bob"), []);
});

test("opt-in typing: typing{working} at once, then a refresh every 10 s while the turn runs", async () => {
  const s = makeSignals();
  s.signals.turnStarted("bob");
  assert.equal(s.typings().length, 1);
  const first = s.typings()[0].m;
  assert.equal(first.typingKind, 1, "an agent turn is `working`");
  assert.equal(first.until, s.clock.now() + TYPING_TTL_MS, "the hint expires 12 s ahead");
  for (let i = 0; i < 3; i += 1) {
    await s.ackAll(); // the peer fetched the last hint
    s.clock.advance(TYPING_MIN_INTERVAL_MS);
  }
  assert.equal(s.typings().length, 4, "one refresh per 10 s; 12 s hints leave no gap");
  const gaps = s.typings().slice(1).map((e, i) => e.at - s.typings()[i].at);
  assert.deepEqual(gaps, [10_000, 10_000, 10_000], "the spec's opt-in limit: at most one typing per 10 s");
  // The log tells an operator a turn showed typing, not every refresh.
  assert.equal(s.events.filter((e) => e.event === "BOT_SENT_TYPING").length, 1);
});

test("never more than one typing per 10 s per peer, across turns too", async () => {
  const s = makeSignals();
  s.signals.turnStarted("bob");
  await s.ackAll();
  s.clock.advance(1000);
  s.signals.turnEnded("bob"); // no reply: a `stopped` is owed, but not before 10 s
  s.clock.advance(500);
  s.signals.turnStarted("bob"); // the next turn starts at once
  s.clock.advance(40_000);
  await s.ackAll();
  s.clock.advance(40_000);
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
  const s = makeSignals({ maxTurnMs: 60_000 });
  s.signals.turnStarted("bob");
  for (let i = 0; i < 20; i += 1) { await s.ackAll(); s.clock.advance(TYPING_MIN_INTERVAL_MS); }
  assert.equal(s.typings().at(-1).m.typingKind, 2);
  assert.equal(s.signals.typingActive("bob"), false);
  assert.ok(s.typings().length <= 60_000 / TYPING_MIN_INTERVAL_MS + 2);
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

test("seen waits up to 5 s: a reply takes it along, else it goes alone with the latest id", async () => {
  const s = makeSignals({ extensions: "" }) // "" = the defaults;
  const seens = () => s.sent.filter((e) => e.m.kind === "seen");
  // A reply inside the window: the seen enters the lane just before it.
  s.signals.consumed("bob", "MSG-1");
  assert.equal(seens().length, 0, "nothing goes out at once");
  s.clock.advance(3_000);
  s.signals.replyGoingOut("bob");
  assert.deepEqual(seens().map((e) => e.m.upTo), ["MSG-1"]);
  assert.equal(s.events.find((e) => e.event === "BOT_SENT_SEEN").withMessage, true);
  s.clock.advance(SEEN_INTERVAL_MS * 2);
  assert.equal(seens().length, 1, "the window's timer died with the piggyback");
  // No reply: one seen at the end of the window, for the latest message.
  s.signals.consumed("bob", "MSG-2");
  s.clock.advance(1_000);
  s.signals.consumed("bob", "MSG-3");
  s.clock.advance(SEEN_INTERVAL_MS - 1_001);
  assert.equal(seens().length, 1);
  s.clock.advance(1);
  assert.deepEqual(seens().map((e) => e.m.upTo), ["MSG-1", "MSG-3"], "MSG-2 is covered by MSG-3");
  assert.equal(seens()[1].m.at, seens()[1].at);
  // upTo covers everything before it, so an unfetched older seen is dropped.
  assert.deepEqual(seens()[1].supersedes, [seens()[0].messageId]);
  s.signals.consumed("carol", "MSG-9");
  s.clock.advance(SEEN_INTERVAL_MS);
  assert.equal(seens().at(-1).peerHex, "carol", "the window is per peer");
  assert.equal(s.typings().length, 0);
});

// Owner ruling 2026-09-23: a 1:1 conversation must cost ONE Statement Store
// submission per message. Counted on real outbound lanes, the way index.mjs
// wires them: submitMessage calls replyGoingOut, then enqueues the reply.
test("submission budget: a question answered costs 1 submission; a question not answered costs 1 after 5 s", async () => {
  const run = async ({ answer }) => {
    const clock = fakeClock();
    const submits = [];
    let rid = 0;
    let id = 0;
    const outbound = createOutboundLanes({
      encodeBatch: (peerHex, requestId, opaques) =>
        Buffer.from(JSON.stringify({ requestId, opaques: opaques.map((o) => Buffer.from(o).toString("hex")) })),
      submitPayload: async (peerHex, payload) => { submits.push(JSON.parse(payload.toString())); },
      makeRequestId: () => `RID-${++rid}`,
      ackGraceMs: 3_600_000,
    });
    const signals = createTypingAndSeen({
      ...Object.fromEntries(["typing", "seen"].map((k) => [k, parseProtocolExtensions(undefined).enabled.has(k)])),
      enqueue: (peerHex, opaque, options) => outbound.enqueue(peerHex, opaque, options),
      encodeTyping: encodeOpaqueTypingMessage,
      encodeSeen: encodeOpaqueSeenMessage,
      makeId: () => `SIG-${++id}`,
      now: clock.now,
      timers: clock.timers,
    });
    const settle = () => new Promise((r) => setTimeout(r, 5));
    const kinds = () => submits.map((x) => x.opaques.map((hex) => decode(Buffer.from(hex, "hex")).kind));
    // The question arrives; the brain turn starts.
    signals.consumed("bob", "Q-1");
    signals.turnStarted("bob");
    await settle();
    clock.advance(2_000); // the brain thinks for 2 s
    await settle();
    if (answer) {
      const supersedes = signals.replyGoingOut("bob");
      outbound.enqueue("bob", encodeOpaqueTextMessage({ messageId: "ANSWER", text: "hi" }), { messageId: "ANSWER", supersedes });
    }
    signals.turnEnded("bob");
    await settle();
    const early = kinds();
    clock.advance(SEEN_INTERVAL_MS);
    await settle();
    return { early, all: kinds() };
  };
  const answered = await run({ answer: true });
  assert.deepEqual(answered.all, [["seen", "text"]], "the reply and its seen: one submission, no typing");
  const silent = await run({ answer: false });
  assert.deepEqual(silent.early, [], "nothing before the window ends");
  assert.deepEqual(silent.all, [["seen"]], "one standalone seen after 5 s, no typing");
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
  assert.deepEqual(slot().map((m) => m.kind), ["typing"], "the seen waits for the reply");
  // The answer, as submitMessage sends it.
  const supersedes = signals.replyGoingOut("bob");
  outbound.enqueue("bob", encodeOpaqueTextMessage({ messageId: "ANSWER", text: "hi" }), { messageId: "ANSWER", supersedes });
  await settle();
  assert.deepEqual(slot().map((m) => m.kind), ["seen", "text"], "the typing left the slot; the seen rides with the answer");
  signals.turnEnded("bob");
  await settle();
  assert.deepEqual(slot().map((m) => m.kind), ["seen", "text"], "no `stopped` after a reply");
});
