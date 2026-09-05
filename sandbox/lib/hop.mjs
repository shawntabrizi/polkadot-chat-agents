// The persona's HOP client: what Polkadot Desktop's `@novasamatech/handoff-service`
// does, written against the chat spec (base-spec.md "HOP Protocol" and "HOP
// File Loading") with the sandbox's own dependencies — never bot-core's
// `lib/hop-client.mjs`, so the two implementations check each other.
//
//   ticket        = 32 random bytes, sent inside the encrypted chat message
//   AEAD key      = blake2b_256(key = ticket, "encryption")   ChaCha20-Poly1305,
//                   nonce(12) ‖ ciphertext ‖ tag(16) — what every deployed client
//                   uses; the spec's "AES-256-GCM" wording is stale (questions.md S5)
//   claim keypair = sr25519 from seed blake2b_256(key = ticket, "signer")
//   entry hash    = blake2b_256(encrypted blob); the metadata entry's hash is
//                   the message's `identifier`
//   metadata      = SCALE UploadedFile { totalSize: u64, chunks: Vec<Vec<u8>> }
//
// Every pool call is signed with a domain-separated payload (hop-submit-v1:,
// hop-claim-v1:, hop-ack-v1:). Params are positional, as the spec writes them.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { getPublicKey, secretFromSeed, sign } from "@scure/sr25519";
import { Bytes, Struct, Vector, u64 } from "scale-ts";
import WebSocket from "ws";

import { bytesToHex, hexToBytes } from "./bytes.mjs";

/** The app's chunk: 2 MB of plaintext per pool entry. */
export const HOP_CHUNK_BYTES = 2_000_000;
/** The largest RPC frame a client accepts (bot-core's BOT_HOP_RPC_FRAME_MAX_BYTES). */
export const HOP_FRAME_MAX_BYTES = 4_500_000;

const textEncoder = new TextEncoder();
const UploadedFile = Struct({ totalSize: u64, chunks: Vector(Bytes()) });

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
};
const u64le = (value) => {
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};
export const hash256 = (bytes) => blake2b(bytes, { dkLen: 32 });
const khash = (key, label) => blake2b(textEncoder.encode(label), { dkLen: 32, key });

/** The signing payloads the node verifies (`substrate/client/hop/src/types.rs`). */
export const payloads = {
  submit: (data, timestampMs) => hash256(concat(textEncoder.encode("hop-submit-v1:"), hash256(data), u64le(timestampMs))),
  claim: (hash) => hash256(concat(textEncoder.encode("hop-claim-v1:"), hash)),
  ack: (hash) => hash256(concat(textEncoder.encode("hop-ack-v1:"), hash)),
};

/** Everything a ticket derives: the AEAD key and the recipient keypair. */
export const ticketKeys = (ticket) => {
  if (ticket?.length !== 32) throw new Error("a claim ticket is 32 bytes");
  const secret = secretFromSeed(khash(ticket, "signer"));
  return { encryptionKey: khash(ticket, "encryption"), secret, publicKey: getPublicKey(secret) };
};

/** MultiSigner / MultiSignature :: Sr25519 (index 1). */
export const sr25519Multi = (bytes) => concat(Uint8Array.of(1), bytes);

const encrypt = (key, plain) => {
  const nonce = randomBytes(12);
  return concat(nonce, chacha20poly1305(key, nonce).encrypt(plain));
};
const decrypt = (key, blob) => {
  if (blob.length < 12 + 16) throw new Error("ciphertext too short");
  return chacha20poly1305(key, blob.subarray(0, 12)).decrypt(blob.subarray(12));
};

/** A Bulletin allowance signer for uploads from a 32-byte seed (a persona's, persisted on a real network). */
export const bulletinSignerFromSeed = (seed) => {
  const secret = secretFromSeed(seed);
  const publicKey = getPublicKey(secret);
  return { publicKey, account: bytesToHex(publicKey), sign: (payload) => sign(secret, payload) };
};
/** A fresh one, minted at creation on the mock network. */
export const mintBulletinSigner = () => bulletinSignerFromSeed(randomBytes(32));

/** The endpoint a message names is peer data: ws(s) only, no credentials. */
export const checkHopUrl = (value) => {
  let url;
  try { url = new URL(value); } catch { throw new Error("HOP endpoint is not a URL"); }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error(`HOP endpoint must be ws(s)://, got ${url.protocol}`);
  if (url.username || url.password) throw new Error("HOP endpoint must not carry credentials");
  return url.toString();
};

