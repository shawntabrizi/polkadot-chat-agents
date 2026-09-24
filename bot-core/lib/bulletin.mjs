// Spec 0012 attachments on the Bulletin chain, the bot side
// (polkadot-chat-desktop docs/spec/0012-attachments.md "Upload flow",
// "Download flow"). One module owns the Bulletin connection:
//   authorize  read Authorizations[Account(signer)] at the best block; on a
//              named testnet with BOT_BULLETIN_AUTHORIZER set (a public dev
//              key such as //Eve), grant the signer when it runs short
//   upload     encrypt (lib/attachment-crypto.mjs), check the budget, submit
//              TransactionStorage.store per chunk (nonces in sequence, all in
//              flight), wait for Stored { content_hash } in a BEST block (never
//              for finality: read at the best block, show finality)
//   download   per chunk: bitswap_v1_get(cid) on the RPC node, then the
//              message's mirror, then the network's gateway; each source is
//              untrusted, so the chunk's blake2b-256 must match before decrypt
// Cost of one attachment: ceil(size / 2 MB) feeless transactions, and zero
// extra statements (the kind-250 message rides the normal DM path).
import fs from "node:fs";
import path from "node:path";
import { AccountId, Enum } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { DEV_PHRASE, mnemonicToMiniSecret } from "@polkadot-labs/hdkd-helpers";
import { createChainClient } from "./chain-client.mjs";
import { bulletinPaseoNextV2, productsDevnetBulletin } from "./descriptors.mjs";
import { PASEO, PRODUCTS_DEVNET } from "./network-config.mjs";
import { describeTestnetFileAllowance } from "./testnet-file-allowance.mjs";
import { chunkCount, cidOf, contentHash, decryptAttachment, encryptAttachment } from "./attachment-crypto.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";

export const BULLETIN_RETENTION_MS = 14 * 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const AT_BEST = Object.freeze({ at: "best" });
const hex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(String(h).replace(/^0x/i, ""), "hex"));

// A public dev authorizer may sign only on these chains (genesis-pinned).
const TESTNET_GENESES = Object.freeze({
  [String(productsDevnetBulletin.genesis).toLowerCase()]: PRODUCTS_DEVNET.bulletin.name,
  [String(bulletinPaseoNextV2.genesis).toLowerCase()]: PASEO.bulletin.name,
});
const PROFILE_BULLETIN = Object.freeze({
  [PRODUCTS_DEVNET.id]: { genesis: productsDevnetBulletin.genesis, gateway: "https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/" },
  [PASEO.id]: { genesis: bulletinPaseoNextV2.genesis, gateway: "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/" },
});

/**
 * Bulletin settings from the environment and the network profile, or null
 * when the bot has no Bulletin network (the sandbox, unless configured).
 *   BOT_BULLETIN_ENDPOINT    RPC node (default: the profile's Bulletin node)
 *   BOT_BULLETIN_GATEWAY     HTTPS IPFS gateway prefix ending in /ipfs/
 *   BOT_BULLETIN_AUTHORIZER  testnets only: a dev derivation path ("//Eve")
 *   BOT_BULLETIN_BUDGET_MB / BOT_BULLETIN_BUDGET_TXS  uploads per UTC day
 */
export function bulletinConfig(env, profile) {
  const defaults = PROFILE_BULLETIN[profile?.id] ?? {};
  const endpoint = String(env.BOT_BULLETIN_ENDPOINT ?? profile?.bulletin?.rpcEndpoint ?? "").trim();
  if (!endpoint) return null;
  const authorizer = String(env.BOT_BULLETIN_AUTHORIZER ?? "").trim() || null;
  if (authorizer && !/^(\/\/[A-Za-z0-9_-]+)+$/.test(authorizer)) {
    throw new Error("BOT_BULLETIN_AUTHORIZER must be a dev derivation path such as //Eve");
  }
  const mb = Number(env.BOT_BULLETIN_BUDGET_MB ?? 64);
  const txs = Number(env.BOT_BULLETIN_BUDGET_TXS ?? 100);
  if (!(mb > 0) || !Number.isInteger(txs) || txs < 1) throw new Error("BOT_BULLETIN_BUDGET_MB and BOT_BULLETIN_BUDGET_TXS must be positive");
  return {
    endpoint,
    gateway: String(env.BOT_BULLETIN_GATEWAY ?? defaults.gateway ?? "").trim() || null,
    genesis: defaults.genesis ? String(defaults.genesis).toLowerCase() : null,
    authorizer,
    budgetLimit: { bytes: Math.floor(mb * 1024 * 1024), transactions: txs },
  };
}

