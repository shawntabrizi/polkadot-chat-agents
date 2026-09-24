// HOP mixnet store-and-forward client.
//
// Chat attachments are not inline: the message carries { identifier, claimTicket,
// wssUrl, meta } and the bytes live on a "HOP" node speaking JSON-RPC 2.0 over a
// plain WebSocket (custom hop_* methods, params as a single by-name object,
// binary fields 0x-hex). Everything an attachment recipient needs derives from
// the 32-byte claim ticket embedded in the message:
//   AEAD key     = blake2b_256(key=ticket, data="encryption")   (ChaCha20-Poly1305)
//   claim keypair= sr25519 from seed blake2b_256(key=ticket, data="signer")
// Claiming `identifier` yields the encrypted root entry. Two root layouts are
// live (polkadot-chat-desktop docs/decisions.md "HOP receive (2026-09-24)"):
//  - "versioned": the phone apps' chat RFC 0001 envelope
//      VersionedUploadedFile::V1(Inline(Vec<u8>) = 0 | Chunked { totalSize: u64,
//      chunks: Vec<Vec<u8>> } = 1), bytes 00 00 | 00 01; a file of at most
//      chunkSize - 64 bytes sits inline in the root (iOS HandoffFileLoadConfig
//      inlineMargin, FileLoaderModels.swift);
//  - "plain": the base-spec text and t3ams, UploadedFile { totalSize, chunks }.
// Each chunk hash is then claimed, decrypted and concatenated. Uploads
// generate a new ticket, encrypt chunks and root with it, then sign each
// hop_submit with a dedicated Bulletin allowance account. Chat sends use the
// phones' layout (spec 0013 HopDialect `legacy`); t3ams keeps the plain one.
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

// The app uploads in 2 MB chunks; allow AEAD overhead (12B nonce + 16B tag) plus
// a little slack before calling a chunk oversized.
const MAX_CHUNK_CIPHERTEXT = 2_000_000 + 64;
const HOP_CHUNK_PLAINTEXT_BYTES = 2_000_000;
const HASH_BYTES = 32;
const MIN_CHUNK_PLAINTEXT_BYTES = 64 * 1024;
const MAX_METADATA_CHUNKS = 4_096;
const HOP_DIALECTS = new Set(["legacy", "t3ams"]);
const CONTENT_HASH_ALGORITHMS = new Set(["sha256", "blake2b-256"]);
// The spec's "retry later" answers (base-spec.md "HOP Protocol" errors):
// PoolFull (1002) and RateLimited (1020). Everything else a node refuses
// (NotFound, InvalidSignature, NotRecipient, NotAuthorized) is final.
const HOP_RETRY_LATER_CODES = new Set([1002, 1020]);
const HOP_LAYOUTS = new Set(["versioned", "plain"]);
// iOS HandoffFileLoadConfig.inlineMargin: envelope bytes plus the AEAD's 28.
const INLINE_MARGIN = 64;
// A claim answers an entry as 0x-hex inside JSON. The devnet node sent a
// 2 MB entry in 33 s (about 60 KB/s of file bytes, 2026-09-24), so a fixed
// 30 s timeout failed on every full chunk. Timeouts scale with the bytes at a
// quarter of that rate: 2 MB -> 125 s per claim.
export const HOP_MIN_RATE_BYTES_PER_SEC = 16_000;
export const hopTimeoutFor = (bytes, floorMs) => Math.max(floorMs, Math.ceil((bytes / HOP_MIN_RATE_BYTES_PER_SEC) * 1000));

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
const VERSIONED_INLINE = Uint8Array.of(0, 0);
const VERSIONED_CHUNKED = Uint8Array.of(0, 1);

