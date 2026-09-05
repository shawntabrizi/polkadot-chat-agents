// A persona is one user of the sandbox network: an identity (sr25519 account
// + X25519 chat key, the pair the People chain publishes) and N devices. It
// plays the role the phone plays for a real user — it knows every device and
// fans them out to contacts — and it holds what the app's local database
// holds: contacts with device rosters, chat requests, rooms and messages.
//
// The store is shared by the persona's devices (the real app syncs it over
// WebRTC; here it is one object) and every device's engine reacts to its
// change events, so an accept on device 1 opens a session on device 2 too.

import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { createSr25519Secret, deriveSr25519PublicKey } from "@novasamatech/statement-store";

import { bytesEqual, bytesToHex, normHex } from "./bytes.mjs";
import { createChatEngine, previewOf } from "./chat.mjs";
import { createDevice } from "./device.mjs";

/**
 * Identity keys: the account is sr25519 at `//wallet` from a random 32-byte
 * entropy (base-spec.md "Discovery"), the chat key an independent random
 * X25519 key (the app derives it at `//wallet//chat`; a persona only needs a
 * key the chain can publish and that it can rotate).
 */
export function mintIdentityKeys() {
  const seed = createSr25519Secret(randomBytes(32), "//wallet");
  const chatPrivateKey = x25519.utils.randomSecretKey();
  return {
    seed,
    identityAccountId: deriveSr25519PublicKey(seed),
    identityChatPrivateKey: chatPrivateKey,
    identityChatPublicKey: x25519.getPublicKey(chatPrivateKey),
  };
}

// ── Local state: contacts, requests, rooms, messages ─────────────────────

const withDevice = (devices, device) => [
  // One entry per statement account; a re-announced device replaces its old key.
  ...devices.filter((d) => !bytesEqual(d.statementAccountId, device.statementAccountId)),
  device,
];

