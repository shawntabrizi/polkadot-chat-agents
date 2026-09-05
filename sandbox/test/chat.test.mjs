// The chat engine, ported from polkadot-chat-web chat/{content,identityChannel,
// peerSession,manager,manager.messaging}.spec.ts. The engine is one side; the
// peer is driven by hand over the same in-memory store, the way a phone or a
// bot would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatMessage as ChatMessageCodec } from "@novasamatech/host-chat/codec/message";
import { createExpiryAllocator, createSr25519Prover } from "@novasamatech/statement-store";
import { bytesToHex } from "../lib/bytes.mjs";
import { createChatEngine, createIdentityChannel, createPeerRoster, createPeerSession, fromWire, previewOf, toWire } from "../lib/chat.mjs";
import { sendChatRequest, decodeChatRequest } from "../lib/requests.mjs";
import { lookupOf, makePeer, makeStore, openEngine, waitFor } from "./helpers.mjs";

// ── Content ──────────────────────────────────────────────────────────────

// Round-trip through the real codec: what we build must be what the apps decode.
const viaWire = (content) => ChatMessageCodec.dec(ChatMessageCodec.enc({ messageId: "m", timestamp: 1n, versioned: { tag: "v1", value: content } })).versioned.value;

test("toWire encodes every outgoing variant as the apps expect", () => {
  assert.deepEqual(viaWire(toWire({ type: "text", text: "hi" })), { tag: "text", value: "hi" });
  assert.deepEqual(viaWire(toWire({ type: "reply", messageId: "a", text: "yes" })).value.ownContent.text, "yes");
  assert.deepEqual(viaWire(toWire({ type: "reaction", messageId: "a", emoji: "🔥", add: true })), { tag: "reacted", value: { messageId: "a", emoji: "🔥" } });
  assert.deepEqual(viaWire(toWire({ type: "reaction", messageId: "a", emoji: "🔥", add: false })), { tag: "reactionRemoved", value: { messageId: "a", emoji: "🔥" } });
  assert.equal(viaWire(toWire({ type: "edit", messageId: "a", text: "new" })).value.newContent.text, "new");
  assert.deepEqual(viaWire(toWire({ type: "callDecline", offerMessageId: "o" })), { tag: "dataChannelClosed", value: { offerMessageId: "o" } });
  const offer = viaWire(toWire({ type: "callOffer" }));
  assert.deepEqual([offer.tag, offer.value.purpose, offer.value.sdp.length > 0], ["dataChannelOffer", "AUDIO_CALL", true]);
  const id = new Uint8Array(32).fill(3);
  assert.deepEqual(viaWire(toWire({ type: "deviceAdded", device: { statementAccountId: id, encryptionPublicKey: id } })), { tag: "deviceAdded", value: { statementAccountId: id, encryptionPublicKey: id } });
  assert.deepEqual(viaWire(toWire({ type: "deviceRemoved", statementAccountId: id })), { tag: "deviceRemoved", value: { statementAccountId: id } });
});

