// Bounded, local-only context for explicitly invoked T3ams channel bots.
//
// This module deliberately knows nothing about BCTS, Statement Store, brains,
// or persistence.  Its caller must only append an already decrypted,
// authenticated, authorized *unmentioned primary* channel message.  In
// particular, carrier priors must not be appended: they are replay material,
// not a reliable chronological channel history.
//
// Context is passive: appending a record never invokes a brain or creates an
// outbound statement.  A transport can snapshot the relevant records when it
// durably admits an explicit mention, then put that immutable snapshot in the
// ingress record for retry-safe delivery.

export const T3AMS_CHANNEL_CONTEXT_DEFAULTS = Object.freeze({
  enabled: false,
  ttlMs: 30 * 60 * 1000,
  maxChats: 128,
  maxRecordsPerChat: 16,
  maxBytesPerChat: 8 * 1024,
  maxRecordBytes: 2 * 1024,
  maxRecordsPerSender: 4,
  maxBytesPerSender: 2 * 1024,
  maxTotalBytes: 256 * 1024,
  maxSenderNameBytes: 512,
});

// Account/message XIDs are 32-byte values. Keeping this strict lets a caller
// safely persist or render a snapshot without accepting arbitrary identifiers.
const XID_RE = /^[0-9a-f]{64}$/i;
const CHANNEL_CHAT_RE = /^t3ams:channel:[0-9a-f]{64}:[0-9a-f]{64}$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const RECORD_OVERHEAD_BYTES = 96;

const byteLength = (value) => Buffer.byteLength(value, "utf8");

const positiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : fallback;
};

const nonNegativeInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
};

const normalizeXid = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  return XID_RE.test(normalized) ? normalized : null;
};

const normalizeChatId = (value, isValidChat) => {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 512 || CONTROL_RE.test(value)) {
    return null;
  }
  try {
    return isValidChat(value) ? value : null;
  } catch {
    return null;
  }
};

const normalizeName = (value, maxBytes) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || CONTROL_RE.test(normalized) || byteLength(normalized) > maxBytes) return null;
  return normalized;
};

const publicRecord = (record) => ({
  messageId: record.messageId,
  senderXid: record.senderXid,
  senderName: record.senderName,
  text: record.text,
  threadRootId: record.threadRootId,
  receivedAt: record.receivedAt,
  sequence: record.sequence,
  bytes: record.bytes,
});

/**
 * Create an in-memory bounded channel-context store.
 *
 * `append(chatId, record)` accepts records shaped as:
 * `{ messageId | id, senderXid, senderName?, text, threadRootId? }`.
 * Receipt time and sequence are assigned locally; sender-provided timestamps
 * are intentionally ignored for expiry and ordering.
 *
 * `snapshot(chatId, { threadRootId?, maxRecords?, maxBytes? })` returns
 * copies in receipt order. A top-level request sees top-level records only; a
 * threaded request sees its retained root plus records from that same thread.
 */
