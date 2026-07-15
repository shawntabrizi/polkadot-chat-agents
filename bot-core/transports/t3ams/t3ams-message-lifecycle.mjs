// Bounded local reconciliation for authenticated T3ams message operations.
//
// Message statements and their edit/delete operations live in distinct
// retained Statement Store slots, so either can arrive first. This module is
// deliberately transport-agnostic: the protocol must authenticate an event
// before it reaches here, and the runtime decides how a changed/deleted
// message affects its durable ingress queue or passive channel context.

export const T3AMS_MESSAGE_LIFECYCLE_DEFAULTS = Object.freeze({
  maxRecords: 8_192,
  ttlMs: 6 * 60 * 60 * 1000,
  maxTextBytes: 64 * 1024,
  // Lifecycle state crosses the durable bot journal. Bound aggregate payload
  // separately from record count so a flood of valid large edits cannot turn
  // a small state file into hundreds of megabytes.
  maxStateBytes: 8 * 1024 * 1024,
});
export const T3AMS_MESSAGE_LIFECYCLE_STATE_VERSION = 1;

const XID_RE = /^[0-9a-f]{64}$/i;
const CHAT_RE = /^t3ams:(?:dm|channel):[0-9a-f]{64}(?::[0-9a-f]{64})?$/i;

const normalizeXid = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  return XID_RE.test(normalized) ? normalized : null;
};

const normalizeChatId = (value) => typeof value === "string" && CHAT_RE.test(value) ? value : null;

const boundedInteger = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
};

const timestamp = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

const normalizeText = (value, maxBytes, { allowEmpty = false } = {}) => {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || Buffer.byteLength(value, "utf8") > maxBytes) return null;
  return value;
};

const keyFor = (chatId, messageId) => `${chatId}\u0000${messageId}`;
const isRecord = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * Tracks only enough per-message state to apply LWW edits and irreversible
 * redaction tombstones. A record can be created by an operation before its
 * matching message arrives; sender binding prevents that pre-arrival state
 * from being applied to a different author's later message.
 */
