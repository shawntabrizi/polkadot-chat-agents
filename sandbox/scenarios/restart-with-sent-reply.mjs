// The crash window CI found on the ported restart test: the store pushes a
// stored statement to subscribers BEFORE it answers the submitter (the real
// node does too), so alice can hold the bot's answer while the bot still
// waits for its submit to return. The bot settles the owed entry only after
// that return; killed inside the window, its journal still holds the
// question. Restarted with the same state dir it must not answer the
// question again under a fresh id — with an LLM brain the second answer
// would even differ from the first. The delaySubmitReply fault holds the
// bot inside the window instead of racing for it.
import assert from "node:assert/strict";

export const description = "kill -9 after the answer reached alice but before the store answered the bot's submit: the restart re-sends nothing new";

export async function run({ sandbox, openChat, pcs, bot, log }) {
  const chat = await openChat({ devices: 1 });
  const REQUEST = "session echobot#1→alice /request";

  // Every submit of the bot's is stored and pushed at once; its answer waits.
  const fault = await sandbox.post("/faults", { kind: "delaySubmitReply", from: "echobot", ms: 30_000, count: null });
  const first = await chat.send("first");
  const reply = await sandbox.waitFor(async () => (await chat.answers()).find((m) => m.content.text === "Echo: first"), { label: "\"Echo: first\" in alice's inbox" });
  assert.equal(chat.events("BOT_SENT_TEXT").length, 0, "the bot is still inside its submit (no BOT_SENT_TEXT yet)");
  await chat.bot.stop("SIGKILL");
  const state = bot.state("echobot");
  const owed = state.owed?.find((o) => o.t === "first");
  assert.ok(owed, `the journal lost the question: ${JSON.stringify(state.owed)}`);
  assert.equal(state.peers.length, 1, "the session is persisted");
  log(`killed -9 inside the submit window (fault #${fault.id}); journal holds the question${owed.ans ? " and its answer" : " only"}`);
  await pcs("fault", "clear");

  // Same state dir: the journal, not the brain, must produce whatever is missing.
  const echo = await bot.start("echobot");
  const restored = await echo.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
  assert.deepEqual([restored.peers, restored.owed], [1, 1]);
  const second = await chat.send("second");
  await sandbox.waitFor(async () => (await chat.answers()).some((m) => m.content.text === "Echo: second"), { label: "\"Echo: second\" in alice's inbox" });
  await chat.delivered(second.messageId);
  await chat.delivered(first.messageId);

  // alice: one row per answer, the first under the id it had before the kill.
  const answers = await chat.answers();
  const firstRows = answers.filter((m) => m.content.text === "Echo: first");
  assert.equal(firstRows.length, 1, `alice holds "Echo: first" ${firstRows.length} times: ${JSON.stringify(firstRows.map((m) => m.messageId))}`);
  assert.equal(firstRows[0].messageId, reply.messageId, "the same message id as before the kill");
  assert.equal(answers.filter((m) => m.content.text === "Echo: second").length, 1);
  for (const m of (await chat.inbox()).messages.filter((x) => x.direction === "outgoing")) assert.equal(m.status, "delivered", `${m.messageId} not ACKed`);

  // The wire, live slots and replaced history alike: every statement that
  // carried "Echo: first" carried it under that one id.
  const carried = [...(await chat.wire()), ...(await chat.history(REQUEST))]
    .flatMap((s) => s.decoded?.messages ?? [])
    .filter((m) => m.content?.text === "Echo: first");
  assert.ok(carried.length >= 1, "the wire shows the first answer");
  assert.deepEqual([...new Set(carried.map((m) => m.messageId))], [reply.messageId], "a second statement carried the first answer under another id");

  // The brain ran once for "first" across both lives: the restarted process
  // composed one answer (the second) and re-sent the journaled first.
  assert.deepEqual(echo.events.filter((e) => e.event === "BOT_RECEIVED_TEXT").map((e) => e.chars), ["second".length], "the old inbound was not re-received");
  assert.equal(echo.events.filter((e) => e.event === "BOT_SENT_TEXT").length, 1, "the restarted process composed only the second answer");
  assert.equal(echo.events.filter((e) => e.event === "BOT_OWED_ANSWER_RESENT").length, 1, "the journaled answer was re-sent once");
  log(`after restart: ${answers.length} answers in alice's inbox, first answer id unchanged, wire carried it under ${carried.length} statement(s)`);

  await echo.stop("SIGTERM");
}
