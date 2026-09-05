// Expiry passing while a message is queued (PLAN.md S3). What the wire
// actually shows: every chat statement — the SDK's and bot-core's — carries
// the expiration 0xffffffff (never); the low word is a sequence the store
// compares for slot replacement. So a clock jump expires nothing a chat
// client wrote, a statement queued for an absent bot survives it and still
// lands, and the sender's next statement still takes the slot with a
// strictly higher sequence. Only a statement with a real expiration (planted
// here by hand) is dropped by the moved clock.
//
// Not exercised: a jump past year 2106 (0xffffffff) would expire every chat
// statement and reject every new one as alreadyExpired; neither client has
// a re-allocation path for that, because the protocol pins the high word.
// That is a protocol fact, not a bot-core defect (see docs/acceptance.md).
import assert from "node:assert/strict";

import { createRawSigner, submitRaw } from "../lib/scenario.mjs";

export const description = "the clock jumps while a message waits for an absent bot: chat statements never expire, the message lands, the slot keeps advancing";

export async function run({ sandbox, openChat, bot: bots, log }) {
  const chat = await openChat({ devices: 1 });
  const REQUEST = "session alice#1→echobot /request";
  const before = await chat.wire();
  assert.ok(before.length > 0 && before.every((s) => s.expiresAt === null), "every chat statement, from both implementations, never expires");
  assert.ok(before.some((s) => s.signerLabel === "echobot") && before.some((s) => s.signerLabel === "alice#1"));

  // The bot goes away; alice's message waits in the store, un-fetched.
  await chat.bot.stop("SIGTERM");
  const queued = await chat.send("queued while the bot was away");
  await sandbox.waitFor(async () => (await chat.slot(REQUEST))?.decoded.messages.some((m) => m.messageId === queued.messageId), { label: "the queued statement in the store" });
  // Next to it, a statement with a real expiration, as no chat client writes.
  const signer = createRawSigner();
  await sandbox.post("/accounts", { account: signer.account });
  const planted = `0x${"e0".repeat(32)}`;
  await submitRaw(sandbox.storeUrl, await signer.sign({ channel: planted, topics: [`0x${"70".repeat(32)}`], expiresInSecs: 60, data: new Uint8Array([1]) }));
  const plantedRow = (await sandbox.get(`/wire?channel=${planted}`)).statements[0];
  assert.ok(plantedRow.expiresAt !== null, "the planted statement expires in a minute");

  // Two hours pass on the node.
  await sandbox.post("/clock", { offsetMs: 2 * 3600 * 1000 });
  assert.equal((await sandbox.get(`/wire?channel=${planted}`)).statements.length, 0, "the store dropped the expired statement");
  assert.deepEqual((await sandbox.get(`/wire/history?channel=${planted}`)).history.map((h) => h.reason), ["expired"]);
  const waiting = await chat.slot(REQUEST);
  assert.ok(waiting?.decoded.messages.some((m) => m.messageId === queued.messageId), "the queued chat statement survived the jump");
  assert.equal(waiting.expiresAt, null);
  assert.deepEqual(waiting.acks, [], "nobody fetched it yet");
  log("clock +2h: the planted 60s statement expired, the queued chat statement did not");

  // The bot comes back and fetches what waited.
  const bot = await bots.start("echobot");
  await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
  await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "queued while the bot was away".length, { label: "queued text received" }).catch(() => null);
  await chat.answered("Echo: queued while the bot was away");
  await chat.delivered(queued.messageId);
  const landed = await chat.slot(REQUEST);
  assert.ok(landed.acks.some((a) => a.by === "echobot" && a.code === "success"), "ACKed after the jump");

  // The sender keeps advancing the slot under the moved clock: a strictly
  // higher sequence, still never expiring.
  const later = await chat.send("after the jump");
  await chat.answered("Echo: after the jump");
  await chat.delivered(later.messageId);
  const advanced = await chat.slot(REQUEST);
  assert.ok(advanced.sequence > landed.sequence, `sequence ${advanced.sequence} must exceed ${landed.sequence}`);
  assert.equal(advanced.replacedCount, landed.replacedCount + 1);
  assert.equal(advanced.expiresAt, null);
  assert.ok((await chat.wire()).every((s) => s.expiresAt === null), "still nothing with a real expiration on the wire");
  log(`slot sequence ${landed.sequence} → ${advanced.sequence} after the jump; both ACKed`);
  await sandbox.post("/clock", { reset: true });
}
