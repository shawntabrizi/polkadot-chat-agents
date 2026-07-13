// T3ams protocol adapter.
//
// This module deliberately has no RPC, HTTP, or agent-CLI dependency.  It
// turns T3ams/bcts envelopes into normalized bot messages and turns normalized
// replies back into Statement Store submissions.  Keeping this seam small
// makes the transport testable with an in-memory statement store and lets the
// existing direct-engine and HTTP-bridge runtimes stay transport-agnostic.

import { conversationKeyFor, MAX_T3AMS_TEXT_BYTES } from "./t3ams-routing.mjs";
import { normalizeT3amsAttachmentRefs } from "./t3ams-attachments.mjs";

export const T3AMS_STATE_VERSION = 1;
export const T3AMS_BACKFILL_CAP = 8;
export const T3AMS_BACKFILL_BUDGET_BYTES = 8 * 1024;
export const T3AMS_BACKFILL_ENTRY_OVERHEAD_BYTES = 96;
// Retained carrier history is an optimization for replies, never a message
// archive. Keep both the per-chat carrier budget and the aggregate state file
// bounded so a public bot cannot be turned into a disk-backed relay cache.
export const T3AMS_BACKFILL_CONVERSATION_CAP = 128;
export const T3AMS_BACKFILL_TOTAL_BUDGET_BYTES = 512 * 1024;
export const T3AMS_MAX_ENVELOPE_BYTES = 256 * 1024;
export const T3AMS_PEER_CAP = 1_000;
export const T3AMS_WORKSPACE_CAP = 100;
export const T3AMS_CHANNEL_CAP = 1_000;
export const T3AMS_KEY_CAP_PER_WORKSPACE = 256;
export const T3AMS_KEY_CAP = 2_048;
// A healthy peer does not need every pairwise message mirrored to their
// personal inbox. Keep the re-onboard wake conservative, matching the SPA.
const T3AMS_DM_WAKE_BACKOFF_MS = 60_000;
const T3AMS_TAGGED_KEY_HEX_RE = /^[0-9a-f]{2,4096}$/;
const T3AMS_XID_HEX_RE = /^[0-9a-f]{64}$/;
const T3AMS_ROLES = new Set(["owner", "admin", "mod", "member", "guest"]);
const T3AMS_BACKFILL_ENTRY_MAX_BYTES = T3AMS_BACKFILL_BUDGET_BYTES - T3AMS_BACKFILL_ENTRY_OVERHEAD_BYTES;
const T3AMS_BACKFILL_RESTORE_SCAN_CAP = T3AMS_BACKFILL_CONVERSATION_CAP * 4;
const T3AMS_BACKFILL_LIST_RESTORE_SCAN_CAP = T3AMS_BACKFILL_CAP * 4;
const T3AMS_ADMISSION_HISTORY_CAP = 256;

function terminalDeliveryError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.t3amsTerminal = true;
  if (cause != null) error.cause = cause;
  return error;
}

export const bareHex = (value) => String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();
export const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const hexToBytes = (value) => {
  const hex = bareHex(value);
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) throw new Error("invalid hexadecimal value");
  return Uint8Array.from(hex.match(/../g)?.map((part) => Number.parseInt(part, 16)) ?? []);
};

const jsonClone = (value) => JSON.parse(JSON.stringify(value));
const now = () => Date.now();

export function t3amsConversationKey(conversation) {
  const event = conversation?.kind === "dm"
    ? { conversationType: "dm", senderXid: bareHex(conversation.peerXidHex) }
    : conversation?.kind === "channel"
      ? {
        conversationType: "channel",
        workspaceId: String(conversation.wsId ?? ""),
        channelId: bareHex(conversation.channelIdHex),
      }
      : null;
  const key = event == null ? null : conversationKeyFor(event);
  if (key == null) throw new Error("unknown T3ams conversation");
  return key;
}

const emptyT3amsState = () => ({
  v: T3AMS_STATE_VERSION,
  peers: {},
  workspaces: {},
  keys: {},
  backfill: {},
  seen: [],
  admissions: { publicPeers: [], publicWorkspaces: [] },
});

export function normalizeT3amsState(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw) || raw.v !== T3AMS_STATE_VERSION) {
    return emptyT3amsState();
  }
  const object = (value) => value != null && typeof value === "object" && !Array.isArray(value) ? value : {};
  const peers = object(raw.peers);
  const workspaces = object(raw.workspaces);
  const admissions = object(raw.admissions);
  return {
    v: T3AMS_STATE_VERSION,
    peers,
    workspaces,
    keys: normalizeT3amsKeys(object(raw.keys), workspaces),
    backfill: normalizeBackfill(object(raw.backfill)),
    seen: Array.isArray(raw.seen) ? raw.seen.filter((item) => typeof item === "string").slice(-20_000) : [],
    admissions: {
      publicPeers: normalizeAdmissionHistory(admissions.publicPeers),
      publicWorkspaces: normalizeAdmissionHistory(admissions.publicWorkspaces),
    },
  };
}

function stateWorkspace(state, wsId) {
  const value = state.workspaces[wsId];
  return value != null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stateChannel(workspace, channelIdHex) {
  const channels = Array.isArray(workspace?.channels) ? workspace.channels : [];
  return channels.find((channel) => bareHex(channel?.idHex) === bareHex(channelIdHex)) ?? null;
}

function stateKey(state, wsId, channelIdHex) {
  const slot = state.keys[`${wsId}:${bareHex(channelIdHex)}`];
  return slot != null && typeof slot === "object" && typeof slot.current?.keyHex === "string" ? slot : null;
}

function recordSeen(state, id) {
  if (state.seen.includes(id)) return false;
  state.seen.push(id);
  if (state.seen.length > 20_000) state.seen.splice(0, state.seen.length - 20_000);
  return true;
}

function unwrapSigned(bcts, envelope) {
  return envelope.isWrapped?.() ? envelope.unwrap() : envelope;
}

function parseRequest(bcts, signed) {
  const parsed = bcts.parseGSTPMessage(unwrapSigned(bcts, signed));
  return parsed?.type === "request" ? parsed.body : null;
}

function extractString(bcts, expression, name) {
  const value = bcts.extractParameter(expression, name);
  return value == null ? null : value.extractString();
}

function extractNumber(bcts, expression, name) {
  const value = bcts.extractParameter(expression, name);
  return value == null ? null : value.extractNumber();
}

function extractBytes(bcts, expression, name) {
  const value = bcts.extractParameter(expression, name);
  return value == null ? null : value.extractBytes();
}

function peerSigningKey(bcts, peer) {
  if (!peer?.signingPubKeyHex) return null;
  try { return bcts.SigningPublicKey.fromTaggedCborData(hexToBytes(peer.signingPubKeyHex)); }
  catch { return null; }
}

function memberSigningKey(bcts, workspace, xidHex) {
  const doc = workspace?.doc;
  const member = doc?.members?.find((entry) => bareHex(entry?.xid) === bareHex(xidHex));
  const admin = doc?.admins?.find((entry) => bareHex(entry?.xid) === bareHex(xidHex));
  // A member announcement is self-asserted presence information, not a
  // workspace trust anchor. Only keys vouched in the current state document
  // may authenticate state docs, registries, private-key grants, or messages.
  const hex = admin?.signingPubKeyHex ?? member?.signingPubKeyHex;
  if (typeof hex !== "string" || hex === "") return null;
  try { return bcts.SigningPublicKey.fromTaggedCborData(hexToBytes(hex)); }
  catch { return null; }
}

function verifySigned(bcts, signed, key) {
  // Never let an absent roster/peer key turn into an implicit trust decision.
  // A member announcement can still establish presence, but only a key
  // already pinned in the current state document or DM handshake may
  // authenticate a message that reaches an agent.
  if (key == null) return false;
  try { return bcts.verifyGSTPRequestSignature(signed, key); }
  catch { return false; }
}

function verifyKnownSigned(bcts, signed, key) {
  return key != null && verifySigned(bcts, signed, key);
}

function isWorkspaceMember(workspace, xidHex) {
  return workspace?.doc?.members?.some((member) => bareHex(member?.xid) === bareHex(xidHex)) === true;
}

// Mirror the SPA's fail-closed role matrix. A sender's role is carried by the
// current admin-signed member record; admin/creator side tables are not a
// substitute when that role is absent or malformed.
export function workspaceRoleFor(workspace, xidHex) {
  const xid = bareHex(xidHex);
  const member = workspace?.doc?.members?.find((entry) => bareHex(entry?.xid) === xid);
  if (member == null) return null;
  return T3AMS_ROLES.has(member.role) ? member.role : null;
}

export function canPostWorkspaceChannel(workspace, channel, xidHex) {
  const role = workspaceRoleFor(workspace, xidHex);
  if (role == null || role === "guest") return false;
  return channel?.kind !== "announcement" || role === "owner" || role === "admin" || role === "mod";
}

export function canReadWorkspaceChannel(workspace, channel, xidHex) {
  const role = workspaceRoleFor(workspace, xidHex);
  if (role == null) return false;
  return channel?.kind !== "announcement" || role !== "guest";
}

function signingKeyFromTaggedBytes(bcts, tagged) {
  try { return tagged == null ? null : bcts.SigningPublicKey.fromTaggedCborData(tagged); }
  catch { return null; }
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

function validTaggedKeyHex(value, { allowNull = false } = {}) {
  if (value == null) return allowNull;
  const hex = bareHex(value);
  return T3AMS_TAGGED_KEY_HEX_RE.test(hex) && hex.length % 2 === 0;
}

function validXidHex(value) {
  return T3AMS_XID_HEX_RE.test(bareHex(value));
}

function validWireBlobHex(value) {
  const hex = bareHex(value);
  return /^[0-9a-f]+$/.test(hex) && hex.length % 2 === 0 && hex.length <= T3AMS_MAX_ENVELOPE_BYTES * 2;
}

function validConversationKey(value) {
  return typeof value === "string" && (
    /^t3ams:dm:[0-9a-f]{64}$/i.test(value)
    || /^t3ams:channel:[0-9a-f]{64}:[0-9a-f]{64}$/i.test(value)
  );
}

function normalizedBackfillEntry(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = bareHex(raw.id);
  const senderXid = bareHex(raw.senderXid);
  const blob = bareHex(raw.blob);
  const timestamp = Number(raw.timestamp);
  if (!validXidHex(id) || !validXidHex(senderXid) || !validWireBlobHex(blob)
      || !Number.isSafeInteger(timestamp) || timestamp < 0) return null;
  const cost = blob.length / 2 + T3AMS_BACKFILL_ENTRY_OVERHEAD_BYTES;
  // Entries larger than a carrier can never be relayed, so retaining them
  // only amplifies attacker-controlled local state.
  if (cost > T3AMS_BACKFILL_BUDGET_BYTES || blob.length / 2 > T3AMS_BACKFILL_ENTRY_MAX_BYTES) return null;
  return { id, senderXid, timestamp, blob };
}

function backfillEntryCost(entry) {
  return typeof entry?.blob === "string"
    ? entry.blob.length / 2 + T3AMS_BACKFILL_ENTRY_OVERHEAD_BYTES
    : 0;
}

function normalizeBackfillList(raw) {
  if (!Array.isArray(raw)) return [];
  const newestFirst = [];
  const ids = new Set();
  let total = 0;
  // Do not let a malformed on-disk list turn startup into an O(n) replay. The
  // newest tail is what can be useful to the next outbound carrier anyway.
  for (let index = raw.length - 1, scanned = 0;
    index >= 0 && scanned < T3AMS_BACKFILL_LIST_RESTORE_SCAN_CAP && newestFirst.length < T3AMS_BACKFILL_CAP;
    index -= 1, scanned += 1) {
    const entry = normalizedBackfillEntry(raw[index]);
    if (entry == null || ids.has(entry.id)) continue;
    const cost = backfillEntryCost(entry);
    if (total + cost > T3AMS_BACKFILL_BUDGET_BYTES) continue;
    ids.add(entry.id);
    newestFirst.push(entry);
    total += cost;
  }
  return newestFirst.reverse();
}

function backfillListCost(entries) {
  return entries.reduce((total, entry) => total + backfillEntryCost(entry), 0);
}

function normalizeBackfill(raw) {
  const source = raw != null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const normalized = {};
  let conversations = 0;
  let scanned = 0;
  let total = 0;
  // Live state is maintained newest-first below. Bound the defensive restore
  // scan as well, so a legacy/corrupt snapshot cannot monopolize startup.
  for (const conversationKey in source) {
    if (scanned >= T3AMS_BACKFILL_RESTORE_SCAN_CAP || conversations >= T3AMS_BACKFILL_CONVERSATION_CAP) break;
    scanned += 1;
    if (!validConversationKey(conversationKey)) continue;
    const entries = normalizeBackfillList(source[conversationKey]);
    const cost = backfillListCost(entries);
    if (entries.length === 0) continue;
    // Preserve recency over breadth: once the global relay budget is full,
    // older conversations are discarded rather than retaining a sparse,
    // unbounded map of empty or oversized entries.
    if (total + cost > T3AMS_BACKFILL_TOTAL_BUDGET_BYTES) break;
    normalized[conversationKey] = entries;
    total += cost;
    conversations += 1;
  }
  return normalized;
}

function activePrivateKeyIds(workspaces) {
  const allowed = new Set();
  let workspaceCount = 0;
  for (const wsId in workspaces ?? {}) {
    if (workspaceCount >= T3AMS_WORKSPACE_CAP || !validWorkspaceId(wsId)) break;
    workspaceCount += 1;
    const channels = Array.isArray(workspaces[wsId]?.channels) ? workspaces[wsId].channels : [];
    let channelCount = 0;
    for (const channel of channels) {
      if (channelCount >= T3AMS_CHANNEL_CAP) break;
      channelCount += 1;
      if (!isSafeChannelEntry(channel) || channel.isPrivate !== true || channel.archived === true || channel.deleted === true) continue;
      allowed.add(`${wsId}:${bareHex(channel.idHex)}`);
      if (allowed.size >= T3AMS_KEY_CAP) return allowed;
    }
  }
  return allowed;
}

function normalizeKeyMaterial(value) {
  const hex = bareHex(value);
  return /^[0-9a-f]{2,1024}$/.test(hex) && hex.length % 2 === 0 ? hex : null;
}

function normalizeKeySlot(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const version = Number(raw.current?.version);
  const keyHex = normalizeKeyMaterial(raw.current?.keyHex);
  if (!Number.isSafeInteger(version) || version < 1 || keyHex == null) return null;
  const previous = [];
  for (const item of Array.isArray(raw.previous) ? raw.previous.slice(-4) : []) {
    const previousVersion = Number(item?.version);
    const previousKey = normalizeKeyMaterial(item?.keyHex);
    if (!Number.isSafeInteger(previousVersion) || previousVersion < 1 || previousKey == null) continue;
    previous.push({ keyHex: previousKey, version: previousVersion });
  }
  return { current: { keyHex, version }, previous };
}

function normalizeT3amsKeys(raw, workspaces) {
  const allowed = activePrivateKeyIds(workspaces);
  const normalized = {};
  const perWorkspace = new Map();
  let scanned = 0;
  for (const keyId in raw ?? {}) {
    if (scanned >= T3AMS_KEY_CAP * 4 || Object.keys(normalized).length >= T3AMS_KEY_CAP) break;
    scanned += 1;
    if (!allowed.has(keyId)) continue;
    const separator = keyId.indexOf(":");
    const wsId = separator < 0 ? "" : keyId.slice(0, separator);
    const count = perWorkspace.get(wsId) ?? 0;
    if (count >= T3AMS_KEY_CAP_PER_WORKSPACE) continue;
    const slot = normalizeKeySlot(raw[keyId]);
    if (slot == null) continue;
    normalized[keyId] = slot;
    perWorkspace.set(wsId, count + 1);
  }
  return normalized;
}

function normalizeAdmissionHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(-T3AMS_ADMISSION_HISTORY_CAP);
}

function validWorkspaceId(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isSafeWorkspaceDocument(doc, wsId) {
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)
      || doc.wsId !== wsId || !validWorkspaceId(doc.wsId) || !validXidHex(doc.creatorXid)
      || !Number.isSafeInteger(Number(doc.version)) || Number(doc.version) < 0
      || !Array.isArray(doc.members) || doc.members.length === 0 || doc.members.length > T3AMS_CHANNEL_CAP
      || !Array.isArray(doc.admins) || doc.admins.length > T3AMS_CHANNEL_CAP) return false;
  const members = new Set();
  for (const member of doc.members) {
    const xid = bareHex(member?.xid);
    if (!validXidHex(xid) || members.has(xid)
        || (member?.role != null && !T3AMS_ROLES.has(member.role))
        || !validTaggedKeyHex(member?.signingPubKeyHex, { allowNull: true })
        || !validTaggedKeyHex(member?.agreementPubKeyHex, { allowNull: true })) return false;
    members.add(xid);
  }
  if (!members.has(bareHex(doc.creatorXid))) return false;
  const admins = new Set();
  for (const admin of doc.admins) {
    const xid = bareHex(admin?.xid);
    if (!members.has(xid) || admins.has(xid) || !validTaggedKeyHex(admin?.signingPubKeyHex)) return false;
    admins.add(xid);
  }
  if (doc.removed != null && (!Array.isArray(doc.removed) || doc.removed.length > T3AMS_CHANNEL_CAP || !doc.removed.every(validXidHex))) return false;
  if (doc.categories != null && (!Array.isArray(doc.categories) || doc.categories.length > T3AMS_CHANNEL_CAP)) return false;
  return true;
}