/** One JSON-RPC 2.0 connection; every call is bounded and the frame cap enforced before parsing. */
export const openHop = (url, { timeoutMs = 30_000, maxFrameBytes = HOP_FRAME_MAX_BYTES } = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket(checkHopUrl(url), { maxPayload: maxFrameBytes });
  const pending = new Map();
  let nextId = 1;
  const failAll = (reason) => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); } pending.clear(); };
  // Before `open` an error is a failed connect; after it (an oversized frame,
  // a reset) every pending call fails and the socket is closed by ws.
  ws.on("error", (e) => { reject(new Error(`HOP connect failed: ${e.message}`)); failAll(`HOP connection error: ${e.message}`); });
  ws.on("close", () => failAll("HOP connection closed"));
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(Object.assign(new Error(`HOP ${msg.error.code} ${msg.error.message}`), { code: msg.error.code }));
    else p.resolve(msg.result);
  });
  ws.once("open", () => resolve({
    call: (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`HOP ${method} timeout`)); }, timeoutMs);
      pending.set(id, { resolve: res, reject: rej, timer });
      const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      if (Buffer.byteLength(frame) > maxFrameBytes) { pending.delete(id); clearTimeout(timer); rej(new Error(`HOP ${method} request exceeds ${maxFrameBytes} bytes`)); return; }
      ws.send(frame);
    }),
    close: () => { try { ws.close(); } catch { /* closed */ } },
  }));
});

/**
 * Upload `bytes` the way the desktop does: encrypt each chunk under the
 * ticket's key, submit it (signed by the allowance account), then the
 * metadata entry whose hash becomes the identifier.
 * @returns {{ identifier: Uint8Array, claimTicket: Uint8Array, chunks: Uint8Array[] }}
 */
export async function uploadFile({ url, bytes, signer, chunkSize = HOP_CHUNK_BYTES, timeoutMs = 30_000 }) {
  const ticket = randomBytes(32);
  const keys = ticketKeys(ticket);
  const recipient = bytesToHex(sr25519Multi(keys.publicKey));
  const rpc = await openHop(url, { timeoutMs });
  try {
    const submit = async (blob) => {
      const timestamp = Date.now();
      const signature = signer.sign(payloads.submit(blob, timestamp));
      await rpc.call("hop_submit", [bytesToHex(blob), [recipient], bytesToHex(sr25519Multi(signature)), bytesToHex(sr25519Multi(signer.publicKey)), timestamp]);
      return hash256(blob);
    };
    const chunks = [];
    for (let at = 0; at < bytes.length; at += chunkSize) chunks.push(await submit(encrypt(keys.encryptionKey, bytes.subarray(at, at + chunkSize))));
    const identifier = await submit(encrypt(keys.encryptionKey, UploadedFile.enc({ totalSize: BigInt(bytes.length), chunks })));
    return { identifier, claimTicket: ticket, chunks };
  } finally {
    rpc.close();
  }
}

/**
 * Claim, verify, decrypt and acknowledge every entry of one attachment, in
 * the spec's order (metadata first, then each chunk; the ack follows the
 * decrypt). Throws on any integrity or size failure.
 */
export async function downloadFile({ url, identifier, claimTicket, maxBytes, timeoutMs = 30_000, onChunks = () => {} }) {
  const keys = ticketKeys(claimTicket);
  if (identifier?.length !== 32) throw new Error("an identifier is 32 bytes");
  const rpc = await openHop(url, { timeoutMs });
  try {
    const signed = (hash, payload) => bytesToHex(sr25519Multi(sign(keys.secret, payload(hash))));
    const claim = async (hash) => {
      const blob = hexToBytes(await rpc.call("hop_claim", [bytesToHex(hash), signed(hash, payloads.claim)]));
      // The hash names the ciphertext: check it before touching the AEAD.
      if (bytesToHex(hash256(blob)) !== bytesToHex(hash)) throw new Error("HOP entry hash mismatch");
      return blob;
    };
    // An ack that fails is not a failed download (the entry may already be gone).
    const ack = (hash) => rpc.call("hop_ack", [bytesToHex(hash), signed(hash, payloads.ack)]).catch(() => undefined);

    const meta = UploadedFile.dec(decrypt(keys.encryptionKey, await claim(identifier)));
    if (meta.totalSize > BigInt(maxBytes)) throw new Error(`attachment larger than the ${maxBytes}-byte cap (${meta.totalSize} bytes)`);
    onChunks(meta.chunks);
    await ack(identifier);
    const parts = [];
    let received = 0;
    for (const hash of meta.chunks) {
      const plain = decrypt(keys.encryptionKey, await claim(hash));
      received += plain.length;
      if (BigInt(received) > meta.totalSize) throw new Error("attachment exceeds its declared size");
      parts.push(plain);
      await ack(hash);
    }
    if (BigInt(received) !== meta.totalSize) throw new Error("attachment incomplete");
    return concat(...parts);
  } finally {
    rpc.close();
  }
}
