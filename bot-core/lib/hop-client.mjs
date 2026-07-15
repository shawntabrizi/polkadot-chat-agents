// HOP mixnet store-and-forward client.
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
// claimed, decrypted and concatenated. Uploads generate a new ticket, encrypt
// chunks and metadata with it, then sign each hop_submit with a dedicated
// Bulletin allowance account. Layouts are confirmed against the mobile app's
// Packages/HandoffService (HandoffFileLoader / FileEncryptor / RPCModels).
//
// The claimTicket is key material: never log it (or anything derived from it).

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { blake2b } from "@noble/hashes/blake2.js";
import { getPublicKey, secretFromSeed, sign as sr25519Sign } from "@scure/sr25519";

const textEncoder = new TextEncoder();
const CLAIM_CONTEXT = textEncoder.encode("hop-claim-v1:");
const ACK_CONTEXT = textEncoder.encode("hop-ack-v1:");
const SUBMIT_CONTEXT = textEncoder.encode("hop-submit-v1:");

// The app uploads in 2 MB chunks; allow GCM overhead (12B nonce + 16B tag) plus
// a little slack before calling a chunk oversized.
const MAX_CHUNK_CIPHERTEXT = 2_000_000 + 64;
const HOP_CHUNK_PLAINTEXT_BYTES = 2_000_000;
const HASH_BYTES = 32;
const MIN_CHUNK_PLAINTEXT_BYTES = 64 * 1024;
const MAX_METADATA_CHUNKS = 4_096;
const HOP_DIALECTS = new Set(["legacy", "t3ams"]);
const CONTENT_HASH_ALGORITHMS = new Set(["sha256", "blake2b-256"]);

const toHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const fromHex = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error("invalid hex from HOP node");
  return new Uint8Array(Buffer.from(clean, "hex"));
};

const blake2b32 = (data, key) => blake2b(data, { dkLen: 32, key });
const contentHash = (bytes, algorithm) => algorithm === "blake2b-256"
  ? blake2b32(bytes)
  : new Uint8Array(crypto.createHash("sha256").update(bytes).digest());

const concatBytes = (...parts) => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const compactLength = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid SCALE compact length");
  if (value < 64) return Uint8Array.of(value << 2);
  if (value < 16_384) {
    const encoded = (value << 2) | 1;
    return Uint8Array.of(encoded & 0xff, encoded >> 8);
  }
  if (value < 1_073_741_824) {
    const encoded = (value << 2) | 2;
    return Uint8Array.of(encoded & 0xff, (encoded >> 8) & 0xff, (encoded >> 16) & 0xff, (encoded >> 24) & 0xff);
  }
  throw new Error("SCALE compact length is too large");
};

const scaleEncodeBytes = (bytes) => concatBytes(compactLength(bytes.length), bytes);

const u64le = (value) => {
  const output = new Uint8Array(8);
  let remaining = BigInt(value);
  if (remaining < 0n || remaining > 0xffff_ffff_ffff_ffffn) throw new Error("invalid u64 value");
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
};

const encodeUploadedFile = (totalSize, chunkHashes) => concatBytes(
  u64le(totalSize),
  compactLength(chunkHashes.length),
  ...chunkHashes.map(scaleEncodeBytes),
);

const aesGcmDecrypt = (rawKey, combined) => {
  if (combined.length < 12 + 16) throw new Error("ciphertext too short");
  const nonce = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", rawKey, nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
};

const aesGcmEncrypt = (rawKey, plain) => {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", rawKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return new Uint8Array(Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]));
};

