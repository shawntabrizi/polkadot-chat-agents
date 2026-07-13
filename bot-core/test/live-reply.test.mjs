import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveReplies, createProgressTracker } from "../lib/live-reply.mjs";

// Deterministic clock + timers: advance() fires due timers in order.
const makeClock = () => {
  let t = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => t,
    timers: {
      set: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
      clear: (id) => timers.delete(id),
    },
    async advance(ms) {
      const until = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, e]) => e.at <= until).sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, e] = due[0];
        timers.delete(id);
        t = e.at;
        e.fn();
        await Promise.resolve(); await Promise.resolve(); // let flush promises settle
      }
      t = until;
      await Promise.resolve(); await Promise.resolve();
    },
  };
};

// Harness: capture sends; ACK resolution controlled by the test.
const makeHarness = ({ minIntervalMs = 1000, maxIntervalMs = 8000, finalAckWaitMs = 5000 } = {}) => {
  const clock = makeClock();
  const sent = []; // {peerHex, text, editOf, messageId}
  let nextMsg = 1;
  const acks = new Map(); // requestId -> resolve
  const live = createLiveReplies({
    send: async ({ peerHex, text, editOf, supersedes }) => {
      const messageId = editOf ? null : `MSG-${nextMsg++}`;
      const token = `REQ-${sent.length + 1}`;
      sent.push({ peerHex, text, editOf: editOf ?? null, messageId, supersedes: supersedes ?? null });
      return { messageId, delivered: token };
    },
    awaitAck: (token) => new Promise((resolve) => acks.set(token, resolve)),
    minIntervalMs,
    maxIntervalMs,
    finalAckWaitMs,
    now: clock.now,
    timers: clock.timers,
  });
  const ack = async (requestId, ok = true) => { acks.get(requestId)(ok); await Promise.resolve(); await Promise.resolve(); };
  return { clock, sent, live, ack };
};

test("no edits go out before the placeholder is ACKed", async () => {
  const h = makeHarness();
  const handle = await h.live.begin("peer", "thinking…");
  handle.update("progress 1");
  await h.clock.advance(10_000);
  assert.equal(h.sent.length, 1, "only the placeholder should have been sent");
  await h.ack("REQ-1");
  await h.clock.advance(0);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].editOf, handle.messageId);
  assert.equal(h.sent[1].text, "progress 1");
});

test("latest-wins coalescing under the min interval", async () => {
  const h = makeHarness({ minIntervalMs: 1000 });
  const handle = await h.live.begin("peer", "thinking…");
  await h.ack("REQ-1");
  await h.clock.advance(1000);
  handle.update("frame A");
  await h.clock.advance(0);
  assert.equal(h.sent.at(-1).text, "frame A");
  // Burst of frames inside the throttle window: only the last survives.
  handle.update("frame B");
  handle.update("frame C");
  handle.update("frame D");
  await h.clock.advance(999);
  assert.equal(h.sent.filter((s) => s.editOf).length, 1, "no edit inside the window");
  await h.clock.advance(2);
  assert.equal(h.sent.at(-1).text, "frame D");
  assert.equal(h.sent.filter((s) => s.editOf).length, 2);
});

test("identical frames are never re-sent", async () => {
  const h = makeHarness({ minIntervalMs: 10 });
  const handle = await h.live.begin("peer", "thinking…");
  await h.ack("REQ-1");
  handle.update("same");
  await h.clock.advance(100);
  handle.update("same");
  await h.clock.advance(100);
  assert.equal(h.sent.filter((s) => s.editOf).length, 1);
});

test("edit interval escalates: doubles every 3 edits up to the cap", async () => {
  const h = makeHarness({ minIntervalMs: 1000, maxIntervalMs: 4000 });
  const handle = await h.live.begin("peer", "thinking…");
  await h.ack("REQ-1");
  // Feed a fresh frame every 100ms for 30s and record when edits land.
  const stamps = [];
  let frames = 0;
  let lastCount = 0;
  for (let i = 0; i < 300; i += 1) {
    handle.update(`frame ${frames++}`);
    await h.clock.advance(100);
    const count = h.sent.filter((s) => s.editOf).length;
    if (count > lastCount) { stamps.push(h.clock.now()); lastCount = count; }
  }
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  // First edits ~1s apart, then ~2s after 3 edits, then capped at ~4s.
  assert.ok(gaps.length >= 6, `expected several edits, got gaps=${JSON.stringify(gaps)}`);
  assert.ok(gaps[0] <= 1200 && gaps[1] <= 1200, `early gaps should be ~1s: ${JSON.stringify(gaps)}`);
  assert.ok(gaps[3] >= 1900, `gap after 3 edits should escalate to ~2s: ${JSON.stringify(gaps)}`);
  assert.ok(Math.max(...gaps) <= 4200, `gaps must respect the 4s cap: ${JSON.stringify(gaps)}`);
  const lateGaps = gaps.slice(6);
  assert.ok(lateGaps.every((g) => g >= 3900), `late gaps should sit at the cap: ${JSON.stringify(gaps)}`);
});

test("finalize edits the placeholder once ACKed", async () => {
  const h = makeHarness();
  const handle = await h.live.begin("peer", "thinking…");
  await h.ack("REQ-1");
  const result = await handle.finalize("the answer");
  assert.deepEqual(result, { messageId: handle.messageId, edited: true });
  assert.equal(h.sent.at(-1).editOf, handle.messageId);
  assert.equal(h.sent.at(-1).text, "the answer");
  // further updates are ignored
  handle.update("late frame");
  await h.clock.advance(60_000);
  assert.equal(h.sent.at(-1).text, "the answer");
});

