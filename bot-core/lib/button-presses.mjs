// Spec 0006 recipient rule for a buttonPress: accept it only from the peer
// the buttons message went to, and only for a messageId the bot sent. This
// ledger remembers, per peer, the bot's own recent buttons messages (their
// labels), so a press can be checked and turned into brain input.

export const SENT_BUTTONS_CAP_PER_PEER = 50;

const labelsOf = (rows) => rows.map((row) => row.map((button) => String(button.label)));
const validLabels = (rows) => Array.isArray(rows)
  && rows.every((row) => Array.isArray(row) && row.every((label) => typeof label === "string"));

export const createSentButtons = ({ cap = SENT_BUTTONS_CAP_PER_PEER, maxPeers = 10_000 } = {}) => {
  const peers = new Map(); // peerHex -> Map<messageId, labels[][]> (oldest first)
  const put = (peerHex, messageId, labels) => {
    let sent = peers.get(peerHex);
    if (!sent) {
      sent = new Map();
      peers.set(peerHex, sent);
      while (peers.size > maxPeers) peers.delete(peers.keys().next().value);
    }
    sent.delete(messageId);
    sent.set(messageId, labels);
    while (sent.size > cap) sent.delete(sent.keys().next().value);
  };
  return {
    // The bot sent buttons message `messageId` to peerHex.
    record(peerHex, messageId, rows) { put(peerHex, messageId, labelsOf(rows)); },
    // The pressed button's label, or null: not a message the bot sent to
    // THIS peer (foreign or unknown), or no button at row/index.
    label(peerHex, messageId, row, index) {
      return peers.get(peerHex)?.get(messageId)?.[row]?.[index] ?? null;
    },
    snapshot(peerHex) {
      const sent = peers.get(peerHex);
      return sent?.size ? [...sent.entries()] : null;
    },
    restore(peerHex, saved) {
      if (!Array.isArray(saved)) return;
      for (const entry of saved.slice(-cap)) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && validLabels(entry[1])) put(peerHex, entry[0], entry[1]);
      }
    },
  };
};

// The brain's input for a press: "[button] <label>", plus the callback bytes
// as hex when the press carries any.
export const buttonPressText = (label, payload) => {
  const hex = Array.from(payload ?? [], (b) => b.toString(16).padStart(2, "0")).join("");
  return hex ? `[button] ${label} (payload: ${hex})` : `[button] ${label}`;
};