// Minimal SCALE readers for UploadedFile { totalSize: u64, chunks: Vec<Vec<u8>> }.
const compactAt = (bytes, offset) => {
  const first = bytes[offset];
  if (first == null) throw new Error("truncated metadata");
  const mode = first & 0x03;
  if (mode === 0) return { value: first >> 2, offset: offset + 1 };
  if (mode === 1) {
    if (offset + 2 > bytes.length) throw new Error("truncated metadata");
    return { value: (first | (bytes[offset + 1] << 8)) >> 2, offset: offset + 2 };
  }
  if (mode === 2) {
    if (offset + 4 > bytes.length) throw new Error("truncated metadata");
    const raw = first | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
    return { value: raw >>> 2, offset: offset + 4 };
  }
  throw new Error("metadata length too large");
};
const decodeUploadedFile = (bytes, maxBytes) => {
  if (bytes.length < 8) throw new Error("truncated metadata");
  let totalSize = 0n;
  for (let i = 0; i < 8; i += 1) totalSize |= BigInt(bytes[i]) << BigInt(8 * i);
  if (totalSize > BigInt(maxBytes)) throw new Error(`attachment larger than cap (${totalSize} bytes)`);
  let { value: count, offset } = compactAt(bytes, 8);
  // Check the declared count before allocating or walking it. A hostile HOP
  // server can encrypt arbitrary metadata under the peer-provided ticket.
  const maxChunks = maxChunksFor(Number(totalSize));
  if (count > maxChunks) throw new Error(`attachment chunk list exceeds limit (${maxChunks})`);
  const chunkHashes = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const len = compactAt(bytes, offset);
    if (len.value !== HASH_BYTES) throw new Error("invalid metadata chunk hash");
    const end = len.offset + len.value;
    if (end > bytes.length) throw new Error("truncated metadata");
    chunkHashes[i] = bytes.slice(len.offset, end);
    offset = end;
  }
  return { totalSize, chunkHashes };
};

const maxChunksFor = (maxBytes) => Math.min(
  Math.ceil(maxBytes / MIN_CHUNK_PLAINTEXT_BYTES),
  MAX_METADATA_CHUNKS,
);

// A peer chooses the wssUrl, so treat it as hostile input: encrypted transport
// only, no credentials smuggled in the URL, no raw IPs, and an operator
// allowlist (exact host or dot-suffix match). A textual IP check cannot stop a
// hostile hostname resolving privately, so production defaults to deny until
// the operator pins the trusted HOP node suffixes.
export const validateHopUrl = (wssUrl, { allowInsecure = false, allowedNodes = null } = {}) => {
  let url;
  try { url = new URL(wssUrl); } catch { throw new Error("invalid HOP node URL"); }
  if (url.protocol !== "wss:" && !(allowInsecure && url.protocol === "ws:")) {
    throw new Error(`HOP node URL must be wss:// (got ${url.protocol})`);
  }
  if (url.username || url.password) throw new Error("HOP node URL must not carry credentials");
  const host = url.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    if (!allowInsecure) throw new Error("HOP node URL must use a hostname, not an IP");
  }
  const nodes = Array.isArray(allowedNodes)
    ? allowedNodes.map((node) => String(node).trim().toLowerCase()).filter(Boolean)
    : [];
  // `allowInsecure` is deliberately test-only: it permits the local mock's
  // ws:// loopback endpoint without weakening real deployments.
  if (nodes.length === 0 && !allowInsecure) {
    throw new Error("BOT_HOP_ALLOWED_NODES must name trusted HOP hosts");
  }
  if (nodes.length > 0 && !nodes.some((node) => host === node || host.endsWith(`.${node}`))) {
    throw new Error(`HOP node ${host} not in BOT_HOP_ALLOWED_NODES`);
  }
  return url;
};

const openSocket = (url, timeoutMs) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url); // native WebSocket (Node >= 22)
  // Make binary frames inspectable without Blob conversion so the RPC layer
  // can enforce its cap before decoding JSON or hex.
  ws.binaryType = "arraybuffer";
  const timer = setTimeout(() => { ws.close(); reject(new Error("HOP connect timeout")); }, timeoutMs);
  ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
  ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("HOP connect failed")); }, { once: true });
});

