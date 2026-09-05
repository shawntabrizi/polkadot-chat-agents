// protocol.md: a dataChannelOffer (8) is ACKed, then auto-declined with
// dataChannelClosed (11) — the bot has no WebRTC stack, and declining beats
// ringing forever. alice places a call; the wire must show her offer ACKed
// before the bot's decline statement, and the decline must name her offer.
// No brain call, no text answer.
import assert from "node:assert/strict";

export const description = "a call offer is ACKed, then declined with dataChannelClosed naming the offer; the brain never runs";

export async function run({ sandbox, openChat, log }) {
  const chat = await openChat({ devices: 1 });
  const { bot } = chat;

  const offer = await sandbox.post("/personas/alice/rooms/echobot/messages", { call: true });
  assert.equal(offer.content.type, "callOffer");
  const seen = await bot.waitFor((e) => e.event === "BOT_CALL_OFFER", { label: "BOT_CALL_OFFER" });
  assert.equal(seen.purpose, 0, "AUDIO_CALL");
  const declined = await bot.waitFor((e) => e.event === "BOT_CALL_DECLINED", { label: "BOT_CALL_DECLINED" });
  assert.equal(declined.offerId, offer.messageId);
  await chat.delivered(offer.messageId);
  await sandbox.waitFor(async () => (await chat.inbox()).messages.some((m) => m.messageId === `call-closed:${offer.messageId}`), { label: "alice sees the decline under her offer" });

  // The wire: her offer on her device session, ACKed; his decline on his,
  // naming the offer; the ACK stamped before the decline.
  const request = await chat.slot("session alice#1→echobot /request");
  const wireOffer = request.decoded.messages.find((m) => m.messageId === offer.messageId);
  assert.deepEqual([wireOffer.content.type, wireOffer.content.purpose], ["callOffer", "AUDIO_CALL"]);
  const ack = request.acks.find((a) => a.by === "echobot");
  assert.equal(ack?.code, "success", "the offer was ACKed");
  const decline = (await chat.history("session echobot#1→alice /request"))
    .find((h) => h.decoded?.messages?.some((m) => m.content?.type === "callDeclined"));
  assert.ok(decline, "no dataChannelClosed on the bot's session");
  const closed = decline.decoded.messages.find((m) => m.content.type === "callDeclined");
  assert.equal(closed.content.offerMessageId, offer.messageId);
  assert.ok(Date.parse(ack.at) <= Date.parse(decline.receivedAt), `ACK at ${ack.at} must not follow the decline at ${decline.receivedAt}`);
  assert.ok(decline.acks.some((a) => a.by === "alice#1"), "alice ACKed the decline");

  assert.equal(chat.events("BOT_RECEIVED_TEXT").length, 0, "a call is not a message for the brain");
  assert.equal(chat.events("BOT_SENT_TEXT").length, 0, "no text answer to a call");
  log(`offer ${offer.messageId.slice(0, 8)} ACKed at ${ack.at}, declined at ${decline.receivedAt}`);
}
