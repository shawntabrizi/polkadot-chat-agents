import { after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import { createT3amsMedia } from "../../transports/t3ams/t3ams-media.mjs";
import { parseT3amsHopReference } from "../../transports/t3ams/t3ams-attachments.mjs";
import { deriveT3amsBulletinUploadSignerFromSeed } from "../../transports/t3ams/t3ams-identity.mjs";
import { deriveSr25519PairFromSeed } from "../../vendor/lib/wallet-keys.mjs";
import { startMockHopNode } from "./mock-hop-node.mjs";

const nodes = [];
const startNode = async () => {
  const node = await startMockHopNode();
  nodes.push(node);
  return node;
};
after(async () => { for (const node of nodes) await node.close(); });

const blake2b256 = (bytes) => Buffer.from(blake2b(bytes, { dkLen: 32 })).toString("hex");
const botSeed = new Uint8Array(32).fill(9);
const uploadSigner = deriveT3amsBulletinUploadSignerFromSeed(botSeed);
const walletSigner = deriveSr25519PairFromSeed(botSeed, "//wallet");

test("T3ams media uploads through positional HOP RPC and fetches BLAKE2b-256-verified bytes", async () => {
  const node = await startNode();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3ams-media-test-"));
  try {
    const source = path.join(root, "evidence.pdf");
    const original = Buffer.concat([
      Buffer.from("%PDF-1.7\n% deterministic T3ams media fixture\n", "utf8"),
      crypto.randomBytes(192 * 1024),
    ]);
    fs.writeFileSync(source, original, { mode: 0o600 });
    let arid = 0;
    const bcts = {
      generateARID: () => Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? ++arid : 0)),
    };
    const logs = [];
    const media = createT3amsMedia({
      bcts,
      bulletinUrl: node.url,
      uploadSigner,
      dir: path.join(root, "cache"),
      allowInsecure: true,
      maxTotalMb: 8,
      log: (event, data) => logs.push({ event, data }),
    });

    const { ref, attachment } = await media.upload({
      filePath: source,
      mime: "application/pdf",
      filename: "evidence.pdf",
    });
    const expectedHash = blake2b256(original);
    const hop = parseT3amsHopReference(ref.storageUrl);
    assert.equal(Buffer.from(ref.hash).toString("hex"), expectedHash);
    assert.equal(attachment.contentHashHex, expectedHash);
    assert.equal(attachment.hopId, hop.hopId);
    assert.equal(attachment.claimTicketHex, hop.claimTicketHex);
    assert.equal(attachment.mime, "application/pdf");
    assert.equal(attachment.filename, "evidence.pdf");

    const progress = [];
    const [downloaded] = await media.fetchAttachments([attachment], {
      onStart: (item) => progress.push(`start:${item.filename}`),
      onSuccess: (item) => progress.push(`success:${item.filename}`),
      onError: (item) => progress.push(`error:${item.filename}`),
    });
    assert.equal(downloaded, attachment);
    assert.equal(attachment.downloaded, true);
    assert.equal(typeof attachment.path, "string");
    assert.deepEqual(progress, ["start:evidence.pdf", "success:evidence.pdf"]);
    const recovered = fs.readFileSync(attachment.path);
    assert.deepEqual(recovered, original);
    assert.equal(blake2b256(recovered), expectedHash);
    assert.equal(media.findCached(attachment), attachment.path);

    // UI progress is best-effort. A failed status renderer must not turn an
    // otherwise cached attachment into a failed media transfer.
    const [observerFailure] = await media.fetchAttachments([{ ...attachment }], {
      onStart: () => { throw new Error("status renderer unavailable"); },
      onSuccess: () => { throw new Error("status renderer unavailable"); },
    });
    assert.equal(observerFailure.downloaded, true);
    assert.equal(typeof observerFailure.path, "string");
    assert.equal(logs.filter(({ event }) => event === "T3AMS_MEDIA_PROGRESS_CALLBACK_FAILED").length, 2);

    // The content hash participates in the cache key. A wrong BLAKE2b-256 must
    // trigger a fresh HOP claim and fail before the cache is populated.
    await assert.rejects(
      () => media.download({ ...attachment, contentHashHex: "00".repeat(32) }),
      /content hash mismatch/,
    );
    assert.equal(media.stats().inflight, 0);
    assert.ok(node.submissions.length >= 2, "one encrypted chunk and metadata were submitted");
    const expectedSigner = `0x${Buffer.from(uploadSigner.publicKey).toString("hex")}`;
    const walletSignerHex = `0x${Buffer.from(walletSigner.publicKey).toString("hex")}`;
    assert.notEqual(expectedSigner, walletSignerHex, "the dedicated Bulletin allowance signer must not be the bot wallet");
    assert.ok(node.submissions.every((submission) => submission.signer === expectedSigner), "T3ams media must sign uploads with the configured dedicated allowance signer");
    assert.ok(node.rpcCalls.length >= 6, "upload and both authenticated downloads reached the mock");
    assert.ok(node.rpcCalls.every((call) => call.positional), "T3ams uses positional Bulletin RPC parameters for every HOP call");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("T3ams media preserves safe video metadata in the emitted AttachmentRef", async () => {
  const node = await startNode();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3ams-media-video-test-"));
  try {
    const source = path.join(root, "walkthrough.mp4");
    fs.writeFileSync(source, crypto.randomBytes(32 * 1024), { mode: 0o600 });
    const media = createT3amsMedia({
      bcts: { generateARID: () => new Uint8Array(32) },
      bulletinUrl: node.url,
      uploadSigner,
      dir: path.join(root, "cache"),
      allowInsecure: true,
      maxTotalMb: 8,
    });
    const { ref, attachment } = await media.upload({
      filePath: source,
      mime: "video/mp4",
      filename: "walkthrough.mp4",
      width: 1280,
      height: 720,
      durationMs: 45_000,
    });
    assert.equal(ref.width, 1280);
    assert.equal(ref.height, 720);
    assert.equal(ref.durationMs, 45_000);
    assert.equal(attachment.kind, "video");
    assert.equal(attachment.durationMs, 45_000);
    const hop = parseT3amsHopReference(ref.storageUrl);
    assert.equal(hop.width, 1280);
    assert.equal(hop.height, 720);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