const makeRpc = (ws, rpcTimeoutMs, maxFrameBytes) => {
  const pending = new Map(); // id -> {resolve, reject, timer}
  let nextId = 1;
  const failAll = (reason) => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    pending.clear();
  };
  const rejectOversizedFrame = () => {
    failAll(`HOP RPC frame exceeds ${maxFrameBytes} bytes`);
    try { ws.close(1009, "frame too large"); } catch { /* already closed */ }
  };
  ws.addEventListener("message", (event) => {
    let text;
    const data = event.data;
    if (typeof data === "string") {
      if (Buffer.byteLength(data) > maxFrameBytes) { rejectOversizedFrame(); return; }
      text = data;
    } else if (data instanceof ArrayBuffer) {
      if (data.byteLength > maxFrameBytes) { rejectOversizedFrame(); return; }
      text = Buffer.from(data).toString("utf8");
    } else if (ArrayBuffer.isView(data)) {
      if (data.byteLength > maxFrameBytes) { rejectOversizedFrame(); return; }
      text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
    } else {
      failAll("invalid HOP RPC frame");
      try { ws.close(1003, "invalid frame"); } catch { /* already closed */ }
      return;
    }
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const p = pending.get(msg?.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`HOP ${msg.error.code ?? ""} ${String(msg.error.message ?? "error").slice(0, 500)}`.trim()));
    else p.resolve(msg.result);
  });
  ws.addEventListener("close", () => failAll("HOP connection closed"));
  ws.addEventListener("error", () => failAll("HOP connection error"));
  return {
    call: (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`HOP ${method} timeout`)); }, rpcTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      let encoded;
      try { encoded = JSON.stringify({ id, jsonrpc: "2.0", method, params }); }
      catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
        return;
      }
      if (Buffer.byteLength(encoded) > maxFrameBytes) {
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`HOP ${method} request exceeds ${maxFrameBytes} bytes`));
        return;
      }
      try { ws.send(encoded); }
      catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    }),
    close: () => { try { ws.close(); } catch { /* already closed */ } },
  };
};

const validSender = (sender) => sender
  && sender.publicKey instanceof Uint8Array
  && sender.publicKey.length === HASH_BYTES
  && typeof sender.sign === "function";

const multiSigner = (publicKey) => new Uint8Array([1, ...publicKey]); // MultiSigner::Sr25519
const multiSignature = (signature) => new Uint8Array([1, ...signature]); // MultiSignature::Sr25519
const requireDialect = (dialect) => {
  if (!HOP_DIALECTS.has(dialect)) throw new Error("unsupported HOP RPC dialect");
  return dialect;
};
const submitParams = ({ dialect, data, recipients, signature, signer, timestamp }) => dialect === "t3ams"
  ? [data, recipients, signature, signer, timestamp]
  : { data, recipients, signature, signer, submit_timestamp: timestamp };
const claimParams = ({ dialect, rawHash, signature }) => dialect === "t3ams"
  ? [rawHash, signature]
  : { raw_hash: rawHash, signature };

const uploadChunkSize = (maxRpcFrameBytes) => {
  // hop_submit serializes ciphertext as hex inside JSON. Reserve framing space
  // for proofs and recipients while retaining the app's 2 MB chunk ceiling.
  const available = Math.floor((maxRpcFrameBytes - 1024) / 2) - 28;
  if (available < MIN_CHUNK_PLAINTEXT_BYTES) {
    throw new Error("HOP RPC frame limit is too small for upload");
  }
  return Math.min(HOP_CHUNK_PLAINTEXT_BYTES, available);
};

const readExact = async (handle, bytes, position) => {
  const buffer = Buffer.allocUnsafe(bytes);
  let offset = 0;
  while (offset < bytes) {
    const { bytesRead } = await handle.read(buffer, offset, bytes - offset, position + offset);
    if (bytesRead === 0) throw new Error("source file changed while it was being uploaded");
    offset += bytesRead;
  }
  return new Uint8Array(buffer);
};

