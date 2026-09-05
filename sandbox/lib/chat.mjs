// The per-device chat engine: identity channels, multi-device sessions,
// content mapping and the wiring between them. Ported from
// polkadot-chat-web src/domain/chat/{content,identityEvents,identityChannel,
// peerRoster,peerSession,sessions,manager}.ts, which port polkadot-desktop's
// chat transport onto @novasamatech/statement-store. The web client's
// decisions (docs/decisions.md there) are kept; what changes here is that
// N engines share one persona state (the app syncs it between devices) and
// that the persona plays the phone's part in fanning its devices out.
//
// Transport facts this leans on (see docs/explanation/protocol.md):
//   - a request is answered with `deviceChatAccepted` on the IDENTITY session
//     (SessionId(B, A) keyed by K(A,B)), which every device of the requester
//     can read; everything else rides the multi-device session;
//   - the store keeps one statement per (signer, channel), so a session
//     re-sends its whole un-acked batch and receivers dedup by messageId;
//   - one undecodable message in a batch must not block the rest.

import { ChatMessage as ChatMessageCodec } from "@novasamatech/host-chat/codec/message";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  createAccountId,
  createEncryption,
  createExpiryAllocator,
  createMultiDeviceSession,
  createSession,
  createSr25519Prover,
} from "@novasamatech/statement-store";

import { bytesEqual, bytesToHex, hexToBytes, log, randomId } from "./bytes.mjs";
import { isUsablePeerDevice } from "./device.mjs";
import { intakeRequestStatement, sendChatRequest, subscribeToIncomingRequests } from "./requests.mjs";

// ── Content: wire <-> rows ───────────────────────────────────────────────
// Inbound is an effect, not always a message: a reaction or an edit changes
// an existing row, a call offer is answered with `dataChannelClosed`, roster
// variants go to the contact, and the rest is dropped with a warning.

export const toWire = (content) => {
  switch (content.type) {
    case "text":
      return { tag: "text", value: content.text };
    case "reply":
      return { tag: "reply", value: { messageId: content.messageId, ownContent: { text: content.text, attachments: undefined } } };
    case "reaction":
      return { tag: content.add ? "reacted" : "reactionRemoved", value: { messageId: content.messageId, emoji: content.emoji } };
    case "edit":
      return { tag: "edit", value: { messageId: content.messageId, newContent: { text: content.text, attachments: undefined } } };
    case "callDecline":
      return { tag: "dataChannelClosed", value: { offerMessageId: content.offerMessageId } };
    case "deviceAdded":
      return { tag: "deviceAdded", value: { statementAccountId: content.device.statementAccountId, encryptionPublicKey: content.device.encryptionPublicKey } };
    default:
      throw new Error(`cannot send content type ${content.type}`);
  }
};

const attachmentOf = (file) => {
  if (file.tag !== "p2pMixnet") return null;
  const meta = file.value.meta;
  if (meta.tag !== "general" && meta.tag !== "image" && meta.tag !== "video") return null;
  const general = meta.tag === "general" ? meta.value : meta.value.general;
  return { kind: meta.tag, mimeType: general.mimeType, fileSize: general.fileSize };
};

