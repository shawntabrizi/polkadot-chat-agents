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
import { mnemonicToEntropy, mnemonicToMiniSecret, ss58Address } from "@polkadot-labs/hdkd-helpers";
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

// Validate a username to the backend's rule: >=6 lowercase letters (+ optional .NN).
export function normalizeUsername(raw) {
  const m = /^([a-z]{6,})(?:\.(\d{2}))?$/.exec(String(raw ?? "").trim().replace(/^@/, ""));
  if (!m) throw new Error(`username must be at least 6 lowercase letters (got "${raw}")`);
  return { base: m[1], digits: m[2] ?? null };
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

  const rootSeed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(rootSeed, "//wallet");
  const accountId = wallet.publicKey;
  const x25519Pub = x25519PublicKeyFromPrivateKey(deriveX25519PrivateKey(rootSeed));
  const identifierKey = encodeAccountEcdhKey(x25519Pub);
  const liteEntropy = blake2b(mnemonicToEntropy(mnemonic), { dkLen: 32 });

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
    candidateSignature: bytesToHex(wallet.sign(liteMessage)),
    ringVrfKey,
    proofOfOwnership: litePerson.proofOfOwnership,
    consumerRegistrationSignature: bytesToHex(wallet.sign(resourcesSig)),
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
