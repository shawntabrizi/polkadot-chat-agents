// One way to open a papi client on a named network: the metadata cache and
// an explicit wait for the runtime, so a storage read never carries the
// metadata download inside its own deadline.
//
// The public People and Bulletin nodes take up to a minute to serve
// `Metadata_metadata_at_version` (~500 KB through a runtime call), and
// papi's first storage read waits for it — longer than any read deadline
// here (a read that carries the download inside its 15 s looks like "the
// network is unreachable"). The cache, keyed by the runtime's code hash,
// makes only the first run after a runtime upgrade pay. Metadata is public
// and content-addressed: an entry is never stale and never secret. A broken
// cache must never break a chain read, so every failure below is silent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";

import { withTimeout } from "../vendor/lib/async-utils.mjs";

export const DEFAULT_METADATA_CACHE_DIR = process.env.PCA_METADATA_CACHE_DIR ?? path.join(os.homedir(), ".pca", "cache", "metadata");
/** The node answers a block query (a dead endpoint fails fast). */
export const CONNECT_TIMEOUT_MS = 12_000;
/** The runtime's metadata is loaded: a cache miss downloads it from the node. */
export const METADATA_TIMEOUT_MS = 90_000;

const entryPath = (dir, codeHash) => path.join(dir, `${String(codeHash).replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "")}.bin`);

/** The `{ getMetadata, setMetadata }` pair `createClient` takes; `onMiss(codeHash)` runs when the cache lacks the runtime. */
export function metadataCache({ dir = DEFAULT_METADATA_CACHE_DIR, onMiss = null } = {}) {
  return {
    async getMetadata(codeHash) {
      try { return new Uint8Array(fs.readFileSync(entryPath(dir, codeHash))); }
      catch { onMiss?.(codeHash); return null; }
    },
    setMetadata(codeHash, metadata) {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const target = entryPath(dir, codeHash);
        const tmp = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, metadata);
        fs.renameSync(tmp, target);
      } catch { /* best effort */ }
    },
  };
}

/** A papi client on `endpoints` (or a ready provider) with the metadata cache. */
export function createChainClient(endpoints, { provider = null, onMetadataMiss = null, cacheDir = DEFAULT_METADATA_CACHE_DIR } = {}) {
  return createClient(provider ?? getWsProvider([...endpoints]), metadataCache({ dir: cacheDir, onMiss: onMetadataMiss }));
}

/**
 * Wait until the client can serve storage reads: the node answers, and the
 * finalized block's runtime metadata is loaded. Resolves with the block.
 */
export async function awaitRuntime(client, { connectMs = CONNECT_TIMEOUT_MS, metadataMs = METADATA_TIMEOUT_MS } = {}) {
  const block = await withTimeout(client.getFinalizedBlock(), connectMs, "chain connect");
  await withTimeout(client.getMetadata(block.hash), metadataMs, "runtime metadata");
  return block;
}