export const fromWire = (content) => {
  switch (content.tag) {
    case "text":
      return { kind: "message", content: { type: "text", text: content.value } };
    case "richText":
      return {
        kind: "message",
        content: {
          type: "richText",
          text: content.value.text ?? null,
          attachments: (content.value.attachments ?? []).map(attachmentOf).filter((a) => a !== null),
        },
      };
    case "reply":
      return { kind: "message", content: { type: "reply", messageId: content.value.messageId, text: content.value.ownContent.text ?? "" } };
    case "reacted":
      return { kind: "reaction", messageId: content.value.messageId, emoji: content.value.emoji, add: true };
    case "reactionRemoved":
      return { kind: "reaction", messageId: content.value.messageId, emoji: content.value.emoji, add: false };
    case "edit":
      return { kind: "edit", messageId: content.value.messageId, text: content.value.newContent.text ?? "" };
    case "leftChat":
      return { kind: "message", content: { type: "leftChat" } };
    case "contactAdded":
      return { kind: "message", content: { type: "contactAdded" } };
    case "dataChannelOffer":
      return { kind: "callOffer" };
    case "deviceAdded":
      return { kind: "deviceAdded", statementAccountId: content.value.statementAccountId, encryptionPublicKey: content.value.encryptionPublicKey };
    case "deviceRemoved":
      return { kind: "deviceRemoved", statementAccountId: content.value.statementAccountId };
    // Call signalling other than the offer, push tokens and accepts (the
    // identity channel owns those) carry nothing to show.
    case "dataChannelAnswer":
    case "dataChannelIceCandidate":
    case "dataChannelClosed":
    case "token":
    case "chatAccepted":
    case "deviceChatAccepted":
      return { kind: "ignore" };
    // Payments decode fine but nothing here can act on them; show that a
    // message exists rather than hiding it.
    case "send":
    case "coinagePayment":
      return { kind: "message", content: { type: "unsupported", tag: content.tag } };
    default:
      log("CHAT_UNKNOWN_CONTENT", { tag: content.tag });
      return { kind: "ignore" };
  }
};

/** One line for the chat list. */
export const previewOf = (content) => {
  switch (content.type) {
    case "text":
    case "reply":
      return content.text;
    case "richText":
      return content.text ?? (content.attachments.length > 0 ? `[${content.attachments.length} attachment(s)]` : "");
    case "contactAdded":
      return "Chat accepted";
    case "leftChat":
      return "Left the chat";
    case "callDeclined":
      return "Call declined";
    case "unsupported":
      return `Unsupported message (${content.tag})`;
    default:
      return "";
  }
};

// ── Identity channel ─────────────────────────────────────────────────────
// The identity-level session with a peer: topic SessionId(A, B), listening
// on SessionId(B, A), K(A, B) = ECDH(ownIdentityChatPriv, peerIdentityChatPub).
// It carries `deviceChatAccepted` (the acceptor's DeviceInfo) and the
// `deviceAdded` / `deviceRemoved` roster fan-out, which cannot ride the
// per-device session because they are what makes that session possible.
// Anything else (a bot's welcome text rides the identity session) is
// surfaced as `message`.

export const toIdentityChannelEvent = (message) => {
  const content = message.versioned.value;
  const timestamp = Number(message.timestamp);
  switch (content.tag) {
    case "deviceChatAccepted":
      return { tag: "accepted", requestId: content.value.requestId, device: content.value.device, acceptedAt: timestamp };
    case "chatAccepted":
      // Legacy single-device accept (@14) carries no DeviceInfo. Honouring it
      // would mean a synthetic device keyed by the identity account, which the
      // peer can never decrypt for. Better a request that stays pending.
      log("CHAT_LEGACY_ACCEPT_DROPPED", { requestId: content.value.messageId });
      return null;
    case "deviceAdded":
      return { tag: "deviceAdded", device: { statementAccountId: content.value.statementAccountId, encryptionPublicKey: content.value.encryptionPublicKey } };
    case "deviceRemoved":
      return { tag: "deviceRemoved", statementAccountId: content.value.statementAccountId };
    default:
      return { tag: "message", messageId: message.messageId, timestamp, content };
  }
};

