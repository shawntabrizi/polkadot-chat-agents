// Byte helpers shared by the sandbox modules. Accounts and keys are
// Uint8Arrays on the wire and `0x`-prefixed lowercase hex as map keys and in
// the API, so the same value always compares equal as a string.

import { fromHex, toHex } from "polkadot-api/utils";

export const bytesToHex = (bytes) => toHex(bytes);

export const hexToBytes = (hex) => fromHex(hex);

/** `0x`-prefixed lowercase hex from bytes or from hex in either form. */
export const normHex = (value) => (typeof value === "string" ? `0x${value.replace(/^0x/i, "").toLowerCase()}` : bytesToHex(value));

export const bytesEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Message and request ids; the apps use UUID strings too. */
export const randomId = () => crypto.randomUUID();

/** JSON-line logging like bot-core. Never pass a seed or a private key. */
export const log = (event, extra = {}) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`);
