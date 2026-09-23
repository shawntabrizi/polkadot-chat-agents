// Spec 0005 typing and seen (polkadot-chat-desktop docs/spec/0005-typing-and-seen.md),
// the sender side. Both signals are EPHEMERAL: they ride the peer's outbound
// lane like any message, but they are never journaled as an owed answer, never
// re-sent after a restart, and never kept once the lane lets go of them.
//
//  - typing{working}: sent when a brain turn starts, refreshed while it runs
//    (each hint lives TYPING_TTL_MS), superseded by the real reply while it is
//    still un-ACKed, and closed by typing{stopped} only when the turn ends
//    without a reply. Never more than one typing per TYPING_MIN_INTERVAL_MS
//    per peer (the spec's rate limit).
//  - seen{upTo}: sent when the brain consumes a peer's message, batched to at
//    most one per SEEN_MIN_INTERVAL_MS per peer, carrying the latest id.
//
// A refresh is skipped while an earlier typing to the peer is still un-ACKed:
// a peer that has not fetched the last hint gains nothing from the next one,
// and every in-slot replacement spends one of the lane's extensions, which a
// non-ACKing peer would otherwise use up with hints alone.

import { TYPING_KINDS } from "../vendor/app-chat-codec.mjs";

export const TYPING_TTL_MS = 6_000;
export const TYPING_MIN_INTERVAL_MS = 4_000;
export const SEEN_MIN_INTERVAL_MS = 2_000;
// With typing on, the live placeholder waits this long before it appears: the
// typing indicator covers a normal turn, and the client must not show a
// thinking row and a typing indicator for the same wait.
export const TYPING_PLACEHOLDER_AFTER_MS = 20_000;

const defaultTimers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clear: (t) => clearTimeout(t),
};

