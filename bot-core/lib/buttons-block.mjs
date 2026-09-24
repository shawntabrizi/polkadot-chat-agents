// shared with polkadot-chat-desktop src/shared/buttonsBlock.ts
//
// Spec 0006 buttons from a brain's plain-text reply. A brain (an LLM) cannot
// build a SCALE message, so it ends its reply with a fenced block:
//
//   ```buttons
//   { "rows": [[{ "label": "Yes", "action": { "command": "yes" } },
//               { "label": "More", "action": { "callback": "page-2" } }],
//              [{ "label": "Docs", "action": { "url": "https://polkadot.com" } }]],
//     "oneShot": true }
//   ```
//
// Actions: { "command": string } (the client sends it as the user's text),
// { "callback": string } (UTF-8 bytes echoed in a buttonPress; a
// "base64:" prefix gives raw bytes instead), { "url": string } (https:// or
// polkadotapp:// only), { "tx": { chainId, calls, display, expiresAt,
// dryRunRequired? } } (spec 0007: a chain call the client dry-runs and signs;
// see toTxIntent). A `tx` becomes the codec's TxIntent object (u64/u128 as
// bigint, bytes as Uint8Array); the codec encodes it into Action tag 3.
//
// Pure functions, no Node APIs: keep this file easy to port byte for byte.
// Any rule broken -> the block is invalid and the reply stays plain text.

export const MAX_ROWS = 8;
export const MAX_BUTTONS_PER_ROW = 4;
export const MAX_LABEL_CHARS = 40;
export const MAX_CALLBACK_BYTES = 256;

export const MAX_TX_CALLS = 8;
export const MAX_TX_DATA_BYTES = 16 * 1024;
export const MAX_TX_TITLE_CHARS = 60;
export const MAX_TX_DESCRIPTION_CHARS = 280;

const OPEN_FENCE = "```buttons";
const URL_SCHEMES = ["https://", "polkadotapp://"];

const decodeBase64 = (value) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); } catch { return null; }
};

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const hexBytes = (value, { length = null, max = Infinity } = {}) => {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) return null;
  const bytes = Uint8Array.from(value.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16));
  if ((length != null && bytes.length !== length) || bytes.length > max) return null;
  return bytes;
};
// A decimal string or a non-negative safe integer -> bigint below 2^bits, or null.
const uint = (value, bits) => {
  let big = null;
  if (typeof value === "string" && /^\d{1,40}$/.test(value)) big = BigInt(value);
  else if (Number.isSafeInteger(value) && value >= 0) big = BigInt(value);
  return big != null && big < 1n << BigInt(bits) ? big : null;
};
const optionalUint = (value, bits) => (value === undefined || value === null ? { ok: true, value: null } : { ok: uint(value, bits) != null, value: uint(value, bits) });
const shortString = (value, max, { empty = true } = {}) =>
  typeof value === "string" && (empty || value.length > 0) && [...value].length <= max;

