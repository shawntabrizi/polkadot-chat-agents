// T3ams routing policy for events that have already been decrypted and
// authenticated by a transport.  This module deliberately contains no BCTS,
// Statement Store, or brain-runtime dependency: it gives a transport one
// stable conversation key, one answer target, and the group-mention gate that
// makes it safe to hand an event to a brain.
//
// Accepted input shape (camelCase is preferred; the corresponding snake_case
// fields are accepted to make bridge adapters trivial):
// {
//   conversationType: "dm" | "channel", senderXid, senderName,
//   workspaceId, channelId, messageId, text, threadRootId, mentions
// }
// `mentions` is an optional array of XID strings or `{ xid }` objects supplied
// by a rich-text decoder.  Structured mentions take precedence over the plain
// text fallback, which recognizes `@alias` tokens.

export const MAX_T3AMS_ID_LENGTH = 512;
export const MAX_T3AMS_TEXT_BYTES = 64 * 1024;

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MENTION_BOUNDARY_RE = "[^\\p{L}\\p{N}_-]";

const id = (value, max = MAX_T3AMS_ID_LENGTH) => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return null;
  if (value.trim() !== value || CONTROL_RE.test(value)) return null;
  return value;
};

const optionalName = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_T3AMS_ID_LENGTH || CONTROL_RE.test(trimmed)) return null;
  return trimmed;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const conversationTypeOf = (event = {}) => {
  const value = firstDefined(event.conversationType, event.conversation_type, event.conversation?.type);
  if (value === "dm" || value === "direct") return "dm";
  if (value === "channel" || value === "group") return "channel";
  return null;
};

const fieldsOf = (event = {}) => ({
  conversationType: conversationTypeOf(event),
  senderXid: id(firstDefined(event.senderXid, event.sender_xid, event.sender?.xid)),
  senderName: optionalName(firstDefined(event.senderName, event.sender_name, event.sender?.name)),
  workspaceId: id(firstDefined(event.workspaceId, event.workspace_id, event.conversation?.workspaceId, event.conversation?.workspace_id)),
  channelId: id(firstDefined(event.channelId, event.channel_id, event.conversation?.channelId, event.conversation?.channel_id)),
  messageId: id(firstDefined(event.messageId, event.message_id, event.id)),
  threadRootId: id(firstDefined(event.threadRootId, event.thread_root_id, event.thread?.rootId, event.thread?.root_id)),
  text: typeof event.text === "string" ? event.text : null,
  kind: firstDefined(event.kind, event.contentType, event.content_type, "text"),
  mentions: Array.isArray(event.mentions) ? event.mentions : [],
});

const segment = (value) => encodeURIComponent(value);

const bareHex = (value) => String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();
const isT3amsHexId = (value) => /^[0-9a-f]{64}$/.test(bareHex(value));

// Runtime session state must be shared by every thread in a channel, but
// never by two different channels (or a channel and a direct message).  The
// escaping makes arbitrary valid protocol IDs unambiguous in persisted keys.
export const conversationKeyFor = (event) => {
  const fields = fieldsOf(event);
  if (fields.conversationType === "dm" && fields.senderXid) return `t3ams:dm:${segment(fields.senderXid)}`;
  if (fields.conversationType === "channel" && fields.workspaceId && fields.channelId) {
    return `t3ams:channel:${segment(fields.workspaceId)}:${segment(fields.channelId)}`;
  }
  return null;
};

