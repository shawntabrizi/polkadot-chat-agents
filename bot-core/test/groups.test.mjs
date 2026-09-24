// Spec 0009 fan-out groups, three identities in memory: alice (the admin),
// bob and the bot, each with its own lib/groups.mjs state. Every hop goes
// through the real codec (encode -> bytes -> decodeOpaqueMessageAt), so what
// a member acts on is what the wire carries. The Testing section of the spec
// lists the cases: create, fan-out, dedup, non-member rejected, roster bump
// removes a member, leave, per-sender order, a bot member replying to all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroups, groupSessionKey } from "../lib/groups.mjs";
import { buildOperatorContext, groupHint } from "../lib/agent-context.mjs";
import {
  decodeOpaqueMessageAt,
  encodeOpaqueGroupInfoMessage,
  encodeOpaqueGroupLeaveMessage,
  encodeOpaqueTextMessage,
  encodeOpaqueTypingMessage,
  TYPING_KINDS,
} from "../vendor/app-chat-codec.mjs";

const ALICE = "a1".repeat(32);
const BOB = "b0".repeat(32);
const BOT = "b7".repeat(32);
const CAROL = "c4".repeat(32);
const GROUP = "5E4B1C2D-0000-4000-8000-00000000A11C";
const text = (t) => encodeOpaqueTextMessage({ messageId: "inner", timestamp: 0, text: t });

// An in-memory network of pairwise sessions: bytes in, decoded message out.
// `copies` records every delivery so a test can replay one (a second path).
const makeNetwork = () => {
  const inboxes = new Map(); // account -> [{ from, m }]
  const copies = [];
  let ids = 0;
  const net = {
    inbox: (account) => inboxes.get(account) ?? [],
    copies,
    deliverBytes(from, to, opaque) {
      const m = decodeOpaqueMessageAt(opaque, 0).value;
      assert.notEqual(m.kind, "undecodable", m.error);
      copies.push({ from, to, opaque });
      if (!inboxes.has(to)) inboxes.set(to, []);
      inboxes.get(to).push({ from, m });
      return m;
    },
    member(account) {
      const groups = createGroups({
        selfHex: account,
        makeId: () => `ENV-${account.slice(0, 2)}-${++ids}`,
        deliver: async (peerHex, opaque) => { net.deliverBytes(account, peerHex, opaque); },
      });
      return { account, groups };
    },
  };
  return net;
};

// The admin creates the group: v1 to every other member, one per session.
const sendInfo = (net, admin, { version, members, name = "Test group" }) => {
  const opaque = encodeOpaqueGroupInfoMessage({
    messageId: `GI-${version}`, groupId: GROUP, name, admin: admin.account, version, createdAt: 1_720_000_000_000,
    members: members.map(([account, username]) => ({ account, username, joinedAt: 1_720_000_000_000 })),
  });
  return members.map(([account]) => account).filter((a) => a !== admin.account).map((to) => net.deliverBytes(admin.account, to, opaque));
};

// What bot-core does with an accepted text: one reply to the whole group.
const botAnswers = async (bot, from, m) => {
  const accepted = bot.groups.acceptMessage(from, m);
  if (!accepted.ok || m.content.kind !== "text") return { accepted, sent: null };
  return { accepted, sent: await bot.groups.send(m.groupId, text(`Echo: ${m.content.text}`)) };
};

const setup = () => {
  const net = makeNetwork();
  const alice = net.member(ALICE);
  const bob = net.member(BOB);
  const bot = net.member(BOT);
  const roster = [[ALICE, "alice.01"], [BOB, "bob.02"], [BOT, "pcdguide.70"]];
  // The admin applies its own roster first.
  alice.groups.applyInfo(ALICE, { groupId: GROUP, name: "Test group", adminHex: ALICE, version: 1, createdAt: 0, members: roster.map(([accountHex, username]) => ({ accountHex, username })) });
  const [toBob, toBot] = sendInfo(net, alice, { version: 1, members: roster });
  assert.equal(bob.groups.applyInfo(ALICE, toBob), "joined");
  assert.equal(bot.groups.applyInfo(ALICE, toBot), "joined");
  return { net, alice, bob, bot, roster };
};

