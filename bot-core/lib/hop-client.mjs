// HOP mixnet store-and-forward client — download side only.
//
// Chat attachments are not inline: the message carries { identifier, claimTicket,
// wssUrl, meta } and the bytes live on a "HOP" node speaking JSON-RPC 2.0 over a
// plain WebSocket (custom hop_* methods, params as a single by-name object,
// binary fields 0x-hex). Everything an attachment recipient needs derives from
// the 32-byte claim ticket embedded in the message:
//   aes key      = blake2b_256(key=ticket, data="encryption")   (AES-256-GCM)
//   claim keypair= sr25519 from seed blake2b_256(key=ticket, data="signer")
// Claiming `identifier` yields an encrypted metadata blob that SCALE-decodes to
// UploadedFile { totalSize u64, chunks Vec<Vec<u8>> }; each chunk hash is then
// claimed, decrypted and concatenated. Layouts confirmed against the mobile
// app's Packages/HandoffService (HandoffFileLoader / FileEncryptor / RPCModels).
//
// The claimTicket is key material: never log it (or anything derived from it).

import crypto from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";
import { secretFromSeed, sign as sr25519Sign } from "@scure/sr25519";

const textEncoder = new TextEncoder();
const CLAIM_CONTEXT = textEncoder.encode("hop-claim-v1:");
const ACK_CONTEXT = textEncoder.encode("hop-ack-v1:");

// The app uploads in 2 MB chunks; allow GCM overhead (12B nonce + 16B tag) plus
// a little slack before calling a chunk oversized.
const MAX_CHUNK_CIPHERTEXT = 2_000_000 + 64;

const toHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const fromHex = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error("invalid hex from HOP node");
  return new Uint8Array(Buffer.from(clean, "hex"));
};

const blake2b32 = (data, key) => blake2b(data, { dkLen: 32, key });

const aesGcmDecrypt = (rawKey, combined) => {
  if (combined.length < 12 + 16) throw new Error("ciphertext too short");
  const nonce = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", rawKey, nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
};

// Minimal SCALE readers for UploadedFile { totalSize: u64, chunks: Vec<Vec<u8>> }.
const compactAt = (bytes, offset) => {
  const first = bytes[offset];
  if (first == null) throw new Error("truncated metadata");
  const mode = first & 0x03;
  if (mode === 0) return { value: first >> 2, offset: offset + 1 };
  if (mode === 1) return { value: (first | (bytes[offset + 1] << 8)) >> 2, offset: offset + 2 };
  if (mode === 2) {
    const raw = first | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
    return { value: raw >>> 2, offset: offset + 4 };
  }
  throw new Error("metadata length too large");
};
const decodeUploadedFile = (bytes) => {
  if (bytes.length < 8) throw new Error("truncated metadata");
  let totalSize = 0n;
  for (let i = 0; i < 8; i += 1) totalSize |= BigInt(bytes[i]) << BigInt(8 * i);
  let { value: count, offset } = compactAt(bytes, 8);
  const chunkHashes = [];
  for (let i = 0; i < count; i += 1) {
    const len = compactAt(bytes, offset);
    const end = len.offset + len.value;
    if (end > bytes.length) throw new Error("truncated metadata");
    chunkHashes.push(bytes.slice(len.offset, end));
    offset = end;
  }
  return { totalSize, chunkHashes };
};

// A peer chooses the wssUrl, so treat it as hostile input: encrypted transport
// only, no credentials smuggled in the URL, no raw IPs (cheap loopback/rebind
// guard), and an optional operator allowlist (exact host or dot-suffix match).
// Default is allow-with-caps — the bot has no equivalent of the app's
// remote-config trusted-node list, and default-deny would break every inbound
// photo out of the box.
export const validateHopUrl = (wssUrl, { allowInsecure = false, allowedNodes = null } = {}) => {
  let url;
  try { url = new URL(wssUrl); } catch { throw new Error("invalid HOP node URL"); }
  if (url.protocol !== "wss:" && !(allowInsecure && url.protocol === "ws:")) {
    throw new Error(`HOP node URL must be wss:// (got ${url.protocol})`);
  }
  if (url.username || url.password) throw new Error("HOP node URL must not carry credentials");
  const host = url.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    if (!allowInsecure) throw new Error("HOP node URL must use a hostname, not an IP");
  }
  if (Array.isArray(allowedNodes) && allowedNodes.length > 0) {
    const ok = allowedNodes.some((n) => host === n || host.endsWith(`.${n}`));
    if (!ok) throw new Error(`HOP node ${host} not in BOT_HOP_ALLOWED_NODES`);
  }
  return url;
};

const openSocket = (url, timeoutMs) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url); // native WebSocket (Node >= 22)
  const timer = setTimeout(() => { ws.close(); reject(new Error("HOP connect timeout")); }, timeoutMs);
  ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
  ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("HOP connect failed")); }, { once: true });
});

