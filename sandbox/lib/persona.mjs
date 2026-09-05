// A persona is one user of the sandbox network: an identity (sr25519 account
// + X25519 chat key, the pair the People chain publishes) and N devices. It
// plays the role the phone plays for a real user — it knows every device and
// fans them out to contacts — and it holds what the app's local database
// holds: contacts with device rosters, chat requests, rooms and messages.
//
// The store is shared by the persona's devices (the real app syncs it over
// WebRTC; here it is one object) and every device's engine reacts to its
// change events, so an accept on device 1 opens a session on device 2 too.

import fs from "node:fs";
import path from "node:path";

import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { createSr25519Secret, deriveSr25519PublicKey } from "@novasamatech/statement-store";

import { bytesEqual, bytesToHex, hexToBytes, log, normHex } from "./bytes.mjs";
import { createChatEngine, previewOf } from "./chat.mjs";
import { createDevice } from "./device.mjs";
import { checkHopUrl, downloadFile, mintBulletinSigner, uploadFile } from "./hop.mjs";
import { createMediaDir, describeFile, mimeOf } from "./media.mjs";

/** The largest attachment a persona sends or claims (bot-core's BOT_MEDIA_MAX_BYTES default). */
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

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
      /** One attachment of a row moves through pending → claiming → claimed | failed (or is `sent`). */
      updateAttachment(messageId, index, patch) {
        const message = messages.get(messageId);
        const attachment = message?.content.attachments?.[index];
        if (!attachment) return false;
        message.content = { ...message.content, attachments: message.content.attachments.map((a, i) => (i === index ? { ...a, ...patch } : a)) };
        changed(message);
        return true;
      },
      /**
       * An edit replaces the text of a text, reply or richText row; other
       * rows cannot be edited. Every earlier text stays in `editHistory`
       * (oldest first): a bot's live reply is one row edited many times,
       * and what it showed on the way is part of the record.
       */
      applyEdit(messageId, text, editedAt) {
        const message = messages.get(messageId);
        if (!message || !["text", "reply", "richText"].includes(message.content.type)) return false;
        message.editHistory = [...(message.editHistory ?? []), { text: message.content.text ?? null, until: editedAt }];
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

export function createPersona({ name, devices = 1, identity = mintIdentityKeys(), hopUrl = null, mediaDir = null }) {
  const state = createPersonaState();
  const deviceList = Array.from({ length: devices }, (_, i) => createDevice({ index: i + 1 }));
  const account = bytesToHex(identity.identityAccountId);
  // The Bulletin allowance account that signs this persona's uploads (the
  // phone's is its statement keypair; bot-core's a derived one). Registered
  // with the identity so the HOP node accepts its submits.
  const bulletin = mintBulletinSigner();
  const media = mediaDir ? createMediaDir(mediaDir) : null;
  // Pool entries this persona uploaded or claimed: hash -> { role, peer, messageId }, for the HOP view.
  const hopEntries = new Map();
  let started = null;

  const recordEntries = (identifier, chunks, peer, messageId) => {
    hopEntries.set(normHex(identifier), { role: "metadata", peer, messageId });
    chunks.forEach((hash, i) => hopEntries.set(normHex(hash), { role: `chunk ${i + 1}/${chunks.length}`, peer, messageId }));
  };

  /**
   * Upload a file through HOP the way the desktop does, then send the rich
   * text carrying its reference. The row keeps the public reference and a
   * copy of the bytes under the media dir; the ticket goes on the wire only.
   */
  const sendFile = async (peer, { path: file, text = null }, { device: index = 1 } = {}) => {
    if (!hopUrl) throw new Error(`${name} has no HOP node to upload to`);
    if (!media) throw new Error(`${name} has no media directory`);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
    if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file} exceeds the ${MAX_ATTACHMENT_BYTES}-byte attachment cap`);
    const bytes = new Uint8Array(fs.readFileSync(file));
    const mime = mimeOf(file);
    const meta = describeFile(bytes, mime);
    const uploaded = await uploadFile({ url: hopUrl, bytes, signer: bulletin });
    const identifier = bytesToHex(uploaded.identifier);
    const mediaId = identifier.slice(2);
    media.save(mediaId, bytes, mime);
    recordEntries(uploaded.identifier, uploaded.chunks, normHex(peer), null);
    const reference = { ...meta, identifier, wssUrl: hopUrl, chunks: uploaded.chunks.map(bytesToHex), status: "sent", claimedBy: null, mediaId, error: null };
    const wire = { type: "richText", text, attachments: [{ ...meta, identifier: uploaded.identifier, claimTicket: uploaded.claimTicket, wssUrl: hopUrl }] };
    const ids = await device(index).engine.sendMessage(normHex(peer), { type: "richText", text, attachments: [reference] }, { wire });
    for (const entry of hopEntries.values()) if (entry.peer === normHex(peer) && entry.messageId == null) entry.messageId = ids.messageId;
    log("PERSONA_FILE_SENT", { name, device: index, peer: normHex(peer), mime, bytes: bytes.length, chunks: uploaded.chunks.length, id: identifier.slice(0, 18) });
    return ids;
  };

  /**
   * Claim every attachment of a freshly decoded message, on the device that
   * decoded it. The other devices share the row and see "claimed by device
   * N": the HOP claim is one-shot, so they never claim (the desktop's
   * placeholder). Failures land on the row, never throw.
   */
  const claimAttachments = async ({ peer, messageId, claimTickets, device: index }) => {
    const message = state.messages.get(messageId);
    for (const [i, ticket] of claimTickets.entries()) {
      const a = message?.content.attachments?.[i];
      if (!a || !ticket) continue;
      state.messages.updateAttachment(messageId, i, { status: "claiming", claimedBy: index });
      try {
        if (!media) throw new Error("no media directory");
        if (!a.wssUrl) throw new Error("the message names no HOP node");
        checkHopUrl(a.wssUrl);
        if (!Number.isSafeInteger(a.fileSize) || a.fileSize > MAX_ATTACHMENT_BYTES) throw new Error(`declared size ${a.fileSize} exceeds the ${MAX_ATTACHMENT_BYTES}-byte cap`);
        const identifier = hexToBytes(a.identifier);
        const bytes = await downloadFile({
          url: a.wssUrl, identifier, claimTicket: ticket, maxBytes: a.fileSize,
          onChunks: (chunks) => recordEntries(identifier, chunks, peer, messageId),
        });
        if (bytes.length !== a.fileSize) throw new Error(`downloaded ${bytes.length} bytes, the message says ${a.fileSize}`);
        const mediaId = a.identifier.slice(2);
        media.save(mediaId, bytes, a.mimeType);
        state.messages.updateAttachment(messageId, i, { status: "claimed", mediaId });
        started?.onEvent?.({ persona: name, device: index, event: "attachment_claimed", peer, messageId, bytes: bytes.length, id: a.identifier.slice(0, 18) });
        log("PERSONA_ATTACHMENT_CLAIMED", { name, device: index, peer, bytes: bytes.length, id: a.identifier.slice(0, 18) });
      } catch (error) {
        state.messages.updateAttachment(messageId, i, { status: "failed", error: error.message });
        started?.onEvent?.({ persona: name, device: index, event: "attachment_failed", peer, messageId, error: error.message, id: a.identifier.slice(0, 18) });
        log("PERSONA_ATTACHMENT_FAILED", { name, device: index, peer, id: a.identifier.slice(0, 18), error: error.message });
      }
    }
  };

  const device = (index = 1) => {
    const found = deviceList[index - 1];
    if (!found) throw new Error(`${name} has no device ${index} (has ${deviceList.length})`);
    if (found.removed) throw new Error(`${name}#${index} was removed`);
    if (!found.engine) throw new Error(`${name}#${index} is offline`);
    return found;
  };
  const activeDevices = () => deviceList.filter((d) => !d.removed);

  const persona = {
    name,
    account,
    identity,
    devices: deviceList,
    state,
    /** The public half of the upload signer. */
    bulletinAccount: bulletin.account,
    /**
     * Publish the identity, grant every device its statement allowance
     * (mds.md: devices need their own) and the upload signer its Bulletin
     * allowance.
     */
    register(directory) {
      directory.register(account, { username: name, identifierKey: identity.identityChatPublicKey, bulletinAccount: bulletin.account });
      for (const d of deviceList) directory.allow(d.account);
    },
    sendFile,
    /** A media file this persona holds (sent or claimed), by identifier hex without 0x. */
    media: (id) => media?.find(id) ?? null,
    /** What this persona knows about a pool entry it uploaded or claimed. */
    hopEntry: (hash) => hopEntries.get(normHex(hash)) ?? null,
    /** Add a device to a live persona; contacts learn it through the fan-out on their next accept. */
    addDevice() {
      const d = createDevice({ index: deviceList.length + 1 });
      deviceList.push(d);
      if (started) startDevice(d);
      return d;
    },
    /**
     * Remove a device, as unpairing a phone: it goes offline for good (its
     * index stays, so the others keep their numbers) and a remaining device
     * tells every contact `deviceRemoved`, so peers stop wrapping for it.
     */
    async removeDevice(index) {
      const gone = device(index);
      const remaining = activeDevices().find((d) => d !== gone && d.engine);
      if (!remaining) throw new Error(`${name} cannot remove its last device`);
      gone.stop();
      gone.removed = true;
      await remaining.engine.announceDeviceRemoved(gone.keys.statementAccountId);
      return gone;
    },
    start(deps) {
      started = deps;
      for (const d of activeDevices()) startDevice(d);
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
    sendRaw: (peer, bytes, { device: index = 1 } = {}) => device(index).engine.sendRaw(normHex(peer), bytes),
    call: (peer, { device: index = 1 } = {}) => device(index).engine.call(normHex(peer)),
    react: (peer, messageId, emoji, add, { device: index = 1 } = {}) => device(index).engine.react(normHex(peer), messageId, emoji, add),
    edit: (peer, messageId, text, { device: index = 1 } = {}) => device(index).engine.edit(normHex(peer), messageId, text),
    markRead: (peer) => state.messages.markRoomRead(peer),
    /** Public half only. */
    toJSON: () => ({ name, account, chatPublicKey: bytesToHex(identity.identityChatPublicKey), bulletinAccount: bulletin.account, devices: deviceList.map((d) => d.toJSON()) }),
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
      ownDevices: () => activeDevices().map((x) => x.info),
      onEvent: (event) => started.onEvent?.({ persona: name, device: d.index, ...event }),
      onAttachments: (job) => void claimAttachments(job),
    });
  }

  return persona;
}
