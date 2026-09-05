// Invariant (CLAUDE.md): one undecodable message in a batch must not prevent
// decoding the rest. alice's device puts a message no codec can read (a
// richText with a junk attachment, the device test client's poison) into
// the same batch as a good text. The bot must answer the text, ACK the
// batch, and log the poison as undecodable — never drop the batch.
//
// The SDK submits the poison at once and, when the text follows before the
// ACK, extends the batch to [poison, text] under a new request id. So the bot
// may see a poison-only statement first; it ACKs that too (bot-core ACKs on
// delivery, S1 answer 3), and the superset once more.
import assert from "node:assert/strict";

import { bytesToHex } from "../lib/bytes.mjs";
import { poisonMessage } from "../lib/scenario.mjs";

export const description = "an undecodable message in a batch: the bot answers the good one and ACKs the batch";

export async function run({ sandbox, openChat, log }) {
  const chat = await openChat({ devices: 1 });
  const { bot, answered, delivered } = chat;
  const REQUEST = "session alice#1→echobot /request";

  await sandbox.post("/personas/alice/rooms/echobot/messages", { raw: bytesToHex(poisonMessage()) });
  const good = await sandbox.post("/personas/alice/rooms/echobot/messages", { text: "good one" });
  const undecodable = await bot.waitFor((e) => e.event === "BOT_UNDECODABLE_MESSAGES", { label: "BOT_UNDECODABLE_MESSAGES" });
  assert.equal(undecodable.count, 1);
  await answered("Echo: good one");
  await delivered(good.messageId);

  // The wire: the live batch carries both, one undecodable, and the bot's ACK names it.
  const slot = await chat.slot(REQUEST);
  assert.equal(slot.decoded.messages.length, 2, "poison and text ride one statement");
  assert.deepEqual(slot.decoded.messages.map((m) => m.undecodable ? "undecodable" : m.content.text), ["undecodable", "good one"]);
  assert.deepEqual(slot.acks.filter((a) => a.live).map((a) => [a.by, a.code]), [["echobot", "success"]], "the batch was ACKed");
  // Every statement that ever sat in the slot (a poison-only one included) was ACKed.
  const requests = (await chat.history(REQUEST)).filter((h) => h.decoded?.requestId);
  for (const r of requests) assert.ok(r.acks.some((a) => a.by === "echobot" && a.code === "success"), `request ${r.decoded.requestId} was never ACKed`);
  log(`${requests.length} statement(s) in the slot's history, every one ACKed`);

  assert.deepEqual(chat.events("BOT_RECEIVED_TEXT").map((e) => e.chars), ["good one".length], "one brain call, for the good message");
  assert.equal(chat.events("BOT_SENT_TEXT").length, 1);
  assert.equal(chat.events("BOT_SESSION_DECODE_FAILED").length, 0, "the batch itself decoded");
}
