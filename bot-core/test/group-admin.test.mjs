// Spec 0011 rulings 6 and 7 in memory: people drive an admin bot over DM
// (lib/group-admin.mjs). Why each case matters:
//   - the bot signs every change, so a command must pass the 0011 rules for
//     the SENDER (else any member could use the bot to act as an admin) and
//     for the BOT (else the other members refuse the bot's statement);
//   - what the bot posts must be a state the other members apply, and a
//     removal must lock the removed member out of the next epoch;
//   - a policy-1 join waits for the owner's press on the buttons message the
//     bot sent to that owner, and nobody else's press admits anyone;
//   - an unanswered request ends after 24 h with a rejection to the joiner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroupAdmin, isGroupAdminCommand, JOIN_REQUEST_TTL_MS, PROMOTED_ADMIN_PERMISSIONS } from "../lib/group-admin.mjs";
import { PERMISSIONS, ROLES, decodeInviteLink, inviteLinkFromBase64Url } from "../lib/group-codec.mjs";
import { joinProof } from "../lib/group-keys.mjs";
import { decodeOpaqueMessageAt } from "../vendor/app-chat-codec.mjs";
import { ACCOUNTS, GROUP, hex, setup, text } from "./fixtures/group-world.mjs";

const NAMES = { alice: "alice.01", bob: "bob.02", bot: "adminbot.03", carol: "carol.04", dave: "dave.05" };
const byAccount = Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [ACCOUNTS[k], v]));
const BOT_ADMIN = { role: ROLES.admin, permissions: 0x00ff };

// The world of test/groups-v2.test.mjs plus the admin module on the bot.
const adminWorld = async ({ bot = BOT_ADMIN, state = {}, members } = {}) => {
  const world = await setup({ bot, state });
  const { w } = world;
  const buttons = []; // { to, text, rows, messageId }
  let n = 0;
  const admin = createGroupAdmin({
    groupsV2: world.bot.groups,
    selfHex: ACCOUNTS.bot,
    accountOf: async (name) => Object.entries(byAccount).find(([, v]) => v === name)?.[0] ?? null,
    usernameOf: async (account) => byAccount[account] ?? null,
    sendButtons: async (to, body, rows) => { const messageId = `BTN-${++n}`; buttons.push({ to, text: body, rows, messageId }); return messageId; },
    now: () => w.clock.t,
  });
  if (members) for (const m of members) await world.alice.groups.add(GROUP, ACCOUNTS[m.name], m);
  await world.bot.sync();
  return { ...world, admin, buttons };
};
const state = (p) => p.groups.get(GROUP).state;
const submissionsDuring = async (w, fn) => { const before = w.submissions.length; const out = await fn(); return { out, count: w.submissions.length - before }; };
const pressOf = (b, label) => {
  const i = b.rows[0].findIndex((x) => x.label === label);
  return { targetMessageId: b.messageId, row: 0, index: i, payload: b.rows[0][i].action.callback };
};
const joinReq = (who, invite) => ({ groupId: GROUP, inviteId: Buffer.from(invite.inviteId, "hex"), proof: joinProof(invite.secret, ACCOUNTS[who]), note: "" });
const INVITE = { inviteId: "5a".repeat(16), secret: "6b".repeat(16), createdBy: ACCOUNTS.alice, expiresAt: 0, maxUses: 0, uses: 0 };

test("only the admin command words are commands; ordinary text stays with the brain", () => {
  for (const t of ["/remove bob", "/pin hello there", "/unpin", "/slowmode 10", "/promote bob", "/invite", "/revoke-invite", " /REMOVE bob in Test group "]) assert.equal(isGroupAdminCommand(t), true, t);
  for (const t of ["/removeall", "remove bob", "/help", "/pinned", "please /remove bob"]) assert.equal(isGroupAdminCommand(t), false, t);
});

