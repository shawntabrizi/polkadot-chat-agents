// T3ams protocol adapter.
//
// This module deliberately has no RPC, HTTP, or agent-CLI dependency.  It
// turns T3ams/bcts envelopes into normalized bot messages and turns normalized
// replies back into Statement Store submissions.  Keeping this seam small
// makes the transport testable with an in-memory statement store and lets the
// existing direct-engine and HTTP-bridge runtimes stay transport-agnostic.

import { conversationKeyFor } from "./t3ams-routing.mjs";

export const T3AMS_STATE_VERSION = 1;
export const T3AMS_BACKFILL_CAP = 8;
export const T3AMS_BACKFILL_BUDGET_BYTES = 8 * 1024;
export const T3AMS_BACKFILL_ENTRY_OVERHEAD_BYTES = 96;
export const T3AMS_MAX_ENVELOPE_BYTES = 256 * 1024;
export const T3AMS_PEER_CAP = 1_000;
export const T3AMS_WORKSPACE_CAP = 100;
export const T3AMS_CHANNEL_CAP = 1_000;
const T3AMS_TAGGED_KEY_HEX_RE = /^[0-9a-f]{2,4096}$/;
const T3AMS_XID_HEX_RE = /^[0-9a-f]{64}$/;
const T3AMS_ROLES = new Set(["owner", "admin", "mod", "member", "guest"]);

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

