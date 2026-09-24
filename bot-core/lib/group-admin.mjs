// Spec 0011 reviewer rulings 6 and 7 (polkadot-chat-desktop
// docs/spec/0011-groups-v2.md): the bot as a group admin that people drive
// over their DM session with it. No new wire variant: commands are plain
// text, the owner's approval is a spec 0006 buttons message and its press.
//
//   /remove <username>           rekey without the member (2 statements)
//   /pin <text or messageId>     add a pin (1 state statement)
//   /unpin [text or messageId]   drop that pin, or the newest one
//   /slowmode <seconds>          0 turns it off
//   /promote <username>          a member becomes an admin
//   /invite                      a fresh invite link, held in the state
//   /revoke-invite [link or id]  drop that invite, or every invite
//
// Each command takes an optional trailing "in <group name>"; it is needed
// only when the sender shares more than one group with the bot. The sender's
// role and flags are checked in the current state with the same 0011 rules a
// receiver applies to the bot's statement (lib/groups-v2.mjs changeState),
// and the bot's own role and flags are checked too.
//
// Join policy 1 (ruling 6): a join request (the capability in a chat request
// opener, or a joinRequest control) is answered "pending" to the joiner and
// forwarded to the group's owner as "X wants to join G" with Approve / Reject
// callback buttons. A press from that owner (still an owner, or an admin with
// `approve joins`) admits (state + welcome) or rejects (joinDecision). An
// unanswered request expires after 24 h and the joiner gets a rejection.
//
// Pure logic over injected I/O, so every path runs in memory in the tests.
import crypto from "node:crypto";
import { PERMISSIONS, ROLES, GROUP_BOUNDS, encodeInviteLink, inviteLinkFromBase64Url, inviteLinkToBase64Url, decodeInviteLink } from "./group-codec.mjs";

export const JOIN_REQUEST_TTL_MS = 86_400_000;
export const MAX_SLOW_MODE_SECS = 86_400;
// A promoted admin gets every flag but `manage admins`: only the owner, or
// an admin the owner trusts with that flag, makes more admins.
export const PROMOTED_ADMIN_PERMISSIONS = 0x00ff & ~PERMISSIONS.admins;
const PENDING_CAP = 500;
const COMMAND_RE = /^\s*\/(remove|pin|unpin|slowmode|promote|invite|revoke-invite)(?:\s+([\s\S]*?))?\s*$/i;
const PRESS_RE = /^grpjoin:([0-9a-f]{16}):(approve|reject)$/;

const norm = (hex) => String(hex ?? "").trim().replace(/^0x/i, "").toLowerCase();
const hexOf = (b) => (typeof b === "string" ? norm(b) : Buffer.from(b).toString("hex"));
const te = new TextEncoder();
const td = new TextDecoder();

// Why a change was refused, in words a person reads in chat.
const REFUSALS = {
  "not-admin": "only an admin can do that",
  "not-allowed": "that needs the permission for it",
  "no-add": "adding people needs the add-members permission",
  "no-remove": "removing people needs the remove-members permission",
  "no-admins": "that needs the manage-admins permission",
  "owner-only": "only the owner can do that to an admin",
  "no-info": "that needs the change-info permission",
  "no-pin": "pinning needs the pin permission",
  "no-invites": "invites need the add-members permission",
  owner: "nobody can remove the owner",
  "not-member": "that person is not in the group",
};
const refusal = (reason, who) => {
  const why = REFUSALS[reason] ?? reason;
  return who === "bot" ? `I can't: ${why}, and I don't have it in this group.` : `Refused: ${why}.`;
};

export const isGroupAdminCommand = (text) => COMMAND_RE.test(String(text ?? ""));