function isSafeChannelEntry(channel, creator = null) {
  if (channel == null || typeof channel !== "object" || Array.isArray(channel)
      || !validXidHex(channel.idHex) || !validXidHex(channel.creatorXid)
      || (creator != null && bareHex(channel.creatorXid) !== bareHex(creator))
      || typeof channel.isPrivate !== "boolean"
      || (channel.kind != null && channel.kind !== "standard" && channel.kind !== "announcement")) return false;
  return true;
}

function safeChannelEntries(channels, { creator = null, max = T3AMS_CHANNEL_CAP } = {}) {
  if (!Array.isArray(channels) || channels.length > max) return null;
  const ids = new Set();
  for (const channel of channels) {
    const id = bareHex(channel?.idHex);
    if (!isSafeChannelEntry(channel, creator) || ids.has(id)) return null;
    ids.add(id);
  }
  return channels;
}

// T3ams state documents resolve concurrent writes by version, then message
// timestamp, then the lexical signer XID. This makes the stored snapshot
// converge even when workspace-plane statements arrive in a different order.
export function stateDocSupersedes(current, incoming) {
  const currentVersion = nonNegativeNumber(Number(current?.version)) ?? -1;
  const incomingVersion = nonNegativeNumber(Number(incoming?.version)) ?? -1;
  if (incomingVersion !== currentVersion) return incomingVersion > currentVersion;
  const currentTimestamp = nonNegativeNumber(Number(current?.timestamp)) ?? 0;
  const incomingTimestamp = nonNegativeNumber(Number(incoming?.timestamp)) ?? 0;
  if (incomingTimestamp !== currentTimestamp) return incomingTimestamp > currentTimestamp;
  return String(incoming?.signerXid ?? "") > String(current?.signerXid ?? "");
}

