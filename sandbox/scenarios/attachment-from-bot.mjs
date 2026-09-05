// docs/guide/files.md: a user keeps a file with the chat (`/file put`) and
// asks for it back (`/file get`); the bot uploads it through its operator-
// pinned HOP node, signed by its Bulletin allowance account, and sends the
// reference. alice has two devices: the first device that decodes the
// message claims the one-shot HOP entry and holds the bytes; the second
// records the reference and shows "claimed by device N" — the desktop's
// placeholder — and never claims.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const description = "the bot returns a saved file: alice's first device claims it, the second shows the placeholder";

export async function run({ sandbox, openChat, bot: bots, log }) {
  const chat = await openChat({ devices: 2 });
  const { bot, cfg, persona } = chat;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-file-"));
  const notes = path.join(dir, "notes.txt");
  const TEXT = "keep this with the chat\n";
  fs.writeFileSync(notes, TEXT);
  try {
    assert.equal(cfg.hopUrl, sandbox.daemon.hopUrl, "pca saved the sandbox HOP node as the bot's upload node");
    assert.equal(sandbox.daemon.hop.allowances.has(cfg.bulletinAccount), true, "and registered its upload signer for the Bulletin allowance");
    assert.ok(bot.events.some((e) => e.event === "BOT_HOP_UPLOAD_CONFIGURED" && e.account === cfg.bulletinAccount), "the bot runs with the upload node configured");

    // /file put: the attachment goes into the bot's durable vault for this chat.
    const put = await sandbox.post("/personas/alice/rooms/echobot/messages", { file: notes, text: "/file put notes.txt" });
    const saved = await bot.waitFor((e) => e.event === "BOT_FILE_SAVED" && e.path === "notes.txt", { label: "BOT_FILE_SAVED" });
    assert.equal(saved.bytes, TEXT.length);
    await chat.delivered(put.messageId);
    const confirm = await sandbox.waitFor(async () => (await chat.inbox()).messages.find((m) => m.direction === "incoming" && m.content.text?.startsWith("Saved notes.txt")), { label: "the /file put confirmation" });
    assert.match(confirm.content.text, /Saved notes\.txt \(24 B\)/);
    assert.equal(chat.events("BOT_SENT_TEXT").length, 1, "the file command never reached the brain");

    // /file get: the bot uploads the vault file and sends the reference.
    const get = await sandbox.post("/personas/alice/rooms/echobot/messages", { text: "/file get notes.txt", device: 2 });
    const uploaded = await bot.waitFor((e) => e.event === "HOP_UPLOADED", { label: "HOP_UPLOADED" });
    assert.deepEqual([uploaded.bytes, uploaded.chunks], [TEXT.length, 1]);
    const delivered = await bot.waitFor((e) => e.event === "BOT_FILE_DELIVERED", { label: "BOT_FILE_DELIVERED" });
    assert.equal(delivered.path, "notes.txt");
    await chat.delivered(get.messageId);

    // alice: the rich text on both devices; exactly one claimed, the other a placeholder.
    const row = await sandbox.waitFor(async () => {
      const m = (await chat.inbox()).messages.find((x) => x.direction === "incoming" && x.content.type === "richText");
      return m && m.receivedBy.length === 2 && m.content.attachments[0].status === "claimed" ? m : null;
    }, { label: "the returned file on both devices, claimed" });
    const [a] = row.content.attachments;
    // bot-core stamps the node as `new URL(...).toString()`: a trailing slash the allowlist (a host match) never sees.
    const hopUrl = new URL(cfg.hopUrl).toString();
    assert.deepEqual([row.content.text, a.kind, a.mimeType, a.fileSize, a.wssUrl], ["notes.txt", "general", "text/plain", TEXT.length, hopUrl]);
    assert.ok([1, 2].includes(a.claimedBy));
    const other = a.claimedBy === 1 ? 2 : 1;
    assert.deepEqual(row.receivedBy.sort(), [1, 2]);
    assert.deepEqual(row.ackedBy.sort(), [1, 2], "both devices ACKed the bot's statement");
    const asOther = (await sandbox.get(`/personas/alice/rooms/echobot?device=${other}`)).messages.find((m) => m.messageId === row.messageId);
    assert.equal(asOther.content.attachments[0].claimedBy, a.claimedBy, `device ${other} shows: claimed by device ${a.claimedBy}`);
    const html = await (await fetch(`${sandbox.url}/api/personas/alice/rooms/echobot?format=html&device=${other}`)).text();
    assert.ok(html.includes(`claimed by device ${a.claimedBy}</p>`), "the placeholder in the room page for the other device");
    const mine = await (await fetch(`${sandbox.url}/api/personas/alice/rooms/echobot?format=html&device=${a.claimedBy}`)).text();
    assert.ok(mine.includes(`<a href="../media/${a.mediaId}" download>`), "a download link on the device that claimed");
    const bytes = await (await fetch(`${sandbox.url}/api/personas/alice/media/${a.mediaId}`)).text();
    assert.equal(bytes, TEXT, "the bytes alice holds are the file she saved");

    // The pool: the bot's two entries, signed by its Bulletin account, claimed exactly once (one device), acked, gone.
    const pool = await sandbox.get("/hop");
    const botEntries = pool.entries.filter((e) => e.signer === cfg.bulletinAccount);
    assert.equal(botEntries.length, 2, "one chunk and the metadata from the bot");
    assert.ok(botEntries.every((e) => e.signerLabel === "echobot" && e.claims === 1 && e.acked && !e.available), `claimed once and acked: ${JSON.stringify(botEntries)}`);
    assert.deepEqual(botEntries.map((e) => e.role).sort(), ["chunk 1/1", "metadata"], "the claiming device learned the roles");
    assert.ok(botEntries.every((e) => e.owner === "alice ⇄ echobot"));

    // The wire: the bot's rich text on its device session, wrapped for both alice devices, metadata only.
    const carrier = (await chat.history("session echobot#1→alice /request")).find((s) => s.decoded?.messages?.some((m) => m.messageId === row.messageId));
    assert.ok(carrier, "the returned file rode the bot's session");
    assert.deepEqual(carrier.decoded.recipients.map((r) => r.label).sort(), ["alice#1", "alice#2"]);
    const wireRow = carrier.decoded.messages.find((m) => m.messageId === row.messageId);
    assert.deepEqual(wireRow.content.attachments, [{ kind: "general", mimeType: "text/plain", fileSize: TEXT.length, identifier: a.identifier, wssUrl: hopUrl }]);
    assert.ok(!JSON.stringify([carrier, pool, row]).match(/ticket/i));
    assert.ok(!JSON.stringify(bot.events).match(/ticket/i), "the bot never logs the ticket it generated");
    assert.deepEqual([persona.devices.length, chat.events("BOT_MEDIA_DOWNLOADED").length], [2, 1], "one download by the bot (the put), none for its own upload");
    log(`file returned: claimed on alice#${a.claimedBy}, placeholder on alice#${other}; pool entries by ${botEntries[0].signerLabel} claimed once`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
