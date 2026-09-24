// Spec 0005 typing and seen (polkadot-chat-desktop docs/spec/0005-typing-and-seen.md,
// revision 2026-09-23 for submission cost, see docs/spec/efficiency.md), the
// sender side. Both signals are EPHEMERAL: they ride the peer's outbound lane
// like any message, but they are never journaled as an owed answer, never
// re-sent after a restart, and never kept once the lane lets go of them.
//
// Every standalone signal is one Statement Store submission, and a 1:1
// conversation must cost one submission per message. So:
//
//  - typing: a bot does NOT send it. It is off by default
//    (BOT_PROTOCOL_EXTENSIONS leaves it out); the client shows a local
//    "working" state for a peer it knows is a bot. The code below runs only
//    when an operator names `typing` explicitly: typing{working} when a brain
//    turn starts, refreshed while it runs (each hint lives TYPING_TTL_MS, at
//    most one per TYPING_MIN_INTERVAL_MS per peer, the spec's opt-in limit),
//    superseded by the real reply while still un-ACKed, and closed by
//    typing{stopped} only when the turn ends without a reply.
//  - seen{upTo}: when the brain consumes a peer's message, the seen WAITS up
//    to SEEN_INTERVAL_MS. A real message to that peer inside the window takes
//    it along: the seen enters the lane in the same tick as the message, so
//    both ride one request statement (one submission). Without a message, it
//    goes out alone at the end of the window, carrying the latest id.
//
// A typing refresh is skipped while an earlier typing to the peer is still
// un-ACKed: a peer that has not fetched the last hint gains nothing from the
// next one, and every in-slot replacement spends one of the lane's extensions.

import { TYPING_KINDS } from "../vendor/app-chat-codec.mjs";

// The spec's opt-in limits: at most one typing per 10 s per peer, until = now + 12 s.
export const TYPING_TTL_MS = 12_000;
export const TYPING_MIN_INTERVAL_MS = 10_000;
// A pending seen waits this long for a real message to ride on.
export const SEEN_INTERVAL_MS = 5_000;
// The live placeholder ("thinking" row) waits this long before it appears
// when the client can show its own "working" state (it knows the bot from
// botInfo, or typing is on): a client must not show a thinking row and a
// working indicator for the same wait.
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

  // piggyback: true when a real message enters the lane in this same tick.
  const flushSeen = (peerHex, s, { piggyback = false } = {}) => {
    if (s.seenTimer) { timers.clear(s.seenTimer); s.seenTimer = null; }
    const upTo = s.seenUpTo;
    s.seenUpTo = null;
    if (!upTo) return;
    const at = now();
    const messageId = makeId();
    const opaque = encodeSeen({ messageId, timestamp: stamp(peerHex), upTo, at });
    // An older un-ACKed seen is redundant: upTo covers everything before it.
    put(peerHex, opaque, messageId, s.seenIds, "BOT_SEEN_FAILED");
    log("BOT_SENT_SEEN", { to: peerHex, upTo, ...(piggyback ? { withMessage: true } : {}) });
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
    // A real message to peerHex is about to enter the lane (the caller
    // enqueues it synchronously after this call). A pending seen enters the
    // lane now, so it rides the same statement. Ends the turn's typing (the
    // message itself clears the indicator; no `stopped`) and returns our
    // un-ACKed typing ids for the message to supersede.
    replyGoingOut(peerHex) {
      const s = peers.get(peerHex);
      if (!s) return [];
      if (s.seenUpTo) flushSeen(peerHex, s, { piggyback: true });
      s.turn = null;
      clearTyping(s);
      return [...s.typingIds];
    },
    // The turn ended. Without a reply before it, the hint is closed with
    // typing{stopped} (once the rate limit allows).
    turnEnded(peerHex) { endTurn(peerHex); },
    // The brain consumed the peer's message `messageId`. The seen waits for
    // a reply to ride on, or goes alone after SEEN_INTERVAL_MS.
    consumed(peerHex, messageId) {
      if (!seen || !messageId) return;
      const s = stateFor(peerHex);
      s.seenUpTo = messageId;
      if (s.seenTimer) return; // the pending seen takes the latest id
      s.seenTimer = timers.set(() => { s.seenTimer = null; flushSeen(peerHex, s); }, SEEN_INTERVAL_MS);
    },
    // Introspection for tests.
    typingActive: (peerHex) => Boolean(peers.get(peerHex)?.turn),
  };
};
