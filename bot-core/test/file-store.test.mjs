import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileStore, normalizeVaultPath } from "../lib/file-store.mjs";

const PEER_A = "aa".repeat(32);
const PEER_B = "bb".repeat(32);

const makeStore = (opts = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-store-test-"));
  return createFileStore({ dir, maxFileBytes: 1024 * 1024, maxTotalMb: 2, maxEntries: 10, ...opts });
};

test("stores a peer-scoped file durably with MIME metadata", () => {
  const store = makeStore();
  const saved = store.putBytes(PEER_A, "notes/plan.txt", Buffer.from("hello"), { mime: "text/plain" });
  assert.equal(saved.path, "notes/plan.txt");
  assert.equal(saved.mime, "text/plain");
  assert.equal(fs.readFileSync(saved.filePath, "utf8"), "hello");
  assert.deepEqual(store.stats(), {
    entries: 1,
    bytes: 5,
    maxEntries: 10,
    maxBytes: 2 * 1024 * 1024,
    maxFileBytes: 1024 * 1024,
    maxPeerEntries: 10,
    maxPeerBytes: 2 * 1024 * 1024,
  });

  const reopened = createFileStore({ dir: store.dir, maxFileBytes: 1024 * 1024, maxTotalMb: 2, maxEntries: 10 });
  const found = reopened.get(PEER_A, "notes/plan.txt");
  assert.equal(found.mime, "text/plain");
  assert.equal(fs.readFileSync(found.filePath, "utf8"), "hello");
});

test("namespaces files by peer and supports list and remove", () => {
  const store = makeStore();
  store.putBytes(PEER_A, "incoming/a.txt", Buffer.from("a"), { mime: "text/plain" });
  store.putBytes(PEER_A, "other.txt", Buffer.from("b"), { mime: "text/plain" });
  store.putBytes(PEER_B, "incoming/a.txt", Buffer.from("c"), { mime: "text/plain" });
  assert.equal(store.get(PEER_B, "other.txt"), null);
  assert.deepEqual(store.list(PEER_A, "incoming").map((entry) => entry.path), ["incoming/a.txt"]);
  assert.equal(store.remove(PEER_A, "incoming/a.txt"), true);
  assert.equal(store.remove(PEER_A, "incoming/a.txt"), false);
  assert.equal(store.get(PEER_A, "incoming/a.txt"), null);
  assert.equal(store.get(PEER_B, "incoming/a.txt").size, 1);
});

test("requires an explicit overwrite and enforces durable capacity", () => {
  const store = makeStore({ maxFileBytes: 10, maxTotalMb: 0.00002, maxEntries: 1 });
  store.putBytes(PEER_A, "one.txt", Buffer.from("12345"), { mime: "text/plain" });
  assert.throws(() => store.putBytes(PEER_A, "one.txt", Buffer.from("x"), { mime: "text/plain" }), /already exists/);
  store.putBytes(PEER_A, "one.txt", Buffer.from("12"), { mime: "text/plain", overwrite: true });
  assert.throws(() => store.putBytes(PEER_A, "two.txt", Buffer.from("x"), { mime: "text/plain" }), /entry limit/);
  assert.throws(() => store.putBytes(PEER_A, "large.txt", Buffer.alloc(11), { mime: "text/plain" }), /MAX_BYTES/);
});

test("enforces byte and entry capacity independently for each peer", () => {
  const store = makeStore({
    maxFileBytes: 10,
    maxTotalMb: 1,
    maxEntries: 10,
    maxPeerMb: 0.00001,
    maxPeerEntries: 1,
  });
  store.putBytes(PEER_A, "one.txt", Buffer.from("123456"), { mime: "text/plain" });
  assert.throws(
    () => store.putBytes(PEER_A, "two.txt", Buffer.from("x"), { mime: "text/plain" }),
    (error) => error?.code === "FILE_STORE_PEER_ENTRY_LIMIT",
  );
  store.putBytes(PEER_B, "one.txt", Buffer.from("123456"), { mime: "text/plain" });

  const byteBounded = makeStore({
    maxFileBytes: 10,
    maxTotalMb: 1,
    maxEntries: 10,
    maxPeerMb: 0.00001,
    maxPeerEntries: 10,
  });
  byteBounded.putBytes(PEER_A, "one.txt", Buffer.from("123456"), { mime: "text/plain" });
  assert.throws(
    () => byteBounded.putBytes(PEER_A, "two.txt", Buffer.from("12345"), { mime: "text/plain" }),
    (error) => error?.code === "FILE_STORE_PEER_FULL",
  );
  byteBounded.putBytes(PEER_B, "one.txt", Buffer.from("12345"), { mime: "text/plain" });
});

test("default peer capacity always admits the configured largest file", () => {
  const largestFile = 300 * 1024 * 1024;
  const store = makeStore({ maxFileBytes: largestFile, maxTotalMb: 512, maxEntries: 10 });
  assert.equal(store.stats().maxPeerBytes, largestFile);
});

test("rejects path escapes and never follows an injected namespace symlink", () => {
  for (const bad of ["", "../secret", "/etc/passwd", "dir//file", "dir/../file", "dir\\file", "./file"]) {
    assert.throws(() => normalizeVaultPath(bad), /file path/);
  }
  const store = makeStore();
  const peerDir = path.join(store.dir, "peers", PEER_A);
  fs.mkdirSync(peerDir, { recursive: true, mode: 0o700 });
  fs.symlinkSync(os.tmpdir(), path.join(peerDir, "escape"));
  assert.throws(
    () => store.putBytes(PEER_A, "escape/nope.txt", Buffer.from("no"), { mime: "text/plain" }),
    /file path component is not a directory/,
  );
});

test("copies a regular source file instead of retaining a cache reference", () => {
  const store = makeStore();
  const source = path.join(os.tmpdir(), `file-store-source-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(source, "source data", { mode: 0o600 });
    const saved = store.putFromPath(PEER_A, "copy.txt", source, { mime: "text/plain" });
    fs.writeFileSync(source, "changed", { mode: 0o600 });
    assert.equal(fs.readFileSync(saved.filePath, "utf8"), "source data");
  } finally {
    fs.rmSync(source, { force: true });
  }
});
