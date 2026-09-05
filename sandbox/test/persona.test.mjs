// Personas and devices: the key material has the shape the protocol needs,
// registration publishes exactly what the chain would hold, and the shared
// state behaves like the web client's repositories (ported from their specs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519.js";
import { deriveSr25519PublicKey } from "@novasamatech/statement-store";
import { createDirectory } from "../lib/directory.mjs";
import { ENCRYPTION_KEY_BYTES, STATEMENT_SEED_BYTES, isUsablePeerDevice, mintDeviceKeys, toDeviceKeys } from "../lib/device.mjs";
import { createPersona, createPersonaState, mintIdentityKeys } from "../lib/persona.mjs";

const hex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;

test("device keys: a complete, self-consistent set, fresh every time", () => {
  const keys = mintDeviceKeys();
  assert.equal(keys.statementSeed.length, STATEMENT_SEED_BYTES);
  assert.equal(keys.statementAccountId.length, 32);
  assert.equal(keys.encryptionPrivateKey.length, ENCRYPTION_KEY_BYTES);
  assert.equal(keys.encryptionPublicKey.length, ENCRYPTION_KEY_BYTES);
  assert.deepEqual(keys.statementAccountId, deriveSr25519PublicKey(keys.statementSeed));
  assert.deepEqual(keys.encryptionPublicKey, x25519.getPublicKey(keys.encryptionPrivateKey));
  assert.deepEqual(toDeviceKeys(keys.statementSeed, keys.encryptionPrivateKey), keys);
  assert.notDeepEqual(mintDeviceKeys().statementAccountId, keys.statementAccountId);
  assert.equal(isUsablePeerDevice({ statementAccountId: keys.statementAccountId, encryptionPublicKey: keys.encryptionPublicKey }), true);
  assert.equal(isUsablePeerDevice({ statementAccountId: new Uint8Array(31), encryptionPublicKey: keys.encryptionPublicKey }), false);
});

test("identity keys: sr25519 account and an X25519 chat key pair", () => {
  const identity = mintIdentityKeys();
  assert.equal(identity.seed.length, 64);
  assert.equal(identity.identityAccountId.length, 32);
  assert.deepEqual(identity.identityAccountId, deriveSr25519PublicKey(identity.seed));
  assert.equal(identity.identityChatPrivateKey.length, 32);
  assert.deepEqual(identity.identityChatPublicKey, x25519.getPublicKey(identity.identityChatPrivateKey));
});

test("a persona registers its identity and every device account, and never exposes a secret", () => {
  const allowances = new Set();
  const directory = createDirectory({ allowances });
  const bob = createPersona({ name: "bob", devices: 2 });
  bob.register(directory);
  assert.equal(directory.usernameOwner("bob"), bob.account);
  assert.deepEqual(directory.identityOf(bob.account).chatPublicKey, bob.identity.identityChatPublicKey);
  for (const device of bob.devices) {
    assert.ok(allowances.has(device.account), `device ${device.index} may submit statements`);
    assert.equal(directory.consumer(device.account), null, "a device account is not messageable");
  }
  assert.equal(bob.devices.map((d) => d.account).includes(bob.account), false, "device accounts differ from the identity account");
  const json = JSON.stringify(bob);
  assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ["account", "bulletinAccount", "chatPublicKey", "devices", "name"]);
  assert.deepEqual(Object.keys(JSON.parse(json).devices[0]).sort(), ["account", "encryptionPublicKey", "index", "online", "removed"]);
  for (const secret of [bob.identity.seed, bob.identity.identityChatPrivateKey, bob.devices[0].keys.statementSeed, bob.devices[0].keys.encryptionPrivateKey]) {
    assert.equal(json.includes(hex(secret).slice(2, 34)), false, "serialised persona leaks a secret");
  }
  assert.throws(() => bob.device(3), /no device 3/);
  assert.throws(() => bob.device(1), /offline/);
});

// ── State: ported from the web client's repository specs ─────────────────