const chacha20Poly1305Decrypt = (rawKey, combined) => {
  if (combined.length < 12 + 16) throw new Error("ciphertext too short");
  const nonce = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("chacha20-poly1305", rawKey, nonce, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
};

const chacha20Poly1305Encrypt = (rawKey, plain) => {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("chacha20-poly1305", rawKey, nonce, { authTagLength: 16 });
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
const UNREADABLE = "unreadable HOP root entry";
// `{ totalSize: u64, chunks: Vec<[u8; 32]> }` from `offset` to the very end:
// { value } or { error }. The size and count bounds come first, before any
// allocation: a hostile node can encrypt any root under the peer's ticket.
const chunkedAt = (bytes, offset, maxBytes) => {
  if (offset + 9 > bytes.length) return { error: UNREADABLE };
  let totalSize = 0n;
  for (let i = 0; i < 8; i += 1) totalSize |= BigInt(bytes[offset + i]) << BigInt(8 * i);
  if (totalSize > BigInt(maxBytes)) return { error: `attachment larger than cap (${totalSize} bytes)` };
  let count;
  try { count = compactAt(bytes, offset + 8); } catch { return { error: UNREADABLE }; }
  const maxChunks = maxChunksFor(Number(totalSize));
  if (count.value > maxChunks) return { error: `attachment chunk list exceeds limit (${maxChunks})` };
  // Each item is compact(32) = 0x80 and 32 bytes, to the very end.
  const item = HASH_BYTES + 1;
  if (bytes.length - count.offset !== count.value * item) return { error: UNREADABLE };
  // A chunk list must be able to hold its size.
  if (totalSize > BigInt(count.value) * BigInt(MAX_CHUNK_CIPHERTEXT)) return { error: UNREADABLE };
  const chunkHashes = new Array(count.value);
  for (let i = 0; i < count.value; i += 1) {
    const at = count.offset + i * item;
    if (bytes[at] !== HASH_BYTES << 2) return { error: "invalid metadata chunk hash" };
    chunkHashes[i] = bytes.slice(at + 1, at + item);
  }
  return { value: { totalSize, chunkHashes } };
};
const inlineAt = (bytes, maxBytes) => {
  let len;
  try { len = compactAt(bytes, 2); } catch { return { error: UNREADABLE }; }
  if (len.offset + len.value !== bytes.length) return { error: UNREADABLE };
  if (len.value > maxBytes) return { error: `attachment larger than cap (${len.value} bytes)` };
  return { value: { inline: bytes.slice(len.offset) } };
};
// The decrypted root: the phones' envelope or the plain UploadedFile,
// whichever reads to the very end. Below 32 MiB both cannot read at once; if
// they ever do, the root is refused, not guessed. With no reading, the more
// specific error wins (a size over the cap, a chunk list over the limit).
const decodeRoot = (bytes, maxBytes) => {
  const versioned = bytes[0] !== 0 ? { error: UNREADABLE }
    : bytes[1] === 0 ? inlineAt(bytes, maxBytes)
      : bytes[1] === 1 ? chunkedAt(bytes, 2, maxBytes) : { error: UNREADABLE };
  const plain = chunkedAt(bytes, 0, maxBytes);
  if (versioned.value && plain.value) throw new Error(UNREADABLE);
  if (versioned.value) return { layout: "versioned", ...versioned.value };
  if (plain.value) return { layout: "plain", ...plain.value };
  throw new Error([plain.error, versioned.error].find((e) => e !== UNREADABLE) ?? UNREADABLE);
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
    if (msg.error) p.reject(Object.assign(new Error(`HOP ${msg.error.code ?? ""} ${String(msg.error.message ?? "error").slice(0, 500)}`.trim()), { code: msg.error.code }));
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
  filePath = null,
  // In-memory bytes instead of a file (a generated image).
  bytes = null,
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
  // "versioned" (the phone apps' envelope, what chat peers read) or "plain".
  layout = "versioned",
  log = () => {},
}) {
  requireDialect(dialect);
  if (!HOP_LAYOUTS.has(layout)) throw new Error("unsupported HOP root layout");
  const url = validateHopUrl(wssUrl, { allowInsecure, allowedNodes });
  if (bytes != null && !(bytes instanceof Uint8Array)) throw new Error("upload bytes must be a Uint8Array");
  if (bytes == null && (typeof filePath !== "string" || !filePath)) throw new Error("upload file path is required");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("maxBytes must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxRpcFrameBytes) || maxRpcFrameBytes < 1024) throw new Error("maxRpcFrameBytes must be a safe integer of at least 1024");
  if (!validSender(sender)) throw new Error("HOP upload sender must be an sr25519 keypair");
  const stat = bytes != null ? { size: bytes.length } : await fs.lstat(filePath);
  if (bytes == null && !stat.isFile()) throw new Error("HOP upload source must be a regular file");
  if (!Number.isSafeInteger(stat.size) || stat.size > maxBytes) throw new Error(`file exceeds upload cap (${maxBytes} bytes)`);

  const chunkSize = uploadChunkSize(maxRpcFrameBytes);
  const ticket = new Uint8Array(crypto.randomBytes(HASH_BYTES));
  const encryptionKey = blake2b32(textEncoder.encode("encryption"), ticket);
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

  const handle = bytes != null
    ? { read: null, stat: async () => ({ size: bytes.length }), close: async () => {} }
    : await fs.open(filePath, "r");
  const readPart = (size, position) => (bytes != null
    ? bytes.slice(position, position + size)
    : readExact(handle, size, position));
  const started = Date.now();
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
    let root;
    if (layout === "versioned" && stat.size <= chunkSize - INLINE_MARGIN) {
      // The phones put a small file inline in the root: one entry.
      root = concatBytes(VERSIONED_INLINE, scaleEncodeBytes(await readPart(stat.size, 0)));
    } else {
      for (let position = 0; position < stat.size; position += chunkSize) {
        const plain = await readPart(Math.min(chunkSize, stat.size - position), position);
        const encrypted = chacha20Poly1305Encrypt(encryptionKey, plain);
        if (encrypted.length > MAX_CHUNK_CIPHERTEXT) throw new Error("HOP upload chunk exceeds protocol limit");
        hashes.push(await submit(encrypted));
      }
      const chunked = encodeUploadedFile(stat.size, hashes);
      root = layout === "versioned" ? concatBytes(VERSIONED_CHUNKED, chunked) : chunked;
    }
    const encryptedRoot = chacha20Poly1305Encrypt(encryptionKey, root);
    if (encryptedRoot.length > MAX_CHUNK_CIPHERTEXT) throw new Error("HOP upload root exceeds protocol limit");
    const identifier = await submit(encryptedRoot);
    const after = await handle.stat();
    if (after.size !== stat.size) throw new Error("source file changed while it was being uploaded");
    log("HOP_UPLOADED", { host: url.hostname, id: toHex(identifier).slice(0, 18), bytes: stat.size, chunks: hashes.length, layout, ms: Date.now() - started });
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
  // Floors: the effective timeouts scale with the bytes (hopTimeoutFor).
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

  const encryptionKey = blake2b32(textEncoder.encode("encryption"), claimTicket);
  const secret = secretFromSeed(blake2b32(textEncoder.encode("signer"), claimTicket));
  const proofFor = (rawHash, context) =>
    toHex(new Uint8Array([1, ...sr25519Sign(secret, blake2b32(new Uint8Array([...context, ...rawHash])))]));

  // One claim returns at most one entry (<= 2 MB + 64); the whole download
  // at most maxBytes plus the root. Both timeouts scale with those bytes.
  const claimTimeoutMs = hopTimeoutFor(Math.min(MAX_CHUNK_CIPHERTEXT, maxBytes + INLINE_MARGIN), rpcTimeoutMs);
  const started = Date.now();
  const deadline = started + hopTimeoutFor(maxBytes + MAX_CHUNK_CIPHERTEXT, deadlineMs);
  const checkDeadline = () => { if (Date.now() > deadline) throw new Error("HOP download deadline exceeded"); };

  // State survives the single reconnect-and-resume retry below.
  let meta = null;
  const parts = [];
  let received = 0;
  let chunkIndex = 0;

  const runAttempt = async () => {
    const rpc = makeRpc(await openSocket(url, connectTimeoutMs), claimTimeoutMs, maxRpcFrameBytes);
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
        const root = decodeRoot(chacha20Poly1305Decrypt(encryptionKey, encryptedMetadata), maxBytes);
        meta = root.inline
          ? { layout: root.layout, totalSize: BigInt(root.inline.length), chunkHashes: [] }
          : { layout: root.layout, totalSize: root.totalSize, chunkHashes: root.chunkHashes };
        if (root.inline) {
          parts.push(root.inline);
          received = root.inline.length;
        }
        await ackBlob(identifier);
      }
      for (; chunkIndex < meta.chunkHashes.length; chunkIndex += 1) {
        const rawHash = meta.chunkHashes[chunkIndex];
        const encrypted = await claimBlob(rawHash);
        // The chunk hash is client-computed blake2b of the *encrypted* blob —
        // verify before decrypting so a wrong/poisoned blob fails loudly.
        if (Buffer.compare(blake2b32(encrypted), rawHash) !== 0) throw new Error("HOP chunk hash mismatch");
        const plain = chacha20Poly1305Decrypt(encryptionKey, encrypted);
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
    // One reconnect-and-resume retry: transient socket loss and the node's
    // own "retry later" answers shouldn't cost the whole download, but
    // integrity failures and final refusals fail immediately.
    const msg = String(error?.message ?? error);
    if (!/connection|connect|timeout/i.test(msg) && !HOP_RETRY_LATER_CODES.has(error?.code)) throw error;
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
  const ms = Date.now() - started;
  log("HOP_DOWNLOADED", {
    host: url.hostname, id: toHex(identifier).slice(0, 18), bytes: bytes.length, chunks: meta.chunkHashes.length, layout: meta.layout,
    ms, bytesPerSec: Math.round(bytes.length / Math.max(ms / 1000, 0.001)),
  });
  return bytes;
}
