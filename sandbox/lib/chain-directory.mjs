// The directory on a real network: the People chain's `Resources` pallet
// read through papi, plus the identity backend's username search. Same
// contract as the mock directory (lib/directory.mjs) — consumer, identityOf,
// usernameOwner, list — with every chain read async, and the two reads
// bot-core's registration helper needs (identifierKeyFor, usernameOwner).
//
//   Resources.Consumers(account)    -> { identifier_key: [u8;65], lite_username, ... }
//   Resources.UsernameOwnerOf(name) -> AccountId32
//   GET {backend}/api/v1/usernames/search?prefix=<p> -> { usernames: [{ accountId, username, status }], nextCursor }
//
// The chain is the truth; the backend's search is a hint. Its records
// survive a chain reset (a username can be ASSIGNED there and absent on
// chain), so every search hit is checked against `UsernameOwnerOf` and
// reported with `onChain`. Accounts this sandbox has seen — its personas,
// attached bots, every successful lookup — are kept in a small cache so the
// wire inspector can label them synchronously (`list()`).
//
// bot-core import allowed here by the S6 rules: lib/register.mjs is the
// identity backend client (its search route, with the paging, rate-limit
// and proof-of-compute handling, and the chain's form of a username);
// the backend is not the chat protocol under test.

import { AccountId, Binary } from "polkadot-api";

import { searchUsernames } from "../../bot-core/lib/register.mjs";
import { bytesToHex, hexToBytes, normHex } from "./bytes.mjs";
import { unwrapIdentifierKey } from "./directory.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;
const ss58 = AccountId(42);

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms).unref?.()),
]);
// papi hands a fixed-size storage value back as 0x-hex or as Binary, a
// bounded Vec<u8> as bytes; take each form.
const asHex = (value) => (typeof value === "string" ? normHex(value) : typeof value?.asHex === "function" ? normHex(value.asHex()) : value instanceof Uint8Array ? bytesToHex(value) : null);
const asText = (value) => (typeof value === "string" ? value : typeof value?.asText === "function" ? value.asText() : value instanceof Uint8Array ? new TextDecoder().decode(value) : null);
const toSs58 = (accountHex) => ss58.dec(hexToBytes(normHex(accountHex)));
const fromSs58 = (address) => bytesToHex(ss58.enc(address));

export function createChainDirectory({ client, backendUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof client?.getUnsafeApi !== "function") throw new Error("createChainDirectory needs a papi client");
  const api = client.getUnsafeApi();
  const known = new Map(); // account hex -> { account, username, identifierKey, bulletinAccount }
  const chain = (promise, what) => withTimeout(promise, timeoutMs, what);

  const remember = (entry) => {
    const account = normHex(entry.account);
    const previous = known.get(account) ?? {};
    known.set(account, { ...previous, ...entry, account, identifierKey: entry.identifierKey ? normHex(entry.identifierKey) : previous.identifierKey ?? null, bulletinAccount: entry.bulletinAccount ? normHex(entry.bulletinAccount) : previous.bulletinAccount ?? null });
    return known.get(account);
  };

  const readConsumer = async (accountHex) => {
    const value = await chain(api.query.Resources.Consumers.getValue(toSs58(accountHex)), "Resources.Consumers");
    if (value == null) return null;
    const identifierKey = asHex(value.identifier_key);
    const username = asText(value.full_username) ?? asText(value.lite_username) ?? null;
    return { account: normHex(accountHex), username, identifierKey };
  };

  const directory = {
    kind: "chain",
    backendUrl,
    remember,
    /** What `pcs wire` and the pool view label with: every account this sandbox has seen a username for. */
    list: () => [...known.values()].map((e) => ({ ...e, allowance: e.identifierKey != null, hopAllowance: e.bulletinAccount != null })),

    /** `Resources::Consumers(account)` as bot-core reads it: the 65-byte container, or null. */
    async consumer(account) {
      const entry = await readConsumer(account);
      if (!entry?.identifierKey) return null;
      remember(entry);
      return entry;
    },
    /** bot-core's read contract (register.mjs waits on this). */
    async identifierKeyFor(accountHex) {
      return (await readConsumer(accountHex))?.identifierKey ?? null;
    },
    /** The chat engine's lookup: the unwrapped X25519 key, or null for a P-256 (legacy) key or no entry. */
    async identityOf(account) {
      const entry = await directory.consumer(account);
      if (!entry) return null;
      const chatPublicKey = unwrapIdentifierKey(entry.identifierKey);
      if (!chatPublicKey) return null;
      return { account: entry.account, username: entry.username, chatPublicKey };
    },
    /** `Resources::UsernameOwnerOf(name)`: the exact username with its digits. */
    async usernameOwner(name) {
      const owner = await chain(api.query.Resources.UsernameOwnerOf.getValue(Binary.fromText(String(name))), "Resources.UsernameOwnerOf");
      if (owner == null || owner === "") return null;
      const account = typeof owner === "string" && !owner.startsWith("0x") ? fromSs58(owner) : normHex(asHex(owner));
      remember({ account, username: String(name) });
      return account;
    },
    /**
     * The identity backend's search, each hit checked against the chain.
     * A hit that is `onChain: false` was registered before a reset (or is
     * still being attested); it cannot be messaged.
     */
    async search(prefix) {
      const hits = await searchUsernames({ backendUrl, prefix: String(prefix), fetchImpl: (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }) });
      const out = [];
      for (const hit of hits) {
        const account = normHex(hit.account);
        const owner = await directory.usernameOwner(hit.username).catch(() => null);
        out.push({ username: hit.username, account, status: hit.status, onChain: owner === account });
      }
      return out;
    },
  };
  return directory;
}
