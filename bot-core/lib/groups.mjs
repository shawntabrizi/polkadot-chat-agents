// Spec 0009 fan-out groups (polkadot-chat-desktop docs/spec/0009-groups.md):
// the bot as one member of a small room built on pairwise sessions.
//
// This module owns the rules; index.mjs owns the wire. It keeps, per group:
// the roster of the highest version seen from the admin, the members that
// sent a groupLeave since, the bot's own per-group `seq`, each sender's last
// `seq` (a gap is logged once) and recent envelope ids (two copies of one
// message through two paths count once). Rules:
//   - a groupInfo is applied only from the admin, and only when its version
//     is higher; a first groupInfo is accepted only from the admin it names;
//   - a roster without the bot marks the group `removed`: the bot stops
//     sending to it and drops its messages;
//   - a groupMessage from an account not in the roster (or that left) is
//     rejected;
//   - the bot fans a message out to every other member of its roster, with
//     ONE envelope id and timestamp for all copies and the next `seq`.
//     Ephemeral content (typing) carries the current `seq` and does not
//     advance it, so a receiver that never stores typing sees no gap.
//
// Kept apart from index.mjs so the rules run in memory in the tests.
import { encodeOpaqueGroupMessage } from "../vendor/app-chat-codec.mjs";

const norm = (hex) => String(hex ?? "").trim().replace(/^0x/i, "").toLowerCase();
const SEEN_IDS_PER_GROUP = 200;
export const GROUP_SESSION_PREFIX = "group:";
export const groupSessionKey = (groupId) => `${GROUP_SESSION_PREFIX}${String(groupId).toLowerCase()}`;

