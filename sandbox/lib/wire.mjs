// The wire inspector's read side: every statement the node holds (and what
// its slots held before), with the names the sandbox can put on it and the
// payload decrypted wherever the sandbox holds a key.
//
// The sandbox holds every persona's keys, so it can derive the same session
// ids and channels the clients derive (identity session, per-device session,
// request topics) and label a topic like `session alice#1→bob` instead of 32
// opaque bytes. A contact it holds no keys for (a bot-core bot) is still
// labelled and decrypted from the other side: every session shares a secret
// with one of our personas — K(alice, bot) and the bot's device sessions
// derive from alice's keys plus the bot's public keys in her roster — and a
// multi-device envelope wrapped for alice's devices opens with alice's device
// keys. What the sandbox cannot open: a chat request addressed to a bot (the
// envelope key is the sender's ephemeral one, discarded after sending).
//
// Nothing here writes; nothing here returns a private key or a seed.

import { x25519 } from "@noble/curves/ed25519.js";
import { ChatMessage as ChatMessageCodec } from "@novasamatech/host-chat/codec/message";
import {
  Request,
  Response,
  StatementData,
  createAccountId,
  createEncryption,
  createEnvelope,
  createRequestChannel,
  createResponseChannel,
  createSessionId,
} from "@novasamatech/statement-store";

import { bytesToHex, hexToBytes, normHex } from "./bytes.mjs";
import { fromWire } from "./chat.mjs";
import { computeAllPeerTopic, computePaginationTopic, decodeChatRequest, getCurrentDay, unwrapOuterBytes } from "./requests.mjs";

const NEVER = 0xffffffffn;

/** Expiry as the clients build it: expiration seconds (0xffffffff = never) and a sequence. */
export const splitExpiry = (expiry) => {
  const high = expiry >> 32n;
  return { expiry: expiry.toString(), expiresAt: high === NEVER ? null : new Date(Number(high) * 1000).toISOString(), sequence: Number(expiry & 0xffffffffn) };
};

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// ── Labels and keys ──────────────────────────────────────────────────────
// One map from hex (account, topic, channel) to a label; one map from a
// session channel to the context that opens statements on it: the pairwise
// secret for the outer layer and, for multi-device envelopes, an unwrap.

