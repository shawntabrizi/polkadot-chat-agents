// Outbound message timestamps that never sort before what the peer just sent.
//
// The app orders a chat by each message's embedded timestamp. A slash-command
// reply leaves within milliseconds, so a phone clock a little ahead of ours
// put the reply ABOVE the command it answered. Stamp our messages at
// max(now, newest inbound timestamp from that peer + 1) and keep them
// monotonic per peer; we never rewind below real time.
export const createPeerClock = ({ now = () => Date.now(), maxPeers = 10_000 } = {}) => {
  const floors = new Map(); // peerKey -> newest millisecond timestamp seen or issued
  const remember = (peerKey, value) => {
    floors.delete(peerKey);
    floors.set(peerKey, value);
    if (floors.size > maxPeers) floors.delete(floors.keys().next().value);
  };
  return {
    // Called for every decoded inbound message (any kind, not only text).
    observe(peerKey, timestamp) {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || ts <= 0) return;
      // Ignore absurd future stamps: a broken peer clock must not push our
      // replies days ahead (and past the store's expiry ordering).
      if (ts - now() > 24 * 60 * 60 * 1000) return;
      if (ts > (floors.get(peerKey) ?? 0)) remember(peerKey, ts);
    },
    // Timestamp for the next message we send to the peer.
    next(peerKey) {
      const value = Math.max(now(), (floors.get(peerKey) ?? 0) + 1);
      remember(peerKey, value);
      return BigInt(value);
    },
    restore(entries) { for (const [peerKey, ts] of entries ?? []) this.observe(peerKey, ts); },
    snapshot() { return [...floors.entries()]; },
  };
};
