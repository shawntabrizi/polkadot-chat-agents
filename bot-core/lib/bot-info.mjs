// Spec 0008 bot info (polkadot-chat-desktop docs/spec/0008-bot-info.md).
//
// The bot's own document lives in an operator-owned `botinfo.json` in the
// bot workspace, next to PERSONA.md. `pca create` seeds it; the bot reads it
// again for every send, so an edit applies to the next accept or /start.
// The wire `version` is not in the file: the bot bumps it when the file's
// content hash changes and keeps { hash, version } in `botinfo.state.json`
// next to it (a client keeps the highest version it has seen).
//
// Kept apart from index.mjs so the file -> document rules are unit-tested.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { commandCatalog, resolveModelPolicy } from "./commands.mjs";
import { BOT_INFO_LIMITS, encodeOpaqueBotInfoMessage } from "../vendor/app-chat-codec.mjs";

export const BOT_INFO_FILE = "botinfo.json";
export const BOT_INFO_STATE_FILE = "botinfo.state.json";
const FIELDS = ["kind", "name", "description", "greeting", "commands", "balance"];
// Spec 0008 v2 balance hint, as the file holds it: bytes as 0x hex, perReply
// as a decimal string (a u128 does not fit a JSON number) or null.
const BALANCE_FIELDS = ["chainId", "contract", "selector", "decimals", "unit", "perReply", "label"];
const MAX_FILE_BYTES = 64 * 1024;

// The echo brain is a plain automated bot; every other brain puts a model
// behind the chat (spec kind 1, agent).
export const defaultBotInfo = ({ name, brain } = {}) => ({
  kind: brain === "echo" ? 0 : 1,
  name: [...(String(name ?? "").trim() || "Bot")].slice(0, BOT_INFO_LIMITS.name).join(""),
  description: "A bot on Polkadot",
  greeting: "Hello!",
  // The chat command catalog with its default (locked) model policy. The
  // echo brain answers no chat command, so it lists none.
  commands: brain === "echo" ? [] : commandCatalog({ allowedModels: resolveModelPolicy() }).map(({ command, meaning }) => ({
    name: command.replace(/^\//, ""),
    description: [...meaning].slice(0, BOT_INFO_LIMITS.commandDescription).join(""),
  })),
});

// The file content as a document: missing fields come from the defaults, an
// unknown field is an error (a typo like "greting" must not pass silently),
// and the codec's own limits validate the rest.
export const botInfoFromFile = (raw, defaults) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${BOT_INFO_FILE} must be a JSON object`);
  const unknown = Object.keys(raw).filter((key) => !FIELDS.includes(key));
  if (unknown.length) throw new Error(`${BOT_INFO_FILE} has unknown field(s): ${unknown.join(", ")} (known: ${FIELDS.join(", ")})`);
  const info = { ...defaults, ...raw };
  if (!Array.isArray(info.commands)) throw new Error(`${BOT_INFO_FILE} commands must be a list`);
  info.commands = info.commands.map((c) => ({ name: c?.name, description: c?.description ?? "" }));
  if (info.balance == null) delete info.balance;
  else info.balance = balanceFromFile(info.balance);
  encodeOpaqueBotInfoMessage({ ...info, version: 0 }); // throws on any limit
  return info;
};

const balanceFromFile = (raw) => {
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${BOT_INFO_FILE} balance must be an object`);
  const unknown = Object.keys(raw).filter((key) => !BALANCE_FIELDS.includes(key));
  if (unknown.length) throw new Error(`${BOT_INFO_FILE} balance has unknown field(s): ${unknown.join(", ")} (known: ${BALANCE_FIELDS.join(", ")})`);
  const hex = (key, bytes) => {
    const value = String(raw[key] ?? "").toLowerCase();
    if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(value)) throw new Error(`${BOT_INFO_FILE} balance.${key} must be 0x + ${bytes * 2} hex digits`);
    return value;
  };
  const perReply = raw.perReply ?? null;
  if (perReply != null && !(typeof perReply === "string" && /^\d+$/.test(perReply))) throw new Error(`${BOT_INFO_FILE} balance.perReply must be a decimal integer string or null`);
  return {
    chainId: hex("chainId", 32), // the genesis hash
    contract: hex("contract", 20),
    selector: hex("selector", 4),
    decimals: raw.decimals,
    unit: raw.unit,
    perReply,
    label: raw.label,
  };
};

// A document without a balance hint hashes as it did before v2, so adding
// the field did not bump every bot's version.
const hashOf = (info) => crypto.createHash("sha256").update(JSON.stringify(FIELDS.filter((key) => key !== "balance" || info.balance != null).map((key) => info[key]))).digest("hex");

