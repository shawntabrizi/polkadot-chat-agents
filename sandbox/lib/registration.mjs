// Registration of a persona on a real network. A persona there is what a
// bot is: one identity minted from a mnemonic, registered through the
// identity backend (bandersnatch lite-person proof → username claim →
// attestation on chain), single-device — the identity account signs its
// statements, and its device encryption key is a persisted random X25519
// key. Only the phone can mint the ring-proof origin a second device needs.
//
// The backend admits a claim the way the profile says
// (`identityRegistrationAuth`): Paseo Next takes it as is; Products Devnet
// wants a bearer the persona mints by proving its own //wallet key (the
// client-proof exchange `pca create --network devnet` runs), with the same
// operator overrides — PCA_IDENTITY_TOKEN, an issued bearer, and
// PCA_IDENTITY_VOUCHER, a single-use enrollment voucher presented only
// after the backend refused the client proof. See docs/guide/devnet.md.
//
// bot-core imports allowed here by the S6 rules, and only these:
// lib/register.mjs (the claim, the session and the attestation wait;
// registration is not the chat protocol under test) and
// lib/testnet-file-allowance.mjs (the Bulletin allowance the persona's
// upload signer needs on a testnet).

import { AccountId } from "polkadot-api";
import { generateMnemonic } from "@polkadot-labs/hdkd-helpers";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";

import { acquireIdentitySession, deriveIdentityKeys, normalizeUsername, registerIdentity, reregisterIdentity, waitForAttestation } from "../../bot-core/lib/register.mjs";
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
    registration: { status: "minted", genesis, claimedAt: null, attestedAt: null, needsReregistration: false, reason: null },
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
  /** Why it needs re-registration (what the chain said), else null. */
  reason: record.registration.needsReregistration ? record.registration.reason ?? null : null,
  genesis: record.registration.genesis,
  claimedAt: record.registration.claimedAt,
  attestedAt: record.registration.attestedAt,
  bulletin: record.bulletin?.status ?? "none",
});

/**
 * Is a registration on the chain now? Two reads: `Consumers(account)` for
 * the identifier key and `UsernameOwnerOf(username)` for the name. The
 * chain is the only authority — a migration can wipe every registration and
 * keep the genesis (Products Devnet, 2026-09-08). Returns
 *   { onChain: true, consumer }              key present, username (when known) owned by the account
 *   { onChain: false, reason }               with what the chain said instead
 * A transport failure throws: "unreachable" is not "gone".
 */
export async function checkRegistration(directory, { account, username = null, identifierKey = null }) {
  const consumer = await directory.consumer(account);
  if (!consumer) return { onChain: false, reason: `the chain has no identifier key for ${account.slice(0, 10)}…` };
  if (identifierKey && normalizeKey(consumer.identifierKey) !== normalizeKey(identifierKey)) return { onChain: false, reason: "the chain holds a different identifier key for this account" };
  if (username) {
    const owner = await directory.usernameOwner(username);
    if (owner == null) return { onChain: false, reason: `the chain has no username ${username}` };
    if (owner !== account) return { onChain: false, reason: `${username} belongs to another account on the chain` };
  }
  return { onChain: true, consumer };
}
const normalizeKey = (hex) => String(hex).replace(/^0x/i, "").toLowerCase();

/** Apply a check to a persisted record: mark it (with the reason) or clear an old mark. Returns true when the record changed. */
export function applyCheck(record, check) {
  const reg = record.registration;
  const before = [reg.needsReregistration, reg.reason ?? null, reg.status].join("|");
  if (check.onChain) {
    reg.needsReregistration = false;
    reg.reason = null;
    if (reg.status === "claimed") { reg.status = "attested"; reg.attestedAt ??= new Date().toISOString(); }
  } else if (reg.status !== "minted") {
    reg.needsReregistration = true;
    reg.reason = check.reason;
  }
  return before !== [reg.needsReregistration, reg.reason ?? null, reg.status].join("|");
}

const isAuthRejection = (error) => error?.status === 401 || error?.status === 403;

/**
 * The bearer a claim carries, per the profile's `identityRegistrationAuth`.
 * "client-proof": bot-core's session flow with the persona's mnemonic — an
 * issued PCA_IDENTITY_TOKEN wins, else the saved session (refreshed when it
 * expires), else a fresh challenge signed with the //wallet key, and the
 * PCA_IDENTITY_VOUCHER fallback only after that was refused. The session is
 * persisted in the record (0600) before the claim so a claim that fails
 * later reuses it, and dropped once the claim is in. "none": no session; an
 * issued token is still passed on, as `pca` does.
 */