// Spec 0007 TxIntent from the JSON, or null. chainId is the target chain's
// genesis hash; `to`/`data` are 0x hex; `value` a decimal string (u128).
export const toTxIntent = (tx) => {
  if (!isObject(tx)) return null;
  const known = new Set(["chainId", "calls", "display", "expiresAt", "dryRunRequired", "version"]);
  if (Object.keys(tx).some((k) => !known.has(k))) return null;
  if (tx.version !== undefined && tx.version !== 1) return null;
  if (tx.dryRunRequired !== undefined && tx.dryRunRequired !== true) return null;
  if (!hexBytes(tx.chainId, { length: 32 })) return null;
  const expiresAt = uint(tx.expiresAt, 64);
  if (expiresAt == null || expiresAt === 0n) return null;
  if (!Array.isArray(tx.calls) || tx.calls.length === 0 || tx.calls.length > MAX_TX_CALLS) return null;
  const calls = [];
  for (const call of tx.calls) {
    if (!isObject(call) || (call.kind !== 0 && call.kind !== 1)) return null;
    const to = call.to == null ? null : hexBytes(call.to, { length: 20 });
    if (call.to != null && !to) return null;
    if (call.kind === 1 && !to) return null;
    const data = hexBytes(call.data, { max: MAX_TX_DATA_BYTES });
    const value = call.value === undefined ? 0n : uint(call.value, 128);
    if (!data || value == null) return null;
    const gas = [optionalUint(call.gasRefTime, 64), optionalUint(call.gasProofSize, 64), optionalUint(call.storageDepositLimit, 128)];
    if (gas.some((g) => !g.ok)) return null;
    if (call.kind === 0 && gas.some((g) => g.value != null)) return null;
    calls.push({ kind: call.kind, to, data, value, gasRefTime: gas[0].value, gasProofSize: gas[1].value, storageDepositLimit: gas[2].value });
  }
  const d = tx.display;
  if (!isObject(d) || !shortString(d.title, MAX_TX_TITLE_CHARS, { empty: false })) return null;
  if (d.description !== undefined && !shortString(d.description, MAX_TX_DESCRIPTION_CHARS)) return null;
  for (const key of ["amount", "asset"]) if (d[key] != null && !shortString(d[key], 64, { empty: false })) return null;
  return {
    version: 1,
    chainId: tx.chainId.toLowerCase(),
    calls,
    display: { title: d.title, description: d.description ?? "", amount: d.amount ?? null, asset: d.asset ?? null },
    dryRunRequired: true,
    expiresAt,
  };
};

// { command } | { callback } | { url } | { tx } from the JSON -> the codec's
// action shape (callback as bytes, tx as a TxIntent object), or null.
const toAction = (action) => {
  if (action == null || typeof action !== "object" || Array.isArray(action)) return null;
  const keys = Object.keys(action);
  if (keys.length !== 1) return null;
  const [key] = keys;
  const value = action[key];
  if (key === "tx") {
    const intent = toTxIntent(value);
    return intent ? { tx: intent } : null;
  }
  if (typeof value !== "string" || value.length === 0) return null;
  if (key === "command") return { command: value };
  if (key === "url") return URL_SCHEMES.some((s) => value.startsWith(s)) && value.length > 8 ? { url: value } : null;
  if (key === "callback") {
    const bytes = value.startsWith("base64:") ? decodeBase64(value.slice(7)) : new TextEncoder().encode(value);
    return bytes && bytes.length > 0 && bytes.length <= MAX_CALLBACK_BYTES ? { callback: bytes } : null;
  }
  return null;
};

// The parsed JSON -> { rows, oneShot } in the codec's shape, or null.
export const validateButtons = (spec) => {
  if (spec == null || typeof spec !== "object" || Array.isArray(spec)) return null;
  if (spec.oneShot !== undefined && typeof spec.oneShot !== "boolean") return null;
  const { rows } = spec;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return null;
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0 || row.length > MAX_BUTTONS_PER_ROW) return null;
    const buttons = [];
    for (const button of row) {
      const label = typeof button?.label === "string" ? button.label.trim() : "";
      if (label.length === 0 || [...label].length > MAX_LABEL_CHARS) return null;
      const action = toAction(button.action);
      if (!action) return null;
      buttons.push({ label, action });
    }
    out.push(buttons);
  }
  return { rows: out, oneShot: spec.oneShot === true };
};

// A reply that ENDS with a ```buttons block -> { text, rows, oneShot }, where
// text is the reply without the block. No block, or an invalid one -> null.
export const parseButtonsBlock = (reply) => {
  if (typeof reply !== "string") return null;
  const body = reply.trimEnd();
  if (!body.endsWith("```")) return null;
  const start = body.lastIndexOf(OPEN_FENCE);
  if (start < 0 || (start > 0 && body[start - 1] !== "\n")) return null;
  const afterTag = body.indexOf("\n", start);
  if (afterTag < 0 || body.slice(start + OPEN_FENCE.length, afterTag).trim() !== "") return null;
  const json = body.slice(afterTag + 1, body.length - 3);
  if (json.includes("```")) return null;
  let spec;
  try { spec = JSON.parse(json); } catch { return null; }
  const buttons = validateButtons(spec);
  if (!buttons) return null;
  return { text: body.slice(0, start).trimEnd(), ...buttons };
};

