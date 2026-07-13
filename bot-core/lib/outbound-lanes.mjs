// Per-peer outbound statement lanes. Every message the bot publishes on a
// peer's session request channel MUST flow through that peer's lane, because
// the statement store keeps exactly ONE statement per (account, channel):
// submitting while the previous statement is still un-fetched REPLACES it and
// silently loses every message it carried.
//
// This mirrors the mobile app's own solution (OutgoingRequestQueue.swift):
//  - At most one un-ACKed request statement is "current" per peer. The peer's
//    session-response ACK for its requestId is what frees the slot.
//  - Messages arriving while a statement is current EXTEND it: the batch is
//    re-encoded as a superset under a NEW requestId and replaces the slot —
//    lossless, because the replacement carries everything the original did.
//    Receivers dedup by messageId, so a peer that fetched both sees no dupes.
//  - When the batch cannot be extended (identity/device encryption mismatch,
//    payload cap, extension budget), messages wait in a FIFO queue that
//    drains on ACK. The queue is bounded so a dead peer cannot leak memory.
//  - Liveness backstop (ackGraceMs): when messages are QUEUED and the current
//    statement has gone un-ACKed past the grace window, the lane takes the
//    slot over — the queued batch replaces the current statement, whose
//    messages resolve delivered=false. A conformant app ACKs in seconds, so
//    this fires only for unreachable/broken peers; with nothing queued the
//    current statement stays in the slot indefinitely (lossless for the
//    common case — the peer fetches it whenever they come back).
//  - An entry may declare it `supersedes` earlier messageIds: if those are
//    still in the un-ACKed batch (or queued), they are dropped as part of the
//    extension — used to replace a never-fetched live placeholder with the
//    final answer instead of showing both bubbles.
//
// ACKs of a superseded requestId are ignored on purpose: they prove the peer
// fetched an OLD statement; the extended statement is new on the same topic,
// so the peer will fetch and ACK it too.

