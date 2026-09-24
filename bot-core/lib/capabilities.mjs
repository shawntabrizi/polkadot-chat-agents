// Spec 0013 capabilities (polkadot-chat-desktop docs/spec/0013-capabilities.md)
// and the owner ruling on baseline clients (2026-09-24): each device tells its
// peers which content kinds, FileVariants and HOP dialects it supports, and a
// sender sends an extension kind to a device only after that device listed it.
// A device that never sent `capabilities` is a baseline client (the phone
// apps): base-spec content only. This retires the development-mode rule
// "send every extension to every peer" for this bot.
//
// Small pieces, kept apart from index.mjs so the rules are unit-tested:
//  - ownCapabilities: the bot's own set, from its enabled extensions and rails.
//  - createPeerCapabilities: the store, per peer device, and `effective`, the
//    intersection over every known device of a peer (Signal's ALL_DEVICES
//    mode, done by the sender).
//  - createCapabilitiesSent: which set each peer has received, so the bot
//    sends its own once per chat and again only when the set changes.
//  - chooseAttachmentRail: 0014 "Sending" for one DM file.
//
// Keying: a set is stored under the sending device's statement account, which
// the statement's topic names (a device session's peerStatementAccountId). A
// statement on the identity session names no device; there the set is keyed
// by a device the same batch accepted with (deviceChatAccepted), else by the
// peer's identity account, which is the roster entry of a peer whose devices
// are not known yet.

import { CAPABILITY_FEATURES, FILE_VARIANTS, HOP_DIALECTS } from "../vendor/app-chat-codec.mjs";

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// 0013 "The baseline set": base spec v0.16 kinds and mds DeviceChatAccepted.
export const BASELINE_KINDS = Object.freeze([0, 1, 2, 4, 5, ...range(7, 18), 20]);
export const BASELINE = Object.freeze({
  kinds: new Set(BASELINE_KINDS),
  fileVariants: new Set([FILE_VARIANTS.p2pMixnet]),
  hopDialects: new Set([HOP_DIALECTS.legacy]),
  features: 0,
});

// Content kinds the bot sends, per extension name of BOT_PROTOCOL_EXTENSIONS.
export const EXTENSION_KINDS = Object.freeze({
  typing: 240, seen: 241, buttons: 242, botinfo: 244, txref: 245, deleted: 21,
});

// Kinds bot-core decodes and acts on, whatever it sends: text, contactAdded,
// reactions, reply, edited, leftChat, the accept and device kinds, richText,
// coinageSend, deleted, typing, seen, buttons, buttonPress, botInfo,
// transactionReference, kind 250 (read only, 0014 Transition) and 252. Calls
// (8-11) are declined, so their bits are clear (0013: "a bot without calls
// clears 8-11"). Group kinds 246-249 only with the `groups` extension.
const RECEIVED_KINDS = Object.freeze([0, 3, 4, 5, 7, 12, 13, 14, 15, 16, 17, 18, 20, 21, 240, 241, 242, 243, 244, 245, 250, 252]);
const GROUP_KINDS = Object.freeze([246, 247, 248, 249]);

// The bot's own set, or null when it sends none: BOT_PROTOCOL_EXTENSIONS=none
// makes the bot a baseline client (the desktop e2e uses this to act as a phone).
// hopReceive: the bot can fetch HOP files (an allowed node list); bulletin: a
// Bulletin client is configured (it fetches variant 1).
export const ownCapabilities = ({ extensions, hopReceive = true, bulletin = false }) => {
  if (!extensions || extensions.size === 0) return null;
  const groups = extensions.has("groups");
  return {
    version: 1,
    kinds: [...RECEIVED_KINDS, ...(groups ? GROUP_KINDS : [])].sort((a, b) => a - b),
    fileVariants: [...(hopReceive ? [FILE_VARIANTS.p2pMixnet] : []), ...(bulletin ? [FILE_VARIANTS.bulletin] : [])],
    // The ChaCha20-Poly1305 cipher in either root layout; no AES-256-GCM.
    hopDialects: hopReceive ? [HOP_DIALECTS.legacy] : [],
    // Bit 1 (runs tx actions) is for a client that signs; a bot never does.
    features: groups ? CAPABILITY_FEATURES.groupsV2 : 0,
  };
};

// A stable key of a set, stored per peer to detect a changed set.
export const capabilitiesKey = (caps) => (caps
  ? `${caps.version}:${caps.kinds.join(",")}:${caps.fileVariants.join(",")}:${caps.hopDialects.join(",")}:${caps.features}`
  : null);