test("/remove from the owner: 2 statements, the member is out and cannot read the next epoch; the others follow", async () => {
  const { w, alice, bob, bot, admin } = await adminWorld();
  const { out, count } = await submissionsDuring(w, () => admin.command(alice.account, "/remove bob.02"));
  assert.match(out, /^Removed bob\.02 from Test group\. The group has a new key \(epoch 2\)/);
  assert.equal(count, 2, "rekey on the old topic + state on the new one");
  assert.equal(state(bot).members.some((m) => m.account === bob.account), false);
  await alice.sync();
  assert.equal(alice.groups.get(GROUP).epoch, 2, "the owner applies the bot's rekey and state");
  assert.ok((await bob.sync()).some((r) => r.outcome === "no-entry"), "bob finds no entry for him");
  w.clock.t += 2000;
  await alice.groups.send(GROUP, [text("AFTER", w.clock.t, "after bob")]);
  assert.equal(bob.groups.get(GROUP).epoch, 1);
  assert.equal(bob.groups.topics().some((t) => hex(t) === hex(alice.groups.get(GROUP).epochs.get(2).topic)), false, "bob cannot even find epoch 2's topic");
});

test("/remove is refused for a plain member, for an admin removing an admin, for the owner as target and when the bot lacks the flag", async () => {
  // dave is an admin with remove members, carol a plain member.
  const { w, bob, admin, bot } = await adminWorld({ members: [{ name: "dave", role: ROLES.admin, permissions: PERMISSIONS.post | PERMISSIONS.remove }, { name: "carol" }] });
  const count0 = w.submissions.length;
  assert.equal(await admin.command(bob.account, "/remove carol.04"), "Refused: removing people needs the remove-members permission.");
  assert.equal(await admin.command(ACCOUNTS.dave, "/remove adminbot.03"), "I can't remove myself. The owner can remove me.");
  assert.equal(await admin.command(ACCOUNTS.dave, "/remove alice.01"), "Refused: only the owner can do that to an admin.");
  assert.equal(await admin.command(ACCOUNTS.dave, "/remove nobody.99"), "nobody.99 is not in Test group.");
  assert.equal(w.submissions.length, count0, "no refused command costs a statement");
  // An admin with the flag removes a plain member; a bare name (no digits) works too.
  assert.match(await admin.command(ACCOUNTS.dave, "/remove carol"), /^Removed carol from Test group/);
  assert.equal(state(bot).members.some((m) => m.account === ACCOUNTS.carol), false);

  const weak = await adminWorld({ bot: { role: ROLES.admin, permissions: PERMISSIONS.post | PERMISSIONS.pin } });
  assert.equal(await weak.admin.command(weak.alice.account, "/remove bob.02"), "I can't: removing people needs the remove-members permission, and I don't have it in this group.");
});

test("a sender in two groups with the bot names the group with 'in <group name>'", async () => {
  const { alice, bob, bot, admin } = await adminWorld();
  const second = await alice.groups.create({ groupId: "0b7e2c1a-0000-4000-8000-0000000000b2", name: "Second", members: [{ account: bob.account }, { account: bot.account, ...BOT_ADMIN }] });
  bot.groups.welcome(alice.account, second.welcome);
  await bot.sync();
  assert.match(await admin.command(alice.account, "/slowmode 10"), /^We share 2 groups: Test group, Second\. Add "in <group name>"/);
  assert.match(await admin.command(alice.account, "/slowmode 10 in second"), /^Slow mode in Second: /);
  assert.equal(bot.groups.get("0b7e2c1a-0000-4000-8000-0000000000b2").state.slowModeSecs, 10);
  assert.equal(state(bot).slowModeSecs, 0, "the other group is untouched");
  assert.match(await admin.command(ACCOUNTS.carol, "/slowmode 10"), /^We share no private group/);
});

test("/pin and /unpin: one state statement each, applied by every member; a plain member is refused", async () => {
  const { w, alice, bob, bot, admin } = await adminWorld();
  await alice.groups.send(GROUP, [text("MSG-1", w.clock.t, "Meeting moved to Friday")]);
  await bot.sync();
  const refused = await submissionsDuring(w, () => admin.command(bob.account, "/pin friday"));
  assert.equal(refused.out, "Refused: only an admin can do that.");
  assert.equal(refused.count, 0);
  const { out, count } = await submissionsDuring(w, () => admin.command(alice.account, "/pin friday"));
  assert.equal(out, 'Pinned in Test group: "Meeting moved to Friday"');
  assert.equal(count, 1);
  for (const p of [alice, bob]) {
    assert.ok((await p.sync()).some((r) => r.outcome === "applied"), `${p.name} applies the bot's state`);
    assert.deepEqual(state(p).pinned, ["MSG-1"]);
  }
  assert.equal(await admin.command(alice.account, "/pin MSG-1"), "That message is already pinned.");
  assert.match(await admin.command(alice.account, "/pin nothing like this"), /^I found no message/);
  assert.equal(await admin.command(alice.account, "/unpin"), "Unpinned in Test group.");
  await bob.sync();
  assert.deepEqual(state(bob).pinned, []);
  assert.equal(await admin.command(alice.account, "/unpin"), "Test group has no pins.");
});

