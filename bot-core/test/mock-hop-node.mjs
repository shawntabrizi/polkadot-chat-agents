// In-memory HOP store-and-forward node for offline tests. Speaks the same
// JSON-RPC-over-WebSocket dialect as the real nodes (hop_claim / hop_ack,
// params as one by-name object, 0x-hex binary fields) and verifies claim
// signatures exactly like the protocol specifies, so the client's crypto is
// exercised end-to-end without a network.

import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { blake2b } from "@noble/hashes/blake2.js";
import { secretFromSeed, getPublicKey, verify } from "@scure/sr25519";

const textEncoder = new TextEncoder();
const blake2b32 = (data, key) => blake2b(data, { dkLen: 32, key });
const toHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const fromHex = (hex) => new Uint8Array(Buffer.from(String(hex).replace(/^0x/i, ""), "hex"));
const SUBMIT_CONTEXT = textEncoder.encode("hop-submit-v1:");

const aesGcmEncrypt = (rawKey, plain) => {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", rawKey, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return new Uint8Array(Buffer.concat([nonce, ct, cipher.getAuthTag()]));
};

const compactLen = (n) => {
  if (n < 64) return Uint8Array.of(n << 2);
  if (n < 16_384) { const e = (n << 2) | 1; return Uint8Array.of(e & 0xff, e >> 8); }
  const e = (n << 2) | 2;
  return Uint8Array.of(e & 0xff, (e >> 8) & 0xff, (e >> 16) & 0xff, (e >> 24) & 0xff);
};
const u64le = (n) => {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const encodeUploadedFile = (totalSize, chunkHashes) => {
  const parts = [u64le(totalSize), compactLen(chunkHashes.length)];
  for (const h of chunkHashes) parts.push(compactLen(h.length), h);
  return new Uint8Array(Buffer.concat(parts));
};

export const startMockHopNode = async () => {
  const store = new Map(); // hashHex -> { blob, recipientPub }
  const acked = new Set(); // hashHex
  const submissions = [];
  const failures = { claim: 0, submit: 0, ack: false, dropConnections: 0, oversizedFrameBytes: 0 };

  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  const url = `ws://127.0.0.1:${wss.address().port}`;

  const checkProof = (entry, rawHash, signatureHex, context) => {
    const sig = fromHex(signatureHex);
    if (sig.length !== 65 || sig[0] !== 1) return false; // MultiSignature: sr25519
    const payload = blake2b32(new Uint8Array([...textEncoder.encode(context), ...rawHash]));
    return verify(payload, sig.subarray(1), entry.recipientPub);
  };

  const checkSubmission = (params) => {
    const data = fromHex(params?.data);
    const signer = fromHex(params?.signer);
    const signature = fromHex(params?.signature);
    const recipients = params?.recipients;
    const timestamp = Number(params?.submit_timestamp);
    if (signer.length !== 33 || signer[0] !== 1) throw new Error("invalid submit signer");
    if (signature.length !== 65 || signature[0] !== 1) throw new Error("invalid submit signature");
    if (!Array.isArray(recipients) || recipients.length !== 1) throw new Error("invalid submit recipients");
    const recipient = fromHex(recipients[0]);
    if (recipient.length !== 33 || recipient[0] !== 1) throw new Error("invalid submit recipient");
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("invalid submit timestamp");
    const hash = blake2b32(data);
    const proof = blake2b32(concat(SUBMIT_CONTEXT, hash, u64le(timestamp)));
    if (!verify(proof, signature.subarray(1), signer.subarray(1))) throw new Error("bad submit proof");
    return { data, hash, recipientPub: recipient.subarray(1), signer: signer.subarray(1) };
  };

  wss.on("connection", (ws) => {
    if (failures.dropConnections > 0) {
      failures.dropConnections -= 1;
      // Let the first claim arrive, then cut the socket to exercise resume.
      ws.once("message", () => ws.terminate());
      return;
    }
    ws.on("message", (data) => {
      let req;
      try { req = JSON.parse(data.toString()); } catch { return; }
      const reply = (body) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body }));
      const err = (message) => reply({ error: { code: -32000, message } });
      try {
        if (req.method === "hop_submit") {
          if (failures.submit > 0) { failures.submit -= 1; return err("simulated submit failure"); }
          const submitted = checkSubmission(req.params);
          store.set(toHex(submitted.hash), { blob: submitted.data, recipientPub: submitted.recipientPub });
          submissions.push({ hash: toHex(submitted.hash), signer: toHex(submitted.signer), bytes: submitted.data.length });
          return reply({ result: { poolStatus: { entryCount: store.size, totalBytes: 0, maxBytes: 10_000_000 } } });
        }
        if (req.method === "hop_claim") {
          if (failures.oversizedFrameBytes > 0) {
            const bytes = failures.oversizedFrameBytes;
            failures.oversizedFrameBytes = 0;
            return reply({ result: "x".repeat(bytes) });
          }
          if (failures.claim > 0) { failures.claim -= 1; return err("simulated failure"); }
          const rawHash = fromHex(req.params.raw_hash);
          const entry = store.get(toHex(rawHash));
          if (!entry) return err("no such entry");
          if (!checkProof(entry, rawHash, req.params.signature, "hop-claim-v1:")) return err("bad claim proof");
          return reply({ result: toHex(entry.blob) });
        }
        if (req.method === "hop_ack") {
          if (failures.ack) return err("simulated ack failure");
          const rawHash = fromHex(req.params.raw_hash);
          const entry = store.get(toHex(rawHash));
          if (!entry) return err("no such entry");
          if (!checkProof(entry, rawHash, req.params.signature, "hop-ack-v1:")) return err("bad ack proof");
          acked.add(toHex(rawHash));
          return reply({ result: null });
        }
        return err(`unknown method ${req.method}`);
      } catch (e) {
        return err(String(e?.message ?? e));
      }
    });
  });

  // Upload a file the way the app does: encrypt 2MB chunks with the ticket's
  // AES key, store each under blake2b(encrypted), then encrypt+store the
  // UploadedFile metadata whose hash becomes the message identifier.
  const putFile = (bytes, {
    chunkSize = 2_000_000,
    tamperChunk = false,
    rehashTamper = false,
    totalSizeOverride = null,
    metadataOverride = null,
  } = {}) => {
    const claimTicket = new Uint8Array(crypto.randomBytes(32));
    const aesKey = blake2b32(textEncoder.encode("encryption"), claimTicket);
    const recipientPub = getPublicKey(secretFromSeed(blake2b32(textEncoder.encode("signer"), claimTicket)));
    const chunkHashes = [];
    for (let at = 0; at < bytes.length; at += chunkSize) {
      let blob = aesGcmEncrypt(aesKey, bytes.subarray(at, at + chunkSize));
      let hash = blake2b32(blob);
      if (tamperChunk && at === 0) {
        blob = Uint8Array.from(blob);
        blob[20] ^= 0xff; // corrupt ciphertext; hash now mismatches
        if (rehashTamper) hash = blake2b32(blob); // hash matches, GCM auth fails
      }
      store.set(toHex(hash), { blob, recipientPub });
      chunkHashes.push(hash);
    }
    const metadata = metadataOverride ?? encodeUploadedFile(totalSizeOverride ?? bytes.length, chunkHashes);
    const metaBlob = aesGcmEncrypt(aesKey, metadata);
    const identifier = blake2b32(metaBlob);
    store.set(toHex(identifier), { blob: metaBlob, recipientPub });
    return { identifier, claimTicket, wssUrl: url };
  };

  return {
    url,
    putFile,
    acked,
    submissions,
    failures,
    close: () => new Promise((resolve) => wss.close(resolve)),
  };
};
