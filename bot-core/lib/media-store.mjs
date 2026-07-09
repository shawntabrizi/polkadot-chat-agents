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
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const ID_PATTERN = /^[0-9a-f]{16,128}$/;

export const createMediaStore = ({ dir, ttlHours = 48, maxTotalMb = 512, log = () => {} }) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const find = (id) => {
    if (!ID_PATTERN.test(id)) return null;
    const name = fs.readdirSync(dir).find((n) => n.startsWith(`${id}.`));
    if (!name) return null;
    const ext = name.slice(id.length + 1);
    return { path: path.join(dir, name), mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  };

  const save = (id, bytes, mime) => {
    if (!ID_PATTERN.test(id)) throw new Error("invalid media id");
    const ext = EXT_BY_MIME[mime] ?? "bin";
    const filePath = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(filePath, bytes, { mode: 0o600 });
    return filePath;
  };

  // Media is a cache, not a record: drop stale files and keep the total bounded
  // (oldest first) so a chatty peer can't fill the disk.
  const sweep = () => {
    let entries;
    try {
      entries = fs.readdirSync(dir).map((name) => {
        const filePath = path.join(dir, name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
      });
    } catch { return; }
    const now = Date.now();
    const ttlMs = ttlHours * 3_600_000;
    let removed = 0;
    const kept = [];
    for (const e of entries) {
      if (now - e.mtimeMs > ttlMs) { fs.rmSync(e.filePath, { force: true }); removed += 1; }
      else kept.push(e);
    }
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = kept.reduce((n, e) => n + e.size, 0);
    const cap = maxTotalMb * 1024 * 1024;
    while (total > cap && kept.length > 0) {
      const oldest = kept.shift();
      fs.rmSync(oldest.filePath, { force: true });
      total -= oldest.size;
      removed += 1;
    }
    if (removed > 0) log("BOT_MEDIA_SWEPT", { removed, kept: kept.length });
  };

  return { dir, find, save, sweep };
};
