import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_T3AMS_ATTACHMENT_MAX_BYTES,
  T3amsAttachmentValidationError,
  isT3amsAttachmentMimeAllowed,
  normalizeT3amsAttachmentRef,
  normalizeT3amsAttachmentRefs,
  parseT3amsHopReference,
} from "../../transports/t3ams/t3ams-attachments.mjs";

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

test("normalizes the T3ams composer's paired empty browser MIME as an opaque file", () => {
  // Browser File.type is allowed to be empty for an unknown extension. The
  // SPA preserves that value in both locations, so accept only the paired
  // form and expose a useful conventional MIME to downstream brains.
  const ref = {
    id: bytes("d"),
    hash: bytes("e"),
    storageUrl: hopUrl({
      v: 1,
      id: hex("1"),
      key: hex("2"),
      mime: "",
      size: 17,
      name: "workspace.custom-format",
    }),
    mimeType: "",
    fileSize: 17,
    filename: "workspace.custom-format",
  };
  const normalized = normalizeT3amsAttachmentRef(ref);
  assert.equal(normalized.kind, "document");
  assert.equal(normalized.mime, "application/octet-stream");
  // A raw HOP capability cannot establish that its BCTS partner also carried
  // the browser's empty MIME, so the public parser intentionally stays strict.
  assert.throws(
    () => parseT3amsHopReference(ref.storageUrl),
    validationCode("T3AMS_ATTACHMENT_MIME"),
  );

  // This is compatibility for one browser representation, not a way to make
  // either side of the authenticated metadata optional or mismatched.
  assert.throws(
    () => normalizeT3amsAttachmentRef({ ...ref, mimeType: "application/octet-stream" }),
    validationCode("T3AMS_ATTACHMENT_METADATA_MISMATCH"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef({
      ...ref,
      storageUrl: hopUrl({ v: 1, id: hex("1"), key: hex("2"), mime: "application/octet-stream", size: 17, name: "workspace.custom-format" }),
    }),
    validationCode("T3AMS_ATTACHMENT_METADATA_MISMATCH"),
  );
  assert.throws(
    () => normalizeT3amsAttachmentRef(ref, { allowedMimeTypes: ["image/*"] }),
    validationCode("T3AMS_ATTACHMENT_UNSUPPORTED_MIME"),
  );
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

test("accepts arbitrary valid file types by default and keeps the size cap", () => {
  const archive = normalizeT3amsAttachmentRef(imageRef({
    mimeType: "application/zip",
    storageUrl: imageHop({ mime: "application/zip", name: "workspace.zip" }),
    filename: "workspace.zip",
  }));
  assert.equal(archive.kind, "document");
  const video = normalizeT3amsAttachmentRef(imageRef({
    mimeType: "video/mp4",
    storageUrl: imageHop({ mime: "video/mp4", name: "walkthrough.mp4" }),
    filename: "walkthrough.mp4",
    durationMs: 12_345,
  }));
  assert.equal(video.kind, "video");
  assert.equal(video.durationMs, 12_345);
  const audio = normalizeT3amsAttachmentRef(imageRef({
    mimeType: "audio/ogg",
    storageUrl: imageHop({ mime: "audio/ogg", name: "voice.ogg" }),
    filename: "voice.ogg",
    durationMs: 1_000,
  }));
  assert.equal(audio.kind, "audio");
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
  assert.throws(() => normalizeT3amsAttachmentRef(imageRef({ durationMs: -1 })), validationCode("T3AMS_ATTACHMENT_DURATION"));
  assert.throws(() => normalizeT3amsAttachmentRef(imageRef({ durationMs: 8 * 24 * 60 * 60 * 1000 })), validationCode("T3AMS_ATTACHMENT_DURATION"));
});

test("enforces a bounded attachment list and supports exact and wildcard MIME policies", () => {
  assert.throws(
    () => normalizeT3amsAttachmentRefs([imageRef(), imageRef()], { maxCount: 1 }),
    validationCode("T3AMS_ATTACHMENT_COUNT"),
  );
  const custom = imageRef({ mimeType: "application/vnd.custom.document", storageUrl: imageHop({ mime: "application/vnd.custom.document" }) });
  assert.equal(
    normalizeT3amsAttachmentRef(custom, { allowedMimeTypes: ["application/vnd.custom.document"] }).kind,
    "document",
  );
  assert.equal(isT3amsAttachmentMimeAllowed(["video/*"], "video/mp4"), true);
  assert.equal(isT3amsAttachmentMimeAllowed(["video/*"], "audio/mpeg"), false);
  assert.equal(isT3amsAttachmentMimeAllowed(["*/*"], "application/x-custom-blob"), true);
  assert.throws(
    () => normalizeT3amsAttachmentRef(imageRef({ mimeType: "application/zip", storageUrl: imageHop({ mime: "application/zip" }) }), {
      allowedMimeTypes: ["image/*"],
    }),
    validationCode("T3AMS_ATTACHMENT_UNSUPPORTED_MIME"),
  );
});
