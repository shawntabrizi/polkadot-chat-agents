// T3ams Bulletin/HOP attachment transport.
//
// The T3ams SPA stores encrypted media on its Bulletin chain through the HOP
// RPC's positional parameter dialect. Attachment `storageUrl` values contain a
// per-file ticket but intentionally no endpoint, so this adapter uses exactly
// one operator-configured Bulletin RPC for both inbound claims and uploads.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import { createMediaStore } from "./media-store.mjs";
import { downloadP2PFile, uploadP2PFile, validateHopUrl } from "./hop-client.mjs";
import {
  encodeT3amsHopReference,
  normalizeT3amsAttachmentRefs,
} from "./t3ams-attachments.mjs";

// Keep this adapter independent from the chat protocol.  Besides avoiding an
// unnecessary module cycle, this means it can be contract-tested with only a
// tiny BCTS upload-ID stub.
const hexToBytes = (value) => {
  const clean = String(value ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error("invalid 32-byte attachment identifier");
  return new Uint8Array(Buffer.from(clean, "hex"));
};

const MAX_INFLIGHT_EXTRA_BYTES = 4 * 1024 * 1024;
const max = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
};
const cacheKeyFor = (attachment) => crypto.createHash("sha256")
  .update("t3ams-media-cache-v1\0")
  .update(attachment.hopId)
  .update("\0")
  .update(attachment.claimTicketHex)
  .update("\0")
  .update(attachment.contentHashHex)
  .update("\0")
  .update(String(attachment.size))
  .digest("hex");
const privateError = (error) => {
  const text = String(error?.message ?? error).replace(/[\r\n]+/g, " ").trim();
  return text ? text.slice(0, 240) : "media download failed";
};
const regularFile = (filePath, label) => {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  return stat;
};

/**
 * Create a private media cache and strict T3ams Bulletin adapter.
 *
 * `bulletinUrl` may be empty to explicitly disable byte retrieval. Metadata is
 * still routed safely in that mode; brains receive a readable unavailable-file
 * note instead of a dangerous fetch attempt.
 */
