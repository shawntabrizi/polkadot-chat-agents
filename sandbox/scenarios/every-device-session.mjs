// Invariant (CLAUDE.md): follow-ups must be polled on every device session,
// not just the identity session. alice has three devices; each sends a
// follow-up on its own device channel (SessionId(D(alice#i), bot)). The bot
// must receive all three, answer each on every device, and ACK each.
import assert from "node:assert/strict";

export const description = "a persona with 3 devices: a follow-up from each device channel is received, answered on all devices and ACKed";

export async function run({ openChat, bot: bots, log }) {
  const chat = await openChat({ devices: 3 });
  const { bot, answered, delivered } = chat;

  for (const device of [1, 2, 3]) {
    const text = `from device ${device}`;
    const sent = await chat.send(text, device);
    assert.equal(sent.device, device);
    await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === text.length, { label: `"${text}" received` });
    await answered(`Echo: ${text}`);
    await delivered(sent.messageId);
    // The wire: the statement sits on THAT device's session, and the bot ACKed it.
    const slot = await chat.slot(`session alice#${device}→echobot /request`);
    assert.ok(slot, `no statement on alice#${device}'s device session`);
    assert.ok(slot.decoded.messages.some((m) => m.messageId === sent.messageId), `"${text}" is not on alice#${device}'s channel`);
    assert.ok(slot.acks.some((a) => a.by === "echobot" && a.code === "success"), `the bot did not ACK alice#${device}'s request`);
    log(`device ${device}: received on its own channel, answered on 3 devices, ACKed`);
  }

  // The bot's answers were wrapped for all three devices.
  const answerSlot = await chat.slot("session echobot#1→alice /request");
  assert.deepEqual(answerSlot.decoded.recipients.map((r) => r.label).sort(), ["alice#1", "alice#2", "alice#3"]);
  assert.equal(chat.events("BOT_RECEIVED_TEXT").length, 3, "three brain calls");
  assert.equal(chat.events("BOT_SENT_TEXT").length, 3);
  // And its persisted roster holds them, so a restart keeps polling all three.
  assert.equal(bots.state("echobot").peers[0].devices.length, 3);
}