// Upload a regular vault file as an encrypted HOP attachment. The sender is a
// dedicated Bulletin allowance keypair; the returned ticket is recipient key
// material and must only ever go inside the encrypted chat attachment.
export async function uploadP2PFile({
  filePath,
  wssUrl,
  sender,
  maxBytes = 50 * 1024 * 1024,
  maxRpcFrameBytes = 4_500_000,
  rpcTimeoutMs = 30_000,
  deadlineMs = 120_000,
  connectTimeoutMs = 10_000,
  allowInsecure = false,
  allowedNodes = null,
  // T3ams' Bulletin relay exposes the same crypto protocol but uses
  // positional JSON-RPC parameters; legacy PCA HOP nodes use by-name params.
  dialect = "legacy",
  log = () => {},
}) {
  requireDialect(dialect);
  const url = validateHopUrl(wssUrl, { allowInsecure, allowedNodes });
  if (typeof filePath !== "string" || !filePath) throw new Error("upload file path is required");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("maxBytes must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxRpcFrameBytes) || maxRpcFrameBytes < 1024) throw new Error("maxRpcFrameBytes must be a safe integer of at least 1024");
  if (!validSender(sender)) throw new Error("HOP upload sender must be an sr25519 keypair");
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) throw new Error("HOP upload source must be a regular file");
  if (!Number.isSafeInteger(stat.size) || stat.size > maxBytes) throw new Error(`file exceeds upload cap (${maxBytes} bytes)`);

  const chunkSize = uploadChunkSize(maxRpcFrameBytes);
  const ticket = new Uint8Array(crypto.randomBytes(HASH_BYTES));
  const aesKey = blake2b32(textEncoder.encode("encryption"), ticket);
  const recipientPublicKey = getPublicKey(secretFromSeed(blake2b32(textEncoder.encode("signer"), ticket)));
  const recipient = multiSigner(recipientPublicKey);
  const signer = multiSigner(sender.publicKey);
  const deadline = Date.now() + deadlineMs;
  const checkDeadline = () => {
    if (Date.now() > deadline) throw new Error("HOP upload deadline exceeded");
  };
  const submitProof = (data, timestamp) => {
    const dataHash = blake2b32(data);
    const payload = blake2b32(concatBytes(SUBMIT_CONTEXT, dataHash, u64le(timestamp)));
    const signature = sender.sign(payload);
    if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error("HOP upload signer returned an invalid signature");
    return { dataHash, signature };
  };

  const handle = await fs.open(filePath, "r");
  let rpc = null;
  try {
    rpc = makeRpc(await openSocket(url, connectTimeoutMs), rpcTimeoutMs, maxRpcFrameBytes);
    const submit = async (data) => {
      checkDeadline();
      const timestamp = Date.now();
      const { dataHash, signature } = submitProof(data, timestamp);
      await rpc.call("hop_submit", submitParams({
        dialect,
        data: toHex(data),
        recipients: [toHex(recipient)],
        signature: toHex(multiSignature(signature)),
        signer: toHex(signer),
        timestamp,
      }));
      return dataHash;
    };

    const hashes = [];
    for (let position = 0; position < stat.size; position += chunkSize) {
      const plain = await readExact(handle, Math.min(chunkSize, stat.size - position), position);
      const encrypted = aesGcmEncrypt(aesKey, plain);
      if (encrypted.length > MAX_CHUNK_CIPHERTEXT) throw new Error("HOP upload chunk exceeds protocol limit");
      hashes.push(await submit(encrypted));
    }
    const metadata = encodeUploadedFile(stat.size, hashes);
    const identifier = await submit(aesGcmEncrypt(aesKey, metadata));
    const after = await handle.stat();
    if (after.size !== stat.size) throw new Error("source file changed while it was being uploaded");
    log("HOP_UPLOADED", { host: url.hostname, id: toHex(identifier).slice(0, 18), bytes: stat.size, chunks: hashes.length });
    return { identifier, claimTicket: ticket, wssUrl: url.toString() };
  } finally {
    rpc?.close();
    await handle.close();
  }
}

