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
export const MAX_T3AMS_ATTACHMENT_COUNT = 4;
export const MAX_T3AMS_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_T3AMS_CHANNEL_CONTEXT_RECORDS = 64;
export const MAX_T3AMS_CHANNEL_CONTEXT_BYTES = 64 * 1024;

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MENTION_BOUNDARY_RE = "[^\\p{L}\\p{N}_-]";
const HEX_32_RE = /^[0-9a-f]{64}$/;
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

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
  attachments: Array.isArray(event.attachments) ? event.attachments : [],
  attachmentError: typeof event.attachmentError === "string" ? event.attachmentError : null,
  channelContext: event.channelContext ?? event.channel_context ?? null,
});

const segment = (value) => encodeURIComponent(value);

const bareHex = (value) => String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();
const isT3amsHexId = (value) => /^[0-9a-f]{64}$/.test(bareHex(value));

// Protocol has already validated raw AttachmentRefs before this routing layer
// sees them. Revalidate the tiny serialized form here because it crosses the
// durable ingress journal; the claim ticket is intentionally retained only in
// that private journal and never forwarded to a bridge client.
const normalizeAttachment = (raw) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = bareHex(raw.id);
  const hopId = bareHex(raw.hopId);
  const ticket = bareHex(raw.claimTicketHex);
  const contentHash = bareHex(raw.contentHashHex);
  const attachmentId = bareHex(raw.attachmentIdHex);
  const mime = typeof raw.mime === "string" ? raw.mime.toLowerCase() : "";
  const size = Number(raw.size);
  const filename = typeof raw.filename === "string" ? raw.filename : "";
  if (!HEX_32_RE.test(id) || !HEX_32_RE.test(hopId) || id !== hopId || !HEX_32_RE.test(ticket)
      || !HEX_32_RE.test(contentHash) || !HEX_32_RE.test(attachmentId)
      || (raw.kind !== "image" && raw.kind !== "document") || !MIME_RE.test(mime)
      || !Number.isSafeInteger(size) || size < 0 || size > MAX_T3AMS_ATTACHMENT_BYTES
      || !filename || Buffer.byteLength(filename, "utf8") > 255 || CONTROL_RE.test(filename) || /[\\/]/.test(filename)) return null;
  const width = raw.width == null ? null : Number(raw.width);
  const height = raw.height == null ? null : Number(raw.height);
  if ((width == null) !== (height == null)
      || (width != null && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 100_000 || height > 100_000))) return null;
  return {
    id, hopId, claimTicketHex: ticket, contentHashHex: contentHash, attachmentIdHex: attachmentId,
    kind: raw.kind, mime, size, filename,
    ...(width == null ? {} : { width, height }),
  };
};

const normalizeAttachments = (raw) => {
  if (!Array.isArray(raw) || raw.length > MAX_T3AMS_ATTACHMENT_COUNT) return null;
  const seen = new Set();
  const attachments = [];
  for (const item of raw) {
    const attachment = normalizeAttachment(item);
    if (attachment == null || seen.has(attachment.id)) return null;
    seen.add(attachment.id);
    attachments.push(attachment);
  }
  return attachments;
};

const safeAttachmentError = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text && Buffer.byteLength(text, "utf8") <= 512 && !CONTROL_RE.test(text) ? text : null;
};

// Channel context is a local, bounded snapshot made only from already
// authenticated unmentioned channel messages. It crosses the durable ingress
// journal, so validate it independently and deliberately exclude attachments
// and other capability-bearing metadata.
const normalizeChannelContext = (raw, conversationType) => {
  if (raw == null) return [];
  if (conversationType !== "channel" || !Array.isArray(raw) || raw.length > MAX_T3AMS_CHANNEL_CONTEXT_RECORDS) return null;
  const result = [];
  const seen = new Set();
  let bytes = 0;
  for (const item of raw) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) return null;
    const messageId = bareHex(item.messageId ?? item.id);
    const senderXid = bareHex(item.senderXid);
    const text = typeof item.text === "string" ? item.text : null;
    const threadRootId = item.threadRootId == null ? null : bareHex(item.threadRootId);
    const senderName = item.senderName == null ? null : optionalName(item.senderName);
    if (!isT3amsHexId(messageId) || !isT3amsHexId(senderXid) || text == null || text === ""
        || Buffer.byteLength(text, "utf8") > MAX_T3AMS_TEXT_BYTES
        || (threadRootId != null && !isT3amsHexId(threadRootId)) || seen.has(messageId)) return null;
    const recordBytes = Buffer.byteLength(text, "utf8")
      + Buffer.byteLength(messageId, "utf8")
      + Buffer.byteLength(senderXid, "utf8")
      + (senderName == null ? 0 : Buffer.byteLength(senderName, "utf8"))
      + (threadRootId == null ? 0 : Buffer.byteLength(threadRootId, "utf8"));
    bytes += recordBytes;
    if (bytes > MAX_T3AMS_CHANNEL_CONTEXT_BYTES) return null;
    seen.add(messageId);
    result.push({
      messageId,
      senderXid,
      senderName,
      text,
      threadRootId,
    });
  }
  return result;
};