function buildLabels(personas, directory) {
  const labels = new Map(); // hex -> { label, parties }
  const contexts = new Map(); // channel hex -> { kind, secret, unwrap, from, to }
  const openers = new Map(); // request topic hex -> persona (the recipient) | null
  const put = (bytesOrHex, label, parties) => labels.set(normHex(bytesOrHex), { label, parties });

  const account = (bytes) => ({ accountId: createAccountId(bytes), pin: undefined });
  // A session from→to plus its two channels: SessionId(from, to) keyed by `secret`.
  const session = (secret, from, to, label, parties, unwrap = null) => {
    const id = createSessionId(secret, account(from), account(to));
    put(id, label, parties);
    const request = createRequestChannel(id);
    const response = createResponseChannel(id);
    put(request, `${label} /request`, parties);
    put(response, `${label} /response`, parties);
    contexts.set(normHex(request), { kind: "request", secret, unwrap, label });
    contexts.set(normHex(response), { kind: "response", secret, unwrap, label });
  };
  // An envelope our persona device sent: open it the way the SDK reads its
  // own statements back, against any recipient device it was wrapped for.
  const unwrapAsSender = (device, recipients) => {
    const envelope = createEnvelope({ ownStatementAccountId: device.keys.statementAccountId, ownEncryptionPrivateKey: device.keys.encryptionPrivateKey });
    return (payload, devicesInfo) => envelope.unwrapOwn(payload, devicesInfo, recipients);
  };
  // An envelope addressed to our persona: open it with any of its devices.
  const unwrapAsRecipient = (persona, senderEncryptionPublicKey) => {
    const envelopes = persona.devices.map((d) => createEnvelope({ ownStatementAccountId: d.keys.statementAccountId, ownEncryptionPrivateKey: d.keys.encryptionPrivateKey }));
    return (payload, devicesInfo) => {
      let last = null;
      for (const envelope of envelopes) {
        last = envelope.unwrapForOwnDevice(payload, devicesInfo, senderEncryptionPublicKey);
        if (last.isOk()) return last;
      }
      return last;
    };
  };

  // Every registered identity, persona or not: its account and the request
  // topics anyone derives from that account alone.
  const day = getCurrentDay();
  const byAccount = new Map(personas.map((p) => [p.account, p]));
  for (const entry of directory.list()) {
    if (!entry.username) continue;
    put(entry.account, entry.username, [entry.username]);
    const recipient = byAccount.get(entry.account) ?? null;
    const all = computeAllPeerTopic(hexToBytes(entry.account));
    put(all, `request→${entry.username}`, [entry.username]);
    openers.set(normHex(all), recipient);
    if (day) {
      const today = computePaginationTopic(hexToBytes(entry.account), day.day);
      put(today, `request→${entry.username} day ${day.day}`, [entry.username]);
      openers.set(normHex(today), recipient);
    }
  }
  for (const q of personas) {
    put(q.account, q.name, [q.name]);
    for (const d of q.devices) put(d.account, `${q.name}#${d.index}`, [q.name]);
    for (const p of personas) {
      if (p === q) continue;
      const parties = [p.name, q.name];
      // Identity session P→Q: SessionId(P, Q) keyed by K(P, Q). Single-device
      // statements only (the accept and a bot's welcome ride here).
      const identitySecret = x25519.getSharedSecret(p.identity.identityChatPrivateKey, q.identity.identityChatPublicKey);
      session(identitySecret, p.identity.identityAccountId, q.identity.identityAccountId, `identity ${p.name}→${q.name}`, parties);
      // Device session P#i→Q: SessionId(D(P#i), Q) keyed by x25519(D(P#i).priv, Q.chatPub),
      // envelopes wrapped for Q's devices (the persona knows them all).
      for (const d of p.devices) {
        const secret = x25519.getSharedSecret(d.keys.encryptionPrivateKey, q.identity.identityChatPublicKey);
        session(secret, d.keys.statementAccountId, q.identity.identityAccountId, `session ${p.name}#${d.index}→${q.name}`, parties, unwrapAsSender(d, q.devices.map((x) => x.info)));
      }
    }
    // Contacts that are not personas (a bot): both directions from q's keys
    // and the contact's public keys (identity chat key, roster device keys).
    for (const c of q.state.contacts.list()) {
      if (byAccount.has(c.account)) continue;
      const name = c.username;
      const parties = [name, q.name];
      const contactAccount = hexToBytes(c.account);
      const identitySecret = x25519.getSharedSecret(q.identity.identityChatPrivateKey, c.chatPublicKey);
      session(identitySecret, contactAccount, q.identity.identityAccountId, `identity ${name}→${q.name}`, parties);
      session(identitySecret, q.identity.identityAccountId, contactAccount, `identity ${q.name}→${name}`, parties);
      for (const d of q.devices) {
        const secret = x25519.getSharedSecret(d.keys.encryptionPrivateKey, c.chatPublicKey);
        session(secret, d.keys.statementAccountId, contactAccount, `session ${q.name}#${d.index}→${name}`, parties, unwrapAsSender(d, c.devices));
      }
      c.devices.forEach((device, i) => {
        const secret = x25519.getSharedSecret(q.identity.identityChatPrivateKey, device.encryptionPublicKey);
        session(secret, device.statementAccountId, q.identity.identityAccountId, `session ${name}#${i + 1}→${q.name}`, parties, unwrapAsRecipient(q, device.encryptionPublicKey));
      });
    }
  }
  return { labels, contexts, openers };
}

/** A `0x` hex, or a label the inspector prints (`session alice#1→bob /request`), to hex. */
export function resolveHex({ personas, directory }, value) {
  if (value == null) return null;
  if (/^(0x)?[0-9a-f]{64}$/i.test(value)) return normHex(value);
  const { labels } = buildLabels(personas, directory);
  for (const [hex, entry] of labels) if (entry.label === value) return hex;
  return null;
}

// ── Decoding ─────────────────────────────────────────────────────────────

