// Bounded LRU index for direct-agent session state.
//
// The T3ams transport owns a durable ingress journal. A chat represented by
// that journal must survive state-index eviction until the journal is acked;
// otherwise a process restart could lose the native agent session associated
// with an in-flight turn. All other idle chat state is intentionally best
// effort and ages out in least-recently-used order.

const positiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : fallback;
};

export function createT3amsKnownChats({
  cap = 500,
  isProtected = () => false,
  isValid = () => true,
} = {}) {
  const limit = positiveInteger(cap, 500);
  const chats = new Map();

  const trim = () => {
    while (chats.size > limit) {
      let victim = null;
      for (const chatId of chats.keys()) {
        if (!isProtected(chatId)) {
          victim = chatId;
          break;
        }
      }
      // The only permitted overflow is a bounded set of durable ingress
      // chats. The caller invokes trim again when an ingress item completes.
      if (victim == null) break;
      chats.delete(victim);
    }
  };

  return {
    note(chatId) {
      if (!isValid(chatId)) return false;
      chats.delete(chatId);
      chats.set(chatId, true);
      trim();
      return chats.has(chatId);
    },
    trim,
    keys: () => [...chats.keys()],
    has: (chatId) => chats.has(chatId),
    size: () => chats.size,
  };
}
