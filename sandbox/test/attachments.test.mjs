// Attachments between personas over the real daemon: alice sends a PNG
// with a caption to bob (two devices). The bytes go through the HOP node
// (encrypt, chunk, signed hop_submit) and the message carries only the
// reference; exactly one of bob's devices claims (the HOP claim is
// one-shot), the other shows the placeholder; both sides serve the bytes
// from their own media dir; the wire and the pool show the metadata and
// never the ticket; a corrupt chunk fails loudly on the row.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDaemon } from "../daemon.mjs";
import { waitFor } from "./helpers.mjs";

// A 1×1 PNG: enough for the image header to be read.
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const call = async (url, method, route, body) => {
  const res = await fetch(`${url}/api${route}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${json.error}`);
  return json;
};

test("alice sends a photo to bob (2 devices): one claim, one placeholder, bytes served, the pool and the wire show metadata only", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-attach-"));
  const daemon = await startDaemon({ dir, port: 0 });
  t.after(async () => { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const get = (route) => call(daemon.url, "GET", route);
  const post = (route, body) => call(daemon.url, "POST", route, body);
  const photo = path.join(dir, "photo.png");
  fs.writeFileSync(photo, PNG);

  const alice = await post("/personas", { name: "alice", devices: 1 });
  const bob = await post("/personas", { name: "bob", devices: 2 });
  assert.match(alice.bulletinAccount, /^0x[0-9a-f]{64}$/, "the persona's upload signer is public");
  assert.equal(daemon.hop.allowances.has(alice.bulletinAccount), true, "and holds the Bulletin allowance");
  const { requestId } = await post("/personas/alice/requests", { to: "bob" });
  await waitFor(async () => (await get("/personas/bob/requests")).length === 1);
  await post(`/personas/bob/requests/${requestId}/accept`, {});
  await waitFor(async () => (await get("/personas/alice")).contacts[0]?.devices.length === 2);

  // The send: upload, then a rich text with the reference. The row holds the public reference and no ticket.
  const sent = await post("/personas/alice/rooms/bob/messages", { file: photo, text: "look" });
  assert.deepEqual([sent.content.type, sent.content.text, sent.status], ["richText", "look", "sent"]);
  const [ref] = sent.content.attachments;
  assert.deepEqual([ref.kind, ref.mimeType, ref.fileSize, ref.width, ref.height, ref.status, ref.wssUrl], ["image", "image/png", PNG.length, 1, 1, "sent", daemon.hopUrl]);
  assert.match(ref.identifier, /^0x[0-9a-f]{64}$/);
  assert.equal(ref.chunks.length, 1);
  assert.equal(ref.mediaId, ref.identifier.slice(2));
  assert.ok(!JSON.stringify(sent).match(/ticket/i), "no claim ticket in the API's row");
  await assert.rejects(post("/personas/alice/rooms/bob/messages", { file: "photo.png" }), /absolute path/);
  await assert.rejects(post("/personas/alice/rooms/bob/messages", { file: path.join(dir, "missing.png") }), /ENOENT/);

  // bob: exactly one device claimed, the other sees "claimed by device N".
  const onBob = await waitFor(async () => {
    const m = (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === sent.messageId);
    return m?.content.attachments[0].status === "claimed" ? m : null;
  }, { attempts: 800 });
  const [got] = onBob.content.attachments;
  assert.ok([1, 2].includes(got.claimedBy), "claimed on one of bob's devices");
  assert.deepEqual([got.kind, got.mimeType, got.fileSize, got.width, got.height, got.identifier, got.mediaId, got.error], ["image", "image/png", PNG.length, 1, 1, ref.identifier, ref.mediaId, null]);
  await waitFor(async () => (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === sent.messageId).receivedBy.length === 2);
  const other = got.claimedBy === 1 ? 2 : 1;
  const onOther = (await get(`/personas/bob/rooms/alice?device=${other}`)).messages.find((x) => x.messageId === sent.messageId);
  assert.equal(onOther.content.attachments[0].claimedBy, got.claimedBy, `device ${other} shows the placeholder: claimed by device ${got.claimedBy}`);
  await waitFor(async () => (await get("/personas/alice/rooms/bob")).messages.find((x) => x.messageId === sent.messageId).status === "delivered");

  // Both sides serve the bytes from their own media dir, 0600, and nothing else.
  for (const who of ["alice", "bob"]) {
    const res = await fetch(`${daemon.url}/api/personas/${who}/media/${ref.mediaId}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(Buffer.compare(Buffer.from(await res.arrayBuffer()), PNG), 0, `${who} serves the photo byte-exact`);
    const file = path.join(dir, "personas", who, "media", `${ref.mediaId}.png`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${who}'s media file is private`);
  }
  assert.equal((await fetch(`${daemon.url}/api/personas/bob/media/${"ab".repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${daemon.url}/api/personas/bob/media/../../daemon.json`)).status, 404, "the id regex is the path guard");

  // The pool: two entries (chunk, metadata) signed by alice, claimed once, acked, gone; labelled by role and conversation.
  const pool = await get("/hop");
  assert.equal(pool.entries.length, 2);
  assert.deepEqual(pool.entries.map((e) => [e.signerLabel, e.role, e.owner, e.claims, e.acked, e.available]), [
    ["alice", "chunk 1/1", "alice ⇄ bob", 1, true, false],
    ["alice", "metadata", "alice ⇄ bob", 1, true, false],
  ]);
  assert.equal(pool.entries[1].hash, ref.identifier);
  assert.equal(pool.entries[0].hash, ref.chunks[0]);
  assert.ok(pool.entries.every((e) => e.messageId === sent.messageId));

  // The wire: the rich text decodes to its caption and the attachment's metadata, no ticket anywhere.
  const wire = (await get("/wire?peer=alice")).statements;
  const row = wire.flatMap((s) => s.decoded?.messages ?? []).find((m) => m.messageId === sent.messageId);
  assert.ok(row, "the rich text is on the wire");
  assert.deepEqual(row.content, { type: "richText", text: "look", attachments: [{ kind: "image", mimeType: "image/png", fileSize: PNG.length, width: 1, height: 1, identifier: ref.identifier, wssUrl: daemon.hopUrl }] });
  assert.ok(!JSON.stringify(wire).match(/ticket/i));
  const events = new TextDecoder().decode((await (await fetch(`${daemon.url}/api/events?since=0`)).body.getReader().read()).value);
  assert.ok(events.includes("event: hop\n") && events.includes('"event":"claimed"'), "pool events are in the stream");
  assert.ok(!/ticket/i.test(events));

  // The html route shows the image inline from the media route, and the placeholder on the other device.
  const html = await (await fetch(`${daemon.url}/api/personas/bob/rooms/alice?format=html`)).text();
  assert.ok(html.includes(`<img src="../media/${ref.mediaId}" alt="image image/png ${PNG.length} bytes" width="1" height="1">`), "an <img> from the daemon's own media route");
  const htmlOther = await (await fetch(`${daemon.url}/api/personas/bob/rooms/alice?format=html&device=${other}`)).text();
  assert.ok(!htmlOther.includes("<img"), `device ${other} did not claim: no image`);
  assert.ok(htmlOther.includes(`claimed by device ${got.claimedBy}</p>`), "the sibling device renders the placeholder");
  const htmlClaimer = await (await fetch(`${daemon.url}/api/personas/bob/rooms/alice?format=html&device=${got.claimedBy}`)).text();
  assert.ok(htmlClaimer.includes(`<img src="../media/${ref.mediaId}"`), "the claiming device renders the image");

  // A fault: the next chunk claim serves corrupt bytes. The row fails with the reason and the message still arrived.
  await post("/hop/faults", { kind: "corrupt", count: 1 });
  const second = await post("/personas/alice/rooms/bob/messages", { file: photo, text: null });
  const failed = await waitFor(async () => {
    const m = (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === second.messageId);
    return m?.content.attachments[0].status === "failed" ? m : null;
  }, { attempts: 800 });
  assert.match(failed.content.attachments[0].error, /hash mismatch/);
  assert.equal(failed.content.text, null);
  assert.equal((await get("/hop")).faults.length, 0, "the count-1 fault is spent");
  const secondRef = second.content.attachments[0];
  assert.equal((await fetch(`${daemon.url}/api/personas/bob/media/${secondRef.mediaId}`)).status, 404, "nothing was saved for the failed claim");
  await waitFor(async () => (await get("/personas/alice/rooms/bob")).messages.find((x) => x.messageId === second.messageId).status === "delivered");
  // A file over the cap never leaves the sender.
  const huge = path.join(dir, "huge.bin");
  fs.writeFileSync(huge, Buffer.alloc(32 * 1024 * 1024 + 1));
  await assert.rejects(post("/personas/alice/rooms/bob/messages", { file: huge }), /attachment cap/);
});