// The wire content, in the inbox's content shape where one exists (text,
// reply, richText, contactAdded...), and a `type` per effect for the rest.
const describeContent = (content) => {
  switch (content.tag) {
    case "deviceChatAccepted":
      return { type: "deviceChatAccepted", requestId: content.value.requestId, device: { statementAccountId: bytesToHex(content.value.device.statementAccountId), encryptionPublicKey: bytesToHex(content.value.device.encryptionPublicKey) } };
    case "deviceAdded":
      return { type: "deviceAdded", statementAccountId: bytesToHex(content.value.statementAccountId), encryptionPublicKey: bytesToHex(content.value.encryptionPublicKey) };
    case "deviceRemoved":
      return { type: "deviceRemoved", statementAccountId: bytesToHex(content.value.statementAccountId) };
    case "chatAccepted":
      return { type: "chatAccepted", requestId: content.value.messageId };
    case "dataChannelOffer":
      return { type: "callOffer", purpose: content.value.purpose, sdpBytes: content.value.sdp.length };
    case "dataChannelClosed":
      return { type: "callDeclined", offerMessageId: content.value.offerMessageId };
    default: {
      const effect = fromWire(content);
      if (effect.kind === "message") return effect.content;
      if (effect.kind === "reaction") return { type: "reaction", messageId: effect.messageId, emoji: effect.emoji, add: effect.add };
      if (effect.kind === "edit") return { type: "edit", messageId: effect.messageId, text: effect.text };
      return { type: content.tag };
    }
  }
};

const describeMessage = (bytes) => {
  try {
    const m = ChatMessageCodec.dec(bytes);
    return { messageId: m.messageId, timestamp: Number(m.timestamp), content: describeContent(m.versioned.value) };
  } catch (error) {
    return { undecodable: true, bytes: bytes.length, error: error?.message ?? String(error) };
  }
};

// The outer layer: the pairwise secret. bot-core wraps its ciphertext in one
// more `Bytes()` (compact length prefix); the SDK does not. Try both.
const decryptOuter = (secret, data) => {
  const encryption = createEncryption(secret);
  const direct = encryption.decrypt(data);
  if (direct.isOk()) return direct.value;
  const inner = unwrapOuterBytes(data);
  if (inner !== data) {
    const wrapped = encryption.decrypt(inner);
    if (wrapped.isOk()) return wrapped.value;
  }
  return null;
};

const decodeSession = (data, context, name) => {
  const plain = decryptOuter(context.secret, data);
  if (!plain) return { kind: "undecryptable" };
  let statementData;
  try { statementData = StatementData.dec(plain); } catch (error) { return { kind: "undecodable", error: error.message }; }
  const recipients = (devicesInfo) => devicesInfo.map((d) => ({ statementAccountId: bytesToHex(d.statementAccountId), label: name(d.statementAccountId) }));
  const open = (payload, devicesInfo) => {
    if (!context.unwrap) return null;
    const unwrapped = context.unwrap(payload, devicesInfo);
    return unwrapped.isOk() ? unwrapped.value : null;
  };
  switch (statementData.tag) {
    case "request":
      return { kind: "request", requestId: statementData.value.requestId, messages: statementData.value.data.map(describeMessage) };
    case "response":
      return { kind: "response", requestId: statementData.value.requestId, responseCode: statementData.value.responseCode };
    case "multiRequest": {
      const { encryptedRequest, devicesInfo } = statementData.value;
      const inner = open(encryptedRequest, devicesInfo);
      if (!inner) return { kind: "request", multiDevice: true, recipients: recipients(devicesInfo), sealed: true };
      const request = Request.dec(inner);
      return { kind: "request", multiDevice: true, recipients: recipients(devicesInfo), requestId: request.requestId, messages: request.data.map(describeMessage) };
    }
    case "multiResponse": {
      const { encryptedResponse, devicesInfo } = statementData.value;
      const inner = open(encryptedResponse, devicesInfo);
      if (!inner) return { kind: "response", multiDevice: true, recipients: recipients(devicesInfo), sealed: true };
      const response = Response.dec(inner);
      return { kind: "response", multiDevice: true, recipients: recipients(devicesInfo), requestId: response.requestId, responseCode: response.responseCode };
    }
    default:
      return { kind: "undecodable" };
  }
};

const decodeOpener = (data, recipient, name) => {
  if (!recipient) return { kind: "chatRequest", sealed: true };
  const decoded = decodeChatRequest(data, recipient.identity.identityAccountId, recipient.identity.identityChatPrivateKey);
  if (!decoded) return { kind: "chatRequest", undecodable: true };
  const senderIdentity = bytesToHex(decoded.senderIdentityAccountId);
  return {
    kind: "chatRequest",
    requestId: decoded.requestId,
    timestamp: decoded.timestamp,
    welcome: decoded.welcomeMessage,
    sender: { account: senderIdentity, label: name(senderIdentity), device: decoded.senderDevice ? bytesToHex(decoded.senderDevice.statementAccountId) : null },
  };
};

