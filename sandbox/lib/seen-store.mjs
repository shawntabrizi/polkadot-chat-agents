// The wire view on a real network. The sandbox cannot read the whole
// statement store there (it holds no node), so it keeps what its personas'
// clients saw: every page their subscriptions received and every statement
// they submitted, recorded through the papi client they talk over — the
// SDK is not touched. Kept in the store node's read-side shape (one live
// statement per (signer, channel) slot, the slot's earlier statements in a
// history) so `pcs wire` and the inspector decode it the same way on both
// profiles.

import { decodeStored } from "./store-node.mjs";

const HISTORY_PER_SLOT = 100;
const stripHex = (h) => String(h).replace(/^0x/i, "").toLowerCase();

export function createSeenStore() {
  const statements = []; // live, in order of first sight
  const history = new Map(); // `${signer}:${channel}` -> [{ ...stored, replacedAt, reason }]
  const seen = new Set(); // hex, so a statement pushed to two devices is one entry
  const watchers = new Set();
  const emit = (event) => { for (const fn of watchers) fn(event); };
  const slotKey = (s) => `${s.signer}:${s.channel}`;

  const retire = (stored, reason, at) => {
    const i = statements.indexOf(stored);
    if (i >= 0) statements.splice(i, 1);
    const list = history.get(slotKey(stored)) ?? [];
    list.push({ ...stored, replacedAt: at, reason });
    if (list.length > HISTORY_PER_SLOT) list.splice(0, list.length - HISTORY_PER_SLOT);
    history.set(slotKey(stored), list);
  };

  /** A statement (0x hex) a client submitted or received; `source` says which. Undecodable bytes are ignored. */
  const record = (hex, source) => {
    const key = stripHex(hex);
    if (seen.has(key)) return null;
    let decoded;
    try { decoded = decodeStored(`0x${key}`); } catch { return null; }
    seen.add(key);
    const now = Date.now();
    const stored = { ...decoded, receivedAt: now, replacedCount: 0, source };
    // The real store keeps one statement per slot and replaces by expiry;
    // a subscription dump can also hand us an older statement after we saw
    // the newer one, which is then history at once.
    const current = stored.channel ? statements.find((s) => s.signer === stored.signer && s.channel === stored.channel) : null;
    if (current) {
      if (stored.expiry > current.expiry) {
        stored.replacedCount = current.replacedCount + 1;
        retire(current, "replaced", now);
        statements.push(stored);
      } else {
        retire(stored, "replaced", now);
      }
    } else {
      statements.push(stored);
    }
    emit({ event: "stored", signer: stored.signer, channel: stored.channel, topics: [...stored.topics], expiry: stored.expiry, replaced: current != null, source });
    return stored;
  };

  const select = ({ topic = null, signer = null, channel = null } = {}) => (s) =>
    (topic == null || s.topics.includes(stripHex(topic)))
    && (signer == null || s.signer === stripHex(signer))
    && (channel == null || s.channel === stripHex(channel));
  const view = ({ hex, data, topics, signer: sg, channel: ch, expiry, receivedAt, replacedCount, replacedAt, reason, source }) =>
    ({ hex, data, topics: [...topics], signer: sg, channel: ch, expiry, receivedAt, replacedCount, replacedAt, reason, source });

  return {
    statements,
    record,
    list: (filter) => statements.filter(select(filter)).map(view),
    history: (filter) => [...history.values()].flat().filter(select(filter)).map(view),
    watch: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
  };
}

/**
 * The SDK's lazy papi client with the statement traffic mirrored into a
 * seen-store: `statement_submit` params on the way out, `newStatements`
 * pages on the way in. Everything else passes through untouched.
 */
export function observeLazyClient(inner, seen) {
  return {
    getClient: () => inner.getClient(),
    getRequestFn() {
      const request = inner.getRequestFn();
      return (method, params) => {
        if (method === "statement_submit" && typeof params?.[0] === "string") seen.record(params[0], "submitted");
        return request(method, params);
      };
    },
    getSubscribeFn() {
      const subscribe = inner.getSubscribeFn();
      return (method, params, onMessage, onError) => subscribe(method, params, (event) => {
        if (method === "statement_subscribeStatement" && event?.event === "newStatements") {
          for (const hex of event.data?.statements ?? []) seen.record(hex, "subscription");
        }
        onMessage(event);
      }, onError);
    },
    disconnect: () => inner.disconnect(),
  };
}