test("create: every member holds the same roster; only the admin it names can create", () => {
  const { net, bob, bot } = setup();
  assert.deepEqual(bot.groups.targets(GROUP), [ALICE, BOB], "the bot fans out to everyone but itself");
  assert.deepEqual(bob.groups.targets(GROUP), [ALICE, BOT]);
  assert.deepEqual(bot.groups.contextFor(groupSessionKey(GROUP)), { name: "Test group", size: 3 });
  // bob cannot create a group that names alice as admin: the sender must be the admin.
  const forged = net.member(CAROL);
  const [m] = sendInfo(net, { account: BOB }, { version: 1, members: [[BOB, "bob.02"], [CAROL, "carol"]] });
  assert.equal(forged.groups.applyInfo(ALICE, m), "not-admin", "sender and named admin differ");
  // A roster that does not list the receiver is not a group for it.
  const bystander = net.member(CAROL);
  assert.equal(bystander.groups.applyInfo(ALICE, { ...m, adminHex: ALICE, members: [{ accountHex: ALICE }, { accountHex: BOB }] }), "not-listed");
});

test("fan-out: one message reaches every other member with ONE envelope id; a second copy is deduped", async () => {
  const { net, alice, bob, bot } = setup();
  const sent = await alice.groups.send(GROUP, text("hello all"));
  assert.deepEqual(sent.to, [BOB, BOT]);
  const toBob = net.inbox(BOB).at(-1);
  const toBot = net.inbox(BOT).at(-1);
  assert.equal(toBob.m.messageId, toBot.m.messageId, "copies share the envelope id");
  assert.deepEqual([toBob.m.content, toBob.m.seq, toBob.m.infoVersion], [{ kind: "text", text: "hello all" }, 1, 1]);
  assert.equal(bob.groups.acceptMessage(ALICE, toBob.m).ok, true);
  // The same envelope through a second path is shown once.
  assert.deepEqual(bob.groups.acceptMessage(ALICE, toBob.m), { ok: false, reason: "duplicate" });
  const replay = net.deliverBytes(ALICE, BOT, net.copies.find((c) => c.to === BOT && c.from === ALICE && decodeOpaqueMessageAt(c.opaque, 0).value.kind === "groupMessage").opaque);
  assert.equal(bot.groups.acceptMessage(ALICE, toBot.m).ok, true);
  assert.equal(bot.groups.acceptMessage(ALICE, replay).reason, "duplicate");
});

test("the bot's reply reaches both members with one envelope id and its own seq", async () => {
  const { net, alice, bob, bot } = setup();
  await alice.groups.send(GROUP, text("hello all"));
  const { accepted, sent } = await botAnswers(bot, ALICE, net.inbox(BOT).at(-1).m);
  assert.equal(accepted.sender.username, "alice.01", "the brain context names the sender");
  assert.deepEqual(sent.to, [ALICE, BOB]);
  const atAlice = net.inbox(ALICE).at(-1);
  const atBob = net.inbox(BOB).at(-1);
  assert.equal(atAlice.from, BOT);
  assert.equal(atAlice.m.messageId, sent.messageId);
  assert.equal(atBob.m.messageId, sent.messageId, "one envelope id for both copies");
  assert.deepEqual([atBob.m.content.text, atBob.m.seq], ["Echo: hello all", 1], "the bot's first message is its seq 1");
  assert.equal(alice.groups.acceptMessage(BOT, atAlice.m).ok, true, "the bot is a member like anyone");
  assert.equal(bob.groups.acceptMessage(BOT, atBob.m).ok, true);
  // Typing fans out without advancing seq: a receiver that never stores
  // typing must not see a gap before the next real message.
  await bot.groups.send(GROUP, encodeOpaqueTypingMessage({ messageId: "t", timestamp: 0, until: 1, kind: TYPING_KINDS.working }), { ephemeral: true });
  assert.deepEqual([net.inbox(BOB).at(-1).m.content.kind, net.inbox(BOB).at(-1).m.seq], ["typing", 1]);
  await bot.groups.send(GROUP, text("second"));
  const next = net.inbox(BOB).at(-1).m;
  assert.equal(next.seq, 2);
  assert.equal(bob.groups.acceptMessage(BOT, next).gap, false);
});