export function createT3amsMessageLifecycle({
  maxRecords = T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.maxRecords,
  ttlMs = T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.ttlMs,
  maxTextBytes = T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.maxTextBytes,
  maxStateBytes = T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.maxStateBytes,
  now = () => Date.now(),
  initialSnapshot = null,
} = {}) {
  const limit = boundedInteger(maxRecords, T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.maxRecords, { min: 1, max: 100_000 });
  const lifetimeMs = boundedInteger(ttlMs, T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.ttlMs, { min: 0, max: 31 * 24 * 60 * 60 * 1000 });
  const textLimit = boundedInteger(maxTextBytes, T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.maxTextBytes, { min: 1, max: 1024 * 1024 });
  const stateByteLimit = boundedInteger(maxStateBytes, T3AMS_MESSAGE_LIFECYCLE_DEFAULTS.maxStateBytes, { min: 1024, max: 64 * 1024 * 1024 });
  const records = new Map(); // insertion order is the LRU.

  const recordBytes = (key, record) => Buffer.byteLength(key, "utf8")
    + Buffer.byteLength(record.senderXid, "utf8")
    + (record.edit == null ? 0 : Buffer.byteLength(record.edit.text, "utf8") + 16)
    + 64;
  const trimToLimits = () => {
    let total = 0;
    for (const [key, record] of records) total += recordBytes(key, record);
    while (records.size > limit || total > stateByteLimit) {
      const first = records.entries().next().value;
      if (first == null) break;
      total -= recordBytes(first[0], first[1]);
      records.delete(first[0]);
    }
  };

  const currentTime = () => {
    try {
      return Math.max(0, Number(now()) || 0);
    } catch {
      return Date.now();
    }
  };

  const prune = (current = currentTime()) => {
    if (lifetimeMs === 0) {
      records.clear();
      return;
    }
    for (const [key, record] of records) {
      if (current - record.touchedAt >= lifetimeMs) records.delete(key);
    }
    trimToLimits();
  };

  const touch = (key, record) => {
    records.delete(key);
    records.set(key, record);
    trimToLimits();
    return record;
  };

  const normalizedBase = (raw) => {
    const chatId = normalizeChatId(raw?.chatId);
    const messageId = normalizeXid(raw?.messageId);
    const senderXid = normalizeXid(raw?.senderXid);
    if (chatId == null || messageId == null || senderXid == null) return null;
    return { chatId, messageId, senderXid, key: keyFor(chatId, messageId) };
  };

  const restoreRecord = (raw, current) => {
    if (!isRecord(raw)) return null;
    const base = normalizedBase(raw);
    if (base == null || typeof raw.messageSeen !== "boolean") return null;
    const touchedAt = timestamp(raw.touchedAt);
    if (touchedAt == null) return null;

    const messageTimestamp = raw.messageTimestamp == null ? null : timestamp(raw.messageTimestamp);
    if ((raw.messageTimestamp != null && messageTimestamp == null)
        || (raw.messageSeen && messageTimestamp == null)
        || (!raw.messageSeen && raw.messageTimestamp != null)) return null;

    let edit = null;
    if (raw.edit != null) {
      if (!isRecord(raw.edit)) return null;
      const text = normalizeText(raw.edit.text, textLimit, { allowEmpty: true });
      const editTimestamp = timestamp(raw.edit.timestamp);
      if (text == null || editTimestamp == null) return null;
      edit = { text, timestamp: editTimestamp };
    }

    const deletedAt = raw.deletedAt == null ? null : timestamp(raw.deletedAt);
    if (raw.deletedAt != null && deletedAt == null) return null;
    // A pre-arrival record exists only because it carries an op. Keeping an
    // otherwise empty one would let arbitrary snapshot data consume capacity.
    if (!raw.messageSeen && edit == null && deletedAt == null) return null;

    return {
      key: base.key,
      record: {
        senderXid: base.senderXid,
        messageTimestamp,
        edit,
        deletedAt,
        messageSeen: raw.messageSeen,
        // Never let a future-dated persisted value extend retention forever
        // after a clock correction or a malformed state file.
        touchedAt: Math.min(touchedAt, current),
      },
    };
  };

  const snapshot = () => {
    prune();
    const entries = [];
    for (const [key, record] of records) {
      const separator = key.indexOf("\u0000");
      if (separator <= 0 || key.indexOf("\u0000", separator + 1) >= 0) continue;
      entries.push({
        chatId: key.slice(0, separator),
        messageId: key.slice(separator + 1),
        senderXid: record.senderXid,
        messageSeen: record.messageSeen === true,
        ...(record.messageTimestamp == null ? {} : { messageTimestamp: record.messageTimestamp }),
        ...(record.edit == null ? {} : { edit: { text: record.edit.text, timestamp: record.edit.timestamp } }),
        ...(record.deletedAt == null ? {} : { deletedAt: record.deletedAt }),
        touchedAt: record.touchedAt,
      });
    }
    return { v: T3AMS_MESSAGE_LIFECYCLE_STATE_VERSION, records: entries };
  };

  const restore = (raw) => {
    if (!isRecord(raw) || raw.v !== T3AMS_MESSAGE_LIFECYCLE_STATE_VERSION || !Array.isArray(raw.records)) {
      return { accepted: false, restored: 0, ignored: 0 };
    }
    const current = currentTime();
    const normalized = [];
    // Snapshots produced here are already capped. Limit hostile/corrupt input
    // work too, retaining the most-recent serialized LRU suffix.
    const start = Math.max(0, raw.records.length - limit);
    let ignored = start;
    for (let index = start; index < raw.records.length; index += 1) {
      const entry = restoreRecord(raw.records[index], current);
      if (entry == null || lifetimeMs === 0 || current - entry.record.touchedAt >= lifetimeMs) {
        ignored += 1;
        continue;
      }
      normalized.push(entry);
    }
    records.clear();
    for (const entry of normalized) touch(entry.key, entry.record);
    prune(current);
    return { accepted: true, restored: records.size, ignored };
  };

  if (initialSnapshot != null) restore(initialSnapshot);

  return {
    /** Apply a just-authenticated message and return its effective body/state. */
    applyMessage(raw) {
      prune();
      const base = normalizedBase(raw);
      // A valid rich-text carrier may have an empty caption when it contains
      // attachments. The transport performs the final "text or attachment"
      // validation after this reconciliation step, so keep the raw body here
      // rather than accidentally dropping a photo/file-only message.
      const text = normalizeText(raw?.text, textLimit, { allowEmpty: true });
      const messageTimestamp = timestamp(raw?.timestamp);
      if (base == null || text == null || messageTimestamp == null) return { accepted: false, reason: "invalid-message" };
      const existing = records.get(base.key);
      // A pre-arrival op is useful only when it was signed by the eventual
      // message author. Any mismatch is a different message lifecycle and
      // must not influence this one.
      const compatible = existing == null || existing.senderXid === base.senderXid;
      const record = compatible && existing != null
        ? existing
        : {
          senderXid: base.senderXid,
          messageTimestamp: null,
          edit: null,
          deletedAt: null,
          messageSeen: false,
          touchedAt: currentTime(),
        };
      record.senderXid = base.senderXid;
      // Like the SPA's immutable message row, retain the first valid carrier
      // timestamp for this message ID. A replay cannot move the LWW baseline.
      if (!record.messageSeen) record.messageTimestamp = messageTimestamp;
      record.messageSeen = true;
      record.touchedAt = currentTime();
      touch(base.key, record);
      if (record.deletedAt != null) {
        return { accepted: true, deleted: true, text: null, deletedAt: record.deletedAt };
      }
      // An edit must be strictly newer than the original carrier timestamp.
      // This also resolves a pre-arrival stale/equal edit the same way as the
      // SPA once the actual message row becomes available.
      const edit = record.edit != null && record.edit.timestamp > record.messageTimestamp
        ? record.edit
        : null;
      return {
        accepted: true,
        deleted: false,
        text: edit?.text ?? text,
        ...(edit == null ? {} : { editedAt: edit.timestamp }),
      };
    },

    /** Apply an authenticated edit/delete op; reactions and typing stay outside this state. */
    applyOperation(raw) {
      prune();
      const base = normalizedBase(raw);
      const kind = raw?.kind;
      const opTimestamp = timestamp(raw?.timestamp);
      if (base == null || (kind !== "edit" && kind !== "delete") || opTimestamp == null) {
        return { accepted: false, reason: "invalid-operation" };
      }
      const existing = records.get(base.key);
      if (existing != null && existing.senderXid !== base.senderXid) {
        return { accepted: false, reason: "sender-mismatch" };
      }
      const record = existing ?? {
        senderXid: base.senderXid,
        messageTimestamp: null,
        edit: null,
        deletedAt: null,
        messageSeen: false,
        touchedAt: currentTime(),
      };
      let changed = false;
      if (kind === "edit") {
        const text = normalizeText(raw?.text, textLimit, { allowEmpty: true });
        if (text == null) return { accepted: false, reason: "invalid-edit" };
        // A redaction is final for this bounded lifecycle. In particular, a
        // retained old edit replayed after a delete can never revive content.
        const currentVersion = record.messageSeen
          ? Math.max(record.messageTimestamp ?? 0, record.edit?.timestamp ?? 0)
          : record.edit?.timestamp ?? null;
        if (record.deletedAt == null && (currentVersion == null || opTimestamp > currentVersion)) {
          const prior = record.edit != null && (!record.messageSeen || record.edit.timestamp > record.messageTimestamp)
            ? record.edit
            : null;
          record.edit = { text, timestamp: opTimestamp };
          changed = prior == null || prior.text !== text || prior.timestamp !== opTimestamp;
        }
      } else if (record.deletedAt == null || opTimestamp >= record.deletedAt) {
        changed = record.deletedAt !== opTimestamp;
        record.deletedAt = opTimestamp;
      }
      record.touchedAt = currentTime();
      touch(base.key, record);
      return {
        accepted: true,
        changed,
        messageSeen: record.messageSeen,
        deleted: record.deletedAt != null,
        ...(record.deletedAt == null && record.edit != null
          && (!record.messageSeen || record.edit.timestamp > record.messageTimestamp)
          ? { text: record.edit.text, editedAt: record.edit.timestamp }
          : {}),
        ...(record.deletedAt == null ? {} : { deletedAt: record.deletedAt }),
      };
    },

    clearChat(chatId) {
      const normalized = normalizeChatId(chatId);
      if (normalized == null) return false;
      let removed = false;
      for (const key of records.keys()) {
        if (key.startsWith(`${normalized}\u0000`)) {
          records.delete(key);
          removed = true;
        }
      }
      return removed;
    },

    // Persist only bounded, authenticated-operation reconciliation metadata.
    // The caller owns durable storage and can feed it to `initialSnapshot` or
    // `restore()` after a restart.
    snapshot,
    restore,

    stats() {
      prune();
      return {
        records: records.size,
        maxRecords: limit,
        ttlMs: lifetimeMs,
        maxTextBytes: textLimit,
        maxStateBytes: stateByteLimit,
      };
    },
  };
}
