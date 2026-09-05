// The device test client's case (bot-core/test-client-device.mjs, retired in
// S5): a batch that opens with an undecodable richText attachment and goes
// on with a good message — here a real photo. Invariant (CLAUDE.md): one
// undecodable message in a batch must not prevent decoding the rest, so
// the bot must skip the poison, ACK the batch, download the photo and
// answer its caption.
//
// The SDK extends an un-ACKed batch with the next message under a new
// request id; the node drops the bot's first ACK so the poison-only
// statement is still un-ACKed when the photo follows and both ride one
// statement, as they did in the device client's single submit.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bytesToHex } from "../lib/bytes.mjs";
import { poisonMessage } from "../lib/scenario.mjs";
import { PNG } from "./attachment-to-bot.mjs";

export const description = "an undecodable attachment next to a real photo in one batch: the poison is skipped, the photo downloaded, the batch ACKed";

export async function run({ sandbox, openChat, log }) {
  const chat = await openChat({ devices: 1 });
  const { bot } = chat;
  const REQUEST = "session alice#1→echobot /request";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-poison-"));
  const photo = path.join(dir, "photo.png");
  fs.writeFileSync(photo, PNG);
  try {
    await sandbox.post("/faults", { kind: "drop", from: "echobot", channel: "session echobot#1→alice /response", count: 1 });
    await sandbox.post("/personas/alice/rooms/echobot/messages", { raw: bytesToHex(poisonMessage()) });
    const sent = await sandbox.post("/personas/alice/rooms/echobot/messages", { file: photo, text: "after the poison" });
    const [ref] = sent.content.attachments;

    const undecodable = await bot.waitFor((e) => e.event === "BOT_UNDECODABLE_MESSAGES", { label: "BOT_UNDECODABLE_MESSAGES" });
    assert.equal(undecodable.count, 1);
    await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "BOT_MEDIA_DOWNLOADED" });
    await chat.answered("Echo: after the poison");
    await chat.delivered(sent.messageId);

    // The wire: one statement carried both; the poison undecodable, the photo decoded with its metadata; the bot ACKed it.
    const carrier = (await chat.history(REQUEST)).find((s) => s.decoded?.messages?.some((m) => m.messageId === sent.messageId));
    assert.ok(carrier, "the photo is on alice's session");
    assert.deepEqual(carrier.decoded.messages.map((m) => (m.undecodable ? "undecodable" : m.content.type)), ["undecodable", "richText"], "poison and photo ride one statement");
    assert.equal(carrier.decoded.messages[1].content.attachments[0].identifier, ref.identifier);
    assert.ok(carrier.acks.some((a) => a.by === "echobot" && a.code === "success"), "the batch was ACKed despite the poison");
    assert.equal((await sandbox.get("/faults")).length, 0, "the dropped-ACK fault was spent");

    assert.deepEqual(chat.events("BOT_RECEIVED_TEXT").map((e) => [e.kind, e.chars]), [["richText", "after the poison".length]], "one brain call, for the photo");
    assert.equal(chat.events("BOT_MEDIA_DOWNLOADED").length, 1);
    assert.equal(chat.events("BOT_MEDIA_DOWNLOAD_FAILED").length, 0);
    assert.equal(chat.events("BOT_SESSION_DECODE_FAILED").length, 0, "the batch itself decoded");
    assert.equal(chat.events("BOT_SENT_TEXT").length, 1);
    const pool = await sandbox.get("/hop");
    assert.ok(pool.entries.every((e) => e.claims === 1 && e.acked), "the photo's entries were claimed once and acked");
    log(`batch: ${carrier.decoded.messages.length} messages (1 undecodable), ${chat.events("BOT_UNDECODABLE_MESSAGES").length} undecodable event(s), 1 download, 1 answer`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
