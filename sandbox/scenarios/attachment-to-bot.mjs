// protocol.md "Attachments": the message carries a reference (identifier,
// claim ticket, node, meta); the bytes live on the HOP node. alice sends a
// photo with a caption to an echo bot through the sandbox's HOP node, the
// desktop's upload path. The bot must ACK the message, download the bytes
// exactly once (after the ACK, per-chunk integrity checked), serve them at
// its bridge /media route without the ticket, and answer the caption.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const description = "alice sends a photo with a caption: the bot ACKs, downloads once, serves it at /media, answers";

// A 1×1 PNG, so the image header (and the bot's fileKind) is real.
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export async function run({ sandbox, openChat, bot: bots, log }) {
  const chat = await openChat({ devices: 1 });
  const { bot } = chat;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-photo-"));
  const photo = path.join(dir, "photo.png");
  fs.writeFileSync(photo, PNG);
  try {
    const sent = await sandbox.post("/personas/alice/rooms/echobot/messages", { file: photo, text: "look at this" });
    const [ref] = sent.content.attachments;
    assert.deepEqual([ref.kind, ref.mimeType, ref.fileSize, ref.width, ref.height, ref.status], ["image", "image/png", PNG.length, 1, 1, "sent"]);
    const id = ref.identifier.slice(2); // bot-core's media id: the identifier hex without 0x

    // The bot: the rich text arrives, is ACKed, the bytes are fetched once, the caption is echoed.
    const received = await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.kind === "richText", { label: "BOT_RECEIVED_TEXT richText" });
    assert.equal(received.chars, "look at this".length);
    const downloaded = await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "BOT_MEDIA_DOWNLOADED" });
    assert.deepEqual([downloaded.id, downloaded.mime, downloaded.bytes], [id.slice(0, 16), "image/png", PNG.length]);
    await chat.answered("Echo: look at this");
    await chat.delivered(sent.messageId);
    assert.equal(chat.events("BOT_MEDIA_DOWNLOADED").length, 1, "downloaded exactly once");
    assert.equal(chat.events("BOT_MEDIA_DOWNLOAD_FAILED").length, 0);
    assert.equal(chat.events("HOP_RETRY").length, 0);
    assert.ok(!JSON.stringify(bot.events).match(/ticket/i), "the claim ticket never reaches the bot's log");

    // The HOP node: one chunk and the metadata, signed by alice, each claimed once and acked, the bytes gone.
    const pool = await sandbox.get("/hop");
    assert.deepEqual(pool.entries.map((e) => [e.signerLabel, e.role, e.owner, e.claims, e.acked, e.available]), [
      ["alice", "chunk 1/1", "alice ⇄ echobot", 1, true, false],
      ["alice", "metadata", "alice ⇄ echobot", 1, true, false],
    ]);
    assert.equal(pool.entries[1].hash, ref.identifier);
    log(`pool: ${pool.entries.length} entries, each claimed once by the bot and acked`);

    // The bridge serves the bytes byte-exact under the identifier.
    const served = await bots.bridge("echobot").get(`/media/${id}`);
    assert.deepEqual([served.status, served.type], [200, "image/png"]);
    assert.equal(Buffer.compare(served.bytes, PNG), 0, "the bridge serves what alice sent");
    assert.equal((await bots.bridge("echobot").get(`/media/${"ab".repeat(32)}`)).status, 404);
    const cached = fs.statSync(path.join(bots.botsDir, "echobot", "media", `${id}.png`));
    assert.equal(cached.mode & 0o777, 0o600, "the media cache file is private");

    // The wire: the rich text with the attachment's metadata (never the ticket), ACKed by the bot.
    const statements = await chat.history("session alice#1→echobot /request");
    const carrier = statements.find((s) => s.decoded?.messages?.some((m) => m.messageId === sent.messageId));
    assert.ok(carrier, "the rich text is on alice's session");
    const row = carrier.decoded.messages.find((m) => m.messageId === sent.messageId);
    assert.deepEqual(row.content, { type: "richText", text: "look at this", attachments: [{ kind: "image", mimeType: "image/png", fileSize: PNG.length, width: 1, height: 1, identifier: ref.identifier, wssUrl: sandbox.daemon.hopUrl }] });
    assert.ok(carrier.acks.some((a) => a.by === "echobot" && a.code === "success"), "the batch was ACKed");
    assert.ok(!JSON.stringify(statements).match(/ticket/i));

    // The same file again, no caption: a fresh ticket and identifier (the
    // metadata blob is encrypted under a new key), so a second download; the
    // bot synthesizes the placeholder text and echoes that.
    const plain = await sandbox.post("/personas/alice/rooms/echobot/messages", { file: photo });
    assert.equal(plain.content.text, null);
    assert.notEqual(plain.content.attachments[0].identifier, ref.identifier);
    await chat.answered("Echo: [photo, image/png, 1 KB]");
    assert.equal(chat.events("BOT_MEDIA_DOWNLOADED").length, 2);
    assert.equal(chat.events("BOT_SENT_TEXT").length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
