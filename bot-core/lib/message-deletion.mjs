// RFC-0003 message deletion (chat-spec rfcs/0003-message-deletion.md).
//
// Three small pieces, kept apart from index.mjs so the rules are unit-tested:
//  - createDeletionLedger: the recipient's per-peer tombstones and pending
//    deletions (a deletion may arrive before its target).
//  - createExtensionGate: may the bot SEND a protocol extension to a peer?
//    Phone clients that predate an extension render its kind as an
//    "unsupported message" bubble, so the bot sends one only to a peer that
//    has proven support by sending that kind itself (buttons: any extension
//    kind), or when the operator enables it for everyone
//    (BOT_PROTOCOL_EXTENSIONS).
//  - createMessageDeleter: the sender side of one retraction, on top of the
//    outbound lanes.

// Extensions the operator may force on with BOT_PROTOCOL_EXTENSIONS.
export const PROTOCOL_EXTENSIONS = Object.freeze(["deleted", "buttons"]);
// Evidence names the gate records: an extension's own kind, or "extension"
// for any other provisional kind (240-249) the peer sent.
export const EXTENSION_EVIDENCE = Object.freeze(["deleted", "buttons", "extension"]);
// Which evidence enables SENDING an extension. `deleted` keeps its RFC-0003
// rule (the peer sent a deletion). `buttons` follows the desktop spec set's
// rule (spec 0006): any extension kind from that peer (21 or 240+) proves the
// client renders kinds it did not ship with.
const ENABLED_BY = Object.freeze({ deleted: ["deleted"], buttons: EXTENSION_EVIDENCE });

// The RFC lets an implementation bound the pending set per peer; eviction is
// safe (a deletion whose target never arrives has no effect).
export const DELETION_CAP_PER_PEER = 500;

// Insertion-ordered set with a ceiling: re-adding refreshes, overflow evicts
// the oldest.
const addBounded = (set, value, cap) => {
  set.delete(value);
  set.add(value);
  while (set.size > cap) set.delete(set.values().next().value);
};
const boundedMap = (map, key, make, cap) => {
  let value = map.get(key);
  if (value == null) {
    value = make();
    map.set(key, value);
    while (map.size > cap) map.delete(map.keys().next().value);
  }
  return value;
};
const ids = (value, cap) => (Array.isArray(value) ? value.filter((x) => typeof x === "string").slice(-cap) : []);

export const createDeletionLedger = ({ cap = DELETION_CAP_PER_PEER, maxPeers = 10_000 } = {}) => {
  const peers = new Map(); // peerHex -> { done: Set<messageId>, pending: Set<messageId> }
  const entry = (peerHex) => boundedMap(peers, peerHex, () => ({ done: new Set(), pending: new Set() }), maxPeers);
  const isDeleted = (peerHex, messageId) => {
    const e = peers.get(peerHex);
    return Boolean(e && (e.done.has(messageId) || e.pending.has(messageId)));
  };
  return {
    // A deletion from peerHex for targetId. `known`: the bot has received
    // targetId from THIS peer (the caller checks its per-peer receive record,
    // which is the RFC's authorization rule). An unknown target may still be
    // on its way, or may be the bot's own or another peer's message: either
    // way it only lands in this peer's pending set, which can never touch a
    // message that did not come from this peer.
    record(peerHex, targetId, { known }) {
      if (isDeleted(peerHex, targetId)) return "duplicate";
      const e = entry(peerHex);
      if (known) { addBounded(e.done, targetId, cap); return "applied"; }
      addBounded(e.pending, targetId, cap);
      return "pending";
    },
    // A message from peerHex arrived. True when a deletion for it was already
    // processed: the caller must drop it (never show it, never answer it).
    arrived(peerHex, messageId) {
      const e = peers.get(peerHex);
      if (!e || !messageId) return false;
      if (e.done.has(messageId)) return true;
      if (!e.pending.delete(messageId)) return false;
      addBounded(e.done, messageId, cap);
      return true;
    },
    // Deletion is terminal: an edit of a deleted message must be ignored.
    isDeleted,
    snapshot(peerHex) {
      const e = peers.get(peerHex);
      if (!e || (e.done.size === 0 && e.pending.size === 0)) return null;
      return { d: [...e.done], p: [...e.pending] };
    },
    restore(peerHex, saved) {
      if (!saved || typeof saved !== "object") return;
      const e = entry(peerHex);
      for (const id of ids(saved.d, cap)) addBounded(e.done, id, cap);
      for (const id of ids(saved.p, cap)) addBounded(e.pending, id, cap);
    },
  };
};

