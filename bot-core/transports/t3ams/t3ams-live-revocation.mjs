// Durable reconciliation of a visible T3ams live reply.
//
// An authenticated edit/delete invalidates the worker which originally opened
// a thinking placeholder. The journal mutation must reach disk before the
// transport publishes a replacement status, but a temporary disk failure must
// not let the stale placeholder's TTL emit an unrelated timeout later.

const validEntry = (entry) => entry != null
  && typeof entry === "object"
  && entry.turnContext != null
  && typeof entry.turnContext.laneKey === "string"
  && entry.turnContext.laneKey.length > 0
  && typeof entry.turnContext.chatId === "string"
  && entry.turnContext.chatId.length > 0
  && typeof entry.status === "string"
  && entry.status.length > 0;

export const createT3amsLiveRevocation = ({ disarm, take, log = () => {} } = {}) => {
  if (typeof disarm !== "function" || typeof take !== "function") {
    throw new TypeError("T3ams live revocation requires disarm and take callbacks");
  }
  const pending = new Map();

  const queue = (entries) => {
    for (const entry of entries ?? []) {
      if (!validEntry(entry)) continue;
      // The most recent durable message operation owns the visible status for
      // a lane. Replacing an older queued status avoids a misleading sequence
      // such as “restarting” after a later deletion.
      pending.set(entry.turnContext.laneKey, {
        turnContext: entry.turnContext,
        status: entry.status,
        event: typeof entry.event === "string" && entry.event.length > 0
          ? entry.event
          : "T3AMS_LIVE_REVOKE_FINALIZE_FAILED",
      });
    }
  };

  const flush = () => {
    const entries = [...pending.values()];
    pending.clear();
    for (const { turnContext, status, event } of entries) {
      const { chatId, laneKey } = turnContext;
      try {
        disarm(turnContext);
      } catch (error) {
        log(event, { chatId, lane: laneKey, phase: "disarm", error: String(error?.message ?? error) });
      }
      // A transport-owned terminal state must bypass the stale direct-turn or
      // bridge-lease guard that created the placeholder. `take` also clears
      // its heartbeat/TTL before the send is attempted.
      let pendingPlaceholder;
      try {
        // Call `take` immediately rather than through a microtask. The T3ams
        // implementation deletes the lane's placeholder slot before its first
        // await, allowing a revised direct turn to arm a fresh live reply as
        // soon as this durable reconciliation returns.
        pendingPlaceholder = take(turnContext);
      } catch (error) {
        log(event, { chatId, lane: laneKey, error: String(error?.message ?? error) });
        continue;
      }
      void Promise.resolve(pendingPlaceholder)
        .then((placeholder) => placeholder?.handle?.finalize(status, { guard: null }))
        .catch((error) => log(event, { chatId, lane: laneKey, error: String(error?.message ?? error) }));
    }
  };

  return { queue, flush, pending };
};
