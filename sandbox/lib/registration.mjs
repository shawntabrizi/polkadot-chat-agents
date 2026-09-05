// Registration of a persona on a real network. A persona there is what a
// bot is: one identity minted from a mnemonic, registered through the
// identity backend (bandersnatch lite-person proof → username claim →
// attestation on chain), single-device — the identity account signs its
// statements, and its device encryption key is a persisted random X25519
// key. Only the phone can mint the ring-proof origin a second device needs.
//
// bot-core imports allowed here by the S6 rules, and only these:
// lib/register.mjs (the claim and the attestation wait; registration is not
// the chat protocol under test) and lib/testnet-file-allowance.mjs (the
// Bulletin allowance the persona's upload signer needs on a testnet).

import { AccountId } from "polkadot-api";
import { generateMnemonic } from "@polkadot-labs/hdkd-helpers";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";

import { deriveIdentityKeys, normalizeUsername, registerIdentity, waitForAttestation } from "../../bot-core/lib/register.mjs";
import { ensureTestnetFileAllowance, getTestnetFileAllowanceStatus, hasSufficientTestnetFileAllowance } from "../../bot-core/lib/testnet-file-allowance.mjs";
import { bytesToHex, hexToBytes, log } from "./bytes.mjs";
import { wrapIdentifierKey } from "./directory.mjs";
import { bulletinSignerFromSeed } from "./hop.mjs";

export const DEFAULT_WAIT_MS = 180_000;
const USERNAME = /^[a-z]{6,}$/;
const ss58 = AccountId(42);

/**
 * The network username a persona claims: its name when the backend accepts
 * it (six or more lowercase letters), else `sandbox<name>` for a short
 * letters-only name; anything else needs an explicit username.
 */
export function defaultUsername(name) {
  if (USERNAME.test(name)) return name;
  const padded = `sandbox${name}`;
  return USERNAME.test(padded) ? padded : null;
}

/** A fresh identity record: mnemonic, device key, upload signer seed. Persisted before anything is claimed. */
export function mintPersonaRecord(name, { username = null, genesis = null } = {}) {
  const base = username ?? defaultUsername(name);
  if (base == null) throw new Error(`"${name}" is not a valid network username (six or more lowercase letters); pass one with --username`);
  normalizeUsername(base);
  return {
    name,
    mnemonic: generateMnemonic(128),
    deviceEncryptionPrivateKey: bytesToHex(x25519.utils.randomSecretKey()),
    bulletinSeed: bytesToHex(randomBytes(32)),
    usernameBase: base,
    username: null,
    registration: { status: "minted", genesis, claimedAt: null, attestedAt: null, needsReregistration: false },
    bulletin: { status: "none", detail: null },
    createdAt: new Date().toISOString(),
  };
}

/** The keys a record holds, in the shapes persona.mjs and device.mjs take. Never leaves the daemon. */
export function keysOf(record) {
  const keys = deriveIdentityKeys(record.mnemonic);
  const deviceEncryptionPrivateKey = hexToBytes(record.deviceEncryptionPrivateKey);
  return {
    identity: { seed: keys.walletPrivateKey, identityAccountId: keys.accountId, identityChatPrivateKey: keys.chatPrivateKey, identityChatPublicKey: keys.chatPublicKey },
    // The one device is the identity: same statement account, its own encryption key.
    deviceKeys: [{ statementSeed: keys.walletPrivateKey, statementAccountId: keys.accountId, encryptionPrivateKey: deviceEncryptionPrivateKey, encryptionPublicKey: x25519.getPublicKey(deviceEncryptionPrivateKey) }],
    bulletin: bulletinSignerFromSeed(hexToBytes(record.bulletinSeed)),
    account: keys.account,
    identifierKey: bytesToHex(wrapIdentifierKey(keys.chatPublicKey)),
  };
}

/** Public view of where a registration stands, for `pcs user list` and the UI. */
export const registrationView = (record) => ({
  username: record.username,
  status: record.registration.needsReregistration ? "needs-reregistration" : record.registration.status,
  genesis: record.registration.genesis,
  claimedAt: record.registration.claimedAt,
  attestedAt: record.registration.attestedAt,
  bulletin: record.bulletin?.status ?? "none",
});

