import { test } from "node:test";
import assert from "node:assert/strict";
import {
  T3AMS_BACKFILL_CONVERSATION_CAP,
  T3AMS_BACKFILL_BUDGET_BYTES,
  T3AMS_STATE_VERSION,
  bareHex,
  bytesToHex,
  createT3amsProtocol,
  hexToBytes,
  normalizeT3amsState,
  stateDocSupersedes,
  t3amsConversationKey,
} from "../lib/t3ams-protocol.mjs";

test("hex helpers canonicalize prefixes and round-trip bytes", () => {
  assert.equal(bareHex(" 0XDeAdBEEF "), "deadbeef");
  assert.equal(bareHex(null), "");
  assert.equal(bytesToHex(Uint8Array.of(0, 1, 15, 16, 255)), "00010f10ff");
  assert.deepEqual([...hexToBytes("0X00010F10ff")], [0, 1, 15, 16, 255]);
  assert.deepEqual([...hexToBytes("")], []);
});

test("hex decoding rejects malformed input instead of silently truncating it", () => {
  for (const value of ["0x0", "0xzz", "ab-cd", "0x12 34"]) {
    assert.throws(() => hexToBytes(value), /invalid hexadecimal value/, String(value));
  }
});

test("conversation keys are deterministic and namespace direct and channel sessions", () => {
  assert.equal(
    t3amsConversationKey({ kind: "dm", peerXidHex: "0XAbCd" }),
    "t3ams:dm:abcd",
  );
  assert.equal(
    t3amsConversationKey({ kind: "channel", wsId: "Engineering-West", channelIdHex: "0X00Ff" }),
    "t3ams:channel:Engineering-West:00ff",
  );
  assert.throws(() => t3amsConversationKey({ kind: "workspace" }), /unknown T3ams conversation/);
  assert.throws(() => t3amsConversationKey(null), /unknown T3ams conversation/);
});

test("state document conflict resolution is version, timestamp, then signer-XID", () => {
  const current = { version: 4, timestamp: 10, signerXid: "alice" };
  assert.equal(stateDocSupersedes(current, { version: 5, timestamp: 0, signerXid: "any" }), true);
  assert.equal(stateDocSupersedes(current, { version: 3, timestamp: 99, signerXid: "z" }), false);
  assert.equal(stateDocSupersedes(current, { version: 4, timestamp: 11, signerXid: "a" }), true);
  assert.equal(stateDocSupersedes(current, { version: 4, timestamp: 9, signerXid: "z" }), false);
  assert.equal(stateDocSupersedes(current, { version: 4, timestamp: 10, signerXid: "zoe" }), true);
  assert.equal(stateDocSupersedes(current, { version: 4, timestamp: 10, signerXid: "aaron" }), false);
});

const bytes = (fill) => new Uint8Array(32).fill(fill);
const xid = (value) => Buffer.from(value).toString("hex");
const parameter = (value) => ({
  extractString: () => value,
  extractNumber: () => value,
  extractBytes: () => value,
});

function directMessageFixture({ root = null, pinned = true } = {}) {
  const self = bytes(0xa1);
  const peer = bytes(0xb2);
  const messageId = bytes(0xc3);
  const input = Uint8Array.of(1);
  const cipher = Uint8Array.of(2);
  const signed = {
    expression: {
      functionName: "sendMessage",
      parameters: {
        id: parameter(messageId),
        body: parameter("hello from T3ams"),
        timestamp: parameter(1),
        to: parameter(self),
        ...(root == null ? {} : { threadRootId: parameter(root) }),
      },
    },
  };
  const envelopes = new Map([
    [input, { carrier: { message: cipher } }],
    [cipher, { signed }],
  ]);
  const bcts = {
    formatXID: xid,
    envelopeFromBytes: (value) => envelopes.get(value) ?? value,
    parseMessageCarrier: (value) => value.carrier ?? null,
    decryptDMEnvelope: (value) => value.signed,
    parseGSTPMessage: (value) => ({ type: "request", body: value.expression }),
    extractFunctionName: (value) => value.functionName,
    extractParameter: (value, name) => value.parameters[name] ?? null,
    verifyGSTPRequestSignature: () => true,
    SigningPublicKey: { fromTaggedCborData: () => ({}) },
  };
  const protocol = createT3amsProtocol({
    bcts,
    identity: { xid: self, signingPrivateKey: bytes(0xd4) },
    displayName: "Atlas",
    submit: async () => {},
  });
  protocol.addPeer(xid(peer), pinned ? { signingPubKeyHex: "11" } : {});
  return { protocol, input, peer: xid(peer), messageId: xid(messageId), root: root == null ? null : xid(root) };
}

