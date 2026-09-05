// One device of a persona: its own sr25519 statement account (what signs
// statements and holds the allowance), its own X25519 encryption key (what
// peers wrap per-device envelopes for, mds.md), and its own transport — a
// statement-store connection with its subscriptions and sessions (`engine`,
// see chat.mjs). Mirrors polkadot-chat-web src/domain/device/keys.ts.

import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { createSr25519Secret, deriveSr25519PublicKey } from "@novasamatech/statement-store";

import { bytesToHex } from "./bytes.mjs";

const ENTROPY_BYTES = 32;
/** Expanded sr25519 secret, as `createSr25519Secret` produces it. */
export const STATEMENT_SEED_BYTES = 64;
/** X25519 key size (CHAT-RFC-0004). */
export const ENCRYPTION_KEY_BYTES = 32;
const ACCOUNT_ID_BYTES = 32;

export const toDeviceKeys = (statementSeed, encryptionPrivateKey) => ({
  statementSeed,
  statementAccountId: deriveSr25519PublicKey(statementSeed),
  encryptionPrivateKey,
  encryptionPublicKey: x25519.getPublicKey(encryptionPrivateKey),
});

/** Fresh keys. Never derived from the identity: peers address the device by its statement account. */
export const mintDeviceKeys = () => toDeviceKeys(createSr25519Secret(randomBytes(ENTROPY_BYTES)), x25519.utils.randomSecretKey());

/**
 * A peer device as wire data. A malformed entry would break every outgoing
 * envelope to that contact (the per-device wrap throws), so it is checked
 * before it is stored. Size is all that can be checked: every 32-byte string
 * is a valid X25519 key; degenerate ones fail at agreement time (RFC 7748).
 */
export const isUsablePeerDevice = (device) =>
  device.statementAccountId.length === ACCOUNT_ID_BYTES && device.encryptionPublicKey.length === ENCRYPTION_KEY_BYTES;

export function createDevice({ index, keys = mintDeviceKeys() }) {
  const device = {
    index,
    keys,
    account: bytesToHex(keys.statementAccountId),
    /** How peers see this device (`DeviceInfo` in mds.md). */
    info: { statementAccountId: keys.statementAccountId, encryptionPublicKey: keys.encryptionPublicKey },
    /** The chat engine while online (persona.start wires it): subscriptions and sessions of this device only. */
    engine: null,
    stop() {
      device.engine?.dispose();
      device.engine = null;
    },
    /** Public half only: safe to log and to hand to the API. */
    toJSON: () => ({ index, account: device.account, encryptionPublicKey: bytesToHex(keys.encryptionPublicKey), online: device.engine != null }),
  };
  return device;
}