export const createT3amsMedia = ({
  bcts,
  bulletinUrl = "",
  uploadSigner = null,
  dir,
  attachmentOptions = {},
  ttlHours = 48,
  maxTotalMb = 512,
  maxConcurrentDownloads = 2,
  maxInflightBytes = null,
  downloadQueueCap = 100,
  timeoutMs = 120_000,
  rpcFrameMaxBytes = 4_500_000,
  allowInsecure = false,
  log = () => {},
} = {}) => {
  if (bcts == null || typeof bcts.generateARID !== "function") throw new Error("bcts.generateARID is required");
  if (typeof dir !== "string" || !dir) throw new Error("media cache directory is required");
  const normalizedUrl = String(bulletinUrl ?? "").trim();
  let rpcUrl = null;
  if (normalizedUrl) {
    let host;
    try { host = new URL(normalizedUrl).hostname; }
    catch { throw new Error("BOT_T3AMS_BULLETIN_RPC is invalid"); }
    rpcUrl = validateHopUrl(normalizedUrl, { allowInsecure, allowedNodes: [host] }).toString();
  }
  const maxBytes = max(attachmentOptions.maxBytes, 25 * 1024 * 1024, 1, 512 * 1024 * 1024);
  const concurrent = max(maxConcurrentDownloads, 2, 1, 64);
  const reserveFor = (bytes) => Math.max(1, bytes * 2 + MAX_INFLIGHT_EXTRA_BYTES);
  const inflightCap = max(
    maxInflightBytes,
    Math.max(reserveFor(maxBytes), 64 * 1024 * 1024),
    reserveFor(maxBytes),
    4 * 1024 * 1024 * 1024,
  );
  const queueCap = max(downloadQueueCap, 100, 1, 10_000);
  const mediaStore = createMediaStore({ dir, ttlHours, maxTotalMb, log });
  const inflight = new Map(); // cache key -> Promise<path>
  const queued = [];
  let active = 0;
  let reserved = 0;
  const drain = () => {
    while (active < concurrent && queued.length > 0) {
      const index = queued.findIndex((job) => reserved + job.reserve <= inflightCap);
      if (index < 0) return;
      const [job] = queued.splice(index, 1);
      active += 1;
      reserved += job.reserve;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        active -= 1;
        reserved -= job.reserve;
        drain();
      });
    }
  };
  const enqueue = (reserve, task) => new Promise((resolve, reject) => {
    if (queued.length >= queueCap) return reject(new Error("attachment download queue is full"));
    queued.push({ reserve, task, resolve, reject });
    drain();
  });
  const cached = (cacheId, attachment) => {
    const found = mediaStore.find(cacheId);
    if (!found) return null;
    try {
      const stat = regularFile(found.path, "cached attachment");
      return stat.size === attachment.size ? found.path : null;
    } catch {
      return null;
    }
  };
  const download = (attachment) => {
    if (rpcUrl == null) return Promise.reject(new Error("T3ams Bulletin media retrieval is not configured"));
    if (attachment == null || typeof attachment !== "object") return Promise.reject(new Error("invalid attachment"));
    const cacheId = cacheKeyFor(attachment);
    const present = cached(cacheId, attachment);
    if (present) return Promise.resolve(present);
    const existing = inflight.get(cacheId);
    if (existing) return existing;
    const promise = enqueue(reserveFor(attachment.size), async () => {
      const already = cached(cacheId, attachment);
      if (already) return already;
      const bytes = await downloadP2PFile({
        wssUrl: rpcUrl,
        identifier: hexToBytes(attachment.hopId),
        claimTicket: hexToBytes(attachment.claimTicketHex),
        expectedContentHash: hexToBytes(attachment.contentHashHex),
        contentHashAlgorithm: "blake2b-256",
        maxBytes: attachment.size,
        deadlineMs: timeoutMs,
        maxRpcFrameBytes: rpcFrameMaxBytes,
        allowInsecure,
        allowedNodes: [new URL(rpcUrl).hostname],
        dialect: "t3ams",
        log,
      });
      if (bytes.byteLength !== attachment.size) throw new Error("attachment size does not match authenticated metadata");
      const saved = mediaStore.save(cacheId, bytes, attachment.mime);
      log("T3AMS_MEDIA_DOWNLOADED", { id: attachment.id.slice(0, 16), mime: attachment.mime, bytes: bytes.byteLength });
      return saved;
    });
    inflight.set(cacheId, promise);
    promise.finally(() => {
      if (inflight.get(cacheId) === promise) inflight.delete(cacheId);
    }).catch(() => {});
    return promise;
  };
  const fetchAttachments = async (attachments) => {
    for (const attachment of attachments ?? []) {
      try {
        attachment.path = await download(attachment);
        attachment.downloaded = true;
        delete attachment.error;
      } catch (error) {
        attachment.downloaded = false;
        attachment.error = privateError(error);
        delete attachment.path;
        log("T3AMS_MEDIA_DOWNLOAD_FAILED", { id: String(attachment.id ?? "").slice(0, 16), error: attachment.error });
      }
    }
    return attachments;
  };
  const upload = async ({ filePath, mime, size = null, filename = null } = {}) => {
    if (rpcUrl == null) throw new Error("T3ams Bulletin media upload is not configured");
    if (uploadSigner == null) throw new Error("T3ams Bulletin upload signer is not configured");
    if (typeof filePath !== "string" || !filePath) throw new Error("file path is required");
    const stat = regularFile(filePath, "upload source");
    if (size != null && stat.size !== size) throw new Error("upload source changed before delivery");
    if (stat.size > maxBytes) throw new Error("file exceeds the T3ams attachment size limit");
    const safeName = path.basename(filename || filePath);
    const uploaded = await uploadP2PFile({
      filePath,
      wssUrl: rpcUrl,
      sender: uploadSigner,
      maxBytes,
      deadlineMs: timeoutMs,
      maxRpcFrameBytes: rpcFrameMaxBytes,
      allowInsecure,
      allowedNodes: [new URL(rpcUrl).hostname],
      dialect: "t3ams",
      log,
    });
    const after = regularFile(filePath, "upload source");
    if (after.size !== stat.size) throw new Error("upload source changed during delivery");
    const bytes = fs.readFileSync(filePath);
    if (bytes.byteLength !== stat.size) throw new Error("upload source changed during delivery");
    // The T3ams SPA uses unkeyed BLAKE2b-256 for AttachmentRef.hash. This is
    // separate from the HOP's encrypted-blob hashes and must match exactly so
    // clients can validate files uploaded by either side.
    const contentHash = blake2b(bytes, { dkLen: 32 });
    const storageUrl = encodeT3amsHopReference({
      hopId: Buffer.from(uploaded.identifier).toString("hex"),
      claimTicketHex: Buffer.from(uploaded.claimTicket).toString("hex"),
      mime,
      size: stat.size,
      filename: safeName,
    }, attachmentOptions);
    const ref = {
      id: bcts.generateARID(),
      hash: contentHash,
      storageUrl,
      mimeType: mime,
      fileSize: stat.size,
      filename: safeName,
    };
    const [attachment] = normalizeT3amsAttachmentRefs([ref], attachmentOptions);
    return { ref, attachment };
  };
  return {
    enabled: rpcUrl != null,
    bulletinUrl: rpcUrl,
    mediaStore,
    download,
    fetchAttachments,
    upload,
    findCached: (attachment) => cached(cacheKeyFor(attachment), attachment),
    sweep: () => mediaStore.sweep(),
    stats: () => ({ enabled: rpcUrl != null, active, queued: queued.length, reservedBytes: reserved, inflight: inflight.size }),
  };
};