test("DM reply targets retain an explicit thread but never invent one for a top-level message", () => {
  const topLevel = directMessageFixture();
  const topEvent = topLevel.protocol.receiveDm(topLevel.peer, topLevel.input);
  const topChat = t3amsConversationKey({ kind: "dm", peerXidHex: topLevel.peer });
  assert.equal(topEvent.chatId, topChat);
  assert.equal(topEvent.threadRootId, null);
  assert.equal(topLevel.protocol.conversation(topChat), null, "a claimed carrier must not allocate a durable reply route yet");
  assert.equal(topLevel.protocol.commitInbound(topEvent), true);
  assert.equal(topLevel.protocol.conversation(topChat).threadRootId, null);
  assert.equal(topLevel.protocol.replyThreadFor(topChat, topLevel.messageId), null);

  const threaded = directMessageFixture({ root: bytes(0xe5) });
  const threadEvent = threaded.protocol.receiveDm(threaded.peer, threaded.input);
  const threadChat = t3amsConversationKey({ kind: "dm", peerXidHex: threaded.peer });
  assert.equal(threadEvent.threadRootId, threaded.root);
  assert.equal(threaded.protocol.commitInbound(threadEvent), true);
  assert.equal(threaded.protocol.conversation(threadChat).threadRootId, threaded.root);
  assert.equal(threaded.protocol.replyThreadFor(threadChat, threaded.messageId), threaded.root);
});

test("a DM without a pinned handshake signing key never reaches the bot", () => {
  const unpinned = directMessageFixture({ pinned: false });
  assert.equal(unpinned.protocol.receiveDm(unpinned.peer, unpinned.input), null);
});

test("carrier messages are claimed before durable admission, then committed or released explicitly", () => {
  const fixture = directMessageFixture();
  const chatId = t3amsConversationKey({ kind: "dm", peerXidHex: fixture.peer });
  const first = fixture.protocol.receiveDm(fixture.peer, fixture.input);
  assert.ok(first);
  assert.equal(fixture.protocol.receiveDm(fixture.peer, fixture.input), null, "a pending claim suppresses duplicate delivery");

  assert.equal(fixture.protocol.releaseInbound(first), true);
  const replay = fixture.protocol.receiveDm(fixture.peer, fixture.input);
  assert.ok(replay, "a released source can be admitted again");
  assert.equal(fixture.protocol.commitInbound(replay), true);
  assert.equal(fixture.protocol.receiveDm(fixture.peer, fixture.input), null, "a committed source remains deduplicated");

  const snapshot = fixture.protocol.snapshot();
  assert.deepEqual(snapshot.seen, [`${chatId}:${fixture.messageId}`]);
  assert.deepEqual(snapshot.backfill[chatId], [{
    id: fixture.messageId,
    senderXid: fixture.peer,
    timestamp: 1,
    blob: "02",
  }]);
});

