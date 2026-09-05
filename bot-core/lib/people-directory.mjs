// The People-chain state a bot reads, behind one interface:
//
//   identifierKeyFor(accountHex) -> the account's RFC-0004 identifier-key
//                                   container (65 bytes, 0x-hex) or null
//   usernameOwner(name)          -> the account (0x-hex) that owns a username,
//                                   or null
//
// Two implementations of the same contract: the chain through papi
// (`Resources.Consumers`, `Resources.UsernameOwnerOf`) and the local sandbox
// through its control API (`GET /consumers/:account`, `GET /usernames/:name`),
// which serves the same state for a network that exists only on this machine.
// index.mjs and cli.mjs talk to this seam and nothing else: no storage query
// is issued outside this file, so a bot can be pointed at either backend by
// its network profile alone.
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
const binaryHex = (value) => (typeof value === "string" ? value : typeof value?.asHex === "function" ? value.asHex() : String(value));

export function createChainDirectory(peopleApi, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (peopleApi?.query?.Resources == null) throw new Error("createChainDirectory needs a People typed api");
  return {
    kind: "chain",
    async identifierKeyFor(accountHex) {
      const consumer = await withTimeout(
        peopleApi.query.Resources.Consumers.getValue(ss58Address(hexToBytes(accountHex), 42)),
        timeoutMs, "identifier lookup");
      return consumer?.identifier_key == null ? null : normHex(binaryHex(consumer.identifier_key));
    },
    async usernameOwner(name) {
      const owner = await withTimeout(
        peopleApi.query.Resources.UsernameOwnerOf.getValue(Binary.fromText(String(name))),
        timeoutMs, "username lookup");
      if (typeof owner !== "string" || owner === "") return null;
      return normHex(bytesToHex(ss58Decode(owner)[0]));
    },
  };
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
  return {
    kind: "sandbox",
    url: base,
    async identifierKeyFor(accountHex) {
      const consumer = await call("GET", `/consumers/${normHex(accountHex)}`);
      return consumer?.identifierKey == null ? null : normHex(consumer.identifierKey);
    },
    async usernameOwner(name) {
      const entry = await call("GET", `/usernames/${encodeURIComponent(String(name))}`);
      return entry?.account == null ? null : normHex(entry.account);
    },
    /** The sandbox's `register_lite_person`: username + identifier key + statement allowance, in one call. */
    async register({ account, username, identifierKey }) {
      return call("POST", "/accounts/register", { account: normHex(account), username, identifierKey: normHex(identifierKey) });
    },
  };
}