// ── The view ─────────────────────────────────────────────────────────────

function describeAll({ node, personas, directory }, entries) {
  const { labels, contexts, openers } = buildLabels(personas, directory);
  const name = (hex) => labels.get(normHex(hex))?.label ?? null;
  const parties = (hex) => labels.get(normHex(hex))?.parties ?? [];

  const rows = entries.map((s) => {
    const topics = s.topics.map((t) => ({ hex: normHex(t), label: name(t) }));
    const involved = new Set([...parties(s.signer ?? ""), ...(s.channel ? parties(s.channel) : []), ...s.topics.flatMap(parties)]);
    const openerTopic = s.topics.find((t) => openers.has(normHex(t)));
    const context = s.channel ? contexts.get(normHex(s.channel)) : null;
    // A request statement rides the recipient's discovery topics with a
    // channel only the two parties can derive; say so instead of "unknown".
    const channelLabel = s.channel ? name(s.channel) ?? (openerTopic ? "chat request" : null) : null;
    const data = hexToBytes(`0x${s.data}`);
    const decoded = context ? decodeSession(data, context, name) : openerTopic ? decodeOpener(data, openers.get(normHex(openerTopic)), name) : null;
    return {
      signer: s.signer ? normHex(s.signer) : null,
      signerLabel: s.signer ? name(s.signer) : null,
      channel: s.channel ? normHex(s.channel) : null,
      channelLabel,
      topics,
      ...splitExpiry(s.expiry),
      bytes: (s.hex.length - 2) / 2,
      receivedAt: iso(s.receivedAt),
      replacedCount: s.replacedCount,
      replacedAt: iso(s.replacedAt),
      reason: s.reason,
      parties: [...involved],
      decoded,
      hex: s.hex,
    };
  });
  // ACK state: every response (live or replaced) that names a request id,
  // attached to the request statements carrying that id. A persona ACKs from
  // each of its devices on that device's own channel, so a request may hold
  // several ACKs; the store keeps only the newest per channel, so older ones
  // come from the slot history.
  const acks = new Map();
  for (const row of rows) {
    const d = row.decoded;
    if (d?.kind !== "response" || !d.requestId) continue;
    const list = acks.get(d.requestId) ?? [];
    list.push({ by: row.signerLabel ?? row.signer, code: d.responseCode, at: row.receivedAt, live: row.replacedAt == null });
    acks.set(d.requestId, list);
  }
  for (const row of rows) {
    if (row.decoded?.kind === "request" && row.decoded.requestId) row.acks = acks.get(row.decoded.requestId) ?? [];
  }
  return rows;
}

/**
 * Decoded statements with labels. `peer` keeps statements a persona signed or
 * is addressed by; `signer` keeps one account's; `topic` one topic's;
 * `channel` one slot's. Set `raw` to include the statement hex.
 */
// ACKs sit on other channels than the requests they answer, so the whole
// store (history included) is decoded before any filter applies.
const describeStore = (deps) => describeAll(deps, [...deps.node.history(), ...deps.node.list()]);
const selects = ({ topic, signer, channel, peer }) => (s) =>
  (topic == null || s.topics.some((t) => t.hex === normHex(topic)))
  && (signer == null || s.signer === normHex(signer))
  && (channel == null || s.channel === normHex(channel))
  && (peer == null || s.parties.includes(String(peer)));

export function inspectWire(deps, { topic = null, signer = null, peer = null, channel = null, raw = false } = {}) {
  return describeStore(deps)
    .filter((s) => s.replacedAt == null)
    .filter(selects({ topic, signer, channel, peer }))
    .map(({ hex, replacedAt: _r, reason: _n, ...s }) => (raw ? { ...s, hex } : s));
}

/** One slot's history, oldest first, the live statement last (`replacedAt: null`). */
export function inspectHistory(deps, { channel, signer = null, raw = false }) {
  return describeStore(deps)
    .filter(selects({ channel, signer }))
    .sort((a, b) => (a.replacedAt == null ? 1 : b.replacedAt == null ? -1 : Date.parse(a.replacedAt) - Date.parse(b.replacedAt)))
    .map(({ hex, ...s }) => (raw ? { ...s, hex } : s));
}

export { bytesToHex };
