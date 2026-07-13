import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_T3AMS_ATTACHMENT_MAX_BYTES,
  T3amsAttachmentValidationError,
  normalizeT3amsAttachmentRef,
  normalizeT3amsAttachmentRefs,
  parseT3amsHopReference,
} from "../lib/t3ams-attachments.mjs";

const hex = (byte) => byte.repeat(64);
const bytes = (byte) => Uint8Array.from({ length: 32 }, () => Number.parseInt(byte, 16));

const hopUrl = (value) => `hop:${Buffer.from(JSON.stringify(value)).toString("base64url")}`;

const imageHop = ({
  id = hex("a"),
  key = hex("b"),
  mime = "image/png",
  size = 123,
  name = "sunset.png",
  w = 1600,
  h = 900,
  ...extra
} = {}) => hopUrl({ v: 1, id, key, mime, size, name, w, h, ...extra });

const imageRef = (overrides = {}) => ({
  // The SPA currently emits an all-zero AttachmentRef id for encrypted media.
  // A valid parser must not depend on it for cache identity.
  id: bytes("0"),
  hash: bytes("c"),
  storageUrl: imageHop(),
  mimeType: "image/png",
  fileSize: 123,
  filename: "sunset.png",
  width: 1600,
  height: 900,
  ...overrides,
});

const validationCode = (code) => (error) => error instanceof T3amsAttachmentValidationError && error.code === code;

test("normalizes an SPA-compatible encrypted image reference without returning its raw URL", () => {
  const normalized = normalizeT3amsAttachmentRef(imageRef());
  assert.deepEqual(normalized, {
    id: hex("a"),
    hopId: hex("a"),
    claimTicketHex: hex("b"),
    contentHashHex: "0c".repeat(32),
    attachmentIdHex: hex("0"),
    kind: "image",
    mime: "image/png",
    size: 123,
    filename: "sunset.png",
    width: 1600,
    height: 900,
  });
  assert.equal(Object.hasOwn(normalized, "storageUrl"), false);
});

test("accepts an allowlisted document with no image dimensions", () => {
  const ref = {
    id: bytes("d"),
    hash: bytes("e"),
    storageUrl: hopUrl({
      v: 1,
      id: hex("1"),
      key: hex("2"),
      mime: "application/pdf",
      size: 9,
      name: "report.pdf",
    }),
    mimeType: "application/pdf",
    fileSize: 9,
    filename: "report.pdf",
  };
  const normalized = normalizeT3amsAttachmentRef(ref);
  assert.equal(normalized.kind, "document");
  assert.equal(normalized.filename, "report.pdf");
  assert.equal(Object.hasOwn(normalized, "width"), false);
});

test("accepts a generic opaque document so clients can carry ordinary files", () => {
  const ref = {
    id: bytes("d"),
    hash: bytes("e"),
    storageUrl: hopUrl({
      v: 1,
      id: hex("1"),
      key: hex("2"),
      mime: "application/octet-stream",
      size: 17,
      name: "design-source.bin",
    }),
    mimeType: "application/octet-stream",
    fileSize: 17,
    filename: "design-source.bin",
  };
  assert.equal(normalizeT3amsAttachmentRef(ref).kind, "document");
});

test("accepts a missing optional Hop filename when the BCTS filename is safe", () => {
  const ref = imageRef({
    storageUrl: hopUrl({ v: 1, id: hex("a"), key: hex("b"), mime: "image/png", size: 123, w: 1600, h: 900 }),
  });
  assert.equal(normalizeT3amsAttachmentRef(ref).filename, "sunset.png");
});

test("rejects non-Hop and malformed storage references before any network I/O", () => {
  assert.throws(
    () => parseT3amsHopReference("https://attacker.example/file.png"),
    validationCode("T3AMS_ATTACHMENT_STORAGE"),
  );
  assert.throws(
    () => parseT3amsHopReference("hop:not valid base64!"),
    validationCode("T3AMS_ATTACHMENT_HOP_URL"),
  );
  assert.throws(
    () => parseT3amsHopReference(`hop:${Buffer.from("not json").toString("base64url")}`),
    validationCode("T3AMS_ATTACHMENT_HOP_SCHEMA"),
  );
});

test("rejects noncanonical or unknown Hop schema fields", () => {
  assert.throws(
    () => parseT3amsHopReference(imageHop({ extra: "unexpected" })),
    validationCode("T3AMS_ATTACHMENT_HOP_SCHEMA"),
  );
  assert.throws(
    () => parseT3amsHopReference(hopUrl({ v: 2, id: hex("a"), key: hex("b"), mime: "image/png", size: 1 })),
    validationCode("T3AMS_ATTACHMENT_HOP_SCHEMA"),
  );
  assert.throws(
    () => parseT3amsHopReference(hopUrl({ v: 1, id: hex("A"), key: hex("b"), mime: "image/png", size: 1 })),
    validationCode("T3AMS_ATTACHMENT_HOP_SCHEMA"),
  );
});

test("rejects MIME, size, filename, and dimension mismatches", () => {
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ mimeType: "image/jpeg" })),
    validationCode("T3AMS_ATTACHMENT_METADATA_MISMATCH"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ fileSize: 122 })),
    validationCode("T3AMS_ATTACHMENT_METADATA_MISMATCH"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ filename: "../sunset.png" })),
    validationCode("T3AMS_ATTACHMENT_FILENAME"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ width: 1601 })),
    validationCode("T3AMS_ATTACHMENT_METADATA_MISMATCH"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ storageUrl: hopUrl({ v: 1, id: hex("a"), key: hex("b"), mime: "image/png", size: 123, name: "sunset.png", w: 1600 }) })),
    validationCode("T3AMS_ATTACHMENT_DIMENSIONS"),
  );
});

test("rejects unsupported media and oversized references by default", () => {
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ mimeType: "application/zip", storageUrl: imageHop({ mime: "application/zip" }) })),
    validationCode("T3AMS_ATTACHMENT_UNSUPPORTED_MIME"),
  );
  assert.throws(
    () => parseT3amsHopReference(imageHop({ size: DEFAULT_T3AMS_ATTACHMENT_MAX_BYTES + 1 })),
    validationCode("T3AMS_ATTACHMENT_TOO_LARGE"),
  );
});

test("rejects generic BCTS attachment fields that this HOP adapter does not implement", () => {
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ encryptionKey: bytes("f") })),
    validationCode("T3AMS_ATTACHMENT_UNSUPPORTED_FIELDS"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ thumbnailUrl: "hop:elsewhere" })),
    validationCode("T3AMS_ATTACHMENT_UNSUPPORTED_FIELDS"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ durationMs: 1000 })),
    validationCode("T3AMS_ATTACHMENT_UNSUPPORTED_FIELDS"),
  );
});

test("enforces a bounded attachment list and supports an explicit MIME policy extension", () => {
  assert.throws(
    () => normalizeT3amsAttachmentRefs([imageRef(), imageRef()], { maxCount: 1 }),
    validationCode("T3AMS_ATTACHMENT_COUNT"),
  );
  const custom = imageRef({ mimeType: "application/vnd.custom.document", storageUrl: imageHop({ mime: "application/vnd.custom.document" }) });
  assert.equal(
    normalizeT3amsAttachmentRef(custom, { allowedMimeTypes: ["application/vnd.custom.document"] }).kind,
    "document",
  );
});
