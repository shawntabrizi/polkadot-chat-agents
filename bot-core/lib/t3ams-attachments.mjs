// T3ams AttachmentRef validation.
//
// T3ams chat media is carried as an ordinary BCTS AttachmentRef, but its
// `storageUrl` is not a network URL.  The SPA encodes an encrypted Bulletin
// reference as `hop:` + base64url(JSON):
//
//   { v: 1, id, key, mime, size, name?, w?, h? }
//
// `key` is the per-file claim/decryption ticket.  Callers may persist the
// normalized result in the bot's private state in order to resume a download,
// but must never log it or expose it through a bridge API.  In particular,
// this module deliberately returns no raw storage URL: treating it like an
// ordinary URL is both an accidental secret leak and an SSRF footgun.

export const T3AMS_HOP_REF_VERSION = 1;
export const DEFAULT_T3AMS_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_T3AMS_ATTACHMENT_MAX_COUNT = 4;
export const DEFAULT_T3AMS_ATTACHMENT_MAX_URL_BYTES = 4096;
export const DEFAULT_T3AMS_ATTACHMENT_MAX_FILENAME_BYTES = 255;
export const DEFAULT_T3AMS_ATTACHMENT_MAX_DIMENSION = 100_000;

// This is a chat attachment policy, not an execution allowlist: downloaded
// files are staged as inert regular files and never opened or executed by the
// transport.  Cover the normal photo/document surface by default, including
// `application/octet-stream` for clients which cannot identify a document's
// exact MIME type.  Operators can still narrow this list with
// BOT_T3AMS_ATTACHMENT_MIME_TYPES on a public bot.
export const DEFAULT_T3AMS_ATTACHMENT_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/xml",
  "text/rtf",
  "application/json",
  "application/xml",
  "application/rtf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
]);

const HOP_HEX_RE = /^[0-9a-f]{64}$/;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const UNSAFE_FILENAME_RE = /[\u0000-\u001f\u007f\\/]/;
const HOP_FIELDS = new Set(["v", "id", "key", "mime", "size", "name", "w", "h"]);
const bareHex = (value) => String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();

export class T3amsAttachmentValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "T3amsAttachmentValidationError";
    this.code = code;
  }
}

const invalid = (code, message) => {
  throw new T3amsAttachmentValidationError(code, message);
};

const nonNegativeSafeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

const positiveSafeInteger = (value) => Number.isSafeInteger(value) && value > 0;