function decodeCarrier(bcts, data) {
  if (!(data instanceof Uint8Array) || data.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
  try {
    const carrier = bcts.parseMessageCarrier(bcts.envelopeFromBytes(data));
    return carrier?.message instanceof Uint8Array ? carrier : null;
  } catch {
    return null;
  }
}

// The inbox decoder lives in the T3ams SPA today rather than in @t3ams/bcts.
// Keep the small, wire-level piece here so a hosted bot follows the same
// handshake without importing browser stores or React modules.
function decodeInboxMessage(bcts, data) {
  if (!(data instanceof Uint8Array) || data.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
  try {
    const envelope = bcts.envelopeFromBytes(data);
    const expression = parseRequest(bcts, envelope);
    if (expression == null) return null;
    const functionName = bcts.extractFunctionName(expression);
    const kind = {
      dmNotification: "request",
      dmMessageRequest: "request",
      dmAccept: "accept",
      workspaceInvite: "wsInvite",
      workspaceJoin: "wsJoin",
    }[functionName ?? ""];
    if (kind == null) return null;
    const sender = extractBytes(bcts, expression, "senderXid");
    const senderName = extractString(bcts, expression, "senderName");
    const timestamp = extractNumber(bcts, expression, "timestamp");
    if (sender == null || senderName == null || timestamp == null) return null;
    const senderXidHex = bareHex(bcts.formatXID(sender));
    const sealed = extractBytes(bcts, expression, "sealed");
    if (kind === "wsInvite" || kind === "wsJoin") {
      return sealed == null ? null : { kind, senderXidHex, senderName, timestamp, sealed, signed: envelope };
    }
    const signing = extractBytes(bcts, expression, "signingPubKey");
    const signingPubKeyHex = signing == null ? null : bareHex(bcts.formatXID(signing));
    let verified = false;
    if (signingPubKeyHex != null) {
      const key = peerSigningKey(bcts, { signingPubKeyHex });
      verified = key != null && verifySigned(bcts, envelope, key);
    }
    return {
      kind,
      senderXidHex,
      senderName,
      timestamp,
      signingPubKeyHex,
      verified,
      username: extractString(bcts, expression, "username"),
      ...(sealed == null ? {} : { sealed }),
      signed: envelope,
    };
  } catch {
    return null;
  }
}

function channelPriorEntries(bcts, state, conversationKey) {
  const entries = Array.isArray(state.backfill[conversationKey]) ? state.backfill[conversationKey] : [];
  const candidates = entries.slice().sort((a, b) => Number(b?.timestamp) - Number(a?.timestamp));
  const packed = [];
  let total = 0;
  for (const entry of candidates) {
    try {
      if (!entry || typeof entry.id !== "string" || typeof entry.senderXid !== "string" || typeof entry.blob !== "string") continue;
      const id = hexToBytes(entry.id);
      const senderXid = hexToBytes(entry.senderXid);
      const timestamp = Number(entry.timestamp);
      const blob = hexToBytes(entry.blob);
      if (id.byteLength !== 32 || senderXid.byteLength !== 32 || !Number.isSafeInteger(timestamp) || timestamp < 0) continue;
      const cost = blob.byteLength + T3AMS_BACKFILL_ENTRY_OVERHEAD_BYTES;
      // This follows the SPA's newest-first packing policy: an oversized
      // recent entry is not relayed, rather than growing the carrier past a
      // safe Statement Store payload.
      if (total + cost > T3AMS_BACKFILL_BUDGET_BYTES) break;
      packed.push({ id, senderXid, timestamp, blob });
      total += cost;
    } catch {
      continue;
    }
  }
  return packed.reverse();
}

function appendBackfill(state, conversationKey, entry) {
  if (!validConversationKey(conversationKey)) return false;
  const candidate = normalizedBackfillEntry(entry);
  if (candidate == null) return false;
  const list = normalizeBackfillList(state.backfill[conversationKey]);
  // A carrier may be replayed after reconnect. The durable inbound ledger is
  // normally enough to prevent this, but keep the relay history idempotent as
  // well so a recovered snapshot never amplifies the same wire message.
  if (list.some((existing) => existing.id === candidate.id)) return false;
  const next = normalizeBackfillList([...list, candidate]);
  if (next.length === 0) return false;
  // Reinsert the active chat first. `normalizeBackfill` keeps this LRU order
  // when evicting old conversations under the aggregate budget.
  const prior = state.backfill;
  const rest = { ...prior };
  delete rest[conversationKey];
  state.backfill = normalizeBackfill({ [conversationKey]: next, ...rest });
  return Object.hasOwn(state.backfill, conversationKey);
}

/**
 * Construct the stateful protocol half of a T3ams bot.
 *
 * `submit` receives already encoded raw T3ams statement data.  Its owner is
 * responsible for Statement Store proof/signature framing and for wiring
 * topic subscriptions back to the `receive*` methods below.
 */
export function createT3amsProtocol({
  bcts,
  identity,
  displayName,
  state: initialState,
  submit,
  isPeerAllowed = () => true,
  trustedPeerSigningKeys = {},
  requireTrustedPeers = false,
  maxPeers = T3AMS_PEER_CAP,
  maxWorkspaces = T3AMS_WORKSPACE_CAP,
  maxChannelsPerWorkspace = T3AMS_CHANNEL_CAP,
  maxConversations = T3AMS_PEER_CAP,
  // Public TOFU enrollment is an explicit runtime choice. It gets stricter
  // admission limits than an operator-pinned bot, while pinned identities
  // remain non-evictable.
  publicTofuEnrollment = false,
  publicPeerAdmissionLimit = 32,
  publicWorkspaceAdmissionLimit = 4,
  publicAdmissionWindowMs = 60 * 60 * 1000,
  acceptWorkspaceInvite = () => true,
  // The parser is deliberately strict about HOP-only attachment metadata.
  // Operators may narrow the MIME/size policy without changing the protocol.
  attachmentOptions = {},
  onStateChange = () => {},
  onTopologyChange = () => {},
  log = () => {},
}) {
  if (bcts == null) throw new Error("bcts is required");
  if (identity?.xid == null || identity?.signingPrivateKey == null) throw new Error("T3ams identity is required");
  if (typeof submit !== "function") throw new Error("submit is required");

  const state = normalizeT3amsState(initialState);
  const selfXidHex = bareHex(bcts.formatXID(identity.xid));
  const peerLimit = boundedInteger(maxPeers, T3AMS_PEER_CAP, { max: T3AMS_PEER_CAP });
  const workspaceLimit = boundedInteger(maxWorkspaces, T3AMS_WORKSPACE_CAP, { max: T3AMS_WORKSPACE_CAP });
  const channelLimit = boundedInteger(maxChannelsPerWorkspace, T3AMS_CHANNEL_CAP, { max: T3AMS_CHANNEL_CAP });
  const conversationLimit = boundedInteger(maxConversations, T3AMS_PEER_CAP, { max: 10_000 });
  const publicPeerAdmissionCap = boundedInteger(publicPeerAdmissionLimit, 32, { min: 1, max: T3AMS_ADMISSION_HISTORY_CAP });
  const publicWorkspaceAdmissionCap = boundedInteger(publicWorkspaceAdmissionLimit, 4, { min: 1, max: T3AMS_ADMISSION_HISTORY_CAP });
  const publicAdmissionWindow = boundedInteger(publicAdmissionWindowMs, 60 * 60 * 1000, { min: 60_000, max: 7 * 86_400_000 });
  // A T3ams XID is account-derived, while the GSTP signing key is an
  // independent device key.  A self-presented key therefore proves only that
  // the sender controls that key, not that it controls a claimed account XID.
  // Private bots seed this map from operator-configured pins before accepting
  // first contact, rather than silently treating the first key as account
  // authentication (TOFU is appropriate only for deliberately public bots).
  const trustedPeers = new Map();
  if (trustedPeerSigningKeys != null && typeof trustedPeerSigningKeys === "object" && !Array.isArray(trustedPeerSigningKeys)) {
    for (const [rawXid, rawKey] of Object.entries(trustedPeerSigningKeys)) {
      const xid = bareHex(rawXid);
      const signingPubKeyHex = bareHex(rawKey);
      if (!/^[0-9a-f]{64}$/.test(xid) || !/^[0-9a-f]{2,4096}$/.test(signingPubKeyHex) || signingPubKeyHex.length % 2 !== 0) continue;
      if (!trustedPeers.has(xid) && trustedPeers.size >= peerLimit) break;
      trustedPeers.set(xid, signingPubKeyHex);
      const existing = state.peers[xid] ?? {};
      state.peers[xid] = {
        ...existing,
        xidHex: xid,
        signingPubKeyHex,
        trusted: true,
        updatedAt: Number(existing.updatedAt) || 0,
      };
    }
  }
  const rosterSigningKeyHex = (doc, xidHex) => {
    const xid = bareHex(xidHex);
    const admin = doc?.admins?.find((entry) => bareHex(entry?.xid) === xid);
    const member = doc?.members?.find((entry) => bareHex(entry?.xid) === xid);
    const key = admin?.signingPubKeyHex ?? member?.signingPubKeyHex;
    return typeof key === "string" ? bareHex(key) : null;
  };
  const trustedRosterBindingsValid = (doc) => {
    if (!Array.isArray(doc?.members)) return false;
    for (const member of doc.members) {
      const xid = bareHex(member?.xid);
      const trustedKey = trustedPeers.get(xid);
      // Private bots pin account->device identity outside the workspace. A
      // valid workspace document may not silently replace that binding.
      if (trustedKey != null && rosterSigningKeyHex(doc, xid) !== trustedKey) return false;
    }
    return true;
  };
  const conversations = new Map();
  const pinnedConversations = new Map();
  const replyTargets = new Map();
  // Per-peer re-onboard wake state is intentionally process-local: it is only
  // a best-effort supplement to the retained pairwise Statement Store route.
  // Bound it independently so an evicted public peer cannot leave unbounded
  // transient state behind.
  const dmWakeState = new Map();
  // Typing is deliberately ephemeral. Keep only a bounded local cadence map;
  // the SPA clears a true indicator by TTL, so there is no durable state or
  // false indicator to publish when a turn ends.
  const lastTypingAt = new Map();
  // Decoding a carrier happens before the runtime has durably admitted its
  // message to the local ingress journal. Keep a short-lived claim separate
  // from `state.seen`: otherwise a full bridge/dispatcher queue could mark a
  // valid statement handled and lose it permanently on replay.
  const inboundClaims = new Set();
  const workspaceJoinInFlight = new Set();
  const persist = () => onStateChange(jsonClone(state));
  const submitStatement = async (statement) => submit(statement);
  // All outbound paths share the serialized submitter owned by the transport.
  // Keep its transient failure classification in one place so live edits,
  // typing, and final replies behave consistently under allowance pressure.
  const submitOutboundStatement = async (statement) => {
    try {
      await submitStatement(statement);
    } catch (error) {
      if (error?.code === "T3AMS_SUBMIT_QUEUE_FULL") {
        // The in-process queue drains on its own. Callers that need a durable
        // result (a final reply) can retry rather than silently lose it.
        const retryable = new Error("T3ams statement submit queue is full");
        retryable.code = "T3AMS_SUBMIT_QUEUE_FULL";
        retryable.cause = error;
        throw retryable;
      }
      if (error?.statementSubmitReason === "noAllowance" || String(error?.message ?? error).includes("noAllowance")) {
        // Allowance can be restored by an operator without restarting the
        // bot, so this is retryable rather than a terminal route failure.
        const retryable = new Error("T3ams statement allowance is exhausted");
        retryable.code = "T3AMS_NO_ALLOWANCE";
        retryable.cause = error;
        throw retryable;
      }
      throw error;
    }
  };
  const publicAdmission = (kind) => {
    if (!publicTofuEnrollment) return true;
    const field = kind === "peer" ? "publicPeers" : "publicWorkspaces";
    const cap = kind === "peer" ? publicPeerAdmissionCap : publicWorkspaceAdmissionCap;
    const cutoff = now() - publicAdmissionWindow;
    const recent = normalizeAdmissionHistory(state.admissions?.[field]).filter((timestamp) => timestamp >= cutoff);
    if (recent.length >= cap) {
      state.admissions[field] = recent;
      return false;
    }
    recent.push(now());
    state.admissions[field] = recent.slice(-T3AMS_ADMISSION_HISTORY_CAP);
    return true;
  };
  const trimConversations = () => {
    while (conversations.size > conversationLimit) {
      const candidate = [...conversations.keys()].find((chatId) => !pinnedConversations.has(chatId));
      // Every remaining entry belongs to a durable ingress item. Temporary
      // overflow is safer than evicting a reply route and retrying a paid turn.
      if (candidate == null) break;
      conversations.delete(candidate);
    }
  };
  const rememberConversation = (message) => {
    const chatId = typeof message?.chatId === "string" ? message.chatId : "";
    const conversation = message?.conversation;
    if (!validConversationKey(chatId) || conversation == null || typeof conversation !== "object") return false;
    conversations.delete(chatId);
    conversations.set(chatId, { ...conversation, threadRootId: message.threadRootId ?? null });
    trimConversations();
    return true;
  };
  const pinConversation = (chatId) => {
    if (!validConversationKey(chatId)) return false;
    pinnedConversations.set(chatId, (pinnedConversations.get(chatId) ?? 0) + 1);
    return true;
  };
  const unpinConversation = (chatId) => {
    const current = pinnedConversations.get(chatId) ?? 0;
    if (current <= 1) pinnedConversations.delete(chatId);
    else pinnedConversations.set(chatId, current - 1);
    trimConversations();
    return current > 0;
  };
  const replyTargetKey = (chatId, messageId) => `${chatId}\u0000${messageId}`;
  const recordReplyTarget = (chatId, messageId, threadRootId) => {
    const key = replyTargetKey(chatId, messageId);
    replyTargets.set(key, threadRootId ?? null);
    while (replyTargets.size > 20_000) replyTargets.delete(replyTargets.keys().next().value);
  };
  const inboundKeyFor = (message) => {
    const chatId = typeof message?.chatId === "string" ? message.chatId : "";
    const messageId = typeof message?.messageId === "string" ? bareHex(message.messageId) : "";
    return chatId && validXidHex(messageId) ? `${chatId}:${messageId}` : null;
  };
  const claimInbound = (message) => {
    const key = inboundKeyFor(message);
    if (key == null || state.seen.includes(key) || inboundClaims.has(key)) return null;
    inboundClaims.add(key);
    return { ...message, ingressKey: key };
  };
  const commitInbound = (message, { retainBackfill = true, retainConversation = true } = {}) => {
    const key = message?.ingressKey ?? inboundKeyFor(message);
    if (typeof key !== "string" || !inboundClaims.has(key)) return false;
    inboundClaims.delete(key);
    if (!recordSeen(state, key)) return false;
    const wireBlobHex = typeof message?.wireBlobHex === "string" ? bareHex(message.wireBlobHex) : "";
    const timestamp = Number(message?.timestamp);
    if (retainBackfill && validWireBlobHex(wireBlobHex) && validXidHex(message?.senderXid)
        && Number.isSafeInteger(timestamp) && timestamp >= 0 && message?.conversation != null) {
      appendBackfill(state, message.chatId, {
        id: bareHex(message.messageId),
        senderXid: bareHex(message.senderXid),
        timestamp,
        blob: wireBlobHex,
      });
    }
    if (retainConversation && rememberConversation(message)) {
      recordReplyTarget(message.chatId, message.messageId, message.threadRootId);
    }
    return true;
  };
  const releaseInbound = (message) => {
    const key = message?.ingressKey ?? inboundKeyFor(message);
    return typeof key === "string" && inboundClaims.delete(key);
  };

  const oldestEvictablePeerId = () => {
    let candidate = null;
    let candidateActivity = Number.POSITIVE_INFINITY;
    const staleBefore = now() - publicAdmissionWindow;
    for (const [xid, peer] of Object.entries(state.peers)) {
      if (trustedPeers.has(xid)) continue;
      const activity = Number(peer?.lastActivityAt ?? peer?.updatedAt ?? 0);
      const safeActivity = Number.isSafeInteger(activity) && activity >= 0 ? activity : 0;
      if (safeActivity > staleBefore) continue;
      if (candidate == null || safeActivity < candidateActivity || (safeActivity === candidateActivity && xid < candidate)) {
        candidate = xid;
        candidateActivity = safeActivity;
      }
    }
    return candidate;
  };
  const touchPeer = (peerXidHex) => {
    const key = bareHex(peerXidHex);
    const peer = state.peers[key];
    if (peer == null) return false;
    state.peers[key] = { ...peer, lastActivityAt: now() };
    return true;
  };
  const retainDmWakeState = (peerXidHex, value) => {
    const key = bareHex(peerXidHex);
    dmWakeState.delete(key);
    dmWakeState.set(key, value);
    while (dmWakeState.size > peerLimit) dmWakeState.delete(dmWakeState.keys().next().value);
  };
  // Any valid inbound DM is fresh evidence the peer has the pairwise route.
  // That suppresses further inbox wake-ups until the peer goes silent again.
  const markPeerReachable = (peerXidHex) => {
    const key = bareHex(peerXidHex);
    const current = dmWakeState.get(key);
    retainDmWakeState(key, {
      lastWokeAt: current?.lastWokeAt ?? 0,
      lastInboundAt: now(),
    });
  };
  const shouldWakePeerInbox = (peerXidHex, current) => {
    const stateForPeer = dmWakeState.get(bareHex(peerXidHex));
    if (stateForPeer == null || stateForPeer.lastWokeAt === 0) return true;
    if (stateForPeer.lastInboundAt > stateForPeer.lastWokeAt) return false;
    return current - stateForPeer.lastWokeAt >= T3AMS_DM_WAKE_BACKOFF_MS;
  };
  const notePeerInboxWake = (peerXidHex, current) => {
    const key = bareHex(peerXidHex);
    const prior = dmWakeState.get(key);
    retainDmWakeState(key, {
      lastWokeAt: current,
      lastInboundAt: prior?.lastInboundAt ?? 0,
    });
  };
  // Mirror a just-sent carrier to an established peer's inbox. This covers a
  // peer that re-onboarded without its pairwise subscription; first contact is
  // still handled by the explicit DM request handshake. It intentionally
  // absorbs every failure so a successful primary send stays successful.
  const maybeWakePeerInbox = async (peerXidHex, sealed) => {
    const key = bareHex(peerXidHex);
    if (state.peers[key] == null || !(sealed instanceof Uint8Array)) return;
    const current = now();
    if (!shouldWakePeerInbox(key, current)) return;
    notePeerInboxWake(key, current);
    try {
      const peer = hexToBytes(key);
      const expression = bcts.dmMessageRequestExpression(
        identity.xid,
        displayName,
        bcts.derivePersonalDMChannel(identity.xid, peer),
        bcts.PERSONAL_SCOPE,
        current,
        sealed,
        null,
        null,
        identity.signingPublicKey.taggedCborData(),
      );
      const { envelope } = bcts.createGSTPRequest(expression);
      const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
      const inbox = bcts.derivePersonalInboxChannel(peer);
      await submitStatement({ channel: inbox, topics: [inbox], data: bcts.envelopeToBytes(signed) });
    } catch (error) {
      try {
        log("T3AMS_DM_WAKE_FAILED", { peer: key, error: String(error?.message ?? error) });
      } catch {
        // Logging must not turn a best-effort wake into a send failure.
      }
    }
  };
  const addPeer = (peerXidHex, details = {}) => {
    const key = bareHex(peerXidHex);
    if (!/^[0-9a-f]{64}$/.test(key) || key === selfXidHex) return null;
    const existing = state.peers[key] ?? {};
    const trustedKey = trustedPeers.get(key) ?? null;
    const suppliedKey = typeof details.signingPubKeyHex === "string" ? bareHex(details.signingPubKeyHex) : null;
    const pinnedKey = typeof existing.signingPubKeyHex === "string" ? bareHex(existing.signingPubKeyHex) : null;
    if (pinnedKey != null && suppliedKey != null && suppliedKey !== pinnedKey) {
      log("T3AMS_PEER_REKEY_REJECTED", { sender: key });
      return null;
    }
    if (trustedKey != null && suppliedKey != null && suppliedKey !== trustedKey) {
      log("T3AMS_PEER_KEY_MISMATCH", { sender: key });
      return null;
    }
    if (requireTrustedPeers && trustedKey == null) {
      log("T3AMS_PEER_PIN_REQUIRED", { sender: key });
      return null;
    }
    const isNew = state.peers[key] == null;
    const isPublicTofuPeer = publicTofuEnrollment && trustedKey == null;
    const evictPeer = isNew && Object.keys(state.peers).length >= peerLimit
      ? (publicTofuEnrollment ? oldestEvictablePeerId() : null)
      : null;
    if (isNew && Object.keys(state.peers).length >= peerLimit && evictPeer == null) {
      log("T3AMS_PEER_CAP_REACHED", { cap: peerLimit });
      return null;
    }
    if (isNew && isPublicTofuPeer && !publicAdmission("peer")) {
      log("T3AMS_PUBLIC_PEER_ADMISSION_LIMIT", { cap: publicPeerAdmissionCap, windowMs: publicAdmissionWindow });
      return null;
    }
    if (evictPeer != null) {
      delete state.peers[evictPeer];
      log("T3AMS_PUBLIC_PEER_EVICTED", { evicted: evictPeer });
    }
    state.peers[key] = {
      ...existing,
      ...details,
      xidHex: key,
      ...(trustedKey != null
        ? { signingPubKeyHex: trustedKey, trusted: true }
        : suppliedKey != null
          ? { signingPubKeyHex: suppliedKey }
          : {}),
      updatedAt: now(),
      lastActivityAt: now(),
    };
    persist();
    onTopologyChange();
    return state.peers[key];
  };

  const privateKeyIdsForWorkspace = (wsId, workspace) => activePrivateKeyIds({ [wsId]: workspace });
  const pruneWorkspaceKeys = (wsId, workspace) => {
    const allowed = privateKeyIdsForWorkspace(wsId, workspace);
    let removed = 0;
    for (const keyId of Object.keys(state.keys)) {
      if (!keyId.startsWith(`${wsId}:`) || allowed.has(keyId)) continue;
      delete state.keys[keyId];
      removed += 1;
    }
    return removed;
  };
  const workspaceKeyCount = (wsId) => Object.keys(state.keys).filter((keyId) => keyId.startsWith(`${wsId}:`)).length;
  const touchWorkspace = (wsId) => {
    const workspace = stateWorkspace(state, wsId);
    if (workspace == null) return false;
    workspace.lastActivityAt = now();
    return true;
  };
  const removeWorkspaceState = (wsId) => {
    if (state.workspaces[wsId] == null) return false;
    delete state.workspaces[wsId];
    for (const keyId of Object.keys(state.keys)) {
      if (keyId.startsWith(`${wsId}:`)) delete state.keys[keyId];
    }
    const channelPrefix = `t3ams:channel:${wsId}:`;
    for (const chatId of Object.keys(state.backfill)) {
      if (chatId.startsWith(channelPrefix)) delete state.backfill[chatId];
    }
    for (const chatId of conversations.keys()) {
      if (chatId.startsWith(channelPrefix)) conversations.delete(chatId);
    }
    for (const chatId of pinnedConversations.keys()) {
      if (chatId.startsWith(channelPrefix)) pinnedConversations.delete(chatId);
    }
    for (const key of replyTargets.keys()) {
      if (key.startsWith(`${channelPrefix}`)) replyTargets.delete(key);
    }
    return true;
  };
  const oldestEvictableWorkspaceId = () => {
    let candidate = null;
    let candidateActivity = Number.POSITIVE_INFINITY;
    const staleBefore = now() - publicAdmissionWindow;
    for (const [wsId, workspace] of Object.entries(state.workspaces)) {
      const inviter = bareHex(workspace?.inviterXidHex);
      const isPublicEnrollment = workspace?.publicEnrollment === true
        || (publicTofuEnrollment && workspace?.publicEnrollment !== false && !trustedPeers.has(inviter));
      if (!isPublicEnrollment || trustedPeers.has(inviter)) continue;
      const channelPrefix = `t3ams:channel:${wsId}:`;
      if ([...pinnedConversations.keys()].some((chatId) => chatId.startsWith(channelPrefix))) continue;
      const activity = Number(workspace?.lastActivityAt ?? workspace?.acceptedAt ?? 0);
      const safeActivity = Number.isSafeInteger(activity) && activity >= 0 ? activity : 0;
      if (safeActivity > staleBefore) continue;
      if (candidate == null || safeActivity < candidateActivity || (safeActivity === candidateActivity && wsId < candidate)) {
        candidate = wsId;
        candidateActivity = safeActivity;
      }
    }
    return candidate;
  };

  // The runtime can restore a disk-backed ingress item before the next live
  // carrier arrives. Conversation routing is otherwise intentionally
  // in-memory, so reconstruct just the verified conversation/reply metadata
  // needed for a safe replay; never infer it from an arbitrary chat-id alone.
  const restoreInboundConversation = (routed) => {
    const message = routed?.message;
    if (routed?.accepted !== true || message == null || typeof message !== "object") return false;
    let conversation;
    if (message.conversationType === "dm" && validXidHex(message.senderXid)) {
      conversation = { kind: "dm", peerXidHex: bareHex(message.senderXid) };
    } else if (message.conversationType === "channel"
        && validWorkspaceId(message.workspaceId) && validXidHex(message.channelId)) {
      conversation = {
        kind: "channel",
        wsId: message.workspaceId,
        channelIdHex: bareHex(message.channelId),
      };
    } else {
      return false;
    }
    let chatId;
    try { chatId = t3amsConversationKey(conversation); }
    catch { return false; }
    if (chatId !== routed.conversationKey || !validXidHex(message.messageId)) return false;
    const threadRootId = message.threadRootId == null ? null : bareHex(message.threadRootId);
    if (threadRootId != null && !validXidHex(threadRootId)) return false;
    if (!rememberConversation({
      chatId,
      conversation,
      messageId: message.messageId,
      threadRootId,
    })) return false;
    recordReplyTarget(chatId, message.messageId, threadRootId);
    return true;
  };

  // Attachment references are encrypted with the message, but their HOP
  // ticket is capability material once decrypted. Parse them only after the
  // message's signature and route checks have succeeded, and never log the
  // raw reference/ticket. An invalid attachment does not erase a valid text
  // message; it becomes a visible unavailable-file note downstream.
  const decodeAttachments = (expression) => {
    const attachmentsEnvelope = bcts.extractParameter(expression, "attachments");
    if (attachmentsEnvelope == null) return { attachments: [], attachmentError: null };
    try {
      const raw = bcts.parseAttachmentsEnvelope(attachmentsEnvelope);
      return { attachments: normalizeT3amsAttachmentRefs(raw, attachmentOptions), attachmentError: null };
    } catch (error) {
      log("T3AMS_ATTACHMENT_REJECTED", { code: String(error?.code ?? "invalid").slice(0, 80) });
      return { attachments: [], attachmentError: "One or more attached files could not be safely read." };
    }
  };

  // Decode priors from the encrypted blobs themselves. The carrier headers are
  // intentionally plaintext and are useful only for UI placeholders; they
  // never decide what reaches a bot brain.
  const acceptCarrierMessages = (carrier, decode) => {
    const primary = decode(carrier.message);
    if (primary == null) return null;
    const priors = (Array.isArray(carrier.prior) ? carrier.prior : [])
      .slice(0, T3AMS_BACKFILL_CAP)
      .flatMap((entry) => entry?.blob instanceof Uint8Array ? [decode(entry.blob)] : [])
      .filter(Boolean)
      .sort((left, right) => Number(left.timestamp) - Number(right.timestamp) || left.messageId.localeCompare(right.messageId));
    const acceptedPriors = priors.map(claimInbound).filter(Boolean);
    const acceptedPrimary = claimInbound(primary);
    if (acceptedPriors.length === 0 && acceptedPrimary == null) return null;
    if (acceptedPrimary != null) return { ...acceptedPrimary, priorMessages: acceptedPriors };
    const latestPrior = acceptedPriors.at(-1);
    return { ...latestPrior, priorMessages: acceptedPriors.slice(0, -1) };
  };

  const directMessage = (peerXidHex, data) => {
    const peerHex = bareHex(peerXidHex);
    const peer = state.peers[peerHex];
    if (peer == null) return null;
    const carrier = decodeCarrier(bcts, data);
    if (carrier == null) return null;
    const conversation = { kind: "dm", peerXidHex: peerHex };
    const chatId = t3amsConversationKey(conversation);
    const decode = (blob) => {
      try {
        if (!(blob instanceof Uint8Array) || blob.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
        const signed = bcts.decryptDMEnvelope(bcts.envelopeFromBytes(blob), hexToBytes(peerHex), identity.xid);
        if (!verifySigned(bcts, signed, peerSigningKey(bcts, peer))) return null;
        const expression = parseRequest(bcts, signed);
        if (expression == null || bcts.extractFunctionName(expression) !== "sendMessage") return null;
        const id = extractBytes(bcts, expression, "id");
        const body = extractString(bcts, expression, "body");
        const timestamp = Number(extractNumber(bcts, expression, "timestamp"));
        const target = extractBytes(bcts, expression, "to");
        if (id == null || body == null || !Number.isSafeInteger(timestamp) || timestamp < 0 || target == null) return null;
        if (bareHex(bcts.formatXID(target)) !== selfXidHex) return null;
        const messageId = bareHex(bcts.formatXID(id));
        if (!validXidHex(messageId)) return null;
        const root = extractBytes(bcts, expression, "threadRootId");
        const threadRootId = root == null ? null : bareHex(bcts.formatXID(root));
        if (threadRootId != null && !validXidHex(threadRootId)) return null;
        const { attachments, attachmentError } = decodeAttachments(expression);
        touchPeer(peerHex);
        markPeerReachable(peerHex);
        return {
          conversation,
          chatId,
          messageId,
          text: body,
          timestamp,
          senderXid: peerHex,
          senderName: typeof peer.displayName === "string" ? peer.displayName : "",
          threadRootId,
          mentions: [],
          attachments,
          ...(attachmentError == null ? {} : { attachmentError }),
          wireBlobHex: bytesToHex(blob),
        };
      } catch {
        return null;
      }
    };
    return acceptCarrierMessages(carrier, decode);
  };

  const workspaceChannel = (wsId, channelIdHex, data) => {
    const workspace = stateWorkspace(state, wsId);
    const channel = stateChannel(workspace, channelIdHex);
    if (workspace == null || channel == null || !isWorkspaceMember(workspace, selfXidHex)
        || !canReadWorkspaceChannel(workspace, channel, selfXidHex)
        || !trustedRosterBindingsValid(workspace.doc)) return null;
    const keySlot = channel.isPrivate ? stateKey(state, wsId, channel.idHex) : null;
    const keys = channel.isPrivate
      ? [keySlot?.current?.keyHex, ...(keySlot?.previous ?? []).map((entry) => entry?.keyHex)].filter((value) => typeof value === "string")
      : [bytesToHex(bcts.deriveWorkspaceKey(wsId))];
    if (keys.length === 0) return null;
    const carrier = decodeCarrier(bcts, data);
    if (carrier == null) return null;
    const conversation = { kind: "channel", wsId, channelIdHex: bareHex(channel.idHex), isPrivate: Boolean(channel.isPrivate) };
    const chatId = t3amsConversationKey(conversation);
    const decode = (blob) => {
      try {
        if (!(blob instanceof Uint8Array) || blob.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
        let signed = null;
        for (const key of keys) {
          try { signed = bcts.decryptWorkspaceChannelEnvelope(bcts.envelopeFromBytes(blob), hexToBytes(key)); break; }
          catch { /* try the previous epoch */ }
        }
        if (signed == null) return null;
        const expression = parseRequest(bcts, signed);
        if (expression == null || bcts.extractFunctionName(expression) !== "sendChannelMessage") return null;
        const id = extractBytes(bcts, expression, "id");
        const sender = extractBytes(bcts, expression, "senderXid");
        const senderName = extractString(bcts, expression, "senderName");
        const body = extractString(bcts, expression, "body");
        const timestamp = Number(extractNumber(bcts, expression, "timestamp"));
        if (id == null || sender == null || senderName == null || body == null || !Number.isSafeInteger(timestamp) || timestamp < 0) return null;
        const senderXid = bareHex(bcts.formatXID(sender));
        if (senderXid === selfXidHex || !validXidHex(senderXid)) return null;
        if (!isPeerAllowed(senderXid) || !workspace.doc?.members?.some((member) => bareHex(member?.xid) === senderXid)) return null;
        const trustedKey = trustedPeers.get(senderXid) ?? null;
        if ((requireTrustedPeers && trustedKey == null)
            || (trustedKey != null && rosterSigningKeyHex(workspace.doc, senderXid) !== trustedKey)) {
          log("T3AMS_WORKSPACE_MEMBER_KEY_MISMATCH", { sender: senderXid, wsId });
          return null;
        }
        if (!verifySigned(bcts, signed, memberSigningKey(bcts, workspace, senderXid))) return null;
        if (!canPostWorkspaceChannel(workspace, channel, senderXid)) return null;
        const messageId = bareHex(bcts.formatXID(id));
        if (!validXidHex(messageId)) return null;
        const root = extractBytes(bcts, expression, "threadRootId");
        const threadRootId = root == null ? null : bareHex(bcts.formatXID(root));
        if (threadRootId != null && !validXidHex(threadRootId)) return null;
        const mentionsEnvelope = bcts.extractParameter(expression, "mentions");
        const mentions = mentionsEnvelope == null
          ? []
          : bcts.parseMentionsEnvelope(mentionsEnvelope).map((xid) => bareHex(bcts.formatXID(xid)));
        const { attachments, attachmentError } = decodeAttachments(expression);
        touchWorkspace(wsId);
        return {
          conversation,
          chatId,
          messageId,
          text: body,
          timestamp,
          senderXid,
          senderName,
          threadRootId,
          mentions,
          attachments,
          ...(attachmentError == null ? {} : { attachmentError }),
          wireBlobHex: bytesToHex(blob),
        };
      } catch {
        return null;
      }
    };
    return acceptCarrierMessages(carrier, decode);
  };

  // Operations are retained in a separate slot from message carriers. Decode
  // only the authenticated edit/delete subset that changes bot input or local
  // passive context; reactions/typing/profile updates are still authenticated
  // for reachability/presence but intentionally do not become model prompts.
  const decodeEditOrDelete = ({
    expression,
    conversation,
    chatId,
    senderXid,
    editFunction,
    deleteFunction,
    editId = "messageId",
    deleteId = "messageId",
  }) => {
    const functionName = bcts.extractFunctionName(expression);
    if (functionName === editFunction) {
      const id = extractBytes(bcts, expression, editId);
      const text = extractString(bcts, expression, "body");
      const editedAt = Number(extractNumber(bcts, expression, "editedAt"));
      const messageId = id == null ? null : bareHex(bcts.formatXID(id));
      if (!validXidHex(messageId) || typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_T3AMS_TEXT_BYTES
          || !Number.isSafeInteger(editedAt) || editedAt < 0) return null;
      return { kind: "edit", conversation, chatId, messageId, senderXid, text, timestamp: editedAt };
    }
    if (functionName === deleteFunction) {
      const id = extractBytes(bcts, expression, deleteId);
      const deletedAt = Number(extractNumber(bcts, expression, "timestamp"));
      const messageId = id == null ? null : bareHex(bcts.formatXID(id));
      if (!validXidHex(messageId) || !Number.isSafeInteger(deletedAt) || deletedAt < 0) return null;
      return { kind: "delete", conversation, chatId, messageId, senderXid, timestamp: deletedAt };
    }
    return null;
  };

  const directMessageOperation = (peerXidHex, data) => {
    const peerHex = bareHex(peerXidHex);
    const peer = state.peers[peerHex];
    if (peer == null || !(data instanceof Uint8Array) || data.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
    try {
      const signed = bcts.decryptDMEnvelope(bcts.envelopeFromBytes(data), hexToBytes(peerHex), identity.xid);
      if (!verifySigned(bcts, signed, peerSigningKey(bcts, peer))) return null;
      const expression = parseRequest(bcts, signed);
      if (expression == null) return null;
      const target = extractBytes(bcts, expression, "to");
      if (target == null || bareHex(bcts.formatXID(target)) !== selfXidHex) return null;
      touchPeer(peerHex);
      markPeerReachable(peerHex);
      const conversation = { kind: "dm", peerXidHex: peerHex };
      return decodeEditOrDelete({
        expression,
        conversation,
        chatId: t3amsConversationKey(conversation),
        senderXid: peerHex,
        editFunction: "editMessage",
        deleteFunction: "deleteMessage",
      });
    } catch {
      return null;
    }
  };

  const workspaceChannelOperation = (wsId, channelIdHex, data) => {
    const workspace = stateWorkspace(state, wsId);
    const channel = stateChannel(workspace, channelIdHex);
    if (workspace == null || channel == null || !isWorkspaceMember(workspace, selfXidHex)
        || !canReadWorkspaceChannel(workspace, channel, selfXidHex)
        || !trustedRosterBindingsValid(workspace.doc)
        || !(data instanceof Uint8Array) || data.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
    const keySlot = channel.isPrivate ? stateKey(state, wsId, channel.idHex) : null;
    const keys = channel.isPrivate
      ? [keySlot?.current?.keyHex, ...(keySlot?.previous ?? []).map((entry) => entry?.keyHex)].filter((value) => typeof value === "string")
      : [bytesToHex(bcts.deriveWorkspaceKey(wsId))];
    if (keys.length === 0) return null;
    try {
      let signed = null;
      for (const key of keys) {
        try { signed = bcts.decryptWorkspaceChannelEnvelope(bcts.envelopeFromBytes(data), hexToBytes(key)); break; }
        catch { /* try the previous epoch */ }
      }
      if (signed == null) return null;
      const expression = parseRequest(bcts, signed);
      if (expression == null) return null;
      const sender = extractBytes(bcts, expression, "senderXid");
      const senderXid = sender == null ? null : bareHex(bcts.formatXID(sender));
      if (!validXidHex(senderXid) || senderXid === selfXidHex || !isPeerAllowed(senderXid)
          || !isWorkspaceMember(workspace, senderXid)) return null;
      const trustedKey = trustedPeers.get(senderXid) ?? null;
      if ((requireTrustedPeers && trustedKey == null)
          || (trustedKey != null && rosterSigningKeyHex(workspace.doc, senderXid) !== trustedKey)
          || !verifySigned(bcts, signed, memberSigningKey(bcts, workspace, senderXid))) return null;
      const conversation = { kind: "channel", wsId, channelIdHex: bareHex(channel.idHex), isPrivate: Boolean(channel.isPrivate) };
      touchWorkspace(wsId);
      return decodeEditOrDelete({
        expression,
        conversation,
        chatId: t3amsConversationKey(conversation),
        senderXid,
        editFunction: "channelEditMessage",
        deleteFunction: "channelDeleteMessage",
        editId: "id",
      });
    } catch {
      return null;
    }
  };

  const receiveInbox = async (data) => {
    const decoded = decodeInboxMessage(bcts, data);
    if (decoded == null || typeof decoded.senderXidHex !== "string") return null;
    const senderXidHex = bareHex(decoded.senderXidHex);
    if (!isPeerAllowed(senderXidHex)) {
      log("T3AMS_INBOX_UNAUTHORIZED", { sender: senderXidHex });
      return null;
    }
    if (decoded.kind === "request" || decoded.kind === "accept") {
      if (decoded.signingPubKeyHex == null || decoded.verified !== true) return null;
      // An accept completes a request we already saw; it is never a safe
      // first-contact mechanism because it carries a self-asserted key.
      if (decoded.kind === "accept" && state.peers[senderXidHex] == null) {
        log("T3AMS_UNSOLICITED_DM_ACCEPT", { sender: senderXidHex });
        return null;
      }
      const trustedKey = trustedPeers.get(senderXidHex) ?? null;
      if (requireTrustedPeers && trustedKey == null) {
        log("T3AMS_INBOX_PIN_REQUIRED", { sender: senderXidHex });
        return null;
      }
      if (trustedKey != null && bareHex(decoded.signingPubKeyHex) !== trustedKey) {
        log("T3AMS_INBOX_KEY_MISMATCH", { sender: senderXidHex });
        return null;
      }
      const peer = addPeer(senderXidHex, {
        displayName: decoded.senderName ?? "",
        username: decoded.username ?? null,
        signingPubKeyHex: decoded.signingPubKeyHex,
      });
      if (peer == null) return null;
      // A request needs one acknowledgement per retained peer pairing. Mark
      // it only after the RPC write succeeds: a full submit queue or a lost
      // allowance must leave the retained request eligible for replay.
      const shouldAcknowledge = decoded.kind === "request"
        && !Number.isSafeInteger(Number(peer.handshakeAcceptedAt));
      if (shouldAcknowledge) {
        const inbox = bcts.derivePersonalInboxChannel(hexToBytes(senderXidHex));
        const expression = bcts.dmAcceptExpression(
          identity.xid,
          displayName,
          now(),
          null,
          null,
          identity.signingPublicKey.taggedCborData(),
        );
        const { envelope } = bcts.createGSTPRequest(expression);
        const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
        await submitStatement({ channel: inbox, topics: [inbox], data: bcts.envelopeToBytes(signed) });
        peer.handshakeAcceptedAt = now();
        persist();
      }
      // dmMessageRequest carries the first sealed message in the inbox.  The
      // normal pairwise subscription also replays it, so it is intentionally
      // not delivered twice here.
      return { kind: "peer", peerXidHex: senderXidHex };
    }
    if (decoded.kind !== "wsInvite") return null;
    if (!acceptWorkspaceInvite({ senderXidHex, senderName: decoded.senderName ?? "" })) {
      log("T3AMS_WORKSPACE_INVITE_IGNORED", { sender: senderXidHex, reason: "workspace-auto-accept-disabled" });
      return null;
    }
    // Workspace invites do not carry a signing public key. A public bot first
    // establishes a verified TOFU DM pairing, then verifies the invite with
    // that key. The sealed payload alone is not account authentication.
    const knownInviter = state.peers[senderXidHex];
    const trustedInviterKey = trustedPeers.get(senderXidHex) ?? null;
    if (requireTrustedPeers && trustedInviterKey == null) {
      log("T3AMS_WORKSPACE_INVITE_PIN_REQUIRED", { sender: senderXidHex });
      return null;
    }
    const inviterKey = trustedInviterKey ?? knownInviter?.signingPubKeyHex ?? null;
    if (publicTofuEnrollment && inviterKey == null) {
      log("T3AMS_WORKSPACE_INVITE_PAIRING_REQUIRED", { sender: senderXidHex });
      return null;
    }
    if (inviterKey != null && !verifyKnownSigned(bcts, decoded.signed, peerSigningKey(bcts, { signingPubKeyHex: inviterKey }))) {
      log("T3AMS_WORKSPACE_INVITE_FORGED", { sender: senderXidHex });
      return null;
    }
    let payload;
    try {
      if (!(decoded.sealed instanceof Uint8Array) || decoded.sealed.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return null;
      const envelope = bcts.envelopeFromBytes(decoded.sealed);
      payload = JSON.parse(bcts.decryptDMEnvelope(envelope, hexToBytes(senderXidHex), identity.xid).extractString());
    } catch {
      return null;
    }
    if (payload == null || typeof payload !== "object" || !validWorkspaceId(payload.wsId) || payload.stateDoc == null) return null;
    if (!isSafeWorkspaceDocument(payload.stateDoc, payload.wsId) || !trustedRosterBindingsValid(payload.stateDoc)) return null;
    const inviteChannels = payload.channels == null
      ? []
      : safeChannelEntries(payload.channels, { max: channelLimit });
    if (inviteChannels == null) return null;
    if (!payload.stateDoc.members?.some((member) => bareHex(member?.xid) === senderXidHex)) return null;
    let workspace = stateWorkspace(state, payload.wsId);
    if (workspace == null) {
      const atCapacity = Object.keys(state.workspaces).length >= workspaceLimit;
      const evictWorkspace = atCapacity && publicTofuEnrollment ? oldestEvictableWorkspaceId() : null;
      if (atCapacity && evictWorkspace == null) {
        log("T3AMS_WORKSPACE_CAP_REACHED", { cap: workspaceLimit });
        return null;
      }
      if (publicTofuEnrollment && !publicAdmission("workspace")) {
        log("T3AMS_PUBLIC_WORKSPACE_ADMISSION_LIMIT", { cap: publicWorkspaceAdmissionCap, windowMs: publicAdmissionWindow });
        return null;
      }
      if (evictWorkspace != null) {
        removeWorkspaceState(evictWorkspace);
        log("T3AMS_PUBLIC_WORKSPACE_EVICTED", { evicted: evictWorkspace });
      }
      workspace = {
        doc: payload.stateDoc,
        channels: inviteChannels,
        memberKeys: {},
        registryMeta: {},
        stateMeta: {
          version: Number(payload.stateDoc?.version ?? 0),
          timestamp: Number(decoded.timestamp ?? 0),
          signerXid: senderXidHex,
        },
        inviterXidHex: senderXidHex,
        acceptedAt: now(),
        lastActivityAt: now(),
        publicEnrollment: publicTofuEnrollment && trustedInviterKey == null,
        joinSent: false,
      };
      state.workspaces[payload.wsId] = workspace;
      persist();
      onTopologyChange({ wsId: payload.wsId, kind: "workspace" });
    }
    if (workspace.joinSent === true) return { kind: "workspace", wsId: payload.wsId };
    if (workspaceJoinInFlight.has(payload.wsId)) return null;
    workspaceJoinInFlight.add(payload.wsId);
    try {
      const replyPayload = {
        wsId: payload.wsId,
        signingPubKeyHex: bareHex(bcts.formatXID(identity.signingPublicKey.taggedCborData())),
        agreementPubKeyHex: identity.agreementPublicKey == null ? null : bareHex(bcts.formatXID(identity.agreementPublicKey)),
      };
      const sealed = bcts.encryptDMEnvelope(bcts.Envelope.new(JSON.stringify(replyPayload)), identity.xid, hexToBytes(senderXidHex));
      const join = bcts.workspaceJoinExpression(identity.xid, displayName, bcts.envelopeToBytes(sealed), now());
      const { envelope } = bcts.createGSTPRequest(join);
      const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
      const inbox = bcts.derivePersonalInboxChannel(hexToBytes(senderXidHex));
      await submitStatement({ channel: inbox, topics: [inbox], data: bcts.envelopeToBytes(signed) });
      await publishMemberAnnounce(payload.wsId);
      workspace.joinSent = true;
      persist();
      return { kind: "workspace", wsId: payload.wsId };
    } finally {
      workspaceJoinInFlight.delete(payload.wsId);
    }
  };

  const receiveWorkspacePlane = (wsId, data) => {
    const workspace = stateWorkspace(state, wsId);
    if (workspace == null || !(data instanceof Uint8Array) || data.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return false;
    let signed;
    try { signed = bcts.decryptWorkspaceChannelEnvelope(bcts.envelopeFromBytes(data), bcts.deriveWorkspaceKey(wsId)); }
    catch { return false; }
    const expression = parseRequest(bcts, signed);
    if (expression == null) return false;
    const functionName = bcts.extractFunctionName(expression);
    try {
      if (functionName === "workspaceStateDoc") {
        const docJson = extractString(bcts, expression, "doc");
        const sender = extractBytes(bcts, expression, "senderXid");
        const timestamp = extractNumber(bcts, expression, "timestamp");
        if (docJson == null || sender == null || docJson.length > 64 * 1024) return false;
        const doc = JSON.parse(docJson);
        const signer = bareHex(bcts.formatXID(sender));
        const version = Number(doc?.version);
        const incomingTimestamp = Number(timestamp ?? 0);
        const currentCreator = bareHex(workspace.doc?.creatorXid);
        if (!isWorkspaceMember(workspace, signer)
          || !currentCreator
          || !isSafeWorkspaceDocument(doc, wsId)
          || !trustedRosterBindingsValid(doc)
          || bareHex(doc?.creatorXid) !== currentCreator
          || !Number.isSafeInteger(version)
          || version < 0
          || !Number.isSafeInteger(incomingTimestamp)
          || incomingTimestamp < 0
          || !verifyKnownSigned(bcts, signed, memberSigningKey(bcts, workspace, signer))) return false;
        const incoming = { version, timestamp: incomingTimestamp, signerXid: signer };
        const current = workspace.stateMeta ?? {
          version: Number(workspace.doc?.version ?? -1),
          timestamp: 0,
          signerXid: currentCreator,
        };
        if (!stateDocSupersedes(current, incoming)) return false;
        workspace.doc = doc;
        workspace.stateMeta = incoming;
        if (workspace.memberKeys != null) {
          for (const xid of Object.keys(workspace.memberKeys)) {
            if (!isWorkspaceMember(workspace, xid)) delete workspace.memberKeys[xid];
          }
        }
        if (!isWorkspaceMember(workspace, selfXidHex)) {
          for (const keyId of Object.keys(state.keys)) {
            if (keyId.startsWith(`${wsId}:`)) delete state.keys[keyId];
          }
        } else {
          pruneWorkspaceKeys(wsId, workspace);
        }
        touchWorkspace(wsId);
        persist();
        onTopologyChange({ wsId, kind: "workspace" });
        return true;
      }
      if (functionName === "memberAnnounce") {
        const announcedWorkspace = extractString(bcts, expression, "workspaceId");
        const sender = extractBytes(bcts, expression, "senderXid");
        const signing = extractBytes(bcts, expression, "signingPubKey");
        const agreement = extractBytes(bcts, expression, "agreementPubKey");
        const senderName = extractString(bcts, expression, "senderName");
        if (announcedWorkspace !== wsId || sender == null || signing == null) return false;
        const senderXid = bareHex(bcts.formatXID(sender));
        if (!isWorkspaceMember(workspace, senderXid)) return false;
        const announcedKey = signingKeyFromTaggedBytes(bcts, signing);
        // The carried key proves the announcement's self-consistency. If a
        // key is already vouched in the state document/roster, it must also
        // validate the same request so an attacker cannot replace the pin.
        if (!verifyKnownSigned(bcts, signed, announcedKey)) return false;
        const pinned = memberSigningKey(bcts, workspace, senderXid);
        if (pinned != null && !verifySigned(bcts, signed, pinned)) return false;
        workspace.memberKeys ??= {};
        workspace.memberKeys[senderXid] = {
          ...(workspace.memberKeys[senderXid] ?? {}),
          signingPubKeyHex: bareHex(bcts.formatXID(signing)),
          ...(agreement == null ? {} : { agreementPubKeyHex: bareHex(bcts.formatXID(agreement)) }),
          ...(senderName == null ? {} : { displayName: senderName }),
          updatedAt: now(),
        };
        persist();
        return true;
      }
      if (functionName === "channelRegistry") {
        const docJson = extractString(bcts, expression, "doc");
        if (docJson == null || docJson.length > 64 * 1024) return false;
        const registry = JSON.parse(docJson);
        if (registry?.wsId !== wsId || !Array.isArray(registry?.channels)) return false;
        const creator = bareHex(registry.creatorXid);
        const updatedAt = Number(registry.updatedAt);
        const incomingChannels = safeChannelEntries(registry.channels, { creator, max: channelLimit });
        if (!validXidHex(creator) || !isWorkspaceMember(workspace, creator)
            || !Number.isSafeInteger(updatedAt) || updatedAt < 0 || incomingChannels == null) return false;
        // The SPA never publishes an empty own-registry list because it would
        // clobber a retained LWW slot; mirror that safety rule on receipt.
        if (incomingChannels.length === 0) return false;
        if (!verifyKnownSigned(bcts, signed, memberSigningKey(bcts, workspace, creator))) return false;
        workspace.registryMeta ??= {};
        const previousUpdatedAt = Number(workspace.registryMeta[creator]?.updatedAt ?? -1);
        if (!Number.isSafeInteger(previousUpdatedAt) || updatedAt <= previousUpdatedAt) return false;
        const currentChannels = safeChannelEntries(workspace.channels ?? [], { max: channelLimit });
        if (currentChannels == null) return false;
        const byId = new Map(currentChannels.map((channel) => [bareHex(channel.idHex), channel]));
        for (const incomingChannel of incomingChannels) {
          const id = bareHex(incomingChannel.idHex);
          const existing = byId.get(id);
          if (existing == null || bareHex(existing.creatorXid) === creator) continue;
          const existingCreator = bareHex(existing.creatorXid);
          const canTakeOver = !isWorkspaceMember(workspace, existingCreator)
            && ["owner", "admin"].includes(workspaceRoleFor(workspace, creator));
          if (!canTakeOver) return false;
        }
        // A creator's registry is a complete LWW list, so its omitted entries
        // are no longer live. Other creators' slots stay untouched.
        const incomingIds = new Set(incomingChannels.map((channel) => bareHex(channel.idHex)));
        const merged = currentChannels.filter((channel) => (
          bareHex(channel.creatorXid) !== creator && !incomingIds.has(bareHex(channel.idHex))
        ));
        for (const incomingChannel of incomingChannels) {
          const existing = byId.get(bareHex(incomingChannel.idHex));
          merged.push(existing?.deleted === true && incomingChannel.deleted !== true
            ? { ...incomingChannel, deleted: true, archived: true }
            : incomingChannel);
        }
        if (merged.length > channelLimit) return false;
        workspace.channels = merged;
        workspace.registryMeta[creator] = { updatedAt };
        pruneWorkspaceKeys(wsId, workspace);
        touchWorkspace(wsId);
        persist();
        onTopologyChange({ wsId, kind: "registry" });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  const receiveWorkspaceNotification = (wsId, data) => {
    const workspace = stateWorkspace(state, wsId);
    if (workspace == null || !isWorkspaceMember(workspace, selfXidHex) || identity.agreementPrivateKey == null
        || !(data instanceof Uint8Array) || data.byteLength > T3AMS_MAX_ENVELOPE_BYTES) return false;
    try {
      const outer = bcts.envelopeFromBytes(data);
      const senderAgreement = outer.assertionWithPredicate("senderAgreementKey")?.asObject()?.extractBytes();
      if (senderAgreement == null) return false;
      const signed = bcts.unsealMessage(outer, identity.xid, identity.agreementPrivateKey, senderAgreement);
      const expression = parseRequest(bcts, signed);
      if (expression == null) return false;
      const channelId = extractBytes(bcts, expression, "channelId");
      const admin = extractBytes(bcts, expression, "adminXid");
      if (channelId == null || admin == null) return false;
      const channelIdHex = bareHex(bcts.formatXID(channelId));
      const adminHex = bareHex(bcts.formatXID(admin));
      const channel = stateChannel(workspace, channelIdHex);
      // Key material is meaningful only for a currently registered, active
      // private channel owned by the authenticated grantor. Never allow a
      // notification to create an arbitrary state.keys slot.
      if (channel == null || channel.isPrivate !== true || channel.archived === true || channel.deleted === true
          || bareHex(channel.creatorXid) !== adminHex || !isWorkspaceMember(workspace, adminHex)) return false;
      if (!verifyKnownSigned(bcts, signed, memberSigningKey(bcts, workspace, adminHex))) return false;
      const adminAgreement = extractBytes(bcts, expression, "adminAgreementPubKey") ?? senderAgreement;
      const functionName = bcts.extractFunctionName(expression);
      const keyId = `${wsId}:${channelIdHex}`;
      pruneWorkspaceKeys(wsId, workspace);
      if (!privateKeyIdsForWorkspace(wsId, workspace).has(keyId)) return false;
      if (functionName === "grantChannelAccess") {
        const grantee = extractBytes(bcts, expression, "granteeXid");
        const encrypted = extractBytes(bcts, expression, "encryptedKey");
        const version = Number(extractNumber(bcts, expression, "keyVersion"));
        if (grantee == null || encrypted == null || !Number.isSafeInteger(version) || version < 1 || bareHex(bcts.formatXID(grantee)) !== selfXidHex) return false;
        const current = state.keys[keyId]?.current;
        if (current != null && (!Number.isSafeInteger(Number(current.version)) || Number(current.version) >= version)) return false;
        if (current == null && (workspaceKeyCount(wsId) >= T3AMS_KEY_CAP_PER_WORKSPACE || Object.keys(state.keys).length >= T3AMS_KEY_CAP)) {
          log("T3AMS_KEY_CAP_REACHED", { wsId, perWorkspaceCap: T3AMS_KEY_CAP_PER_WORKSPACE, cap: T3AMS_KEY_CAP });
          return false;
        }
        const key = bcts.decryptChannelKeyFromAdmin(encrypted, identity.agreementPrivateKey, adminAgreement);
        const keyHex = normalizeKeyMaterial(bytesToHex(key));
        if (keyHex == null) return false;
        state.keys[keyId] = { current: { keyHex, version }, previous: [] };
        persist();
        onTopologyChange({ wsId, channelIdHex, kind: "key" });
        return true;
      }
      if (functionName === "rotateChannelKey") {
        const encryptedKeys = bcts.extractParameter(expression, "encryptedKeys");
        const version = Number(extractNumber(bcts, expression, "keyVersion"));
        if (encryptedKeys == null || !Number.isSafeInteger(version) || version < 1) return false;
        const current = state.keys[keyId]?.current;
        if (current == null || !Number.isSafeInteger(Number(current.version)) || Number(current.version) >= version) return false;
        let encrypted = null;
        for (const assertion of encryptedKeys.assertions()) {
          const member = assertion.asObject();
          if (member?.subject?.().extractString?.() !== selfXidHex) continue;
          encrypted = member.assertionWithPredicate("encryptedKey")?.asObject()?.extractBytes() ?? null;
          break;
        }
        if (encrypted == null) {
          // A rotation that omits this recipient is a revocation. Forget both
          // current and historical keys immediately so stale ciphertext cannot
          // be decrypted after the bot has been removed from the channel.
          if (state.keys[keyId] == null) return false;
          delete state.keys[keyId];
          persist();
          onTopologyChange({ wsId, channelIdHex, kind: "key" });
          return true;
        }
        const key = bcts.decryptChannelKeyFromAdmin(encrypted, identity.agreementPrivateKey, adminAgreement);
        const keyHex = normalizeKeyMaterial(bytesToHex(key));
        if (keyHex == null) return false;
        state.keys[keyId] = {
          current: { keyHex, version },
          previous: current == null ? [] : [current, ...(state.keys[keyId]?.previous ?? [])].slice(0, 4),
        };
        persist();
        onTopologyChange({ wsId, channelIdHex, kind: "key" });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  const publishMemberAnnounce = async (wsId) => {
    const workspace = stateWorkspace(state, wsId);
    if (workspace == null) return;
    const expression = bcts.memberAnnounceExpression(
      wsId,
      identity.xid,
      displayName,
      identity.signingPublicKey.taggedCborData(),
      now(),
      identity.agreementPublicKey,
      "online",
      null,
    );
    const { envelope } = bcts.createGSTPRequest(expression);
    const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
    const sealed = bcts.encryptWorkspaceChannelEnvelope(signed, bcts.deriveWorkspaceKey(wsId));
    const channel = bcts.deriveWorkspaceMemberChannel(wsId, identity.xid);
    await submitStatement({ channel, topics: bcts.createWorkspaceDiscoveryTopics(wsId), data: bcts.envelopeToBytes(sealed) });
  };

  const requireConversation = (chatId) => {
    const conversation = conversations.get(chatId);
    if (conversation == null) throw terminalDeliveryError("T3AMS_UNKNOWN_CONVERSATION", "unknown T3ams conversation");
    return conversation;
  };

  const requireTargetMessageId = (messageId) => {
    const normalized = bareHex(messageId);
    if (!validXidHex(normalized)) {
      throw terminalDeliveryError("T3AMS_INVALID_MESSAGE_ID", "messageId must be a 32-byte hexadecimal message ID");
    }
    return normalized;
  };

  const requireOperationText = (text) => {
    if (typeof text !== "string" || text.trim() === "") {
      throw terminalDeliveryError("T3AMS_INVALID_TEXT", "text is required");
    }
    return text;
  };

  const requireRichContent = (text, attachments) => {
    if (typeof text !== "string") {
      throw terminalDeliveryError("T3AMS_INVALID_TEXT", "text must be a string");
    }
    const refs = attachments == null ? [] : attachments;
    try {
      normalizeT3amsAttachmentRefs(refs, attachmentOptions);
    } catch (error) {
      throw terminalDeliveryError("T3AMS_INVALID_ATTACHMENT", "attachment metadata is invalid", error);
    }
    if (text.trim() === "" && refs.length === 0) {
      throw terminalDeliveryError("T3AMS_INVALID_TEXT", "text or an attachment is required");
    }
    return refs;
  };

  const requireEmoji = (emoji) => {
    const normalized = typeof emoji === "string" ? emoji.trim() : "";
    // Reactions are UI affordances, not an arbitrary hidden data channel.
    // Keep a generous Unicode allowance but reject controls and huge payloads.
    if (!normalized || Array.from(normalized).length > 32 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw terminalDeliveryError("T3AMS_INVALID_REACTION", "emoji must be a short printable reaction");
    }
    return normalized;
  };

  const workspaceOperationRoute = (conversation, operation) => {
    const workspace = stateWorkspace(state, conversation.wsId);
    const channelEntry = stateChannel(workspace, conversation.channelIdHex);
    if (workspace == null || channelEntry == null || !isWorkspaceMember(workspace, selfXidHex)) {
      throw terminalDeliveryError("T3AMS_CHANNEL_UNAVAILABLE", "bot is not an active member of this workspace channel");
    }
    if (channelEntry.archived === true || channelEntry.deleted === true) {
      throw terminalDeliveryError("T3AMS_CHANNEL_UNAVAILABLE", "workspace channel is archived or deleted");
    }
    if (!canPostWorkspaceChannel(workspace, channelEntry, selfXidHex)) {
      throw terminalDeliveryError("T3AMS_CHANNEL_FORBIDDEN", `bot is not permitted to ${operation} in this workspace channel`);
    }
    const channelId = hexToBytes(channelEntry.idHex);
    const key = channelEntry.isPrivate
      ? stateKey(state, conversation.wsId, channelEntry.idHex)?.current?.keyHex
      : bcts.deriveWorkspaceKey(conversation.wsId);
    if (key == null) {
      throw terminalDeliveryError("T3AMS_CHANNEL_KEY_MISSING", "no private-channel key has been granted to this bot");
    }
    return {
      channelEntry,
      channelId,
      key: typeof key === "string" ? hexToBytes(key) : key,
      topics: channelEntry.isPrivate
        ? bcts.createPrivateChannelTopics(channelId, identity.xid, "message", true)
        : bcts.createPublicChannelTopics(channelId, identity.xid, true),
    };
  };

  const submitDmOperation = async (conversation, expression, channel) => {
    const peer = hexToBytes(conversation.peerXidHex);
    const operationChannel = channel(peer);
    const { envelope } = bcts.createGSTPRequest(expression(peer));
    const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
    const sealed = bcts.encryptDMEnvelope(signed, identity.xid, peer);
    await submitOutboundStatement({
      channel: operationChannel,
      topics: bcts.createDMTopics(operationChannel, identity.xid, true),
      data: bcts.envelopeToBytes(sealed),
    });
  };

  const submitWorkspaceOperation = async (conversation, expression, channelFor, operation) => {
    const route = workspaceOperationRoute(conversation, operation);
    const { envelope } = bcts.createGSTPRequest(expression(route.channelId));
    const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
    const sealed = bcts.encryptWorkspaceChannelEnvelope(signed, route.key);
    await submitOutboundStatement({
      channel: channelFor(route.channelEntry, route.channelId),
      topics: route.topics,
      data: bcts.envelopeToBytes(sealed),
    });
  };

  const editText = async (chatId, messageId, text) => {
    const conversation = requireConversation(chatId);
    const target = requireTargetMessageId(messageId);
    const replacement = requireOperationText(text);
    const editedAt = now();
    if (conversation.kind === "dm") {
      await submitDmOperation(
        conversation,
        (peer) => bcts.editMessageExpression(hexToBytes(target), replacement, editedAt, peer),
        (peer) => bcts.derivePersonalDMOpsChannel(identity.xid, peer),
      );
    } else {
      await submitWorkspaceOperation(
        conversation,
        () => bcts.channelEditMessageExpression(hexToBytes(target), replacement, identity.xid, editedAt),
        (channelEntry, channelId) => channelEntry.isPrivate
          ? bcts.derivePrivateChannelOpsChannel(channelId)
          : bcts.derivePublicChannelOpsChannel(channelId),
        "edit messages",
      );
    }
    log("T3AMS_EDITED_TEXT", { chatId, target });
    return { messageId: target, edited: true };
  };

  const sendReaction = async (chatId, messageId, emoji, { removed = false } = {}) => {
    const conversation = requireConversation(chatId);
    const target = requireTargetMessageId(messageId);
    const reaction = requireEmoji(emoji);
    const reactedAt = now();
    if (conversation.kind === "dm") {
      await submitDmOperation(
        conversation,
        (peer) => (removed ? bcts.removeReactionExpression : bcts.addReactionExpression)(hexToBytes(target), reaction, reactedAt, peer),
        (peer) => bcts.derivePersonalDMOpsChannel(identity.xid, peer),
      );
    } else {
      await submitWorkspaceOperation(
        conversation,
        () => (removed ? bcts.channelRemoveReactionExpression : bcts.channelAddReactionExpression)(
          hexToBytes(target), reaction, identity.xid, reactedAt,
        ),
        (channelEntry, channelId) => channelEntry.isPrivate
          ? bcts.derivePrivateChannelOpsChannel(channelId)
          : bcts.derivePublicChannelOpsChannel(channelId),
        "react to messages",
      );
    }
    log("T3AMS_SENT_REACTION", { chatId, target, removed });
    return { messageId: target, removed };
  };

  const sendTyping = async (chatId, { force = false, minIntervalMs = 4_000 } = {}) => {
    const conversation = requireConversation(chatId);
    const interval = boundedInteger(minIntervalMs, 4_000, { min: 250, max: 60_000 });
    const current = now();
    const previous = lastTypingAt.get(chatId) ?? 0;
    if (!force && current - previous < interval) return { sent: false, throttled: true };
    if (conversation.kind === "dm") {
      await submitDmOperation(
        conversation,
        (peer) => bcts.typingIndicatorExpression(bcts.derivePersonalDMChannel(identity.xid, peer), true, current, peer),
        (peer) => bcts.derivePersonalDMTypingChannel(identity.xid, peer),
      );
    } else {
      await submitWorkspaceOperation(
        conversation,
        () => bcts.channelTypingExpression(identity.xid, current),
        (channelEntry, channelId) => channelEntry.isPrivate
          ? bcts.derivePrivateChannelTypingChannel(channelId)
          : bcts.derivePublicChannelTypingChannel(channelId),
        "show typing",
      );
    }
    lastTypingAt.delete(chatId);
    lastTypingAt.set(chatId, current);
    while (lastTypingAt.size > conversationLimit) lastTypingAt.delete(lastTypingAt.keys().next().value);
    log("T3AMS_SENT_TYPING", { chatId });
    return { sent: true, throttled: false };
  };

  const sendRichText = async (chatId, text, options = {}) => {
    const conversation = requireConversation(chatId);
    const attachments = requireRichContent(text, options.attachments);
    const rootId = Object.hasOwn(options, "threadRootId")
      ? options.threadRootId
      : conversation.threadRootId ?? null;
    if (rootId != null && (!/^[0-9a-f]{64}$/i.test(String(rootId)))) {
      throw terminalDeliveryError("T3AMS_INVALID_THREAD", "threadRootId must be a 32-byte hexadecimal message ID");
    }
    const prior = channelPriorEntries(bcts, state, chatId);
    const sentAt = now();
    let messageId;
    let blob;
    let statement;
    let messageTimestamp = sentAt;
    if (conversation.kind === "dm") {
      const peer = hexToBytes(conversation.peerXidHex);
      const message = bcts.buildChatMessage({
        from: identity.xid,
        to: peer,
        body: text,
        ...(rootId != null ? { threadRootId: hexToBytes(rootId) } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      const sent = bcts.createEncryptedDMMessage(message, identity, peer);
      blob = bcts.envelopeToBytes(sent.envelope);
      statement = {
        channel: bcts.derivePersonalDMChannel(identity.xid, peer),
        topics: sent.topics,
        data: bcts.envelopeToBytes(bcts.buildMessageCarrier(blob, prior)),
      };
      messageId = bareHex(bcts.formatXID(message.id));
      const candidateTimestamp = Number(message.timestamp);
      if (Number.isSafeInteger(candidateTimestamp) && candidateTimestamp >= 0) messageTimestamp = candidateTimestamp;
    } else {
      const workspace = stateWorkspace(state, conversation.wsId);
      const channelEntry = stateChannel(workspace, conversation.channelIdHex);
      if (workspace == null || channelEntry == null || !isWorkspaceMember(workspace, selfXidHex)) {
        throw terminalDeliveryError("T3AMS_CHANNEL_UNAVAILABLE", "bot is not an active member of this workspace channel");
      }
      if (channelEntry.archived === true || channelEntry.deleted === true) {
        throw terminalDeliveryError("T3AMS_CHANNEL_UNAVAILABLE", "workspace channel is archived or deleted");
      }
      if (!canPostWorkspaceChannel(workspace, channelEntry, selfXidHex)) {
        throw terminalDeliveryError("T3AMS_CHANNEL_FORBIDDEN", "bot is not permitted to post in this workspace channel");
      }
      const channelId = hexToBytes(channelEntry.idHex);
      const expression = bcts.sendChannelMessageExpression(
        bcts.generateARID(),
        identity.xid,
        displayName,
        text,
        sentAt,
        rootId == null ? undefined : hexToBytes(rootId),
        attachments.length > 0 ? attachments : undefined,
      );
      const { envelope } = bcts.createGSTPRequest(expression);
      const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
      const key = channelEntry.isPrivate
        ? stateKey(state, conversation.wsId, channelEntry.idHex)?.current?.keyHex
        : bytesToHex(bcts.deriveWorkspaceKey(conversation.wsId));
      if (typeof key !== "string") throw terminalDeliveryError("T3AMS_CHANNEL_KEY_MISSING", "no private-channel key has been granted to this bot");
      const encrypted = bcts.encryptWorkspaceChannelEnvelope(signed, hexToBytes(key));
      blob = bcts.envelopeToBytes(encrypted);
      statement = {
        channel: channelEntry.isPrivate ? bcts.derivePrivateChannel(channelId) : bcts.derivePublicChannel(channelId),
        topics: channelEntry.isPrivate
          ? bcts.createPrivateChannelTopics(channelId, identity.xid, "message", true)
          : bcts.createPublicChannelTopics(channelId, identity.xid, true),
        data: bcts.envelopeToBytes(bcts.buildMessageCarrier(blob, prior)),
      };
      messageId = bareHex(bcts.formatXID(bcts.extractParameter(expression, "id").extractBytes()));
    }
    await submitOutboundStatement(statement);
    // Match the SPA's best-effort re-onboard wake: launch it only after the
    // pairwise carrier was accepted, and never make the primary reply await
    // or depend on a second inbox submission.
    if (conversation.kind === "dm") void maybeWakePeerInbox(conversation.peerXidHex, statement.data);
    appendBackfill(state, chatId, { id: messageId, senderXid: selfXidHex, timestamp: messageTimestamp, blob: bytesToHex(blob) });
    persist();
    log("T3AMS_SENT_TEXT", { chatId, chars: text.length, ...(attachments.length > 0 ? { attachments: attachments.length } : {}) });
    return { messageId };
  };
  const sendText = (chatId, text, options = {}) => sendRichText(chatId, text, options);

  return {
    selfXidHex,
    snapshot: () => jsonClone(state),
    peerIds: () => Object.entries(state.peers)
      .sort(([leftId, left], [rightId, right]) => (
        Number(right?.lastActivityAt ?? right?.updatedAt ?? 0) - Number(left?.lastActivityAt ?? left?.updatedAt ?? 0)
        || leftId.localeCompare(rightId)
      ))
      .map(([xid]) => xid)
      .slice(0, peerLimit),
    workspaces: () => Object.keys(state.workspaces).slice(0, workspaceLimit),
    memberIds: (wsId) => {
      const members = stateWorkspace(state, wsId)?.doc?.members;
      return Array.isArray(members)
        ? members.map((member) => bareHex(member?.xid)).filter(validXidHex).slice(0, channelLimit)
        : [];
    },
    channels: (wsId) => (safeChannelEntries(stateWorkspace(state, wsId)?.channels ?? [], { max: channelLimit }) ?? []).slice(0, channelLimit),
    isWorkspaceMember: (wsId) => isWorkspaceMember(stateWorkspace(state, wsId), selfXidHex),
    workspaceRole: (wsId, xidHex) => workspaceRoleFor(stateWorkspace(state, wsId), xidHex),
    canReadChannel: (wsId, channelIdHex) => {
      const workspace = stateWorkspace(state, wsId);
      return canReadWorkspaceChannel(workspace, stateChannel(workspace, channelIdHex), selfXidHex);
    },
    canPostChannel: (wsId, channelIdHex) => {
      const workspace = stateWorkspace(state, wsId);
      return canPostWorkspaceChannel(workspace, stateChannel(workspace, channelIdHex), selfXidHex);
    },
    addPeer,
    claimInbound,
    pinConversation,
    unpinConversation,
    restoreInboundConversation,
    receiveInbox,
    receiveDm: directMessage,
    receiveDmOperation: directMessageOperation,
    receiveChannel: workspaceChannel,
    receiveChannelOperation: workspaceChannelOperation,
    receiveWorkspacePlane,
    receiveWorkspaceNotification,
    commitInbound,
    releaseInbound,
    publishMemberAnnounce,
    sendText,
    sendRichText,
    editText,
    sendReaction,
    sendTyping,
    conversation: (chatId) => conversations.get(chatId) ?? null,
    replyThreadFor: (chatId, messageId) => {
      const key = replyTargetKey(chatId, messageId);
      if (replyTargets.has(key)) return replyTargets.get(key);
      return conversations.get(chatId)?.threadRootId ?? null;
    },
  };
}