export const createIdentityChannel = (params) => {
  const sharedSecret = x25519.getSharedSecret(params.ownIdentityChatPrivateKey, params.peerIdentityChatPublicKey);

  const session = createSession({
    localAccount: { accountId: createAccountId(params.ownIdentityAccountId), pin: undefined },
    remoteAccount: { accountId: createAccountId(params.peerIdentityAccountId), publicKey: params.peerIdentityChatPublicKey, pin: undefined },
    statementStore: params.statementStore,
    encryption: createEncryption(sharedSecret),
    // Statements are signed per device; the identity key never signs.
    prover: params.prover,
    allocator: params.allocator,
    // The topic is keyed by the ECDH shared secret, not the raw peer pubkey.
    sessionKey: sharedSecret,
  });

  // Every statement the peer publishes carries all of its un-acked messages
  // (base-spec batching), so one message arrives once per statement until the
  // ack lands. Transport dedup is the SDK's; message dedup is ours.
  const seen = new Set();

  // Answering is also what opens the store subscription, so every incoming
  // statement is both delivered and acknowledged from here.
  const stopResponding = session.respondToRequests(ChatMessageCodec, (request) => {
    if (request.payload.status !== "parsed") return "decodingFailed";
    const message = request.payload.value;
    if (!seen.has(message.messageId)) {
      seen.add(message.messageId);
      const event = toIdentityChannelEvent(message);
      if (event) params.onEvent(event);
    }
    return "success";
  });

  return {
    /** Publish an identity-level content variant. Resolves once the session queued it. */
    post: async (content) => {
      const payload = { messageId: randomId(), timestamp: BigInt(Date.now()), versioned: { tag: "v1", value: content } };
      const submitted = await session.submitRequestMessage(ChatMessageCodec, payload);
      if (submitted.isErr()) throw submitted.error;
    },
    dispose: () => {
      stopResponding();
      session.dispose();
    },
  };
};

// ── Peer roster ──────────────────────────────────────────────────────────
// The peer's device list as a live handle: `createMultiDeviceSession` builds
// the outgoing envelope against `current()` on every submit and re-derives
// the incoming topics when `subscribe` fires, so a `deviceAdded` applies to
// a running session instead of tearing it down.

const sameRoster = (a, b) => a.length === b.length
  && a.every((device, i) => bytesEqual(device.statementAccountId, b[i].statementAccountId) && bytesEqual(device.encryptionPublicKey, b[i].encryptionPublicKey));

export const createPeerRoster = (initial) => {
  let devices = initial;
  const listeners = new Set();
  return {
    current: () => devices,
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    set(next) {
      // A no-op update would re-open the store subscription for nothing.
      if (sameRoster(devices, next)) return;
      devices = next;
      for (const listener of listeners) listener(next);
    },
  };
};

// ── Peer session ─────────────────────────────────────────────────────────
// A thin adapter over `createMultiDeviceSession`, which owns the envelope,
// per-device topics, batching, statement dedup, expiry allocation, retries
// and the restore of the un-acked batch at init. What stays here: message
// dedup by id, the ACK, and mapping the session's signals to message status.

export const createPeerSession = (params) => {
  const session = createMultiDeviceSession({
    localDevice: { statementAccountId: params.deviceKeys.statementAccountId, encryptionPrivateKey: params.deviceKeys.encryptionPrivateKey },
    localIdentity: { accountId: createAccountId(params.identity.identityAccountId), chatPrivateKey: params.identity.identityChatPrivateKey },
    remoteIdentity: { accountId: createAccountId(params.peerIdentityAccountId), chatPublicKey: params.peerIdentityChatPublicKey },
    peerRoster: params.peerRoster,
    statementStore: params.statementStore,
    prover: params.prover,
    allocator: params.allocator,
  });

  const seen = new Set();

  const unsubscribe = session.subscribe(ChatMessageCodec, (messages) => {
    const batches = new Map(); // requestId -> { ids: decoded message ids, undecodable: count }
    for (const message of messages) {
      if (message.type === "response") {
        if (message.responseCode === "success") params.onBatchDelivered();
        continue;
      }
      const batch = batches.get(message.requestId) ?? { ids: [], undecodable: 0 };
      batches.set(message.requestId, batch);
      // One undecodable entry is one message this build cannot read; the
      // rest of the batch is unaffected.
      if (message.payload.status !== "parsed") { batch.undecodable += 1; continue; }
      const wire = message.payload.value;
      batch.ids.push(wire.messageId);
      if (seen.has(wire.messageId)) continue;
      seen.add(wire.messageId);
      params.onMessage({ messageId: wire.messageId, timestamp: Number(wire.timestamp), content: wire.versioned.value });
    }
    // ACK per request, after every message of it was handled. A batch with
    // nothing readable is NACKed (`decodingFailed`) so the sender stops
    // waiting; one with anything readable is a success — the peer advances
    // to `delivered` for what we have, and dedups the rest on resend.
    for (const [requestId, batch] of batches) {
      const code = batch.ids.length === 0 && batch.undecodable > 0 ? "decodingFailed" : "success";
      void session.submitResponseMessage(requestId, code).match(
        () => params.onAcked?.(batch.ids, code),
        (error) => log("CHAT_ACK_FAILED", { requestId, error: error.message }),
      );
    }
  });

  return {
    /** Resolves once the session queued the message; rejects when it can never go out. */
    send: async (content, ids) => {
      const payload = { messageId: ids.messageId, timestamp: BigInt(ids.timestamp), versioned: { tag: "v1", value: content } };
      const submitted = await session.submitRequestMessage(ChatMessageCodec, payload);
      if (submitted.isErr()) throw submitted.error;
      // The SDK accepts into the outgoing batch here, not when the statement
      // lands, so `sent` is optimistic and nothing walks it back.
      params.onSent(ids.messageId);
      void session.waitForResponseMessage(submitted.value.requestId).match(
        () => params.onDelivered(ids.messageId),
        // Also fires on dispose, where the message is still live in the store;
        // treating that as a failure would drop a good row on every teardown.
        (error) => log("CHAT_NO_ACK", { messageId: ids.messageId, error: error.message }),
      );
    },
    dispose: () => {
      unsubscribe();
      session.dispose();
    },
  };
};