// A response always addresses the triggering message.  When it arrived in a
// thread, retaining the root lets the transport publish into that same thread
// instead of creating a new channel-level reply.
export const replyTargetFor = (event) => {
  const fields = fieldsOf(event);
  if (!fields.messageId) return null;
  return {
    replyToMessageId: fields.messageId,
    threadRootId: fields.threadRootId,
  };
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const alias = (value) => {
  const raw = optionalName(value);
  if (!raw) return null;
  const withoutAt = raw.startsWith("@") ? raw.slice(1) : raw;
  return withoutAt ? withoutAt.normalize("NFKC") : null;
};

const botAliases = (bot = {}) => {
  const values = [bot.xid, ...(Array.isArray(bot.aliases) ? bot.aliases : [])]
    .map(alias)
    .filter(Boolean);
  return [...new Set(values.map((value) => value.toLocaleLowerCase("en-US")))];
};

const mentionXid = (mention) => {
  if (typeof mention === "string") return id(mention.startsWith("@") ? mention.slice(1) : mention);
  if (mention && typeof mention === "object") return id(mention.xid);
  return null;
};

// Structured mentions are exact XID matches.  The text fallback is intentionally
// token-boundary-aware: `person@bot.example` and `@bot-helper` must not wake a
// bot called `bot`, while `(@bot), please help` does.
export const isExplicitBotMention = (event, bot) => {
  const fields = fieldsOf(event);
  const botXid = id(bot?.xid);
  if (!botXid) return false;
  if (fields.mentions.some((mention) => mentionXid(mention) === botXid)) return true;
  if (typeof fields.text !== "string") return false;
  for (const value of botAliases(bot)) {
    const pattern = new RegExp(`(?:^|${MENTION_BOUNDARY_RE})@${escapeRegExp(value)}(?=$|${MENTION_BOUNDARY_RE})`, "iu");
    if (pattern.test(fields.text)) return true;
  }
  return false;
};

// Channel commands are normally addressed as `@bot /help`.  The mention is
// necessary to wake the bot, but the direct-agent command parser deliberately
// accepts only a leading slash.  Keep the original text intact for the model
// and derive this separate command candidate only when the visible invocation
// starts with one of our own aliases.  Structured mention metadata has no
// source-text offsets, so it is not enough on its own to safely trim text.
export const commandTextAfterLeadingBotMention = (text, bot) => {
  if (typeof text !== "string") return null;
  // `dotbot.41` must be tested before `dotbot`: a dot is a mention boundary,
  // and a short alias must not consume just the prefix of the longer alias.
  const aliases = botAliases(bot).sort((left, right) => right.length - left.length);
  for (const value of aliases) {
    const pattern = new RegExp(
      `^\\s*@${escapeRegExp(value)}(?=$|${MENTION_BOUNDARY_RE})(?:[\\s,:;!?]+)?`,
      "iu",
    );
    const match = pattern.exec(text);
    if (match == null) continue;
    const candidate = text.slice(match[0].length).trimStart();
    if (candidate.startsWith("/")) return candidate;
  }
  return null;
};

const ignored = (reason) => ({ accepted: false, reason });

// Normalize a single already-verified inbound event for the direct runtime or
// HTTP bridge.  Authorization (workspace membership / allowlist) remains the
// transport's responsibility; this function only enforces message shape and
// the product rule that group messages need an explicit bot mention.
export const normalizeT3amsInbound = (event, bot, {
  requireMentionInChannels = true,
  allowTextMentions = true,
} = {}) => {
  const fields = fieldsOf(event);
  const conversationKey = conversationKeyFor(event);
  const replyTarget = replyTargetFor(event);
  const botXid = id(bot?.xid);

  if (!conversationKey) return ignored("invalid-conversation");
  if (!replyTarget || !fields.senderXid) return ignored("invalid-message");
  if (fields.kind !== "text") return ignored("unsupported-content");
  if (fields.text === null || Buffer.byteLength(fields.text, "utf8") > MAX_T3AMS_TEXT_BYTES) return ignored("invalid-text");
  if (botXid && fields.senderXid === botXid) return ignored("self-message");

  if (fields.conversationType === "channel" && requireMentionInChannels) {
    const mentioned = allowTextMentions
      ? isExplicitBotMention(event, bot)
      : fields.mentions.some((mention) => mentionXid(mention) === botXid);
    if (!mentioned) return ignored("unmentioned-channel-message");
  }

  const commandText = fields.conversationType === "channel"
    ? commandTextAfterLeadingBotMention(fields.text, bot)
    : null;

  return {
    accepted: true,
    conversationKey,
    replyTarget,
    message: {
      kind: "text",
      messageId: fields.messageId,
      text: fields.text,
      ...(commandText != null ? { commandText } : {}),
      conversationType: fields.conversationType,
      workspaceId: fields.workspaceId,
      channelId: fields.channelId,
      threadRootId: fields.threadRootId,
      senderXid: fields.senderXid,
      senderName: fields.senderName,
    },
  };
};

// Restore a durable direct-runtime ingress entry without trusting any stored
// routing metadata. The original inbound event was authenticated before it was
// journaled, but the journal can outlive a process and must still be bounded
// and self-consistent before it reaches a brain. `commandText` is optional for
// backwards compatibility with entries saved before mentioned commands were
// added; when present, only a leading slash is a valid command candidate.
export const restoreT3amsIngressRoute = (raw) => {
  const message = raw?.message;
  if (raw?.accepted !== true || message == null || typeof message !== "object") return null;
  const conversationType = message.conversationType;
  const senderXid = bareHex(message.senderXid);
  const messageId = bareHex(message.messageId);
  const workspaceId = message.workspaceId == null ? null : bareHex(message.workspaceId);
  const channelId = message.channelId == null ? null : bareHex(message.channelId);
  const threadRootId = message.threadRootId == null ? null : bareHex(message.threadRootId);
  if (!isT3amsHexId(senderXid) || !isT3amsHexId(messageId) || typeof message.text !== "string"
      || Buffer.byteLength(message.text, "utf8") > MAX_T3AMS_TEXT_BYTES
      || (threadRootId != null && !isT3amsHexId(threadRootId))) return null;
  if (conversationType !== "dm" && conversationType !== "channel") return null;
  if (conversationType === "channel" && (!isT3amsHexId(workspaceId) || !isT3amsHexId(channelId))) return null;
  const conversationKey = conversationType === "dm"
    ? `t3ams:dm:${senderXid}`
    : `t3ams:channel:${workspaceId}:${channelId}`;
  if (raw.conversationKey !== conversationKey) return null;
  const senderName = typeof message.senderName === "string" && message.senderName.length <= 512
    ? message.senderName
    : null;
  const commandText = typeof message.commandText === "string"
    && message.commandText.startsWith("/")
    && Buffer.byteLength(message.commandText, "utf8") <= MAX_T3AMS_TEXT_BYTES
    ? message.commandText
    : null;
  return {
    accepted: true,
    conversationKey,
    replyTarget: { replyToMessageId: messageId, threadRootId },
    message: {
      kind: "text",
      messageId,
      text: message.text,
      ...(commandText == null ? {} : { commandText }),
      conversationType,
      workspaceId,
      channelId,
      threadRootId,
      senderXid,
      senderName,
    },
  };
};

// The bridge's public payload is snake_case, whereas the direct runtime uses
// the camelCase `message` above.  Keeping this adapter here prevents every
// transport implementation from subtly omitting the new context fields.
export const toT3amsBridgeInbound = (routed) => {
  if (!routed?.accepted) return null;
  const { message, conversationKey, replyTarget } = routed;
  return {
    chat_id: conversationKey,
    kind: message.kind,
    message_id: message.messageId,
    text: message.text,
    conversation_type: message.conversationType,
    sender_xid: message.senderXid,
    ...(message.senderName ? { sender_name: message.senderName } : {}),
    ...(message.workspaceId ? { workspace_id: message.workspaceId } : {}),
    ...(message.channelId ? { channel_id: message.channelId } : {}),
    ...(replyTarget.threadRootId ? { thread_root_id: replyTarget.threadRootId } : {}),
  };
};
