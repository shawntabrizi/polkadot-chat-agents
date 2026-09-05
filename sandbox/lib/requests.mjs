// Chat requests: discovery topics, wire codec, send / decode / verify, the
// topic subscription and the intake into a persona's request list. Ported
// from polkadot-chat-web src/domain/requests/{topics,codec,gateway,intake}.ts,
// which port polkadot-desktop's chat request gateway with two additions the
// desktop lacks: the inner sr25519 signature is verified (so a request
// captured on one identity's topic cannot be replayed to another) and the
// mds.md identity proof is checked against the sender's CURRENT on-chain chat
// key. bot-core does both too.
//
// Topics, codecs and the identity proof must match iOS/Android byte for byte:
//   ChatRequest+PaginationTopic.swift, ChatRequestFactory.swift,
//   RemoteChatRequestMessage.swift, Android ChatRequestRemoteModel.kt and
//   IdentityProofCodec.kt. The iOS known-answer vectors are in the tests.

import { blake2b } from "@noble/hashes/blake2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { RichTextContent, TokenContent } from "@novasamatech/host-chat/codec/message";
import {
  createEncryption,
  createSr25519Prover,
  deriveSr25519PublicKey,
  khash,
  signAndSubmitStatement,
  signWithSr25519Secret,
  verifySr25519Signature,
} from "@novasamatech/statement-store";
import { mergeUint8 } from "polkadot-api/utils";
import { Bytes, Enum, Option, Struct, compact, str, u64 } from "scale-ts";

import { bytesEqual, bytesToHex, log, randomId } from "./bytes.mjs";
import { isUsablePeerDevice } from "./device.mjs";

// ── Topics ───────────────────────────────────────────────────────────────

/** 2025-11-15T00:00:00Z — the same day epoch as iOS and Android. */
const EPOCH = 1_763_164_800;
const SECONDS_IN_DAY = 86_400;
const CONTEXT = new TextEncoder().encode("chat-request");

const TopicWithoutDay = Struct({ context: Bytes(), accountId: Bytes() });
const TopicWithDay = Struct({ context: Bytes(), accountId: Bytes(), day: u64 });

/** Day number since EPOCH and the seconds until the next day; null before the epoch. */
export const getCurrentDay = (now = Date.now()) => {
  const nowSecs = Math.floor(now / 1000);
  const elapsed = nowSecs - EPOCH;
  if (elapsed < 0) return null;
  const dayNumber = Math.floor(elapsed / SECONDS_IN_DAY);
  return { day: BigInt(dayNumber), remainedTillNext: EPOCH + (dayNumber + 1) * SECONDS_IN_DAY - nowSecs };
};

/** Full-history topic for a recipient identity: blake2b-256(SCALE(context, accountId)). */
export const computeAllPeerTopic = (recipientAccountId) =>
  blake2b(TopicWithoutDay.enc({ context: CONTEXT, accountId: recipientAccountId }), { dkLen: 32 });

/** Day-scoped topic: blake2b-256(SCALE(context, accountId, day)). */
export const computePaginationTopic = (recipientAccountId, day) =>
  blake2b(TopicWithDay.enc({ context: CONTEXT, accountId: recipientAccountId, day }), { dkLen: 32 });

/** Channel of one request: khash(sharedSecret, "chat-request" || ephemeralPubKey). Both sides can derive it. */
export const computeChannelTopic = (ephemeralPublicKey, sharedSecret) => khash(sharedSecret, mergeUint8([CONTEXT, ephemeralPublicKey]));

// ── Codec ────────────────────────────────────────────────────────────────

const AccountIdCodec = Bytes(32);
const PublicKeyCodec = Bytes(32);

export const RequestContentV1 = Struct({ pushToken: Option(TokenContent), welcomeMessage: Option(RichTextContent) });

/** Binds the kHash to this use; must match Android `IdentityProofCodec.CHAT_REQUEST_CONTEXT`. */
export const IDENTITY_PROOF_CONTEXT = "mds-chat-request";

export const IdentityProofPayload = Struct({ identityAccountId: AccountIdCodec, statementAccountId: AccountIdCodec, context: str });
export const IdentityProof = Struct({ identityAccountId: AccountIdCodec, proof: Bytes(32) });

export const RequestContentV2 = Struct({
  identityProof: IdentityProof,
  deviceEncPubKey: PublicKeyCodec,
  pushToken: Option(TokenContent),
  welcomeMessage: Option(RichTextContent),
});

export const VersionedRequestContent = Enum({ v1: RequestContentV1, v2: RequestContentV2 });
export const RequestMessage = Struct({ messageId: str, timestamp: u64, content: VersionedRequestContent });

export const StatementProofCodec = Enum({
  sr25519: Struct({ signature: Bytes(64), signer: Bytes(32) }),
  ed25519: Struct({ signature: Bytes(64), signer: Bytes(32) }),
});