export const createGroupAdmin = ({
  groupsV2,
  selfHex,
  accountOf = async () => null,  // async (username) -> account hex | null (People directory)
  usernameOf = async () => null, // async (accountHex) -> username | null
  sendButtons,                   // async (peerHex, text, rows) -> messageId (a spec 0006 buttons message over DM)
  now = () => Date.now(),
  random = (n) => new Uint8Array(crypto.randomBytes(n)),
  log = () => {},
}) => {
  const self = norm(selfHex);
  const pending = new Map(); // request id -> { id, groupId, from, inviteId, proof, note, to, messageId, expiresAt }

  const nameOf = async (accountHex) => (await usernameOf(accountHex).catch(() => null)) ?? `${norm(accountHex).slice(0, 8)}…`;
  const groupName = (g) => g.state.name || "the group";
  // Groups the sender and the bot are both in.
  const shared = (peer) => groupsV2.list().filter((g) => g.status === "member" && g.state?.members.some((m) => m.account === peer));

  // "<rest> in <group name>" -> { group, rest }, or { reply } when no group fits.
  const pickGroup = (peer, args) => {
    const groups = shared(peer);
    const m = /^(.*?)\s*\bin\s+(.+)$/is.exec(args);
    if (m) {
      const wanted = m[2].trim().toLowerCase();
      const hit = groups.filter((g) => (g.state.name ?? "").trim().toLowerCase() === wanted);
      if (hit.length === 1) return { group: hit[0], rest: m[1].trim() };
    }
    if (groups.length === 1) return { group: groups[0], rest: args };
    if (groups.length === 0) return { reply: "We share no private group, so there is nothing I can change for you." };
    return { reply: `We share ${groups.length} groups: ${groups.map(groupName).join(", ")}. Add "in <group name>" to the command.` };
  };

  // A username (or a 0x account) -> a member of the group, or a reply.
  const findMember = async (g, who) => {
    const name = String(who ?? "").trim().replace(/^@/, "");
    if (!name) return { reply: "Give a username." };
    let account = /^(0x)?[0-9a-f]{64}$/i.test(name) ? norm(name) : norm(await accountOf(name).catch(() => null));
    if (!account || !g.state.members.some((m) => m.account === account)) {
      // The directory may not know a bare name: match the members' usernames.
      for (const m of g.state.members) {
        const u = (await usernameOf(m.account).catch(() => null)) ?? "";
        if (u.toLowerCase() === name.toLowerCase() || u.toLowerCase().split(".")[0] === name.toLowerCase()) { account = m.account; break; }
      }
    }
    const member = g.state.members.find((m) => m.account === account);
    return member ? { member, label: name } : { reply: `${name} is not in ${groupName(g)}.` };
  };

  const stateReply = async (res, okText) => (res.ok ? okText : refusal(res.reason, res.who));

  const commands = {
    async remove(peer, g, rest) {
      const found = await findMember(g, rest);
      if (found.reply) return found.reply;
      if (found.member.account === self) return "I can't remove myself. The owner can remove me.";
      const res = await groupsV2.remove(g.groupId, found.member.account, { by: peer });
      log("BOT_GROUP2_CMD_REMOVE", { group: g.groupId, by: peer, member: found.member.account, ok: res.ok, ...(res.ok ? { epoch: res.epoch } : { reason: res.reason }) });
      return res.ok ? `Removed ${found.label} from ${groupName(g)}. The group has a new key (epoch ${res.epoch}); ${found.label} cannot read new messages.` : refusal(res.reason, res.who);
    },
    async pin(peer, g, rest) {
      if (!rest) return "Usage: /pin <text or messageId>";
      const hit = groupsV2.findMessage(g.groupId, rest);
      if (!hit) return `I found no message with "${rest}" in ${groupName(g)}.`;
      if (g.state.pinned.includes(hit.messageId)) return "That message is already pinned.";
      if (g.state.pinned.length >= GROUP_BOUNDS.pinned) return `${groupName(g)} has ${GROUP_BOUNDS.pinned} pins already. /unpin one first.`;
      const res = await groupsV2.changeState(g.groupId, peer, (s) => ({ ...s, pinned: [...s.pinned, hit.messageId] }));
      log("BOT_GROUP2_CMD_PIN", { group: g.groupId, by: peer, messageId: hit.messageId, ok: res.ok, ...(res.ok ? {} : { reason: res.reason }) });
      return stateReply(res, `Pinned in ${groupName(g)}: "${hit.text.slice(0, 80)}"`);
    },
    async unpin(peer, g, rest) {
      if (!g.state.pinned.length) return `${groupName(g)} has no pins.`;
      let id = g.state.pinned.at(-1);
      if (rest) {
        const hit = g.state.pinned.includes(rest) ? { messageId: rest } : groupsV2.findMessage(g.groupId, rest);
        if (!hit || !g.state.pinned.includes(hit.messageId)) return `No pinned message matches "${rest}".`;
        id = hit.messageId;
      }
      const res = await groupsV2.changeState(g.groupId, peer, (s) => ({ ...s, pinned: s.pinned.filter((x) => x !== id) }));
      log("BOT_GROUP2_CMD_UNPIN", { group: g.groupId, by: peer, messageId: id, ok: res.ok, ...(res.ok ? {} : { reason: res.reason }) });
      return stateReply(res, `Unpinned in ${groupName(g)}.`);
    },
    async slowmode(peer, g, rest) {
      if (!/^\d+$/.test(rest) || Number(rest) > MAX_SLOW_MODE_SECS) return `Usage: /slowmode <seconds>, 0 to ${MAX_SLOW_MODE_SECS} (0 turns it off).`;
      const secs = Number(rest);
      if (secs === g.state.slowModeSecs) return `Slow mode in ${groupName(g)} is already ${secs ? `${secs} s` : "off"}.`;
      const res = await groupsV2.changeState(g.groupId, peer, (s) => ({ ...s, slowModeSecs: secs }));
      log("BOT_GROUP2_CMD_SLOWMODE", { group: g.groupId, by: peer, secs, ok: res.ok, ...(res.ok ? {} : { reason: res.reason }) });
      return stateReply(res, secs ? `Slow mode in ${groupName(g)}: members can send one message every ${secs} s.` : `Slow mode in ${groupName(g)} is off.`);
    },
    async promote(peer, g, rest) {
      const found = await findMember(g, rest);
      if (found.reply) return found.reply;
      if (found.member.role >= ROLES.admin) return `${found.label} is already an admin.`;
      const target = found.member.account;
      const res = await groupsV2.changeState(g.groupId, peer, (s) => ({
        ...s,
        members: s.members.map((m) => (m.account === target ? { ...m, role: ROLES.admin, permissions: m.permissions | PROMOTED_ADMIN_PERMISSIONS } : m)),
      }));
      log("BOT_GROUP2_CMD_PROMOTE", { group: g.groupId, by: peer, member: target, ok: res.ok, ...(res.ok ? {} : { reason: res.reason }) });
      return stateReply(res, `${found.label} is now an admin of ${groupName(g)}.`);
    },
    async invite(peer, g) {
      if (g.state.invites.length >= GROUP_BOUNDS.invites) return `${groupName(g)} has ${GROUP_BOUNDS.invites} invites already. /revoke-invite first.`;
      const invite = { inviteId: hexOf(random(16)), secret: hexOf(random(16)), createdBy: peer, expiresAt: 0, maxUses: 0, uses: 0 };
      const res = await groupsV2.changeState(g.groupId, peer, (s) => ({ ...s, invites: [...s.invites, invite] }));
      log("BOT_GROUP2_CMD_INVITE", { group: g.groupId, by: peer, ok: res.ok, ...(res.ok ? { inviteId: invite.inviteId.slice(0, 8) } : { reason: res.reason }) });
      if (!res.ok) return refusal(res.reason, res.who);
      // The bot is listed first: it is always online to admit (0011 Joining).
      const admins = [self, ...(peer !== self && groupsV2.can(g.groupId, peer, PERMISSIONS.approve) ? [peer] : [])];
      const link = inviteLinkToBase64Url(encodeInviteLink({ groupId: g.groupId, name: g.state.name, admins, inviteId: invite.inviteId, secret: invite.secret }));
      const policy = g.state.joinPolicy === 0
        ? "\nNote: the join policy is \"admins add only\", so requests by link are refused until an admin allows links."
        : g.state.joinPolicy === 1 ? "\nThe owner approves each request." : "\nAnyone with the link joins at once.";
      return `Invite link for ${groupName(g)}. Anyone who has it can ask to join; /revoke-invite stops it.\ng#${link}${policy}`;
    },
    async "revoke-invite"(peer, g, rest) {
      if (!g.state.invites.length) return `${groupName(g)} has no invites.`;
      let ids = g.state.invites.map((i) => i.inviteId);
      if (rest) {
        const id = inviteIdFrom(rest);
        if (!id || !ids.includes(id)) return "No invite of this group matches that.";
        ids = [id];
      }
      const drop = new Set(ids);
      const res = await groupsV2.changeState(g.groupId, peer, (s) => ({ ...s, invites: s.invites.filter((i) => !drop.has(i.inviteId)) }));
      log("BOT_GROUP2_CMD_REVOKE_INVITE", { group: g.groupId, by: peer, invites: ids.length, ok: res.ok, ...(res.ok ? {} : { reason: res.reason }) });
      return stateReply(res, `Revoked ${ids.length === 1 ? "1 invite" : `${ids.length} invites`} of ${groupName(g)}. Those links no longer work.`);
    },
  };

  // An invite link (g#<b64>), a bare base64url link, or an inviteId (hex or base64url).
  const inviteIdFrom = (text) => {
    const s = String(text).trim().replace(/^.*g#/, "");
    try { return decodeInviteLink(inviteLinkFromBase64Url(s)).inviteId; } catch { /* not a link */ }
    if (/^[0-9a-f]{32}$/i.test(s)) return s.toLowerCase();
    const b = Buffer.from(s, "base64url");
    return b.length === 16 ? b.toString("hex") : null;
  };

  // Forward a pending request to the owner (or, when the bot is the owner,
  // the first other admin that approves joins).
  const forward = async (g, from, req) => {
    const owner = g.state.members.find((m) => m.role === ROLES.owner);
    const to = owner && owner.account !== self ? owner.account
      : g.state.members.find((m) => m.account !== self && groupsV2.can(g.groupId, m.account, PERMISSIONS.approve))?.account;
    if (!to) { log("BOT_GROUP2_JOIN_NO_APPROVER", { group: g.groupId, from }); return "no-approver"; }
    const id = hexOf(random(8));
    const who = await nameOf(from);
    const note = String(req.note ?? "").trim();
    const text = `${who} wants to join ${groupName(g)}.${note ? `\nNote: ${note}` : ""}\nThis request expires in 24 hours.`;
    const rows = [[
      { label: "Approve", action: { callback: te.encode(`grpjoin:${id}:approve`) } },
      { label: "Reject", action: { callback: te.encode(`grpjoin:${id}:reject`) } },
    ]];
    const entry = { id, groupId: g.groupId, from, inviteId: hexOf(req.inviteId), proof: hexOf(req.proof), note, to, messageId: null, expiresAt: now() + JOIN_REQUEST_TTL_MS };
    pending.set(id, entry);
    while (pending.size > PENDING_CAP) pending.delete(pending.keys().next().value);
    try { entry.messageId = await sendButtons(to, text, rows); }
    catch (e) { pending.delete(id); throw e; }
    log("BOT_GROUP2_JOIN_FORWARDED", { group: g.groupId, from, to, request: id });
    return "forwarded";
  };
  const requestOf = (p) => ({ groupId: p.groupId, inviteId: Uint8Array.from(Buffer.from(p.inviteId, "hex")), proof: Uint8Array.from(Buffer.from(p.proof, "hex")), note: p.note });

  return {
    isCommand: isGroupAdminCommand,

    // A command from `peerHex` over DM -> the reply text.
    async command(peerHex, text) {
      const m = COMMAND_RE.exec(String(text ?? ""));
      if (!m) return null;
      const peer = norm(peerHex);
      const name = m[1].toLowerCase();
      const picked = pickGroup(peer, (m[2] ?? "").trim());
      if (picked.reply) return picked.reply;
      try { return await commands[name](peer, picked.group, picked.rest); }
      catch (e) {
        log("BOT_GROUP2_CMD_FAILED", { command: name, by: peer, group: picked.group.groupId, error: String(e?.message ?? e) });
        return `That did not work: ${String(e?.message ?? e)}`;
      }
    },

    // A join request (a joinRequest control, or the capability in an
    // opener). Policy 1: pending to the joiner and Approve/Reject to the owner.
    async joinRequest(fromHex, req) {
      const from = norm(fromHex);
      for (const p of pending.values()) if (p.groupId === req.groupId && p.from === from) return "already-pending";
      const outcome = await groupsV2.joinRequest(from, req);
      if (outcome !== "pending") return outcome;
      return forward(groupsV2.get(req.groupId), from, req);
    },

    // Is this press for one of our forwarded join requests?
    ownsPress: (peerHex, messageId) => [...pending.values()].some((p) => p.to === norm(peerHex) && p.messageId === messageId),

    // The approver pressed Approve or Reject -> the reply text for them.
    async press(peerHex, { targetMessageId, payload }) {
      const peer = norm(peerHex);
      const m = PRESS_RE.exec(td.decode(payload ?? new Uint8Array()));
      const p = m ? pending.get(m[1]) : null;
      if (!p || p.to !== peer || p.messageId !== targetMessageId || p.expiresAt <= now()) return "This join request is no longer open.";
      const g = groupsV2.get(p.groupId);
      const approver = groupsV2.member(p.groupId, peer);
      if (!g?.state || !approver || !(approver.role === ROLES.owner || groupsV2.can(p.groupId, peer, PERMISSIONS.approve))) {
        return "You can no longer approve requests for this group.";
      }
      pending.delete(p.id);
      const who = await nameOf(p.from);
      if (m[2] === "reject") {
        await groupsV2.rejectJoin(p.from, requestOf(p));
        log("BOT_GROUP2_JOIN_REJECTED", { group: p.groupId, from: p.from, by: peer });
        return `Rejected ${who}.`;
      }
      const outcome = await groupsV2.joinRequest(p.from, requestOf(p), { approved: true });
      log("BOT_GROUP2_JOIN_APPROVED", { group: p.groupId, from: p.from, by: peer, outcome });
      return outcome === "admitted" ? `${who} joined ${groupName(g)}.` : `${who} was not admitted: ${outcome}.`;
    },

    // Requests unanswered for 24 h expire; the joiner is told no.
    async tick() {
      const t = now();
      for (const p of [...pending.values()]) {
        if (p.expiresAt > t) continue;
        pending.delete(p.id);
        log("BOT_GROUP2_JOIN_EXPIRED", { group: p.groupId, from: p.from });
        await groupsV2.rejectJoin(p.from, requestOf(p)).catch((e) => log("BOT_GROUP2_JOIN_EXPIRE_FAILED", { group: p.groupId, error: String(e?.message ?? e) }));
      }
    },

    pending: () => [...pending.values()],
    snapshot: () => [...pending.values()].map((p) => ({ ...p })),
    restore(list) {
      for (const p of Array.isArray(list) ? list : []) {
        if (typeof p?.id === "string" && typeof p.groupId === "string" && typeof p.from === "string" && typeof p.to === "string") pending.set(p.id, { ...p });
      }
    },
  };
};
