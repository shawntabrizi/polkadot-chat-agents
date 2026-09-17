// The People-chain state a bot reads, behind one interface:
//
//   consumerOf(accountHex)       -> the account's `Resources.Consumers` entry
//                                   { account, username, identifierKey, credibility }
//                                   or null when the chain does not hold it
//   identifierKeyFor(accountHex) -> the account's RFC-0004 identifier-key
//                                   container (65 bytes, 0x-hex) or null
//   usernameOwner(name)          -> the account (0x-hex) that owns a username,
//                                   or null
//
// Two implementations of the same contract: the chain through papi
// (`Resources.Consumers`, `Resources.UsernameOwnerOf`) and the local sandbox
// through its control API (`GET /api/consumers/:account`, `GET /api/usernames/:name`),
// which serves the same state for a network that exists only on this machine.
// index.mjs and cli.mjs talk to this seam and nothing else: no storage query
// is issued outside this file, so a bot can be pointed at either backend by
// its network profile alone.
//
// A `Consumers` value (People runtime 2005001 on Products Devnet, 3002000 on
// Paseo Next — one shape on both) is `{ identifier_key, full_username?,
// lite_username, credibility }`. papi hands `identifier_key` back as hex or
// as Binary and the usernames as Binary or bytes, depending on the api
// (typed or unsafe) and the descriptor version; every form is read.
//
// Registration is deliberately NOT part of the read contract. On a real
// network it goes through the identity backend (lib/register.mjs); the
// sandbox directory registers directly (`register`), which only it exposes.

import { Binary } from "polkadot-api";
import { ss58Address, ss58Decode } from "@polkadot-labs/hdkd-helpers";
import { withTimeout } from "../vendor/lib/async-utils.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;

const hexToBytes = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex value (${clean.length} chars)`);
  return Uint8Array.from(clean.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
};
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
/** `0x`-prefixed lowercase hex, from hex in either form. */
const normHex = (hex) => `0x${String(hex).trim().replace(/^0x/i, "").toLowerCase()}`;
// papi hands fixed-size storage values back as Binary; older descriptors as hex.
const binaryHex = (value) => (typeof value === "string" ? value : typeof value?.asHex === "function" ? value.asHex() : value instanceof Uint8Array ? `0x${bytesToHex(value)}` : String(value));
const binaryText = (value) => (value == null ? null : typeof value === "string" ? value : typeof value?.asText === "function" ? value.asText() : value instanceof Uint8Array ? new TextDecoder().decode(value) : null);

/** A `Consumers` value in the shape the read contract promises. */
export function decodeConsumer(accountHex, value) {
  if (value == null || value.identifier_key == null) return null;
  return {
    account: normHex(accountHex),
    username: binaryText(value.full_username) ?? binaryText(value.lite_username) ?? null,
    identifierKey: normHex(binaryHex(value.identifier_key)),
    /** "Lite" or "Person" (the pallet's credibility enum), null when the chain predates it. */
    credibility: typeof value.credibility?.type === "string" ? value.credibility.type : null,
  };
}

export function createChainDirectory(peopleApi, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (peopleApi?.query?.Resources == null) throw new Error("createChainDirectory needs a People typed api");
  const directory = {
    kind: "chain",
    async consumerOf(accountHex) {
      const value = await withTimeout(
        peopleApi.query.Resources.Consumers.getValue(ss58Address(hexToBytes(accountHex), 42)),
        timeoutMs, "identifier lookup");
      return decodeConsumer(accountHex, value);
    },
    async identifierKeyFor(accountHex) {
      return (await directory.consumerOf(accountHex))?.identifierKey ?? null;
    },
    async usernameOwner(name) {
      const owner = await withTimeout(
        peopleApi.query.Resources.UsernameOwnerOf.getValue(Binary.fromText(String(name))),
        timeoutMs, "username lookup");
      if (typeof owner !== "string" || owner === "") return null;
      return normHex(bytesToHex(ss58Decode(owner)[0]));
    },
  };
  return directory;
}

export function createSandboxDirectory(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = String(url ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("the sandbox directory URL must be http(s)://");
  const call = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `sandbox directory ${method} ${route} failed (${res.status})`);
    return data;
  };
  const directory = {
    kind: "sandbox",
    url: base,
    async consumerOf(accountHex) {
      const consumer = await call("GET", `/api/consumers/${normHex(accountHex)}`);
      if (consumer?.identifierKey == null) return null;
      return { account: normHex(accountHex), username: consumer.username ?? null, identifierKey: normHex(consumer.identifierKey), credibility: consumer.credibility ?? null };
    },
    async identifierKeyFor(accountHex) {
      return (await directory.consumerOf(accountHex))?.identifierKey ?? null;
    },
    async usernameOwner(name) {
      const entry = await call("GET", `/api/usernames/${encodeURIComponent(String(name))}`);
      return entry?.account == null ? null : normHex(entry.account);
    },
    /**
     * The sandbox's `register_lite_person`: username + identifier key +
     * statement allowance in one call, plus the Bulletin authorization for
     * the bot's upload signer (`bulletinAccount`, public key only).
     */
    async register({ account, username, identifierKey, bulletinAccount = null }) {
      return call("POST", "/api/accounts/register", {
        account: normHex(account), username, identifierKey: normHex(identifierKey),
        ...(bulletinAccount ? { bulletinAccount: normHex(bulletinAccount) } : {}),
      });
    },
  };
  return directory;
}

/**
 * Is a registration still on the chain? One read (`Consumers`): the chain
 * is the truth, not the genesis hash — Products Devnet wiped every
 * lite-person registration on 2026-09-08 without a genesis change. Returns
 *   { onChain: false }                                   the chain has no entry for the account
 *   { onChain: true, username, identifierKey, credibility, renamed }
 * where `renamed` says the chain's username differs from the one given
 * (a re-registration made elsewhere). A transport failure throws.
 */
export async function registrationOnChain(directory, { account, username = null }) {
  const consumer = await directory.consumerOf(account);
  if (!consumer) return { onChain: false };
  return { onChain: true, ...consumer, renamed: username != null && consumer.username != null && consumer.username !== username };
}