test("a durable ingress record reconstructs a replyable T3ams conversation after restart", () => {
  const fixture = directMessageFixture({ root: bytes(0xe5) });
  const chatId = t3amsConversationKey({ kind: "dm", peerXidHex: fixture.peer });
  const restored = {
    accepted: true,
    conversationKey: chatId,
    replyTarget: { replyToMessageId: fixture.messageId, threadRootId: fixture.root },
    message: {
      kind: "text",
      messageId: fixture.messageId,
      text: "hello from T3ams",
      conversationType: "dm",
      workspaceId: null,
      channelId: null,
      threadRootId: fixture.root,
      senderXid: fixture.peer,
      senderName: "Peer",
    },
  };
  assert.equal(fixture.protocol.restoreInboundConversation(restored), true);
  assert.equal(fixture.protocol.conversation(chatId).threadRootId, fixture.root);
  assert.equal(fixture.protocol.replyThreadFor(chatId, fixture.messageId), fixture.root);
});

test("a private first workspace invite verifies the configured signing-key pin", async () => {
  const self = bytes(0xa1);
  const peer = bytes(0xb2);
  const sealed = Uint8Array.of(7);
  const input = Uint8Array.of(8);
  const signed = {
    expression: {
      functionName: "workspaceInvite",
      parameters: {
        senderXid: parameter(peer),
        senderName: parameter("Peer"),
        timestamp: parameter(1),
        sealed: parameter(sealed),
      },
    },
  };
  let verifyCalls = 0;
  const bcts = {
    formatXID: xid,
    envelopeFromBytes: (value) => value === input ? signed : value,
    parseGSTPMessage: (value) => ({ type: "request", body: value.expression }),
    extractFunctionName: (value) => value.functionName,
    extractParameter: (value, name) => value.parameters[name] ?? null,
    verifyGSTPRequestSignature: () => { verifyCalls += 1; return false; },
    SigningPublicKey: { fromTaggedCborData: () => ({}) },
  };
  const protocol = createT3amsProtocol({
    bcts,
    identity: { xid: self, signingPrivateKey: bytes(0xd4) },
    displayName: "Atlas",
    submit: async () => {},
    trustedPeerSigningKeys: { [xid(peer)]: "11" },
    requireTrustedPeers: true,
    acceptWorkspaceInvite: () => true,
  });
  assert.equal(await protocol.receiveInbox(input), null);
  assert.equal(verifyCalls, 1, "the first invite must be checked against the configured pin");
});

test("state normalization returns a fresh empty current-version state for invalid snapshots", () => {
  const expected = {
    v: T3AMS_STATE_VERSION,
    peers: {},
    workspaces: {},
    keys: {},
    backfill: {},
    seen: [],
    admissions: { publicPeers: [], publicWorkspaces: [] },
  };
  for (const raw of [null, [], "not-json", { v: T3AMS_STATE_VERSION - 1 }, { v: T3AMS_STATE_VERSION + 1 }]) {
    assert.deepEqual(normalizeT3amsState(raw), expected);
  }
  const one = normalizeT3amsState(null);
  const two = normalizeT3amsState(null);
  assert.notStrictEqual(one, two);
  assert.notStrictEqual(one.peers, two.peers);
});

test("state normalization retains valid state sections and resets malformed sections", () => {
  const peers = { alice: { xidHex: "aa" } };
  const workspaces = { team: { channels: [] } };
  const state = normalizeT3amsState({
    v: T3AMS_STATE_VERSION,
    peers,
    workspaces,
    keys: [],
    backfill: null,
    seen: ["first", 42, null, "second"],
  });

  assert.equal(state.v, T3AMS_STATE_VERSION);
  assert.strictEqual(state.peers, peers);
  assert.strictEqual(state.workspaces, workspaces);
  assert.deepEqual(state.keys, {});
  assert.deepEqual(state.backfill, {});
  assert.deepEqual(state.seen, ["first", "second"]);
});