// Download and decrypt one attachment. Returns the plaintext bytes.
// Throws on any integrity/limit/transport failure; the caller turns that into
// a "download failed" note for the brain (the message itself is already ACKed).
export async function downloadP2PFile({
  wssUrl,
  identifier,
  claimTicket,
  maxBytes = 32 * 1024 * 1024,
  maxRpcFrameBytes = 4_500_000,
  rpcTimeoutMs = 30_000,
  deadlineMs = 120_000,
  connectTimeoutMs = 10_000,
  allowInsecure = false,
  allowedNodes = null,
  dialect = "legacy",
  // T3ams AttachmentRef hashes plaintext with unkeyed BLAKE2b-256. This is
  // optional for legacy callers, but required by the T3ams adapter after
  // decryption. Legacy PCA callers retain SHA-256 as the default.
  expectedContentHash = null,
  contentHashAlgorithm = "sha256",
  log = () => {},
}) {
  requireDialect(dialect);
  if (!CONTENT_HASH_ALGORITHMS.has(contentHashAlgorithm)) throw new Error("unsupported attachment content hash algorithm");
  const url = validateHopUrl(wssUrl, { allowInsecure, allowedNodes });
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("maxBytes must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxRpcFrameBytes) || maxRpcFrameBytes < 1024) throw new Error("maxRpcFrameBytes must be a safe integer of at least 1024");
  if (claimTicket?.length !== HASH_BYTES) throw new Error("claim ticket must be 32 bytes");
  if (identifier?.length !== HASH_BYTES) throw new Error("attachment identifier must be 32 bytes");
  if (expectedContentHash != null && (!(expectedContentHash instanceof Uint8Array) || expectedContentHash.length !== HASH_BYTES)) {
    throw new Error("expected attachment content hash must be 32 bytes");
  }

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
    const rpc = makeRpc(await openSocket(url, connectTimeoutMs), rpcTimeoutMs, maxRpcFrameBytes);
    const claimBlob = async (rawHash) => {
      checkDeadline();
      if (rawHash?.length !== HASH_BYTES) throw new Error("invalid HOP blob hash");
      const hex = await rpc.call("hop_claim", claimParams({
        dialect,
        rawHash: toHex(rawHash),
        signature: proofFor(rawHash, CLAIM_CONTEXT),
      }));
      if (typeof hex !== "string") throw new Error("invalid HOP blob");
      const clean = hex.trim().replace(/^0x/i, "");
      if (clean.length > MAX_CHUNK_CIPHERTEXT * 2) throw new Error("HOP blob oversized");
      return fromHex(hex);
    };
    // Ack right after a blob is decrypted (mirrors the app) so the
    // store-and-forward node can drop it. Best-effort: never fatal.
    const ackBlob = (rawHash) =>
      rpc.call("hop_ack", claimParams({
        dialect,
        rawHash: toHex(rawHash),
        signature: proofFor(rawHash, ACK_CONTEXT),
      })).catch(() => {});
    try {
      if (meta == null) {
        const encryptedMetadata = await claimBlob(identifier);
        if (Buffer.compare(blake2b32(encryptedMetadata), identifier) !== 0) throw new Error("HOP metadata hash mismatch");
        meta = decodeUploadedFile(aesGcmDecrypt(aesKey, encryptedMetadata), maxBytes);
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
  if (expectedContentHash != null) {
    const actual = contentHash(bytes, contentHashAlgorithm);
    if (Buffer.compare(actual, expectedContentHash) !== 0) throw new Error("attachment content hash mismatch");
  }
  log("HOP_DOWNLOADED", { host: url.hostname, id: toHex(identifier).slice(0, 18), bytes: bytes.length, chunks: meta.chunkHashes.length });
  return bytes;
}
