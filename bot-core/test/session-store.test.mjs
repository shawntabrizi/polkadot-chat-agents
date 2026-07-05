import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStateStore } from "../lib/session-store.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-store-test-"));
const settle = () => new Promise((r) => setTimeout(r, 30)); // let the debounce fire

test("save then load round-trips the data", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 1 });
  const data = { v: 1, peers: [{ peerHex: "ab", devices: [] }], seen: ["x"] };
  store.save(data);
  await settle();
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
  await settle();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("flush writes synchronously and clears the pending write", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 10_000 }); // long debounce
  store.save({ v: 7 });
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { v: 7 }); // present before debounce would fire
});

test("write is atomic — a reader never sees a partial file", async () => {
  const dir = tmp();
  const file = path.join(dir, "state.json");
  const store = createStateStore(file, { debounceMs: 1 });
  store.save({ v: 1, big: "a".repeat(100000) });
  await settle();
  // If writes went straight to `file` a crash mid-write would truncate it; the
  // store writes a .tmp then renames, so the live file is always complete JSON.
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});