test("/slowmode: the change-info flag for sender and bot; members hold the new limit", async () => {
  const { w, alice, bob, bot, admin } = await adminWorld();
  assert.equal(await admin.command(bob.account, "/slowmode 10"), "Refused: only an admin can do that.");
  assert.match(await admin.command(alice.account, "/slowmode ten"), /^Usage: \/slowmode <seconds>/);
  const { out, count } = await submissionsDuring(w, () => admin.command(alice.account, "/slowmode 10"));
  assert.equal(out, "Slow mode in Test group: members can send one message every 10 s.");
  assert.equal(count, 1);
  await bob.sync();
  assert.equal(state(bob).slowModeSecs, 10, "members hold the new limit");
  assert.equal(await admin.command(alice.account, "/slowmode 10"), "Slow mode in Test group is already 10 s.");
  assert.equal(await admin.command(alice.account, "/slowmode 0"), "Slow mode in Test group is off.");
  assert.equal(state(bot).slowModeSecs, 0);

  const noInfo = await adminWorld({ bot: { role: ROLES.admin, permissions: PERMISSIONS.post | PERMISSIONS.remove } });
  assert.equal(await noInfo.admin.command(noInfo.alice.account, "/slowmode 5"), "I can't: that needs the change-info permission, and I don't have it in this group.");
});

test("/promote: the owner makes a member an admin; an admin without manage-admins is refused", async () => {
  const { w, alice, bob, bot, admin } = await adminWorld({ members: [{ name: "dave", role: ROLES.admin, permissions: PERMISSIONS.post | PERMISSIONS.remove }] });
  assert.equal(await admin.command(ACCOUNTS.dave, "/promote bob.02"), "Refused: that needs the manage-admins permission.");
  const { out, count } = await submissionsDuring(w, () => admin.command(alice.account, "/promote bob.02"));
  assert.equal(out, "bob.02 is now an admin of Test group.");
  assert.equal(count, 1);
  const promoted = state(bot).members.find((m) => m.account === bob.account);
  assert.equal(promoted.role, ROLES.admin);
  assert.equal(promoted.permissions, PROMOTED_ADMIN_PERMISSIONS | PERMISSIONS.post);
  assert.equal(promoted.permissions & PERMISSIONS.admins, 0, "a promoted admin cannot make more admins");
  await bob.sync();
  assert.equal(state(bob).members.find((m) => m.account === bob.account).role, ROLES.admin);
  assert.equal(await admin.command(alice.account, "/promote bob.02"), "bob.02 is already an admin.");
});

test("/invite gives a link naming the bot first, held in the state; it admits by its capability; /revoke-invite ends it", async () => {
  const { w, alice, bob, bot, admin } = await adminWorld({ state: { joinPolicy: 2 } });
  assert.equal(await admin.command(bob.account, "/invite"), "Refused: only an admin can do that.");
  const reply = await admin.command(alice.account, "/invite");
  // Ruling 9 (amended): its own scheme, never polkadotapp://, which would
  // make the desktop capture the phone app's pairing links.
  const b64 = /\npolkadot-chat:\/\/g#([A-Za-z0-9_-]+)\n/.exec(reply)?.[1];
  assert.doesNotMatch(reply, /polkadotapp:/);
  assert.ok(b64, reply);
  assert.match(reply, /Anyone with the link joins at once\.$/);
  const link = decodeInviteLink(inviteLinkFromBase64Url(b64));
  assert.equal(link.groupId, GROUP);
  assert.equal(link.name, "Test group");
  assert.deepEqual(link.admins, [bot.account, alice.account], "the always-online bot first, then the admin who asked");
  const held = state(bot).invites.find((i) => i.inviteId === link.inviteId);
  assert.equal(held.secret, link.secret, "the state holds the capability");
  assert.equal(held.createdBy, alice.account);
  await bob.sync();
  assert.equal(state(bob).invites.length, 1, "members apply the invite");
  // carol uses it.
  const carol = w.person("carol");
  assert.equal(await admin.joinRequest(carol.account, joinReq("carol", link)), "admitted");
  const [welcome] = carol.controls();
  assert.equal(carol.groups.welcome(bot.account, welcome.m.control.welcome), "welcomed");
  await carol.sync();
  assert.equal(carol.groups.get(GROUP).status, "member");
  // Revoked: dave's request by the same link is rejected.
  assert.equal(await admin.command(alice.account, "/revoke-invite"), "Revoked 1 invite of Test group. Those links no longer work.");
  assert.equal(state(bot).invites.length, 0);
  const dave = w.person("dave");
  assert.equal(await admin.joinRequest(dave.account, joinReq("dave", link)), "unknown-invite");
  assert.equal(dave.controls()[0].m.control.joinDecision.status, 1);
});

