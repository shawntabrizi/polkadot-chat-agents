import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMediaStore } from "../lib/media-store.mjs";

const makeStore = (opts = {}) =>
  createMediaStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "media-test-")), ...opts });

test("save + find round-trip with mime-derived extension", () => {
  const store = makeStore();
  const id = "ab".repeat(16);
  const saved = store.save(id, Uint8Array.of(1, 2, 3), "image/jpeg");
  assert.ok(saved.endsWith(`${id}.jpg`));
  const found = store.find(id);
  assert.equal(found.path, saved);
  assert.equal(found.mime, "image/jpeg");
});

test("ids that aren't plain hex are rejected (path traversal guard)", () => {
  const store = makeStore();
  for (const bad of ["../etc/passwd", "AB".repeat(16), "abc", "a".repeat(15), "id.jpg"]) {
    assert.equal(store.find(bad), null, `expected null for ${JSON.stringify(bad)}`);
    assert.throws(() => store.save(bad, Uint8Array.of(1), "image/jpeg"), /invalid media id/);
  }
});

test("sweep drops expired files and evicts oldest past the size cap", () => {
  const store = makeStore({ ttlHours: 1, maxTotalMb: 1 });
  const old = store.save("aa".repeat(16), Uint8Array.of(1), "image/png");
  fs.utimesSync(old, new Date(Date.now() - 2 * 3_600_000), new Date(Date.now() - 2 * 3_600_000));
  const big1 = store.save("bb".repeat(16), new Uint8Array(700 * 1024), "image/jpeg");
  fs.utimesSync(big1, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  const big2 = store.save("cc".repeat(16), new Uint8Array(700 * 1024), "image/jpeg");
  store.sweep();
  assert.equal(fs.existsSync(old), false, "expired file should be gone");
  assert.equal(fs.existsSync(big1), false, "oldest over-cap file should be evicted");
  assert.equal(fs.existsSync(big2), true, "newest file should survive");
});

test("save enforces the cache budget before an hourly sweep", () => {
  const store = makeStore({ maxTotalMb: 1 });
  const first = store.save("dd".repeat(16), new Uint8Array(700 * 1024), "image/jpeg");
  store.save("ee".repeat(16), new Uint8Array(700 * 1024), "image/jpeg");
  assert.equal(fs.existsSync(first), false, "oldest item should be evicted during admission");
  const total = fs.readdirSync(store.dir)
    .reduce((sum, name) => sum + fs.statSync(path.join(store.dir, name)).size, 0);
  assert.ok(total <= 1024 * 1024, `cache exceeded its configured budget: ${total}`);
  assert.throws(
    () => store.save("ff".repeat(16), new Uint8Array(2 * 1024 * 1024), "image/jpeg"),
    /exceeds media cache capacity/,
  );
});