test("a non-member's message is rejected", async () => {
  const { net, bot } = setup();
  const carol = net.member(CAROL);
  // carol forges a roster locally and sends into the group.
  carol.groups.applyInfo(CAROL, { groupId: GROUP, name: "x", adminHex: CAROL, version: 9, members: [{ accountHex: CAROL }, { accountHex: BOT }] });
  await carol.groups.send(GROUP, text("let me in"));
  const m = net.inbox(BOT).at(-1).m;
  assert.equal(m.content.text, "let me in");
  assert.deepEqual(bot.groups.acceptMessage(CAROL, m), { ok: false, reason: "non-member" });
  // Her roster is not the admin's: the bot ignores it too.
  const [info] = sendInfo(net, { account: CAROL }, { version: 9, members: [[CAROL, "c"], [BOT, "b"]] });
  assert.equal(bot.groups.applyInfo(CAROL, info), "not-admin");
  assert.deepEqual(bot.groups.targets(GROUP), [ALICE, BOB], "the roster is unchanged");
});

test("per-sender seq orders messages; a gap is reported once", async () => {
  const { net, alice, bot } = setup();
  for (const t of ["one", "two", "three"]) await alice.groups.send(GROUP, text(t));
  const got = net.inbox(BOT).filter((x) => x.m.kind === "groupMessage").map((x) => x.m);
  assert.deepEqual(got.map((m) => m.seq), [1, 2, 3]);
  assert.deepEqual(got.map((m) => bot.groups.acceptMessage(ALICE, m).gap), [false, false, false]);
  // seq 4 and 5 never arrive: 6 is a gap, reported once; 7 is not.
  alice.groups.get(GROUP).seq = 5;
  await alice.groups.send(GROUP, text("six"));
  await alice.groups.send(GROUP, text("seven"));
  const [six, seven] = net.inbox(BOT).slice(-2).map((x) => x.m);
  assert.equal(bot.groups.acceptMessage(ALICE, six).gap, true);
  assert.equal(bot.groups.acceptMessage(ALICE, seven).gap, false);
  // A late seq 4 is still shown (dedup is by envelope id, not by seq).
  const late = { ...six, messageId: "LATE-4", seq: 4 };
  assert.equal(bot.groups.acceptMessage(ALICE, late).ok, true);
});

test("roster bump: a new version from the admin removes the bot, which stops sending and drops the group's messages", async () => {
  const { net, alice, bob, bot } = setup();
  // Stale and non-admin versions change nothing.
  const [, staleToBot] = sendInfo(net, alice, { version: 1, members: [[ALICE, "a"], [BOB, "b"], [BOT, "x"]] });
  assert.equal(bot.groups.applyInfo(ALICE, staleToBot), "stale");
  assert.equal(bot.groups.applyInfo(BOB, { ...staleToBot, version: 5 }), "not-admin");
  // v2 without the bot: sent to the remaining members AND the removed one.
  const v2 = encodeOpaqueGroupInfoMessage({ messageId: "GI-2", groupId: GROUP, name: "Test group", admin: ALICE, version: 2, createdAt: 0, members: [{ account: ALICE, username: "alice.01", joinedAt: 0 }, { account: BOB, username: "bob.02", joinedAt: 0 }] });
  alice.groups.applyInfo(ALICE, decodeOpaqueMessageAt(v2, 0).value); // the admin's own copy
  assert.equal(bob.groups.applyInfo(ALICE, net.deliverBytes(ALICE, BOB, v2)), "updated");
  assert.equal(bot.groups.applyInfo(ALICE, net.deliverBytes(ALICE, BOT, v2)), "removed");
  assert.deepEqual(bot.groups.targets(GROUP), []);
  const before = net.copies.length;
  const skipped = await bot.groups.send(GROUP, text("still here?"));
  assert.equal(skipped.messageId, null);
  assert.equal(net.copies.length, before, "nothing went on the wire");
  // alice's next message goes to bob only (her roster is v2); one sent to the bot anyway is dropped.
  const sent = await alice.groups.send(GROUP, text("bye bot"));
  assert.deepEqual(sent.to, [BOB]);
  assert.equal(net.inbox(BOB).at(-1).m.infoVersion, 2);
  assert.deepEqual(bot.groups.acceptMessage(ALICE, { ...net.inbox(BOB).at(-1).m, messageId: "X" }), { ok: false, reason: "removed" });
  // A later version that lists the bot again brings it back.
  const [, backToBot] = sendInfo(net, alice, { version: 3, members: [[ALICE, "a"], [BOB, "b"], [BOT, "x"]] });
  assert.equal(bot.groups.applyInfo(ALICE, backToBot), "updated");
  assert.deepEqual(bot.groups.targets(GROUP), [ALICE, BOB]);
});