// "deleted,foo" -> { enabled: Set(["deleted"]), unknown: ["foo"] }
export const parseProtocolExtensions = (raw) => {
  const names = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    enabled: new Set(names.filter((n) => PROTOCOL_EXTENSIONS.includes(n))),
    unknown: names.filter((n) => !PROTOCOL_EXTENSIONS.includes(n)),
  };
};

export const createExtensionGate = ({ forced = new Set(), maxPeers = 10_000 } = {}) => {
  const evidence = new Map(); // peerHex -> Set<extension>
  return {
    enabled: (peerHex, extension) => forced.has(extension)
      || (ENABLED_BY[extension] ?? []).some((name) => evidence.get(peerHex)?.has(name)),
    // The peer sent us this extension's kind. True only the first time, so
    // the caller logs and persists once.
    observe(peerHex, extension) {
      if (evidence.get(peerHex)?.has(extension)) return false;
      boundedMap(evidence, peerHex, () => new Set(), maxPeers).add(extension);
      return true;
    },
    snapshot: (peerHex) => {
      const set = evidence.get(peerHex);
      return set?.size ? [...set] : null;
    },
    restore(peerHex, saved) {
      for (const extension of ids(saved, EXTENSION_EVIDENCE.length)) {
        if (EXTENSION_EVIDENCE.includes(extension)) boundedMap(evidence, peerHex, () => new Set(), maxPeers).add(extension);
      }
    },
  };
};

// Retract one of the bot's own messages to peerHex (RFC-0003 sender flow):
//  1. still queued, never submitted -> remove it; nothing goes on the wire;
//  2. in the un-ACKed statement      -> the deletion rides a re-encoded batch
//     that no longer carries it (lane `supersedes`);
//  3. possibly fetched               -> send `deleted` to the peer.
// Cases 2 and 3 need the deletion message, so they happen only when the gate
// allows the extension for this peer. Otherwise nothing is sent: an
// unsupported bubble on the phone is worse than a message left in place.
// Resolves { outcome: "unsent" | "sent" | "unsupported", messageId?, delivered? }.
export const createMessageDeleter = ({ outbound, gate, encode, makeId, stamp = () => Date.now(), log = () => {} }) =>
  async (peerHex, targetId) => {
    const where = outbound.drop(peerHex, targetId);
    if (where === "queued") {
      log("BOT_DELETE_UNSENT", { to: peerHex, target: targetId });
      return { outcome: "unsent" };
    }
    if (!gate.enabled(peerHex, "deleted")) {
      log("BOT_DELETE_SKIPPED", { to: peerHex, target: targetId, reason: "peer has not shown RFC-0003 support" });
      return { outcome: "unsupported" };
    }
    const messageId = makeId();
    const opaque = encode({ messageId, timestamp: stamp(peerHex), targetMessageId: targetId });
    const { submitted, delivered } = outbound.enqueue(peerHex, opaque, { messageId, supersedes: [targetId] });
    await submitted;
    log("BOT_SENT_DELETED", { to: peerHex, target: targetId, ...(where === "current" ? { droppedFromSlot: true } : {}) });
    return { outcome: "sent", messageId, delivered };
  };