test("state normalization bounds deduplication history to the newest 20,000 string IDs", () => {
  const seen = Array.from({ length: 20_005 }, (_, index) => `message-${index}`);
  const state = normalizeT3amsState({ v: T3AMS_STATE_VERSION, seen });
  assert.equal(state.seen.length, 20_000);
  assert.equal(state.seen[0], "message-5");
  assert.equal(state.seen.at(-1), "message-20004");
});

test("state normalization bounds retained backfill globally and drops blobs that cannot fit a carrier", () => {
  const hex64 = (value) => value.toString(16).padStart(64, "0");
  const backfill = {};
  for (let index = 0; index < T3AMS_BACKFILL_CONVERSATION_CAP + 12; index += 1) {
    const id = hex64(index + 1);
    backfill[`t3ams:dm:${id}`] = [{
      id,
      senderXid: hex64(index + 10_000),
      timestamp: index,
      blob: "02",
    }];
  }
  const oversizedId = hex64(99_999);
  backfill[`t3ams:dm:${oversizedId}`] = [{
    id: oversizedId,
    senderXid: hex64(88_888),
    timestamp: 1,
    blob: "aa".repeat(T3AMS_BACKFILL_BUDGET_BYTES),
  }];

  const state = normalizeT3amsState({ v: T3AMS_STATE_VERSION, backfill });
  assert.equal(Object.keys(state.backfill).length, T3AMS_BACKFILL_CONVERSATION_CAP);
  assert.equal(state.backfill[`t3ams:dm:${oversizedId}`], undefined);
  assert.ok(Object.values(state.backfill).every((entries) => entries.every((entry) => entry.blob.length / 2 < T3AMS_BACKFILL_BUDGET_BYTES)));
});

test("state normalization keeps key slots only for active registered private channels", () => {
  const wsId = "11".repeat(32);
  const channelId = "22".repeat(32);
  const owner = "33".repeat(32);
  const validKeyId = `${wsId}:${channelId}`;
  const state = normalizeT3amsState({
    v: T3AMS_STATE_VERSION,
    workspaces: {
      [wsId]: {
        channels: [{ idHex: channelId, creatorXid: owner, isPrivate: true }],
      },
    },
    keys: {
      [validKeyId]: { current: { keyHex: "aa".repeat(32), version: 1 }, previous: [] },
      [`${wsId}:${"44".repeat(32)}`]: { current: { keyHex: "bb".repeat(32), version: 1 }, previous: [] },
    },
  });

  assert.deepEqual(Object.keys(state.keys), [validKeyId]);
  assert.equal(state.keys[validKeyId].current.keyHex, "aa".repeat(32));
});

test("public TOFU peer admission reclaims a stale unpinned peer but preserves configured pins", () => {
  const self = bytes(0xa1);
  const oldPeer = "b2".repeat(32);
  const newPeer = "c3".repeat(32);
  const bcts = { formatXID: xid };
  const protocol = createT3amsProtocol({
    bcts,
    identity: { xid: self, signingPrivateKey: bytes(0xd4) },
    displayName: "Atlas",
    state: { v: T3AMS_STATE_VERSION, peers: { [oldPeer]: { xidHex: oldPeer, signingPubKeyHex: "11", lastActivityAt: 0 } } },
    submit: async () => {},
    publicTofuEnrollment: true,
    maxPeers: 1,
  });
  assert.ok(protocol.addPeer(newPeer, { signingPubKeyHex: "22" }));
  assert.deepEqual(protocol.peerIds(), [newPeer]);

  const pinned = createT3amsProtocol({
    bcts,
    identity: { xid: self, signingPrivateKey: bytes(0xd4) },
    displayName: "Atlas",
    submit: async () => {},
    publicTofuEnrollment: true,
    maxPeers: 1,
    trustedPeerSigningKeys: { [oldPeer]: "11" },
  });
  assert.equal(pinned.addPeer(newPeer, { signingPubKeyHex: "22" }), null);
  assert.deepEqual(pinned.peerIds(), [oldPeer]);
});