const PEER = `0x${"aa".repeat(32)}`;
const row = (messageId, overrides = {}) => ({ messageId, peer: PEER, timestamp: 1, direction: "incoming", status: "received", content: { type: "text", text: messageId }, ...overrides });

test("messages: the room is created with the first message and counts unread incoming rows", () => {
  const { messages } = createPersonaState();
  assert.equal(messages.receive(row("a", { timestamp: 1 }), 1), true);
  assert.equal(messages.add(row("b", { timestamp: 2, direction: "outgoing", status: "sending" })), true);
  assert.equal(messages.receive(row("c", { timestamp: 3 }), 1, { read: true }), true);
  const [room] = messages.rooms();
  assert.deepEqual([room.peer, room.unreadCount, room.lastMessageAt, room.lastPreview], [PEER, 1, 3, "c"]);
  messages.markRoomRead(PEER);
  assert.equal(messages.rooms()[0].unreadCount, 0);
  assert.equal(messages.list(PEER, { unread: true }).length, 0);
});

// The store re-delivers statements; a message id seen twice must not produce
// two bubbles or bump unread twice — but a second device seeing it is recorded.
test("messages: a duplicate id is one row; each receiving device is remembered", () => {
  const { messages } = createPersonaState();
  messages.receive(row("a"), 1);
  assert.equal(messages.receive(row("a", { content: { type: "text", text: "changed" } }), 2), false);
  assert.deepEqual(messages.list(PEER).map((m) => m.content), [{ type: "text", text: "a" }]);
  assert.deepEqual(messages.get("a").receivedBy, [1, 2]);
  assert.equal(messages.rooms()[0].unreadCount, 1);
  messages.acked("a", 2);
  messages.acked("a", 2);
  assert.deepEqual(messages.get("a").ackedBy, [2]);
  assert.equal(messages.list(PEER, { device: 3 }).length, 0, "device 3 never received it");
  assert.equal(messages.list(PEER, { device: 2 }).length, 1);
});

test("messages: a room lists in timestamp order and keeps peers apart", () => {
  const { messages } = createPersonaState();
  messages.add(row("late", { timestamp: 5 }));
  messages.add(row("early", { timestamp: 2 }));
  messages.add(row("other", { peer: `0x${"bb".repeat(32)}`, timestamp: 3 }));
  assert.deepEqual(messages.list(PEER).map((m) => m.messageId), ["early", "late"]);
  assert.deepEqual(messages.rooms().map((r) => r.peer), [PEER, `0x${"bb".repeat(32)}`]);
});

test("messages: reactions toggle per emoji and side; edits touch text rows only", () => {
  const { messages } = createPersonaState();
  messages.add(row("a"));
  messages.add(row("sys", { direction: "system", content: { type: "contactAdded" } }));
  messages.applyReaction("a", "👍", "me", true);
  messages.applyReaction("a", "👍", "peer", true);
  messages.applyReaction("a", "👍", "me", true);
  assert.deepEqual(messages.get("a").reactions, [{ emoji: "👍", by: "peer" }, { emoji: "👍", by: "me" }]);
  messages.applyReaction("a", "👍", "me", false);
  assert.deepEqual(messages.get("a").reactions, [{ emoji: "👍", by: "peer" }]);
  assert.equal(messages.applyReaction("missing", "👍", "peer", true), false, "a reaction to an unknown message is a no-op, not an error");
  messages.applyEdit("a", "edited", 9);
  messages.applyEdit("sys", "edited", 9);
  assert.deepEqual([messages.get("a").content, messages.get("a").editedAt], [{ type: "text", text: "edited" }, 9]);
  assert.deepEqual([messages.get("sys").content, messages.get("sys").editedAt], [{ type: "contactAdded" }, null]);
});

