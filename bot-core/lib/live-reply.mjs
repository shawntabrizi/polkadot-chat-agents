// Live replies: one placeholder message that is edited in place through a
// turn's lifecycle (thinking -> progress -> final answer) instead of a
// throwaway "thinking…" bubble plus a separate answer.
//
// The protocol constraints this module exists to enforce:
//  - The placeholder must be ACKed by the peer before any edit goes out: the
//    statement store keeps ONE statement per channel, so an edit submitted
//    before the peer fetched the placeholder REPLACES it and the original
//    bubble never exists — every later edit is an invisible dangling
//    reference. No ACK -> no edits; the final is sent as a plain message
//    (which harmlessly replaces the unfetched placeholder in the slot).
//  - Every edit the peer receives is persisted forever and shown as a row in
//    the app's edit-history screen, so frames must stay few: edits are
//    throttled with an ESCALATING interval (minMs, doubling every 3 edits up
//    to maxMs) with latest-wins coalescing — a newer frame replaces the
//    queued one, and identical frames are never sent.
//  - Edits carry the full replacement text, so dropping intermediate frames
//    is always safe.

const noop = () => {};

const defaultTimers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clear: (t) => clearTimeout(t),
};

// send({ peerHex, text, editOf?, supersedes? }) -> Promise<{ messageId, delivered }>
//   `delivered` is an opaque token for awaitAck (in production: a promise that
//   resolves once the peer ACKed the statement carrying the message).
//   `supersedes: [messageId]` asks the outbound lane to drop those messages if
//   the peer never fetched them (used by the no-ACK finalize fallback so the
//   stale placeholder bubble is replaced by the answer, not shown above it).
// awaitAck(delivered) -> Promise<boolean> (false on timeout)
export const createLiveReplies = ({
  send,
  awaitAck,
  minIntervalMs = 3_000,
  maxIntervalMs = 15_000,
  finalAckWaitMs = 10_000,
  now = () => Date.now(),
  timers = defaultTimers,
  log = noop,
}) => {
  // One lane per outgoing message that is being live-edited. Also used to
  // throttle harness-driven edits of arbitrary bot messages.
  const lanes = new Map(); // messageId -> lane
  const LANE_CAP = 500;
  const trimLanes = () => { while (lanes.size > LANE_CAP) lanes.delete(lanes.keys().next().value); };

  const intervalFor = (editsSent) =>
    Math.min(minIntervalMs * 2 ** Math.floor(editsSent / 3), maxIntervalMs);

  const makeLane = (peerHex, messageId, ackState, defaultGuard = null) => {
    const lane = {
      peerHex,
      messageId,
      ackState, // "pending" | "acked" | "failed" | "assumed" (pre-existing target)
      finalized: false,
      inFlight: null, // Promise while an edit submit is in flight
      pendingText: null,
      // Optional fence for a queued external edit.  Bridge workers lease an
      // inbound turn, and a coalesced edit may not leave the process after
      // that lease is revoked or expires.
      pendingGuard: null,
      // A placeholder can itself be owned by a leased bridge turn. Keep its
      // fence for heartbeat updates and terminal fallback frames unless a
      // newer caller explicitly supplies a different claim.
      defaultGuard,
      lastSentText: null,
      editsSent: 0,
      lastEditAt: null, // null = never sent on this lane -> first flush is immediate
      timer: null,
    };
    lanes.set(messageId, lane);
    trimLanes();
    return lane;
  };

  const clearLaneTimer = (lane) => {
    if (lane.timer) { timers.clear(lane.timer); lane.timer = null; }
  };

  const flush = async (lane) => {
    clearLaneTimer(lane);
    if (lane.finalized || lane.inFlight) return;
    if (lane.pendingText == null || lane.pendingText === lane.lastSentText) {
      lane.pendingText = null;
      lane.pendingGuard = null;
      return;
    }
    const text = lane.pendingText;
    const guard = lane.pendingGuard;
    lane.pendingText = null;
    lane.pendingGuard = null;
    lane.inFlight = (async () => {
      try {
        if (guard != null && !guard()) {
          log("BOT_LIVE_EDIT_FENCED", { to: lane.peerHex, messageId: lane.messageId });
          return;
        }
        await send({ peerHex: lane.peerHex, text, editOf: lane.messageId, guard });
        lane.lastSentText = text;
        lane.editsSent += 1;
        lane.lastEditAt = now();
      } catch (e) {
        // A dropped progress frame is harmless (the next one carries the full
        // text); only the final must not be lost, and finalize() has its own
        // error path.
        log("BOT_LIVE_EDIT_FAILED", { to: lane.peerHex, error: String(e?.message ?? e) });
      } finally {
        lane.inFlight = null;
      }
    })();
    await lane.inFlight;
    if (lane.pendingText != null && !lane.finalized) scheduleFlush(lane);
  };

  const scheduleFlush = (lane) => {
    if (lane.finalized || lane.inFlight || lane.timer) return;
    if (lane.ackState === "pending") return; // flushed when the ACK resolves
    if (lane.ackState === "failed") { lane.pendingText = null; return; }
    const wait = lane.lastEditAt == null ? 0 : lane.lastEditAt + intervalFor(lane.editsSent) - now();
    if (wait <= 0) { void flush(lane); return; }
    lane.timer = timers.set(() => { lane.timer = null; void flush(lane); }, wait);
  };

  const update = (lane, text, guard = lane.defaultGuard) => {
    if (lane.finalized) return;
    lane.pendingText = text;
    lane.pendingGuard = guard;
    scheduleFlush(lane);
  };

  // Wait for a pending ACK, but never longer than finalAckWaitMs — the final
  // answer must not sit behind an unreachable peer.
  const settleAck = async (lane) => {
    if (lane.ackState !== "pending") return lane.ackState;
    await new Promise((resolve) => {
      const timer = timers.set(resolve, finalAckWaitMs);
      lane.ackResolvers.push(() => { timers.clear(timer); resolve(); });
    });
    return lane.ackState === "pending" ? "failed" : lane.ackState;
  };

  const finalize = async (lane, text, guard = lane.defaultGuard) => {
    if (lane.finalized) throw new Error("live message already finalized");
    lane.finalized = true;
    clearLaneTimer(lane);
    lane.pendingText = null;
    lane.pendingGuard = null;
    if (lane.inFlight) await lane.inFlight.catch(noop);
    const ack = await settleAck(lane);
    if (guard != null && !guard()) {
      const error = new Error("live edit fence is no longer active");
      error.code = "LIVE_EDIT_FENCED";
      throw error;
    }
    if (ack === "acked" || ack === "assumed") {
      if (text === lane.lastSentText) return { messageId: lane.messageId, edited: true };
      await send({ peerHex: lane.peerHex, text, editOf: lane.messageId, guard });
      return { messageId: lane.messageId, edited: true };
    }
    // Peer never fetched the placeholder: send the answer as a plain message
    // that supersedes it, so the slot ends up holding only the answer.
    log("BOT_LIVE_FALLBACK", { to: lane.peerHex, placeholder: lane.messageId });
    const sent = await send({ peerHex: lane.peerHex, text, supersedes: [lane.messageId], guard });
    return { messageId: sent.messageId, edited: false };
  };

  return {
    // Send a live placeholder message; edits unlock when the peer ACKs it.
    async begin(peerHex, text, { guard = null } = {}) {
      const { messageId, delivered } = await send({ peerHex, text, guard });
      const lane = makeLane(peerHex, messageId, "pending", guard);
      lane.lastSentText = text;
      lane.lastEditAt = now();
      lane.ackResolvers = [];
      awaitAck(delivered).then((ok) => {
        lane.ackState = ok ? "acked" : "failed";
        for (const r of lane.ackResolvers.splice(0)) r();
        if (ok) scheduleFlush(lane);
        else { lane.pendingText = null; log("BOT_LIVE_ACK_TIMEOUT", { to: peerHex, placeholder: messageId }); }
      });
      return {
        messageId,
        get finalized() { return lane.finalized; },
        update: (t) => update(lane, t),
        finalize: (t, options = {}) => finalize(
          lane,
          t,
          Object.hasOwn(options, "guard") ? options.guard : lane.defaultGuard,
        ),
      };
    },

    // Throttle a harness-driven edit of an existing bot message (the target
    // is presumed delivered — it was a previously ACK-tracked send or an old
    // message). Fire-and-forget: frames coalesce latest-wins.
    throttledEdit(peerHex, messageId, text, { guard = null } = {}) {
      let lane = lanes.get(messageId);
      if (!lane) { lane = makeLane(peerHex, messageId, "assumed"); lane.ackResolvers = []; }
      if (lane.finalized) lane.finalized = false; // harness may keep editing a finalized live message
      update(lane, text, guard);
    },

    // Drop a queued harness-driven edit when its surrounding turn is
    // invalidated.  An already-submitted protocol request cannot be
    // cancelled, but its caller's fence is checked immediately before send.
    cancelExisting(peerHex, messageId) {
      const lane = lanes.get(messageId);
      if (lane == null || lane.peerHex !== peerHex) return false;
      lane.finalized = true;
      clearLaneTimer(lane);
      lane.pendingText = null;
      lane.pendingGuard = null;
      return true;
    },

    // A bridge delivery is acknowledged only after its framework completed a
    // streamed turn. Promote the latest throttled frame to the terminal edit
    // at that point so no coalesced progress timer can overwrite the final
    // answer after the worker has ACKed its lease.
    async finalizeExisting(peerHex, messageId, text, options = {}) {
      let lane = lanes.get(messageId);
      if (!lane) { lane = makeLane(peerHex, messageId, "assumed"); lane.ackResolvers = []; }
      return finalize(lane, text, Object.hasOwn(options, "guard") ? options.guard : lane.defaultGuard);
    },
  };
};

