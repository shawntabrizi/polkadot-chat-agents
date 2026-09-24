import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chunkAad, chunkNonce, cidOf, contentHash, decryptAttachment, encryptAttachment,
} from "../lib/attachment-crypto.mjs";
import { bulletinConfig, createBulletin, createUploadBudget } from "../lib/bulletin.mjs";
import { PRODUCTS_DEVNET, SANDBOX } from "../lib/network-config.mjs";
import { makePng, pngDimensions } from "../lib/png.mjs";

// Crypto vectors C1 and C2 of polkadot-chat-desktop docs/spec/vectors-0012.md.
// The desktop's WebCrypto code must produce the same ciphertexts and CIDs, so
// a re-store by either client revives the same message.
const hex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const hexOf = (b) => Buffer.from(b).toString("hex");
const key = new Uint8Array(32).fill(0x11);
const nonce = new Uint8Array(12).fill(0x22);
const enc = (s) => new TextEncoder().encode(s);

test("0012 C1: one chunk reproduces nonce, AAD, ciphertext, content hash and CID", () => {
  const out = encryptAttachment(enc("hello, bulletin"), { key, nonce });
  assert.equal(hexOf(chunkNonce(nonce, 0)), "222222222222222222222222");
  assert.equal(hexOf(chunkAad(0, 1, 15)), "7063642d6174742d763100000000010000000f00000000000000");
  assert.equal(hexOf(out.ciphertexts[0]), "7f926b25afe3bf3d9053b2593ccf8785d9d92181762c9f5eb36cf0a96d4554");
  assert.equal(hexOf(out.chunks[0]), "d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a");
  assert.equal(cidOf(out.chunks[0]), "bafk2bzacedkhwk4hqr7cfe4526y7krkb7753jl7pycofql525ces2buc7sfiu");
});

const c2 = () => encryptAttachment(enc("polkadot chat"), { key, nonce, chunkSize: 8 });
const c2Item = (out, over = {}) => ({ size: 13, key, nonce, chunkSize: 8, chunks: out.chunks, ...over });

test("0012 C2: two chunks reproduce nonce XOR index, AADs, ciphertexts and CIDs", () => {
  const out = c2();
  assert.equal(hexOf(chunkNonce(nonce, 1)), "222222222222222222222223");
  assert.equal(hexOf(chunkAad(1, 2, 13)), "7063642d6174742d763101000000020000000d00000000000000");
  assert.deepEqual(out.ciphertexts.map(hexOf), ["67986b22a1abf02bcb5de371c38de836d3c4fd3d580848ad", "196f0194e977fac63158d4778d8a53ac4c540c207f"]);
  assert.deepEqual(out.chunks.map(cidOf), [
    "bafk2bzacedzecptijg7o5ueul5l4nyvneer76h5ro75jl5yr5mdik6dlinf3i",
    "bafk2bzaceb7hsb3nqsmjcnpyjyxqbvzz6pihcsc7cq7kjbpn4tgsam7r5oykq",
  ]);
  assert.equal(new TextDecoder().decode(decryptAttachment(c2Item(out), out.ciphertexts)), "polkadot chat");
});

test("0012 C2 negatives: a swapped, dropped or re-sized chunk never decrypts", () => {
  const out = c2();
  const [c0, c1] = out.ciphertexts;
  // Swapped chunks, with the hash list swapped too so only the AAD can catch it.
  assert.throws(() => decryptAttachment(c2Item(out, { chunks: [out.chunks[1], out.chunks[0]] }), [c1, c0]), /damaged/);
  assert.throws(() => decryptAttachment(c2Item(out), [c0]), /chunk count/);
  // A sender that lies about the size: 12 still means 2 chunks, but the AAD differs.
  assert.throws(() => decryptAttachment(c2Item(out, { size: 12 }), [c0, c1]), /damaged/);
  // A source that returns other bytes fails the hash before any decryption.
  assert.throws(() => decryptAttachment(c2Item(out), [c0, c0]), /chunk 1 hash mismatch/);
});

test("0012 chunking at the edges: 1 byte, exactly one chunk, one byte over", () => {
  for (const [size, chunks] of [[1, 1], [8, 1], [9, 2], [16, 2], [17, 3]]) {
    const data = new Uint8Array(size).map((_, i) => i);
    const out = encryptAttachment(data, { chunkSize: 8 });
    assert.equal(out.ciphertexts.length, chunks, `size ${size}`);
    assert.ok(out.ciphertexts.every((c, i) => c.length === Math.min(8, size - i * 8) + 16));
    assert.deepEqual(decryptAttachment({ ...out, size }, out.ciphertexts), data);
  }
  assert.throws(() => encryptAttachment(new Uint8Array(0)), /at least 1 byte/);
  // Deterministic for a key and nonce: a re-store gives the same CIDs.
  assert.deepEqual(c2().chunks.map(cidOf), c2().chunks.map(cidOf));
});

test("bulletin config: the devnet profile has an endpoint and gateway; the sandbox has none; the authorizer is a dev path only", () => {
  const cfg = bulletinConfig({}, PRODUCTS_DEVNET);
  assert.equal(cfg.endpoint, "wss://bullet.sik.rocks");
  assert.equal(cfg.gateway, "https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/");
  assert.equal(cfg.genesis, "0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59");
  assert.equal(cfg.authorizer, null, "no dev grant unless the operator asks for it");
  assert.equal(bulletinConfig({}, SANDBOX), null);
  assert.equal(bulletinConfig({ BOT_BULLETIN_AUTHORIZER: "//Eve" }, PRODUCTS_DEVNET).authorizer, "//Eve");
  assert.throws(() => bulletinConfig({ BOT_BULLETIN_AUTHORIZER: "Eve" }, PRODUCTS_DEVNET), /dev derivation path/);
});