/** What the inner sr25519 signature covers: the message plus the recipient. */
export const ProofPayload = Struct({ message: RequestMessage, requestAcceptorId: Bytes() });
export const RemoteModel = Struct({ message: RequestMessage, proof: StatementProofCodec });
/** Statement data: an ephemeral X25519 key and the ChaCha20-Poly1305 ciphertext of `RemoteModel`. */
export const EncryptedRemoteModel = Struct({ encryptionPubKey: Bytes(), encryptedData: Bytes() });

// ── Gateway ──────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [500, 1500, 3000];
const ENCRYPTION_KEY_BYTES = 32;
/** The chain delivers a statement once when it first appears; polling covers the rest. */
const POLL_INTERVAL_MS = 10_000;

/**
 * One statement on the recipient's discovery topics (full + day) with its own
 * channel. Data is `EncryptedRemoteModel`: an ephemeral X25519 key plus the
 * `RemoteModel` encrypted to the recipient's identity chat key. Signed by the
 * sending device's statement account; never acknowledged.
 */
export const sendChatRequest = async (params) => {
  const currentDay = getCurrentDay();
  if (!currentDay) throw new Error("current time is before the chat request epoch");

  // Envelope: ephemeral ECDH against the recipient's identity chat key.
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const envelopeSecret = x25519.getSharedSecret(ephemeralPrivateKey, params.recipientChatPublicKey);

  // Identity proof: keyed by the PERSISTENT identity-to-identity secret, not the
  // envelope secret, so the receiver can recompute it with its own chat key.
  const signer = deriveSr25519PublicKey(params.senderDeviceSeed);
  const identitySecret = x25519.getSharedSecret(params.senderIdentityChatPrivateKey, params.recipientChatPublicKey);
  const proof = khash(identitySecret, IdentityProofPayload.enc({
    identityAccountId: params.senderIdentityAccountId,
    statementAccountId: signer,
    context: IDENTITY_PROOF_CONTEXT,
  }));

  const requestId = randomId();
  const timestamp = Date.now();
  const message = {
    messageId: requestId,
    timestamp: BigInt(timestamp),
    content: {
      tag: "v2",
      value: {
        identityProof: { identityAccountId: params.senderIdentityAccountId, proof },
        deviceEncPubKey: params.senderDeviceEncryptionPublicKey,
        pushToken: undefined,
        welcomeMessage: params.welcomeMessage ? { text: params.welcomeMessage, attachments: undefined } : undefined,
      },
    },
  };

  const signature = signWithSr25519Secret(params.senderDeviceSeed, ProofPayload.enc({ message, requestAcceptorId: params.recipientAccountId }));
  const encrypted = createEncryption(envelopeSecret).encrypt(RemoteModel.enc({ message, proof: { tag: "sr25519", value: { signature, signer } } }));
  if (encrypted.isErr()) throw encrypted.error;

  const channel = computeChannelTopic(ephemeralPublicKey, envelopeSecret);
  const result = await signAndSubmitStatement({
    statementStore: params.statementStore,
    prover: createSr25519Prover(params.senderDeviceSeed),
    allocator: params.allocator,
    channel,
    topics: [computeAllPeerTopic(params.recipientAccountId), computePaginationTopic(params.recipientAccountId, currentDay.day), channel],
    data: EncryptedRemoteModel.enc({ encryptionPubKey: ephemeralPublicKey, encryptedData: encrypted.value }),
    retry: {
      attempts: 2,
      priorityAttempts: RETRY_DELAYS_MS.length,
      delaysMs: RETRY_DELAYS_MS,
      onRetry: ({ attempt, error }) => log("REQUEST_SUBMIT_RETRY", { attempt, error: error.message }),
    },
  });
  if (result.isErr()) throw result.error;
  return { requestId, timestamp };
};

// bot-core wraps the envelope in one more `Bytes()`; the apps do not. A raw
// envelope starts with compact(32) followed by the key, so reading a `Bytes()`
// prefix that spans exactly the whole payload identifies the wrapped form.
export const unwrapOuterBytes = (data) => {
  try {
    const length = Number(compact.dec(data));
    const prefix = compact.enc(length).length;
    if (prefix + length === data.length && length !== ENCRYPTION_KEY_BYTES) return data.slice(prefix);
  } catch {
    // not a compact prefix: fall through to the raw form
  }
  return data;
};

/**
 * Decrypt a request addressed to `ownAccountId` and check the inner signature.
 * `null` for anything that is not a request to us: wrong key, corrupt data, or
 * a forged signature.
 */