test("finalize before ACK waits, then edits when the ACK arrives", async () => {
  const h = makeHarness({ finalAckWaitMs: 5000 });
  const handle = await h.live.begin("peer", "thinking…");
  const finalizeP = handle.finalize("answer");
  await h.clock.advance(1000);
  assert.equal(h.sent.length, 1, "final must not go out before ACK/timeout");
  await h.ack("REQ-1");
  const result = await finalizeP;
  assert.equal(result.edited, true);
  assert.equal(h.sent.at(-1).editOf, handle.messageId);
});

test("finalize falls back to a plain message when the ACK never comes", async () => {
  const h = makeHarness({ finalAckWaitMs: 5000 });
  const handle = await h.live.begin("peer", "thinking…");
  handle.update("progress that must be dropped");
  const finalizeP = handle.finalize("answer");
  await h.clock.advance(5001);
  const result = await finalizeP;
  assert.equal(result.edited, false);
  assert.notEqual(result.messageId, handle.messageId);
  const last = h.sent.at(-1);
  assert.equal(last.editOf, null, "fallback must be a plain message");
  assert.equal(last.text, "answer");
  assert.deepEqual(last.supersedes, [handle.messageId], "fallback must supersede the unfetched placeholder");
  assert.equal(h.sent.filter((s) => s.editOf).length, 0, "no progress edits without ACK");
});

test("failed ACK drops progress frames entirely", async () => {
  const h = makeHarness();
  const handle = await h.live.begin("peer", "thinking…");
  await h.ack("REQ-1", false);
  handle.update("progress");
  await h.clock.advance(60_000);
  assert.equal(h.sent.length, 1, "no edits after a failed ACK");
});

test("a failed edit submit drops the frame but later frames recover", async () => {
  const clock = makeClock();
  const sent = [];
  let fail = false;
  let nextReq = 1;
  const acks = new Map();
  const live = createLiveReplies({
    send: async ({ text, editOf }) => {
      if (fail && editOf) throw new Error("submit failed");
      sent.push({ text, editOf: editOf ?? null });
      return { messageId: editOf ? null : "MSG-1", delivered: `REQ-${nextReq++}` };
    },
    awaitAck: (id) => new Promise((r) => acks.set(id, r)),
    minIntervalMs: 100,
    now: clock.now,
    timers: clock.timers,
  });
  const handle = await live.begin("peer", "t");
  acks.get("REQ-1")(true);
  await clock.advance(200);
  fail = true;
  handle.update("dropped frame");
  await clock.advance(200);
  fail = false;
  handle.update("good frame");
  await clock.advance(200);
  assert.equal(sent.filter((s) => s.editOf).at(-1).text, "good frame");
});

test("throttledEdit coalesces harness-driven edits of a delivered message", async () => {
  const h = makeHarness({ minIntervalMs: 1000 });
  h.live.throttledEdit("peer", "TARGET-1", "v1");
  await h.clock.advance(0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].editOf, "TARGET-1");
  // burst -> latest wins after the window
  h.live.throttledEdit("peer", "TARGET-1", "v2");
  h.live.throttledEdit("peer", "TARGET-1", "v3");
  await h.clock.advance(1001);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].text, "v3");
});

test("finalizeExisting flushes the bridge's final edit and cancels queued progress", async () => {
  const h = makeHarness({ minIntervalMs: 1000 });
  h.live.throttledEdit("peer", "TARGET-1", "progress");
  await h.clock.advance(0);
  h.live.throttledEdit("peer", "TARGET-1", "late progress");
  const result = await h.live.finalizeExisting("peer", "TARGET-1", "final answer");
  assert.deepEqual(result, { messageId: "TARGET-1", edited: true });
  assert.equal(h.sent.at(-1).editOf, "TARGET-1");
  assert.equal(h.sent.at(-1).text, "final answer");
  await h.clock.advance(10_000);
  assert.equal(h.sent.at(-1).text, "final answer", "the queued progress frame must not overwrite the terminal edit");
});

test("cancelExisting and a guard fence discard a revoked queued bridge edit", async () => {
  const h = makeHarness({ minIntervalMs: 1000 });
  let active = true;
  h.live.throttledEdit("peer", "TARGET-1", "first", { guard: () => active });
  await h.clock.advance(0);
  assert.equal(h.sent.length, 1);

  h.live.throttledEdit("peer", "TARGET-1", "must not send", { guard: () => active });
  active = false;
  assert.equal(h.live.cancelExisting("peer", "TARGET-1"), true);
  await h.clock.advance(10_000);
  assert.deepEqual(h.sent.map((entry) => entry.text), ["first"]);

  // Even if cancellation races a timer, the guard is evaluated directly
  // before the protocol send and fences the stale frame.
  h.live.throttledEdit("peer", "TARGET-2", "also stale", { guard: () => active });
  await h.clock.advance(0);
  assert.deepEqual(h.sent.map((entry) => entry.text), ["first"]);
});

test("progress tracker renders elapsed, steps and a rolling action window", () => {
  let t = 0;
  const tracker = createProgressTracker({ label: "working", maxActions: 2, now: () => t });
  assert.equal(tracker.render(), "⏳ working · 0s");
  t = 24_000;
  tracker.add("Read notes.md");
  tracker.add("Bash: npm test");
  tracker.add("search: statement store");
  assert.equal(tracker.render(), [
    "⏳ working · 24s · step 3",
    "▸ Bash: npm test",
    "▸ search: statement store",
  ].join("\n"));
  t = 84_000;
  assert.match(tracker.render(), /⏳ working · 1m 24s · step 3/);
});