async function identityTokenFor(record, { backendUrl, identityAuth, env, save, fetchImpl }) {
  const issued = env.PCA_IDENTITY_TOKEN?.trim() || null;
  if (identityAuth !== "client-proof") return issued;
  try {
    const session = await acquireIdentitySession({
      backendUrl,
      mnemonic: record.mnemonic,
      accessToken: issued,
      enrollmentVoucher: env.PCA_IDENTITY_VOUCHER,
      savedSession: record.identityRegistrationSession ?? null,
      persistSession: async (session) => { record.identityRegistrationSession = session; await save(record); },
      fetchImpl,
    });
    return session?.token ?? null;
  } catch (error) {
    if (!isAuthRejection(error)) throw error;
    // The enrollment rules of docs/guide/devnet.md, as the `pcs user add` error.
    const tried = env.PCA_IDENTITY_VOUCHER?.trim() ? "the client proof and the PCA_IDENTITY_VOUCHER" : issued ? "PCA_IDENTITY_TOKEN" : "the client proof of its wallet key";
    throw new Error(`the identity backend refused to enroll ${record.name} with ${tried} (${error.message}). `
      + "It admits a client that proves its own wallet key; if the operator turned on hard platform attestation, start the daemon with "
      + "PCA_IDENTITY_VOUCHER (a single-use enrollment voucher) or PCA_IDENTITY_TOKEN (an issued bearer) in its environment — never on the command line — "
      + `then run  pcs user add ${record.name}  again`);
  }
}

/**
 * Claim the username (once) and wait for the attestation. Idempotent and
 * resumable: a claimed record only waits, an attested one returns at once,
 * one the chain forgot (checkRegistration) claims again through bot-core's
 * `reregisterIdentity` — the chain is read first, the old number is asked
 * for, and a new one is taken when the backend refuses it (as Paseo Next
 * does). Resolves with the record's registration view; never throws for a
 * slow attestation (status stays "claimed" = pending).
 */
export async function registerPersona(record, {
  backendUrl, directory, genesis, save, waitMs = DEFAULT_WAIT_MS, fetchImpl = fetch, bandersnatchBin = null, onProgress = () => {},
  identityAuth = "none", env = process.env,
}) {
  const reg = record.registration;
  const { account } = keysOf(record);
  if (reg.status === "attested" && !reg.needsReregistration) return registrationView(record);
  if (reg.needsReregistration && record.username) {
    onProgress(`registering ${record.name} again (${reg.reason ?? "the chain forgot it"})…`);
    const identityToken = await identityTokenFor(record, { backendUrl, identityAuth, env, save, fetchImpl });
    const result = await reregisterIdentity({ mnemonic: record.mnemonic, username: record.username, backendUrl, directory, bandersnatchBin, identityToken, fetchImpl });
    if (result.outcome === "refused") throw new Error(`the identity backend refused to register ${record.username} again: ${result.detail}`);
    const previous = record.username;
    if (result.outcome === "on-chain") {
      // The chain holds it after all (attested meanwhile): nothing to claim.
      record.registration = { ...reg, status: "attested", attestedAt: reg.attestedAt ?? new Date().toISOString(), needsReregistration: false, reason: null };
    } else {
      record.username = result.username;
      record.registration = { status: "claimed", genesis, claimedAt: new Date().toISOString(), attestedAt: null, needsReregistration: false, reason: null };
    }
    delete record.identityRegistrationSession;
    await save(record);
    log("SANDBOX_PERSONA_CLAIMED", { name: record.name, username: record.username, account, again: true, previous, renamed: record.username !== previous, refusedDigits: result.refusedDigits ?? null });
  } else if (reg.status === "minted" || reg.needsReregistration) {
    onProgress(`claiming ${record.usernameBase} for ${record.name}…`);
    const identityToken = await identityTokenFor(record, { backendUrl, identityAuth, env, save, fetchImpl });
    const result = await registerIdentity({ mnemonic: record.mnemonic, username: record.usernameBase, digits: null, backendUrl, bandersnatchBin, identityToken, fetchImpl });
    record.username = result.username;
    record.registration = { status: "claimed", genesis, claimedAt: new Date().toISOString(), attestedAt: null, needsReregistration: false, reason: null };
    delete record.identityRegistrationSession;
    await save(record);
    log("SANDBOX_PERSONA_CLAIMED", { name: record.name, username: record.username, account, again: false });
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
