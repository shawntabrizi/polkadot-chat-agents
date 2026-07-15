// Persistent, bounded token buckets for the optional external attachment
// analyzer. The ordinary direct-agent queue limits concurrency, but a public
// bot also needs a durable spend/rate boundary before it copies any verified
// photo or document to a provider.

const integer = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`invalid integer (expected ${min}–${max})`);
  }
  return number;
};
const safeNow = (value) => Number.isSafeInteger(value) && value >= 0 ? value : Date.now();
const validKey = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
const snapshotBucket = (bucket) => ({ tokens: bucket.tokens, at: bucket.at });

const restoreBucket = (raw, capacity, now) => {
  const tokens = Number(raw?.tokens);
  const at = Number(raw?.at);
  if (!Number.isFinite(tokens) || !Number.isSafeInteger(at) || at < 0) {
    return { tokens: capacity, at: now };
  }
  return { tokens: Math.max(0, Math.min(capacity, tokens)), at: Math.min(at, now) };
};

const replenish = (bucket, capacity, windowMs, now) => {
  const elapsed = Math.max(0, now - bucket.at);
  bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed * capacity) / windowMs);
  bucket.at = now;
};
const retryAfterMs = (tokens, capacity, windowMs) => Math.max(1, Math.ceil(((1 - tokens) * windowMs) / capacity));

/**
 * One analysis costs one token from both the global and authenticated-sender
 * buckets. State has no attachment bytes, request text, filenames, or model
 * output, so it is safe to persist beside the normal private ingress journal.
 */
export const createT3amsMediaAnalysisBudget = ({
  senderCapacity = 4,
  senderWindowMs = 60 * 60_000,
  globalCapacity = 30,
  globalWindowMs = 60 * 60_000,
  senderCap = 1_000,
  initial = null,
  now = () => Date.now(),
} = {}) => {
  const limits = Object.freeze({
    senderCapacity: integer(senderCapacity, 4, { min: 1, max: 10_000 }),
    senderWindowMs: integer(senderWindowMs, 60 * 60_000, { min: 1_000, max: 31 * 24 * 60 * 60_000 }),
    globalCapacity: integer(globalCapacity, 30, { min: 1, max: 100_000 }),
    globalWindowMs: integer(globalWindowMs, 60 * 60_000, { min: 1_000, max: 31 * 24 * 60 * 60_000 }),
    senderCap: integer(senderCap, 1_000, { min: 1, max: 100_000 }),
  });
  if (typeof now !== "function") throw new TypeError("now must be a function");
  const start = safeNow(now());
  const global = { tokens: limits.globalCapacity, at: start };
  const senders = new Map();
  const trim = (at) => {
    const staleAt = at - Math.max(limits.senderWindowMs, limits.globalWindowMs) * 2;
    for (const [sender, bucket] of senders) {
      if (bucket.at < staleAt) senders.delete(sender);
    }
    while (senders.size > limits.senderCap) senders.delete(senders.keys().next().value);
  };
  const restore = (raw = null, at = now()) => {
    const current = safeNow(at);
    const restoredGlobal = restoreBucket(raw?.global, limits.globalCapacity, current);
    global.tokens = restoredGlobal.tokens;
    global.at = restoredGlobal.at;
    senders.clear();
    if (Array.isArray(raw?.senders)) {
      for (const candidate of raw.senders.slice(-limits.senderCap)) {
        if (!validKey(candidate?.sender) || senders.has(candidate.sender)) continue;
        senders.set(candidate.sender, restoreBucket(candidate, limits.senderCapacity, current));
      }
    }
    trim(current);
  };
  restore(initial, start);

  const reserve = (sender, at = now()) => {
    const current = safeNow(at);
    if (!validKey(sender)) throw new TypeError("media-analysis sender is invalid");
    replenish(global, limits.globalCapacity, limits.globalWindowMs, current);
    // Do not create/reorder a sender bucket while global capacity is already
    // exhausted. Otherwise a cheap stream of forged identities could evict
    // legitimate users' bounded accounting state without buying any work.
    if (global.tokens < 1) {
      return { allowed: false, reason: "global", retryAfterMs: retryAfterMs(global.tokens, limits.globalCapacity, limits.globalWindowMs) };
    }
    let bucket = senders.get(sender);
    if (bucket == null) {
      trim(current);
      while (senders.size >= limits.senderCap) senders.delete(senders.keys().next().value);
      bucket = { tokens: limits.senderCapacity, at: current };
      senders.set(sender, bucket);
    } else {
      replenish(bucket, limits.senderCapacity, limits.senderWindowMs, current);
      // LRU ordering makes bounded eviction deterministic without changing a
      // bucket's refill timing.
      senders.delete(sender);
      senders.set(sender, bucket);
    }
    if (bucket.tokens < 1) {
      return { allowed: false, reason: "sender", retryAfterMs: retryAfterMs(bucket.tokens, limits.senderCapacity, limits.senderWindowMs) };
    }
    global.tokens -= 1;
    bucket.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  };
  const snapshot = (at = now()) => {
    const current = safeNow(at);
    replenish(global, limits.globalCapacity, limits.globalWindowMs, current);
    trim(current);
    return {
      v: 1,
      global: snapshotBucket(global),
      senders: [...senders.entries()].map(([sender, bucket]) => ({ sender, ...snapshotBucket(bucket) })),
    };
  };
  return Object.freeze({ limits, reserve, snapshot, restore });
};
