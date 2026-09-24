// Spec 0011 private groups v2 (polkadot-chat-desktop docs/spec/0011-groups-v2.md):
// the bot as a member, and as an admin when the group state says so.
//
// A group is a secret: the epoch key K_e. From it the bot derives the group's
// topic, its own carrier channel and the message key (lib/group-keys.mjs).
// Rules this module owns (index.mjs owns the wire):
//   - a `welcome` (kind 249, over the DM session) is accepted from a peer the
//     bot allows (`isAllowed`, today's admission rule) or from an admin of a
//     group the bot is already in; the state it names is fetched from the
//     topic and checked against `stateHash`;
//   - a carrier is opened with MsgKey_e; its signer must be a posting account
//     of `from` in the current state, `from` must hold `post` (a groupLeave
//     is always allowed), a role-0 member's carrier that arrives sooner than
//     `slowModeSecs` after its previous one is hidden, messages dedup by id;
//   - a state applies by (epoch, version, lower signer) when its signer's
//     role and flags allow the change;
//   - a rekey out of the current epoch: the bot opens its entry with
//     K(admin, bot) and switches epoch, keeping the old key 14 days; no entry
//     while still listed = keyRequest to that admin; forks go to the lower
//     signer, the other key is kept 24 h;
//   - the bot sends ONE statement per send on ChMsgs_e: the new messages and
//     its own messages of the last 24 h, newest first, <= 4096 bytes
//     plaintext, at most one per second, and for role 0 at most one per
//     `slowModeSecs` (a refusal says when to retry; the caller merges);
//   - botInfo (0011 ruling 8): the bot's first statement after it joins
//     carries its botInfo inline, oldest, ahead of the reply; a later
//     statement carries it again only when its version changed. It is not
//     carried for 24 h and not kept as history;
//   - history: any member may ask; pages of <= 4 KB, newest first, <= 100
//     messages, never older than the asker's join unless historyShare > 0;
//   - as an admin (role >= 1 with the flag): answer keyRequest with a
//     welcome, admit join requests by invite (policy 2 at once, policy 1
//     pending), remove a member (rekey on the old topic + state on the new
//     one: two submissions), remove a member that posted groupLeave, and
//     rotate the epoch after 7 days.
//
// Kept apart from index.mjs so every rule runs in memory in the tests.
import crypto from "node:crypto";
import { decodeOpaqueMessageAt, encodeOpaqueGroupControlMessage, GROUP_CONTROL_LIMITS } from "../vendor/app-chat-codec.mjs";
import {
  GROUP_BOUNDS, GROUP_DATA, GROUP_MEMBER_CAP, PERMISSIONS, ROLES, ALL_PERMISSIONS,
  decodeGroupData, decodeGroupMessages, decodeGroupState, encodeGroupData, encodeGroupMessages, encodeGroupState,
} from "./group-codec.mjs";
import { deriveEpoch, hash256, joinProof, makeRekeyEntry, open, openRekeyEntry, seal } from "./group-keys.mjs";

const norm = (hex) => String(hex ?? "").trim().replace(/^0x/i, "").toLowerCase();
const hexOf = (b) => (typeof b === "string" ? norm(b) : Buffer.from(b).toString("hex"));
const bytesOf = (h) => Uint8Array.from(Buffer.from(norm(h), "hex"));
const DAY = 86_400_000;
export const CARRY_WINDOW_MS = DAY;
export const OLD_KEY_KEEP_MS = 14 * DAY;
export const FORK_KEEP_MS = DAY;
export const ROTATION_MS = 7 * DAY;
export const ROTATION_JITTER_MS = 3_600_000;
export const HISTORY_PAGE_BYTES = 4096;
const SEEN_IDS = 1000;
const PENDING_STATEMENTS = 64;
const KEY_REQUEST_EVERY_MS = 60_000;
// Group kinds never ride inside a carrier, except groupLeave (0011 vectors,
// decoder bounds).
const FORBIDDEN_IN_CARRIER = new Set(["groupInfo", "groupMessage", "groupControl"]);