// Progress rendering: a header with a live elapsed clock and a step counter,
// plus a rolling window of the most recent action lines.
export const createProgressTracker = ({ label = "working", maxActions = 3, now = () => Date.now() } = {}) => {
  const startedAt = now();
  const actions = [];
  let step = 0;
  const elapsed = () => {
    const secs = Math.max(0, Math.round((now() - startedAt) / 1000));
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s` : `${secs}s`;
  };
  return {
    add(title) {
      step += 1;
      const line = String(title).replace(/\s+/g, " ").trim().slice(0, 120);
      actions.push(line);
      if (actions.length > maxActions) actions.shift();
    },
    get step() { return step; },
    render() {
      const header = `⏳ ${label} · ${elapsed()}${step > 0 ? ` · step ${step}` : ""}`;
      return [header, ...actions.map((a) => `▸ ${a}`)].join("\n");
    },
  };
};

// A turn may do useful work before its visible placeholder can be created:
// for example, a transport can be downloading an attached PDF while the
// outbound statement lane is still quiet. Retain those actions and attach a
// live handle later so the first visible progress frame accurately describes
// work that has already happened. This deliberately owns no timers or
// transport state; the caller remains responsible for throttling/finalizing
// the actual live reply.
export const createDeferredProgressTracker = (options = {}) => {
  const tracker = createProgressTracker(options);
  let handle = null;
  let disposed = false;
  // A transport can replace the compact activity card with a user-visible
  // draft of the final answer. The draft belongs to the display layer only:
  // callers retain the terminal answer independently, so an interrupted
  // stream never promotes a partial response into a durable final message.
  let liveText = null;
  const flush = () => {
    if (disposed || handle == null || handle.finalized) return;
    handle.update(liveText ?? tracker.render());
  };
  return {
    add(title) {
      if (disposed) return;
      tracker.add(title);
      flush();
    },
    setLiveText(text) {
      if (disposed) return;
      const next = typeof text === "string" && text.trim() ? text : null;
      if (next === liveText) return;
      liveText = next;
      flush();
    },
    attach(nextHandle) {
      if (disposed || nextHandle == null) return;
      handle = nextHandle;
      // Do not replace a fresh "thinking…" bubble with a redundant working
      // frame unless there is real pre-placeholder work or user-visible final
      // prose to report. A no-tools Claude turn can start streaming text
      // before it emits any tool/action event.
      if (tracker.step > 0 || liveText != null) flush();
    },
    detach() { handle = null; },
    dispose() {
      disposed = true;
      handle = null;
    },
    get step() { return tracker.step; },
    render: () => liveText ?? tracker.render(),
  };
};