const toSets = (caps) => ({
  kinds: new Set(caps.kinds),
  fileVariants: new Set(caps.fileVariants),
  hopDialects: new Set(caps.hopDialects),
  features: caps.features >>> 0,
});
const intersect = (a, b) => new Set([...a].filter((x) => b.has(x)));
const validCaps = (c) => c && typeof c === "object"
  && ["kinds", "fileVariants", "hopDialects"].every((k) => Array.isArray(c[k]) && c[k].every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
  && Number.isInteger(c.features) && c.features >= 0 && c.features <= 0xffff_ffff;

export const createPeerCapabilities = ({ maxPeers = 10_000, maxDevices = 64 } = {}) => {
  const peers = new Map(); // peerHex -> Map<deviceHex, { caps: {kinds,...} | null, at: number, bot: boolean }>
  const devicesOf = (peerHex, create) => {
    let devices = peers.get(peerHex);
    if (!devices && create) {
      devices = new Map();
      peers.set(peerHex, devices);
      while (peers.size > maxPeers) peers.delete(peers.keys().next().value);
    }
    return devices ?? null;
  };
  const put = (peerHex, deviceHex, entry) => {
    const devices = devicesOf(peerHex, true);
    devices.delete(deviceHex);
    devices.set(deviceHex, entry);
    while (devices.size > maxDevices) devices.delete(devices.keys().next().value);
  };
  // One device's set: its own, else the baseline; a device that sent botInfo
  // (another bot) counts as listing botInfo (owner ruling: bots advertise
  // through botInfo and cards).
  const deviceSet = (entry) => {
    const sets = entry?.caps ? toSets(entry.caps) : {
      kinds: new Set(BASELINE.kinds), fileVariants: new Set(BASELINE.fileVariants), hopDialects: new Set(BASELINE.hopDialects), features: 0,
    };
    if (entry?.bot) sets.kinds.add(EXTENSION_KINDS.botinfo);
    return sets;
  };
  return {
    // A device's `capabilities` at message time `timestamp` (ms): a later one
    // replaces an earlier one; an older one is ignored. "stored" | "stale".
    record(peerHex, deviceHex, caps, timestamp) {
      const current = peers.get(peerHex)?.get(deviceHex);
      if (current?.caps && current.at > timestamp) return "stale";
      put(peerHex, deviceHex, {
        caps: { kinds: [...caps.kinds], fileVariants: [...caps.fileVariants], hopDialects: [...caps.hopDialects], features: caps.features },
        at: timestamp,
        bot: current?.bot ?? false,
      });
      return "stored";
    },
    // The device sent a botInfo document.
    noteBot(peerHex, deviceHex) {
      const current = peers.get(peerHex)?.get(deviceHex);
      if (current?.bot) return;
      put(peerHex, deviceHex, { caps: current?.caps ?? null, at: current?.at ?? 0, bot: true });
    },
    // deviceRemoved: the device's entry goes with it.
    removeDevice(peerHex, deviceHex) { peers.get(peerHex)?.delete(deviceHex); },
    // The intersection over `roster` (the peer's known device accounts; none
    // known = the identity account). A device with no entry is baseline.
    effective(peerHex, roster) {
      const devices = peers.get(peerHex);
      const list = roster?.length ? roster : [peerHex];
      let result = null;
      for (const deviceHex of list) {
        const set = deviceSet(devices?.get(deviceHex));
        result = result == null ? set : {
          kinds: intersect(result.kinds, set.kinds),
          fileVariants: intersect(result.fileVariants, set.fileVariants),
          hopDialects: intersect(result.hopDialects, set.hopDialects),
          features: (result.features & set.features) >>> 0,
        };
      }
      return result;
    },
    snapshot(peerHex) {
      const devices = peers.get(peerHex);
      if (!devices?.size) return null;
      return [...devices.entries()].map(([d, e]) => ({ d, ...(e.caps ? { c: e.caps, t: e.at } : {}), ...(e.bot ? { b: 1 } : {}) }));
    },
    restore(peerHex, saved) {
      if (!Array.isArray(saved)) return;
      for (const e of saved.slice(-maxDevices)) {
        if (typeof e?.d !== "string") continue;
        const caps = validCaps(e.c) ? e.c : null;
        if (!caps && !e.b) continue;
        put(peerHex, e.d, { caps, at: Number.isFinite(e.t) ? e.t : 0, bot: Boolean(e.b) });
      }
    },
  };
};

// The key of our own set last sent to each peer (`cs` in session state).
export const createCapabilitiesSent = ({ maxPeers = 10_000 } = {}) => {
  const peers = new Map();
  const set = (peerHex, key) => {
    peers.delete(peerHex);
    if (key) peers.set(peerHex, key);
    while (peers.size > maxPeers) peers.delete(peers.keys().next().value);
  };
  return {
    needs: (peerHex, key) => key != null && peers.get(peerHex) !== key,
    // Record a send; returns the previous value for `revert`.
    mark(peerHex, key) {
      const previous = peers.get(peerHex) ?? null;
      set(peerHex, key);
      return previous;
    },
    revert(peerHex, key, previous) { if (peers.get(peerHex) === key) set(peerHex, previous); },
    // The peer added a device: it has not seen our set (0013 "When", 3).
    forget(peerHex) { peers.delete(peerHex); },
    snapshot: (peerHex) => peers.get(peerHex) ?? null,
    restore(peerHex, saved) { if (typeof saved === "string" && saved) set(peerHex, saved); },
  };
};

// 0014 "Sending" for one DM file, with the transition over (kind 250 is not
// sent any more): variant 1 when every device of the peer lists it and the
// bot has Bulletin; else HOP in the phones' `legacy` dialect when every device
// lists variant 0 and that dialect and the bot has a HOP upload node.
// Returns "bulletin" | "hop", or { refused: reason }.
export const NO_COMMON_RAIL = "This contact's app cannot receive files from this app";
export const chooseAttachmentRail = (effective, { bulletin = false, hop = false }) => {
  if (bulletin && effective.fileVariants.has(FILE_VARIANTS.bulletin)) return "bulletin";
  const hopReadable = effective.fileVariants.has(FILE_VARIANTS.p2pMixnet) && effective.hopDialects.has(HOP_DIALECTS.legacy);
  if (hop && hopReadable) return "hop";
  if (!hop && !bulletin) return { refused: "file delivery is not configured; the operator must set BOT_HOP_UPLOAD_NODE and provision the bot's Bulletin allowance" };
  if (!hop && hopReadable) return { refused: "this contact's app receives files over HOP only, and BOT_HOP_UPLOAD_NODE is not set" };
  return { refused: NO_COMMON_RAIL };
};
