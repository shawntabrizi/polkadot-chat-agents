// Stable native-agent session keys for T3ams conversations.
//
// The transport sends and edits through its base DM/channel key. A model
// session may be narrower: each thread gets a deterministic child key so its
// Claude/Codex/OpenCode resume token cannot pull in unrelated thread history.

const CHAT_KEY_RE = /^t3ams:dm:[0-9a-f]{64}$/i;
const CHANNEL_KEY_RE = /^t3ams:channel:[0-9a-f]{64}:[0-9a-f]{64}$/i;
const THREAD_MARKER = ":thread:";
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export const isT3amsConversationKey = (chatId) => typeof chatId === "string"
  && (CHAT_KEY_RE.test(chatId) || CHANNEL_KEY_RE.test(chatId));

const validThreadRoot = (value) => typeof value === "string"
  && value.length > 0
  && value === value.trim()
  && value.length <= 512
  && !CONTROL_RE.test(value);

export const agentSessionKeyForT3ams = (chatId, threadRootId) => {
  if (!isT3amsConversationKey(chatId)) return null;
  if (threadRootId == null) return chatId;
  const root = String(threadRootId);
  if (!validThreadRoot(root)) return null;
  return `${chatId}${THREAD_MARKER}${encodeURIComponent(root)}`;
};

/** Return the valid delivery conversation encoded by a native session key. */
export const conversationForAgentSessionKey = (sessionKey) => {
  if (isT3amsConversationKey(sessionKey)) return sessionKey;
  if (typeof sessionKey !== "string") return null;
  const at = sessionKey.indexOf(THREAD_MARKER);
  if (at < 0 || sessionKey.indexOf(THREAD_MARKER, at + THREAD_MARKER.length) >= 0) return null;
  const chatId = sessionKey.slice(0, at);
  const encodedRoot = sessionKey.slice(at + THREAD_MARKER.length);
  if (!isT3amsConversationKey(chatId) || !encodedRoot) return null;
  try {
    const root = decodeURIComponent(encodedRoot);
    return validThreadRoot(root) && encodeURIComponent(root) === encodedRoot ? chatId : null;
  } catch {
    return null;
  }
};