// enqueue(peerHex, opaque, { messageId, supersedes }) -> { submitted, delivered }
//   (the outbound lane). encodeTyping / encodeSeen: the codec encoders.
// stamp(peerHex) -> envelope timestamp. maxTurnMs: a turn that never ends
// (a bridge harness that never answers) stops refreshing after this long.
export const createTypingAndSeen = ({
  typing = true,
  seen = true,
  enqueue,
  encodeTyping,
  encodeSeen,
  makeId,
  stamp = () => Date.now(),
  now = () => Date.now(),
  timers = defaultTimers,
  maxTurnMs = 600_000,
  maxPeers = 10_000,
  log = () => {},
}) => {
  const peers = new Map(); // peerHex -> state
  const stateFor = (peerHex) => {
    let s = peers.get(peerHex);
    if (!s) {
      s = {
        turn: null, // { startedAt, sent, logged } while a turn runs
        typingAt: null, // when the last typing went to the lane
        typingTimer: null,
        typingIds: new Set(), // our typing entries the peer has not ACKed yet
        seenAt: null,
        seenTimer: null,
        seenUpTo: null,
        seenIds: new Set(),
      };
      peers.set(peerHex, s);
      if (peers.size > maxPeers) {
        for (const [k, v] of peers) {
          if (k !== peerHex && !v.turn && !v.typingTimer && !v.seenTimer) { peers.delete(k); break; }
        }
      }
    }
    return s;
  };
  const clearTyping = (s) => { if (s.typingTimer) { timers.clear(s.typingTimer); s.typingTimer = null; } };

  // One ephemeral entry into the lane. `ids` tracks it until the lane settles
  // it (ACKed, superseded or failed), so a later entry can supersede it.
  const put = (peerHex, opaque, messageId, ids, event) => {
    const supersedes = [...ids];
    ids.add(messageId);
    const { submitted, delivered } = enqueue(peerHex, opaque, { messageId, supersedes });
    Promise.resolve(delivered).then(() => ids.delete(messageId), () => ids.delete(messageId));
    Promise.resolve(submitted).catch((e) => log(event, { to: peerHex, error: String(e?.message ?? e) }));
  };

  const sendTyping = (peerHex, s, kind) => {
    const at = now();
    const messageId = makeId();
    const opaque = encodeTyping({ messageId, timestamp: stamp(peerHex), until: at + TYPING_TTL_MS, kind });
    put(peerHex, opaque, messageId, s.typingIds, "BOT_TYPING_FAILED");
    s.typingAt = at;
  };

  // One refresh tick of a running turn.
  const tick = (peerHex, s) => {
    s.typingTimer = null;
    if (!s.turn) return;
    if (now() - s.turn.startedAt >= maxTurnMs) { endTurn(peerHex); return; }
    const wait = s.typingAt == null ? 0 : s.typingAt + TYPING_MIN_INTERVAL_MS - now();
    if (wait > 0) { s.typingTimer = timers.set(() => tick(peerHex, s), wait); return; }
    if (s.typingIds.size === 0) {
      sendTyping(peerHex, s, TYPING_KINDS.working);
      s.turn.sent = true;
      if (!s.turn.logged) { s.turn.logged = true; log("BOT_SENT_TYPING", { to: peerHex, kind: "working" }); }
    }
    s.typingTimer = timers.set(() => tick(peerHex, s), TYPING_MIN_INTERVAL_MS);
  };

  const endTurn = (peerHex) => {
    const s = peers.get(peerHex);
    if (!s?.turn) return;
    const { sent } = s.turn;
    s.turn = null;
    clearTyping(s);
    if (!sent) return; // the peer never got a hint: nothing to close
    const close = () => {
      s.typingTimer = null;
      if (s.turn) return; // a new turn started; its own hint replaces this one
      sendTyping(peerHex, s, TYPING_KINDS.stopped);
      log("BOT_SENT_TYPING", { to: peerHex, kind: "stopped" });
    };
    const wait = s.typingAt + TYPING_MIN_INTERVAL_MS - now();
    if (wait > 0) s.typingTimer = timers.set(close, wait);
    else close();
  };

  const flushSeen = (peerHex, s) => {
    s.seenTimer = null;
    const upTo = s.seenUpTo;
    s.seenUpTo = null;
    if (!upTo) return;
    const at = now();
    const messageId = makeId();
    const opaque = encodeSeen({ messageId, timestamp: stamp(peerHex), upTo, at });
    // An older un-ACKed seen is redundant: upTo covers everything before it.
    put(peerHex, opaque, messageId, s.seenIds, "BOT_SEEN_FAILED");
    s.seenAt = at;
    log("BOT_SENT_SEEN", { to: peerHex, upTo });
  };

  return {
    // A brain turn for peerHex starts.
    turnStarted(peerHex) {
      if (!typing) return;
      const s = stateFor(peerHex);
      clearTyping(s); // also cancels a pending `stopped` of the previous turn
      s.turn = { startedAt: now(), sent: false, logged: false };
      tick(peerHex, s);
    },
    // A real message to peerHex is about to enter the lane. Ends the turn's
    // typing (the message itself clears the indicator; no `stopped`) and
    // returns our un-ACKed typing ids for the message to supersede.
    replyGoingOut(peerHex) {
      const s = peers.get(peerHex);
      if (!s) return [];
      s.turn = null;
      clearTyping(s);
      return [...s.typingIds];
    },
    // The turn ended. Without a reply before it, the hint is closed with
    // typing{stopped} (once the rate limit allows).
    turnEnded(peerHex) { endTurn(peerHex); },
    // The brain consumed the peer's message `messageId`.
    consumed(peerHex, messageId) {
      if (!seen || !messageId) return;
      const s = stateFor(peerHex);
      s.seenUpTo = messageId;
      if (s.seenTimer) return; // the pending batch takes the latest id
      const wait = s.seenAt == null ? 0 : s.seenAt + SEEN_MIN_INTERVAL_MS - now();
      if (wait > 0) s.seenTimer = timers.set(() => flushSeen(peerHex, s), wait);
      else flushSeen(peerHex, s);
    },
    // Introspection for tests.
    typingActive: (peerHex) => Boolean(peers.get(peerHex)?.turn),
  };
};
