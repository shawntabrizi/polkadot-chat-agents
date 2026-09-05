// In-memory HOP node for the sandbox and for bot-core's offline tests: the
// store-and-forward pool chat attachments ride (chat-spec base-spec.md "HOP
// Protocol"), speaking JSON-RPC 2.0 over WebSocket — hop_submit, hop_claim,
// hop_ack, hop_poolStatus.
//
// Rules it enforces, from the spec and the real node (polkadot-sdk
// substrate/client/hop):
//
//   - hop_submit is signed: payload = blake2b_256("hop-submit-v1:" ‖
//     blake2b_256(data) ‖ u64le(submitTimestamp)), the signer a
//     MultiSigner::Sr25519 holding a Bulletin storage authorization. The
//     allowance set plays the chain: a signer outside it is `NotAuthorized`
//     (1012); a bad proof is `InvalidSignature` (1007); a timestamp far from
//     the node's clock is refused (the real node binds it to chain time).
//   - Recipients are ticket-derived MultiSigner::Sr25519 keys. hop_claim and
//     hop_ack are signed by a recipient over blake2b_256("hop-claim-v1:" ‖
//     hash) / ("hop-ack-v1:" ‖ hash); anyone else is `NotRecipient` (1008).
//   - A claim is read-only. An ack marks the recipient; once every recipient
//     acked, the entry's bytes are gone and the next claim is `NotFound`
//     (1004). With one ticket per file that makes a claim one-shot — the
//     reason a persona claims on one device only and the desktop renders a
//     placeholder instead of claiming.
//   - Size caps, the limits bot-core enforces on its side: one entry is at
//     most a 2 MB chunk plus AEAD overhead (`DataTooLarge`, 1001), the pool
//     is bounded (`PoolFull`, 1002), and a frame over 4.5 MB closes the
//     socket (1009).
//   - Params are accepted positional as the spec writes them
//     ([data, recipients, signature, signer, submitTimestamp]; [hash, signature])
//     and in bot-core's by-name form ({data, recipients, signature, signer,
//     submit_timestamp}; {raw_hash, signature}); both run the same checks.
//
// Not modelled: retention expiry and on-chain promotion (RFC-0001),
// per-account quotas, rate limits.
//
// Faults are first-class (see `faults`): a claim can be refused, cut off,
// delayed, answered with corrupt bytes, or told the entry is gone.

import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { blake2b } from "@noble/hashes/blake2.js";
import { secretFromSeed, getPublicKey, verify } from "@scure/sr25519";