const makeRpc = (ws, rpcTimeoutMs) => {
  const pending = new Map(); // id -> {resolve, reject, timer}
  let nextId = 1;
  const failAll = (reason) => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    pending.clear();
  };
  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")); } catch { return; }
    const p = pending.get(msg?.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`HOP ${msg.error.code ?? ""} ${msg.error.message ?? "error"}`.trim()));
    else p.resolve(msg.result);
  });
  ws.addEventListener("close", () => failAll("HOP connection closed"));
  ws.addEventListener("error", () => failAll("HOP connection error"));
  return {
    call: (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`HOP ${method} timeout`)); }, rpcTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, jsonrpc: "2.0", method, params }));
    }),
    close: () => { try { ws.close(); } catch { /* already closed */ } },
  };
};

// Download and decrypt one attachment. Returns the plaintext bytes.
// Throws on any integrity/limit/transport failure; the caller turns that into
// a "download failed" note for the brain (the message itself is already ACKed).
export async function downloadP2PFile({
  wssUrl,
  identifier,
  claimTicket,
  maxBytes = 32 * 1024 * 1024,
  rpcTimeoutMs = 30_000,
  deadlineMs = 120_000,
  connectTimeoutMs = 10_000,
  allowInsecure = false,
  allowedNodes = null,
  log = () => {},
}) {
  const url = validateHopUrl(wssUrl, { allowInsecure, allowedNodes });
  if (!(claimTicket?.length >= 16)) throw new Error("missing claim ticket");
  if (!(identifier?.length > 0)) throw new Error("missing attachment identifier");

  const aesKey = blake2b32(textEncoder.encode("encryption"), claimTicket);
  const secret = secretFromSeed(blake2b32(textEncoder.encode("signer"), claimTicket));
  const proofFor = (rawHash, context) =>
    toHex(new Uint8Array([1, ...sr25519Sign(secret, blake2b32(new Uint8Array([...context, ...rawHash])))]));

  const deadline = Date.now() + deadlineMs;
  const checkDeadline = () => { if (Date.now() > deadline) throw new Error("HOP download deadline exceeded"); };

  // State survives the single reconnect-and-resume retry below.
  let meta = null;
  const parts = [];
  let received = 0;
  let chunkIndex = 0;

  const runAttempt = async () => {
    const rpc = makeRpc(await openSocket(url, connectTimeoutMs), rpcTimeoutMs);
    const claimBlob = async (rawHash) => {
      checkDeadline();
      const hex = await rpc.call("hop_claim", { raw_hash: toHex(rawHash), signature: proofFor(rawHash, CLAIM_CONTEXT) });
      if (typeof hex !== "string" || hex.length / 2 > MAX_CHUNK_CIPHERTEXT + 2) throw new Error("HOP blob oversized");
      return fromHex(hex);
    };
    // Ack right after a blob is decrypted (mirrors the app) so the
    // store-and-forward node can drop it. Best-effort: never fatal.
    const ackBlob = (rawHash) =>
      rpc.call("hop_ack", { raw_hash: toHex(rawHash), signature: proofFor(rawHash, ACK_CONTEXT) }).catch(() => {});
    try {
      if (meta == null) {
        meta = decodeUploadedFile(aesGcmDecrypt(aesKey, await claimBlob(identifier)));
        if (meta.totalSize > BigInt(maxBytes)) throw new Error(`attachment larger than cap (${meta.totalSize} bytes)`);
        if (meta.chunkHashes.length > Math.ceil(maxBytes / 65_536)) throw new Error("attachment chunk list implausibly long");
        await ackBlob(identifier);
      }
      for (; chunkIndex < meta.chunkHashes.length; chunkIndex += 1) {
        const rawHash = meta.chunkHashes[chunkIndex];
        const encrypted = await claimBlob(rawHash);
        // The chunk hash is client-computed blake2b of the *encrypted* blob —
        // verify before decrypting so a wrong/poisoned blob fails loudly.
        if (Buffer.compare(blake2b32(encrypted), rawHash) !== 0) throw new Error("HOP chunk hash mismatch");
        const plain = aesGcmDecrypt(aesKey, encrypted);
        received += plain.length;
        if (received > maxBytes || BigInt(received) > meta.totalSize) throw new Error("attachment exceeds declared size");
        parts.push(plain);
        await ackBlob(rawHash);
      }
    } finally {
      rpc.close();
    }
  };

  try {
    await runAttempt();
  } catch (error) {
    // One reconnect-and-resume retry: transient socket loss shouldn't cost the
    // whole download, but integrity failures fail immediately.
    const msg = String(error?.message ?? error);
    if (!/connection|connect|timeout/i.test(msg)) throw error;
    checkDeadline();
    log("HOP_RETRY", { host: url.hostname, chunk: chunkIndex, error: msg });
    await runAttempt();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  if (meta && BigInt(bytes.length) !== meta.totalSize) throw new Error("attachment incomplete");
  log("HOP_DOWNLOADED", { host: url.hostname, id: toHex(identifier).slice(0, 18), bytes: bytes.length, chunks: meta.chunkHashes.length });
  return bytes;
}