test("/invite on a group whose policy is 'admins add only' says links are refused; /revoke-invite <link> drops only that one", async () => {
  const { alice, bot, admin } = await adminWorld();
  const first = await admin.command(alice.account, "/invite");
  assert.match(first, /the join policy is "admins add only"/);
  await admin.command(alice.account, "/invite");
  const link = /polkadot-chat:\/\/g#([A-Za-z0-9_-]+)/.exec(first)[0];
  assert.equal(await admin.command(alice.account, `/revoke-invite ${link}`), "Revoked 1 invite of Test group. Those links no longer work.");
  assert.equal(state(bot).invites.length, 1);
  assert.equal(await admin.command(alice.account, "/revoke-invite 00"), "No invite of this group matches that.");
});

test("/revoke-invite takes the link as polkadot-chat://g#, bare g#, or (one release) the old polkadotapp://g#; any other scheme is not a link", async () => {
  // Links already shared in the old form must still be revocable for one release.
  const { alice, bot, admin } = await adminWorld();
  const b64s = [];
  for (let i = 0; i < 4; i++) b64s.push(/polkadot-chat:\/\/g#([A-Za-z0-9_-]+)/.exec(await admin.command(alice.account, "/invite"))[1]);
  assert.equal(await admin.command(alice.account, `/revoke-invite https://evil.example/g#${b64s[3]}`), "No invite of this group matches that.");
  const forms = [`polkadot-chat://g#${b64s[0]}`, `g#${b64s[1]}`, `polkadotapp://g#${b64s[2]}`];
  for (const [i, form] of forms.entries()) {
    assert.equal(await admin.command(alice.account, `/revoke-invite ${form}`), "Revoked 1 invite of Test group. Those links no longer work.", form);
    assert.equal(state(bot).invites.length, 3 - i);
  }
});

test("policy 1: the request is pending, the owner gets Approve/Reject over DM, and only the owner's Approve admits (state + welcome + history)", async () => {
  const { w, alice, bob, bot, admin, buttons } = await adminWorld({ state: { joinPolicy: 1, invites: [INVITE], historyShare: 20 } });
  await alice.groups.send(GROUP, [text("OLD-1", w.clock.t, "before carol")]);
  await bot.sync();
  const carol = w.person("carol");
  const before = w.submissions.length;
  assert.equal(await admin.joinRequest(carol.account, { ...joinReq("carol", INVITE), note: "hi, I am carol" }), "forwarded");
  assert.equal(carol.controls()[0].m.control.joinDecision.status, 0, "the joiner hears pending");
  assert.equal(w.submissions.length, before, "nobody is added yet");
  assert.equal(buttons.length, 1);
  const [ask] = buttons;
  assert.equal(ask.to, alice.account, "forwarded to the owner");
  assert.equal(ask.text, "carol.04 wants to join Test group.\nNote: hi, I am carol\nThis request expires in 24 hours.");
  assert.deepEqual(ask.rows[0].map((b) => b.label), ["Approve", "Reject"]);
  assert.ok(ask.rows[0].every((b) => b.action.callback instanceof Uint8Array), "callback buttons (spec 0006)");
  // The same request again (the opener, then the joinRequest control) is not forwarded twice.
  assert.equal(await admin.joinRequest(carol.account, joinReq("carol", INVITE)), "already-pending");
  assert.equal(buttons.length, 1);
  assert.equal(carol.controls().length, 0);
  // Only the owner's press on that message counts.
  assert.equal(admin.ownsPress(bob.account, ask.messageId), false);
  assert.equal(admin.ownsPress(alice.account, ask.messageId), true);
  assert.equal(await admin.press(bob.account, pressOf(ask, "Approve")), "This join request is no longer open.");
  assert.equal(await admin.press(alice.account, { ...pressOf(ask, "Approve"), targetMessageId: "OTHER" }), "This join request is no longer open.");
  assert.equal(state(bot).members.some((m) => m.account === carol.account), false);

  const { out, count } = await submissionsDuring(w, () => admin.press(alice.account, pressOf(ask, "Approve")));
  assert.equal(out, "carol.04 joined Test group.");
  assert.equal(count, 1, "one state statement");
  const got = carol.controls();
  assert.equal(got[0].m.control.welcome.groupId, GROUP, "then the welcome");
  const history = got.find((c) => c.m.control.history);
  assert.ok(history, "and the shared history (historyShare 20)");
  assert.deepEqual(history.m.control.history.items.map((i) => decodeOpaqueMessageAt(i.message, 0).value.messageId), ["OLD-1"]);
  assert.equal(carol.groups.welcome(bot.account, got[0].m.control.welcome), "welcomed");
  await carol.sync();
  assert.equal(carol.groups.get(GROUP).status, "member");
  assert.equal(admin.pending().length, 0);
  assert.equal(await admin.press(alice.account, pressOf(ask, "Approve")), "This join request is no longer open.", "a second press does nothing");
});

test("policy 1: Reject sends joinDecision rejected and adds nobody", async () => {
  const { w, alice, bot, admin, buttons } = await adminWorld({ state: { joinPolicy: 1, invites: [INVITE] } });
  const carol = w.person("carol");
  await admin.joinRequest(carol.account, joinReq("carol", INVITE));
  carol.controls();
  const before = w.submissions.length;
  assert.equal(await admin.press(alice.account, pressOf(buttons[0], "Reject")), "Rejected carol.04.");
  assert.equal(w.submissions.length, before);
  assert.equal(carol.controls()[0].m.control.joinDecision.status, 1);
  assert.equal(state(bot).members.some((m) => m.account === carol.account), false);
});

test("policy 1: a request unanswered for 24 h expires, the joiner is told no, and a late press does nothing", async () => {
  const { w, alice, bot, admin, buttons } = await adminWorld({ state: { joinPolicy: 1, invites: [INVITE] } });
  const carol = w.person("carol");
  await admin.joinRequest(carol.account, joinReq("carol", INVITE));
  carol.controls();
  w.clock.t += JOIN_REQUEST_TTL_MS - 1000;
  await admin.tick();
  assert.equal(admin.pending().length, 1, "still open just before 24 h");
  w.clock.t += 2000;
  assert.equal(await admin.press(alice.account, pressOf(buttons[0], "Approve")), "This join request is no longer open.", "a press after 24 h does nothing");
  await admin.tick();
  assert.equal(admin.pending().length, 0);
  assert.equal(carol.controls()[0].m.control.joinDecision.status, 1, "expiry = rejected");
  assert.equal(state(bot).members.some((m) => m.account === carol.account), false);
});

test("policy 2 admits at once and policy 0 rejects: neither asks the owner", async () => {
  const open = await adminWorld({ state: { joinPolicy: 2, invites: [INVITE] } });
  const c1 = open.w.person("carol");
  assert.equal(await open.admin.joinRequest(c1.account, joinReq("carol", INVITE)), "admitted");
  assert.equal(open.buttons.length, 0);
  const closed = await adminWorld({ state: { joinPolicy: 0, invites: [INVITE] } });
  const c2 = closed.w.person("carol");
  assert.equal(await closed.admin.joinRequest(c2.account, joinReq("carol", INVITE)), "admins-add-only");
  assert.equal(c2.controls()[0].m.control.joinDecision.status, 1);
  assert.equal(closed.buttons.length, 0);
});

test("a pending request survives a restart: the restored module still admits on the owner's press", async () => {
  const { w, alice, bot, admin, buttons } = await adminWorld({ state: { joinPolicy: 1, invites: [INVITE] } });
  const carol = w.person("carol");
  await admin.joinRequest(carol.account, joinReq("carol", INVITE));
  const again = createGroupAdmin({ groupsV2: bot.groups, selfHex: ACCOUNTS.bot, sendButtons: async () => "X", now: () => w.clock.t });
  again.restore(JSON.parse(JSON.stringify(admin.snapshot())));
  assert.equal(again.ownsPress(alice.account, buttons[0].messageId), true);
  assert.match(await again.press(alice.account, pressOf(buttons[0], "Approve")), /joined Test group\.$/);
  assert.ok(state(bot).members.some((m) => m.account === carol.account));
});