/**
 * Claim the username (once) and wait for the attestation. Idempotent and
 * resumable: a claimed record only waits, an attested one returns at once,
 * one marked by a chain reset claims again — without its old number, which
 * the backend refuses to reuse (bot-core's `pca register --again` found the
 * same). Resolves with the record's registration view; never throws for a
 * slow attestation (status stays "claimed" = pending).
 */
export async function registerPersona(record, {
  backendUrl, directory, genesis, save, waitMs = DEFAULT_WAIT_MS, fetchImpl = fetch, bandersnatchBin = null, onProgress = () => {},
}) {
  const reg = record.registration;
  const { account } = keysOf(record);
  if (reg.status === "attested" && !reg.needsReregistration) return registrationView(record);
  if (reg.status === "minted" || reg.needsReregistration) {
    const again = reg.needsReregistration;
    onProgress(again ? `claiming a new username for ${record.name} (the chain was reset)…` : `claiming ${record.usernameBase} for ${record.name}…`);
    const result = await registerIdentity({ mnemonic: record.mnemonic, username: record.usernameBase, digits: null, backendUrl, bandersnatchBin, fetchImpl });
    record.username = result.username;
    record.registration = { status: "claimed", genesis, claimedAt: new Date().toISOString(), attestedAt: null, needsReregistration: false };
    await save(record);
    log("SANDBOX_PERSONA_CLAIMED", { name: record.name, username: record.username, account, again });
  }
  onProgress(`waiting for the network to attest ${record.username} (up to ${Math.round(waitMs / 1000)}s)…`);
  const attested = await waitForAttestation(directory, account, { timeoutMs: waitMs, pollMs: 5_000 });
  if (attested) {
    record.registration.status = "attested";
    record.registration.attestedAt = new Date().toISOString();
    await save(record);
    log("SANDBOX_PERSONA_ATTESTED", { name: record.name, username: record.username, account });
  } else {
    log("SANDBOX_PERSONA_PENDING", { name: record.name, username: record.username, account });
  }
  return registrationView(record);
}

/**
 * The persona's Bulletin storage allowance: what `pca create` does for a
 * bot's upload signer, through the same testnet faucet helper. The faucet
 * often answers after the helper's 30 s deadline ("finalization unknown");
 * a sandbox persona has no operator to run `pca storage recover`, so the
 * chain is re-read for a while before the grant is called pending. Failure
 * is recorded, not thrown: a persona without the allowance still chats,
 * only its uploads are refused by the HOP node.
 */
export async function provisionBulletin(record, {
  botProfile, save, ensure = ensureTestnetFileAllowance, readStatus = getTestnetFileAllowanceStatus, settleMs = 90_000, pollMs = 15_000,
}) {
  const { bulletin } = keysOf(record);
  const address = ss58.dec(bulletin.publicKey);
  const settled = (status) => ({ status: hasSufficientTestnetFileAllowance(status) ? "authorized" : "insufficient", detail: status.action ?? null, expiresAt: status.expiresAt ?? null });
  try {
    record.bulletin = settled(await ensure({ address, networkProfile: botProfile }));
    log("SANDBOX_PERSONA_BULLETIN", { name: record.name, address, action: record.bulletin.detail });
  } catch (error) {
    if (error?.code === "TESTNET_ALLOWANCE_FINALIZATION_UNKNOWN") {
      record.bulletin = { status: "pending", detail: error.message };
      const until = Date.now() + settleMs;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        try {
          const status = await readStatus({ address, networkProfile: botProfile });
          if (hasSufficientTestnetFileAllowance(status)) { record.bulletin = settled(status); break; }
        } catch { /* the next read may answer */ }
      }
      log(record.bulletin.status === "authorized" ? "SANDBOX_PERSONA_BULLETIN" : "SANDBOX_PERSONA_BULLETIN_PENDING", { name: record.name, address, detail: record.bulletin.detail });
    } else {
      record.bulletin = { status: "failed", detail: error?.message ?? String(error) };
      log("SANDBOX_PERSONA_BULLETIN_FAILED", { name: record.name, address, error: record.bulletin.detail });
    }
  }
  await save(record);
  return record.bulletin;
}
