// Durable, peer-scoped file vault for chat attachments and bridge artifacts.
//
// The media store is deliberately an evictable cache. This store is the
// explicit long-lived surface: files live below one private root, every peer
// has a separate namespace, and a small manifest keeps MIME/type information
// without trusting file names or extensions.

import fs from "node:fs";
import path from "node:path";

const PEER_ID_RE = /^[0-9a-f]{64}$/;
const MAX_PATH_LENGTH = 240;
const MAX_PATH_SEGMENTS = 32;
const MAX_MIME_LENGTH = 255;

const fileStoreError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizePeer = (value) => {
  const peer = String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();
  if (!PEER_ID_RE.test(peer)) throw fileStoreError("invalid file namespace", "FILE_STORE_PEER_INVALID");
  return peer;
};

export const normalizeVaultPath = (value) => {
  if (typeof value !== "string") throw fileStoreError("file path is required", "FILE_STORE_PATH_INVALID");
  const raw = value.trim();
  if (!raw || raw.length > MAX_PATH_LENGTH || raw.includes("\0") || raw.includes("\\")) {
    throw fileStoreError("invalid file path", "FILE_STORE_PATH_INVALID");
  }
  if (raw.startsWith("/")) throw fileStoreError("file path must be relative", "FILE_STORE_PATH_INVALID");
  const parts = raw.split("/");
  if (parts.length > MAX_PATH_SEGMENTS || parts.some((part) => !part || part === "." || part === "..")) {
    throw fileStoreError("file path must not contain empty, dot, or parent segments", "FILE_STORE_PATH_INVALID");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw fileStoreError("file path escapes its namespace", "FILE_STORE_PATH_INVALID");
  }
  return normalized;
};

const normalizeMime = (value) => {
  const mime = String(value ?? "application/octet-stream").trim().toLowerCase();
  if (!mime || mime.length > MAX_MIME_LENGTH || /[\0\r\n]/.test(mime)) {
    throw fileStoreError("invalid file MIME type", "FILE_STORE_MIME_INVALID");
  }
  return mime;
};

const assertRegularFile = (filePath, label) => {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) throw fileStoreError(`${label} is not a regular file`, "FILE_STORE_FILE_INVALID");
  return stat;
};

const assertDirectory = (directory, label) => {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory()) throw fileStoreError(`${label} is not a directory`, "FILE_STORE_DIRECTORY_INVALID");
  return stat;
};