const textEncoder = new TextEncoder();
const blake2b32 = (data, key) => blake2b(data, { dkLen: 32, key });
const toHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const fromHex = (hex) => new Uint8Array(Buffer.from(String(hex).replace(/^0x/i, ""), "hex"));
const normHex = (value) => (typeof value === "string" ? `0x${value.replace(/^0x/i, "").toLowerCase()}` : toHex(value));
const SUBMIT_CONTEXT = textEncoder.encode("hop-submit-v1:");
const CLAIM_CONTEXT = textEncoder.encode("hop-claim-v1:");
const ACK_CONTEXT = textEncoder.encode("hop-ack-v1:");
const log = (event, extra = {}) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...extra })}\n`);

/** The app's 2 MB chunk plus ChaCha20-Poly1305 overhead and a little slack (bot-core's MAX_CHUNK_CIPHERTEXT). */
export const HOP_MAX_ENTRY_BYTES = 2_000_000 + 64;
/** bot-core's BOT_HOP_RPC_FRAME_MAX_BYTES default. */
export const HOP_MAX_FRAME_BYTES = 4_500_000;
/** Room for one largest durable file (BOT_FILE_MAX_BYTES, 50 MB) with its metadata. */
export const HOP_MAX_POOL_BYTES = 64 * 1024 * 1024;
/** How far a submit timestamp may sit from the node's clock. */
export const HOP_MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const HOP_MAX_RECIPIENTS = 256;

// The spec's error table.
export const HOP_ERRORS = Object.freeze({
  DataTooLarge: 1001, PoolFull: 1002, NotFound: 1004, InvalidSignature: 1007, NotRecipient: 1008,
  UserQuotaExceeded: 1011, NotAuthorized: 1012, RateLimited: 1020,
});
class HopError extends Error {
  constructor(name, message) { super(message ?? name); this.name = name; this.code = HOP_ERRORS[name]; }
}

const chacha20Poly1305Encrypt = (rawKey, plain) => {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("chacha20-poly1305", rawKey, nonce, { authTagLength: 16 });
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

// bot-core's PCA transport sends one named object; the spec, the desktop
// SDK and bot-core's T3ams path send positional params. Normalize at the
// boundary so every dialect meets the same checks.
const submitRequest = (params) => {
  if (Array.isArray(params)) {
    if (params.length !== 5) throw new HopError("InvalidSignature", "invalid positional submit params");
    const [data, recipients, signature, signer, submitTimestamp] = params;
    return { data, recipients, signature, signer, submit_timestamp: submitTimestamp };
  }
  if (params == null || typeof params !== "object") throw new HopError("InvalidSignature", "invalid submit params");
  return params;
};
const claimRequest = (params) => {
  if (Array.isArray(params)) {
    if (params.length !== 2) throw new HopError("InvalidSignature", "invalid positional claim params");
    const [rawHash, signature] = params;
    return { raw_hash: rawHash, signature };
  }
  if (params == null || typeof params !== "object") throw new HopError("InvalidSignature", "invalid claim params");
  return params;
};

export const startHopNode = async ({
  port = 0,
  host = "127.0.0.1",
  allowances = null, // null = every signer may submit; a Set of account hex = only those (the Bulletin authorization)
  maxEntryBytes = HOP_MAX_ENTRY_BYTES,
  maxPoolBytes = HOP_MAX_POOL_BYTES,
  maxFrameBytes = HOP_MAX_FRAME_BYTES,
  maxClockSkewMs = HOP_MAX_CLOCK_SKEW_MS,
} = {}) => {
  // hashHex -> { hash, blob (null once removed), bytes, recipients: Set<pubHex>, signer, submittedAt, claims: [{recipient, at}], acks: Set<pubHex> }
  const entries = new Map();
  const order = []; // insertion order, for the listing
  const acked = new Set(); // hashHex, for bot-core's tests
  const submissions = [];
  const rpcCalls = [];
  const faultList = []; // { id, kind, method, hash, count, hits, ms, bytes }
  const watchers = new Set();
  let nextFault = 1;
  let poolBytes = 0;

  const wss = new WebSocketServer({ host, port, maxPayload: maxFrameBytes });
  await new Promise((resolve) => wss.once("listening", resolve));
  const url = `ws://${host}:${wss.address().port}`;
  const emit = (event) => { for (const fn of watchers) fn(event); };

  const poolStatus = () => ({ entryCount: [...entries.values()].filter((e) => e.blob).length, totalBytes: poolBytes, maxBytes: maxPoolBytes });

  const recipientProof = (entry, rawHash, signatureHex, context) => {
    const sig = fromHex(signatureHex);
    if (sig.length !== 65 || sig[0] !== 1) throw new HopError("InvalidSignature", "signature must be MultiSignature::Sr25519");
    const payload = blake2b32(concat(context, rawHash));
    for (const recipient of entry.recipients) {
      if (verify(payload, sig.subarray(1), fromHex(recipient))) return recipient;
    }
    throw new HopError("NotRecipient", "signer is not among the entry's recipients");
  };

  const checkSubmission = (params) => {
    const data = fromHex(params?.data);
    const signer = fromHex(params?.signer);
    const signature = fromHex(params?.signature);
    const recipients = params?.recipients;
    const timestamp = Number(params?.submit_timestamp);
    if (signer.length !== 33 || signer[0] !== 1) throw new HopError("InvalidSignature", "signer must be MultiSigner::Sr25519");
    if (signature.length !== 65 || signature[0] !== 1) throw new HopError("InvalidSignature", "signature must be MultiSignature::Sr25519");
    if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > HOP_MAX_RECIPIENTS) throw new HopError("InvalidSignature", `recipients must be 1..${HOP_MAX_RECIPIENTS}`);
    const recipientKeys = recipients.map((r) => {
      const key = fromHex(r);
      if (key.length !== 33 || key[0] !== 1) throw new HopError("InvalidSignature", "recipient must be MultiSigner::Sr25519");
      return toHex(key.subarray(1));
    });
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new HopError("InvalidSignature", "invalid submit timestamp");
    if (Math.abs(Date.now() - timestamp) > maxClockSkewMs) throw new HopError("InvalidSignature", "submit timestamp too far from node time");
    const hash = blake2b32(data);
    const proof = blake2b32(concat(SUBMIT_CONTEXT, hash, u64le(timestamp)));
    if (!verify(proof, signature.subarray(1), signer.subarray(1))) throw new HopError("InvalidSignature", "bad submit proof");
    const signerHex = toHex(signer.subarray(1));
    if (allowances != null && !allowances.has(signerHex)) throw new HopError("NotAuthorized", "submitting account has no Bulletin authorization");
    if (data.length > maxEntryBytes) throw new HopError("DataTooLarge", `entry exceeds ${maxEntryBytes} bytes`);
    if (poolBytes + data.length > maxPoolBytes) throw new HopError("PoolFull", "pool capacity exhausted");
    return { data, hash, recipients: recipientKeys, signer: signerHex };
  };

  const store = (hash, blob, recipients, signer) => {
    const key = toHex(hash);
    const entry = { hash: key, blob, bytes: blob.length, recipients: new Set(recipients), signer, submittedAt: Date.now(), claims: [], acks: new Set() };
    entries.set(key, entry);
    order.push(key);
    poolBytes += blob.length;
    return entry;
  };
  const requireEntry = (hashHex) => {
    const entry = entries.get(hashHex);
    if (!entry || !entry.blob) throw new HopError("NotFound", "entry missing: already removed or never stored");
    return entry;
  };
  const remove = (entry, reason) => {
    if (!entry.blob) return;
    poolBytes -= entry.bytes;
    entry.blob = null;
    entry.removedAt = Date.now();
    entry.removedReason = reason;
    emit({ event: "removed", hash: entry.hash, reason });
  };

  // ── Faults ──────────────────────────────────────────────────────────────
  // A fault matches a method (`claim` by default) and optionally one entry
  // hash; `count` hits spend it (null = until cleared).
  const faultView = (f) => ({ id: f.id, kind: f.kind, method: f.method, hash: f.hash, count: f.count, hits: f.hits, ...(f.ms != null ? { ms: f.ms } : {}), ...(f.bytes != null ? { bytes: f.bytes } : {}) });
  const matchingFault = (kind, method, hashHex) => faultList.find((f) => f.kind === kind && f.method === method && (f.hash == null || f.hash === hashHex));
  const hitFault = (fault, hashHex) => {
    fault.hits += 1;
    const spent = fault.count != null && fault.hits >= fault.count;
    if (spent) faultList.splice(faultList.indexOf(fault), 1);
    log("HOP_NODE_FAULT_HIT", { id: fault.id, kind: fault.kind, hits: fault.hits });
    emit({ event: "fault", action: "hit", ...faultView(fault), spent, entry: hashHex });
  };
  const addFault = (fault) => {
    const entry = { id: nextFault++, hits: 0, method: "claim", hash: null, count: 1, ...fault, hash: fault.hash ? normHex(fault.hash) : null };
    if (!["submit", "claim", "ack"].includes(entry.method)) throw new Error("fault method must be submit, claim or ack");
    faultList.push(entry);
    log("HOP_NODE_FAULT_SET", { id: entry.id, kind: entry.kind });
    emit({ event: "fault", action: "set", ...faultView(entry) });
    return { id: entry.id, clear: () => clearFault(entry) };
  };
  const clearFault = (entry) => {
    const i = faultList.indexOf(entry);
    if (i < 0) return;
    faultList.splice(i, 1);
    emit({ event: "fault", action: "cleared", ...faultView(entry) });
  };
  const faults = {
    /** The call is answered with an RPC error (`RateLimited`), like a node that says come back later. */
    refuse: (opts = {}) => addFault({ kind: "refuse", ...opts }),
    /** The socket is terminated when the call arrives: a transport loss mid-download. */
    cut: (opts = {}) => addFault({ kind: "cut", ...opts }),
    /** The call is answered `ms` later. */
    delay: ({ ms, ...opts } = {}) => { if (!(ms >= 0)) throw new Error("delay fault needs ms >= 0"); return addFault({ kind: "delay", ms, ...opts }); },
    /** A claim is told the entry is gone (`NotFound`), as after expiry or another recipient's ack. */
    drop: (opts = {}) => addFault({ kind: "drop", method: "claim", ...opts, method: "claim" }),
    /** A claim gets the blob with one byte flipped: the hash check fails downstream. */
    corrupt: (opts = {}) => addFault({ kind: "corrupt", ...opts, method: "claim" }),
    /** A claim is answered with a frame of `bytes` characters: a hostile-frame test. */
    bloat: ({ bytes, ...opts } = {}) => { if (!(bytes > 0)) throw new Error("bloat fault needs bytes > 0"); return addFault({ kind: "bloat", bytes, ...opts, method: "claim" }); },
    list: () => faultList.map(faultView),
    clear: (id = null) => {
      let cleared = 0;
      for (const entry of [...faultList]) if (id == null || entry.id === id) { clearFault(entry); cleared += 1; }
      return cleared;
    },
  };

  // ── RPC ─────────────────────────────────────────────────────────────────
  wss.on("connection", (ws) => {
    // A frame over maxPayload is an error event on the socket (ws closes it
    // with 1009); nothing to do beyond not crashing the node.
    ws.on("error", (e) => log("HOP_NODE_SOCKET_ERROR", { error: e.message }));
    ws.on("message", (data) => {
      let req;
      try { req = JSON.parse(data.toString()); } catch { return; }
      const method = String(req.method ?? "").replace(/^hop_/, "");
      rpcCalls.push({ method: req.method, positional: Array.isArray(req.params) });
      const reply = (body) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body })); };
      const fail = (error) => {
        const code = error instanceof HopError ? error.code : -32000;
        log("HOP_NODE_REFUSED", { method: req.method, code, error: error.message });
        emit({ event: "refused", method, code, error: error.message });
        reply({ error: { code, message: error.message } });
      };
      const hashOf = () => { try { return method === "submit" ? null : normHex(String(claimRequest(req.params).raw_hash)); } catch { return null; } };
      const target = hashOf();

      const run = () => {
        try {
          const refuse = matchingFault("refuse", method, target);
          if (refuse) { hitFault(refuse, target); throw new HopError("RateLimited", "per-account rate limit hit; retry later"); }
          const cut = matchingFault("cut", method, target);
          if (cut) { hitFault(cut, target); ws.terminate(); return; }

          if (method === "submit") {
            const submitted = checkSubmission(submitRequest(req.params));
            const entry = store(submitted.hash, submitted.data, submitted.recipients, submitted.signer);
            submissions.push({ hash: entry.hash, signer: submitted.signer, bytes: submitted.data.length });
            emit({ event: "submitted", hash: entry.hash, bytes: entry.bytes, signer: submitted.signer, recipients: submitted.recipients.length });
            return reply({ result: { poolStatus: poolStatus() } });
          }
          if (method === "claim") {
            const bloat = matchingFault("bloat", method, target);
            if (bloat) { hitFault(bloat, target); return reply({ result: "x".repeat(bloat.bytes) }); }
            const params = claimRequest(req.params);
            const drop = matchingFault("drop", method, target);
            if (drop) { hitFault(drop, target); throw new HopError("NotFound", "entry missing: already removed or expired"); }
            const entry = requireEntry(target);
            const recipient = recipientProof(entry, fromHex(params.raw_hash), params.signature, CLAIM_CONTEXT);
            entry.claims.push({ recipient, at: Date.now() });
            emit({ event: "claimed", hash: entry.hash, recipient, claims: entry.claims.length });
            const corrupt = matchingFault("corrupt", method, target);
            if (corrupt) {
              hitFault(corrupt, target);
              const bad = Uint8Array.from(entry.blob);
              bad[Math.min(20, bad.length - 1)] ^= 0xff;
              return reply({ result: toHex(bad) });
            }
            return reply({ result: toHex(entry.blob) });
          }
          if (method === "ack") {
            const params = claimRequest(req.params);
            const entry = requireEntry(target);
            const recipient = recipientProof(entry, fromHex(params.raw_hash), params.signature, ACK_CONTEXT);
            entry.acks.add(recipient);
            acked.add(entry.hash);
            emit({ event: "acked", hash: entry.hash, recipient, complete: entry.acks.size === entry.recipients.size });
            // Every recipient acknowledged: the pool is non-custodial, the bytes go.
            if ([...entry.recipients].every((r) => entry.acks.has(r))) remove(entry, "acked");
            return reply({ result: null });
          }
          if (method === "poolStatus") return reply({ result: poolStatus() });
          throw new Error(`unknown method ${req.method}`);
        } catch (e) {
          return fail(e);
        }
      };
      const delay = matchingFault("delay", method, target);
      if (delay) { hitFault(delay, target); setTimeout(run, delay.ms); return; }
      return run();
    });
  });

  // ── Test fixture: a file put straight into the pool ──────────────────────
  // Upload the way the app does, without a signer or an allowance: encrypt
  // 2 MB chunks with the ticket's key, store each under blake2b(encrypted),
  // then the UploadedFile metadata whose hash becomes the identifier. The
  // tamper options build the hostile cases bot-core's client must reject.
  const putFile = (bytes, {
    chunkSize = 2_000_000,
    tamperChunk = false,
    rehashTamper = false,
    totalSizeOverride = null,
    metadataOverride = null,
  } = {}) => {
    const claimTicket = new Uint8Array(crypto.randomBytes(32));
    const encryptionKey = blake2b32(textEncoder.encode("encryption"), claimTicket);
    const recipient = toHex(getPublicKey(secretFromSeed(blake2b32(textEncoder.encode("signer"), claimTicket))));
    const chunkHashes = [];
    for (let at = 0; at < bytes.length; at += chunkSize) {
      let blob = chacha20Poly1305Encrypt(encryptionKey, bytes.subarray(at, at + chunkSize));
      let hash = blake2b32(blob);
      if (tamperChunk && at === 0) {
        blob = Uint8Array.from(blob);
        blob[20] ^= 0xff; // corrupt ciphertext; hash now mismatches
        if (rehashTamper) hash = blake2b32(blob); // hash matches, AEAD auth fails
      }
      store(hash, blob, [recipient], null);
      chunkHashes.push(hash);
    }
    const metadata = metadataOverride ?? encodeUploadedFile(totalSizeOverride ?? bytes.length, chunkHashes);
    const metaBlob = chacha20Poly1305Encrypt(encryptionKey, metadata);
    const identifier = blake2b32(metaBlob);
    store(identifier, metaBlob, [recipient], null);
    return { identifier, claimTicket, wssUrl: url, chunks: chunkHashes };
  };

  // Read side for the inspector: every entry the pool ever held (removed ones
  // keep their record), oldest first. Never the bytes.
  const list = () => order.map((key) => {
    const e = entries.get(key);
    return {
      hash: e.hash, bytes: e.bytes, signer: e.signer, recipients: e.recipients.size, submittedAt: new Date(e.submittedAt).toISOString(),
      claims: e.claims.length, claimedAt: e.claims.length ? new Date(e.claims[0].at).toISOString() : null,
      acked: e.acks.size > 0 && [...e.recipients].every((r) => e.acks.has(r)),
      available: e.blob != null, ...(e.removedAt ? { removedAt: new Date(e.removedAt).toISOString(), reason: e.removedReason } : {}),
    };
  });

  return {
    url,
    port: wss.address().port,
    limits: { maxEntryBytes, maxPoolBytes, maxFrameBytes, maxClockSkewMs },
    allowances,
    putFile,
    acked,
    submissions,
    rpcCalls,
    faults,
    list,
    status: poolStatus,
    /** Pool events for the daemon's stream: submitted, claimed, acked, removed, refused, fault. */
    watch: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(resolve); }),
  };
};