export const decodeChatRequest = (data, ownAccountId, ownIdentityChatPrivateKey) => {
  try {
    const envelope = EncryptedRemoteModel.dec(unwrapOuterBytes(data));
    if (envelope.encryptionPubKey.length !== ENCRYPTION_KEY_BYTES) return null;
    const secret = x25519.getSharedSecret(ownIdentityChatPrivateKey, envelope.encryptionPubKey);
    const plain = createEncryption(secret).decrypt(envelope.encryptedData);
    if (plain.isErr()) return null;

    const remote = RemoteModel.dec(plain.value);
    if (remote.proof.tag !== "sr25519") {
      log("REQUEST_DROPPED", { reason: "unsupported_proof", type: remote.proof.tag });
      return null;
    }
    const payload = ProofPayload.enc({ message: remote.message, requestAcceptorId: ownAccountId });
    if (!verifySr25519Signature(payload, remote.proof.value.signature, remote.proof.value.signer)) {
      log("REQUEST_DROPPED", { reason: "bad_device_signature" });
      return null;
    }

    const { content } = remote.message;
    const base = {
      requestId: remote.message.messageId,
      timestamp: Number(remote.message.timestamp),
      welcomeMessage: content.value.welcomeMessage?.text ?? null,
    };
    if (content.tag === "v1") {
      return { ...base, senderIdentityAccountId: remote.proof.value.signer, identityProof: null, senderDevice: null };
    }
    return {
      ...base,
      senderIdentityAccountId: content.value.identityProof.identityAccountId,
      identityProof: content.value.identityProof.proof,
      senderDevice: { statementAccountId: remote.proof.value.signer, encryptionPublicKey: content.value.deviceEncPubKey },
    };
  } catch (error) {
    log("REQUEST_DROPPED", { reason: "undecodable", error: error?.message ?? String(error) });
    return null;
  }
};

/**
 * mds.md: the acceptor MUST verify `proof == kHash(K(B,A), payload)` with the
 * sender's CURRENT on-chain identity chat key, so a rotated key bans the
 * devices that only know the old one.
 */
export const verifyIdentityProof = (request, ownIdentityChatPrivateKey, senderIdentityChatPublicKey) => {
  if (!request.identityProof || !request.senderDevice) return false;
  const secret = x25519.getSharedSecret(ownIdentityChatPrivateKey, senderIdentityChatPublicKey);
  const expected = khash(secret, IdentityProofPayload.enc({
    identityAccountId: request.senderIdentityAccountId,
    statementAccountId: request.senderDevice.statementAccountId,
    context: IDENTITY_PROOF_CONTEXT,
  }));
  return bytesEqual(expected, request.identityProof);
};

/**
 * Watch the identity's discovery topics. Every statement is handed over once
 * (by data bytes); the caller dedups by request id. A live subscription is
 * combined with a poll because the chain delivers a statement only when it
 * first appears on a topic, and the day topic rolls over at midnight UTC.
 */
export const subscribeToIncomingRequests = ({ ownAccountId, statementStore, pollIntervalMs = POLL_INTERVAL_MS }, onStatementData) => {
  const allPeerTopic = computeAllPeerTopic(ownAccountId);
  const seen = new Set();

  const handle = (data) => {
    if (!data) return;
    const key = bytesToHex(data);
    if (seen.has(key)) return;
    seen.add(key);
    onStatementData(data);
  };

  const topics = () => {
    const day = getCurrentDay();
    return day ? [allPeerTopic, computePaginationTopic(ownAccountId, day.day)] : [allPeerTopic];
  };

  const poll = () => statementStore.queryStatements({ matchAny: topics() }).match(
    (statements) => statements.forEach((statement) => handle(statement.data)),
    (error) => log("REQUEST_POLL_FAILED", { error: error.message }),
  );

  const unsubscribe = statementStore.subscribeStatements({ matchAny: topics() }, (page) => page.statements.forEach((statement) => handle(statement.data)));
  void poll();
  const timer = setInterval(() => void poll(), pollIntervalMs);

  return () => {
    clearInterval(timer);
    unsubscribe();
  };
};

// ── Intake ───────────────────────────────────────────────────────────────

/**
 * Turn a statement on the identity's discovery topics into a pending request
 * row, or nothing. Every drop is logged: the sender sees no error.
 */
export const intakeRequestStatement = async ({ identity, lookup, state }, data) => {
  const decoded = decodeChatRequest(data, identity.identityAccountId, identity.identityChatPrivateKey);
  if (!decoded) return;
  if (bytesEqual(decoded.senderIdentityAccountId, identity.identityAccountId)) return;
  if (state.requests.get(decoded.requestId)) return;

  const peer = await lookup.getPeerIdentity(decoded.senderIdentityAccountId);
  if (!peer) {
    log("REQUEST_DROPPED", { requestId: decoded.requestId, reason: "sender_not_on_chain" });
    return;
  }
  // mds.md: verified against the sender's CURRENT on-chain chat key.
  if (!verifyIdentityProof(decoded, identity.identityChatPrivateKey, peer.chatPublicKey)) {
    log("REQUEST_DROPPED", { requestId: decoded.requestId, reason: "identity_proof_mismatch" });
    return;
  }
  if (!decoded.senderDevice || !isUsablePeerDevice(decoded.senderDevice)) {
    log("REQUEST_DROPPED", { requestId: decoded.requestId, reason: "no_usable_sender_device" });
    return;
  }
  state.requests.add({
    requestId: decoded.requestId,
    peer: bytesToHex(peer.accountId),
    peerUsername: peer.username,
    peerChatPublicKey: peer.chatPublicKey,
    direction: "incoming",
    status: "pending",
    welcomeMessage: decoded.welcomeMessage,
    timestamp: decoded.timestamp,
    senderDevice: decoded.senderDevice,
    device: null,
    createdAt: Date.now(),
  });
};
