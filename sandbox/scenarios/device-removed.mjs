// S2 answer 3: a persona that removes a device fans out deviceRemoved (18)
// like the phone; the bot must drop the device from its roster — stop
// wrapping envelopes for it, stop watching its session — and persist that.
import assert from "node:assert/strict";

export const description = "a persona removes a device: the bot stops addressing it and drops its session";

export async function run({ sandbox, openChat, pcs, bot: bots, log }) {
  const chat = await openChat({ devices: 2 });
  const { bot, persona } = chat;
  const ANSWERS = "session echobot#1→alice /request";
  const warm = await chat.send("from device 2", 2);
  await chat.answered("Echo: from device 2", [1, 2]);
  await chat.delivered(warm.messageId);
  assert.deepEqual((await chat.slot(ANSWERS)).decoded.recipients.map((r) => r.label).sort(), ["alice#1", "alice#2"], "answers wrapped for both devices");
  assert.equal(bots.state("echobot").peers[0].devices.length, 2);

  // alice unpairs device 2; device 1 tells the bot.
  const gone = await pcs("device", "remove", "alice", "2");
  assert.deepEqual([gone.index, gone.removed], [2, true]);
  const removed = await bot.waitFor((e) => e.event === "BOT_PEER_DEVICE_REMOVED", { label: "BOT_PEER_DEVICE_REMOVED" });
  assert.equal(removed.remaining, 1);
  assert.equal(removed.device, persona.devices[1].account.slice(2, 18), "the removed device's account");
  await sandbox.waitFor(() => bots.state("echobot").peers[0].devices.length === 1, { label: "the persisted roster shrank" });
  assert.equal(bots.state("echobot").peers[0].devices[0].s, persona.devices[0].account.slice(2), "device 1 stays");
  const fanout = await chat.slot("session alice#1→echobot /request");
  const notice = fanout.decoded.messages.find((m) => m.content.type === "deviceRemoved");
  assert.equal(notice?.content.statementAccountId, persona.devices[1].account, "the deviceRemoved rode alice#1's session");
  // The bot ACKs after it logs BOT_PEER_DEVICE_REMOVED, so the ACK can land
  // after the read above. A bounded wait measures that gap instead of
  // racing it (S4 answer 4); what is asserted is that the ACK exists.
  const ackedAt = Date.now();
  const ack = await sandbox.waitFor(async () => (await chat.slot("session alice#1→echobot /request")).acks.find((a) => a.by === "echobot" && a.code === "success"), { timeoutMs: 2000, label: "the bot's ACK of the deviceRemoved" });
  log(`deviceRemoved received, roster 2 → 1, persisted; ACK seen ${Date.now() - ackedAt} ms after the event (stamped ${ack.at})`);

  // From now on the bot addresses device 1 alone.
  const after = await chat.send("after the removal", 1);
  await chat.answered("Echo: after the removal", [1]);
  await chat.delivered(after.messageId);
  const answer = await chat.slot(ANSWERS);
  assert.ok(answer.decoded.messages.some((m) => m.content.text === "Echo: after the removal"));
  assert.deepEqual(answer.decoded.recipients.map((r) => r.label), ["alice#1"], "the envelope no longer names device 2");
  assert.deepEqual(answer.acks.filter((a) => a.live).map((a) => a.by), ["alice#1"]);
  const device2 = await chat.wire(`signer=${persona.devices[1].account}`);
  assert.ok(device2.every((s) => Date.parse(s.receivedAt) < Date.parse(fanout.receivedAt)), "nothing new from device 2 after its removal");
  assert.equal(chat.events("BOT_SENT_TEXT").length, 2);
}
