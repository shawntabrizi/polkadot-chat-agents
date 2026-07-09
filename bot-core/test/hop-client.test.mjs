import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { downloadP2PFile, validateHopUrl } from "../lib/hop-client.mjs";
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

test("happy path: multi-chunk file round-trips byte-exact and gets acked", async () => {
  const node = await startNode();
  const original = new Uint8Array(crypto.randomBytes(5_000_000)); // 3 chunks
  const file = node.putFile(original);
  const got = await download(node, file);
  assert.equal(Buffer.compare(got, original), 0);
  // metadata + all chunks acknowledged
  assert.equal(node.acked.size, 4);
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

test("ws:// is rejected unless explicitly allowed", async () => {
  const node = await startNode();
  const file = node.putFile(new Uint8Array(16));
  await assert.rejects(() => download(node, file, { allowInsecure: false }), /must be wss/);
});

test("allowlist rejects hosts outside it", () => {
  assert.throws(() => validateHopUrl("wss://evil.example", { allowedNodes: ["hop.polkadot.io"] }), /not in BOT_HOP_ALLOWED_NODES/);
  assert.ok(validateHopUrl("wss://a.hop.polkadot.io", { allowedNodes: ["hop.polkadot.io"] }));
  assert.throws(() => validateHopUrl("wss://user:pw@hop.polkadot.io"), /credentials/);
  assert.throws(() => validateHopUrl("wss://10.0.0.1/x"), /hostname/);
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
