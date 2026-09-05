// Chat requests, ported from polkadot-chat-web requests/{topics,gateway}.spec.ts.
// The topic vectors are the iOS known answers: a topic that differs from the
// phone's by one byte is a request nobody reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519.js";
import { createExpiryAllocator, createInMemoryStatementStore } from "@novasamatech/statement-store";
import { Bytes } from "scale-ts";
import { bytesToHex } from "../lib/bytes.mjs";
import { createPersonaState } from "../lib/persona.mjs";
import {
  computeAllPeerTopic, computeChannelTopic, computePaginationTopic, decodeChatRequest, getCurrentDay,
  intakeRequestStatement, sendChatRequest, subscribeToIncomingRequests, verifyIdentityProof,
} from "../lib/requests.mjs";
import { lookupOf, makePeer, waitFor } from "./helpers.mjs";

const EPOCH_SECS = 1_763_164_800;
const FIXED_ACCOUNT_ID = new Uint8Array(32).fill(0xcd);
const FIXED_SESSION_ID = new Uint8Array(32).fill(0x11);
const FIXED_SHARED_SECRET = new Uint8Array(32).fill(0x22);

test("getCurrentDay counts days from the shared epoch and is null before it", () => {
  assert.equal(getCurrentDay(EPOCH_SECS * 1000).day, 0n);
  assert.equal(getCurrentDay((EPOCH_SECS + 86_399) * 1000).day, 0n);
  assert.equal(getCurrentDay((EPOCH_SECS + 86_400) * 1000).day, 1n);
  assert.equal(getCurrentDay((EPOCH_SECS - 1) * 1000), null);
  assert.equal(getCurrentDay(EPOCH_SECS * 1000).remainedTillNext, 86_400);
  assert.equal(getCurrentDay((EPOCH_SECS + 3_600) * 1000).remainedTillNext, 82_800);
});

test("discovery topics match the iOS vectors", () => {
  assert.equal(bytesToHex(computeAllPeerTopic(FIXED_ACCOUNT_ID)), "0x28b70dc78c624968822216bee923a5048583f84909a51bba05851649a8deda38");
  assert.equal(bytesToHex(computePaginationTopic(FIXED_ACCOUNT_ID, 0n)), "0xe8a7a80a0824f569d5757207f29de4fd7dde9b03ba7aa9cf214c1ec7eb34e9df");
  assert.equal(bytesToHex(computePaginationTopic(FIXED_ACCOUNT_ID, 1n)), "0x5ffebc38db45ecca594cdf72255134bfa58fb5169728c228ec7035593152ff8a");
  assert.equal(bytesToHex(computePaginationTopic(FIXED_ACCOUNT_ID, 100n)), "0x124408ff61e31cd8adbcdcc6ca5a23b14d3d446b4529d28c5ca5b8c021e980b7");
  assert.equal(bytesToHex(computeChannelTopic(FIXED_SESSION_ID, FIXED_SHARED_SECRET)), "0x655629fba2e8b947fa439627b817a7eaed233ed5a0e37b54fd49699ec8243004");
  assert.notDeepEqual(computeAllPeerTopic(new Uint8Array(32).fill(1)), computeAllPeerTopic(new Uint8Array(32).fill(2)));
  assert.notDeepEqual(computeChannelTopic(FIXED_SESSION_ID, new Uint8Array(32).fill(1)), computeChannelTopic(FIXED_SESSION_ID, new Uint8Array(32).fill(2)));
});