// ── Session registry ─────────────────────────────────────────────────────
// One multi-device session and one live roster per contact, for this device.
// Message status moves here; content goes to the engine, which owns the state.

const createSessionRegistry = (deps) => {
  const sessions = new Map(); // peer hex -> { session, roster }
  return {
    start(contact) {
      if (sessions.has(contact.account)) return;
      const peer = contact.account;
      const roster = createPeerRoster(contact.devices);
      // Rows restored from a previous run have no waiter; the first batch ack
      // after start settles them. Later acks would rescan for nothing.
      const startedAt = Date.now();
      let batchChecked = false;
      const session = createPeerSession({
        identity: deps.identity,
        deviceKeys: deps.deviceKeys,
        peerIdentityAccountId: hexToBytes(peer),
        peerIdentityChatPublicKey: contact.chatPublicKey,
        peerRoster: roster,
        prover: deps.prover,
        allocator: deps.allocator,
        statementStore: deps.statementStore,
        onMessage: (message) => deps.onMessage(peer, message),
        onSent: (messageId) => deps.state.messages.setStatus(messageId, "sent"),
        onDelivered: (messageId) => deps.state.messages.setStatus(messageId, "delivered"),
        onBatchDelivered: () => {
          if (batchChecked) return;
          batchChecked = true;
          deps.state.messages.markDeliveredBefore(peer, startedAt);
        },
        onAcked: (ids) => { for (const id of ids) deps.state.messages.acked(id, deps.deviceIndex); },
      });
      sessions.set(peer, { session, roster });
    },
    has: (peer) => sessions.has(peer),
    publishRoster: (peer, devices) => sessions.get(peer)?.roster.set(devices),
    send: async (peer, content, ids) => {
      const entry = sessions.get(peer);
      if (!entry) throw new Error(`no session with ${peer}`);
      await entry.session.send(content, ids);
    },
    stopAll: () => {
      for (const { session } of sessions.values()) session.dispose();
      sessions.clear();
    },
  };
};

// ── Engine ───────────────────────────────────────────────────────────────

const systemRow = (peer, messageId, timestamp, content) => ({ messageId, peer, timestamp, direction: "system", status: "received", content });

/**
 * One device's chat engine over one statement-store connection.
 *
 * One `ExpiryAllocator` is shared by everything this device signs (request
 * sends, identity channels and every session): the store compares expiries
 * per signing account, and independent counters can tie within a second.
 */
