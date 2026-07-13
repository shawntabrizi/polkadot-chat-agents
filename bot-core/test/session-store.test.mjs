import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStateStore } from "../lib/session-store.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-store-test-"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

test("save then load round-trips the data", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 1 });
  const data = { v: 1, peers: [{ peerHex: "ab", devices: [] }], seen: ["x"] };
  store.save(data);
  assert.equal(await store.flush(), true);
  assert.deepEqual(store.load(), data);
});

test("load returns null when the file is absent or corrupt", () => {
  const dir = tmp();
  assert.equal(createStateStore(path.join(dir, "missing.json")).load(), null);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.equal(createStateStore(bad).load(), null);
});

test("the state file is written 0600", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 1 });
  store.save({ v: 1 });
  assert.equal(await store.flush(), true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("flush waits for a durable write and clears the pending snapshot", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 10_000 }); // long debounce
  store.save({ v: 7 });
  assert.equal(await store.flush(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { v: 7 }); // present before debounce would fire
});

test("flush persists a newer save made during an in-flight write", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 10_000 });
  store.save({ v: 1, big: "a".repeat(1_000_000) });
  const flushing = store.flush();
  store.save({ v: 2 });
  assert.equal(await flushing, true);
  // The second save schedules the normal debounce while the first drain is
  // active. The drain already persisted it, so explicitly clear that inert
  // timer instead of leaving the test process alive for its 10-second delay.
  assert.equal(await store.flush(), true);
  assert.deepEqual(store.load(), { v: 2 });
});

test("write is atomic — a reader never sees a partial file", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 1 });
  store.save({ v: 1, big: "a".repeat(100000) });
  assert.equal(await store.flush(), true);
  // If writes went straight to `file` a crash mid-write would truncate it; the
  // store writes a .tmp then renames, so the live file is always complete JSON.
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith(".tmp")), false);
});

test("a failed background write retries after the filesystem recovers", async () => {
  const dir = tmp();
  const blockedParent = path.join(dir, "blocked");
  fs.writeFileSync(blockedParent, "not a directory");
  const file = path.join(blockedParent, "state.json");
  const store = createStateStore(file, { debounceMs: 1, retryMs: 10 });
  store.save({ v: 9 });
  assert.equal(await store.flush(), false, "the initial write must fail while the parent is a file");
  assert.equal(store.load(), null, "the initial write must fail while the parent is a file");

  fs.rmSync(blockedParent);
  fs.mkdirSync(blockedParent);
  for (let attempt = 0; attempt < 20 && store.load() == null; attempt += 1) await delay(10);
  assert.deepEqual(store.load(), { v: 9 }, "the retained snapshot should flush without another save call");
});
