// The chain client's metadata cache and runtime wait. The public nodes take
// up to a minute to serve the runtime metadata, and papi's first storage
// read waits for it — so without the cache every read deadline in this
// repo can expire on a healthy chain and report "unreachable". The cache
// hands papi back exactly what it stored, keyed by the runtime's code hash,
// and a missing or unreadable entry is a miss, never an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { awaitRuntime, metadataCache } from "../lib/chain-client.mjs";

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-metadata-"));
const CODE_HASH = `0x${"ab".repeat(32)}`;

test("metadata cache: a miss reports the code hash and yields null; a hit returns the stored bytes untouched", async () => {
  const dir = path.join(scratch(), "nested", "cache"); // created on first write
  const misses = [];
  const cache = metadataCache({ dir, onMiss: (h) => misses.push(h) });
  assert.equal(await cache.getMetadata(CODE_HASH), null);
  assert.deepEqual(misses, [CODE_HASH]);
  const bytes = new Uint8Array([0x6d, 0x65, 0x74, 0x61, 0x0f, 0x00, 0xff]);
  cache.setMetadata(CODE_HASH, bytes);
  const hit = await cache.getMetadata(CODE_HASH);
  assert.ok(hit instanceof Uint8Array);
  assert.deepEqual([...hit], [...bytes]);
  assert.deepEqual(misses, [CODE_HASH], "a hit is not a miss");
  assert.equal(await metadataCache({ dir }).getMetadata(`0x${"cd".repeat(32)}`), null, "another runtime is a separate entry");
});

test("metadata cache: an unwritable dir or a bad hash never throws — the chain read goes on without the cache", async () => {
  const file = path.join(scratch(), "not-a-dir");
  fs.writeFileSync(file, "x");
  const cache = metadataCache({ dir: file });
  assert.doesNotThrow(() => cache.setMetadata(CODE_HASH, new Uint8Array([1])));
  assert.equal(await cache.getMetadata(CODE_HASH), null);
  assert.equal(await cache.getMetadata("../../etc/passwd"), null, "the entry name is only the hash's hex");
});

test("awaitRuntime: the node must answer within the connect deadline, then the metadata within its own, longer one", async () => {
  const block = { hash: "0x01", number: 7 };
  const calls = [];
  const client = {
    getFinalizedBlock: async () => { calls.push("block"); return block; },
    getMetadata: async (hash) => { calls.push(`metadata@${hash}`); await new Promise((r) => setTimeout(r, 30)); return new Uint8Array(1); },
  };
  assert.deepEqual(await awaitRuntime(client, { connectMs: 1_000, metadataMs: 1_000 }), block);
  assert.deepEqual(calls, ["block", "metadata@0x01"]);
  await assert.rejects(awaitRuntime(client, { connectMs: 1_000, metadataMs: 5 }), /runtime metadata timed out/);
  const dead = { getFinalizedBlock: () => new Promise(() => {}), getMetadata: async () => new Uint8Array(1) };
  await assert.rejects(awaitRuntime(dead, { connectMs: 5, metadataMs: 1_000 }), /chain connect timed out/);
});
