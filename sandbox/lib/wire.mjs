// The wire inspector's read side: every statement the node holds, with the
// names the sandbox can put on it. The sandbox holds every persona's keys,
// so it can derive the same session ids and channels the clients derive
// (identity session, per-device session, request topics) and label a topic
// like `session alice#1→bob` instead of 32 opaque bytes. Accounts it does
// not hold keys for (a bot-core bot) get their directory username only.
//
// Decrypted payloads and ACK-state matching are S3 (PLAN.md).

import { x25519 } from "@noble/curves/ed25519.js";
import { createAccountId, createRequestChannel, createResponseChannel, createSessionId } from "@novasamatech/statement-store";

import { bytesToHex, normHex } from "./bytes.mjs";
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

  for (const entry of directory.list()) {
    if (entry.username) put(entry.account, entry.username, [entry.username]);
  }
  const day = getCurrentDay();
  for (const q of personas) {
    put(q.account, q.name, [q.name]);
    for (const d of q.devices) put(d.account, `${q.name}#${d.index}`, [q.name]);
    put(computeAllPeerTopic(q.identity.identityAccountId), `request→${q.name}`, [q.name]);
    if (day) put(computePaginationTopic(q.identity.identityAccountId, day.day), `request→${q.name} day ${day.day}`, [q.name]);
    for (const p of personas) {
      if (p === q) continue;
      const parties = [p.name, q.name];
      const account = (bytes) => ({ accountId: createAccountId(bytes), pin: undefined });
      // Identity session P→Q: SessionId(P, Q) keyed by K(P, Q).
      const identitySecret = x25519.getSharedSecret(p.identity.identityChatPrivateKey, q.identity.identityChatPublicKey);
      const identitySession = createSessionId(identitySecret, account(p.identity.identityAccountId), account(q.identity.identityAccountId));
      put(identitySession, `identity ${p.name}→${q.name}`, parties);
      put(createRequestChannel(identitySession), `identity ${p.name}→${q.name} /request`, parties);
      put(createResponseChannel(identitySession), `identity ${p.name}→${q.name} /response`, parties);
      // Device session P#i→Q: SessionId(D(P#i), Q) keyed by x25519(D(P#i).priv, Q.chatPub).
      for (const d of p.devices) {
        const secret = x25519.getSharedSecret(d.keys.encryptionPrivateKey, q.identity.identityChatPublicKey);
        const session = createSessionId(secret, account(d.keys.statementAccountId), account(q.identity.identityAccountId));
        put(session, `session ${p.name}#${d.index}→${q.name}`, parties);
        put(createRequestChannel(session), `session ${p.name}#${d.index}→${q.name} /request`, parties);
        put(createResponseChannel(session), `session ${p.name}#${d.index}→${q.name} /response`, parties);
      }
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
