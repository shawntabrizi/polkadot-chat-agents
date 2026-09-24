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
//  - seen{upTo}: the seen of a peer's message RIDES THE REPLY. It enters the
//    lane in the same tick as the next real message to that peer (the reply,
//    an error fallback, a greeting, a command answer), so both ride one
//    request statement (one submission). While the message is being handled
//    (the `release` that consumed() returns is not called yet) or a brain
//    turn runs for the peer, no standalone seen goes out, whatever the delay:
//    a real model takes about 10 s, and a seen alone at 5 s plus the reply at
//    10 s was two submissions per reply. The client's local "working" state
//    covers the wait. A standalone seen goes out only when the message
//    started no turn and got no reply, and only SEEN_INTERVAL_MS after it was
//    consumed (or when the handling or turn ends, if that is later). A turn
//    that never ends holds the seen at most maxTurnMs.
//
// A typing refresh is skipped while an earlier typing to the peer is still
// un-ACKed: a peer that has not fetched the last hint gains nothing from the
// next one, and every in-slot replacement spends one of the lane's extensions.

import { TYPING_KINDS } from "../vendor/app-chat-codec.mjs";

// The spec's opt-in limits: at most one typing per 10 s per peer, until = now + 12 s.
export const TYPING_TTL_MS = 12_000;
export const TYPING_MIN_INTERVAL_MS = 10_000;
// A pending seen of a message that starts no turn waits this long for a real
// message to ride on.
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
// typing / seen: a boolean, or (peerHex) => boolean for a per-peer gate
//   (spec 0013: only to a peer whose every device listed the kind).
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
  const typingOn = typeof typing === "function" ? typing : () => typing;
  const seenOn = typeof seen === "function" ? seen : () => seen;
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
        seenDue: false, // the window ended while the seen was held
        holds: 0, // messages from the peer still being handled
        seenIds: new Set(),
      };
      peers.set(peerHex, s);
      if (peers.size > maxPeers) {
        for (const [k, v] of peers) {
          if (k !== peerHex && !v.turn && !v.typingTimer && !v.seenTimer && !v.holds && !v.seenDue) { peers.delete(k); break; }
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
    releaseSeen(peerHex, s);
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
    s.seenDue = false;
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

  // The window of a pending seen ended. Held (a message still being handled,
  // or a turn running): it waits for the reply or the release. A turn older
  // than maxTurnMs is ended here, so a silent harness cannot hold it forever.
  const seenWindowEnded = (peerHex, s) => {
    s.seenTimer = null;
    if (!s.seenUpTo) return;
    s.seenDue = true;
    if (s.holds > 0) return;
    if (s.turn) {
      const left = s.turn.startedAt + maxTurnMs - now();
      if (left > 0) { s.seenTimer = timers.set(() => seenWindowEnded(peerHex, s), left); return; }
      endTurn(peerHex); // releases the seen
      return;
    }
    flushSeen(peerHex, s);
  };
  // The handling or the turn ended: a seen whose window already ended and
  // that no reply took along goes out alone now (or, while a turn still
  // runs, waits under the maxTurnMs guard).
  const releaseSeen = (peerHex, s) => {
    if (s.seenDue && !s.seenTimer) seenWindowEnded(peerHex, s);
  };

  return {
    // A brain turn for peerHex starts. It holds the pending seen until the
    // reply (typing or not); with typing on, it also sends the hints.
    turnStarted(peerHex) {
      const withTyping = typingOn(peerHex);
      if (!withTyping && !seenOn(peerHex)) return;
      const s = stateFor(peerHex);
      clearTyping(s); // also cancels a pending `stopped` of the previous turn
      s.turn = { startedAt: now(), sent: false, logged: false };
      if (withTyping) tick(peerHex, s);
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
      else s.seenDue = false;
      s.turn = null;
      clearTyping(s);
      return [...s.typingIds];
    },
    // The turn ended. Without a reply before it, the hint is closed with
    // typing{stopped} (once the rate limit allows).
    turnEnded(peerHex) { endTurn(peerHex); },
    // The bot starts to handle the peer's message `messageId`. The seen waits
    // for a reply to ride on. Returns `release`: call it once when the
    // handling ends (for a bridge, when the message is handed off; the turn
    // then holds the seen). Without a reply or a turn, the seen goes alone
    // at SEEN_INTERVAL_MS after this call or at the release, if later.
    consumed(peerHex, messageId) {
      if (!messageId || !seenOn(peerHex)) return () => {};
      const s = stateFor(peerHex);
      s.seenUpTo = messageId;
      s.holds += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        s.holds -= 1;
        releaseSeen(peerHex, s);
      };
      // The pending seen takes the latest id; its window keeps running.
      if (!s.seenTimer && !s.seenDue) s.seenTimer = timers.set(() => seenWindowEnded(peerHex, s), SEEN_INTERVAL_MS);
      return release;
    },
    // Introspection for tests.
    typingActive: (peerHex) => typingOn(peerHex) && Boolean(peers.get(peerHex)?.turn),
  };
};