const fsyncDirectory = (directory) => {
  try {
    const descriptor = fs.openSync(directory, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch { /* directory fsync is not available on every filesystem */ }
};

const makeEntryKey = (peer, vaultPath) => `${peer}:${vaultPath}`;

export const createFileStore = ({
  dir,
  maxFileBytes = 50 * 1024 * 1024,
  maxTotalMb = 1024,
  maxEntries = 2000,
  maxPeerMb = Math.max(maxFileBytes / (1024 * 1024), Math.min(256, maxTotalMb)),
  maxPeerEntries = Math.min(500, maxEntries),
  log = () => {},
} = {}) => {
  if (typeof dir !== "string" || !dir) throw new Error("file store directory is required");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("invalid file store file capacity");
  const maxTotalBytes = Math.floor(Number(maxTotalMb) * 1024 * 1024);
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxFileBytes) {
    throw new Error("invalid file store total capacity");
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("invalid file store entry capacity");
  const maxPeerBytes = Math.floor(Number(maxPeerMb) * 1024 * 1024);
  if (!Number.isSafeInteger(maxPeerBytes) || maxPeerBytes < maxFileBytes || maxPeerBytes > maxTotalBytes) {
    throw new Error("invalid file store peer capacity");
  }
  if (!Number.isSafeInteger(maxPeerEntries) || maxPeerEntries < 1 || maxPeerEntries > maxEntries) {
    throw new Error("invalid file store peer entry capacity");
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  assertDirectory(dir, "file store root");
  const peersDir = path.join(dir, "peers");
  fs.mkdirSync(peersDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(peersDir, 0o700);
  assertDirectory(peersDir, "file store peer root");

  const manifestPath = path.join(dir, "manifest.json");
  const entries = new Map();
  let totalBytes = 0;
  const peerBytes = new Map();
  const peerEntries = new Map();
  let tempSequence = 0;

  const usageFor = (peer) => ({
    bytes: peerBytes.get(peer) ?? 0,
    entries: peerEntries.get(peer) ?? 0,
  });
  const adjustUsage = (peer, bytes, entriesCount) => {
    const current = usageFor(peer);
    const nextBytes = current.bytes + bytes;
    const nextEntries = current.entries + entriesCount;
    if (nextBytes < 0 || nextEntries < 0) throw new Error("file store usage accounting underflow");
    if (nextBytes === 0) peerBytes.delete(peer);
    else peerBytes.set(peer, nextBytes);
    if (nextEntries === 0) peerEntries.delete(peer);
    else peerEntries.set(peer, nextEntries);
  };
  const setEntry = (key, next) => {
    const previous = entries.get(key);
    if (previous) {
      entries.delete(key);
      totalBytes -= previous.size;
      adjustUsage(previous.peer, -previous.size, -1);
    }
    if (next) {
      entries.set(key, next);
      totalBytes += next.size;
      adjustUsage(next.peer, next.size, 1);
    }
  };

  const loadManifest = () => {
    if (!fs.existsSync(manifestPath)) return;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
    catch (error) { throw new Error(`file store manifest is unreadable: ${String(error?.message ?? error)}`); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > maxEntries) {
      throw new Error("file store manifest is invalid");
    }
    for (const raw of parsed.entries) {
      try {
        const peer = normalizePeer(raw?.peer);
        const vaultPath = normalizeVaultPath(raw?.path);
        const mime = normalizeMime(raw?.mime);
        const size = Number(raw?.size);
        const createdAt = Number(raw?.createdAt);
        const updatedAt = Number(raw?.updatedAt);
        if (!Number.isSafeInteger(size) || size < 0 || size > maxFileBytes
          || !Number.isSafeInteger(createdAt) || createdAt < 0
          || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
          throw new Error("invalid entry fields");
        }
        const key = makeEntryKey(peer, vaultPath);
        const peerUsage = usageFor(peer);
        if (entries.has(key) || totalBytes + size > maxTotalBytes
          || peerUsage.bytes + size > maxPeerBytes || peerUsage.entries >= maxPeerEntries) {
          throw new Error("duplicate or oversized entry");
        }
        const physicalPath = resolvePhysicalPath(peer, vaultPath, { createParents: false });
        const stat = assertRegularFile(physicalPath, "stored file");
        if (stat.size !== size) throw new Error("stored file size changed");
        setEntry(key, { peer, path: vaultPath, mime, size, createdAt, updatedAt });
      } catch (error) {
        throw new Error(`file store manifest contains an invalid entry: ${String(error?.message ?? error)}`);
      }
    }
  };

  const peerDirectory = (peer, { create = false } = {}) => {
    const directory = path.join(peersDir, peer);
    if (create && !fs.existsSync(directory)) {
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.chmodSync(directory, 0o700);
    }
    assertDirectory(directory, "file namespace");
    return directory;
  };

  const resolvePhysicalPath = (peer, vaultPath, { createParents = false } = {}) => {
    const namespace = peerDirectory(peer, { create: createParents });
    const parts = vaultPath.split("/");
    let current = namespace;
    for (const part of parts.slice(0, -1)) {
      const next = path.join(current, part);
      if (createParents && !fs.existsSync(next)) {
        fs.mkdirSync(next, { mode: 0o700 });
        fs.chmodSync(next, 0o700);
      }
      assertDirectory(next, "file path component");
      current = next;
    }
    const target = path.join(current, parts.at(-1));
    const rootPrefix = `${namespace}${path.sep}`;
    if (!target.startsWith(rootPrefix)) throw fileStoreError("file path escapes its namespace", "FILE_STORE_PATH_INVALID");
    return target;
  };

  const writeManifest = () => {
    const data = JSON.stringify({ version: 1, entries: [...entries.values()] });
    const temporary = `${manifestPath}.${process.pid}.${tempSequence += 1}.tmp`;
    let descriptor = null;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(descriptor, data);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, manifestPath);
      fs.chmodSync(manifestPath, 0o600);
      fsyncDirectory(dir);
    } catch (error) {
      try { if (descriptor != null) fs.closeSync(descriptor); } catch { /* best effort */ }
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      throw error;
    }
  };

  const entryFor = (peer, vaultPath) => entries.get(makeEntryKey(peer, vaultPath)) ?? null;

  const assertEntryFile = (entry) => {
    const filePath = resolvePhysicalPath(entry.peer, entry.path, { createParents: false });
    const stat = assertRegularFile(filePath, "stored file");
    if (stat.size !== entry.size) throw fileStoreError("stored file size changed", "FILE_STORE_FILE_INVALID");
    return filePath;
  };

  const admit = (existing, peer, size, overwrite) => {
    if (existing && !overwrite) throw fileStoreError("a saved file already exists at that path", "FILE_STORE_EXISTS");
    if (size > maxFileBytes) throw fileStoreError("file exceeds BOT_FILE_MAX_BYTES", "FILE_STORE_FILE_TOO_LARGE");
    if (!existing && entries.size >= maxEntries) throw fileStoreError("file vault has reached its entry limit", "FILE_STORE_ENTRY_LIMIT");
    const available = maxTotalBytes - totalBytes + (existing?.size ?? 0);
    if (size > available) throw fileStoreError("file vault is full", "FILE_STORE_FULL");
    const peerUsage = usageFor(peer);
    if (!existing && peerUsage.entries >= maxPeerEntries) {
      throw fileStoreError("file namespace has reached its entry limit", "FILE_STORE_PEER_ENTRY_LIMIT");
    }
    const peerAvailable = maxPeerBytes - peerUsage.bytes + (existing?.size ?? 0);
    if (size > peerAvailable) throw fileStoreError("file namespace is full", "FILE_STORE_PEER_FULL");
  };

  const replace = ({ peer, vaultPath, size, mime, overwrite, writeTemporary }) => {
    const key = makeEntryKey(peer, vaultPath);
    const existing = entryFor(peer, vaultPath);
    admit(existing, peer, size, overwrite);
    const destination = resolvePhysicalPath(peer, vaultPath, { createParents: true });
    const parent = path.dirname(destination);
    const temporary = path.join(parent, `.${path.basename(destination)}.${process.pid}.${tempSequence += 1}.tmp`);
    const backup = `${temporary}.backup`;
    let movedExisting = false;
    let movedTemporary = false;
    try {
      writeTemporary(temporary);
      const tempStat = assertRegularFile(temporary, "temporary file");
      if (tempStat.size !== size) throw fileStoreError("file changed while it was being stored", "FILE_STORE_FILE_INVALID");
      if (fs.existsSync(destination)) {
        assertRegularFile(destination, "existing stored file");
        fs.renameSync(destination, backup);
        movedExisting = true;
      }
      fs.renameSync(temporary, destination);
      movedTemporary = true;
      fs.chmodSync(destination, 0o600);
      const now = Date.now();
      const next = {
        peer,
        path: vaultPath,
        mime,
        size,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      setEntry(key, next);
      try {
        writeManifest();
      } catch (error) {
        setEntry(key, existing);
        try { fs.rmSync(destination, { force: true }); } catch { /* best effort */ }
        if (movedExisting) {
          try { fs.renameSync(backup, destination); } catch { /* best effort */ }
        }
        throw error;
      }
      try { if (movedExisting) fs.rmSync(backup, { force: true }); } catch { /* stale backup is harmless */ }
      fsyncDirectory(parent);
      log("BOT_FILE_SAVED", { peer, path: vaultPath, bytes: size, replaced: Boolean(existing) });
      return { ...next, filePath: destination };
    } catch (error) {
      try { if (!movedTemporary) fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      try { if (movedExisting && !fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination); } catch { /* best effort */ }
      throw error;
    }
  };

  const putBytes = (peerValue, pathValue, bytes, { mime, overwrite = false } = {}) => {
    const peer = normalizePeer(peerValue);
    const vaultPath = normalizeVaultPath(pathValue);
    const body = Buffer.from(bytes ?? []);
    return replace({
      peer,
      vaultPath,
      size: body.length,
      mime: normalizeMime(mime),
      overwrite: Boolean(overwrite),
      writeTemporary: (temporary) => fs.writeFileSync(temporary, body, { mode: 0o600, flag: "wx" }),
    });
  };

  const putFromPath = (peerValue, pathValue, sourcePath, { mime, overwrite = false } = {}) => {
    const peer = normalizePeer(peerValue);
    const vaultPath = normalizeVaultPath(pathValue);
    const sourceStat = assertRegularFile(sourcePath, "source file");
    return replace({
      peer,
      vaultPath,
      size: sourceStat.size,
      mime: normalizeMime(mime),
      overwrite: Boolean(overwrite),
      writeTemporary: (temporary) => {
        fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
        const after = assertRegularFile(sourcePath, "source file");
        if (after.size !== sourceStat.size) throw fileStoreError("source file changed while it was being stored", "FILE_STORE_FILE_INVALID");
      },
    });
  };

  const get = (peerValue, pathValue) => {
    const peer = normalizePeer(peerValue);
    const vaultPath = normalizeVaultPath(pathValue);
    const entry = entryFor(peer, vaultPath);
    if (!entry) return null;
    return { ...entry, filePath: assertEntryFile(entry) };
  };

  const list = (peerValue, prefixValue = "") => {
    const peer = normalizePeer(peerValue);
    const prefix = prefixValue ? normalizeVaultPath(prefixValue) : "";
    return [...entries.values()]
      .filter((entry) => entry.peer === peer && (!prefix || entry.path === prefix || entry.path.startsWith(`${prefix}/`)))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => ({ ...entry }));
  };

  const remove = (peerValue, pathValue) => {
    const peer = normalizePeer(peerValue);
    const vaultPath = normalizeVaultPath(pathValue);
    const key = makeEntryKey(peer, vaultPath);
    const existing = entries.get(key);
    if (!existing) return false;
    const destination = assertEntryFile(existing);
    const backup = `${destination}.${process.pid}.${tempSequence += 1}.delete`;
    fs.renameSync(destination, backup);
    setEntry(key, null);
    try {
      writeManifest();
    } catch (error) {
      setEntry(key, existing);
      try { fs.renameSync(backup, destination); } catch { /* best effort */ }
      throw error;
    }
    try { fs.rmSync(backup, { force: true }); } catch { /* stale deletion backup is harmless */ }
    fsyncDirectory(path.dirname(destination));
    log("BOT_FILE_REMOVED", { peer, path: vaultPath, bytes: existing.size });
    return true;
  };

  loadManifest();

  return {
    dir,
    putBytes,
    putFromPath,
    get,
    list,
    remove,
    stats: () => ({
      entries: entries.size,
      bytes: totalBytes,
      maxEntries,
      maxBytes: maxTotalBytes,
      maxFileBytes,
      maxPeerEntries,
      maxPeerBytes,
    }),
  };
};