const readJson = (file) => {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`${path.basename(file)} is larger than ${MAX_FILE_BYTES} bytes`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

// The current document with its version. Throws when the file is invalid.
// A missing file means the defaults. A state file that cannot be written
// (read-only workspace) keeps the version it had; `stateError` says why.
export const loadBotInfo = ({ dir, defaults }) => {
  const file = path.join(dir, BOT_INFO_FILE);
  let raw = {};
  try { raw = readJson(file); }
  catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`${BOT_INFO_FILE}: ${String(error?.message ?? error)}`);
  }
  const info = botInfoFromFile(raw, defaults);
  const hash = hashOf(info);
  const stateFile = path.join(dir, BOT_INFO_STATE_FILE);
  let state = null;
  try {
    const saved = readJson(stateFile);
    if (typeof saved?.hash === "string" && Number.isInteger(saved?.version) && saved.version >= 1 && saved.version <= 0xffff) state = saved;
  } catch { /* no state yet, or unreadable: start again at version 1 */ }
  if (state?.hash === hash) return { ...info, version: state.version, changed: false };
  // u16 on the wire: stop at the ceiling rather than wrap to a lower version.
  const version = state ? Math.min(state.version + 1, 0xffff) : 1;
  let stateError = null;
  try { fs.writeFileSync(stateFile, `${JSON.stringify({ hash, version })}\n`, { mode: 0o600 }); }
  catch (error) { stateError = String(error?.message ?? error); }
  return { ...info, version, changed: true, ...(stateError ? { stateError } : {}) };
};

// `pca create` / `pca run`: write the defaults once. Never overwrites.
export const seedBotInfoFile = (dir, defaults) => {
  const file = path.join(dir, BOT_INFO_FILE);
  try { fs.writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  return file;
};

// A peer's botInfo (another bot), per peer: the highest version wins, an
// equal version replaces (the peer may resend the same document). Kept in
// the session state as `bi`; the bot never answers it.
export const createPeerBotInfo = ({ maxPeers = 10_000 } = {}) => {
  const peers = new Map();
  const put = (peerHex, info) => {
    peers.delete(peerHex);
    peers.set(peerHex, info);
    while (peers.size > maxPeers) peers.delete(peers.keys().next().value);
  };
  const valid = (info) => info && typeof info === "object"
    && Number.isInteger(info.kind) && Number.isInteger(info.version)
    && ["name", "description", "greeting"].every((key) => typeof info[key] === "string")
    && Array.isArray(info.commands)
    && info.commands.every((c) => typeof c?.name === "string" && typeof c?.description === "string");
  return {
    // "stored", or "stale" when a higher version is already stored.
    record(peerHex, { botKind, name, description, greeting, commands, version }) {
      const stored = peers.get(peerHex);
      if (stored && stored.version > version) return "stale";
      put(peerHex, { kind: botKind, name, description, greeting, commands, version });
      return "stored";
    },
    get: (peerHex) => peers.get(peerHex) ?? null,
    snapshot: (peerHex) => peers.get(peerHex) ?? null,
    restore(peerHex, saved) { if (valid(saved)) put(peerHex, saved); },
  };
};

// The version of our own botInfo last sent to each peer. Kept in the session
// state as `bs`. Spec 0008: a peer that has not received the current version
// gets it with the bot's next reply (catch-up), once per version.
export const createBotInfoSent = ({ maxPeers = 10_000 } = {}) => {
  const peers = new Map();
  const set = (peerHex, version) => {
    peers.delete(peerHex);
    if (version) peers.set(peerHex, version);
    while (peers.size > maxPeers) peers.delete(peers.keys().next().value);
  };
  const valid = (v) => Number.isInteger(v) && v >= 1 && v <= 0xffff;
  return {
    // True when the peer has not received `version` (no record, or lower).
    needs: (peerHex, version) => (peers.get(peerHex) ?? 0) < version,
    // Record a send; returns the previous value for `revert`.
    mark(peerHex, version) {
      const previous = peers.get(peerHex) ?? null;
      if (!(previous >= version)) set(peerHex, version);
      return previous;
    },
    // A failed send: go back to `previous`, unless a later send moved on.
    revert(peerHex, version, previous) {
      if (peers.get(peerHex) === version) set(peerHex, previous);
    },
    snapshot: (peerHex) => peers.get(peerHex) ?? null,
    restore(peerHex, saved) { if (valid(saved)) set(peerHex, saved); },
  };
};