const safeLimit = (value, fallback, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a safe integer between ${min} and ${max}`);
  }
  return value;
};

const normalizeMime = (value, label) => {
  if (typeof value !== "string" || value !== value.trim()) invalid("T3AMS_ATTACHMENT_MIME", `${label} MIME type is invalid`);
  const mime = value.toLowerCase();
  if (!MIME_RE.test(mime)) invalid("T3AMS_ATTACHMENT_MIME", `${label} MIME type is invalid`);
  return mime;
};

const normalizeAllowedMimes = (value) => {
  if (!Array.isArray(value) && !(value instanceof Set)) throw new TypeError("allowedMimeTypes must be an array or Set");
  const result = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item !== item.trim()) throw new TypeError("allowedMimeTypes contains an invalid MIME type");
    const mime = item.toLowerCase();
    if (!MIME_RE.test(mime)) throw new TypeError("allowedMimeTypes contains an invalid MIME type");
    result.add(mime);
  }
  if (result.size === 0) throw new TypeError("allowedMimeTypes must not be empty");
  return result;
};

const normalizeFilename = (value, label, maxFilenameBytes) => {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    invalid("T3AMS_ATTACHMENT_FILENAME", `${label} filename is invalid`);
  }
  if (Buffer.byteLength(value, "utf8") > maxFilenameBytes || UNSAFE_FILENAME_RE.test(value)) {
    invalid("T3AMS_ATTACHMENT_FILENAME", `${label} filename is invalid`);
  }
  // Dot-only names are technically harmless when no caller uses this as a
  // path, but rejecting them makes that invariant explicit for future callers.
  if (value === "." || value === "..") invalid("T3AMS_ATTACHMENT_FILENAME", `${label} filename is invalid`);
  return value;
};

const bytesToHex = (bytes) => Buffer.from(bytes).toString("hex");

const requireBytes = (value, name, bytes) => {
  if (!(value instanceof Uint8Array) || value.byteLength !== bytes) {
    invalid("T3AMS_ATTACHMENT_REF", `${name} must be exactly ${bytes} bytes`);
  }
  return value;
};

const decodeBase64UrlJson = (payload) => {
  if (!BASE64_URL_RE.test(payload)) invalid("T3AMS_ATTACHMENT_HOP_URL", "attachment Hop reference is malformed");
  let bytes;
  try {
    bytes = Buffer.from(payload, "base64url");
  } catch {
    invalid("T3AMS_ATTACHMENT_HOP_URL", "attachment Hop reference is malformed");
  }
  // Node's decoder is intentionally permissive.  Re-encoding makes the
  // accepted wire form canonical and rejects malformed padding/trailing bits.
  if (bytes.length === 0 || bytes.toString("base64url") !== payload) {
    invalid("T3AMS_ATTACHMENT_HOP_URL", "attachment Hop reference is malformed");
  }
  let json;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("T3AMS_ATTACHMENT_HOP_URL", "attachment Hop reference is not UTF-8 JSON");
  }
  try {
    const parsed = JSON.parse(json);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalid("T3AMS_ATTACHMENT_HOP_SCHEMA", "attachment Hop reference schema is invalid");
    }
    return parsed;
  } catch (error) {
    if (error instanceof T3amsAttachmentValidationError) throw error;
    invalid("T3AMS_ATTACHMENT_HOP_SCHEMA", "attachment Hop reference schema is invalid");
  }
};

const optionalDimension = (value, label, maxDimension) => {
  if (value == null) return null;
  if (!positiveSafeInteger(value) || value > maxDimension) {
    invalid("T3AMS_ATTACHMENT_DIMENSIONS", `${label} dimensions are invalid`);
  }
  return value;
};

const normalizeDimensions = ({ width, height, label, maxDimension }) => {
  const normalizedWidth = optionalDimension(width, label, maxDimension);
  const normalizedHeight = optionalDimension(height, label, maxDimension);
  if ((normalizedWidth == null) !== (normalizedHeight == null)) {
    invalid("T3AMS_ATTACHMENT_DIMENSIONS", `${label} dimensions are incomplete`);
  }
  return { width: normalizedWidth, height: normalizedHeight };
};

const makeConfig = (options = {}) => ({
  maxBytes: safeLimit(options.maxBytes, DEFAULT_T3AMS_ATTACHMENT_MAX_BYTES, "maxBytes", { min: 0 }),
  maxUrlBytes: safeLimit(options.maxUrlBytes, DEFAULT_T3AMS_ATTACHMENT_MAX_URL_BYTES, "maxUrlBytes", { min: 64, max: 64 * 1024 }),
  maxFilenameBytes: safeLimit(options.maxFilenameBytes, DEFAULT_T3AMS_ATTACHMENT_MAX_FILENAME_BYTES, "maxFilenameBytes", { min: 1, max: 4096 }),
  maxDimension: safeLimit(options.maxDimension, DEFAULT_T3AMS_ATTACHMENT_MAX_DIMENSION, "maxDimension", { min: 1, max: 10_000_000 }),
  allowedMimeTypes: normalizeAllowedMimes(options.allowedMimeTypes ?? DEFAULT_T3AMS_ATTACHMENT_MIME_TYPES),
});

/**
 * Decode and validate a T3ams `hop:` storage reference without performing any
 * I/O.  It intentionally accepts no http(s), file, data, or arbitrary custom
 * schemes.  `claimTicketHex` is secret key material.
 */
export const parseT3amsHopReference = (storageUrl, options = {}) => {
  const config = makeConfig(options);
  if (typeof storageUrl !== "string" || Buffer.byteLength(storageUrl, "utf8") > config.maxUrlBytes) {
    invalid("T3AMS_ATTACHMENT_HOP_URL", "attachment Hop reference is invalid");
  }
  if (!storageUrl.startsWith("hop:")) invalid("T3AMS_ATTACHMENT_STORAGE", "attachment storage scheme is not supported");
  const payload = storageUrl.slice(4);
  const parsed = decodeBase64UrlJson(payload);
  const keys = Object.keys(parsed);
  if (keys.some((key) => !HOP_FIELDS.has(key))) {
    invalid("T3AMS_ATTACHMENT_HOP_SCHEMA", "attachment Hop reference contains unsupported fields");
  }
  if (parsed.v !== T3AMS_HOP_REF_VERSION || typeof parsed.id !== "string" || typeof parsed.key !== "string"
      || typeof parsed.mime !== "string" || !nonNegativeSafeInteger(parsed.size)) {
    invalid("T3AMS_ATTACHMENT_HOP_SCHEMA", "attachment Hop reference schema is invalid");
  }
  if (!HOP_HEX_RE.test(parsed.id) || !HOP_HEX_RE.test(parsed.key)) {
    invalid("T3AMS_ATTACHMENT_HOP_SCHEMA", "attachment Hop reference identifier is invalid");
  }
  if (parsed.size > config.maxBytes) invalid("T3AMS_ATTACHMENT_TOO_LARGE", "attachment exceeds the configured size limit");
  const mime = normalizeMime(parsed.mime, "Hop reference");
  if (!config.allowedMimeTypes.has(mime)) invalid("T3AMS_ATTACHMENT_UNSUPPORTED_MIME", "attachment MIME type is not supported");
  const filename = parsed.name == null ? null : normalizeFilename(parsed.name, "Hop reference", config.maxFilenameBytes);
  const dimensions = normalizeDimensions({ width: parsed.w, height: parsed.h, label: "Hop reference", maxDimension: config.maxDimension });
  return {
    hopId: parsed.id,
    claimTicketHex: parsed.key,
    mime,
    size: parsed.size,
    filename,
    ...dimensions,
  };
};

// Build the exact compact reference used by the T3ams SPA for an uploaded
// Bulletin file. Keeping this beside the parser prevents a second, subtly
// different serializer from accidentally widening the accepted wire format.
export const encodeT3amsHopReference = ({
  hopId,
  claimTicketHex,
  mime,
  size,
  filename = null,
  width = null,
  height = null,
} = {}, options = {}) => {
  const payload = {
    v: T3AMS_HOP_REF_VERSION,
    id: bareHex(hopId),
    key: bareHex(claimTicketHex),
    mime,
    size,
    ...(filename == null ? {} : { name: filename }),
    ...(width == null ? {} : { w: width }),
    ...(height == null ? {} : { h: height }),
  };
  const storageUrl = `hop:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  // Validate our own output so callers cannot create a ref which the inbound
  // policy would later reject. The return value intentionally contains the
  // ticket only in this private construction path.
  parseT3amsHopReference(storageUrl, options);
  return storageUrl;
};

