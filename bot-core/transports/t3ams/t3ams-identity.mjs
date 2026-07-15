// Deterministic identity material for the T3ams transport.
//
// T3ams normally derives a signing-key XID from its local identity. Bots are
// different: their discoverable identity is the Polkadot account that owns the
// DotNS username. Keep the account-derived XID separate from the signing and
// agreement keys so a bot remains discoverable across restarts and matches the
// T3ams app's account-XID convention.

import { createHash } from "node:crypto";
import { deriveSr25519PairFromSeed } from "../../vendor/lib/wallet-keys.mjs";

export const T3AMS_IDENTITY_SIGN_DOMAIN = "t3ams:identity:sign:v1";
export const T3AMS_IDENTITY_AGREEMENT_DOMAIN = "t3ams:identity:agree:v1";
export const T3AMS_ACCOUNT_XID_DOMAIN = "bcts:xid:v2:acct:";
// Bulletin uploads are paid by the same dedicated PCA allowance account as the
// normal chat transport. Keep this derivation separate from `//wallet`: that
// account signs Statement Store writes, while HOP/Bulletin authorizations are
// granted to this account instead.
export const T3AMS_BULLETIN_UPLOAD_DERIVATION = "//allowance//bulletin//chat";

const encoder = new TextEncoder();

const concatBytes = (...parts) => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const sha256 = (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());

export const bytesToHex = (bytes) => `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

/** Parse the 32-byte mini-secret stored in BOT_SEED_HEX / secret.json. */
export function botSeedFromHex(seedHex) {
  const clean = String(seedHex ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("BOT_SEED_HEX must be exactly 32 bytes of hexadecimal data");
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
}

function requireSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error("T3ams identity seed must be exactly 32 bytes");
  }
  return new Uint8Array(seed);
}

/**
 * Derive T3ams-compatible bot identity material from the PCA mini-secret.
 *
 * `signingPrivateKey` and `agreementPrivateKey` are the 32-byte values for
 * `@t3ams/bcts`'s `restoreIdentity(signingPrivateKey, agreementPrivateKey)`.
 * Consumers must then set the restored identity's `xid` to this result's
 * account-derived `xid`; the XID deliberately follows the bot's Polkadot
 * account rather than its local signing key.
 */
export function deriveT3amsIdentityFromSeed(seed) {
  const botSeed = requireSeed(seed);
  const signingPrivateKey = sha256(concatBytes(encoder.encode(T3AMS_IDENTITY_SIGN_DOMAIN), botSeed));
  const agreementPrivateKey = sha256(concatBytes(encoder.encode(T3AMS_IDENTITY_AGREEMENT_DOMAIN), botSeed));
  const accountId = new Uint8Array(deriveSr25519PairFromSeed(botSeed, "//wallet").publicKey);
  const xid = sha256(concatBytes(encoder.encode(T3AMS_ACCOUNT_XID_DOMAIN), accountId));

  return {
    accountId,
    accountIdHex: bytesToHex(accountId),
    xid,
    xidHex: bytesToHex(xid),
    signingPrivateKey,
    agreementPrivateKey,
  };
}

/** Derive the dedicated Bulletin/HOP upload signer for a T3ams bot. */
export function deriveT3amsBulletinUploadSignerFromSeed(seed) {
  return deriveSr25519PairFromSeed(requireSeed(seed), T3AMS_BULLETIN_UPLOAD_DERIVATION);
}

/** Convenience wrapper for BOT_SEED_HEX / secret.json seedHex values. */
export function deriveT3amsIdentity(seedHex) {
  return deriveT3amsIdentityFromSeed(botSeedFromHex(seedHex));
}

/** Convenience wrapper for BOT_SEED_HEX / secret.json seedHex values. */
export function deriveT3amsBulletinUploadSigner(seedHex) {
  return deriveT3amsBulletinUploadSignerFromSeed(botSeedFromHex(seedHex));
}
