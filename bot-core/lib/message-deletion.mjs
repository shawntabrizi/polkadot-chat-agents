// RFC-0003 message deletion (chat-spec rfcs/0003-message-deletion.md).
//
// Small pieces, kept apart from index.mjs so the rules are unit-tested:
//  - createDeletionLedger: the recipient's per-peer tombstones and pending
//    deletions (a deletion may arrive before its target).
//  - parseProtocolExtensions: which extension kinds the bot SENDS
//    (BOT_PROTOCOL_EXTENSIONS). Development-mode rule of the desktop spec set
//    (polkadot-chat-desktop docs/spec/README.md): every client is in
//    development, so extensions go to every peer without gating; an old client
//    shows the base spec's "unsupported message" for a kind it does not know.
//  - createExtensionObserver: which peers have sent an extension kind. A log
//    only; it enables nothing.
//  - createMessageDeleter: the sender side of one retraction, on top of the
//    outbound lanes.

// Extensions the bot can send. BOT_PROTOCOL_EXTENSIONS unset = all of them.
export const PROTOCOL_EXTENSIONS = Object.freeze(["deleted", "buttons", "typing", "seen", "botinfo"]);

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

// unset or "" -> every extension; "none" -> no extension; "deleted,foo" ->
// { enabled: Set(["deleted"]), unknown: ["foo"] }.
export const parseProtocolExtensions = (raw) => {
  const value = String(raw ?? "").trim();
  if (value === "") return { enabled: new Set(PROTOCOL_EXTENSIONS), unknown: [] };
  if (value === "none") return { enabled: new Set(), unknown: [] };
  const names = value.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    enabled: new Set(names.filter((n) => PROTOCOL_EXTENSIONS.includes(n))),
    unknown: names.filter((n) => !PROTOCOL_EXTENSIONS.includes(n)),
  };
};

// observe(peerHex, name) is true the first time a peer sends that extension
// (in this process), so the caller logs it once. Not persisted: it gates nothing.
export const createExtensionObserver = ({ maxPeers = 10_000 } = {}) => {
  const seen = new Map(); // peerHex -> Set<name>
  return {
    observe(peerHex, name) {
      if (seen.get(peerHex)?.has(name)) return false;
      boundedMap(seen, peerHex, () => new Set(), maxPeers).add(name);
      return true;
    },
  };
};

// Retract one of the bot's own messages to peerHex (RFC-0003 sender flow):
//  1. still queued, never submitted -> remove it; nothing goes on the wire;
//  2. in the un-ACKed statement      -> the deletion rides a re-encoded batch
//     that no longer carries it (lane `supersedes`);
//  3. possibly fetched               -> send `deleted` to the peer.
// Cases 2 and 3 need the deletion message, so they happen only when the
// `deleted` extension is on (BOT_PROTOCOL_EXTENSIONS). Otherwise nothing is sent.
// Resolves { outcome: "unsent" | "sent" | "unsupported", messageId?, delivered? }.
export const createMessageDeleter = ({ outbound, enabled = true, encode, makeId, stamp = () => Date.now(), log = () => {} }) =>
  async (peerHex, targetId) => {
    const where = outbound.drop(peerHex, targetId);
    if (where === "queued") {
      log("BOT_DELETE_UNSENT", { to: peerHex, target: targetId });
      return { outcome: "unsent" };
    }
    if (!enabled) {
      log("BOT_DELETE_SKIPPED", { to: peerHex, target: targetId, reason: "the deleted extension is off (BOT_PROTOCOL_EXTENSIONS)" });
      return { outcome: "unsupported" };
    }
    const messageId = makeId();
    const opaque = encode({ messageId, timestamp: stamp(peerHex), targetMessageId: targetId });
    const { submitted, delivered } = outbound.enqueue(peerHex, opaque, { messageId, supersedes: [targetId] });
    await submitted;
    log("BOT_SENT_DELETED", { to: peerHex, target: targetId, ...(where === "current" ? { droppedFromSlot: true } : {}) });
    return { outcome: "sent", messageId, delivered };
  };
