// Spec 0012 chunk crypto (polkadot-chat-desktop docs/spec/0012-attachments.md
// "Encryption"; bytes pinned in docs/spec/vectors-0012.md):
//   n        = ceil(size / chunkSize)
//   nonce_i  = nonce[0..8] : (nonce[8..12] XOR u32_be(i))
//   aad_i    = b"pcd-att-v1" : u32_le(i) : u32_le(n) : u64_le(size)
//   c_i      = AES-256-GCM(key, nonce_i, chunk_i, aad_i)   // ciphertext : tag(16)
//   chunks[i]= blake2b_256(c_i)                            // = Bulletin content_hash
//   cid_i    = "b" + base32(01 55 a0e402 20 : chunks[i])   // CIDv1, raw, blake2b-256
// The AAD binds position, count and size, so a swapped, dropped or truncated
// chunk fails the tag. Encryption is deterministic for (key, nonce, file):
// a re-store yields the same CIDs.
import crypto from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";

export const ATTACHMENT_CHUNK_SIZE = 2_000_000;
const AAD_PREFIX = Buffer.from("pcd-att-v1");
const TAG_BYTES = 16;

export const contentHash = (bytes) => blake2b(bytes, { dkLen: 32 });
export const chunkCount = (size, chunkSize) => Math.ceil(size / chunkSize);

export function chunkNonce(nonce, index) {
  const out = Buffer.from(nonce);
  if (out.length !== 12) throw new Error("attachment nonce must be 12 bytes");
  out.writeUInt32BE((out.readUInt32BE(8) ^ index) >>> 0, 8);
  return out;
}

export function chunkAad(index, count, size) {
  const out = Buffer.alloc(AAD_PREFIX.length + 16);
  AAD_PREFIX.copy(out, 0);
  out.writeUInt32LE(index, AAD_PREFIX.length);
  out.writeUInt32LE(count, AAD_PREFIX.length + 4);
  out.writeBigUInt64LE(BigInt(size), AAD_PREFIX.length + 8);
  return out;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const CID_PREFIX = Uint8Array.of(0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20);
export function cidOf(hash) {
  if (hash?.length !== 32) throw new Error("a content hash is 32 bytes");
  let bits = 0, value = 0, out = "b";
  for (const byte of [...CID_PREFIX, ...hash]) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function encryptChunk({ key, nonce, index, count, size, plaintext }) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, chunkNonce(nonce, index));
  cipher.setAAD(chunkAad(index, count, size));
  return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]));
}

export function decryptChunk({ key, nonce, index, count, size, ciphertext }) {
  if (ciphertext.length < TAG_BYTES) throw new Error("attachment chunk is shorter than its tag");
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, chunkNonce(nonce, index));
  decipher.setAAD(chunkAad(index, count, size));
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
  try {
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    throw new Error("Attachment is damaged");
  }
}

/** Encrypt a file: fresh key and nonce unless given. Returns the ciphertext chunks and their hashes. */
export function encryptAttachment(plaintext, { key = crypto.randomBytes(32), nonce = crypto.randomBytes(12), chunkSize = ATTACHMENT_CHUNK_SIZE } = {}) {
  const size = plaintext.length;
  if (size < 1) throw new Error("an attachment has at least 1 byte");
  const count = chunkCount(size, chunkSize);
  const ciphertexts = [];
  for (let index = 0; index < count; index += 1) {
    ciphertexts.push(encryptChunk({ key, nonce, index, count, size, plaintext: plaintext.subarray(index * chunkSize, (index + 1) * chunkSize) }));
  }
  return { key: new Uint8Array(key), nonce: new Uint8Array(nonce), chunkSize, size, ciphertexts, chunks: ciphertexts.map(contentHash) };
}

/** Check every chunk's hash, decrypt, and check the length. `att` is a decoded Attachment. */
export function decryptAttachment(att, ciphertexts) {
  const count = chunkCount(att.size, att.chunkSize);
  if (att.chunks.length !== count || ciphertexts.length !== count) throw new Error("attachment chunk count does not match its size");
  const parts = ciphertexts.map((ciphertext, index) => {
    if (!Buffer.from(contentHash(ciphertext)).equals(Buffer.from(att.chunks[index]))) throw new Error(`attachment chunk ${index} hash mismatch`);
    return decryptChunk({ key: att.key, nonce: att.nonce, index, count, size: att.size, ciphertext });
  });
  const plaintext = new Uint8Array(Buffer.concat(parts));
  if (plaintext.length !== att.size) throw new Error("attachment length does not match its size");
  return plaintext;
}
