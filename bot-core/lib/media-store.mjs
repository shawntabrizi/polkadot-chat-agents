// Downloaded-attachment store: flat directory of files named
// <identifierHex>.<ext>. The identifier is the HOP metadata hash, so the id is
// stable across app resends (re-delivery of a message finds the file instead of
// re-downloading) and across restarts, with no index file to keep consistent.
// The strict id regex is the path-traversal guard for GET /media/:id.

import fs from "node:fs";
import path from "node:path";

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/xml": "xml",
  "application/json": "json",
  "application/xml": "xml",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const ID_PATTERN = /^[0-9a-f]{16,128}$/;

export const createMediaStore = ({ dir, ttlHours = 48, maxTotalMb = 512, log = () => {} }) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const capBytes = Math.floor(Number(maxTotalMb) * 1024 * 1024);
  if (!Number.isSafeInteger(capBytes) || capBytes < 1) throw new Error("invalid media cache capacity");

  const entries = () => fs.readdirSync(dir).flatMap((name) => {
    const filePath = path.join(dir, name);
    const stat = fs.lstatSync(filePath);
    // Never follow an unexpected symlink while accounting or evicting cache
    // entries. The state directory is private, but cache cleanup must not turn
    // a damaged directory into a path traversal primitive.
    return stat.isFile() ? [{ filePath, mtimeMs: stat.mtimeMs, size: stat.size }] : [];
  });

  // Evict before a write, not merely on the hourly maintenance pass. `exclude`
  // is an existing representation of the same identifier being replaced.
  const evictFor = (incomingBytes = 0, exclude = new Set()) => {
    const now = Date.now();
    const ttlMs = ttlHours * 3_600_000;
    let removed = 0;
    const kept = [];
    for (const entry of entries()) {
      if (exclude.has(entry.filePath)) continue;
      if (now - entry.mtimeMs > ttlMs) {
        fs.rmSync(entry.filePath, { force: true });
        removed += 1;
      } else {
        kept.push(entry);
      }
    }
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = kept.reduce((sum, entry) => sum + entry.size, 0);
    while (total + incomingBytes > capBytes && kept.length > 0) {
      const oldest = kept.shift();
      fs.rmSync(oldest.filePath, { force: true });
      total -= oldest.size;
      removed += 1;
    }
    if (removed > 0) log("BOT_MEDIA_SWEPT", { removed, kept: kept.length });
    return total + incomingBytes <= capBytes;
  };

  const find = (id) => {
    if (!ID_PATTERN.test(id)) return null;
    const name = fs.readdirSync(dir).find((n) => n.startsWith(`${id}.`));
    if (!name) return null;
    const ext = name.slice(id.length + 1);
    return { path: path.join(dir, name), mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  };

  const save = (id, bytes, mime) => {
    if (!ID_PATTERN.test(id)) throw new Error("invalid media id");
    const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : Number(bytes?.byteLength);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid media bytes");
    if (size > capBytes) throw new Error("attachment exceeds media cache capacity");
    const ext = EXT_BY_MIME[mime] ?? "bin";
    const filePath = path.join(dir, `${id}.${ext}`);
    // A resubmitted identifier can have a different extension if its metadata
    // changed. Remove every old representation only after enough capacity has
    // been made for the replacement.
    const previous = new Set(entries()
      .filter((entry) => path.basename(entry.filePath).startsWith(`${id}.`))
      .map((entry) => entry.filePath));
    if (!evictFor(size, previous)) throw new Error("media cache is full");
    for (const oldPath of previous) fs.rmSync(oldPath, { force: true });
    fs.writeFileSync(filePath, bytes, { mode: 0o600 });
    return filePath;
  };

  // Media is a cache, not a record: drop stale files and keep the total bounded
  // (oldest first) so a chatty peer can't fill the disk.
  const sweep = () => {
    try { evictFor(); } catch { /* cache maintenance is best effort */ }
  };

  return { dir, find, save, sweep };
};