// Spec 0006 "host parsing leniency" (revision 2026-09-24). Small models write
// a bare or ```json fence, a flat array of buttons instead of {"rows": [[…]]},
// or text after the block. This accepts a fence tagged buttons, json or
// untagged, anywhere in the reply, holding the rows object or a flat array
// (one row). The content rules are validateButtons' rules. The last fence that
// validates gives the rows. A fence that looks like buttons (tagged buttons,
// or JSON with `label` keys) but fails the rules is stripped too, and its
// reason goes in `invalid`, so a person never sees the raw JSON. Any other
// fence (ordinary code) stays in the text.
// -> null when no fence looks like buttons, else
//    { text, rows, oneShot, invalid: [reason] } (rows null when none validated).
const FENCE = /(^|\n)[ \t]*```([^\n`]*)\n([\s\S]*?)\n?[ \t]*```[ \t]*(?=\n|$)/g;
const LENIENT_TAGS = new Set(["buttons", "json", ""]);
const hasLabel = (v) => isObject(v) && "label" in v;
const looksLikeButtons = (tag, spec) => tag === "buttons"
  || (Array.isArray(spec) && spec.some(hasLabel))
  || (isObject(spec) && Array.isArray(spec.rows) && spec.rows.some((row) => Array.isArray(row) && row.some(hasLabel)));
// Why a buttons-like spec fails validateButtons (a short reason for the log).
const invalidReason = (spec) => {
  if (!isObject(spec)) return "not a rows object or a flat array of buttons";
  if (spec.oneShot !== undefined && typeof spec.oneShot !== "boolean") return "oneShot is not a boolean";
  const { rows } = spec;
  if (!Array.isArray(rows) || rows.length === 0) return "no rows";
  if (rows.length > MAX_ROWS) return `${rows.length} rows (max ${MAX_ROWS})`;
  for (const [r, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length === 0) return `row ${r + 1} is empty or not an array`;
    if (row.length > MAX_BUTTONS_PER_ROW) return `row ${r + 1} has ${row.length} buttons (max ${MAX_BUTTONS_PER_ROW})`;
    for (const [b, button] of row.entries()) {
      if (!validateButtons({ rows: [[button]] })) return `row ${r + 1} button ${b + 1}: bad label (1-${MAX_LABEL_CHARS} characters) or action`;
    }
  }
  return "invalid";
};

export const extractButtonsBlock = (reply) => {
  if (typeof reply !== "string") return null;
  const pieces = [];
  const invalid = [];
  let found = false;
  let best = null;
  let last = 0;
  for (const match of reply.matchAll(FENCE)) {
    const tag = match[2].trim().toLowerCase();
    if (!LENIENT_TAGS.has(tag)) continue;
    let spec;
    try { spec = JSON.parse(match[3]); } catch { spec = undefined; }
    if (spec === undefined ? tag !== "buttons" : !looksLikeButtons(tag, spec)) continue;
    found = true;
    const start = match.index + match[1].length;
    pieces.push(reply.slice(last, start));
    last = match.index + match[0].length;
    const shaped = Array.isArray(spec) ? { rows: [spec] } : spec;
    const buttons = spec === undefined ? null : validateButtons(shaped);
    if (buttons) best = buttons;
    else invalid.push(spec === undefined ? "not JSON" : invalidReason(shaped));
  }
  if (!found) return null;
  pieces.push(reply.slice(last));
  const text = pieces.map((p) => p.trim()).filter(Boolean).join("\n\n");
  return { text, rows: best?.rows ?? null, oneShot: best?.oneShot ?? false, invalid };
};

// Spec 0006 fallback for a peer without the extension: the text, then the
// labels as a numbered list, in row order.
export const buttonsFallbackText = (text, rows) => {
  const labels = rows.flat().map((button, i) => `${i + 1}. ${button.label}`);
  return [text, labels.join("\n")].filter(Boolean).join("\n\n");
};