export const createChatEngine = ({ identity, deviceKeys, deviceIndex, state, statementStore, lookup, ownDevices, onEvent = () => {} }) => {
  const prover = createSr25519Prover(deviceKeys.statementSeed);
  const allocator = createExpiryAllocator();
  const ownDevice = { statementAccountId: deviceKeys.statementAccountId, encryptionPublicKey: deviceKeys.encryptionPublicKey };
  const ownAccount = bytesToHex(identity.identityAccountId);

  // One identity channel per peer: contacts, and pending outgoing requests
  // (the accept arrives there). Keyed by the peer's identity account.
  const channels = new Map();
  let stopRequests = () => undefined;
  let disposed = false;

  const guard = (work, what) => {
    if (!disposed) void work.catch((error) => log("CHAT_FAILED", { device: deviceIndex, what, error: error?.message ?? String(error) }));
  };
  const emit = (event, extra = {}) => onEvent({ event, ...extra });

  // ── Inbound content (session and identity channel alike) ─────────────

  const handleIncoming = async (peer, message) => {
    const effect = fromWire(message.content);
    switch (effect.kind) {
      case "message":
        state.messages.receive({ messageId: message.messageId, peer, timestamp: message.timestamp, direction: "incoming", status: "received", content: effect.content }, deviceIndex);
        return;
      case "reaction":
        state.messages.applyReaction(effect.messageId, effect.emoji, "peer", effect.add);
        return;
      case "edit":
        state.messages.applyEdit(effect.messageId, effect.text, message.timestamp);
        return;
      case "callOffer":
        // No call support: answer with `dataChannelClosed` so the caller's UI
        // stops ringing, and keep a system row so the user knows.
        state.messages.add(systemRow(peer, `call-declined:${message.messageId}`, message.timestamp, { type: "callDeclined" }));
        if (sessions.has(peer)) {
          await sessions.send(peer, toWire({ type: "callDecline", offerMessageId: message.messageId }), { messageId: randomId(), timestamp: Date.now() });
        }
        return;
      case "deviceAdded":
        addPeerDevice(peer, { statementAccountId: effect.statementAccountId, encryptionPublicKey: effect.encryptionPublicKey });
        return;
      case "deviceRemoved":
        state.contacts.removeDevice(peer, effect.statementAccountId);
        return;
      default:
        return;
    }
  };

  const sessions = createSessionRegistry({
    identity,
    deviceKeys,
    deviceIndex,
    prover,
    allocator,
    statementStore,
    state,
    onMessage: (peer, message) => guard(handleIncoming(peer, message), "incoming message"),
  });

  // ── Roster ───────────────────────────────────────────────────────────

  const addPeerDevice = (peer, device) => {
    if (!isUsablePeerDevice(device)) return;
    const contact = state.contacts.get(peer);
    if (!contact) return;
    // The state change opens or updates this device's session (and every sibling's).
    state.contacts.upsertDevice(contact, device);
  };

  // Every engine of the persona follows the shared state: a contact written
  // by any device gets a channel and a session here, a roster change reaches
  // the running session without a restart.
  const stopWatching = state.onChange((change) => {
    if (disposed || change.type !== "contact") return;
    const contact = change.contact;
    ensureChannel(hexToBytes(contact.account), contact.chatPublicKey);
    if (sessions.has(contact.account)) sessions.publishRoster(contact.account, contact.devices);
    else sessions.start(contact);
  });

  // ── Contact establishment (both directions) ──────────────────────────

  /** Contact row, room, "chat accepted" system row, session. Idempotent. */
  const establishContact = (seed, device, requestId, acceptedAt) => {
    const contact = state.contacts.upsertDevice(seed, device);
    state.messages.ensureRoom(contact.account);
    state.messages.add(systemRow(contact.account, `accepted:${requestId}`, acceptedAt, { type: "contactAdded" }), { read: true });
    return contact;
  };

  /**
   * What the phone does once a contact has no pending request: announce every
   * one of our devices (Android `ContactDeviceFanOutService`, including the
   * device the peer already knows) on the multi-device session, so the peer
   * wraps its envelopes for all of them. Done by the device that sent or
   * accepted the request, which the peer can already address.
   */
  const fanOutDevices = async (peer) => {
    for (const device of ownDevices()) {
      await sessions.send(peer, toWire({ type: "deviceAdded", device }), { messageId: randomId(), timestamp: Date.now() });
    }
    emit("fanout", { peer, devices: ownDevices().length });
  };

  // ── Identity channel ─────────────────────────────────────────────────

  const ensureChannel = (peerAccountId, peerChatPublicKey) => {
    const key = bytesToHex(peerAccountId);
    const existing = channels.get(key);
    if (existing) return existing;
    const channel = createIdentityChannel({
      ownIdentityAccountId: identity.identityAccountId,
      ownIdentityChatPrivateKey: identity.identityChatPrivateKey,
      peerIdentityAccountId: peerAccountId,
      peerIdentityChatPublicKey: peerChatPublicKey,
      prover,
      allocator,
      statementStore,
      onEvent: (event) => guard(onIdentityEvent(key, event), "identity event"),
    });
    channels.set(key, channel);
    return channel;
  };

  const onIdentityEvent = async (peer, event) => {
    switch (event.tag) {
      case "accepted": {
        if (!isUsablePeerDevice(event.device)) return;
        const request = state.requests.get(event.requestId);
        if (!request || request.direction !== "outgoing" || request.peer !== peer) {
          // Accepted from another of our devices, or a replay: still learn the device.
          addPeerDevice(peer, event.device);
          return;
        }
        const first = request.status === "pending";
        if (first) state.requests.update(request.requestId, { status: "accepted" });
        const seed = { account: peer, username: request.peerUsername, chatPublicKey: request.peerChatPublicKey };
        establishContact(seed, event.device, request.requestId, event.acceptedAt);
        if (request.welcomeMessage) {
          // The request's inner message IS the welcome message; its id is the
          // request id so the peer's reactions and replies target it.
          state.messages.add({
            messageId: request.requestId,
            peer,
            timestamp: request.timestamp,
            direction: "outgoing",
            status: "delivered",
            content: { type: "text", text: request.welcomeMessage },
            device: request.device,
          });
        }
        emit("accepted", { peer, requestId: request.requestId });
        // The device that sent the request is the one the peer can address.
        if (first && request.device === deviceIndex) await fanOutDevices(peer);
        return;
      }
      case "deviceAdded":
        addPeerDevice(peer, event.device);
        return;
      case "deviceRemoved":
        state.contacts.removeDevice(peer, event.statementAccountId);
        return;
      case "message":
        // A bot answers a request with its welcome text on the identity session.
        await handleIncoming(peer, event);
        return;
      default:
        return;
    }
  };

  const requireRequest = (requestId, direction) => {
    const request = state.requests.get(requestId);
    if (!request || request.direction !== direction) throw new Error(`no ${direction} request ${requestId}`);
    return request;
  };

  // ── Transport lifecycle ──────────────────────────────────────────────

  for (const contact of state.contacts.list()) {
    ensureChannel(hexToBytes(contact.account), contact.chatPublicKey);
    sessions.start(contact);
  }
  for (const request of state.requests.list()) {
    if (request.direction === "outgoing" && request.status === "pending") ensureChannel(hexToBytes(request.peer), request.peerChatPublicKey);
  }
  stopRequests = subscribeToIncomingRequests({ ownAccountId: identity.identityAccountId, statementStore }, (data) =>
    guard(intakeRequestStatement({ identity, lookup, state }, data), "request intake"));

  // ── Outgoing ─────────────────────────────────────────────────────────

  const submit = async (peer, content, ids) => {
    if (!sessions.has(peer)) throw new Error("no chat session with this contact");
    await sessions.send(peer, toWire(content), ids);
  };

  return {
    deviceIndex,
    sendRequest: async (peer, welcomeMessage) => {
      if (bytesToHex(peer.accountId) === ownAccount) throw new Error("cannot chat with yourself");
      const { requestId, timestamp } = await sendChatRequest({
        recipientAccountId: peer.accountId,
        recipientChatPublicKey: peer.chatPublicKey,
        senderIdentityAccountId: identity.identityAccountId,
        senderIdentityChatPrivateKey: identity.identityChatPrivateKey,
        senderDeviceEncryptionPublicKey: deviceKeys.encryptionPublicKey,
        senderDeviceSeed: deviceKeys.statementSeed,
        welcomeMessage,
        statementStore,
        allocator,
      });
      state.requests.add({
        requestId,
        peer: bytesToHex(peer.accountId),
        peerUsername: peer.username,
        peerChatPublicKey: peer.chatPublicKey,
        direction: "outgoing",
        status: "pending",
        welcomeMessage,
        timestamp,
        senderDevice: null,
        device: deviceIndex,
        createdAt: Date.now(),
      });
      ensureChannel(peer.accountId, peer.chatPublicKey);
      emit("request_sent", { peer: bytesToHex(peer.accountId), requestId });
      return { requestId, timestamp };
    },

    acceptRequest: async (requestId) => {
      const request = requireRequest(requestId, "incoming");
      if (request.status !== "pending") throw new Error(`request ${requestId} is ${request.status}`);
      state.requests.update(requestId, { status: "accepted", device: deviceIndex });
      const seed = { account: request.peer, username: request.peerUsername, chatPublicKey: request.peerChatPublicKey };
      establishContact(seed, request.senderDevice, requestId, Date.now());
      if (request.welcomeMessage) {
        // Every device decrypted the request, so the welcome text is on all of them.
        state.messages.add({
          messageId: requestId,
          peer: request.peer,
          timestamp: request.timestamp,
          direction: "incoming",
          status: "received",
          content: { type: "text", text: request.welcomeMessage },
          receivedBy: ownDevices().map((_d, i) => i + 1),
        }, { read: true });
      }
      // mds.md §"Accepting a Chat Request": the accept carries this device's
      // DeviceInfo on the identity-level session, because the peer cannot
      // address a device it does not know yet.
      await ensureChannel(hexToBytes(request.peer), request.peerChatPublicKey).post({ tag: "deviceChatAccepted", value: { requestId, device: ownDevice } });
      emit("accept_posted", { peer: request.peer, requestId });
      await fanOutDevices(request.peer);
    },

    declineRequest: async (requestId) => {
      const request = requireRequest(requestId, "incoming");
      if (request.status !== "pending") throw new Error(`request ${requestId} is ${request.status}`);
      // Local, as on the desktop: the wire has no "declined", the sender's request stays pending.
      state.requests.update(requestId, { status: "declined", device: deviceIndex });
    },

    /** A new row: text, or a reply. Resolves once the row exists; delivery is tracked on the row. */
    sendMessage: async (peer, content) => {
      const ids = { messageId: randomId(), timestamp: Date.now() };
      state.messages.add({ messageId: ids.messageId, peer, timestamp: ids.timestamp, direction: "outgoing", status: "sending", content, device: deviceIndex });
      // Too large, or no usable peer device: the row stays as evidence.
      await submit(peer, content, ids).catch((error) => {
        state.messages.setStatus(ids.messageId, "failed");
        throw error;
      });
      return ids;
    },

    react: async (peer, messageId, emoji, add) => {
      if (!state.messages.get(messageId)) throw new Error(`no message ${messageId}`);
      state.messages.applyReaction(messageId, emoji, "me", add);
      await submit(peer, { type: "reaction", messageId, emoji, add }, { messageId: randomId(), timestamp: Date.now() });
    },

    edit: async (peer, messageId, text) => {
      const target = state.messages.get(messageId);
      if (!target || target.direction !== "outgoing") throw new Error(`no own message ${messageId}`);
      const now = Date.now();
      state.messages.applyEdit(messageId, text, now);
      await submit(peer, { type: "edit", messageId, text }, { messageId: randomId(), timestamp: now });
    },

    dispose: () => {
      disposed = true;
      stopWatching();
      stopRequests();
      sessions.stopAll();
      for (const channel of channels.values()) channel.dispose();
      channels.clear();
    },
  };
};
