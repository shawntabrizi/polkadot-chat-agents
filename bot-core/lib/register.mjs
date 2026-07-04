// Bot identity registration on the Polkadot people-lite network.
//
// Generates a lite-person proof (via the vendored bandersnatch CLI) and submits
// a username/consumer claim to the identity backend, which attests it on-chain
// so the bot becomes messageable. Ported from the faucet's registration flow,
// using the same P256 chat-key derivation the transport uses (keeps the
// registered identifier_key consistent with what bot-core runs).

import { spawnSync } from "node:child_process";
import { blake2b } from "@noble/hashes/blake2.js";
import { mnemonicToEntropy, mnemonicToMiniSecret, ss58Address } from "@polkadot-labs/hdkd-helpers";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { deriveP256PrivateKey, p256PublicKeyFromPrivateKey } from "../vendor/app-chat-codec.mjs";

const MSG_PREFIX = "pop:people-lite:register using";

export const DEFAULT_BACKENDS = {
  paseo: "https://identity-backend-next.parity-testnet.parity.io",
  summit: "https://polkadot-app.api.polkadotcommunity.foundation",
};

const enc = new TextEncoder();
const hexToBytes = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex: ${hex}`);
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

function runLitePerson(bin, entropyHex, messageHex) {
  const r = spawnSync(bin, ["lite-person", entropyHex, messageHex], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`bandersnatch helper failed: ${r.stderr || r.stdout || r.error?.message}`);
  return JSON.parse(r.stdout.trim());
}

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

// Validate a username to the backend's rule: >=6 lowercase letters (+ optional .NN).
export function normalizeUsername(raw) {
  const m = /^([a-z]{6,})(?:\.(\d{2}))?$/.exec(String(raw ?? "").trim().replace(/^@/, ""));
  if (!m) throw new Error(`username must be at least 6 lowercase letters (got "${raw}")`);
  return { base: m[1], digits: m[2] ?? null };
}

export async function registerIdentity({ mnemonic, username, digits = null, backendUrl, bandersnatchBin, ss58Prefix = 42 }) {
  const { base, digits: parsedDigits } = normalizeUsername(username);
  const preferredDigits = digits ?? parsedDigits;

  const rootSeed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(rootSeed, "//wallet");
  const accountId = wallet.publicKey;
  const p256Pub = p256PublicKeyFromPrivateKey(deriveP256PrivateKey(deriveSr25519PairFromSeed(rootSeed, "//wallet//chat")));
  const liteEntropy = blake2b(mnemonicToEntropy(mnemonic), { dkLen: 32 });

  const attesterData = await jsonFetch(new URL("/api/v1/attester", backendUrl), { method: "GET" });
  const attester = attesterData?.attester;
  if (!attester) throw new Error("identity backend did not return an attester");

  const memberOnly = runLitePerson(bandersnatchBin, bytesToHex(liteEntropy),
    bytesToHex(concatBytes(enc.encode(MSG_PREFIX), accountId, new Uint8Array(32))));
  const ringVrfKey = memberOnly.memberKey;
  const liteMessage = concatBytes(enc.encode(MSG_PREFIX), accountId, hexToBytes(ringVrfKey));
  const litePerson = runLitePerson(bandersnatchBin, bytesToHex(liteEntropy), bytesToHex(liteMessage));

  const resourcesSig = concatBytes(accountId, hexToBytes(attester), p256Pub, scaleString(base), Uint8Array.of(0));
  const payload = {
    candidateAccountId: ss58Address(accountId, ss58Prefix),
    username: base,
    candidateSignature: bytesToHex(wallet.sign(liteMessage)),
    ringVrfKey,
    proofOfOwnership: litePerson.proofOfOwnership,
    consumerRegistrationSignature: bytesToHex(wallet.sign(resourcesSig)),
    identifierKey: bytesToHex(p256Pub),
  };
  // The backend rejects a null preferredDigits; only send it when chosen,
  // otherwise let the backend auto-assign an available number.
  if (preferredDigits) payload.preferredDigits = preferredDigits;

  const submitted = await jsonFetch(new URL("/api/v1/usernames", backendUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  return {
    account: bytesToHex(accountId),
    address: ss58Address(accountId, ss58Prefix),
    identifierKey: bytesToHex(p256Pub),
    username: submitted?.username ?? (preferredDigits ? `${base}.${preferredDigits}` : base),
    submitted,
  };
}

// Poll Resources.Consumers until the bot's identifier_key is on-chain (attested).
export async function waitForAttestation(peopleApi, addressSs58, { timeoutMs = 180_000, pollMs = 5_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let consumer = null;
    try { consumer = await peopleApi.query.Resources.Consumers.getValue(addressSs58); } catch { /* transient */ }
    if (consumer?.identifier_key != null) return true;
    if (Date.now() >= deadline) return false;
    onTick?.();
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