test("upload budget: refuses past the daily cap, persists, and refills the next UTC day", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pca-budget-")), "b.json");
  let now = Date.parse("2026-09-24T10:00:00Z");
  const budget = createUploadBudget({ limit: { bytes: 3_000_000, transactions: 2 }, file, now: () => now });
  budget.check(2_000_016, 1);
  budget.spend(2_000_016, 1);
  assert.throws(() => budget.check(2_000_016, 1), /upload budget exceeded/);
  const reloaded = createUploadBudget({ limit: { bytes: 3_000_000, transactions: 2 }, file, now: () => now });
  assert.throws(() => reloaded.check(2_000_016, 1), /upload budget exceeded/, "a restart must not reset the meter");
  now = Date.parse("2026-09-25T00:00:01Z");
  reloaded.check(2_000_016, 1);
});

// A Bulletin client with no chain: the genesis answer and HTTP sources are fakes.
const GENESIS = "0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59";
const offlineBulletin = (fetchImpl) => createBulletin({
  endpoint: "wss://bulletin.invalid",
  gateway: "https://gateway.invalid/ipfs/",
  genesis: GENESIS,
  signerPair: { publicKey: new Uint8Array(32).fill(7), sign: () => new Uint8Array(64) },
  makeClient: () => ({ getChainSpecData: async () => ({ genesisHash: GENESIS }), getUnsafeApi: () => ({}), destroy() {} }),
  fetchImpl,
});
const itemOf = (out, over = {}) => ({ size: 13, key, nonce, chunkSize: 8, chunks: out.chunks, store: { kind: "bulletin", genesis: hex(GENESIS.slice(2)), mirror: null }, expiresAt: Date.now() + 3600_000, ...over });

test("download: bitswap first; a source with wrong bytes is skipped for the next; every chunk is hash-checked", async () => {
  const out = c2();
  const byCid = new Map(out.chunks.map((h, i) => [cidOf(h), out.ciphertexts[i]]));
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (init?.method === "POST") {
      const { params: [cid] } = JSON.parse(init.body);
      calls.push(`bitswap ${cid.slice(-4)}`);
      // The RPC node lies about chunk 1.
      const bytes = cid === cidOf(out.chunks[1]) ? out.ciphertexts[0] : byCid.get(cid);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${hexOf(bytes)}` }));
    }
    calls.push(`gateway ${url.slice(-4)}`);
    return new Response(byCid.get(url.split("/ipfs/")[1]));
  };
  const b = offlineBulletin(fetchImpl);
  const got = await b.download(itemOf(out));
  assert.equal(new TextDecoder().decode(got.plaintext), "polkadot chat");
  assert.deepEqual(got.sources, ["bitswap", "gateway"]);
  assert.ok(calls.includes(`gateway ${cidOf(out.chunks[1]).slice(-4)}`));
  assert.ok(!calls.includes(`gateway ${cidOf(out.chunks[0]).slice(-4)}`), "a good bitswap answer needs no gateway");
});

test("download: a chunk no source has is 'expired' after expiresAt, a retryable failure before; another chain is refused", async () => {
  const out = c2();
  const b = offlineBulletin(async () => new Response("gone", { status: 404 }));
  await assert.rejects(b.download(itemOf(out, { expiresAt: Date.now() - 1 })), /Attachment expired/);
  await assert.rejects(b.download(itemOf(out)), /chunk 0 unavailable/);
  await assert.rejects(b.download(itemOf(out, { store: { kind: "bulletin", genesis: new Uint8Array(32), mirror: null } })), /different Bulletin chain/);
});

test("png: the generated image carries the dimensions the echo brain reads back", () => {
  const png = makePng(40, 30, (x, y) => [x, y, 0]);
  assert.deepEqual(pngDimensions(png), { width: 40, height: 30 });
  assert.equal(pngDimensions(new Uint8Array(40)), null);
});

// Devnet //Eve refuses a 64 MiB grant since 2026-09-24
// (InsufficientAuthorizerBudget); the bot's own dev grant goes in 8 MiB steps.
test("dev grant: an upload short of 20 MiB gets three 8 MiB authorize_account steps, never one large grant", async () => {
  const grants = [];
  const api = {
    query: {
      TransactionStorage: { Authorizations: { getValue: async () => null } },
      System: { Number: { getValue: async () => 100 } },
    },
    tx: {
      TransactionStorage: {
        authorize_account: (args) => {
          grants.push(args);
          return { signSubmitAndWatch: () => ({ subscribe: ({ next }) => { queueMicrotask(() => next({ type: "txBestBlocksState", found: true, ok: true, block: { number: 101 }, txHash: "0x01" })); return { unsubscribe() {} }; } }) };
        },
      },
    },
  };
  const bulletin = createBulletin({
    endpoint: "wss://bulletin.invalid",
    genesis: GENESIS,
    authorizer: "//Eve",
    signerPair: { publicKey: new Uint8Array(32).fill(7), sign: () => new Uint8Array(64) },
    makeClient: () => ({ getChainSpecData: async () => ({ genesisHash: GENESIS }), getUnsafeApi: () => api, destroy() {} }),
  });
  await bulletin.ensureAuthorized({ transactions: 3, bytes: 20 * 1024 * 1024 });
  assert.equal(grants.length, 3);
  assert.ok(grants.every((g) => g.bytes === 8n * 1024n * 1024n && g.transactions === 10), JSON.stringify(grants, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
});