export function normalizeT3amsState(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw) || raw.v !== T3AMS_STATE_VERSION) {
    return { v: T3AMS_STATE_VERSION, peers: {}, workspaces: {}, keys: {}, backfill: {}, seen: [] };
  }
  const object = (value) => value != null && typeof value === "object" && !Array.isArray(value) ? value : {};
  const peers = object(raw.peers);
  const workspaces = object(raw.workspaces);
  const keys = object(raw.keys);
  const backfill = object(raw.backfill);
  return {
    v: T3AMS_STATE_VERSION,
    peers,
    workspaces,
    keys,
    backfill,
    seen: Array.isArray(raw.seen) ? raw.seen.filter((item) => typeof item === "string").slice(-20_000) : [],
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
  const list = Array.isArray(state.backfill[conversationKey]) ? state.backfill[conversationKey] : [];
  // A carrier may be replayed after reconnect. The durable inbound ledger is
  // normally enough to prevent this, but keep the relay history idempotent as
  // well so a recovered snapshot never amplifies the same wire message.
  const id = typeof entry?.id === "string" ? bareHex(entry.id) : "";
  if (id && list.some((candidate) => bareHex(candidate?.id) === id)) return;
  list.push(entry);
  state.backfill[conversationKey] = list.slice(-T3AMS_BACKFILL_CAP);
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
  acceptWorkspaceInvite = () => true,
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
  const replyTargets = new Map();
  // Decoding a carrier happens before the runtime has durably admitted its
  // message to the local ingress journal. Keep a short-lived claim separate
  // from `state.seen`: otherwise a full bridge/dispatcher queue could mark a
  // valid statement handled and lose it permanently on replay.
  const inboundClaims = new Set();
  const workspaceJoinInFlight = new Set();
  const persist = () => onStateChange(jsonClone(state));
  const submitStatement = async (statement) => submit(statement);
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
    conversations.set(message.chatId, { ...message.conversation, threadRootId: message.threadRootId });
    recordReplyTarget(message.chatId, message.messageId, message.threadRootId);
    return { ...message, ingressKey: key };
  };
  const commitInbound = (message) => {
    const key = message?.ingressKey ?? inboundKeyFor(message);
    if (typeof key !== "string" || !inboundClaims.has(key)) return false;
    inboundClaims.delete(key);
    if (!recordSeen(state, key)) return false;
    const wireBlobHex = typeof message?.wireBlobHex === "string" ? bareHex(message.wireBlobHex) : "";
    const timestamp = Number(message?.timestamp);
    if (validWireBlobHex(wireBlobHex) && validXidHex(message?.senderXid)
        && Number.isSafeInteger(timestamp) && timestamp >= 0 && message?.conversation != null) {
      appendBackfill(state, message.chatId, {
        id: bareHex(message.messageId),
        senderXid: bareHex(message.senderXid),
        timestamp,
        blob: wireBlobHex,
      });
    }
    return true;
  };
  const releaseInbound = (message) => {
    const key = message?.ingressKey ?? inboundKeyFor(message);
    return typeof key === "string" && inboundClaims.delete(key);
  };

  const addPeer = (peerXidHex, details = {}) => {
    const key = bareHex(peerXidHex);
    if (!/^[0-9a-f]{64}$/.test(key) || key === selfXidHex) return null;
    const existing = state.peers[key] ?? {};
    if (state.peers[key] == null && Object.keys(state.peers).length >= peerLimit) {
      log("T3AMS_PEER_CAP_REACHED", { cap: peerLimit });
      return null;
    }
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
    };
    persist();
    onTopologyChange();
    return state.peers[key];
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
    conversations.set(chatId, { ...conversation, threadRootId });
    recordReplyTarget(chatId, message.messageId, threadRootId);
    return true;
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
          wireBlobHex: bytesToHex(blob),
        };
      } catch {
        return null;
      }
    };
    return acceptCarrierMessages(carrier, decode);
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
      // Inbox subscriptions replay the latest retained request. Persist the
      // same small dismissal key used by the T3ams client so a resubscribe
      // cannot keep spending statement allowance on duplicate dmAccepts.
      const shouldAcknowledge = decoded.kind === "request" && recordSeen(
        state,
        `inbox:${senderXidHex}:${decoded.timestamp}`,
      );
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
    // Workspace invites do not carry a signing public key. A deliberately
    // public bot may choose first-contact TOFU, but a private bot already has
    // an operator-pinned device key and must verify the outer GSTP request on
    // *its first* invite as well. The sealed payload alone is not account
    // authentication because its pairwise encryption inputs are public XIDs.
    const knownInviter = state.peers[senderXidHex];
    const trustedInviterKey = trustedPeers.get(senderXidHex) ?? null;
    if (requireTrustedPeers && trustedInviterKey == null) {
      log("T3AMS_WORKSPACE_INVITE_PIN_REQUIRED", { sender: senderXidHex });
      return null;
    }
    const inviterKey = trustedInviterKey ?? knownInviter?.signingPubKeyHex ?? null;
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
    let workspace = stateWorkspace(state, payload.wsId);
    if (workspace == null) {
      if (Object.keys(state.workspaces).length >= workspaceLimit) {
        log("T3AMS_WORKSPACE_CAP_REACHED", { cap: workspaceLimit });
        return null;
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
        joinSent: false,
      };
      if (!workspace.doc.members?.some((member) => bareHex(member?.xid) === senderXidHex)) return null;
      state.workspaces[payload.wsId] = workspace;
      persist();
      onTopologyChange();
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
        persist();
        onTopologyChange();
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
        persist();
        onTopologyChange();
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
      if (channel != null && bareHex(channel.creatorXid) !== adminHex) return false;
      if (!verifyKnownSigned(bcts, signed, memberSigningKey(bcts, workspace, adminHex))) return false;
      const adminAgreement = extractBytes(bcts, expression, "adminAgreementPubKey") ?? senderAgreement;
      const functionName = bcts.extractFunctionName(expression);
      const keyId = `${wsId}:${channelIdHex}`;
      if (functionName === "grantChannelAccess") {
        const grantee = extractBytes(bcts, expression, "granteeXid");
        const encrypted = extractBytes(bcts, expression, "encryptedKey");
        const version = Number(extractNumber(bcts, expression, "keyVersion"));
        if (grantee == null || encrypted == null || !Number.isSafeInteger(version) || version < 1 || bareHex(bcts.formatXID(grantee)) !== selfXidHex) return false;
        const current = state.keys[keyId]?.current;
        if (current != null && (!Number.isSafeInteger(Number(current.version)) || Number(current.version) >= version)) return false;
        const key = bcts.decryptChannelKeyFromAdmin(encrypted, identity.agreementPrivateKey, adminAgreement);
        state.keys[keyId] = { current: { keyHex: bytesToHex(key), version }, previous: [] };
        persist();
        onTopologyChange();
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
          onTopologyChange();
          return true;
        }
        const key = bcts.decryptChannelKeyFromAdmin(encrypted, identity.agreementPrivateKey, adminAgreement);
        state.keys[keyId] = {
          current: { keyHex: bytesToHex(key), version },
          previous: current == null ? [] : [current, ...(state.keys[keyId]?.previous ?? [])].slice(0, 4),
        };
        persist();
        onTopologyChange();
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

  const sendText = async (chatId, text, options = {}) => {
    const conversation = conversations.get(chatId);
    if (conversation == null) throw new Error("unknown T3ams conversation");
    if (typeof text !== "string" || text.trim() === "") throw new Error("text is required");
    const rootId = Object.hasOwn(options, "threadRootId")
      ? options.threadRootId
      : conversation.threadRootId ?? null;
    if (rootId != null && (!/^[0-9a-f]{64}$/i.test(String(rootId)))) {
      throw new Error("threadRootId must be a 32-byte hexadecimal message ID");
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
        throw new Error("bot is not an active member of this workspace channel");
      }
      if (!canPostWorkspaceChannel(workspace, channelEntry, selfXidHex)) {
        throw new Error("bot is not permitted to post in this workspace channel");
      }
      const channelId = hexToBytes(channelEntry.idHex);
      const expression = bcts.sendChannelMessageExpression(
        bcts.generateARID(),
        identity.xid,
        displayName,
        text,
        sentAt,
        rootId == null ? undefined : hexToBytes(rootId),
      );
      const { envelope } = bcts.createGSTPRequest(expression);
      const signed = bcts.signGSTPRequest(envelope, identity.signingPrivateKey);
      const key = channelEntry.isPrivate
        ? stateKey(state, conversation.wsId, channelEntry.idHex)?.current?.keyHex
        : bytesToHex(bcts.deriveWorkspaceKey(conversation.wsId));
      if (typeof key !== "string") throw new Error("no private-channel key has been granted to this bot");
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
    await submitStatement(statement);
    appendBackfill(state, chatId, { id: messageId, senderXid: selfXidHex, timestamp: messageTimestamp, blob: bytesToHex(blob) });
    persist();
    log("T3AMS_SENT_TEXT", { chatId, chars: text.length });
    return { messageId };
  };

  return {
    selfXidHex,
    snapshot: () => jsonClone(state),
    peerIds: () => Object.keys(state.peers).slice(0, peerLimit),
    workspaces: () => Object.keys(state.workspaces).slice(0, workspaceLimit),
    memberIds: (wsId) => {
      const members = stateWorkspace(state, wsId)?.doc?.members;
      return Array.isArray(members)
        ? members.map((member) => bareHex(member?.xid)).filter(validXidHex).slice(0, channelLimit)
        : [];
    },
    channels: (wsId) => (safeChannelEntries(stateWorkspace(state, wsId)?.channels ?? [], { max: channelLimit }) ?? []).slice(0, channelLimit),
    isWorkspaceMember: (wsId) => isWorkspaceMember(stateWorkspace(state, wsId), selfXidHex),
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
    restoreInboundConversation,
    receiveInbox,
    receiveDm: directMessage,
    receiveChannel: workspaceChannel,
    receiveWorkspacePlane,
    receiveWorkspaceNotification,
    commitInbound,
    releaseInbound,
    publishMemberAnnounce,
    sendText,
    conversation: (chatId) => conversations.get(chatId) ?? null,
    replyThreadFor: (chatId, messageId) => {
      const key = replyTargetKey(chatId, messageId);
      if (replyTargets.has(key)) return replyTargets.get(key);
      return conversations.get(chatId)?.threadRootId ?? null;
    },
  };
}
