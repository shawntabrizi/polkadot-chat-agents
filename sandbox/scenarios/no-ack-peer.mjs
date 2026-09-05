// Invariant (CLAUDE.md, protocol.md "One statement per channel"): the bot
// keeps at most ONE un-ACKed request statement current per peer; later
// messages extend it (a superset under a new request id, so replacement is
// lossless) up to the extension budget, then queue behind it; and the
// liveness backstop takes the slot over once messages are queued behind a
// statement un-ACKed for BOT_OUTBOUND_ACK_GRACE_MS — with nothing queued
// the current statement waits in the slot indefinitely.
//
// alice's device never ACKs: the node swallows every statement on her
// response channel. She still fetches every version of the bot's slot live,
// so her inbox proves what each replacement carried.
import assert from "node:assert/strict";

export const description = "a peer that never ACKs: one un-ACKed statement current, extended then queued, taken over after the grace window, never while nothing is queued";

const GRACE_MS = 3000;
const MAX_EXTENSIONS = 8; // lib/outbound-lanes.mjs default

export async function run({ sandbox, openChat, log, sleep }) {
  const chat = await openChat({ devices: 1, env: { BOT_OUTBOUND_ACK_GRACE_MS: String(GRACE_MS) } });
  const { bot } = chat;
  const REQUEST = "session echobot#1→alice /request";
  await sandbox.post("/faults", { kind: "drop", from: "alice", channel: "session alice#1→echobot /response", count: null });

  // One answer per question, one at a time: the first fills the slot, the
  // next MAX_EXTENSIONS extend it, in one statement.
  const questions = Array.from({ length: MAX_EXTENSIONS + 1 }, (_, i) => `q${i + 1}`);
  for (const [i, q] of questions.entries()) {
    await chat.send(q);
    await sandbox.waitFor(() => chat.events("BOT_SENT_TEXT").length === i + 1, { label: `answer ${i + 1} submitted` });
  }
  const extensions = chat.events("BOT_OUTBOUND_EXTENDED");
  assert.equal(extensions.length, MAX_EXTENSIONS, "every answer after the first extended the un-ACKed statement");
  assert.equal(extensions.at(-1).messages, MAX_EXTENSIONS + 1);
  let slot = await chat.slot(REQUEST);
  assert.equal(slot.decoded.messages.length, MAX_EXTENSIONS + 1, "ONE statement carries every un-ACKed answer");
  assert.deepEqual(slot.acks.filter((a) => a.live), [], "no ACK from alice on the wire");
  const versions = (await chat.history(REQUEST)).filter((h) => h.decoded?.messages);
  for (let i = 1; i < versions.length; i += 1) {
    // The opener's echo (before the fault) was ACKed and freed the slot; every
    // version after it must carry its un-ACKed predecessor whole.
    if (versions[i - 1].acks?.some((a) => a.by === "alice#1")) continue;
    const previous = versions[i - 1].decoded.messages.map((m) => m.messageId);
    assert.ok(previous.every((id) => versions[i].decoded.messages.some((m) => m.messageId === id)), `version ${i} dropped a message of version ${i - 1}`);
  }
  log(`${MAX_EXTENSIONS + 1} answers, ${extensions.length} extensions, one statement in the slot, lossless replacement history`);

  // The budget is spent: the next answer queues behind the slot. Its
  // BOT_SENT_TEXT only fires once it is on the node, i.e. after the takeover.
  const queuedAt = Date.now();
  await chat.send("q10");
  await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === 3, { label: "q10 received" });
  await sleep(500);
  assert.equal(chat.events("BOT_SENT_TEXT").length, MAX_EXTENSIONS + 1, "the 10th answer is queued, not submitted");
  assert.equal((await chat.slot(REQUEST)).decoded.messages.length, MAX_EXTENSIONS + 1, "the slot is unchanged while the answer queues");
  const takeover = await bot.waitFor((e) => e.event === "BOT_OUTBOUND_TAKEOVER", { label: "BOT_OUTBOUND_TAKEOVER", timeoutMs: GRACE_MS + 10_000 });
  const waited = Date.now() - queuedAt;
  assert.ok(waited >= GRACE_MS - 200, `the takeover came after ${waited}ms, before the ${GRACE_MS}ms grace`);
  assert.deepEqual([takeover.dropped, takeover.queued], [MAX_EXTENSIONS + 1, 1]);
  await sandbox.waitFor(() => chat.events("BOT_SENT_TEXT").length === MAX_EXTENSIONS + 2, { label: "the queued answer submitted" });
  slot = await chat.slot(REQUEST);
  assert.deepEqual(slot.decoded.messages.map((m) => m.content.text), ["Echo: q10"], "the queued batch took the slot over");
  assert.ok((await chat.history(REQUEST)).some((h) => h.reason === "replaced" && h.decoded.messages.length === MAX_EXTENSIONS + 1), "the un-ACKed statement is history");
  log(`takeover after ${waited}ms: dropped ${takeover.dropped}, queued ${takeover.queued}`);

  // With nothing queued the un-ACKed statement waits: q11 extends it and no
  // second takeover fires, grace or not.
  await chat.send("q11");
  await sandbox.waitFor(() => chat.events("BOT_SENT_TEXT").length === MAX_EXTENSIONS + 3, { label: "answer 11 submitted" });
  await sleep(GRACE_MS + 1000);
  assert.equal(chat.events("BOT_OUTBOUND_TAKEOVER").length, 1, "no takeover while nothing is queued");
  assert.deepEqual((await chat.slot(REQUEST)).decoded.messages.map((m) => m.content.text), ["Echo: q10", "Echo: q11"]);

  // alice fetched every version live, so every answer reached her once.
  const answers = await chat.answers();
  assert.deepEqual(answers.map((m) => m.content.text).filter((t) => t !== "Echo: hello bot").sort(), [...questions, "q10", "q11"].map((q) => `Echo: ${q}`).sort());
  assert.equal(chat.events("BOT_RECEIVED_TEXT").length, questions.length + 2, "one brain call per question");
}