export const createGroupsV2 = ({
  selfHex,
  pairwiseKey,        // async (peerHex) -> K(self, peer) | null
  submit,             // async ({ groupId, topic, channel, data }) -> void; data = encoded GroupData
  sendControl,        // async (peerHex, control) -> void; one kind-249 message over the DM session
  botInfo = () => null, // () -> { version, opaque } | null; the bot's own botInfo message
  isAllowed = () => true,
  now = () => Date.now(),
  random = (n) => new Uint8Array(crypto.randomBytes(n)),
  log = () => {},
  maxGroups = 200,
  historyKeep = 200,
}) => {
  const self = norm(selfHex);
  const groups = new Map();      // groupId -> group
  const byTopic = new Map();     // topic hex -> { groupId, epoch }
  const joinOpeners = new Map(); // peerHex -> groupId: accepted "Join request" openers awaiting joinRequest

  const reindex = () => {
    byTopic.clear();
    for (const g of groups.values()) {
      if (g.status === "removed") continue;
      for (const [epoch, ep] of g.epochs) byTopic.set(hexOf(ep.topic), { groupId: g.groupId, epoch });
    }
  };
  const memberOf = (state, account) => state?.members.find((m) => m.account === norm(account)) ?? null;
  // The member a statement signer speaks for: the account itself or one of
  // its posting accounts (mds devices, level-2 aliases).
  const memberBySigner = (state, signer) => state?.members.find((m) => m.account === signer || m.posting.includes(signer)) ?? null;
  const can = (member, flag) => !!member && (member.role === ROLES.owner || (member.role >= ROLES.admin && (member.permissions & flag) === flag));
  const canPost = (member) => !!member && (member.role === ROLES.owner || (member.permissions & PERMISSIONS.post) !== 0);
  const selfMember = (g) => memberOf(g.state, self);
  const current = (g) => g.epochs.get(g.epoch);
  const newGroup = (groupId) => ({
    groupId, epoch: 0, epochs: new Map(), state: null, stateSigner: null, stateBytes: null, pendingWelcome: null,
    status: "pending", locked: false, carry: [], lastSentAt: 0, seen: [], seenSet: new Set(), senders: new Set(), gaps: new Set(),
    lastArrival: new Map(), history: [], joinedAt: now(), forks: new Map(), pending: [], keyRequestedAt: 0, rotateAt: null,
    botInfoVersion: 0, // the botInfo version last sent to this group (0 = none)
  });
  const addKey = (g, epoch, key, extra = {}) => {
    g.epochs.set(epoch, { ...deriveEpoch(key, g.groupId, epoch), openedAt: now(), erasesAt: null, ...extra });
    if (epoch > g.epoch) {
      const old = g.epochs.get(g.epoch);
      if (old) old.erasesAt = now() + OLD_KEY_KEEP_MS;
      g.epoch = epoch;
      g.rotateAt = null;
    }
    reindex();
  };
  const remember = (g, id) => {
    if (g.seenSet.has(id)) return false;
    g.seenSet.add(id); g.seen.push(id);
    while (g.seen.length > SEEN_IDS) g.seenSet.delete(g.seen.shift());
    return true;
  };
  const keepHistory = (g, item) => {
    g.history.push(item);
    g.history.sort((a, b) => a.timestamp - b.timestamp);
    while (g.history.length > historyKeep) g.history.shift();
  };
  const trimGroups = () => { while (groups.size > maxGroups) groups.delete(groups.keys().next().value); };

  // ---------- statements out ----------
  const submitData = (g, ep, channel, data) => submit({ groupId: g.groupId, topic: ep.topic, channel, data: encodeGroupData(data) });
  const sealState = (ep, state) => {
    const plaintext = encodeGroupState(state);
    return { plaintext, sealed: seal(ep.msgKey, { signer: self, epoch: ep.epoch, variant: GROUP_DATA.state, plaintext, nonce: random(12) }) };
  };
  const postState = async (g, ep, state) => {
    const { plaintext, sealed } = sealState(ep, state);
    await submitData(g, ep, ep.channels.state, { state: sealed });
    applyState(g, decodeGroupState(plaintext), plaintext, self);
    return plaintext;
  };
  const welcomeFor = (g) => ({
    welcome: { groupId: g.groupId, epoch: g.epoch, epochKey: current(g).key, stateVersion: g.state.version, stateHash: hash256(g.stateBytes) },
  });

  // ---------- state ----------
  const applyState = (g, state, bytes, signer) => {
    g.state = state; g.stateBytes = bytes; g.stateSigner = signer; g.pendingWelcome = null;
    const me = selfMember(g);
    const was = g.status;
    g.status = me ? "member" : "removed";
    if (g.status === "removed") { g.carry = []; reindex(); }
    if (was !== "member" && g.status === "member") g.botInfoVersion = 0; // a (re)join announces again
    if (was !== g.status) log(g.status === "member" ? "BOT_GROUP2_JOINED" : "BOT_GROUP2_REMOVED", { group: g.groupId, epoch: state.epoch, version: state.version, members: state.members.length });
    else log("BOT_GROUP2_STATE", { group: g.groupId, epoch: state.epoch, version: state.version, members: state.members.length, by: signer });
  };
  // Is `next` a change the signer may make on top of `cur`? (0011 Rules.)
  const stateChangeAllowed = (cur, next, signerMember) => {
    if (!signerMember || signerMember.role < ROLES.admin) return "not-admin";
    const isOwner = signerMember.role === ROLES.owner;
    const oldBy = new Map(cur.members.map((m) => [m.account, m]));
    const newBy = new Map(next.members.map((m) => [m.account, m]));
    const added = next.members.filter((m) => !oldBy.has(m.account));
    const removed = cur.members.filter((m) => !newBy.has(m.account));
    if (added.length && !can(signerMember, PERMISSIONS.add) && !can(signerMember, PERMISSIONS.approve)) return "no-add";
    if (removed.length && !can(signerMember, PERMISSIONS.remove)) return "no-remove";
    const oldOwner = cur.members.find((m) => m.role === ROLES.owner);
    const newOwner = next.members.find((m) => m.role === ROLES.owner);
    if (oldOwner.account !== newOwner.account && !isOwner) {
      // The owner left without a transfer: the longest-standing admin takes over.
      const heir = cur.members.filter((m) => m.role === ROLES.admin && m.account !== oldOwner.account)
        .sort((a, b) => a.joinedAt - b.joinedAt || (a.account < b.account ? -1 : 1))[0];
      if (newBy.has(oldOwner.account) || heir?.account !== newOwner.account) return "owner-only";
    }
    for (const m of next.members) {
      const o = oldBy.get(m.account);
      if (!o) { if (m.role > ROLES.member && !isOwner && !can(signerMember, PERMISSIONS.admins)) return "no-admins"; continue; }
      if (o.role === m.role && o.permissions === m.permissions) continue;
      if (o.account === oldOwner.account || m.role === ROLES.owner) continue; // judged above
      if (o.role >= ROLES.admin && !isOwner) return "owner-only";
      if (!can(signerMember, PERMISSIONS.admins)) return "no-admins";
    }
    const info = ["name", "avatar", "slowModeSecs", "joinPolicy", "historyShare", "defaultPermissions"];
    if (info.some((k) => cur[k] !== next[k]) && !can(signerMember, PERMISSIONS.info)) return "no-info";
    if (JSON.stringify(cur.pinned) !== JSON.stringify(next.pinned) && !can(signerMember, PERMISSIONS.pin)) return "no-pin";
    const inv = (s) => JSON.stringify(s.invites.map((i) => [i.inviteId, i.secret, i.createdBy, i.expiresAt, i.maxUses]));
    if (inv(cur) !== inv(next) && !can(signerMember, PERMISSIONS.add)) return "no-invites";
    return null;
  };
  const receiveState = (g, epoch, signer, plaintext) => {
    const state = decodeGroupState(plaintext);
    if (state.groupId !== g.groupId || state.epoch !== epoch) return "wrong-group-or-epoch";
    if (!g.state) {
      const w = g.pendingWelcome;
      if (!w) return "no-welcome";
      const matches = w.epoch === epoch && Buffer.from(hash256(plaintext)).equals(Buffer.from(w.stateHash));
      // The welcomer may have posted a newer state before we fetched: accept
      // its own later version too.
      const newer = w.epoch === epoch && memberBySigner(state, signer)?.account === w.from && state.version >= w.stateVersion;
      if (!matches && !newer) return "hash-mismatch";
      const welcomer = memberOf(state, w.from);
      if (!welcomer || welcomer.role < ROLES.admin) return "welcomer-not-admin";
      applyState(g, state, plaintext, signer);
      return "applied";
    }
    const cur = g.state;
    if (state.epoch < cur.epoch || (state.epoch === cur.epoch && state.version < cur.version)) return "stale";
    if (state.epoch === cur.epoch && state.version === cur.version) {
      if (Buffer.from(plaintext).equals(Buffer.from(g.stateBytes))) return "duplicate";
      if (!(signer < g.stateSigner)) return "stale"; // at a tie the lower signer wins
    }
    const why = stateChangeAllowed(cur, state, memberBySigner(cur, signer));
    if (why) return why;
    applyState(g, state, plaintext, signer);
    return "applied";
  };

  // ---------- carriers in ----------
  const receiveMessages = async (g, epoch, signer, plaintext) => {
    const carrier = decodeGroupMessages(plaintext);
    const member = memberOf(g.state, carrier.from);
    if (!member) return { outcome: "non-member" };
    if (signer !== member.account && !member.posting.includes(signer)) return { outcome: "bad-signer" };
    const decoded = [];
    for (const opaque of carrier.messages) {
      const m = decodeOpaqueMessageAt(opaque, 0).value;
      if (m.kind === "undecodable" || FORBIDDEN_IN_CARRIER.has(m.kind)) continue;
      decoded.push({ m, opaque });
    }
    const leaveOnly = decoded.length > 0 && decoded.every(({ m }) => m.kind === "groupLeave");
    if (!canPost(member) && !leaveOnly) return { outcome: "no-post" };
    const t = now();
    if (member.role === ROLES.member && g.state.slowModeSecs > 0 && !leaveOnly) {
      const last = g.lastArrival.get(member.account);
      if (last != null && t - last < g.state.slowModeSecs * 1000) return { outcome: "slow-mode" };
    }
    g.lastArrival.set(member.account, t);
    const fresh = [];
    let knownInCarrier = false;
    // The carrier is newest first; hand messages on oldest first.
    for (const { m, opaque } of [...decoded].reverse()) {
      if (!m.messageId) continue;
      const id = `${member.account}:${m.messageId}`;
      if (!remember(g, id)) { knownInCarrier = true; continue; }
      keepHistory(g, { from: member.account, messageId: m.messageId, timestamp: m.timestamp, opaque });
      // Carried messages from before the bot joined are history, not requests.
      fresh.push({ from: member.account, message: m, opaque, answerable: m.timestamp >= g.joinedAt - 60_000 });
    }
    let gap = false;
    if (fresh.length && !knownInCarrier && g.senders.has(member.account) && !g.gaps.has(member.account)) {
      gap = true; g.gaps.add(member.account);
    }
    g.senders.add(member.account);
    const leaves = fresh.filter((f) => f.message.kind === "groupLeave" && f.message.groupId === g.groupId);
    if (leaves.length) {
      log("BOT_GROUP2_MEMBER_LEFT", { group: g.groupId, member: member.account });
      if (can(selfMember(g), PERMISSIONS.remove) && member.role !== ROLES.owner) {
        await api.remove(g.groupId, member.account).catch((e) => log("BOT_GROUP2_REMOVE_FAILED", { group: g.groupId, member: member.account, error: String(e?.message ?? e) }));
      }
    }
    return { outcome: "accepted", from: member.account, messages: fresh.filter((f) => f.message.kind !== "groupLeave"), gap };
  };

  // ---------- rekey in ----------
  const receiveRekey = async (g, epoch, signer, rekey) => {
    if (rekey.newEpoch <= epoch) return { outcome: "bad-epoch" };
    // Out of the current epoch, or a second rekey into an epoch already
    // opened (a fork or a duplicate).
    if (epoch !== g.epoch && !g.epochs.has(rekey.newEpoch)) return { outcome: "old-epoch" };
    const admin = memberBySigner(g.state, signer);
    if (!admin || admin.role < ROLES.admin) return { outcome: "not-admin" };
    const kab = await pairwiseKey(admin.account);
    const key = kab ? openRekeyEntry(kab, { groupId: g.groupId, rekey }) : null;
    if (!key) {
      if (selfMember(g) && g.epochs.has(rekey.newEpoch) === false) {
        g.locked = true;
        if (now() - g.keyRequestedAt > KEY_REQUEST_EVERY_MS) {
          g.keyRequestedAt = now();
          await sendControl(admin.account, { keyRequest: { groupId: g.groupId, haveEpoch: g.epoch } })
            .catch((e) => log("BOT_GROUP2_KEY_REQUEST_FAILED", { group: g.groupId, error: String(e?.message ?? e) }));
          log("BOT_GROUP2_KEY_REQUESTED", { group: g.groupId, to: admin.account, haveEpoch: g.epoch });
        }
      }
      return { outcome: kab ? "no-entry" : "no-pairwise-key" };
    }
    const existing = g.epochs.get(rekey.newEpoch);
    if (existing) {
      if (Buffer.from(existing.key).equals(Buffer.from(key))) return { outcome: "duplicate" };
      // Fork: two rekeys out of the same epoch. The lower signer wins; the
      // other key stays readable for 24 h.
      if (signer < existing.signer) {
        g.forks.set(rekey.newEpoch, { ...existing, erasesAt: now() + FORK_KEEP_MS });
        g.epochs.set(rekey.newEpoch, { ...deriveEpoch(key, g.groupId, rekey.newEpoch), openedAt: now(), erasesAt: null, signer });
      } else {
        g.forks.set(rekey.newEpoch, { ...deriveEpoch(key, g.groupId, rekey.newEpoch), openedAt: now(), erasesAt: now() + FORK_KEEP_MS, signer });
      }
      reindex();
      log("BOT_GROUP2_REKEY_FORK", { group: g.groupId, newEpoch: rekey.newEpoch, winner: g.epochs.get(rekey.newEpoch).signer });
      return { outcome: "fork" };
    }
    g.locked = false;
    addKey(g, rekey.newEpoch, key, { signer });
    log("BOT_GROUP2_REKEYED", { group: g.groupId, epoch: rekey.newEpoch, by: admin.account, entries: rekey.entries.length });
    return { outcome: "rekeyed", topicsChanged: true };
  };

  const drainPending = async (g) => {
    const pending = g.pending; g.pending = [];
    const out = [];
    for (const st of pending) out.push(await api.receive(st));
    return out;
  };

  const api = {
    get: (groupId) => groups.get(groupId) ?? null,
    list: () => [...groups.values()],
    // Every topic to watch: each group's current and still-kept epochs.
    topics: () => [...byTopic.keys()].map((h) => bytesOf(h)),
    hasTopic: (topicHex) => byTopic.has(norm(topicHex)),

    // A `welcome` over the DM session from `fromHex`.
    welcome(fromHex, w) {
      const from = norm(fromHex);
      const existing = groups.get(w.groupId);
      if (existing?.state) {
        if ((memberOf(existing.state, from)?.role ?? -1) < ROLES.admin) return "not-admin";
        if (existing.epochs.has(w.epoch)) return "duplicate";
      } else if (!isAllowed(from)) return "not-allowed";
      const g = existing ?? newGroup(w.groupId);
      if (!existing) { groups.set(w.groupId, g); trimGroups(); }
      addKey(g, w.epoch, w.epochKey, { signer: from });
      g.locked = false;
      if (!g.state || w.epoch > g.state.epoch) {
        if (!g.state) g.pendingWelcome = { from, epoch: w.epoch, stateVersion: w.stateVersion, stateHash: w.stateHash };
      }
      if (g.status === "removed") g.status = "pending";
      log("BOT_GROUP2_WELCOME", { group: w.groupId, from, epoch: w.epoch, version: w.stateVersion });
      return existing ? "rekeyed" : "welcomed";
    },

    // One statement from a group topic: { topicHex, channelHex, signerHex, data }.
    // Resolves { outcome, groupId?, messages?, gap?, topicsChanged? }.
    async receive(st) {
      const where = byTopic.get(norm(st.topicHex));
      if (!where) return { outcome: "unknown-topic" };
      const g = groups.get(where.groupId);
      const ep = g.epochs.get(where.epoch) ?? g.forks.get(where.epoch);
      const signer = norm(st.signerHex);
      const base = { groupId: g.groupId, epoch: where.epoch };
      if (signer === self) return { ...base, outcome: "own" };
      let data;
      try { data = decodeGroupData(st.data); } catch (e) { return { ...base, outcome: "undecodable", error: String(e.message) }; }
      const channel = norm(st.channelHex);
      const expected = { messages: ep.channels.msgs, state: ep.channels.state, rekey: ep.channels.rekey }[data.kind];
      if (channel !== hexOf(expected)) return { ...base, outcome: "wrong-channel" };
      if (data.kind !== "state" && !g.state) {
        // The state names who may speak; hold carriers until it arrives.
        if (g.pending.length < PENDING_STATEMENTS) g.pending.push(st);
        return { ...base, outcome: "held" };
      }
      try {
        if (data.kind === "rekey") return { ...base, ...(await receiveRekey(g, where.epoch, signer, data.rekey)) };
        const variant = data.kind === "state" ? GROUP_DATA.state : GROUP_DATA.messages;
        let plaintext;
        try { plaintext = open(ep.msgKey, { signer: bytesOf(signer), epoch: where.epoch, variant, sealed: data.sealed }); }
        catch { return { ...base, outcome: "unopenable" }; }
        if (data.kind === "state") {
          const outcome = receiveState(g, where.epoch, signer, plaintext);
          const drained = outcome === "applied" && g.pending.length ? await drainPending(g) : [];
          return { ...base, outcome, drained };
        }
        if (g.status !== "member") return { ...base, outcome: "not-member" };
        return { ...base, ...(await receiveMessages(g, where.epoch, signer, plaintext)) };
      } catch (e) {
        return { ...base, outcome: "rejected", error: String(e?.message ?? e) };
      }
    },

    // Can the bot send to this group now? null, or { reason, retryInMs? }.
    sendBlock(groupId, { leaveOnly = false } = {}) {
      const g = groups.get(groupId);
      if (!g || g.status !== "member" || !g.state) return { reason: g ? g.status : "unknown-group" };
      if (g.locked) return { reason: "no-key" };
      const me = selfMember(g);
      if (!canPost(me) && !leaveOnly) return { reason: "no-post" };
      const since = now() - g.lastSentAt;
      if (me.role === ROLES.member && g.state.slowModeSecs > 0 && since < g.state.slowModeSecs * 1000) {
        return { reason: "slow-mode", retryInMs: g.state.slowModeSecs * 1000 - since };
      }
      if (since < 1000) return { reason: "rate", retryInMs: 1000 - since };
      return null;
    },

    // ONE carrier statement with `opaques` (new messages, oldest first) and
    // the bot's own messages of the last 24 h. { ok, reason?, retryInMs?, carried? }.
    async send(groupId, opaques) {
      const decoded = opaques.map((opaque) => ({ opaque, m: decodeOpaqueMessageAt(opaque, 0).value }));
      const block = api.sendBlock(groupId, { leaveOnly: decoded.every(({ m }) => m.kind === "groupLeave") });
      if (block) return { ok: false, ...block };
      const g = groups.get(groupId);
      const t = now();
      const ep = current(g);
      // The carry never crosses an epoch: a member admitted into the new
      // epoch must not read what was sent under the old key.
      g.carry = g.carry.filter((c) => t - c.sentAt < CARRY_WINDOW_MS && c.epoch === ep.epoch);
      const fresh = decoded.map(({ opaque, m }) => ({ opaque, messageId: m.messageId, timestamp: m.timestamp, sentAt: t, epoch: ep.epoch }));
      const newestFirst = [...fresh].reverse();
      const size = (items) => encodeGroupMessages({ from: self, messages: items.map((c) => c.opaque) }).length;
      if (size(newestFirst) > GROUP_BOUNDS.plaintext) return { ok: false, reason: "too-large" };
      const items = [...newestFirst];
      // Ruling 8: botInfo rides the first statement after the join (and the
      // first after a version change), as the oldest message in it. When it
      // does not fit next to the reply, it waits for the next statement.
      const leaveOnly = decoded.every(({ m }) => m.kind === "groupLeave");
      const info = leaveOnly ? null : botInfo();
      let announced = null;
      if (info && info.version !== g.botInfoVersion) {
        if (size([...items, info]) <= GROUP_BOUNDS.plaintext) { items.push(info); announced = info; }
        else log("BOT_GROUP2_BOTINFO_DEFERRED", { group: groupId, version: info.version });
      }
      for (const c of [...g.carry].reverse()) {
        if (size([...items, c]) > GROUP_BOUNDS.plaintext) break;
        items.push(c);
      }
      const plaintext = encodeGroupMessages({ from: self, messages: items.map((c) => c.opaque) });
      const sealed = seal(ep.msgKey, { signer: self, epoch: ep.epoch, variant: GROUP_DATA.messages, plaintext, nonce: random(12) });
      await submitData(g, ep, ep.channels.msgs, { messages: sealed });
      g.lastSentAt = t;
      if (announced) g.botInfoVersion = announced.version;
      g.carry.push(...fresh);
      for (const f of fresh) {
        remember(g, `${self}:${f.messageId}`);
        keepHistory(g, { from: self, messageId: f.messageId, timestamp: f.timestamp, opaque: f.opaque });
      }
      const carried = items.length - fresh.length - (announced ? 1 : 0);
      log("BOT_GROUP2_SENT", { group: groupId, epoch: ep.epoch, messages: fresh.length, carried, bytes: plaintext.length, ...(announced ? { botInfo: announced.version } : {}) });
      return { ok: true, epoch: ep.epoch, carried, bytes: plaintext.length, ...(announced ? { botInfo: announced.version } : {}) };
    },

    // A history request from a member: the pages to send (History controls),
    // each <= 4 KB as an encoded message, newest first. [] when refused.
    // Sized with a 40-character message id (the caller picks the real one).
    historyPages(fromHex, req, { messageId = "0".repeat(40), timestamp = now() } = {}) {
      const g = groups.get(req.groupId);
      const asker = g?.state ? memberOf(g.state, fromHex) : null;
      if (!asker) return [];
      let items = [...g.history];
      if (req.since?.messageId != null) {
        const i = items.findIndex((x) => x.messageId === req.since.messageId);
        items = i >= 0 ? items.slice(i + 1) : items;
      } else if (req.since?.timestamp != null) items = items.filter((x) => x.timestamp > req.since.timestamp);
      if (g.state.historyShare === 0) items = items.filter((x) => x.timestamp >= asker.joinedAt);
      items = items.reverse().slice(0, Math.min(req.limit ?? GROUP_CONTROL_LIMITS.historyLimit, GROUP_CONTROL_LIMITS.historyLimit));
      const pages = [];
      let page = [];
      const pageBytes = (list, last) => encodeOpaqueGroupControlMessage({
        messageId, timestamp, control: { history: { groupId: g.groupId, items: list.map((x) => ({ from: x.from, message: x.opaque })), last } },
      }).length;
      for (const it of items) {
        if (pageBytes([it], true) > HISTORY_PAGE_BYTES) continue; // a single larger message is not shared
        if (page.length && pageBytes([...page, it], true) > HISTORY_PAGE_BYTES) { pages.push(page); page = []; }
        page.push(it);
      }
      if (page.length || pages.length === 0) pages.push(page);
      return pages.map((list, i) => ({ history: { groupId: g.groupId, items: list.map((x) => ({ from: x.from, message: x.opaque })), last: i === pages.length - 1 } }));
    },

    // ---------- admin ----------
    isAdmin: (groupId) => { const g = groups.get(groupId); return !!g?.state && (selfMember(g)?.role ?? 0) >= ROLES.admin; },

    // A keyRequest from a listed member: answer with a welcome.
    async keyRequest(fromHex, req) {
      const g = groups.get(req.groupId);
      if (!g?.state || !api.isAdmin(req.groupId)) return "not-admin";
      if (!memberOf(g.state, fromHex)) return "not-listed";
      await sendControl(norm(fromHex), welcomeFor(g));
      log("BOT_GROUP2_KEY_SENT", { group: g.groupId, to: norm(fromHex), epoch: g.epoch });
      return "welcomed";
    },

    // Remove a member: rekey on Topic_e (an entry per remaining member,
    // itself included) + the new state on Topic_{e+1}. Two submissions.
    async remove(groupId, accountHex) { return rekeyGroup(groupId, { remove: norm(accountHex) }); },
    // Timer rotation: a new epoch with the same roster.
    async rotate(groupId) { return rekeyGroup(groupId, {}); },

    // Admin add (M16 "admin adds"): state + welcome over the DM session.
    async add(groupId, accountHex, { role = ROLES.member, permissions } = {}) {
      const g = groups.get(groupId);
      if (!g?.state || !can(selfMember(g), PERMISSIONS.add)) return "not-allowed";
      if (memberOf(g.state, accountHex)) return "already-member";
      if (g.state.members.length >= GROUP_MEMBER_CAP) return "full";
      const state = { ...g.state, version: g.state.version + 1, members: [...g.state.members, { account: norm(accountHex), role, permissions: permissions ?? g.state.defaultPermissions, posting: [], joinedAt: now() }] };
      await postState(g, current(g), state);
      await sendControl(norm(accountHex), welcomeFor(g));
      return "added";
    },

    // A "Join request: <name> [grp:<inviteId>:<proof>]" opener from a stranger:
    // accept the chat request when the bot admits for that invite.
    acceptsJoinOpener(peerHex, text) {
      const m = /\[grp:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)\]/.exec(String(text ?? ""));
      if (!m) return false;
      const inviteId = Buffer.from(m[1], "base64url").toString("hex");
      const proof = Buffer.from(m[2], "base64url");
      for (const g of groups.values()) {
        const invite = g.state?.invites.find((i) => i.inviteId === inviteId);
        if (!invite || !can(selfMember(g), PERMISSIONS.add) && !can(selfMember(g), PERMISSIONS.approve)) continue;
        if (!proof.equals(Buffer.from(joinProof(invite.secret, peerHex)))) continue;
        joinOpeners.set(norm(peerHex), g.groupId);
        while (joinOpeners.size > 500) joinOpeners.delete(joinOpeners.keys().next().value);
        return true;
      }
      return false;
    },

    // A joinRequest over the DM session. Policy 2 admits at once (state +
    // welcome), policy 1 answers pending, anything invalid is rejected.
    async joinRequest(fromHex, req) {
      const from = norm(fromHex);
      const g = groups.get(req.groupId);
      const inviteId = hexOf(req.inviteId);
      const decide = async (status, reason) => {
        await sendControl(from, { joinDecision: { groupId: req.groupId, inviteId: req.inviteId, status } });
        log("BOT_GROUP2_JOIN_DECIDED", { group: req.groupId, from, status: status === 0 ? "pending" : "rejected", reason });
        return reason;
      };
      if (!g?.state || !(can(selfMember(g), PERMISSIONS.add) || can(selfMember(g), PERMISSIONS.approve))) return "not-admin";
      if (memberOf(g.state, from)) return "already-member";
      const invite = g.state.invites.find((i) => i.inviteId === inviteId);
      if (!invite) return decide(1, "unknown-invite");
      if (!Buffer.from(req.proof).equals(Buffer.from(joinProof(invite.secret, from)))) return decide(1, "bad-proof");
      if (invite.expiresAt !== 0 && invite.expiresAt < now()) return decide(1, "expired");
      if (invite.maxUses !== 0 && invite.uses >= invite.maxUses) return decide(1, "used-up");
      if (g.state.members.length >= GROUP_MEMBER_CAP) return decide(1, "full");
      if (g.state.joinPolicy === 0) return decide(1, "admins-add-only");
      if (g.state.joinPolicy === 1) return decide(0, "pending");
      joinOpeners.delete(from);
      const state = {
        ...g.state,
        version: g.state.version + 1,
        members: [...g.state.members, { account: from, role: ROLES.member, permissions: g.state.defaultPermissions, posting: [], joinedAt: now() }],
        invites: g.state.invites.map((i) => (i.inviteId === inviteId ? { ...i, uses: i.uses + 1 } : i)),
      };
      await postState(g, current(g), state);
      await sendControl(from, welcomeFor(g));
      log("BOT_GROUP2_ADMITTED", { group: g.groupId, member: from, version: state.version });
      return "admitted";
    },

    // Create a group with this identity as owner (tests, scripts): epoch 1,
    // state v1 on ChState_1; returns the welcome to send to every other member.
    async create({ groupId, name, members = [], createdAt = now(), joinPolicy = 0, historyShare = 0, slowModeSecs = 0, defaultPermissions = PERMISSIONS.post, invites = [] }) {
      const g = newGroup(groupId);
      groups.set(groupId, g);
      addKey(g, 1, random(32), { signer: self });
      const state = {
        groupId, epoch: 1, version: 1, name, avatar: null, defaultPermissions, slowModeSecs, joinPolicy, historyShare,
        members: [{ account: self, role: ROLES.owner, permissions: ALL_PERMISSIONS, posting: [], joinedAt: createdAt },
          ...members.map((m) => ({ account: norm(m.account), role: m.role ?? ROLES.member, permissions: m.permissions ?? defaultPermissions, posting: m.posting ?? [], joinedAt: m.joinedAt ?? createdAt }))],
        invites, pinned: [], createdAt,
      };
      await postState(g, current(g), state);
      return welcomeFor(g);
    },

    // Timers: erase old keys and fork keys; rotate an admin's epoch after 7 days.
    async tick() {
      const t = now();
      for (const g of groups.values()) {
        for (const [e, ep] of g.epochs) if (ep.erasesAt != null && ep.erasesAt < t && e !== g.epoch) g.epochs.delete(e);
        for (const [e, ep] of g.forks) if (ep.erasesAt < t) g.forks.delete(e);
        if (g.status !== "member" || !can(selfMember(g), PERMISSIONS.remove)) continue;
        const ep = current(g);
        if (!ep || t - ep.openedAt < ROTATION_MS) continue;
        g.rotateAt ??= t + Math.floor(Math.random() * ROTATION_JITTER_MS);
        if (t >= g.rotateAt) await api.rotate(g.groupId).catch((e) => log("BOT_GROUP2_ROTATE_FAILED", { group: g.groupId, error: String(e?.message ?? e) }));
      }
      reindex();
    },

    // An allowlisted bot also talks to members of groups whose state lists an
    // admin it allows, and to a stranger whose join opener it accepted.
    admits(peerHex, allowed = isAllowed) {
      const peer = norm(peerHex);
      if (joinOpeners.has(peer)) return true;
      for (const g of groups.values()) {
        if (g.status !== "member" || !memberOf(g.state, peer)) continue;
        if (g.state.members.some((m) => m.role >= ROLES.admin && allowed(m.account))) return true;
      }
      return false;
    },

    contextFor(groupId) {
      const g = groups.get(groupId);
      return g?.state ? { name: g.state.name, size: g.state.members.length } : null;
    },

    snapshot: () => [...groups.values()].map((g) => ({
      id: g.groupId,
      e: g.epoch,
      k: [...g.epochs].map(([e, ep]) => ({ e, k: hexOf(ep.key), o: ep.openedAt, x: ep.erasesAt, s: ep.signer ?? null })),
      st: g.stateBytes ? hexOf(g.stateBytes) : null,
      ss: g.stateSigner,
      pw: g.pendingWelcome ? { ...g.pendingWelcome, stateHash: hexOf(g.pendingWelcome.stateHash) } : null,
      s: g.status,
      lk: g.locked,
      c: g.carry.map((c) => ({ o: hexOf(c.opaque), i: c.messageId, t: c.timestamp, at: c.sentAt, e: c.epoch })),
      ls: g.lastSentAt,
      h: g.history.slice(-100).map((x) => ({ f: x.from, i: x.messageId, t: x.timestamp, o: hexOf(x.opaque) })),
      ids: g.seen.slice(-SEEN_IDS),
      j: g.joinedAt,
      bv: g.botInfoVersion,
    })),

    restore(list) {
      for (const s of Array.isArray(list) ? list : []) {
        try {
          if (typeof s?.id !== "string" || !Array.isArray(s.k)) continue;
          const g = newGroup(s.id);
          g.joinedAt = Number(s.j ?? now());
          for (const k of s.k) g.epochs.set(k.e, { ...deriveEpoch(bytesOf(k.k), s.id, k.e), openedAt: k.o, erasesAt: k.x, signer: k.s });
          g.epoch = s.e;
          if (s.st) { g.stateBytes = bytesOf(s.st); g.state = decodeGroupState(g.stateBytes); g.stateSigner = s.ss; }
          if (s.pw) g.pendingWelcome = { ...s.pw, stateHash: bytesOf(s.pw.stateHash) };
          g.status = ["member", "removed", "pending"].includes(s.s) ? s.s : "pending";
          g.locked = !!s.lk;
          g.carry = (s.c ?? []).map((c) => ({ opaque: bytesOf(c.o), messageId: c.i, timestamp: c.t, sentAt: c.at, epoch: c.e }));
          g.lastSentAt = Number(s.ls ?? 0);
          g.botInfoVersion = Number(s.bv ?? 0);
          g.history = (s.h ?? []).map((x) => ({ from: x.f, messageId: x.i, timestamp: x.t, opaque: bytesOf(x.o) }));
          for (const id of s.ids ?? []) remember(g, id);
          groups.set(s.id, g);
        } catch (error) { log("BOT_GROUP2_RESTORE_SKIPPED", { group: s?.id, error: String(error?.message ?? error) }); }
      }
      trimGroups();
      reindex();
    },
  };

  // The admin's epoch change: K_{e+1}, an entry per remaining member with
  // K(admin, member), rekey on the old topic, the new state on the new one.
  const rekeyGroup = async (groupId, { remove = null }) => {
    const g = groups.get(groupId);
    const me = g?.state ? selfMember(g) : null;
    if (!me || !can(me, PERMISSIONS.remove)) return { ok: false, reason: "not-allowed" };
    if (remove) {
      const target = memberOf(g.state, remove);
      if (!target) return { ok: false, reason: "not-member" };
      if (target.role === ROLES.owner) return { ok: false, reason: "owner" };
      if (target.role >= ROLES.admin && me.role !== ROLES.owner) return { ok: false, reason: "owner-only" };
    }
    const old = current(g);
    const newEpoch = g.epoch + 1;
    const newKey = random(32);
    const remaining = g.state.members.filter((m) => m.account !== remove);
    const entries = [];
    const missing = [];
    for (const m of remaining) {
      const kab = await pairwiseKey(m.account);
      if (!kab) { missing.push(m.account); continue; }
      entries.push(makeRekeyEntry(kab, { groupId, newEpoch, newKey, nonce: random(12) }));
    }
    await submitData(g, old, old.channels.rekey, { rekey: { newEpoch, entries } });
    addKey(g, newEpoch, newKey, { signer: self });
    const state = { ...g.state, epoch: newEpoch, version: g.state.version + 1, members: remaining };
    await postState(g, current(g), state);
    log("BOT_GROUP2_EPOCH_OPENED", { group: groupId, epoch: newEpoch, removed: remove, entries: entries.length, ...(missing.length ? { missing } : {}) });
    return { ok: true, epoch: newEpoch, entries: entries.length, missing };
  };

  return api;
};
