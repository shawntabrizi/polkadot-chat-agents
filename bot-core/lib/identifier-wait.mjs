// A chat request from a sender the People chain does not show an identifier
// key for yet. A freshly registered identity opens chats seconds after its
// registration lands (the demo's "sign up, then Start chats with all"), so a
// miss is usually "not visible yet", not "no such identity". The request is
// held and the lookup retried with backoff — 5 s, 10 s, 20 s, 40 s, 60 s,
// then every 60 s — until the key appears or the window (10 minutes by
// default) closes.
//
// The hold is the only negative answer the bot keeps: it lives until the
// next retry, and each retry asks the directory again (the positive cache in
// index.mjs never stores a miss).
//
// Memory only. A held request is not accepted work (its identity proof can
// not be checked without the key), so it is not an owed reply; after a
// restart the sweep finds the request in the statement store again and the
// wait starts over.

export const IDENTIFIER_RETRY_STEPS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
export const DEFAULT_IDENTIFIER_RETRY_MS = 600_000;
const DEFAULT_CAP = 1000;

/** The wait before retry `attempt` (0-based): the steps, then the last step for ever. */
export const identifierRetryDelay = (attempt) =>
  IDENTIFIER_RETRY_STEPS_MS[Math.min(Math.max(0, attempt), IDENTIFIER_RETRY_STEPS_MS.length - 1)];

/**
 * lookup(sender)  -> the key, or null (a failure is a miss)
 * onFound(entry)  -> the key is visible: process the request again
 * onExpired(entry)-> the window closed without a key
 * entry = { key, sender, data, since, attempts }
 */
export function createIdentifierWait({
  lookup, onFound, onExpired,
  maxMs = DEFAULT_IDENTIFIER_RETRY_MS, cap = DEFAULT_CAP,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const pending = new Map(); // key -> entry (+ timer)
  const expired = new Set(); // keys whose window closed: the next sight drops them

  const schedule = (entry) => {
    const due = Math.min(now() + identifierRetryDelay(entry.attempts), entry.since + maxMs);
    entry.timer = setTimer(() => { retry(entry); }, Math.max(0, due - now()));
    entry.timer?.unref?.();
  };
  const retry = async (entry) => {
    if (pending.get(entry.key) !== entry) return; // stopped
    entry.attempts += 1;
    let value = null;
    try { value = await lookup(entry.sender); } catch { value = null; }
    if (pending.get(entry.key) !== entry) return;
    if (value) {
      pending.delete(entry.key);
      onFound?.(entry);
      return;
    }
    if (now() - entry.since >= maxMs) {
      pending.delete(entry.key);
      expired.add(entry.key);
      while (expired.size > cap) expired.delete(expired.values().next().value);
      onExpired?.(entry);
      return;
    }
    schedule(entry);
  };

  return {
    /** "waiting" while held, "expired" once the window closed, else null. */
    status(key) {
      if (pending.has(key)) return "waiting";
      return expired.has(key) ? "expired" : null;
    },
    /** Hold a request; false when the wait is full (the caller defers it). */
    hold(key, sender, data) {
      if (pending.has(key)) return true;
      if (pending.size >= cap) return false;
      const entry = { key, sender, data, since: now(), attempts: 0, timer: null };
      pending.set(key, entry);
      schedule(entry);
      return true;
    },
    get size() { return pending.size; },
    stop() {
      for (const entry of pending.values()) clearTimer(entry.timer);
      pending.clear();
    },
  };
}