export const createOutboundLanes = ({
  encodeBatch,   // (peerHex, requestId, opaques, { forceIdentity }) -> payload bytes (throws if peer unknown)
  submitPayload, // (peerHex, payload) -> Promise<void>
  makeRequestId, // () -> string
  maxPayloadBytes = 480 * 1024, // statement cap (500 KiB allowance) minus envelope headroom
  maxExtensions = 8, // after this many in-slot replacements, wait for the ACK instead
  maxQueued = 200,   // per-lane backpressure: beyond this, enqueue rejects
  ackGraceMs = 60_000, // un-ACKed current + queued messages -> slot takeover after this
  now = () => Date.now(),
  log = () => {},
}) => {
  const lanes = new Map(); // peerHex -> { current, queue, pumping, graceTimer }
  // current: { requestId, entries, extensions, forceIdentity, submittedAt } | null
  // entry:   { opaque, messageId, forceIdentity, supersedes, submitted{resolve,reject},
  //            delivered{resolve}, submittedAt }
  const LANE_CAP = 500;
  const laneFor = (peerHex) => {
    let lane = lanes.get(peerHex);
    if (!lane) {
      lane = { current: null, queue: [], pumping: false, graceTimer: null };
      lanes.set(peerHex, lane);
      // Bound the map: evict the oldest IDLE lane (never one with work).
      if (lanes.size > LANE_CAP) {
        for (const [k, l] of lanes) {
          if (k !== peerHex && !l.current && l.queue.length === 0) { lanes.delete(k); break; }
        }
      }
    }
    return lane;
  };

  const resolveEntries = (entries, ok) => {
    for (const e of entries) e.delivered.resolve(ok);
  };

  // Drop queued entries that a newly enqueued one supersedes (they were never
  // submitted, or only ever existed inside a replaced batch — never fetched).
  const applySupersedes = (lane, supersedes) => {
    if (!supersedes?.length) return;
    const drop = new Set(supersedes);
    const kept = [];
    for (const e of lane.queue) {
      if (e.messageId && drop.has(e.messageId)) { e.submitted.resolve(); e.delivered.resolve(false); }
      else kept.push(e);
    }
    lane.queue = kept;
  };

  // Greedily pack a same-flag prefix of the queue into one encodable batch on
  // top of `base` (the current entries when extending, [] when fresh). Returns
  // null when not even one new entry fits.
  const packBatch = (peerHex, lane, base) => {
    const flag = base.length ? base[0].forceIdentity : lane.queue[0].forceIdentity;
    if (base.length && lane.queue[0].forceIdentity !== flag) return null;
    let entries = [...base];
    let taken = 0;
    let requestId = null;
    let payload = null;
    while (taken < lane.queue.length && lane.queue[taken].forceIdentity === flag) {
      const next = lane.queue[taken];
      const supersedes = new Set(next.supersedes ?? []);
      const candidate = [...entries.filter((e) => !(e.messageId && supersedes.has(e.messageId))), next];
      const rid = makeRequestId();
      let encoded;
      try { encoded = encodeBatch(peerHex, rid, candidate.map((e) => e.opaque), { forceIdentity: flag }); }
      catch (e) { // no session for peer, or a codec failure: fail the entry loudly
        lane.queue.splice(taken, 1);
        next.submitted.reject(e instanceof Error ? e : new Error(String(e)));
        next.delivered.resolve(false);
        continue;
      }
      if (encoded.length > maxPayloadBytes && entries.length > base.length) break; // batch full; rest waits
      if (encoded.length > maxPayloadBytes && candidate.length === 1) {
        // A single message that can never fit: reject it, don't wedge the lane.
        lane.queue.splice(taken, 1);
        next.submitted.reject(new Error(`message exceeds statement payload cap (${encoded.length} > ${maxPayloadBytes} bytes)`));
        next.delivered.resolve(false);
        continue;
      }
      if (encoded.length > maxPayloadBytes) break;
      entries = candidate;
      requestId = rid;
      payload = encoded;
      taken += 1;
    }
    if (!requestId) return null;
    lane.queue.splice(0, taken);
    return { requestId, entries, payload, flag };
  };

  // The liveness backstop: fire a takeover once the current statement has
  // been un-ACKed for ackGraceMs WHILE messages are waiting behind it.
  const armGrace = (peerHex, lane) => {
    if (lane.graceTimer || !lane.current || lane.queue.length === 0) return;
    const wait = Math.max(0, lane.current.submittedAt + ackGraceMs - now());
    lane.graceTimer = setTimeout(() => {
      lane.graceTimer = null;
      if (!lane.current || lane.queue.length === 0) return;
      if (now() - lane.current.submittedAt < ackGraceMs) { armGrace(peerHex, lane); return; }
      log("BOT_OUTBOUND_TAKEOVER", { to: peerHex, dropped: lane.current.entries.length, queued: lane.queue.length });
      resolveEntries(lane.current.entries, false);
      lane.current = null;
      void pump(peerHex);
    }, wait);
    lane.graceTimer.unref?.();
  };
  const clearGrace = (lane) => {
    if (lane.graceTimer) { clearTimeout(lane.graceTimer); lane.graceTimer = null; }
  };

  const pump = async (peerHex) => {
    const lane = laneFor(peerHex);
    if (lane.pumping) return;
    lane.pumping = true;
    // Distinguishes "queue drained / can make progress" from "blocked waiting
    // on ACK/grace" — only the former may re-pump from finally, or a blocked
    // lane would spin on setImmediate.
    let blocked = false;
    try {
      // Let a synchronous burst of enqueues (e.g. the chunks of one long
      // answer) land before packing, so they ride one statement, not N.
      await new Promise((resolve) => setImmediate(resolve));
      while (lane.queue.length > 0) {
        const extending = lane.current != null;
        if (extending && lane.current.extensions >= maxExtensions) { blocked = true; return armGrace(peerHex, lane); }
        const batch = packBatch(peerHex, lane, extending ? lane.current.entries : []);
        if (!batch) { blocked = true; return armGrace(peerHex, lane); }
        const newEntries = batch.entries.filter((e) => !extending || !lane.current.entries.includes(e));
        const droppedBySupersede = extending ? lane.current.entries.filter((e) => !batch.entries.includes(e)) : [];
        try {
          await submitPayload(peerHex, batch.payload);
        } catch (e) {
          // Submit failed (chain outage, rejection): fail the NEW entries —
          // an extension leaves the old statement untouched in the slot, so
          // the current batch stays valid as-is.
          for (const en of newEntries) { en.submitted.reject(e instanceof Error ? e : new Error(String(e))); en.delivered.resolve(false); }
          log("BOT_OUTBOUND_SUBMIT_FAILED", { to: peerHex, queued: lane.queue.length, error: String(e?.message ?? e) });
          blocked = true;
          return;
        }
        resolveEntries(droppedBySupersede, false);
        for (const en of newEntries) en.submitted.resolve();
        clearGrace(lane);
        lane.current = {
          requestId: batch.requestId,
          entries: batch.entries,
          extensions: extending ? lane.current.extensions + 1 : 0,
          forceIdentity: batch.flag,
          // An extension refreshes the window: the statement in the slot is new.
          submittedAt: now(),
        };
        if (extending) log("BOT_OUTBOUND_EXTENDED", { to: peerHex, messages: batch.entries.length, extensions: lane.current.extensions });
      }
    } finally {
      lane.pumping = false;
      // An entry pushed between the loop's last queue check and here would
      // otherwise sit until the next external pump trigger (its own pump call
      // hit the lane.pumping guard). Blocked lanes wake on ACK/grace instead.
      if (!blocked && lane.queue.length > 0) setImmediate(() => void pump(peerHex));
    }
  };

  return {
    // Queue one opaque message for the peer. Returns:
    //   submitted — resolves when a statement carrying it is on the node
    //   delivered — resolves true when that statement is ACKed by the peer,
    //               false if the message was superseded or failed
    enqueue(peerHex, opaque, { messageId = null, forceIdentity = false, supersedes = [] } = {}) {
      const lane = laneFor(peerHex);
      applySupersedes(lane, supersedes);
      if (lane.queue.length >= maxQueued) {
        const err = new Error(`outbound queue full for peer (${maxQueued})`);
        const rejected = Promise.reject(err);
        rejected.catch(() => {}); // callers may only consume `delivered`
        return { submitted: rejected, delivered: Promise.resolve(false) };
      }
      const entry = { opaque, messageId, forceIdentity, supersedes };
      const submitted = new Promise((resolve, reject) => { entry.submitted = { resolve, reject }; });
      let deliveredResolve;
      const delivered = new Promise((resolve) => { deliveredResolve = resolve; });
      entry.delivered = { resolve: deliveredResolve };
      submitted.catch(() => {}); // callers may only consume `delivered`
      lane.queue.push(entry);
      void pump(peerHex);
      return { submitted, delivered };
    },

    // Feed the peer's session-response ACKs here. Only the CURRENT requestId
    // advances the lane (a superseded id proves a fetch of an older batch).
    onAck(peerHex, requestId) {
      const lane = lanes.get(peerHex);
      if (!lane?.current || lane.current.requestId !== requestId) return;
      resolveEntries(lane.current.entries, true);
      clearGrace(lane);
      lane.current = null;
      void pump(peerHex);
    },

    // A session lifecycle policy may retire a peer that has been inactive for
    // days. Do not leave its un-ACKed transport slot permanently retaining the
    // lane and its message closures. Callers only use this after deciding that
    // the peer is stale; queued/current delivery promises resolve false.
    expire(peerHex, reason = "session expired") {
      const lane = lanes.get(peerHex);
      if (!lane || lane.pumping) return false;
      clearGrace(lane);
      if (lane.current) resolveEntries(lane.current.entries, false);
      for (const entry of lane.queue) {
        entry.submitted.reject(new Error(reason));
        entry.delivered.resolve(false);
      }
      lanes.delete(peerHex);
      return true;
    },

    hasPending(peerHex) {
      const lane = lanes.get(peerHex);
      return Boolean(lane?.pumping || lane?.current || lane?.queue.length);
    },

    // Introspection for tests / health.
    depth(peerHex) {
      const lane = lanes.get(peerHex);
      return lane ? lane.queue.length + (lane.current ? lane.current.entries.length : 0) : 0;
    },
  };
};
