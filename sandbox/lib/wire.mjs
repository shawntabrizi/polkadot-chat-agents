// The wire inspector's read side: every statement the node holds, with the
// names the sandbox can put on it. The sandbox holds every persona's keys,
// so it can derive the same session ids and channels the clients derive
// (identity session, per-device session, request topics) and label a topic
// like `session alice#1→bob` instead of 32 opaque bytes. A contact it holds
// no keys for (a bot-core bot) is still labelled from the other side: every
// session shares a secret with one of our personas, so K(alice, bot) and the
// bot's device sessions derive from alice's keys plus the bot's public keys
// in her roster, and the bot's signer gets its directory username.
//
// Decrypted payloads and ACK-state matching are S3 (PLAN.md).

import { x25519 } from "@noble/curves/ed25519.js";
import { createAccountId, createRequestChannel, createResponseChannel, createSessionId } from "@novasamatech/statement-store";

import { bytesToHex, hexToBytes, normHex } from "./bytes.mjs";
import { computeAllPeerTopic, computePaginationTopic, getCurrentDay } from "./requests.mjs";

const NEVER = 0xffffffffn;

/** Expiry as the clients build it: expiration seconds (0xffffffff = never) and a sequence. */
export const splitExpiry = (expiry) => {
  const high = expiry >> 32n;
  return { expiry: expiry.toString(), expiresAt: high === NEVER ? null : new Date(Number(high) * 1000).toISOString(), sequence: Number(expiry & 0xffffffffn) };
};

/** hex -> { label, parties: [persona names] } for every account, topic and channel the personas use. */
function buildLabels(personas, directory) {
  const labels = new Map();
  const put = (bytesOrHex, label, parties) => labels.set(normHex(bytesOrHex), { label, parties });

  const account = (bytes) => ({ accountId: createAccountId(bytes), pin: undefined });
  // A session from→to plus its two channels: SessionId(from, to) keyed by `secret`.
  const session = (secret, from, to, label, parties) => {
    const id = createSessionId(secret, account(from), account(to));
    put(id, label, parties);
    put(createRequestChannel(id), `${label} /request`, parties);
    put(createResponseChannel(id), `${label} /response`, parties);
  };

  // Every registered identity, persona or not: its account and the request
  // topics anyone derives from that account alone.
  const day = getCurrentDay();
  for (const entry of directory.list()) {
    if (!entry.username) continue;
    put(entry.account, entry.username, [entry.username]);
    put(computeAllPeerTopic(hexToBytes(entry.account)), `request→${entry.username}`, [entry.username]);
    if (day) put(computePaginationTopic(hexToBytes(entry.account), day.day), `request→${entry.username} day ${day.day}`, [entry.username]);
  }
  const personaAccounts = new Set(personas.map((p) => p.account));
  for (const q of personas) {
    put(q.account, q.name, [q.name]);
    for (const d of q.devices) put(d.account, `${q.name}#${d.index}`, [q.name]);
    for (const p of personas) {
      if (p === q) continue;
      const parties = [p.name, q.name];
      // Identity session P→Q: SessionId(P, Q) keyed by K(P, Q).
      const identitySecret = x25519.getSharedSecret(p.identity.identityChatPrivateKey, q.identity.identityChatPublicKey);
      session(identitySecret, p.identity.identityAccountId, q.identity.identityAccountId, `identity ${p.name}→${q.name}`, parties);
      // Device session P#i→Q: SessionId(D(P#i), Q) keyed by x25519(D(P#i).priv, Q.chatPub).
      for (const d of p.devices) {
        const secret = x25519.getSharedSecret(d.keys.encryptionPrivateKey, q.identity.identityChatPublicKey);
        session(secret, d.keys.statementAccountId, q.identity.identityAccountId, `session ${p.name}#${d.index}→${q.name}`, parties);
      }
    }
    // Contacts that are not personas (a bot): both directions from q's keys
    // and the contact's public keys (identity chat key, roster device keys).
    for (const c of q.state.contacts.list()) {
      if (personaAccounts.has(c.account)) continue;
      const name = c.username;
      const parties = [name, q.name];
      const contactAccount = hexToBytes(c.account);
      const identitySecret = x25519.getSharedSecret(q.identity.identityChatPrivateKey, c.chatPublicKey);
      session(identitySecret, contactAccount, q.identity.identityAccountId, `identity ${name}→${q.name}`, parties);
      session(identitySecret, q.identity.identityAccountId, contactAccount, `identity ${q.name}→${name}`, parties);
      for (const d of q.devices) {
        const secret = x25519.getSharedSecret(d.keys.encryptionPrivateKey, c.chatPublicKey);
        session(secret, d.keys.statementAccountId, contactAccount, `session ${q.name}#${d.index}→${name}`, parties);
      }
      c.devices.forEach((device, i) => {
        const secret = x25519.getSharedSecret(q.identity.identityChatPrivateKey, device.encryptionPublicKey);
        session(secret, device.statementAccountId, q.identity.identityAccountId, `session ${name}#${i + 1}→${q.name}`, parties);
      });
    }
  }
  return labels;
}

/**
 * Decoded statements with labels. `peer` keeps statements a persona signed or
 * is addressed by; `signer` keeps one account's; `topic` one topic's.
 */
export function inspectWire({ node, personas, directory }, { topic = null, signer = null, peer = null, raw = false } = {}) {
  const labels = buildLabels(personas, directory);
  const name = (hex) => labels.get(normHex(hex))?.label ?? null;
  const parties = (hex) => labels.get(normHex(hex))?.parties ?? [];
  const wanted = peer == null ? null : String(peer);

  return node.list({ topic, signer })
    .map((s) => {
      const topics = s.topics.map((t) => ({ hex: normHex(t), label: name(t) }));
      const involved = new Set([...parties(s.signer ?? ""), ...(s.channel ? parties(s.channel) : []), ...s.topics.flatMap(parties)]);
      // A request statement rides the recipient's discovery topics with a
      // channel only the two parties can derive; say so instead of "unknown".
      const channelLabel = s.channel ? name(s.channel) ?? (topics.some((t) => t.label?.startsWith("request→")) ? "chat request" : null) : null;
      return {
        signer: s.signer ? normHex(s.signer) : null,
        signerLabel: s.signer ? name(s.signer) : null,
        channel: s.channel ? normHex(s.channel) : null,
        channelLabel,
        topics,
        ...splitExpiry(s.expiry),
        bytes: (s.hex.length - 2) / 2,
        receivedAt: new Date(s.receivedAt).toISOString(),
        replacedCount: s.replacedCount,
        parties: [...involved],
        ...(raw ? { hex: s.hex } : {}),
      };
    })
    .filter((s) => wanted == null || s.parties.includes(wanted));
}

export { bytesToHex };
