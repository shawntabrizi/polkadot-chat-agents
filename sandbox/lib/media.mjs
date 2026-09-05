// Attachment bytes on disk and the metadata a message carries about them.
//
// A persona keeps what it sent and what it claimed under
// `<state dir>/personas/<name>/media/<identifierHex>.<ext>` (0600, like
// bot-core's media store); the daemon serves those files and nothing else.
// The identifier is the HOP metadata hash, so the file name is the id in
// the message and in the wire inspector. MIME and image dimensions are what
// the app puts in `FileMeta`: the kind (general/image/video) decides how a
// receiver renders a placeholder before the bytes arrive.

import fs from "node:fs";
import path from "node:path";

const MIME_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
};
const EXT_BY_MIME = Object.fromEntries(Object.entries(MIME_BY_EXT).map(([e, m]) => [m, e]));
EXT_BY_MIME["image/jpeg"] = "jpg";

export const mimeOf = (file) => MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
export const extOf = (mime) => EXT_BY_MIME[mime] ?? "bin";

/** `general`, `image` or `video`: the FileMeta variant a MIME type maps to. */
export const kindOf = (mime) => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "general");

/** Width and height from a PNG, JPEG or GIF header; null when unreadable. */
export function imageSize(bytes) {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segments to the first start-of-frame (SOF0..SOF15, not the DHT/JPG/DAC ones).
    let at = 2;
    while (at + 9 < b.length && b[at] === 0xff) {
      const marker = b[at + 1];
      const length = (b[at + 2] << 8) | b[at + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (b[at + 5] << 8) | b[at + 6], width: (b[at + 7] << 8) | b[at + 8] };
      }
      at += 2 + length;
    }
  }
  return null;
}

/** What a sender puts in the message for a file: the FileMeta fields, by kind. */
export function describeFile(bytes, mime) {
  const kind = kindOf(mime);
  const meta = { kind, mimeType: mime, fileSize: bytes.length };
  if (kind === "image") {
    const size = imageSize(bytes);
    // An image whose header cannot be read is sent as a general file rather than lied about.
    if (!size) return { ...meta, kind: "general" };
    return { ...meta, ...size };
  }
  if (kind === "video") return { ...meta, duration: 0 };
  return meta;
}

const ID = /^[0-9a-f]{64}$/;

/** One persona's media directory. Ids are 32-byte hashes as hex; that regex is the path guard. */
export function createMediaDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    dir,
    save(id, bytes, mime) {
      if (!ID.test(id)) throw new Error("invalid media id");
      const file = path.join(dir, `${id}.${extOf(mime)}`);
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      return file;
    },
    find(id) {
      if (!ID.test(id)) return null;
      const name = fs.readdirSync(dir).find((n) => n.startsWith(`${id}.`));
      if (!name) return null;
      const ext = name.slice(id.length + 1);
      return { path: path.join(dir, name), mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
    },
  };
}