// The per-bot upload budget: a UTC-day ledger in the state directory. The
// chain does not stop a store over the authorization (it only loses priority),
// so the bot meters itself (0012 "Budget check").
export function createUploadBudget({ limit, file = null, now = Date.now }) {
  const today = () => new Date(now()).toISOString().slice(0, 10);
  let ledger = { day: today(), bytes: 0, transactions: 0 };
  try { if (file) ledger = { ...ledger, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { /* fresh */ }
  const current = () => (ledger.day === today() ? ledger : (ledger = { day: today(), bytes: 0, transactions: 0 }));
  return {
    left: () => ({ bytes: limit.bytes - current().bytes, transactions: limit.transactions - current().transactions }),
    check(bytes, transactions) {
      const l = this.left();
      if (bytes > l.bytes || transactions > l.transactions) {
        throw new Error(`upload budget exceeded: ${bytes} bytes / ${transactions} transactions asked, ${Math.max(0, l.bytes)} bytes / ${Math.max(0, l.transactions)} left today`);
      }
    },
    spend(bytes, transactions) {
      const c = current();
      c.bytes += bytes; c.transactions += transactions;
      if (!file) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
      } catch { /* the in-memory ledger still holds */ }
    },
  };
}

export function devAuthorizerSigner(derivationPath) {
  const pair = deriveSr25519PairFromSeed(mnemonicToMiniSecret(DEV_PHRASE), derivationPath);
  return getPolkadotSigner(pair.publicKey, "Sr25519", pair.sign);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Watch a signed extrinsic until it is in a best block; resolves with papi's txBestBlocksState event. */
function untilBestBlock(tx, signer, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    let sub = null;
    const done = () => { clearTimeout(timer); sub?.unsubscribe(); };
    const timer = setTimeout(() => { done(); reject(new Error("not in a best block in time")); }, timeoutMs);
    sub = tx.signSubmitAndWatch(signer, options).subscribe({
      next: (e) => {
        if (e.type === "txBestBlocksState" && e.found) {
          done();
          if (e.ok) resolve(e);
          else reject(new Error(`dispatch failed: ${JSON.stringify(e.dispatchError, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`));
        }
      },
      error: (err) => { done(); reject(err); },
    });
  });
}

