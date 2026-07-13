import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadP2PFile, uploadP2PFile, validateHopUrl } from "../lib/hop-client.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { startMockHopNode } from "./mock-hop-node.mjs";

const nodes = [];
const startNode = async () => {
  const node = await startMockHopNode();
  nodes.push(node);
  return node;
};
after(async () => { for (const n of nodes) await n.close(); });

const download = (node, file, extra = {}) =>
  downloadP2PFile({
    wssUrl: file.wssUrl,
    identifier: file.identifier,
    claimTicket: file.claimTicket,
    allowInsecure: true, // mock node is plain ws on loopback
    ...extra,
  });

const uploadSender = deriveSr25519PairFromSeed(new Uint8Array(32).fill(3), "//allowance//bulletin//chat");
const upload = (node, filePath, extra = {}) =>
  uploadP2PFile({
    filePath,
    wssUrl: node.url,
    sender: uploadSender,
    allowInsecure: true,
    ...extra,
  });

const temporaryFile = (bytes) => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hop-upload-test-")), "file.bin");
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
  return filePath;
};

const compactLength = (value) => {
  if (value < 64) return Uint8Array.of(value << 2);
  if (value < 16_384) {
    const encoded = (value << 2) | 1;
    return Uint8Array.of(encoded & 0xff, encoded >> 8);
  }
  const encoded = (value << 2) | 2;
  return Uint8Array.of(encoded & 0xff, (encoded >> 8) & 0xff, (encoded >> 16) & 0xff, (encoded >> 24) & 0xff);
};

const u64le = (value) => {
  const out = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

test("happy path: multi-chunk file round-trips byte-exact and gets acked", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(5_000_000)); // 3 chunks
  const file = node.putFile(original);
  const got = await download(node, file);
  assert.equal(Buffer.compare(got, original), 0);
  // metadata + all chunks acknowledged
  assert.equal(node.acked.size, 4);
});

test("upload signs, encrypts, and publishes a file the recipient can claim", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(4_000_123));
  const filePath = temporaryFile(original);
  try {
    const uploaded = await upload(node, filePath);
    const got = await download(node, uploaded);
    assert.equal(Buffer.compare(got, original), 0);
    assert.equal(node.submissions.length, 4, "three chunks plus metadata expected");
    assert.equal(node.submissions[0].signer, `0x${Buffer.from(uploadSender.publicKey).toString("hex")}`);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

test("upload rejects a source that exceeds its configured cap", async () => {
  const node = await startNode();
  const filePath = temporaryFile(new Uint8Array(64));
  try {
    await assert.rejects(() => upload(node, filePath, { maxBytes: 32 }), /exceeds upload cap/);
    assert.equal(node.submissions.length, 0);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
});

test("tampered ciphertext fails the chunk hash check", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(crypto.randomBytes(100_000)), { tamperChunk: true });
  await assert.rejects(() => download(node, file), /hash mismatch/);
});

test("tampered ciphertext with matching hash fails GCM auth", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(crypto.randomBytes(100_000)), { tamperChunk: true, rehashTamper: true });
  await assert.rejects(() => download(node, file), /unable to authenticate|Unsupported state/i);
});

test("metadata claiming a size over the cap aborts before any chunk", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(crypto.randomBytes(100_000)), { totalSizeOverride: 64 * 1024 * 1024 });
  await assert.rejects(() => download(node, file), /larger than cap/);
  assert.equal(node.acked.size, 0);
});

test("metadata under-declaring the size aborts mid-download", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(crypto.randomBytes(100_000)), { totalSizeOverride: 10 });
  await assert.rejects(() => download(node, file), /exceeds declared size/);
});

test("oversized metadata chunk lists are rejected before chunk iteration", async () => {
  const node = await startNode();
  const metadata = concat(u64le(1), compactLength(100_000));
  const file = node.putFile(new Uint8Array(0), { metadataOverride: metadata });
  await assert.rejects(() => download(node, file), /chunk list exceeds limit/);
  // Metadata is not ACKed until its structure passes validation, and no bogus
  // chunk hash is ever claimed.
  assert.equal(node.acked.size, 0);
});

test("ws:// is rejected unless explicitly allowed", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(16));
  await assert.rejects(() => download(node, file, { allowInsecure: false }), /must be wss/);
});

test("allowlist rejects hosts outside it", () => {
  assert.throws(() => validateHopUrl("wss://hop.polkadot.io"), /must name trusted HOP hosts/);
  assert.throws(() => validateHopUrl("wss://evil.example", { allowedNodes: ["hop.polkadot.io"] }), /not in BOT_HOP_ALLOWED_NODES/);
  assert.ok(validateHopUrl("wss://a.hop.polkadot.io", { allowedNodes: ["hop.polkadot.io"] }));
  assert.throws(() => validateHopUrl("wss://user:pw@hop.polkadot.io"), /credentials/);
  assert.throws(() => validateHopUrl("wss://10.0.0.1/x"), /hostname/);
});

test("hostile RPC frames are rejected before JSON parsing", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(16));
  node.failures.oversizedFrameBytes = 8 * 1024;
  await assert.rejects(() => download(node, file, { maxRpcFrameBytes: 1024 }), /frame exceeds 1024 bytes/);
});

test("ack failures never fail the download", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(50_000));
  const file = node.putFile(original);
  node.failures.ack = true;
  const got = await download(node, file);
  assert.equal(Buffer.compare(got, original), 0);
});

test("a dropped connection resumes once and completes", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(3_000_000)); // 2 chunks
  const file = node.putFile(original);
  node.failures.dropConnections = 1;
  const got = await download(node, file);
  assert.equal(Buffer.compare(got, original), 0);
});
