// Invariant (CLAUDE.md): all outbound session messages go through the
// per-peer outbound lane; a direct submit on the request channel clobbers
// whatever un-fetched messages the slot held.
//
// Two parts. The negative one is on the node: two direct submits on one
// (signer, channel) before any fetch, and the first is gone — the rule that
// makes the lanes necessary. The positive one is on bot-core: a burst of
// messages from the bot side (an agent framework calling the bridge) must
// all reach the persona; the lane extends the un-ACKed statement instead of
// replacing it, and never takes the slot over while the peer is ACKing.
import assert from "node:assert/strict";

import { createRawSigner, submitRaw } from "../lib/scenario.mjs";

export const description = "a direct submit clobbers an un-fetched slot (node); the bot's outbound lanes never do, under a burst";

const BURST = 12;

export async function run({ sandbox, openChat, bot: bots, log }) {
  // Part 1: the store's rule, with a throwaway signer the directory allows.
  const signer = createRawSigner();
  await sandbox.post("/accounts", { account: signer.account });
  const channel = `0x${"c1".repeat(32)}`;
  const topic = `0x${"7c".repeat(32)}`;
  const first = await signer.sign({ channel, topics: [topic], expiresInSecs: 3600, sequence: 1, data: new TextEncoder().encode("message one") });
  const second = await signer.sign({ channel, topics: [topic], expiresInSecs: 3600, sequence: 2, data: new TextEncoder().encode("message two") });
  assert.deepEqual(await submitRaw(sandbox.storeUrl, first), { status: "new" });
  assert.deepEqual(await submitRaw(sandbox.storeUrl, second), { status: "new" });
  const slot = (await sandbox.get(`/wire?channel=${channel}`)).statements;
  assert.equal(slot.length, 1, "one statement per (signer, channel)");
  assert.equal(slot[0].replacedCount, 1);
  assert.equal(slot[0].sequence, 2, "the second submit took the slot");
  const history = (await sandbox.get(`/wire/history?channel=${channel}`)).history;
  assert.deepEqual(history.map((h) => [h.sequence, h.reason]), [[1, "replaced"], [2, null]], "the first is gone from the store; nobody fetched it");
  log("node: the second direct submit replaced the first before any fetch");

  // Part 2: bot-core under a burst from the bridge.
  const chat = await openChat({ devices: 1 });
  const { persona, inbox } = chat;
  const bridge = bots.bridge("echobot");
  const texts = Array.from({ length: BURST }, (_, i) => `burst ${i + 1}`);
  const sent = await Promise.all(texts.map((text) => bridge.send(persona.account, text)));
  assert.ok(sent.every((r) => r.success && r.message_id), "every bridge send was accepted");
  const all = await sandbox.waitFor(async () => {
    const rows = (await inbox()).messages.filter((m) => m.direction === "incoming" && texts.includes(m.content.text));
    return rows.length === BURST && rows.every((m) => m.ackedBy.includes(1)) ? rows : null;
  }, { label: `all ${BURST} burst messages on alice with ACKs`, timeoutMs: 30_000 });
  assert.deepEqual(all.map((m) => m.content.text).sort(), texts.sort(), "nothing lost");
  assert.equal(new Set(all.map((m) => m.messageId)).size, BURST, "nothing duplicated");

  // The lane's evidence: un-ACKed statements were extended (superset under a
  // new request id), never taken over; every replacement in the slot's
  // history carries what the one before it did.
  const REQUEST = "session echobot#1→alice /request";
  const extended = chat.events("BOT_OUTBOUND_EXTENDED");
  assert.equal(chat.events("BOT_OUTBOUND_TAKEOVER").length, 0, "no takeover while the peer ACKs");
  assert.equal(chat.events("BOT_OUTBOUND_SUBMIT_FAILED").length, 0);
  const versions = (await chat.history(REQUEST)).filter((h) => h.decoded?.messages);
  const carried = versions.map((v) => v.decoded.messages.map((m) => m.messageId));
  let lossless = true;
  for (let i = 1; i < carried.length; i += 1) {
    // A version either extends the previous (superset) or starts fresh after
    // an ACK freed the slot; it never drops an un-ACKed message.
    const previous = versions[i - 1];
    const previousAcked = previous.acks?.some((a) => a.by === "alice#1");
    if (!previousAcked && !carried[i - 1].every((id) => carried[i].includes(id))) lossless = false;
  }
  assert.ok(lossless, "an un-ACKed statement was replaced by one that did not carry its messages");
  for (const v of versions) assert.ok(v.acks?.some((a) => a.by === "alice#1" && a.code === "success"), `bot statement ${v.decoded.requestId} never ACKed by alice`);
  log(`${BURST} bridge sends → ${versions.length} statement version(s) in the slot, ${extended.length} lane extension(s), 0 takeovers, all ACKed`);
}
