// The People-chain state the chat clients read, kept in memory.
//
// On chain a messageable account has a `Resources::Consumers` entry with an
// `identifier_key`: a fixed 65-byte container `0x00 || x25519_pk || pad`
// (CHAT-RFC-0004 §4). The directory stores that container, so bot-core's
// decoder (`decodeAccountEcdhKey`) and the SDK's `decodeRawIdentity` read
// exactly what they would read on chain. Usernames map to the identity
// account (`Resources::UsernameOwnerOf`), and every account that may submit
// statements — the identity and each device statement account (mds.md
// "Statement Store allowance") — is added to the store node's allowance set.

import { bytesEqual, hexToBytes, normHex } from "./bytes.mjs";

export const IDENTIFIER_KEY_BYTES = 65;
const CHAT_KEY_BYTES = 32;
const X25519_TYPE = 0x00;

/** `0x00 || pk || zero pad`, the on-chain form of an X25519 chat key. */
export function wrapIdentifierKey(chatPublicKey) {
  const key = typeof chatPublicKey === "string" ? hexToBytes(chatPublicKey) : chatPublicKey;
  if (key.length === IDENTIFIER_KEY_BYTES) return Uint8Array.from(key);
  if (key.length !== CHAT_KEY_BYTES) throw new Error(`identifier key must be ${CHAT_KEY_BYTES} or ${IDENTIFIER_KEY_BYTES} bytes, got ${key.length}`);
  const container = new Uint8Array(IDENTIFIER_KEY_BYTES);
  container[0] = X25519_TYPE;
  container.set(key, 1);
  return container;
}

/** The 32-byte X25519 key inside a container; null for another key type. Readers ignore the padding. */
export function unwrapIdentifierKey(container) {
  const bytes = typeof container === "string" ? hexToBytes(container) : container;
  if (bytes.length !== IDENTIFIER_KEY_BYTES || bytes[0] !== X25519_TYPE) return null;
  return bytes.slice(1, 1 + CHAT_KEY_BYTES);
}

const validUsername = (name) => /^[a-z0-9][a-z0-9._-]{0,31}$/.test(name);

export function createDirectory({ allowances }) {
  const accounts = new Map(); // account hex -> { account, username, identifierKey (container hex) | null }
  const owners = new Map(); // username -> account hex

  const grant = (account) => { allowances.add(account); };

  return {
    /**
     * `register_lite_person` for the sandbox: username + identifier key +
     * statement allowance in one step. Re-registering an account updates its
     * key (`update_identifier_key`); usernames stay unique across accounts.
     */
    register(account, { username, identifierKey }) {
      const acct = normHex(account);
      if (hexToBytes(acct).length !== 32) throw new Error("account must be 32 bytes");
      if (!validUsername(username)) throw new Error(`invalid username: ${username}`);
      const owner = owners.get(username);
      if (owner != null && owner !== acct) throw new Error(`username taken: ${username}`);
      const existing = accounts.get(acct);
      if (existing?.username && existing.username !== username) throw new Error(`${acct} already owns username ${existing.username}`);
      const container = wrapIdentifierKey(identifierKey);
      const entry = { account: acct, username, identifierKey: normHex(container) };
      accounts.set(acct, entry);
      owners.set(username, acct);
      grant(acct);
      return { ...entry };
    },

    /** `set_statement_store_account`: bandwidth only, no username, no key (device accounts). */
    allow(account) {
      const acct = normHex(account);
      if (!accounts.has(acct)) accounts.set(acct, { account: acct, username: null, identifierKey: null });
      grant(acct);
      return { ...accounts.get(acct) };
    },

    /** `Resources::Consumers(account)` as bot-core reads it: the 65-byte container. */
    consumer(account) {
      const entry = accounts.get(normHex(account));
      if (!entry?.identifierKey) return null;
      return { account: entry.account, username: entry.username, identifierKey: entry.identifierKey };
    },

    /** What the SDK's identity lookup hands the chat engine: the unwrapped 32-byte chat key. */
    identityOf(account) {
      const entry = accounts.get(normHex(account));
      if (!entry?.identifierKey) return null;
      const chatPublicKey = unwrapIdentifierKey(entry.identifierKey);
      if (!chatPublicKey) return null;
      return { account: entry.account, username: entry.username, chatPublicKey };
    },

    /** `Resources::UsernameOwnerOf(name)`. */
    usernameOwner(name) {
      return owners.get(name) ?? null;
    },

    hasAllowance: (account) => allowances.has(normHex(account)),

    list() {
      return [...accounts.values()].map((e) => ({ ...e, allowance: allowances.has(e.account) }));
    },
  };
}

/** Two containers carry the same chat key (padding ignored). */
export const sameIdentifierKey = (a, b) => {
  const [x, y] = [unwrapIdentifierKey(a), unwrapIdentifierKey(b)];
  return x != null && y != null && bytesEqual(x, y);
};