test("fromWire maps rows, effects, roster variants, ignores and unknown tags", () => {
  assert.deepEqual(fromWire(viaWire({ tag: "text", value: "hello" })), { kind: "message", content: { type: "text", text: "hello" } });
  assert.deepEqual(fromWire(viaWire({
    tag: "richText",
    value: { text: "photo", attachments: [{ tag: "p2pMixnet", value: { identifier: new Uint8Array([1]), claimTicket: new Uint8Array([2]), nodeEndpoint: { tag: "wssUrl", value: { url: "wss://hop" } }, meta: { tag: "image", value: { general: { mimeType: "image/png", fileSize: 10 }, width: 1, height: 1, thumbnail: undefined } } } }] },
  })), {
    kind: "message",
    content: { type: "richText", text: "photo", attachments: [{ kind: "image", mimeType: "image/png", fileSize: 10, width: 1, height: 1, identifier: "0x01", wssUrl: "wss://hop" }] },
    claimTickets: [new Uint8Array([2])],
  }, "the reference is public; the ticket comes back beside the content, never in it");
  assert.deepEqual(fromWire(viaWire({ tag: "reply", value: { messageId: "a", ownContent: { text: "yes", attachments: undefined } } })), { kind: "message", content: { type: "reply", messageId: "a", text: "yes" } });
  assert.deepEqual(fromWire({ tag: "reacted", value: { messageId: "a", emoji: "👍" } }), { kind: "reaction", messageId: "a", emoji: "👍", add: true });
  assert.deepEqual(fromWire({ tag: "reactionRemoved", value: { messageId: "a", emoji: "👍" } }), { kind: "reaction", messageId: "a", emoji: "👍", add: false });
  assert.deepEqual(fromWire({ tag: "edit", value: { messageId: "a", newContent: { text: "x", attachments: undefined } } }), { kind: "edit", messageId: "a", text: "x" });
  assert.deepEqual(fromWire({ tag: "dataChannelOffer", value: { sdp: new Uint8Array(), purpose: "AUDIO_CALL" } }), { kind: "callOffer" });
  assert.deepEqual(fromWire({ tag: "dataChannelClosed", value: { offerMessageId: "o" } }), { kind: "callClosed", offerMessageId: "o" });
  assert.deepEqual(fromWire({ tag: "contactAdded", value: undefined }), { kind: "message", content: { type: "contactAdded" } });
  assert.deepEqual(fromWire({ tag: "leftChat", value: undefined }), { kind: "message", content: { type: "leftChat" } });
  assert.deepEqual(fromWire({ tag: "coinagePayment", value: { totalValue: 1n, coinKeys: [] } }), { kind: "message", content: { type: "unsupported", tag: "coinagePayment" } });
  const id = new Uint8Array(32).fill(1);
  assert.equal(fromWire({ tag: "deviceAdded", value: { statementAccountId: id, encryptionPublicKey: id } }).kind, "deviceAdded");
  assert.equal(fromWire({ tag: "deviceRemoved", value: { statementAccountId: id } }).kind, "deviceRemoved");
  for (const content of [
    { tag: "dataChannelAnswer", value: { offerMessageId: "o", sdp: new Uint8Array() } },
    { tag: "token", value: { token: "0x00", platform: "iOS" } },
    { tag: "deviceChatAccepted", value: { requestId: "r", device: { statementAccountId: id, encryptionPublicKey: id } } },
    { tag: "somethingNew", value: 1 },
  ]) assert.deepEqual(fromWire(content), { kind: "ignore" });
  assert.equal(previewOf({ type: "text", text: "a" }), "a");
  assert.equal(previewOf({ type: "richText", text: null, attachments: [{ kind: "image", mimeType: "x", fileSize: 1 }] }), "[1 attachment(s)]");
  assert.equal(previewOf({ type: "contactAdded" }), "Chat accepted");
  assert.equal(previewOf({ type: "unsupported", tag: "send" }), "Unsupported message (send)");
});

// ── Identity channel ─────────────────────────────────────────────────────

const openChannel = (store, self, peer, events) => createIdentityChannel({
  ownIdentityAccountId: self.identity.identityAccountId,
  ownIdentityChatPrivateKey: self.identity.identityChatPrivateKey,
  peerIdentityAccountId: peer.identity.identityAccountId,
  peerIdentityChatPublicKey: peer.identity.identityChatPublicKey,
  prover: createSr25519Prover(self.device.statementSeed),
  allocator: createExpiryAllocator(),
  statementStore: store,
  onEvent: (event) => events.push(event),
});

test("identity channel carries deviceChatAccepted, roster fan-out and plain content; drops legacy chatAccepted", async () => {
  const store = makeStore();
  const alice = makePeer();
  const bob = makePeer();
  const aliceEvents = [];
  const bobEvents = [];
  const aliceChannel = openChannel(store, alice, bob, aliceEvents);
  const bobChannel = openChannel(store, bob, alice, bobEvents);

  await bobChannel.post({ tag: "deviceChatAccepted", value: { requestId: "req-1", device: { statementAccountId: bob.device.statementAccountId, encryptionPublicKey: bob.device.encryptionPublicKey } } });
  const accepted = await waitFor(() => aliceEvents.find((e) => e.tag === "accepted"));
  assert.equal(accepted.requestId, "req-1");
  assert.deepEqual(accepted.device.encryptionPublicKey, bob.device.encryptionPublicKey);
  // The channel acknowledges what it delivered: Bob's session sees a response.
  await waitFor(() => store.acceptedStatements().length >= 2);
  assert.equal(bobEvents.length, 0);

  const added = new Uint8Array(32).fill(9);
  await bobChannel.post({ tag: "deviceAdded", value: { statementAccountId: added, encryptionPublicKey: bob.device.encryptionPublicKey } });
  await bobChannel.post({ tag: "chatAccepted", value: { messageId: "req-1" } });
  await bobChannel.post({ tag: "text", value: "welcome" });
  await bobChannel.post({ tag: "deviceRemoved", value: { statementAccountId: added } });
  await waitFor(() => aliceEvents.length === 4);
  assert.deepEqual(aliceEvents.map((e) => e.tag), ["accepted", "deviceAdded", "message", "deviceRemoved"]);
  assert.deepEqual(aliceEvents[2].content, { tag: "text", value: "welcome" });

  aliceChannel.dispose();
  bobChannel.dispose();
});