/** Ported from polkadot-chat-web contacts/requests/messages repositories, in memory and synchronous. */
export function createPersonaState() {
  const contacts = new Map(); // peer hex -> contact
  const requests = new Map(); // requestId -> request
  const rooms = new Map(); // peer hex -> room
  const messages = new Map(); // messageId -> message
  const listeners = new Set();
  const emit = (type, value) => { for (const fn of listeners) fn({ type, ...value }); };

  const touchRoom = (peer, message, unreadDelta) => {
    const existing = rooms.get(peer);
    const now = Date.now();
    const newest = !existing || message.timestamp >= existing.lastMessageAt;
    const room = {
      peer,
      unreadCount: (existing?.unreadCount ?? 0) + unreadDelta,
      lastMessageAt: newest ? message.timestamp : existing.lastMessageAt,
      lastPreview: newest ? previewOf(message.content) : existing.lastPreview,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    rooms.set(peer, room);
    emit("room", { room });
  };
  const changed = (message) => emit("message", { message });

  return {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    contacts: {
      get: (peer) => contacts.get(normHex(peer)),
      list: () => [...contacts.values()].sort((a, b) => a.username.localeCompare(b.username)),
      /** Create the contact or add one device. Username and chat key are refreshed every time (a rotated key must not go stale). */
      upsertDevice(seed, device) {
        const peer = normHex(seed.account);
        const existing = contacts.get(peer);
        const now = Date.now();
        const contact = {
          account: peer,
          username: seed.username,
          chatPublicKey: seed.chatPublicKey,
          devices: device ? withDevice(existing?.devices ?? [], device) : (existing?.devices ?? []),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        contacts.set(peer, contact);
        emit("contact", { contact });
        return contact;
      },
      removeDevice(peer, statementAccountId) {
        const existing = contacts.get(normHex(peer));
        if (!existing) return undefined;
        const contact = { ...existing, devices: existing.devices.filter((d) => !bytesEqual(d.statementAccountId, statementAccountId)), updatedAt: Date.now() };
        contacts.set(contact.account, contact);
        emit("contact", { contact });
        return contact;
      },
    },

    requests: {
      /** Insert only: the row is the dedup set, a re-delivered request never overwrites a chosen status. */
      add(row) {
        if (requests.has(row.requestId)) return false;
        requests.set(row.requestId, row);
        emit("request", { request: row });
        return true;
      },
      get: (requestId) => requests.get(requestId),
      list: () => [...requests.values()].sort((a, b) => b.createdAt - a.createdAt),
      update(requestId, patch) {
        const row = requests.get(requestId);
        if (!row) return undefined;
        Object.assign(row, patch);
        emit("request", { request: row });
        return row;
      },
      findPending: (peer, direction) => [...requests.values()].find((r) => r.peer === normHex(peer) && r.direction === direction && r.status === "pending"),
    },

    messages: {
      get: (messageId) => messages.get(messageId),
      /** A room's rows in timestamp order. `device` keeps only incoming rows that device received; `unread` drops what was read. */
      list(peer, { device = null, unread = false } = {}) {
        const key = normHex(peer);
        return [...messages.values()]
          .filter((m) => m.peer === key)
          .filter((m) => device == null || m.direction !== "incoming" || m.receivedBy.includes(device))
          .filter((m) => !unread || (m.direction === "incoming" && !m.read))
          .sort((a, b) => a.timestamp - b.timestamp);
      },
      rooms: () => [...rooms.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
      /** Insert a row. An existing id is left as is and `false` returned. Incoming rows count as unread unless `read`. */
      add(row, { read = false } = {}) {
        if (messages.has(row.messageId)) return false;
        const message = { reactions: [], editedAt: null, device: null, receivedBy: [], ackedBy: [], read: row.direction !== "incoming" || read, ...row, peer: normHex(row.peer) };
        messages.set(message.messageId, message);
        touchRoom(message.peer, message, message.direction === "incoming" && !read ? 1 : 0);
        changed(message);
        return true;
      },
      /** An incoming row seen by one device: inserted on first sight, then only the device list grows. */
      receive(row, deviceIndex, options) {
        const fresh = this.add({ ...row, receivedBy: [deviceIndex] }, options);
        const message = messages.get(row.messageId);
        if (!fresh && !message.receivedBy.includes(deviceIndex)) { message.receivedBy.push(deviceIndex); changed(message); }
        return fresh;
      },
      acked(messageId, deviceIndex) {
        const message = messages.get(messageId);
        if (!message || message.ackedBy.includes(deviceIndex)) return;
        message.ackedBy.push(deviceIndex);
        changed(message);
      },
      ensureRoom(peer) {
        const key = normHex(peer);
        if (rooms.has(key)) return;
        const now = Date.now();
        // `lastMessageAt: 0` so the first message, whatever its wire timestamp, becomes the preview.
        rooms.set(key, { peer: key, unreadCount: 0, lastMessageAt: 0, lastPreview: "", createdAt: now, updatedAt: now });
        emit("room", { room: rooms.get(key) });
      },
      setStatus(messageId, status) {
        const message = messages.get(messageId);
        if (!message) return false;
        message.status = status;
        changed(message);
        return true;
      },
      /** The peer acknowledged the whole outgoing batch: everything sent before `before` is delivered. */
      markDeliveredBefore(peer, before) {
        let n = 0;
        for (const m of messages.values()) {
          if (m.peer === normHex(peer) && m.direction === "outgoing" && m.status === "sent" && m.timestamp <= before) { m.status = "delivered"; n += 1; changed(m); }
        }
        return n;
      },
      applyReaction(messageId, emoji, by, add) {
        const message = messages.get(messageId);
        if (!message) return false;
        const without = message.reactions.filter((r) => !(r.emoji === emoji && r.by === by));
        message.reactions = add ? [...without, { emoji, by }] : without;
        changed(message);
        return true;
      },
      /** An edit replaces the text of a text, reply or richText row; other rows cannot be edited. */
      applyEdit(messageId, text, editedAt) {
        const message = messages.get(messageId);
        if (!message || !["text", "reply", "richText"].includes(message.content.type)) return false;
        message.content = { ...message.content, text };
        message.editedAt = editedAt;
        changed(message);
        return true;
      },
      markRoomRead(peer) {
        const key = normHex(peer);
        const room = rooms.get(key);
        if (!room) return;
        room.unreadCount = 0;
        for (const m of messages.values()) if (m.peer === key && !m.read) { m.read = true; changed(m); }
        emit("room", { room });
      },
    },
  };
}

// ── The persona ───────────────────────────────────────────────────────────

export function createPersona({ name, devices = 1, identity = mintIdentityKeys() }) {
  const state = createPersonaState();
  const deviceList = Array.from({ length: devices }, (_, i) => createDevice({ index: i + 1 }));
  const account = bytesToHex(identity.identityAccountId);
  let started = null;

  const device = (index = 1) => {
    const found = deviceList[index - 1];
    if (!found) throw new Error(`${name} has no device ${index} (has ${deviceList.length})`);
    if (!found.engine) throw new Error(`${name}#${index} is offline`);
    return found;
  };

  const persona = {
    name,
    account,
    identity,
    devices: deviceList,
    state,
    /** Publish the identity and grant every device its statement allowance (mds.md: devices need their own). */
    register(directory) {
      directory.register(account, { username: name, identifierKey: identity.identityChatPublicKey });
      for (const d of deviceList) directory.allow(d.account);
    },
    /** Add a device to a live persona; contacts learn it through the fan-out on their next accept. */
    addDevice() {
      const d = createDevice({ index: deviceList.length + 1 });
      deviceList.push(d);
      if (started) startDevice(d);
      return d;
    },
    start(deps) {
      started = deps;
      for (const d of deviceList) startDevice(d);
    },
    stop() {
      for (const d of deviceList) d.stop();
      started = null;
    },
    device,
    // Commands run on one device, like a person tapping on one phone.
    request: (peer, welcome, { device: index = 1 } = {}) => device(index).engine.sendRequest(peer, welcome),
    accept: (requestId, { device: index = 1 } = {}) => device(index).engine.acceptRequest(requestId),
    decline: (requestId, { device: index = 1 } = {}) => device(index).engine.declineRequest(requestId),
    send: (peer, content, { device: index = 1 } = {}) => device(index).engine.sendMessage(normHex(peer), content),
    react: (peer, messageId, emoji, add, { device: index = 1 } = {}) => device(index).engine.react(normHex(peer), messageId, emoji, add),
    edit: (peer, messageId, text, { device: index = 1 } = {}) => device(index).engine.edit(normHex(peer), messageId, text),
    markRead: (peer) => state.messages.markRoomRead(peer),
    /** Public half only. */
    toJSON: () => ({ name, account, chatPublicKey: bytesToHex(identity.identityChatPublicKey), devices: deviceList.map((d) => d.toJSON()) }),
  };

  function startDevice(d) {
    if (d.engine) return;
    d.engine = createChatEngine({
      identity,
      deviceKeys: d.keys,
      deviceIndex: d.index,
      state,
      statementStore: started.makeStatementStore(d),
      lookup: started.lookup,
      ownDevices: () => deviceList.map((x) => x.info),
      onEvent: (event) => started.onEvent?.({ persona: name, device: d.index, ...event }),
    });
  }

  return persona;
}
