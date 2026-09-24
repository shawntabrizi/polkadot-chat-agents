import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOP_MIN_RATE_BYTES_PER_SEC, downloadP2PFile, hopTimeoutFor, uploadP2PFile, validateHopUrl } from "../lib/hop-client.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { startHopNode } from "../../sandbox/lib/hop-node.mjs";

const nodes = [];
const startNode = async () => {
  const node = await startHopNode();
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

test("tampered ciphertext with matching hash fails ChaCha20-Poly1305 auth", async () => {
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
  node.faults.bloat({ bytes: 8 * 1024 });
  await assert.rejects(() => download(node, file, { maxRpcFrameBytes: 1024 }), /frame exceeds 1024 bytes/);
});

test("ack failures never fail the download", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(50_000));
  const file = node.putFile(original);
  node.faults.refuse({ method: "ack", count: null });
  const got = await download(node, file);
  assert.equal(Buffer.compare(got, original), 0);
});

test("a dropped connection resumes once and completes", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(3_000_000)); // 2 chunks
  const file = node.putFile(original);
  node.faults.cut({ count: 1 });
  const got = await download(node, file);
  assert.equal(Buffer.compare(got, original), 0);
});

// The spec's RateLimited (1020) and PoolFull (1002) mean "retry later": one
// retry, like a dropped connection. NotFound and the other refusals are final.
test("a rate-limited claim is retried once; a second refusal or a final refusal fails", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(50_000));
  const file = node.putFile(original);
  node.faults.refuse({ count: 1 });
  const retries = [];
  const got = await download(node, file, { log: (event, data) => { if (event === "HOP_RETRY") retries.push(data.error); } });
  assert.equal(Buffer.compare(got, original), 0);
  assert.equal(retries.length, 1);
  assert.match(retries[0], /HOP 1020/);

  const second = node.putFile(original);
  node.faults.refuse({ count: 2 });
  await assert.rejects(() => download(node, second), /HOP 1020/, "one retry is the policy");

  const third = node.putFile(original);
  node.faults.drop({ count: 1 });
  await assert.rejects(() => download(node, third), /HOP 1004/, "NotFound is final: no retry");
  assert.equal(node.faults.list().length, 0, "the drop fault was hit exactly once");
});

// Spec 0013 HopDialect `legacy` is the phone apps' format: ChaCha20-Poly1305
// and the chat RFC 0001 root envelope V1(Inline | Chunked). A phone decodes
// only that envelope, so a chat send must use it; t3ams keeps the plain root.
const rootEvents = () => {
  const events = [];
  return { events, log: (event, data) => events.push({ event, ...data }) };
};

test("upload: a small file sits inline in the phones' envelope, one entry; a large one is chunked in it", async () => {
  const node = await startNode();
  const small = new Uint8Array(crypto.randomBytes(1_500_000));
  const up = await uploadP2PFile({ bytes: small, wssUrl: node.url, sender: uploadSender, allowInsecure: true });
  assert.equal(node.submissions.length, 1, "inline: the root entry is the whole file");
  const seen = rootEvents();
  assert.equal(Buffer.compare(await download(node, up, { log: seen.log }), small), 0);
  assert.equal(seen.events.find((e) => e.event === "HOP_DOWNLOADED").layout, "versioned");

  const large = new Uint8Array(crypto.randomBytes(2_500_000));
  const up2 = await uploadP2PFile({ bytes: large, wssUrl: node.url, sender: uploadSender, allowInsecure: true });
  assert.equal(node.submissions.length, 1 + 3, "two chunks and the root");
  const seen2 = rootEvents();
  assert.equal(Buffer.compare(await download(node, up2, { log: seen2.log }), large), 0);
  assert.equal(seen2.events.find((e) => e.event === "HOP_DOWNLOADED").layout, "versioned");
});

test("upload: layout plain keeps the base-spec root (t3ams)", async () => {
  const node = await startNode();
  const bytes = new Uint8Array(crypto.randomBytes(10_000));
  const up = await uploadP2PFile({ bytes, wssUrl: node.url, sender: uploadSender, allowInsecure: true, layout: "plain" });
  assert.equal(node.submissions.length, 2, "one chunk and the root: plain has no inline form");
  const seen = rootEvents();
  assert.equal(Buffer.compare(await download(node, up, { log: seen.log }), bytes), 0);
  assert.equal(seen.events.find((e) => e.event === "HOP_DOWNLOADED").layout, "plain");
});

test("download: a phone's inline root (00 00 + bytes) decodes; an envelope over the cap is refused before any chunk", async () => {
  const node = await startNode();
  const photo = new Uint8Array(crypto.randomBytes(300));
  const inline = node.putFile(new Uint8Array(0), { metadataOverride: concat(Uint8Array.of(0, 0), compactLength(photo.length), photo) });
  assert.equal(Buffer.compare(await download(node, inline), photo), 0);
  const tooBig = node.putFile(new Uint8Array(0), { metadataOverride: concat(Uint8Array.of(0, 1), u64le(64 * 1024 * 1024), compactLength(0)) });
  await assert.rejects(() => download(node, tooBig), /larger than cap/);
});

test("download timeouts scale with the bytes: 2 MB at the devnet node's rate is not a timeout", async () => {
  // decisions.md "HOP receive": bullet.sik.rocks sent 2 MB in 33 s; the old
  // fixed 30 s claim timeout failed there on every full chunk.
  assert.ok(hopTimeoutFor(2_000_000, 30_000) >= 120_000);
  assert.ok(2_000_000 / 60_000 * 1000 < hopTimeoutFor(2_000_000, 30_000), "the measured 60 KB/s fits");
  assert.equal(hopTimeoutFor(1_000, 30_000), 30_000, "the floor holds for small entries");
  assert.equal(HOP_MIN_RATE_BYTES_PER_SEC, 16_000);
  // Live: a claim slower than the floor passes when the bytes allow it...
  const node = await startNode();
  const bytes = new Uint8Array(crypto.randomBytes(40_000));
  const file = node.putFile(bytes);
  node.faults.delay({ ms: 1_200, method: "claim", count: 1 });
  const seen = rootEvents();
  const got = await download(node, file, { rpcTimeoutMs: 500, maxBytes: 40_000, log: seen.log });
  assert.equal(Buffer.compare(got, bytes), 0);
  const done = seen.events.find((e) => e.event === "HOP_DOWNLOADED");
  assert.ok(done.ms >= 1_200 && done.bytesPerSec > 0, "the effective rate is logged");
  // ...and a tiny file still gets only the floor.
  const tiny = node.putFile(new Uint8Array(16));
  node.faults.delay({ ms: 1_200, method: "claim", count: 2 });
  await assert.rejects(() => download(node, tiny, { rpcTimeoutMs: 500, maxBytes: 16 }), /timeout/);
});