export const createGroups = ({
  selfHex,
  deliver,          // async (peerHex, opaque, { messageId, ephemeral }) -> void; opens a session when needed
  makeId,           // () -> envelope id
  now = () => Date.now(),
  log = () => {},
  maxGroups = 200,
}) => {
  const self = norm(selfHex);
  const groups = new Map(); // groupId -> group

  const memberOf = (group, peerHex) => group.members.find((m) => m.accountHex === norm(peerHex)) ?? null;
  const activeMember = (group, peerHex) => {
    const member = memberOf(group, peerHex);
    return member && !group.left.has(member.accountHex) ? member : null;
  };
  const rosterFrom = (info) => info.members.map((m) => ({
    accountHex: norm(m.accountHex ?? m.account),
    username: String(m.username ?? ""),
    joinedAt: Number(m.joinedAt ?? 0),
  }));
  const trimGroups = () => {
    while (groups.size > maxGroups) groups.delete(groups.keys().next().value);
  };

  const api = {
    get: (groupId) => groups.get(groupId) ?? null,
    list: () => [...groups.values()],

    // A groupInfo from `fromHex`. Returns the outcome: joined | updated |
    // removed | stale | not-admin | not-listed.
    applyInfo(fromHex, info) {
      const from = norm(fromHex);
      const admin = norm(info.adminHex ?? info.admin);
      const existing = groups.get(info.groupId);
      if (existing) {
        if (from !== existing.adminHex || admin !== existing.adminHex) return "not-admin";
        if (info.version <= existing.version) return "stale";
      } else {
        if (from !== admin) return "not-admin";
        if (!info.members.some((m) => norm(m.accountHex ?? m.account) === self)) return "not-listed";
      }
      const members = rosterFrom(info);
      const listed = members.some((m) => m.accountHex === self);
      const group = {
        groupId: info.groupId,
        name: info.name,
        adminHex: admin,
        members,
        version: info.version,
        createdAt: Number(info.createdAt ?? 0),
        status: listed ? "member" : "removed",
        // The admin's new roster already reflects every leave it has seen.
        left: new Set(),
        seq: existing?.seq ?? 0,
        lastSeq: existing?.lastSeq ?? new Map(),
        gaps: existing?.gaps ?? new Set(),
        seenIds: existing?.seenIds ?? [],
      };
      groups.delete(info.groupId);
      groups.set(info.groupId, group);
      trimGroups();
      if (!existing) return "joined";
      return listed ? "updated" : "removed";
    },

    // A groupLeave from `fromHex`: that member no longer receives the fan-out.
    applyLeave(fromHex, groupId) {
      const group = groups.get(groupId);
      if (!group) return "unknown-group";
      const member = memberOf(group, fromHex);
      if (!member) return "non-member";
      if (group.left.has(member.accountHex)) return "duplicate";
      group.left.add(member.accountHex);
      return "left";
    },

    // A groupMessage from `fromHex`: { ok, reason?, group?, sender?, gap? }.
    acceptMessage(fromHex, m) {
      const group = groups.get(m.groupId);
      if (!group) return { ok: false, reason: "unknown-group" };
      if (group.status !== "member") return { ok: false, reason: "removed" };
      const sender = activeMember(group, fromHex);
      if (!sender) return { ok: false, reason: "non-member" };
      if (m.messageId && group.seenIds.includes(m.messageId)) return { ok: false, reason: "duplicate" };
      if (m.messageId) {
        group.seenIds.push(m.messageId);
        if (group.seenIds.length > SEEN_IDS_PER_GROUP) group.seenIds.shift();
      }
      const last = group.lastSeq.get(sender.accountHex);
      let gap = false;
      if (last != null && m.seq > last + 1 && !group.gaps.has(sender.accountHex)) {
        gap = true;
        group.gaps.add(sender.accountHex);
      }
      if (last == null || m.seq > last) group.lastSeq.set(sender.accountHex, m.seq);
      return { ok: true, group, sender, gap };
    },

    // Every other active member: where the bot's copies go. Empty when the
    // bot is no longer in the roster.
    targets(groupId) {
      const group = groups.get(groupId);
      if (!group || group.status !== "member") return [];
      return group.members
        .map((m) => m.accountHex)
        .filter((hex) => hex !== self && !group.left.has(hex));
    },

    // For the persona hint: { name, size } or null. Takes the group id or
    // its session key (the agent runtime lowercases keys).
    contextFor(groupIdOrKey) {
      const key = String(groupIdOrKey ?? "").toLowerCase();
      const group = groups.get(groupIdOrKey)
        ?? [...groups.values()].find((g) => groupSessionKey(g.groupId) === key);
      return group ? { name: group.name, size: group.members.length } : null;
    },

    // Fan one content (an opaque message from any non-group encoder) out to
    // the roster. One envelope id and timestamp for every copy. Resolves
    // { messageId, seq, to, failed }; never throws for one member's failure.
    async send(groupId, inner, { ephemeral = false, messageId = makeId(), timestamp = now() } = {}) {
      const group = groups.get(groupId);
      const to = api.targets(groupId);
      if (!group || to.length === 0) {
        log("BOT_GROUP_SEND_SKIPPED", { group: groupId, reason: !group ? "unknown-group" : group.status !== "member" ? "removed" : "no-members" });
        return { messageId: null, seq: null, to: [], failed: [] };
      }
      if (!ephemeral) group.seq += 1;
      const opaque = encodeOpaqueGroupMessage({
        messageId,
        timestamp,
        groupId,
        infoVersion: group.version,
        seq: group.seq,
        content: inner,
      });
      const results = await Promise.allSettled(to.map((peerHex) => deliver(peerHex, opaque, { messageId, ephemeral })));
      const failed = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          failed.push(to[i]);
          log("BOT_GROUP_SEND_FAILED", { group: groupId, to: to[i], messageId, error: String(r.reason?.message ?? r.reason) });
        }
      });
      return { messageId, seq: group.seq, to, failed };
    },

    snapshot: () => [...groups.values()].map((g) => ({
      id: g.groupId,
      n: g.name,
      a: g.adminHex,
      m: g.members.map((m) => ({ a: m.accountHex, u: m.username, j: m.joinedAt })),
      v: g.version,
      c: g.createdAt,
      st: g.status,
      ...(g.left.size ? { l: [...g.left] } : {}),
      q: g.seq,
      ...(g.lastSeq.size ? { ls: Object.fromEntries(g.lastSeq) } : {}),
      ...(g.seenIds.length ? { ids: g.seenIds.slice(-SEEN_IDS_PER_GROUP) } : {}),
    })),

    restore(list) {
      for (const s of Array.isArray(list) ? list : []) {
        try {
          if (typeof s?.id !== "string" || typeof s.n !== "string" || !Array.isArray(s.m) || !Number.isInteger(s.v)) continue;
          groups.set(s.id, {
            groupId: s.id,
            name: s.n,
            adminHex: norm(s.a),
            members: s.m.map((m) => ({ accountHex: norm(m.a), username: String(m.u ?? ""), joinedAt: Number(m.j ?? 0) })),
            version: s.v,
            createdAt: Number(s.c ?? 0),
            status: s.st === "removed" ? "removed" : "member",
            left: new Set(Array.isArray(s.l) ? s.l.map(norm) : []),
            seq: Number.isSafeInteger(s.q) ? s.q : 0,
            lastSeq: new Map(Object.entries(s.ls ?? {}).filter(([, v]) => Number.isSafeInteger(v))),
            gaps: new Set(),
            seenIds: Array.isArray(s.ids) ? s.ids.filter((x) => typeof x === "string") : [],
          });
        } catch (error) { log("BOT_GROUP_RESTORE_SKIPPED", { group: s?.id, error: String(error?.message ?? error) }); }
      }
      trimGroups();
    },

    // An allowlisted bot also talks to the members of a group whose admin
    // it allows: true when `peerHex` is an active member of such a group.
    admits(peerHex, isAllowed) {
      for (const group of groups.values()) {
        if (group.status === "member" && isAllowed(group.adminHex) && activeMember(group, peerHex)) return true;
      }
      return false;
    },
  };
  return api;
};