export function createBulletin({
  endpoint,
  gateway = null,
  genesis = null,
  signerPair,
  authorizer = null,
  budget,
  log = () => {},
  fetchImpl = fetch,
  now = Date.now,
  makeClient = () => createChainClient([endpoint]),
  sourceTimeoutMs = 30_000,
  bestBlockTimeoutMs = 60_000,
  retryDelaysMs = [10_000, 30_000, 90_000],
  pollMs = 2_000,
}) {
  const address = AccountId().dec(signerPair.publicKey);
  const rpcHttpUrl = endpoint.replace(/^ws(s?):\/\//i, "http$1://");
  const signer = getPolkadotSigner(signerPair.publicKey, "Sr25519", signerPair.sign);
  let ready = null;
  const connect = () => (ready ??= (async () => {
    const client = makeClient();
    try {
      const spec = await withTimeout(client.getChainSpecData(), 30_000, "Bulletin chain identity");
      const actual = String(spec?.genesisHash ?? "").toLowerCase();
      if (genesis && actual !== genesis) throw new Error(`Bulletin endpoint serves ${actual}, expected ${genesis}`);
      return { client, api: client.getUnsafeApi(), genesis: actual };
    } catch (error) {
      client.destroy?.();
      ready = null;
      throw error;
    }
  })());

  const readAuthorization = async () => {
    const { api } = await connect();
    const [authorization, block] = await Promise.all([
      api.query.TransactionStorage.Authorizations.getValue(Enum("Account", address), AT_BEST),
      api.query.System.Number.getValue(AT_BEST),
    ]);
    return describeTestnetFileAllowance(authorization, block);
  };

  // The chain's authorization, then (testnets only) a dev grant when short.
  const ensureAuthorized = async ({ transactions, bytes }) => {
    const status = await readAuthorization();
    const enough = status.active && status.remainingTransactions >= transactions && status.remainingBytes >= BigInt(bytes);
    if (enough) return { action: "already-authorized", ...status };
    const { api, genesis: actual } = await connect();
    if (!authorizer) throw new Error(`Bulletin storage is not authorized for ${address} (${status.remainingTransactions ?? 0} transactions, ${status.remainingBytes ?? 0n} bytes left)`);
    if (!TESTNET_GENESES[actual]) throw new Error("a dev authorizer may sign only on a named testnet Bulletin chain");
    const grant = { transactions: Math.max(100, transactions), bytes: BigInt(Math.max(64 * 1024 * 1024, bytes)) };
    const started = now();
    const result = await untilBestBlock(
      api.tx.TransactionStorage.authorize_account({ who: address, ...grant }),
      devAuthorizerSigner(authorizer), {}, bestBlockTimeoutMs,
    );
    log("BOT_BULLETIN_AUTHORIZED", { account: address, authorizer, transactions: grant.transactions, bytes: String(grant.bytes), block: result.block.number, txHash: result.txHash, ms: now() - started });
    return { action: "authorized", txHash: result.txHash, block: result.block.number, ...(await readAuthorization()) };
  };

  // Plain HTTP JSON-RPC on the same node for the reads that carry a chunk or
  // wait on one, so a slow 4 MB hex answer (bitswap_v1_get of a 2 MB chunk
  // took 30-33 s on devnet) never queues the other reads behind it on the
  // shared WebSocket. papi's transaction watch is not used for stores: in the
  // first devnet runs it missed 2 MB stores that TransactionByContentHash showed.
  const rpc = async (method, params, timeoutMs = sourceTimeoutMs) => {
    const response = await fetchImpl(rpcHttpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}${body.error.data ? ` (${String(body.error.data).slice(0, 160)})` : ""}`);
    return body.result;
  };

  // TransactionByContentHash(hash) = (block: u32, index: u32), at the best block.
  const storedAt = async (hashHex) => {
    const { api } = await connect();
    const key = await api.query.TransactionStorage.TransactionByContentHash.getKey(`0x${hashHex}`);
    const value = await rpc("state_getStorage", [key]).catch(() => null);
    if (!value) return null;
    const b = Buffer.from(fromHex(value));
    return b.length >= 8 ? { block: b.readUInt32LE(0), index: b.readUInt32LE(4) } : null;
  };

  // One chunk: sign, submit, and poll TransactionByContentHash at the best
  // block until it is there (the Stored event's block and index). A chunk
  // not there in time, or refused by the pool, is checked once more and
  // resubmitted with backoff (0012 "Retry").
  const storeChunk = async (ciphertext, hashHex, nonce) => {
    const { client, api } = await connect();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const signed = await api.tx.TransactionStorage.store({ data: ciphertext }).sign(signer, nonce != null && attempt === 0 ? { nonce } : {});
        // The submit goes up the WebSocket: the node's HTTP proxy refuses a
        // 2 MB request body (HTTP 413 on devnet).
        const txHash = await withTimeout(client._request("author_submitExtrinsic", [typeof signed === "string" ? signed : `0x${hex(signed)}`]), 120_000, "author_submitExtrinsic");
        const until = now() + bestBlockTimeoutMs;
        while (now() < until) {
          await delay(pollMs);
          const at = await storedAt(hashHex);
          if (at) return { ...at, txHash };
        }
        throw new Error("not in a best block in time");
      } catch (error) {
        const at = await storedAt(hashHex);
        if (at) return { ...at, txHash: null };
        if (attempt >= retryDelaysMs.length) throw error;
        log("BOT_BULLETIN_STORE_RETRY", { cid: cidOf(fromHex(hashHex)), attempt: attempt + 1, error: String(error?.message ?? error).slice(0, 200) });
        await delay(retryDelaysMs[attempt]);
      }
    }
  };

  /** Encrypt and store a file; returns the Attachment item for the kind-250 message. */
  const upload = async (plaintext, { mime, name = null, media = { kind: "file" }, blurhash = null, thumbnail = null, mirror = null }) => {
    const started = now();
    const encrypted = encryptAttachment(plaintext);
    const bytes = encrypted.ciphertexts.reduce((n, c) => n + c.length, 0);
    const count = encrypted.ciphertexts.length;
    budget?.check(bytes, count);
    await ensureAuthorized({ transactions: count, bytes });
    const { genesis: chainGenesis } = await connect();
    const firstNonce = Number(await rpc("system_accountNextIndex", [address]));
    const hashes = encrypted.chunks.map(hex);
    const stored = await Promise.all(encrypted.ciphertexts.map((c, i) => storeChunk(c, hashes[i], firstNonce + i)));
    budget?.spend(bytes, count);
    const expiresAt = started + BULLETIN_RETENTION_MS - HOUR_MS;
    for (const [i, s] of stored.entries()) {
      log("BOT_BULLETIN_STORED", { cid: cidOf(encrypted.chunks[i]), bytes: encrypted.ciphertexts[i].length, block: s.block, index: s.index, ...(s.txHash ? { txHash: s.txHash } : {}) });
    }
    return {
      item: {
        mime, name, size: plaintext.length, media, blurhash, thumbnail,
        key: encrypted.key, nonce: encrypted.nonce, chunkSize: encrypted.chunkSize, chunks: encrypted.chunks,
        store: { kind: "bulletin", genesis: fromHex(chainGenesis), mirror }, expiresAt,
      },
      transactions: count,
      ciphertextBytes: bytes,
      ms: now() - started,
    };
  };

  const fetchSource = async (source, cid, maxBytes) => {
    if (source === "bitswap") {
      const bytes = fromHex(await rpc("bitswap_v1_get", [cid]));
      if (bytes.length > maxBytes) throw new Error("bitswap response is too large");
      return bytes;
    }
    const response = await fetchImpl(`${source}${cid}`, { signal: AbortSignal.timeout(sourceTimeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("gateway response is too large");
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length > maxBytes) throw new Error("gateway response is too large");
    return body;
  };

  /** Fetch every chunk (bitswap, mirror, gateway), verify each hash, decrypt. `item` is a decoded Attachment. */
  const download = async (item) => {
    const started = now();
    const { genesis: chainGenesis } = await connect();
    if (hex(item.store.genesis) !== chainGenesis.replace(/^0x/, "")) throw new Error("attachment is stored on a different Bulletin chain");
    const count = chunkCount(item.size, item.chunkSize);
    if (item.chunks.length !== count) throw new Error("attachment chunk count does not match its size");
    const maxBytes = item.chunkSize + 16;
    const sources = ["bitswap", item.store.mirror, gateway].filter((s, i, all) => s && all.indexOf(s) === i);
    const used = [];
    const ciphertexts = await Promise.all(item.chunks.map(async (hash, i) => {
      const cid = cidOf(hash);
      const errors = [];
      for (const source of sources) {
        try {
          const bytes = await fetchSource(source, cid, maxBytes);
          if (hex(contentHash(bytes)) !== hex(hash)) throw new Error("hash mismatch");
          used[i] = source === "bitswap" ? "bitswap" : source === gateway ? "gateway" : "mirror";
          return bytes;
        } catch (error) { log("BOT_ATTACHMENT_SOURCE_FAILED", { cid, source: source === "bitswap" ? "bitswap" : new URL(source).hostname, error: String(error?.message ?? error) }); errors.push(`${source === "bitswap" ? "bitswap" : new URL(source).hostname}: ${String(error?.message ?? error)}`); }
      }
      throw new Error(now() > item.expiresAt ? "Attachment expired" : `chunk ${i} unavailable (${errors.join("; ")})`);
    }));
    const plaintext = decryptAttachment(item, ciphertexts);
    return { plaintext, sources: used, ciphertextBytes: ciphertexts.reduce((n, c) => n + c.length, 0), ms: now() - started };
  };

  return {
    address,
    readAuthorization,
    ensureAuthorized,
    upload,
    download,
    destroy: () => { ready?.then(({ client }) => client.destroy?.(), () => {}); ready = null; },
  };
}