export function createT3amsChannelContext({
  enabled = T3AMS_CHANNEL_CONTEXT_DEFAULTS.enabled,
  ttlMs = T3AMS_CHANNEL_CONTEXT_DEFAULTS.ttlMs,
  maxChats = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxChats,
  maxRecordsPerChat = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxRecordsPerChat,
  maxBytesPerChat = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxBytesPerChat,
  maxRecordBytes = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxRecordBytes,
  maxRecordsPerSender = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxRecordsPerSender,
  maxBytesPerSender = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxBytesPerSender,
  maxTotalBytes = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxTotalBytes,
  maxSenderNameBytes = T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxSenderNameBytes,
  now = () => Date.now(),
  isValidChat = (chatId) => CHANNEL_CHAT_RE.test(chatId),
} = {}) {
  const chatLimit = positiveInteger(maxChats, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxChats);
  const recordsPerChat = positiveInteger(maxRecordsPerChat, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxRecordsPerChat);
  const totalBytesLimit = positiveInteger(maxTotalBytes, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxTotalBytes);
  const bytesPerChat = Math.min(
    positiveInteger(maxBytesPerChat, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxBytesPerChat),
    totalBytesLimit,
  );
  const recordsPerSender = Math.min(
    positiveInteger(maxRecordsPerSender, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxRecordsPerSender),
    recordsPerChat,
  );
  const bytesPerSender = Math.min(
    positiveInteger(maxBytesPerSender, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxBytesPerSender),
    bytesPerChat,
  );
  const recordBytesLimit = Math.min(
    positiveInteger(maxRecordBytes, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxRecordBytes),
    bytesPerSender,
  );
  const senderNameBytesLimit = Math.min(
    positiveInteger(maxSenderNameBytes, T3AMS_CHANNEL_CONTEXT_DEFAULTS.maxSenderNameBytes),
    recordBytesLimit,
  );
  const lifetimeMs = nonNegativeInteger(ttlMs, T3AMS_CHANNEL_CONTEXT_DEFAULTS.ttlMs);
  const chats = new Map(); // insertion order is the context-chat LRU.
  let totalBytes = 0;
  let sequence = 0;
  let lastReceiptAt = 0;

  const receiptNow = () => {
    try {
      const value = Number(now());
      if (Number.isSafeInteger(value) && value >= 0) {
        lastReceiptAt = Math.max(lastReceiptAt, value);
        return lastReceiptAt;
      }
    } catch {
      // Fall through to a locally sourced timestamp.
    }
    lastReceiptAt = Math.max(lastReceiptAt, Date.now());
    return lastReceiptAt;
  };

  const removeChat = (chatId) => {
    const chat = chats.get(chatId);
    if (chat == null) return false;
    totalBytes -= chat.bytes;
    chats.delete(chatId);
    return true;
  };

  const removeAt = (chat, index) => {
    const [removed] = chat.entries.splice(index, 1);
    if (removed == null) return false;
    chat.bytes -= removed.bytes;
    totalBytes -= removed.bytes;
    return true;
  };

  const touch = (chatId) => {
    const chat = chats.get(chatId);
    if (chat == null) return null;
    chats.delete(chatId);
    chats.set(chatId, chat);
    return chat;
  };

  const senderTotals = (chat) => {
    const totals = new Map();
    for (const entry of chat.entries) {
      const prior = totals.get(entry.senderXid) ?? { records: 0, bytes: 0 };
      prior.records += 1;
      prior.bytes += entry.bytes;
      totals.set(entry.senderXid, prior);
    }
    return totals;
  };

  const trimChat = (chat) => {
    // Enforce per-sender fairness first. A noisy sender loses its oldest
    // records before it can displace everyone else's recent context.
    for (;;) {
      const totals = senderTotals(chat);
      const offender = [...totals.entries()].find(([, total]) => total.records > recordsPerSender || total.bytes > bytesPerSender)?.[0] ?? null;
      if (offender == null) break;
      const index = chat.entries.findIndex((entry) => entry.senderXid === offender);
      if (index < 0) break;
      removeAt(chat, index);
    }
    while (chat.entries.length > recordsPerChat || chat.bytes > bytesPerChat) removeAt(chat, 0);
  };

  const trimGlobal = () => {
    while (chats.size > chatLimit) removeChat(chats.keys().next().value);
    // Preserve the newest observed material globally. The per-chat Map still
    // supplies LRU chat eviction when the number of active chats is bounded.
    while (totalBytes > totalBytesLimit) {
      let candidate = null;
      for (const [chatId, chat] of chats) {
        const entry = chat.entries[0];
        if (entry == null) continue;
        if (candidate == null || entry.sequence < candidate.entry.sequence) candidate = { chatId, chat, entry };
      }
      if (candidate == null) break;
      removeAt(candidate.chat, 0);
      if (candidate.chat.entries.length === 0) chats.delete(candidate.chatId);
    }
  };

  const pruneExpired = (current) => {
    for (const [chatId, chat] of chats) {
      for (let index = chat.entries.length - 1; index >= 0; index -= 1) {
        if (lifetimeMs === 0 || current - chat.entries[index].receivedAt >= lifetimeMs) removeAt(chat, index);
      }
      if (chat.entries.length === 0) chats.delete(chatId);
    }
    trimGlobal();
  };

  const normalizeRecord = (raw, receivedAt) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { record: null, reason: "invalid-record" };
    const messageId = normalizeXid(raw.messageId ?? raw.id);
    const senderXid = normalizeXid(raw.senderXid);
    const threadRootId = raw.threadRootId == null ? null : normalizeXid(raw.threadRootId);
    if (messageId == null || senderXid == null || (raw.threadRootId != null && threadRootId == null) || typeof raw.text !== "string") {
      return { record: null, reason: "invalid-record" };
    }
    if (byteLength(raw.text) === 0) return { record: null, reason: "empty-text" };
    const senderName = normalizeName(raw.senderName, senderNameBytesLimit);
    const bytes = RECORD_OVERHEAD_BYTES
      + byteLength(messageId)
      + byteLength(senderXid)
      + byteLength(raw.text)
      + (senderName == null ? 0 : byteLength(senderName))
      + (threadRootId == null ? 0 : byteLength(threadRootId));
    if (bytes > recordBytesLimit) return { record: null, reason: "record-too-large" };
    return {
      record: {
        messageId,
        senderXid,
        senderName,
        text: raw.text,
        threadRootId,
        receivedAt,
        sequence: sequence + 1,
        bytes,
      },
      reason: null,
    };
  };

  const ensureChat = (chatId) => {
    const existing = touch(chatId);
    if (existing != null) return existing;
    while (chats.size >= chatLimit) removeChat(chats.keys().next().value);
    const chat = { entries: [], bytes: 0 };
    chats.set(chatId, chat);
    return chat;
  };

  const snapshotLimit = (value, fallback, maximum) => {
    if (value == null) return fallback;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, maximum) : fallback;
  };

  return {
    append(chatId, raw) {
      if (enabled !== true) return { accepted: false, reason: "disabled" };
      const normalizedChatId = normalizeChatId(chatId, isValidChat);
      if (normalizedChatId == null) return { accepted: false, reason: "invalid-chat" };
      const current = receiptNow();
      pruneExpired(current);
      const normalized = normalizeRecord(raw, current);
      if (normalized.record == null) return { accepted: false, reason: normalized.reason };
      const existing = chats.get(normalizedChatId);
      if (existing?.entries.some((entry) => entry.messageId === normalized.record.messageId)) {
        return { accepted: false, reason: "duplicate" };
      }
      const chat = ensureChat(normalizedChatId);
      sequence += 1;
      chat.entries.push(normalized.record);
      chat.bytes += normalized.record.bytes;
      totalBytes += normalized.record.bytes;
      trimChat(chat);
      if (chat.entries.length === 0) chats.delete(normalizedChatId);
      trimGlobal();
      const retained = chats.get(normalizedChatId)?.entries.find((entry) => entry.messageId === normalized.record.messageId) ?? null;
      return retained == null
        ? { accepted: false, reason: "capacity" }
        : { accepted: true, record: publicRecord(retained) };
    },

    snapshot(chatId, { threadRootId = null, maxRecords = null, maxBytes = null } = {}) {
      if (enabled !== true) return [];
      const normalizedChatId = normalizeChatId(chatId, isValidChat);
      const normalizedRoot = threadRootId == null ? null : normalizeXid(threadRootId);
      if (normalizedChatId == null || (threadRootId != null && normalizedRoot == null)) return [];
      pruneExpired(receiptNow());
      const chat = touch(normalizedChatId);
      if (chat == null) return [];
      const recordLimit = snapshotLimit(maxRecords, recordsPerChat, recordsPerChat);
      const byteLimit = snapshotLimit(maxBytes, bytesPerChat, bytesPerChat);
      if (recordLimit === 0 || byteLimit === 0) return [];
      const relevant = normalizedRoot == null
        ? chat.entries.filter((entry) => entry.threadRootId == null)
        : chat.entries.filter((entry) => entry.threadRootId === normalizedRoot
          || (entry.threadRootId == null && entry.messageId === normalizedRoot));
      const root = normalizedRoot == null
        ? null
        : relevant.find((entry) => entry.threadRootId == null && entry.messageId === normalizedRoot) ?? null;
      const chosen = [];
      let usedBytes = 0;
      if (root != null && root.bytes <= byteLimit) {
        chosen.push(root);
        usedBytes += root.bytes;
      }
      // Take the newest relevant records that fit, but return chronological
      // receipt order. The thread root remains pinned when it fits.
      for (let index = relevant.length - 1; index >= 0; index -= 1) {
        const entry = relevant[index];
        if (entry === root || chosen.length >= recordLimit || usedBytes + entry.bytes > byteLimit) continue;
        chosen.push(entry);
        usedBytes += entry.bytes;
      }
      return chosen.sort((left, right) => left.sequence - right.sequence).map(publicRecord);
    },

    clear(chatId) {
      const normalizedChatId = normalizeChatId(chatId, isValidChat);
      return normalizedChatId != null && removeChat(normalizedChatId);
    },

    prune() {
      pruneExpired(receiptNow());
    },

    stats() {
      pruneExpired(receiptNow());
      let records = 0;
      for (const chat of chats.values()) records += chat.entries.length;
      return {
        enabled: enabled === true,
        chats: chats.size,
        records,
        bytes: totalBytes,
        limits: {
          ttlMs: lifetimeMs,
          maxChats: chatLimit,
          maxRecordsPerChat: recordsPerChat,
          maxBytesPerChat: bytesPerChat,
          maxRecordBytes: recordBytesLimit,
          maxRecordsPerSender: recordsPerSender,
          maxBytesPerSender: bytesPerSender,
          maxTotalBytes: totalBytesLimit,
        },
      };
    },

    chatIds() {
      pruneExpired(receiptNow());
      return [...chats.keys()];
    },
  };
}