test("leave: a member's groupLeave stops the fan-out to it and its messages are rejected", async () => {
  const { net, bob, bot } = setup();
  const leave = encodeOpaqueGroupLeaveMessage({ messageId: "GRL-1", groupId: GROUP });
  for (const to of [ALICE, BOT]) net.deliverBytes(BOB, to, leave);
  const m = net.inbox(BOT).at(-1).m;
  assert.deepEqual([m.kind, m.groupId], ["groupLeave", GROUP]);
  assert.equal(bot.groups.applyLeave(BOB, m.groupId), "left");
  assert.equal(bot.groups.applyLeave(BOB, m.groupId), "duplicate");
  assert.equal(bot.groups.applyLeave(CAROL, m.groupId), "non-member");
  assert.deepEqual(bot.groups.targets(GROUP), [ALICE]);
  await bob.groups.send(GROUP, text("one more"));
  assert.equal(bot.groups.acceptMessage(BOB, net.inbox(BOT).at(-1).m).reason, "non-member");
  const sent = await bot.groups.send(GROUP, text("to alice only"));
  assert.deepEqual(sent.to, [ALICE]);
});

test("state survives a restart: roster, own seq, senders' seq and recent ids", async () => {
  const { net, alice, bot } = setup();
  await alice.groups.send(GROUP, text("hello"));
  const m = net.inbox(BOT).at(-1).m;
  bot.groups.acceptMessage(ALICE, m);
  await bot.groups.send(GROUP, text("hi"));
  bot.groups.applyLeave(BOB, GROUP);
  const snapshot = JSON.parse(JSON.stringify(bot.groups.snapshot()));
  const restarted = net.member(BOT);
  restarted.groups.restore(snapshot);
  assert.deepEqual(restarted.groups.targets(GROUP), [ALICE], "the leave survives");
  assert.equal(restarted.groups.acceptMessage(ALICE, m).reason, "duplicate", "a resent copy is not answered twice");
  const next = await restarted.groups.send(GROUP, text("again"));
  assert.equal(next.seq, 2, "seq continues after the restart");
  assert.equal(restarted.groups.admits(ALICE, (hex) => hex === ALICE), true, "an allowed admin's member is admitted");
  assert.equal(restarted.groups.admits(CAROL, () => true), false);
});

test("a delivery failure to one member does not stop the others", async () => {
  const bot = createGroups({
    selfHex: BOT,
    makeId: () => "ENV-1",
    deliver: async (peerHex) => { if (peerHex === BOB) throw new Error("no identifier key"); },
    log: () => {},
  });
  bot.applyInfo(ALICE, { groupId: GROUP, name: "g", adminHex: ALICE, version: 1, members: [{ accountHex: ALICE }, { accountHex: BOB }, { accountHex: BOT }] });
  const sent = await bot.send(GROUP, text("x"));
  assert.deepEqual([sent.to, sent.failed], [[ALICE, BOB], [BOB]]);
});

test("persona hint: a group turn tells the model the room and to address the sender", () => {
  assert.equal(groupHint({ name: "Test group", size: 3 }), "You are in the group Test group with 3 people; address the sender by name. Do not send tx (transaction) buttons in a group.");
  const ctx = buildOperatorContext({ username: "pcdguide.70", transport: "polkadot-app", group: { name: "Test group", size: 3 } });
  assert.ok(ctx.includes("You are in the group Test group with 3 people"));
  assert.ok(!buildOperatorContext({ username: "pcdguide.70" }).includes("You are in the group"), "no hint in a 1:1 turn");
});
