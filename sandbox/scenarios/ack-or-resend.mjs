// Invariant (CLAUDE.md): every inbound request must be ACKed — the app
// resends until it sees one. The mirror: a resend must not be answered
// twice. The node swallows the bot's ACK for alice's first message; alice's
// SDK resends it (as the app does: the un-ACKed batch goes out again, as a
// superset, with her next message); the bot must ACK the resend and answer
// "first" exactly once — no duplicate row in alice's inbox, one brain call.
import assert from "node:assert/strict";

export const description = "the node drops the bot's ACK once: the persona resends, the bot ACKs the resend and answers exactly once";

export async function run({ sandbox, openChat, log, sleep }) {
  const chat = await openChat({ devices: 1 });
  const { bot, answered, delivered, inbox } = chat;
  const REQUEST = "session alice#1→echobot /request";
  const RESPONSE = "session echobot#1→alice /response";

  // The bot's next statement on its response channel towards alice vanishes at the node.
  const fault = await sandbox.post("/faults", { kind: "drop", from: "echobot", channel: RESPONSE, count: 1 });
  const first = await sandbox.post("/personas/alice/rooms/echobot/messages", { text: "first" });
  await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "first".length, { label: "first received" });
  await answered("Echo: first");
  await sandbox.waitFor(async () => (await sandbox.get("/faults")).length === 0, { label: "the drop fault spent on the bot's ACK" });
  await sleep(1500);
  assert.equal((await inbox()).messages.find((m) => m.messageId === first.messageId).status, "sent", "no ACK reached alice: her row stays `sent`");
  let slot = await chat.slot(REQUEST);
  assert.deepEqual(slot.decoded.messages.map((m) => m.content.text), ["first"]);
  assert.deepEqual(slot.acks, [], "the wire holds no ACK for the first request");
  log(`bot ACK for request ${slot.decoded.requestId.slice(0, 8)} dropped by fault #${fault.id}`);

  // The resend: alice's next message re-submits the whole un-ACKed batch
  // under a new request id, the way the app does.
  const second = await sandbox.post("/personas/alice/rooms/echobot/messages", { text: "second" });
  await answered("Echo: second");
  await delivered(second.messageId);
  await delivered(first.messageId);
  slot = await chat.slot(REQUEST);
  assert.deepEqual(slot.decoded.messages.map((m) => m.content.text), ["first", "second"], "the resend carries the un-ACKed message again");
  assert.deepEqual(slot.acks.filter((a) => a.live).map((a) => [a.by, a.code]), [["echobot", "success"]], "the bot ACKed the resend");
  const history = await chat.history(REQUEST);
  assert.ok(history.some((h) => h.reason === "replaced" && h.decoded.messages.length === 1 && h.decoded.messages[0].content.text === "first"), "the slot history shows the first statement the resend replaced");

  // Exactly once: one brain call and one answer for "first".
  const received = chat.events("BOT_RECEIVED_TEXT").map((e) => e.chars);
  assert.deepEqual(received, ["first".length, "second".length], "the resent \"first\" was deduped, not fed to the brain again");
  assert.equal(chat.events("BOT_SENT_TEXT").length, 2);
  assert.deepEqual((await chat.answers()).map((m) => m.content.text).sort(), ["Echo: first", "Echo: hello bot", "Echo: second"], "no duplicate answer row");
  log("resend deduped: 2 brain calls for 2 messages, 1 answer each");
}
