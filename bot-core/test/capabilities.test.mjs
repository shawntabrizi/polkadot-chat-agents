// Spec 0013 capabilities and the owner ruling on baseline clients
// (polkadot-chat-desktop docs/spec/0013-capabilities.md): the store per peer
// device, the intersection over every known device, the bot's own set, and
// the attachment rail of 0014 "Sending".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE,
  BASELINE_KINDS,
  EXTENSION_KINDS,
  NO_COMMON_RAIL,
  capabilitiesKey,
  chooseAttachmentRail,
  createCapabilitiesSent,
  createPeerCapabilities,
  ownCapabilities,
} from "../lib/capabilities.mjs";
import { parseProtocolExtensions } from "../lib/message-deletion.mjs";

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const DESKTOP = { kinds: [...BASELINE_KINDS, 3, 21, ...range(240, 252)], fileVariants: [0, 1], hopDialects: [0, 1], features: 3 };

test("baseline: base-spec kinds 0,1,2,4,5,7-18,20 (bitmap b7ff17), variant 0, the legacy dialect", () => {
  const bitmap = new Uint8Array(32);
  for (const k of BASELINE_KINDS) bitmap[k >> 3] |= 1 << (k & 7);
  assert.equal(Buffer.from(bitmap.subarray(0, 3)).toString("hex"), "b7ff17", "0013 'The baseline set'");
  assert.deepEqual([[...BASELINE.fileVariants], [...BASELINE.hopDialects], BASELINE.features], [[0], [0], 0]);
});

test("a peer that never advertised is baseline: no extension kind, HOP only", () => {
  const store = createPeerCapabilities();
  const eff = store.effective("peer", ["dev1"]);
  for (const kind of Object.values(EXTENSION_KINDS)) assert.equal(eff.kinds.has(kind), false, `kind ${kind} is not baseline`);
  assert.deepEqual([[...eff.fileVariants], [...eff.hopDialects]], [[0], [0]]);
});

test("the intersection covers every known device; a device without a set counts as baseline", () => {
  const store = createPeerCapabilities();
  store.record("bob", "desktop", DESKTOP, 10);
  const alone = store.effective("bob", ["desktop"]);
  assert.ok(alone.kinds.has(EXTENSION_KINDS.buttons) && alone.fileVariants.has(1));
  // 0013 multi-device example: a phone (baseline) next to the desktop.
  const both = store.effective("bob", ["desktop", "phone"]);
  assert.equal(both.kinds.has(EXTENSION_KINDS.buttons), false);
  assert.deepEqual([[...both.fileVariants], [...both.hopDialects], both.features], [[0], [0], 0]);
  // deviceRemoved drops the device; the roster no longer names it either.
  store.removeDevice("bob", "desktop");
  assert.equal(store.effective("bob", ["desktop"]).kinds.has(EXTENSION_KINDS.buttons), false, "the removed device's set is gone");
});

test("a later message timestamp replaces the set; an older one is ignored", () => {
  const store = createPeerCapabilities();
  assert.equal(store.record("bob", "d", DESKTOP, 20), "stored");
  assert.equal(store.record("bob", "d", { ...DESKTOP, fileVariants: [0] }, 10), "stale");
  assert.ok(store.effective("bob", ["d"]).fileVariants.has(1));
  assert.equal(store.record("bob", "d", { ...DESKTOP, fileVariants: [0] }, 30), "stored");
  assert.equal(store.effective("bob", ["d"]).fileVariants.has(1), false);
});

test("a device that sent botInfo counts as listing botInfo (owner ruling: bots advertise through botInfo)", () => {
  const store = createPeerCapabilities();
  store.noteBot("bot", "bot");
  const eff = store.effective("bot", []);
  assert.equal(eff.kinds.has(EXTENSION_KINDS.botinfo), true);
  assert.equal(eff.kinds.has(EXTENSION_KINDS.buttons), false, "botInfo lists nothing else");
});

