// Bot identity registration on the Polkadot people-lite network.
//
// Generates a lite-person proof (via the vendored bandersnatch CLI) and submits
// a username/consumer claim to the identity backend, which attests it on-chain
// so the bot becomes messageable. Ported from the faucet's registration flow,
// using the same X25519 chat-key derivation the transport uses (keeps the
// registered identifier_key consistent with what bot-core runs).

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { mnemonicToEntropy, mnemonicToMiniSecret, ss58Address, ss58Decode } from "@polkadot-labs/hdkd-helpers";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import {
  deriveX25519PrivateKey,
  encodeAccountEcdhKey,
  x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";

// Re-export the shared timeout helper (cli.mjs uses it for chain queries): papi
// requests never reject on a dead socket — they're buffered and re-sent on
// reconnect — so every chain call must be raced against a deadline.
export { withTimeout };

const MSG_PREFIX = "pop:people-lite:register using";

export const DEFAULT_BACKENDS = {
  devnet: "https://polkadot-app.api.polkadotcommunity.foundation",
  paseo: "https://identity-backend-next.parity-testnet.parity.io",
  summit: "https://polkadot-app.api.polkadotcommunity.foundation",
};

const enc = new TextEncoder();
const hexToBytes = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  // Don't echo the value: some callers pass key material through this path.
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex value (${clean.length} chars)`);
  return Uint8Array.from(clean.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
};
const bytesToHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const concatBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const compactLen = (n) => {
  if (n < 1 << 6) return Uint8Array.of(n << 2);
  if (n < 1 << 14) { const v = (n << 2) | 1; return Uint8Array.of(v & 0xff, (v >> 8) & 0xff); }
  throw new Error("compact length too large");
};
const scaleString = (s) => { const e = enc.encode(s); return concatBytes(compactLen(e.length), e); };

// The lite-person proof needs bandersnatch ring-VRF crypto that only exists in
// Rust. We ship it as a WASI build of tools/bandersnatch-cli (vendored .wasm, no
// Rust toolchain needed by users) and run it in-process via node:wasi. Output is
// deterministic — identical bytes to the native binary. Set PCA_BANDERSNATCH_CLI
// (or pass bandersnatchBin) to use a natively built binary instead.
const WASM_PATH = new URL("../vendor/summit-bandersnatch-cli.wasm", import.meta.url);
let wasmModule = null; // compiled once, instantiated per run (WASI starts are single-shot)

async function runLitePersonWasm(entropyHex, messageHex) {
  // node:wasi emits an ExperimentalWarning on import; it would land mid-way
  // through create's friendly output, so filter that one warning (only that one).
  if (!globalThis.__pcaWasiWarnFiltered) {
    globalThis.__pcaWasiWarnFiltered = true;
    const orig = process.emitWarning.bind(process);
    process.emitWarning = (warning, ...rest) => {
      if (String(warning).includes("WASI")) return;
      orig(warning, ...rest);
    };
  }
  const { WASI } = await import("node:wasi");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  wasmModule ??= await WebAssembly.compile(fs.readFileSync(WASM_PATH));
  const tmp = path.join(os.tmpdir(), `bandersnatch-${process.pid}-${Date.now()}.out`);
  const fd = fs.openSync(tmp, "w+", 0o600); // not world-readable while the proof is written
  try {
    const wasi = new WASI({
      version: "preview1",
      args: ["bandersnatch", "lite-person", entropyHex, messageHex],
      stdout: fd,
      stderr: fd,
    });
    const code = wasi.start(await WebAssembly.instantiate(wasmModule, wasi.getImportObject()));
    const out = fs.readFileSync(tmp, "utf8").trim();
    if (code !== 0) throw new Error(`identity proof helper failed (exit ${code}): ${out}`);
    return JSON.parse(out);
  } finally {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
  }
}

async function runLitePerson(bin, entropyHex, messageHex) {
  if (!bin) return runLitePersonWasm(entropyHex, messageHex);
  const r = spawnSync(bin, ["lite-person", entropyHex, messageHex], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`identity proof helper failed: ${r.stderr || r.stdout || r.error?.message}`);
  return JSON.parse(r.stdout.trim());
}

async function jsonFetch(url, options, fetchImpl = fetch) {
  const res = await fetchImpl(url, options);
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const canonicalBackendUrl = (backendUrl) => new URL(backendUrl).href;
const base64 = (bytes) => Buffer.from(bytes).toString("base64");

function tokenPair(data, operation) {
  const token = typeof data?.token === "string" ? data.token.trim() : "";
  const refreshToken = typeof data?.refreshToken === "string" ? data.refreshToken.trim() : "";
  if (!token || !refreshToken) throw new Error(`identity backend did not return a complete token pair after ${operation}`);
  return { token, refreshToken };
}

function voucherSecret(value) {
  const secret = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret) || Buffer.from(secret, "base64").length !== 32) {
    throw new Error("PCA_IDENTITY_VOUCHER must be a base64-encoded 32-byte enrollment voucher");
  }
  return secret;
}

function identityClient(mnemonic) {
  if (typeof mnemonic === "string" && mnemonic.trim()) {
    return deriveSr25519PairFromSeed(mnemonicToMiniSecret(mnemonic), "//wallet");
  }
  // Retain backwards compatibility for direct callers of redeemIdentityVoucher.
  // The CLI always supplies the bot mnemonic so its JWT subject is the bot
  // account, which is required by registration-queue endpoints.
  return deriveSr25519PairFromSeed(randomBytes(32), "");
}

function decodeChallenge(value) {
  const encoded = typeof value === "string" ? value.trim() : "";
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("identity backend returned an invalid authentication challenge");
  }
  const challenge = new Uint8Array(Buffer.from(encoded, "base64"));
  if (challenge.length === 0 || base64(challenge) !== encoded) {
    throw new Error("identity backend returned an invalid authentication challenge");
  }
  return challenge;
}

export async function requestIdentityChallenge({ backendUrl, fetchImpl = fetch }) {
  const data = await jsonFetch(new URL("/api/v1/auth/challenges", backendUrl), {
    method: "POST",
  }, fetchImpl);
  return decodeChallenge(data?.challenge);
}

async function issueIdentitySession({
  backendUrl,
  client,
  enrollmentVoucher = null,
  fetchImpl = fetch,
}) {
  const normalizedVoucher = enrollmentVoucher == null ? null : voucherSecret(enrollmentVoucher);
  const challenge = await requestIdentityChallenge({ backendUrl, fetchImpl });
  const body = "{}";
  const bodyBytes = enc.encode(body);
  const clientDataHash = sha256(concatBytes(challenge, client.publicKey, sha256(bodyBytes)));
  const clientProof = client.sign(clientDataHash);
  const data = await jsonFetch(new URL("/api/v1/auth/token", backendUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Auth-ClientId": base64(client.publicKey),
      "Auth-ClientProof": base64(clientProof),
      "Auth-Challenge": base64(challenge),
      ...(normalizedVoucher ? {
        "Auth-Attestation-Type": "voucher",
        "Auth-Voucher-Secret": normalizedVoucher,
      } : {}),
    },
    body,
  }, fetchImpl);
  return tokenPair(data, normalizedVoucher ? "voucher enrollment" : "client-proof enrollment");
}

// Products Devnet currently runs its attestation layer in soft mode. A bot can
// therefore mint the bearer required for username writes by proving possession
// of its own //wallet SR25519 key, without a phone or operator secret.
export async function obtainIdentitySession({ backendUrl, mnemonic, fetchImpl = fetch }) {
  if (typeof mnemonic !== "string" || !mnemonic.trim()) {
    throw new Error("automatic identity enrollment requires the bot mnemonic");
  }
  return issueIdentitySession({
    backendUrl,
    client: identityClient(mnemonic),
    fetchImpl,
  });
}

// If a future environment hard-enforces platform attestation, an operator
// voucher remains a supported fallback. Use the bot wallet as the auth client
// whenever a mnemonic is available so the resulting JWT subject is stable.
export async function redeemIdentityVoucher({ backendUrl, secret, mnemonic = null, fetchImpl = fetch }) {
  return issueIdentitySession({
    backendUrl,
    client: identityClient(mnemonic),
    enrollmentVoucher: secret,
    fetchImpl,
  });
}

export async function refreshIdentitySession({ backendUrl, refreshToken, fetchImpl = fetch }) {
  const normalizedRefreshToken = typeof refreshToken === "string" ? refreshToken.trim() : "";
  if (!normalizedRefreshToken) throw new Error("saved identity registration session has no refresh token");
  const data = await jsonFetch(new URL("/api/v1/auth/token/refresh", backendUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: normalizedRefreshToken }),
  }, fetchImpl);
  return tokenPair(data, "session refresh");
}

function jwtExpiresSoon(token, now = Date.now()) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp * 1000 <= now + 60_000;
  } catch {
    return false;
  }
}

const isAuthRejection = (error) => error?.status === 401 || error?.status === 403;

// Resolve a bearer session without putting a credential on the command line.
// Automatic and voucher sessions are persisted by the caller immediately, so
// a transient username-registration failure reuses or refreshes the session.
export async function acquireIdentitySession({
  backendUrl,
  mnemonic = null,
  accessToken = null,
  enrollmentVoucher = null,
  savedSession = null,
  persistSession = null,
  fetchImpl = fetch,
}) {
  const directToken = typeof accessToken === "string" ? accessToken.trim() : "";
  if (directToken) return { token: directToken, refreshToken: null, backendUrl: canonicalBackendUrl(backendUrl) };

  const savedBackend = typeof savedSession?.backendUrl === "string"
    ? canonicalBackendUrl(savedSession.backendUrl)
    : null;
  const currentBackend = canonicalBackendUrl(backendUrl);
  const savedToken = typeof savedSession?.token === "string" ? savedSession.token.trim() : "";
  if (savedBackend === currentBackend && savedToken) {
    if (!jwtExpiresSoon(savedToken)) return { ...savedSession, backendUrl: currentBackend, token: savedToken };
    try {
      const refreshed = await refreshIdentitySession({
        backendUrl,
        refreshToken: savedSession.refreshToken,
        fetchImpl,
      });
      const session = { backendUrl: currentBackend, ...refreshed };
      await persistSession?.(session);
      return session;
    } catch (error) {
      // A revoked/expired refresh token should not strand a bot whose wallet
      // can obtain a fresh Devnet session. Connectivity/server failures remain
      // visible rather than creating extra sessions on a blind retry.
      if (!isAuthRejection(error) || !mnemonic) throw error;
    }
  }

  let enrolled;
  if (mnemonic) {
    try {
      enrolled = await obtainIdentitySession({ backendUrl, mnemonic, fetchImpl });
    } catch (error) {
      if (!isAuthRejection(error) || enrollmentVoucher == null || String(enrollmentVoucher).trim() === "") {
        throw error;
      }
      enrolled = await redeemIdentityVoucher({
        backendUrl,
        secret: enrollmentVoucher,
        mnemonic,
        fetchImpl,
      });
    }
  } else if (enrollmentVoucher != null && String(enrollmentVoucher).trim() !== "") {
    enrolled = await redeemIdentityVoucher({ backendUrl, secret: enrollmentVoucher, fetchImpl });
  } else {
    return null;
  }
  const session = { backendUrl: currentBackend, ...enrolled };
  await persistSession?.(session);
  return session;
}

// ── The identity backend's username search ───────────────────────────────
//
// `GET /api/v1/usernames/search?prefix=&limit=&cursor=` is the one read the
// backend (paritytech/device-uniqueness-backend) keeps: a paged projection
// of assigned usernames. The old list (`/usernames?prefix=`) and single
// lookup (`/usernames/{name}`) are retired. Two gates sit in front of it:
// a per-IP rate limit (429 with Retry-After) and, when the operator enables
// it, proof of compute (402): a puzzle from `POST /api/v1/poc/issue`, solved
// by mining a counter and presented in a single-use `Proof-Of-Compute`
// header. The puzzle is a bounded sha256 search (difficulty ≤ 32 leading
// zero bits, counted over the first 32 bits of the digest), so it is
// solved here in plain Node.

// The chain pads a lite username's number to two digits (`alice.06`); it is
// the only form `Resources.UsernameOwnerOf` answers to.
export const MIN_LITE_USERNAME_DIGITS = 2;
// Above this the search would take minutes; the backends issue 16–18.
const MAX_PROOF_OF_COMPUTE_DIFFICULTY = 24;
const DEFAULT_SEARCH_PAGES = 10;
const RETRY_AFTER_CAP_MS = 30_000;

/** The on-chain form of a username: the lite number padded (`alice.6` → `alice.06`); anything else as given. */
export function canonicalUsername(raw) {
  const text = String(raw ?? "").trim();
  const m = /^([a-z0-9]+)\.(\d{1,2})$/i.exec(text);
  return m ? `${m[1]}.${m[2].padStart(MIN_LITE_USERNAME_DIGITS, "0")}` : text;
}

const u64be = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return new Uint8Array(b); };
const uuidBytes = (id) => {
  const clean = String(id).replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(clean)) throw new Error("proof of compute: the puzzle's sessionId is not a UUID");
  return hexToBytes(clean);
};

/** Leading zero bits of sha256(uuid ‖ timestamp u64be ‖ counter u64be), the backend's work measure. */
export function proofOfComputeWork({ sessionId, timestamp }, counter) {
  const digest = sha256(concatBytes(uuidBytes(sessionId), u64be(timestamp), u64be(counter)));
  return Math.clz32((digest[0] << 24 | digest[1] << 16 | digest[2] << 8 | digest[3]) >>> 0);
}

/** Mine the puzzle and return the `Proof-Of-Compute` header value. */
export function solveProofOfCompute(puzzle) {
  const difficulty = Number(puzzle?.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 32 || typeof puzzle?.checksum !== "string" || !Number.isInteger(Number(puzzle?.timestamp))) {
    throw new Error("proof of compute: the identity backend issued a malformed puzzle");
  }
  if (difficulty > MAX_PROOF_OF_COMPUTE_DIFFICULTY) {
    throw new Error(`proof of compute: the identity backend asks for ${difficulty} bits of work; this client solves up to ${MAX_PROOF_OF_COMPUTE_DIFFICULTY}`);
  }
  let counter = 0;
  while (proofOfComputeWork(puzzle, counter) < difficulty) counter += 1;
  return base64(enc.encode(`${puzzle.sessionId}:${puzzle.timestamp}:${difficulty}:${counter}:${puzzle.checksum}`));
}

async function issueProofOfCompute(backendUrl, fetchImpl) {
  const puzzle = await jsonFetch(new URL("/api/v1/poc/issue", backendUrl), { method: "POST" }, fetchImpl);
  return solveProofOfCompute(puzzle);
}

const retryAfterMs = (res) => {
  const raw = res.headers?.get?.("retry-after");
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : raw ? Date.parse(raw) - Date.now() : 1000;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
};
const errorText = async (res) => { const t = await res.text().catch(() => ""); try { return JSON.parse(t)?.error ?? t; } catch { return t; } };

/**
 * Every assigned username under a prefix, as the chain names it:
 * `[{ username, account (0x hex), address (SS58), status, createdAt, updatedAt }]`.
 * Pages follow `nextCursor` up to `maxPages`; a 429 is retried once after
 * its Retry-After; a 402 is answered with a solved puzzle once per request.
 * Any other failure throws with the backend's reason.
 */
export async function searchUsernames({ backendUrl, prefix, limit = 100, maxPages = DEFAULT_SEARCH_PAGES, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const request = async (url) => {
    let proof = null;
    let retriedRateLimit = false;
    for (;;) {
      const res = await fetchImpl(url, { headers: proof ? { "Proof-Of-Compute": proof } : {} });
      if (res.status === 402) {
        if (proof) throw new Error(`identity backend search refused the proof of compute: ${await errorText(res)}`);
        proof = await issueProofOfCompute(backendUrl, fetchImpl);
        continue;
      }
      if (res.status === 429) {
        if (retriedRateLimit) throw new Error(`identity backend search is rate limited: ${await errorText(res)}`);
        retriedRateLimit = true;
        proof = null; // single-use: a refused request spent it
        await sleep(retryAfterMs(res));
        continue;
      }
      if (!res.ok) throw new Error(`identity backend search failed (${res.status}): ${await errorText(res)}`);
      return res.json();
    }
  };
  const out = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("/api/v1/usernames/search", backendUrl);
    url.searchParams.set("prefix", String(prefix));
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await request(url);
    if (!Array.isArray(data?.usernames)) throw new Error("identity backend search returned no list");
    for (const hit of data.usernames) {
      if (typeof hit?.username !== "string" || typeof hit?.accountId !== "string") continue;
      let account;
      try { account = bytesToHex(ss58Decode(hit.accountId)[0]); } catch { continue; }
      out.push({ username: canonicalUsername(hit.username), account, address: hit.accountId, status: hit.status ?? null, createdAt: hit.createdAt ?? null, updatedAt: hit.updatedAt ?? null });
    }
    cursor = typeof data.nextCursor === "string" && data.nextCursor ? data.nextCursor : null;
    if (!cursor) break;
  }
  return out;
}

// Validate a username to the backend's rule: >=6 lowercase letters (+ optional .NN).
export function normalizeUsername(raw) {
  const m = /^([a-z]{6,})(?:\.(\d{2}))?$/.exec(String(raw ?? "").trim().replace(/^@/, ""));
  if (!m) throw new Error(`username must be at least 6 lowercase letters (got "${raw}")`);
  return { base: m[1], digits: m[2] ?? null };
}

// The keys one registration binds together, from the mnemonic: the //wallet
// sr25519 pair (the account the backend attests, and the account that signs
// the bot's statements) and the X25519 chat key whose public half is the
// identifier key the claim publishes. A client that must chat AS the
// identity it registers here (the sandbox's paseo personas) derives its keys
// through this one function, so what it publishes and what it uses agree.
export function deriveIdentityKeys(mnemonic) {
  const rootSeed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(rootSeed, "//wallet");
  const chatPrivateKey = deriveX25519PrivateKey(rootSeed);
  const chatPublicKey = x25519PublicKeyFromPrivateKey(chatPrivateKey);
  return {
    accountId: wallet.publicKey,
    account: bytesToHex(wallet.publicKey),
    /** 64-byte sr25519 secret (scure/HDKD form); a statement-store prover accepts it as is. */
    walletPrivateKey: wallet.privateKey,
    sign: wallet.sign,
    chatPrivateKey,
    chatPublicKey,
    identifierKey: encodeAccountEcdhKey(chatPublicKey),
    liteEntropy: blake2b(mnemonicToEntropy(mnemonic), { dkLen: 32 }),
  };
}

export async function registerIdentity({
  mnemonic,
  username,
  digits = null,
  backendUrl,
  bandersnatchBin = null,
  ss58Prefix = 42,
  identityToken = null,
  fetchImpl = fetch,
}) {
  const { base, digits: parsedDigits } = normalizeUsername(username);
  const preferredDigits = digits ?? parsedDigits;

  const { accountId, sign, identifierKey, liteEntropy } = deriveIdentityKeys(mnemonic);

  const attesterData = await jsonFetch(new URL("/api/v1/attester", backendUrl), { method: "GET" }, fetchImpl);
  const attester = attesterData?.attester;
  if (!attester) throw new Error("identity backend did not return an attester");

  const memberOnly = await runLitePerson(bandersnatchBin, bytesToHex(liteEntropy),
    bytesToHex(concatBytes(enc.encode(MSG_PREFIX), accountId, new Uint8Array(32))));
  const ringVrfKey = memberOnly.memberKey;
  const liteMessage = concatBytes(enc.encode(MSG_PREFIX), accountId, hexToBytes(ringVrfKey));
  const litePerson = await runLitePerson(bandersnatchBin, bytesToHex(liteEntropy), bytesToHex(liteMessage));

  const resourcesSig = concatBytes(accountId, hexToBytes(attester), identifierKey, scaleString(base), Uint8Array.of(0));
  const payload = {
    candidateAccountId: ss58Address(accountId, ss58Prefix),
    username: base,
    candidateSignature: bytesToHex(sign(liteMessage)),
    ringVrfKey,
    proofOfOwnership: litePerson.proofOfOwnership,
    consumerRegistrationSignature: bytesToHex(sign(resourcesSig)),
    identifierKey: bytesToHex(identifierKey),
  };
  // The backend rejects a null preferredDigits; only send it when chosen,
  // otherwise let the backend auto-assign an available number.
  if (preferredDigits) payload.preferredDigits = preferredDigits;

  const submitted = await jsonFetch(new URL("/api/v1/usernames", backendUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(identityToken ? { authorization: `Bearer ${identityToken}` } : {}),
    },
    body: JSON.stringify(payload),
  }, fetchImpl);

  return {
    account: bytesToHex(accountId),
    address: ss58Address(accountId, ss58Prefix),
    identifierKey: bytesToHex(identifierKey),
    username: submitted?.username ?? (preferredDigits ? `${base}.${preferredDigits}` : base),
    submitted,
  };
}

// Registration after a chain reset. The identity backend keeps its own
// record of a username (ASSIGNED, with the block of the old chain), the reset
// chain has none, so the bot is unreachable although every local record says
// "registered". This claims the same username again and reports what the
// backend did instead of guessing:
//   { outcome: "on-chain" }                the chain still holds the account: nothing to do
//   { outcome: "claimed", username, renamed } the backend accepted the claim (with the old
//                                          digits, or new ones: `digits`, or its own pick
//                                          with `newNumber`)
//   { outcome: "refused", status, detail }  the backend answered the claim with an error
// A transport failure (no answer at all) throws, like registerIdentity.
// Observed on Paseo Next (2026-09-05): the backend refuses the old digits
// ("Preferred digits NN already taken for username …", 409) even for the
// account that owns them, so a bot comes back only under a new number.
export async function reregisterIdentity({ mnemonic, username, digits = null, newNumber = false, backendUrl, directory, bandersnatchBin = null, identityToken = null, fetchImpl = fetch }) {
  const { account } = deriveIdentityKeys(mnemonic);
  const onChain = await directory.identifierKeyFor(account);
  if (onChain != null) return { outcome: "on-chain", account, username };
  const { base, digits: current } = normalizeUsername(username);
  const wanted = newNumber ? null : digits ?? current;
  try {
    const result = await registerIdentity({ mnemonic, username: base, digits: wanted, backendUrl, bandersnatchBin, identityToken, fetchImpl });
    return { outcome: "claimed", account, username: result.username, renamed: result.username !== username };
  } catch (error) {
    if (error?.status == null) throw error;
    return { outcome: "refused", account, username, status: error.status, detail: error.message };
  }
}

// Poll the directory (lib/people-directory.mjs) until the bot's identifier key
// is published (attested on chain, or registered in the sandbox).
export async function waitForAttestation(directory, accountHex, { timeoutMs = 180_000, pollMs = 5_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let identifierKey = null;
    try { identifierKey = await withTimeout(directory.identifierKeyFor(accountHex), pollMs, "attestation check"); } catch { /* transient or timed out */ }
    if (identifierKey != null) return true;
    if (Date.now() >= deadline) return false;
    onTick?.();
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
