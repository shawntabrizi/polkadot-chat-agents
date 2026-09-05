// protocol.md "Attachments": a download failure becomes a note to the brain,
// never a dropped message, and the peer's HOP node is hostile input with
// per-chunk integrity checks. The sandbox's HOP node misbehaves four ways
// against a bot whose brain is a mock CLI that answers with its prompt, so
// the note the brain got is readable in alice's inbox:
//
//   cut     the socket dies mid-claim   → bot-core reconnects and resumes once (HOP_RETRY), the download completes
//   refuse  RateLimited once            → the spec says retry later; bot-core retries once, the download completes
//   refuse  RateLimited twice           → one retry is the policy: the download fails, the brain gets the note
//   corrupt served bytes are wrong      → the chunk hash check fails at once, no retry (integrity is final)
//   drop    the entry is gone           → NotFound is final too
//
// After every failure the bot is still alive: the message was ACKed and
// answered, and the next one is too.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PNG } from "./attachment-to-bot.mjs";

export const description = "HOP faults: a cut or rate-limited claim is retried once; corrupt bytes, a gone entry or a second refusal fail into a brain note, the message is never dropped";

// A claude-shaped CLI that answers with the prompt it was given: the
// attachment note bot-core rendered for the brain is then in the reply.
const brain = {
  BOT_AI_CMD: process.execPath,
  BOT_AI_ARGS: JSON.stringify(["-e", "process.stdout.write(JSON.stringify({ type: 'result', result: `PROMPT ${process.argv[1]}` }) + '\\n')", "__PROMPT__"]),
  BOT_THINKING_TEXT: "",
};

export async function run({ sandbox, openChat, log }) {
  const chat = await openChat({ devices: 1, brain: "claude", env: brain });
  const { bot } = chat;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-faults-"));
  const photo = path.join(dir, "photo.png");
  fs.writeFileSync(photo, PNG);
  // The brain answers with its prompt, which carries the caption ("User message:\n<caption> [note]"): the reply to one message is the one naming its caption.
  const replied = (caption) => sandbox.waitFor(async () => (await chat.inbox()).messages.find((m) => m.direction === "incoming" && typeof m.content.text === "string" && m.content.text.startsWith("PROMPT") && m.content.text.includes(`\n${caption} `)) ?? null, { label: `the reply to "${caption}"`, timeoutMs: 30_000 });
  const send = (text) => sandbox.post("/personas/alice/rooms/echobot/messages", { file: photo, text });
  const counts = () => ({ ok: chat.events("BOT_MEDIA_DOWNLOADED").length, failed: chat.events("BOT_MEDIA_DOWNLOAD_FAILED").length, retries: chat.events("HOP_RETRY").length });
  try {
    // 1. cut: the socket dies on the first claim; the retry reconnects and resumes.
    await sandbox.post("/hop/faults", { kind: "cut", count: 1 });
    const cut = await send("cut");
    const retry = await bot.waitFor((e) => e.event === "HOP_RETRY", { label: "HOP_RETRY after the cut" });
    assert.match(retry.error, /connection (closed|error)/);
    await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "download after the cut" });
    assert.match((await replied("cut")).content.text, /User sent a photo saved at \S+ \(image\/png, 1 KB\)/, "the brain got the staged file");
    await chat.delivered(cut.messageId);
    assert.deepEqual(counts(), { ok: 1, failed: 0, retries: 1 });

    // 2. refuse once: RateLimited is "retry later" in the spec; bot-core retries once and completes.
    await sandbox.post("/hop/faults", { kind: "refuse", count: 1 });
    const limited = await send("rate limited once");
    await bot.waitFor((e) => e.event === "HOP_RETRY" && /1020/.test(e.error), { label: "HOP_RETRY after RateLimited" });
    await sandbox.waitFor(() => counts().ok === 2, { label: "download after the rate limit" });
    assert.match((await replied("rate limited once")).content.text, /User sent a photo saved at/);
    await chat.delivered(limited.messageId);
    assert.deepEqual(counts(), { ok: 2, failed: 0, retries: 2 });

    // 3. refuse twice: one retry is the policy, so this one fails — into a note, not a dropped message.
    await sandbox.post("/hop/faults", { kind: "refuse", count: 2 });
    const twice = await send("rate limited twice");
    const failed = await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOAD_FAILED", { label: "BOT_MEDIA_DOWNLOAD_FAILED" });
    assert.match(failed.error, /HOP 1020/);
    assert.match((await replied("rate limited twice")).content.text, /User sent a photo \(image\/png, 1 KB\) — download failed: HOP 1020/, "the failure reached the brain as a note");
    await chat.delivered(twice.messageId);
    assert.deepEqual(counts(), { ok: 2, failed: 1, retries: 3 });

    // 4. corrupt: the served bytes do not hash to the entry; integrity failures never retry.
    await sandbox.post("/hop/faults", { kind: "corrupt", count: 1 });
    const corrupt = await send("corrupt chunk");
    await sandbox.waitFor(() => counts().failed === 2, { label: "the corrupt chunk failed" });
    assert.match(chat.events("BOT_MEDIA_DOWNLOAD_FAILED")[1].error, /hash mismatch/);
    assert.match((await replied("corrupt chunk")).content.text, /download failed: HOP (metadata|chunk) hash mismatch/);
    await chat.delivered(corrupt.messageId);
    assert.deepEqual(counts(), { ok: 2, failed: 2, retries: 3 }, "no retry for an integrity failure");

    // 5. drop: the node says the entry is gone (expired, or acked by another device); final.
    await sandbox.post("/hop/faults", { kind: "drop", count: 1 });
    const gone = await send("dropped chunk");
    await sandbox.waitFor(() => counts().failed === 3, { label: "the dropped entry failed" });
    assert.match(chat.events("BOT_MEDIA_DOWNLOAD_FAILED")[2].error, /HOP 1004/);
    assert.match((await replied("dropped chunk")).content.text, /download failed: HOP 1004/);
    await chat.delivered(gone.messageId);
    assert.deepEqual(counts(), { ok: 2, failed: 3, retries: 3 });
    assert.equal((await sandbox.get("/hop")).faults.length, 0, "every fault was spent");

    // The bot is fine: a plain text after all that is answered, and every one of alice's messages was ACKed.
    const after = await sandbox.post("/personas/alice/rooms/echobot/messages", { text: "still there?" });
    await sandbox.waitFor(async () => (await chat.inbox()).messages.some((m) => m.direction === "incoming" && m.content.text?.includes("\nstill there?")), { label: "the reply to the plain text" });
    await chat.delivered(after.messageId);
    const inbox = await chat.inbox();
    for (const m of inbox.messages.filter((x) => x.direction === "outgoing")) assert.equal(m.status, "delivered", `${m.messageId} was not ACKed`);
    assert.equal(chat.events("BOT_RECEIVED_TEXT").length, 6, "every message reached the brain path once");
    assert.equal(chat.events("BOT_SENT_TEXT").length, 6, "and was answered once");
    assert.ok(bot.events.every((e) => e.event !== "BOT_REPLY_FAILED" && e.event !== "BOT_AI_FAILED"), "no failed turn");
    log(`downloads ok ${counts().ok}, failed ${counts().failed}, retries ${counts().retries}; 6 messages, 6 answers, all ACKed`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