/**
 * Validate one BCTS AttachmentRef and return the small, safe-to-route shape
 * used by a future T3ams downloader.  It carries the ticket only because a
 * durable private ingress journal needs it to resume an authenticated HOP
 * download after restart.  Do not put this object in logs or public bridge
 * payloads.
 */
export const normalizeT3amsAttachmentRef = (attachment, options = {}) => {
  const config = makeConfig(options);
  if (attachment == null || typeof attachment !== "object" || Array.isArray(attachment)) {
    invalid("T3AMS_ATTACHMENT_REF", "attachment reference is invalid");
  }
  const attachmentId = requireBytes(attachment.id, "attachment id", 32);
  const contentHash = requireBytes(attachment.hash, "attachment hash", 32);
  if (attachment.encryptionKey != null || attachment.thumbnailUrl != null || attachment.fileSignature != null) {
    invalid("T3AMS_ATTACHMENT_UNSUPPORTED_FIELDS", "attachment uses unsupported storage metadata");
  }
  const hop = parseT3amsHopReference(attachment.storageUrl, config);
  const mime = normalizeMime(attachment.mimeType, "attachment");
  if (!config.allowedMimeTypes.has(mime)) invalid("T3AMS_ATTACHMENT_UNSUPPORTED_MIME", "attachment MIME type is not supported");
  if (mime !== hop.mime) invalid("T3AMS_ATTACHMENT_METADATA_MISMATCH", "attachment MIME metadata does not match its Hop reference");
  if (!nonNegativeSafeInteger(attachment.fileSize) || attachment.fileSize > config.maxBytes) {
    invalid("T3AMS_ATTACHMENT_TOO_LARGE", "attachment size is invalid or exceeds the configured limit");
  }
  if (attachment.fileSize !== hop.size) {
    invalid("T3AMS_ATTACHMENT_METADATA_MISMATCH", "attachment size metadata does not match its Hop reference");
  }
  const filename = normalizeFilename(attachment.filename, "attachment", config.maxFilenameBytes);
  if (hop.filename != null && hop.filename !== filename) {
    invalid("T3AMS_ATTACHMENT_METADATA_MISMATCH", "attachment filename metadata does not match its Hop reference");
  }
  const dimensions = normalizeDimensions({
    width: attachment.width,
    height: attachment.height,
    label: "attachment",
    maxDimension: config.maxDimension,
  });
  if (hop.width != null && dimensions.width != null && (hop.width !== dimensions.width || hop.height !== dimensions.height)) {
    invalid("T3AMS_ATTACHMENT_METADATA_MISMATCH", "attachment dimensions do not match its Hop reference");
  }
  if (attachment.durationMs != null) {
    invalid("T3AMS_ATTACHMENT_UNSUPPORTED_FIELDS", "attachment duration metadata is not supported");
  }
  const width = hop.width ?? dimensions.width;
  const height = hop.height ?? dimensions.height;
  const kind = mime.startsWith("image/") ? "image" : "document";
  return {
    // `hopId` is the encrypted metadata blob hash. Use it—not AttachmentRef.id
    // (which the current SPA fills with zero bytes)—as an attachment identity.
    id: hop.hopId,
    hopId: hop.hopId,
    claimTicketHex: hop.claimTicketHex,
    contentHashHex: bytesToHex(contentHash),
    attachmentIdHex: bytesToHex(attachmentId),
    kind,
    mime,
    size: hop.size,
    filename,
    ...(width != null ? { width, height } : {}),
  };
};

/**
 * Normalize a bounded list of AttachmentRefs.  Callers can catch the typed
 * validation error for one attachment and turn only that item into a
 * brain-visible download failure note without leaking its ticket.
 */
export const normalizeT3amsAttachmentRefs = (attachments, options = {}) => {
  const maxCount = safeLimit(options.maxCount, DEFAULT_T3AMS_ATTACHMENT_MAX_COUNT, "maxCount", { min: 0, max: 128 });
  if (!Array.isArray(attachments)) invalid("T3AMS_ATTACHMENT_REF", "attachments must be an array");
  if (attachments.length > maxCount) invalid("T3AMS_ATTACHMENT_COUNT", "message has too many attachments");
  return attachments.map((attachment) => normalizeT3amsAttachmentRef(attachment, options));
};