const attachmentPlaceholder = (attachments, attachmentError) => {
  if (attachments.length > 0) return attachments.map((attachment) => {
    const kind = attachment.kind === "image" ? "photo" : "file";
    const size = attachment.size >= 1024 * 1024
      ? `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(attachment.size / 1024))} KB`;
    return `[${kind}, ${attachment.mime}, ${size}]`;
  }).join(" ");
  return attachmentError == null ? "" : "[attached file unavailable]";
};

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
  const attachments = normalizeAttachments(fields.attachments);
  const attachmentError = safeAttachmentError(fields.attachmentError);
  const channelContext = normalizeChannelContext(fields.channelContext, fields.conversationType);

  if (!conversationKey) return ignored("invalid-conversation");
  if (!replyTarget || !fields.senderXid) return ignored("invalid-message");
  if (fields.kind !== "text" && fields.kind !== "richText") return ignored("unsupported-content");
  if (attachments == null) return ignored("invalid-attachments");
  if (channelContext == null) return ignored("invalid-channel-context");
  if (fields.text === null || Buffer.byteLength(fields.text, "utf8") > MAX_T3AMS_TEXT_BYTES) return ignored("invalid-text");
  if (fields.text === "" && attachments.length === 0 && attachmentError == null) return ignored("invalid-text");
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
  const text = fields.text || attachmentPlaceholder(attachments, attachmentError);

  return {
    accepted: true,
    conversationKey,
    replyTarget,
    message: {
      kind: attachments.length > 0 || attachmentError != null ? "richText" : "text",
      messageId: fields.messageId,
      text,
      ...(commandText != null ? { commandText } : {}),
      conversationType: fields.conversationType,
      workspaceId: fields.workspaceId,
      channelId: fields.channelId,
      threadRootId: fields.threadRootId,
      senderXid: fields.senderXid,
      senderName: fields.senderName,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(attachmentError == null ? {} : { attachmentError }),
      ...(channelContext.length > 0 ? { channelContext } : {}),
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
  const attachments = normalizeAttachments(message.attachments ?? []);
  const attachmentError = safeAttachmentError(message.attachmentError);
  if (!isT3amsHexId(senderXid) || !isT3amsHexId(messageId) || typeof message.text !== "string"
      || Buffer.byteLength(message.text, "utf8") > MAX_T3AMS_TEXT_BYTES
      || attachments == null
      || (message.text === "" && attachments.length === 0 && attachmentError == null)
      || (threadRootId != null && !isT3amsHexId(threadRootId))) return null;
  if ((message.kind != null && message.kind !== "text" && message.kind !== "richText")
      || (conversationType !== "dm" && conversationType !== "channel")) return null;
  if (conversationType === "channel" && (!isT3amsHexId(workspaceId) || !isT3amsHexId(channelId))) return null;
  const channelContext = normalizeChannelContext(message.channelContext ?? message.channel_context ?? null, conversationType);
  if (channelContext == null) return null;
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
      kind: attachments.length > 0 || attachmentError != null ? "richText" : "text",
      messageId,
      text: message.text,
      ...(commandText == null ? {} : { commandText }),
      conversationType,
      workspaceId,
      channelId,
      threadRootId,
      senderXid,
      senderName,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(attachmentError == null ? {} : { attachmentError }),
      ...(channelContext.length > 0 ? { channelContext } : {}),
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
    ...(message.attachments?.length ? {
      // No claim ticket / raw `hop:` URL crosses the bridge boundary. The
      // bridge may learn that a file exists, but bytes stay in the transport's
      // private media cache and a future authenticated /media route.
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        mime: attachment.mime,
        size: attachment.size,
        filename: attachment.filename,
        ...(attachment.width == null ? {} : { width: attachment.width, height: attachment.height }),
      })),
    } : {}),
    ...(message.attachmentError ? { attachment_error: message.attachmentError } : {}),
    ...(message.channelContext?.length ? {
      channel_context: message.channelContext.map((record) => ({
        message_id: record.messageId,
        sender_xid: record.senderXid,
        ...(record.senderName ? { sender_name: record.senderName } : {}),
        text: record.text,
        ...(record.threadRootId ? { thread_root_id: record.threadRootId } : {}),
      })),
    } : {}),
  };
};