const send = (store, from, to, welcomeMessage = "hello") => sendChatRequest({
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

const lastData = (store) => {
  const data = store.acceptedStatements().at(-1)?.data;
  if (!data) throw new Error("no statement submitted");
  return data;
};

test("round trip: reaches the recipient on its discovery topics and decodes with the identity chat key", async () => {
  const store = createInMemoryStatementStore();
  const alice = makePeer();
  const bob = makePeer();
  const { requestId } = await send(store, alice, bob);

  const statement = store.acceptedStatements().at(-1);
  // Full topic + day topic + channel: what the phone and the bots subscribe to.
  assert.equal(statement.topics.length, 3);
  assert.ok(statement.topics.includes(bytesToHex(computeAllPeerTopic(bob.identity.identityAccountId))));

  const decoded = decodeChatRequest(lastData(store), bob.identity.identityAccountId, bob.identity.identityChatPrivateKey);
  assert.equal(decoded.requestId, requestId);
  assert.equal(decoded.welcomeMessage, "hello");
  // The sender is the identity, the device is what the session will address.
  assert.deepEqual(decoded.senderIdentityAccountId, alice.identity.identityAccountId);
  assert.deepEqual(decoded.senderDevice.statementAccountId, alice.device.statementAccountId);
  assert.deepEqual(decoded.senderDevice.encryptionPublicKey, alice.device.encryptionPublicKey);
  assert.equal(verifyIdentityProof(decoded, bob.identity.identityChatPrivateKey, alice.identity.identityChatPublicKey), true);

  // Unreadable with another identity chat key.
  const eve = makePeer();
  assert.equal(decodeChatRequest(lastData(store), bob.identity.identityAccountId, eve.identity.identityChatPrivateKey), null);
  // The signature covers the recipient: a request captured on Bob's topic
  // cannot be replayed to Carol by re-publishing it on her topic.
  const carol = makePeer();
  assert.equal(decodeChatRequest(lastData(store), carol.identity.identityAccountId, bob.identity.identityChatPrivateKey), null);
  // mds.md: the proof is keyed by the sender's CURRENT identity chat key.
  const rotated = x25519.getPublicKey(x25519.utils.randomSecretKey());
  assert.equal(verifyIdentityProof(decoded, bob.identity.identityChatPrivateKey, rotated), false);
});

test("accepts the bot-core form with an outer Bytes() wrapper; garbage is null, not a throw", async () => {
  const store = createInMemoryStatementStore();
  const alice = makePeer();
  const bob = makePeer();
  const { requestId } = await send(store, alice, bob, null);
  const decoded = decodeChatRequest(Bytes().enc(lastData(store)), bob.identity.identityAccountId, bob.identity.identityChatPrivateKey);
  assert.equal(decoded.requestId, requestId);
  assert.equal(decoded.welcomeMessage, null);
  assert.equal(decodeChatRequest(new Uint8Array([1, 2, 3]), bob.identity.identityAccountId, bob.identity.identityChatPrivateKey), null);
});

test("subscribeToIncomingRequests delivers existing and later requests once each, and only ours", async () => {
  const store = createInMemoryStatementStore();
  const alice = makePeer();
  const bob = makePeer();
  const carol = makePeer();
  await send(store, alice, bob);

  const received = [];
  const stop = subscribeToIncomingRequests({ ownAccountId: bob.identity.identityAccountId, statementStore: store, pollIntervalMs: 20 }, (data) => received.push(data));
  await waitFor(() => received.length === 1);
  await send(store, carol, bob);
  assert.equal(received.length, 2);
  await send(store, alice, carol);
  // The poll sees the statements again but must not replay them; carol's request is not ours.
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(received.length, 2);
  stop();
  assert.equal(store.activeSubscriptions(), 0);
});

test("intake records a verified request once and drops unknown senders and bad proofs", async () => {
  const store = createInMemoryStatementStore();
  const web = makePeer();
  const phone = makePeer();
  const stranger = makePeer();
  const impostor = makePeer();
  const state = createPersonaState();
  // The lookup knows `phone` and `impostor`; `stranger` signs with its own
  // identity key and claims impostor's account, so the proof fails.
  const deps = { identity: web.identity, lookup: lookupOf(phone, impostor), state };

  const { requestId } = await send(store, phone, web, "hi web");
  await intakeRequestStatement(deps, lastData(store));
  await intakeRequestStatement(deps, lastData(store));
  const request = state.requests.get(requestId);
  assert.deepEqual([request.direction, request.status, request.welcomeMessage, request.peerUsername], ["incoming", "pending", "hi web", "user-0"]);
  assert.deepEqual(request.senderDevice.encryptionPublicKey, phone.device.encryptionPublicKey);
  assert.equal(state.requests.list().length, 1);

  await send(store, stranger, web, null);
  await intakeRequestStatement(deps, lastData(store));
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
  await intakeRequestStatement(deps, lastData(store));
  assert.equal(state.requests.list().length, 1, "unknown sender and wrong proof are dropped");
});