test("the store survives a restart through snapshot and restore", () => {
  const store = createPeerCapabilities();
  store.record("bob", "d", DESKTOP, 5);
  store.noteBot("bob", "b");
  const again = createPeerCapabilities();
  again.restore("bob", JSON.parse(JSON.stringify(store.snapshot("bob"))));
  assert.deepEqual(again.snapshot("bob"), store.snapshot("bob"));
  again.restore("eve", [{ d: "x", c: { kinds: [999], fileVariants: [], hopDialects: [], features: 0 } }]);
  assert.equal(again.snapshot("eve"), null, "an invalid saved set is dropped");
});

test("own set: every kind the bot reads, both rails it fetches, and none at all with BOT_PROTOCOL_EXTENSIONS=none", () => {
  const defaults = ownCapabilities({ extensions: parseProtocolExtensions("").enabled, hopReceive: true, bulletin: true });
  for (const kind of [0, 15, 21, 240, 241, 242, 243, 244, 245, 246, 249, 250, 252]) assert.ok(defaults.kinds.includes(kind), `kind ${kind}`);
  for (const kind of [8, 9, 10, 11]) assert.equal(defaults.kinds.includes(kind), false, "a bot without calls clears 8-11");
  assert.deepEqual([defaults.fileVariants, defaults.hopDialects, defaults.features], [[0, 1], [0], 1]);
  // 0013 card agreement: tx (feature bit 1) is for a client that signs.
  assert.equal(defaults.features & 2, 0);
  const noGroups = ownCapabilities({ extensions: parseProtocolExtensions("buttons,seen").enabled, hopReceive: true, bulletin: false });
  assert.equal(noGroups.kinds.includes(246), false);
  assert.deepEqual([noGroups.fileVariants, noGroups.features], [[0], 0]);
  assert.equal(ownCapabilities({ extensions: parseProtocolExtensions("none").enabled }), null, "a baseline bot sends no capabilities");
});

test("sent once per peer and set: a changed set or a new device of the peer sends it again", () => {
  const sent = createCapabilitiesSent();
  const key = capabilitiesKey(ownCapabilities({ extensions: parseProtocolExtensions("").enabled }));
  assert.equal(sent.needs("bob", key), true);
  const previous = sent.mark("bob", key);
  assert.equal(sent.needs("bob", key), false, "not again for the same set");
  const changed = capabilitiesKey(ownCapabilities({ extensions: parseProtocolExtensions("buttons").enabled }));
  assert.equal(sent.needs("bob", changed), true, "an app update that changes the set");
  sent.revert("bob", key, previous);
  assert.equal(sent.needs("bob", key), true, "a failed send reverts");
  sent.mark("bob", key);
  sent.forget("bob");
  assert.equal(sent.needs("bob", key), true, "deviceAdded: the new device has not seen it");
  assert.equal(sent.needs("bob", null), false, "a baseline bot never needs to send");
});

test("attachment rail (0014 Sending): Bulletin variant 1 only if every device lists it, else HOP in the legacy dialect, else refused", () => {
  const store = createPeerCapabilities();
  store.record("bob", "desktop", DESKTOP, 1);
  const rails = { bulletin: true, hop: true };
  assert.equal(chooseAttachmentRail(store.effective("bob", ["desktop"]), rails), "bulletin");
  assert.equal(chooseAttachmentRail(store.effective("bob", ["desktop", "phone"]), rails), "hop", "one baseline device: HOP");
  assert.equal(chooseAttachmentRail(store.effective("bob", ["desktop"]), { bulletin: false, hop: true }), "hop", "no Bulletin on the bot: HOP");
  store.record("carl", "d", { ...DESKTOP, fileVariants: [1], hopDialects: [1] }, 1);
  assert.deepEqual(chooseAttachmentRail(store.effective("carl", ["d"]), { bulletin: false, hop: true }), { refused: NO_COMMON_RAIL }, "no aesGcm sender: no common dialect");
  assert.match(chooseAttachmentRail(store.effective("phone", []), { bulletin: true, hop: false }).refused, /HOP only/);
  assert.match(chooseAttachmentRail(store.effective("phone", []), { bulletin: false, hop: false }).refused, /not configured/);
});