// ── Peer session ─────────────────────────────────────────────────────────

const target = (device) => ({ statementAccountId: device.statementAccountId, encryptionPublicKey: device.encryptionPublicKey });

const openSession = (store, identity, device, peer, peerDevices) => {
  const side = { received: [], sent: [], delivered: [], acked: [], batches: 0 };
  side.roster = createPeerRoster(peerDevices);
  side.session = createPeerSession({
    identity,
    deviceKeys: device,
    peerIdentityAccountId: peer.identityAccountId,
    peerIdentityChatPublicKey: peer.identityChatPublicKey,
    peerRoster: side.roster,
    prover: createSr25519Prover(device.statementSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onMessage: (m) => side.received.push(m),
    onSent: (id) => side.sent.push(id),
    onDelivered: (id) => side.delivered.push(id),
    onBatchDelivered: () => { side.batches += 1; },
    onAcked: (ids, code) => { side.acked.push(...ids); side.codes.push(code); },
  });
  side.codes = [];
  return side;
};

// The poison of bot-core's device test client: a richText whose attachment
// body is junk. Both codecs (the SDK's and bot-core's) refuse it.
export const poisonMessage = () => {
  const enc = new TextEncoder();
  const id = enc.encode(crypto.randomUUID());
  return Uint8Array.from([id.length << 2, ...id, ...new Uint8Array(8), 0, 15, 0, 1, 4, 0, 0, 0, 0]);
};

// Bob has two devices; Alice's one statement must reach both, and Alice's
// row must go sent → delivered on the first ACK.
test("peer session delivers a text to every device of a two-device peer, reports the ack, dedups the re-sent batch", async () => {
  const store = makeStore();
  const alice = makePeer();
  const bob = makePeer();
  const bobLaptop = makePeer().device;
  const a = openSession(store, alice.identity, alice.device, bob.identity, [target(bob.device), target(bobLaptop)]);
  const bPhone = openSession(store, bob.identity, bob.device, alice.identity, [target(alice.device)]);
  const bLaptop = openSession(store, bob.identity, bobLaptop, alice.identity, [target(alice.device)]);

  await a.session.send({ tag: "text", value: "hello both" }, { messageId: "m1", timestamp: 1 });
  assert.deepEqual(a.sent, ["m1"]);
  await waitFor(() => bPhone.received.length === 1 && bLaptop.received.length === 1);
  assert.deepEqual(bPhone.received[0], { messageId: "m1", timestamp: 1, content: { tag: "text", value: "hello both" } });
  assert.equal(bLaptop.received[0].messageId, "m1");
  await waitFor(() => a.delivered.includes("m1"));
  await waitFor(() => bPhone.acked.includes("m1") && bLaptop.acked.includes("m1"));
  assert.ok(a.batches > 0);

  // And back: a device of Bob answers, Alice reads it once.
  await bLaptop.session.send({ tag: "text", value: "laptop here" }, { messageId: "m2", timestamp: 2 });
  await waitFor(() => a.received.length === 1);
  assert.deepEqual(a.received[0].content, { tag: "text", value: "laptop here" });
  await waitFor(() => bLaptop.delivered.includes("m2"));

  // Delivered once per message id even though the batch is re-sent until acked.
  await a.session.send({ tag: "text", value: "1" }, { messageId: "m3", timestamp: 3 });
  await a.session.send({ tag: "text", value: "2" }, { messageId: "m4", timestamp: 4 });
  await waitFor(() => a.delivered.length === 3);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(bPhone.received.map((m) => m.messageId), ["m1", "m3", "m4"]);

  for (const side of [a, bPhone, bLaptop]) side.session.dispose();
});

// S1 answer 3: a batch is ACKed `success` when at least one message decoded
// and `decodingFailed` only when none did; the good messages are delivered
// either way and the undecodable one is skipped, not fatal.
test("peer session: one undecodable message in a batch is skipped, the rest delivered, the batch ACKed success; an all-poison batch is NACKed", async () => {
  const store = makeStore();
  const alice = makePeer();
  const bob = makePeer();
  const a = openSession(store, alice.identity, alice.device, bob.identity, [target(bob.device)]);
  const b = openSession(store, bob.identity, bob.device, alice.identity, [target(alice.device)]);

  // The SDK submits [poison] at once and, when the text follows before the
  // ACK, extends it to [poison, text] under a new request id; so the peer
  // may see a poison-only batch first (NACKed), then the superset (ACKed).
  await a.session.sendRaw(poisonMessage());
  await a.session.send({ tag: "text", value: "after the poison" }, { messageId: "m1", timestamp: 1 });
  await waitFor(() => b.received.length === 1);
  assert.deepEqual(b.received[0].content, { tag: "text", value: "after the poison" });
  await waitFor(() => a.delivered.includes("m1"));
  assert.equal(b.codes.at(-1), "success", `codes ${b.codes}`);
  assert.ok(b.codes.every((c) => c === "success" || c === "decodingFailed"), `codes ${b.codes}`);

  // Nothing readable at all: NACK, and the sender learns it (the SDK settles
  // the batch on any response code).
  const bCodes = b.codes.length;
  await a.session.sendRaw(poisonMessage());
  await waitFor(() => b.codes.length > bCodes);
  assert.equal(b.codes.at(-1), "decodingFailed");
  assert.equal(b.received.length, 1, "no row for the poison");
  a.session.dispose();
  b.session.dispose();
});

test("peer session rejects a send with no known device and picks up a device added to the roster", async () => {
  const store = makeStore();
  const alice = makePeer();
  const bob = makePeer();
  const a = openSession(store, alice.identity, alice.device, bob.identity, []);
  await assert.rejects(a.session.send({ tag: "text", value: "x" }, { messageId: "m", timestamp: 1 }));
  assert.deepEqual(a.sent, []);
  const b = openSession(store, bob.identity, bob.device, alice.identity, [target(alice.device)]);
  a.roster.set([target(bob.device)]);
  await a.session.send({ tag: "text", value: "now" }, { messageId: "m1", timestamp: 1 });
  await waitFor(() => b.received.length === 1);
  await waitFor(() => a.delivered.includes("m1"));
  a.session.dispose();
  b.session.dispose();
});

// ── Engine: requests ─────────────────────────────────────────────────────

const requestFrom = (store, from, to, welcomeMessage) => sendChatRequest({
  recipientAccountId: to.identity.identityAccountId,
  recipientChatPublicKey: to.identity.identityChatPublicKey,
  senderIdentityAccountId: from.identity.identityAccountId,
  senderIdentityChatPrivateKey: from.identity.identityChatPrivateKey,
  senderDeviceEncryptionPublicKey: from.device.encryptionPublicKey,
  senderDeviceSeed: from.device.statementSeed,
  welcomeMessage,
  statementStore: store,
  allocator: createExpiryAllocator(),
});

test("engine records a verified incoming request and answers accept with deviceChatAccepted carrying this device", async (t) => {
  const store = makeStore();
  const web = makePeer();
  const phone = makePeer();
  const { engine, state } = openEngine(web, store, lookupOf(phone));
  t.after(() => engine.dispose());
  const { requestId } = await requestFrom(store, phone, web, "hi web");
  const request = await waitFor(() => state.requests.get(requestId));
  assert.deepEqual([request.direction, request.status, request.welcomeMessage, request.peerUsername], ["incoming", "pending", "hi web", "user-0"]);
  assert.equal(state.contacts.list().length, 0);

  const phoneEvents = [];
  const channel = openChannel(store, phone, web, phoneEvents);
  await engine.acceptRequest(requestId);
  assert.deepEqual([state.requests.get(requestId).status, state.requests.get(requestId).device], ["accepted", 1]);
  const contact = state.contacts.get(bytesToHex(phone.identity.identityAccountId));
  assert.deepEqual(contact.devices, [target(phone.device)]);
  const accepted = await waitFor(() => phoneEvents.find((e) => e.tag === "accepted"));
  assert.equal(accepted.requestId, requestId);
  assert.deepEqual(accepted.device, target(web.device));
  await assert.rejects(engine.acceptRequest(requestId), /is accepted/);
  channel.dispose();
});

test("engine drops a request whose sender is unknown on chain or whose proof is wrong; decline is local", async (t) => {
  const store = makeStore();
  const web = makePeer();
  const stranger = makePeer();
  const impostor = makePeer();
  const phone = makePeer();
  const { engine, state } = openEngine(web, store, lookupOf(impostor, phone));
  t.after(() => engine.dispose());
  await requestFrom(store, stranger, web, null);
  await sendChatRequest({
    recipientAccountId: web.identity.identityAccountId,
    recipientChatPublicKey: web.identity.identityChatPublicKey,
    senderIdentityAccountId: impostor.identity.identityAccountId,
    senderIdentityChatPrivateKey: stranger.identity.identityChatPrivateKey,
    senderDeviceEncryptionPublicKey: stranger.device.encryptionPublicKey,
    senderDeviceSeed: stranger.device.statementSeed,
    welcomeMessage: null,
    statementStore: store,
    allocator: createExpiryAllocator(),
  });
  await waitFor(() => store.acceptedStatements().length === 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(state.requests.list().length, 0);

  const { requestId } = await requestFrom(store, phone, web, null);
  await waitFor(() => state.requests.get(requestId));
  await engine.declineRequest(requestId);
  assert.equal(state.requests.get(requestId).status, "declined");
  assert.equal(state.contacts.list().length, 0);
});

test("engine sends a request the peer can decode and turns the peer accept into a contact; the channel survives a restart", async (t) => {
  const store = makeStore();
  const web = makePeer();
  const bot = makePeer();
  let { engine, state } = openEngine(web, store, lookupOf(bot));
  t.after(() => engine.dispose());
  const peer = { accountId: bot.identity.identityAccountId, username: "bot", chatPublicKey: bot.identity.identityChatPublicKey };
  await engine.sendRequest(peer, "hello bot");
  const outgoing = state.requests.list()[0];
  assert.deepEqual([outgoing.direction, outgoing.status, outgoing.peerUsername, outgoing.welcomeMessage, outgoing.device], ["outgoing", "pending", "bot", "hello bot", 1]);
  const decoded = decodeChatRequest(store.acceptedStatements().at(-1).data, bot.identity.identityAccountId, bot.identity.identityChatPrivateKey);
  assert.equal(decoded.requestId, outgoing.requestId);
  assert.deepEqual(decoded.senderDevice.statementAccountId, web.device.statementAccountId);

  // Reload: a new engine over the same state re-opens the identity channel for the pending request.
  engine.dispose();
  engine = createChatEngine({ identity: web.identity, deviceKeys: web.device, deviceIndex: 1, state, statementStore: store, lookup: lookupOf(bot), ownDevices: () => [target(web.device)] });
  const botChannel = openChannel(store, bot, web, []);
  await botChannel.post({ tag: "deviceChatAccepted", value: { requestId: decoded.requestId, device: target(bot.device) } });
  const contact = await waitFor(() => state.contacts.get(bytesToHex(bot.identity.identityAccountId)));
  assert.equal(contact.username, "bot");
  assert.deepEqual(contact.devices, [target(bot.device)]);
  assert.equal(state.requests.get(decoded.requestId).status, "accepted");
  // The welcome message is the request's inner message, delivered, under the request id.
  const welcome = state.messages.get(decoded.requestId);
  assert.deepEqual([welcome.direction, welcome.status, welcome.content.text], ["outgoing", "delivered", "hello bot"]);
  // The requester fans its devices out too, on the multi-device session the acceptor can now read.
  const botSession = openSession(store, bot.identity, bot.device, web.identity, [target(web.device)]);
  const fanout = await waitFor(() => botSession.received.find((m) => m.content.tag === "deviceAdded"));
  assert.deepEqual(fanout.content.value.statementAccountId, web.device.statementAccountId);
  botSession.session.dispose();
  botChannel.dispose();
});

// ── Engine: messaging against a hand-driven peer ─────────────────────────

/** The peer's transport, as a bot runs it: identity channel + device session towards the web device. */
const openPeerTransport = (store, self, web) => {
  const events = [];
  const received = [];
  const channel = openChannel(store, self, web, events);
  const roster = createPeerRoster([]);
  const session = createPeerSession({
    identity: self.identity,
    deviceKeys: self.device,
    peerIdentityAccountId: web.identity.identityAccountId,
    peerIdentityChatPublicKey: web.identity.identityChatPublicKey,
    peerRoster: roster,
    prover: createSr25519Prover(self.device.statementSeed),
    allocator: createExpiryAllocator(),
    statementStore: store,
    onMessage: (m) => received.push(m),
    onSent: () => undefined,
    onDelivered: () => undefined,
    onBatchDelivered: () => undefined,
  });
  let counter = 0;
  return {
    events, received, channel, roster,
    send: (content, timestamp = Date.now()) => session.send(content, { messageId: `peer-${++counter}`, timestamp }),
    dispose: () => { channel.dispose(); session.dispose(); },
  };
};

/** Peer sends a request, the web accepts, the peer learns the web device. */
const establish = async (store, web, peer, engine, state, transport) => {
  const { requestId } = await requestFrom(store, peer, web, "hi from the bot");
  await waitFor(() => state.requests.get(requestId));
  await engine.acceptRequest(requestId);
  const accepted = await waitFor(() => transport.events.find((e) => e.tag === "accepted"));
  transport.roster.set([accepted.device]);
  return { requestId, peerKey: bytesToHex(peer.identity.identityAccountId) };
};

test("engine: accept creates the room with the welcome message (read), the system row and the device fan-out", async (t) => {
  const store = makeStore();
  const web = makePeer();
  const bot = makePeer();
  const { engine, state } = openEngine(web, store, lookupOf(bot));
  const transport = openPeerTransport(store, bot, web);
  t.after(() => { transport.dispose(); engine.dispose(); });
  const { requestId, peerKey } = await establish(store, web, bot, engine, state, transport);
  const rows = state.messages.list(peerKey);
  assert.deepEqual(rows.map((r) => [r.direction, r.content]), [["incoming", { type: "text", text: "hi from the bot" }], ["system", { type: "contactAdded" }]]);
  assert.equal(rows[0].messageId, requestId);
  assert.deepEqual(rows[0].receivedBy, [1]);
  assert.equal(state.messages.rooms()[0].unreadCount, 0);
  // The phone's fan-out: every own device announced on the multi-device session.
  const fanout = await waitFor(() => transport.received.find((m) => m.content.tag === "deviceAdded"));
  assert.deepEqual(fanout.content.value.statementAccountId, web.device.statementAccountId);
});

test("engine: sends text sending → sent → delivered on the ack; applies the peer's text, reaction, edit, reply; counts unread", async (t) => {
  const store = makeStore();
  const web = makePeer();
  const bot = makePeer();
  const { engine, state } = openEngine(web, store, lookupOf(bot));
  const transport = openPeerTransport(store, bot, web);
  t.after(() => { transport.dispose(); engine.dispose(); });
  const { peerKey } = await establish(store, web, bot, engine, state, transport);

  const { messageId } = await engine.sendMessage(peerKey, { type: "text", text: "mine" });
  assert.equal(state.messages.get(messageId).status, "sent");
  await waitFor(() => transport.received.find((m) => m.content.tag === "text" && m.content.value === "mine"));
  await waitFor(() => state.messages.get(messageId).status === "delivered");
  assert.equal(state.messages.rooms()[0].lastPreview, "mine");

  await transport.send({ tag: "text", value: "theirs" }, 100);
  await transport.send({ tag: "reacted", value: { messageId, emoji: "🔥" } }, 101);
  await transport.send({ tag: "edit", value: { messageId: "peer-1", newContent: { text: "theirs (fixed)", attachments: undefined } } }, 102);
  await transport.send({ tag: "reply", value: { messageId, ownContent: { text: "answer", attachments: undefined } } }, 103);
  await waitFor(() => state.messages.list(peerKey).some((r) => r.content.type === "reply"));
  const theirs = state.messages.get("peer-1");
  assert.deepEqual([theirs.direction, theirs.content, theirs.editedAt, theirs.receivedBy, theirs.ackedBy], ["incoming", { type: "text", text: "theirs (fixed)" }, 102, [1], [1]]);
  assert.deepEqual(state.messages.get(messageId).reactions, [{ emoji: "🔥", by: "peer" }]);
  // The welcome message was read on accept; the two new visible rows are not.
  assert.equal(state.messages.rooms()[0].unreadCount, 2);
  assert.equal(state.messages.list(peerKey, { unread: true }).length, 2);
  state.messages.markRoomRead(peerKey);
  assert.equal(state.messages.rooms()[0].unreadCount, 0);

  // Our own reaction and edit go out and are applied locally.
  await engine.react(peerKey, "peer-1", "👍", true);
  await engine.edit(peerKey, messageId, "mine (edited)");
  assert.deepEqual(state.messages.get("peer-1").reactions, [{ emoji: "👍", by: "me" }]);
  assert.deepEqual(state.messages.get(messageId).content, { type: "text", text: "mine (edited)" });
  await waitFor(() => transport.received.some((m) => m.content.tag === "edit"));
  assert.ok(["reacted", "edit"].every((tag) => transport.received.some((m) => m.content.tag === tag)));
  await assert.rejects(engine.edit(peerKey, "peer-1", "not mine"), /no own message/);
});

test("engine: declines a call offer with dataChannelClosed, shows a bot welcome on the identity session, fails without a session", async (t) => {
  const store = makeStore();
  const web = makePeer();
  const bot = makePeer();
  const { engine, state } = openEngine(web, store, lookupOf(bot));
  const transport = openPeerTransport(store, bot, web);
  t.after(() => { transport.dispose(); engine.dispose(); });
  const { peerKey } = await establish(store, web, bot, engine, state, transport);

  await transport.send({ tag: "dataChannelOffer", value: { sdp: new Uint8Array([1]), purpose: "VIDEO_CALL" } });
  const closed = await waitFor(() => transport.received.find((m) => m.content.tag === "dataChannelClosed"));
  assert.equal(closed.content.value.offerMessageId, "peer-1");
  assert.ok(state.messages.list(peerKey).some((r) => r.content.type === "callDeclined"));

  await transport.channel.post({ tag: "text", value: "welcome from identity session" });
  await waitFor(() => state.messages.list(peerKey).some((r) => r.content.type === "text" && r.content.text === "welcome from identity session"));

  // The other way round: our own call offer is a row; the peer's
  // dataChannelClosed becomes a system row under it, a stray close is noise.
  const { messageId: offerId } = await engine.call(peerKey);
  const offer = await waitFor(() => transport.received.find((m) => m.content.tag === "dataChannelOffer"));
  assert.equal(offer.messageId, offerId);
  assert.equal(state.messages.get(offerId).content.type, "callOffer");
  await transport.send({ tag: "dataChannelClosed", value: { offerMessageId: "never-sent" } });
  await transport.send({ tag: "dataChannelClosed", value: { offerMessageId: offerId } });
  const hungUp = await waitFor(() => state.messages.get(`call-closed:${offerId}`));
  assert.deepEqual([hungUp.direction, hungUp.content], ["system", { type: "callDeclined", offerMessageId: offerId }]);
  assert.equal(state.messages.get("call-closed:never-sent"), undefined);

  // Raw bytes ride the batch with no row of their own.
  await engine.sendRaw(peerKey, poisonMessage());
  assert.equal(state.messages.list(peerKey).filter((r) => r.direction === "outgoing").length, 1, "the offer is the only outgoing row");

  // Device removal fans out to every contact; the peer drops the device.
  await engine.announceDeviceRemoved(web.device.statementAccountId);
  const removed = await waitFor(() => transport.received.find((m) => m.content.tag === "deviceRemoved"));
  assert.deepEqual(removed.content.value.statementAccountId, web.device.statementAccountId);

  await assert.rejects(engine.sendMessage(`0x${"dead".repeat(16)}`, { type: "text", text: "x" }), /no chat session/);
  assert.ok(state.messages.list(`0x${"dead".repeat(16)}`).every((r) => r.status === "failed"));
});
