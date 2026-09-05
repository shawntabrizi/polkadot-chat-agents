// The session-rebuild invariant (CLAUDE.md): a bot killed with -9 while it
// owes a reply must, restarted with the same state dir, answer exactly once
// and re-answer nothing. The "brain" is a mock CLI that answers three
// seconds after the question, so there is a window in which the message is
// ACKed and journaled but not yet answered; the kill lands in that window.
import assert from "node:assert/strict";

export const description = "kill -9 with a reply owed, restart with the same state dir: one answer, nothing duplicated or lost";

// A claude-shaped CLI: emits the result event 3s after start, answering the
// user message. The runtime frames a custom command's prompt (persona, then
// "User message:\n<text>"), so the mock takes what follows that marker. No
// thinking placeholder, so an answer is exactly one message whose first
// line is "Answer: <question>" (the first reply also carries the /help tip).
const brain = {
  BOT_AI_CMD: process.execPath,
  BOT_AI_ARGS: JSON.stringify([
    "-e",
    "const p = process.argv[1]; const i = p.lastIndexOf('User message:\\n'); const q = (i >= 0 ? p.slice(i + 14) : p).trim();"
      + " setTimeout(() => process.stdout.write(JSON.stringify({ type: 'result', result: `Answer: ${q}` }) + '\\n'), 3000)",
    "__PROMPT__",
  ]),
  BOT_THINKING_TEXT: "",
};

export async function run({ sandbox, pcs, bot, log, sleep }) {
  await pcs("user", "add", "alice");
  await bot.create("slowbot", ["--brain", "claude", "--public"]);
  let slow = await bot.start("slowbot", { env: brain });

  const inbox = async () => (await pcs("inbox", "alice", "--peer", "slowbot"))[0];
  const answers = async () => (await inbox()).messages.filter((m) => m.direction === "incoming" && m.content.text?.startsWith("Answer:")).map((m) => m.content.text.split("\n")[0]);
  const answered = (text) => sandbox.waitFor(async () => (await answers()).includes(text), { label: `"${text}" in alice's inbox` });

  await pcs("request", "alice", "slowbot", "--welcome", "first question");
  await answered("Answer: first question");

  // The crash window: ACKed (alice sees delivered) and journaled, brain still running.
  const crash = await pcs("send", "alice", "slowbot", "crash question");
  await slow.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "crash question".length, { label: "crash question received" });
  await sandbox.waitFor(async () => (await inbox()).messages.find((m) => m.messageId === crash.messageId)?.status === "delivered", { label: "the bot's ACK" });
  await slow.stop("SIGKILL");
  const state = bot.state("slowbot");
  assert.ok(state.owed?.some((o) => o.t === "crash question"), `owed journal lost the question: ${JSON.stringify(state.owed)}`);
  assert.equal(state.peers.length, 1, "the session is persisted");
  assert.deepEqual(await answers(), ["Answer: first question"], "the kill landed before the answer");
  log("killed -9 with one reply owed");

  // Restart with the same state dir: the journal, not a resend, brings the question back.
  slow = await bot.start("slowbot", { env: brain });
  const restored = await slow.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
  assert.deepEqual([restored.peers, restored.owed], [1, 1]);
  await answered("Answer: crash question");
  assert.equal(slow.events.filter((e) => e.event === "BOT_RECEIVED_TEXT").length, 0, "the old statements in the store were not re-received as new messages");

  // The session works without a new opener, and nothing old is answered again.
  const after = await pcs("send", "alice", "slowbot", "after restart");
  await slow.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "after restart".length, { label: "post-restart follow-up" });
  await answered("Answer: after restart");
  await sandbox.waitFor(async () => (await inbox()).messages.find((m) => m.messageId === after.messageId)?.status === "delivered", { label: "post-restart ACK" });
  await sleep(4000); // longer than the brain's delay: a duplicate would have landed by now
  assert.deepEqual((await answers()).sort(), ["Answer: after restart", "Answer: crash question", "Answer: first question"]);
  assert.equal(slow.events.filter((e) => e.event === "BOT_SENT_TEXT").length, 2, "the restarted process sent the owed answer and the new one, nothing else");
  for (const m of (await inbox()).messages.filter((x) => x.direction === "outgoing")) assert.equal(m.status, "delivered", `${m.messageId} not ACKed`);
  log(`answers after restart: ${(await answers()).length}, sends by the restarted process: 2`);

  await slow.stop("SIGTERM");
}