test("messages: a batch ack moves outgoing rows sent before it to delivered, nothing else", () => {
  const { messages } = createPersonaState();
  messages.add(row("old-sent", { timestamp: 1, direction: "outgoing", status: "sent" }));
  messages.add(row("old-failed", { timestamp: 2, direction: "outgoing", status: "failed" }));
  messages.add(row("new-sent", { timestamp: 10, direction: "outgoing", status: "sent" }));
  messages.add(row("theirs", { timestamp: 3 }));
  messages.markDeliveredBefore(PEER, 5);
  assert.deepEqual(["old-sent", "old-failed", "new-sent", "theirs"].map((id) => messages.get(id).status), ["delivered", "failed", "sent", "received"]);
  messages.setStatus("new-sent", "delivered");
  assert.equal(messages.get("new-sent").status, "delivered");
  messages.ensureRoom(`0x${"cc".repeat(32)}`);
  messages.ensureRoom(`0x${"cc".repeat(32)}`);
  assert.equal(messages.rooms().length, 2);
});

test("contacts: one entry per device, re-announced keys replace, username and key refresh", () => {
  const { contacts } = createPersonaState();
  const seed = { account: PEER, username: "alice", chatPublicKey: new Uint8Array(32).fill(1) };
  const device = (fill) => ({ statementAccountId: new Uint8Array(32).fill(fill), encryptionPublicKey: new Uint8Array(32).fill(fill + 100) });
  contacts.upsertDevice(seed, device(1));
  contacts.upsertDevice(seed, device(2));
  contacts.upsertDevice(seed, { ...device(1), encryptionPublicKey: new Uint8Array(32).fill(0xee) });
  assert.equal(contacts.get(PEER).devices.length, 2);
  assert.equal(contacts.get(PEER).devices.find((d) => d.statementAccountId[0] === 1).encryptionPublicKey[0], 0xee);
  contacts.upsertDevice({ ...seed, username: "alice2", chatPublicKey: new Uint8Array(32).fill(7) }, null);
  assert.equal(contacts.get(PEER).username, "alice2");
  assert.equal(contacts.get(PEER).chatPublicKey[0], 7);
  contacts.removeDevice(PEER, device(1).statementAccountId);
  assert.deepEqual(contacts.get(PEER).devices.map((d) => d.statementAccountId[0]), [2]);
  assert.equal(contacts.removeDevice(`0x${"bb".repeat(32)}`, device(1).statementAccountId), undefined);
  contacts.upsertDevice({ ...seed, account: `0x${"cc".repeat(32)}`, username: "zed" }, null);
  assert.deepEqual(contacts.list().map((c) => c.username), ["alice2", "zed"]);
});

// The row is the persistent dedup set: a request the chain re-delivers must
// not overwrite a status the user already chose.
test("requests: added once, status moves, pending lookup per peer and direction, newest first", () => {
  const { requests } = createPersonaState();
  const req = (requestId, overrides = {}) => ({ requestId, peer: PEER, peerUsername: "alice", peerChatPublicKey: new Uint8Array(32), direction: "incoming", status: "pending", welcomeMessage: null, timestamp: 1, senderDevice: null, device: null, createdAt: 1, ...overrides });
  assert.equal(requests.add(req("r1")), true);
  requests.update("r1", { status: "declined" });
  assert.equal(requests.add(req("r1")), false);
  assert.equal(requests.get("r1").status, "declined");
  requests.add(req("r2", { direction: "outgoing", createdAt: 2 }));
  requests.add(req("r3", { status: "accepted", createdAt: 3 }));
  assert.equal(requests.findPending(PEER, "outgoing").requestId, "r2");
  assert.equal(requests.findPending(PEER, "incoming"), undefined);
  assert.deepEqual(requests.list().map((r) => r.requestId), ["r3", "r2", "r1"]);
});

test("state changes are observable, which is how sibling devices follow each other", () => {
  const state = createPersonaState();
  const seen = [];
  const stop = state.onChange((c) => seen.push(c.type));
  state.contacts.upsertDevice({ account: PEER, username: "a", chatPublicKey: new Uint8Array(32) }, null);
  state.messages.add(row("m"));
  state.requests.add({ requestId: "r", peer: PEER, direction: "incoming", status: "pending", createdAt: 1 });
  stop();
  state.messages.add(row("n"));
  assert.deepEqual(seen, ["contact", "room", "message", "request"]);
});
