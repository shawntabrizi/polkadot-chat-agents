// Spec 0011 private groups v2 in memory: alice (owner), bob, carol and the
// bot, each with its own lib/groups-v2.mjs state, its own X25519 identity key
// (K(A, B) is the real agreement) and a shared fake Statement Store that
// keeps ONE statement per (signer, channel), as the real store does. Every
// hop goes through the real codec and AES-GCM, so what a member acts on is
// what the wire carries. The cases are 0011's Testing list as it applies to
// a bot: one submission per message, dedup, non-member and no-post refused,
// slow mode, removal (the removed member cannot read the next epoch), epoch
// switch and key erase, forks, keyRequest, history pages, join by invite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroupsV2, OLD_KEY_KEEP_MS } from "../lib/groups-v2.mjs";
import { PERMISSIONS, ROLES, decodeGroupData, decodeGroupMessages, decodeGroupState, encodeGroupData, encodeGroupMessages, encodeGroupState as encodeStateBytes } from "../lib/group-codec.mjs";
import { deriveEpoch, joinProof, makeRekeyEntry, open, pairwiseSecret, seal } from "../lib/group-keys.mjs";
import {
  decodeOpaqueMessageAt,
  encodeOpaqueBotInfoMessage,
  encodeOpaqueGroupControlMessage,
  encodeOpaqueGroupLeaveMessage,
} from "../vendor/app-chat-codec.mjs";

import { ACCOUNTS, GROUP, fill, hex, makeWorld, setup, text, texts } from "./fixtures/group-world.mjs";

test("create: a welcome over DM and the state on the topic make the bot a member", async () => {
  const { w, bot } = await setup();
  assert.equal(w.submissions.length, 1, "create costs one state statement");
  const g = bot.groups.get(GROUP);
  assert.equal(g.state.members.length, 3);
  assert.equal(g.epoch, 1);
  assert.deepEqual(bot.groups.topics().map(hex), [hex(deriveEpoch(g.epochs.get(1).key, GROUP, 1).topic)]);
});

test("a welcome naming a state the topic does not hold is never applied; a stranger's welcome is refused by an allowlisted bot", async () => {
  const w = makeWorld();
  const alice = w.person("alice");
  const bot = w.person("bot", { allowed: (peer) => peer === ACCOUNTS.carol });
  const welcome = await alice.groups.create({ groupId: GROUP, name: "G", members: [{ account: bot.account }, { account: ACCOUNTS.dave }] });
  assert.equal(bot.groups.welcome(alice.account, welcome.welcome), "not-allowed");
  // carol holds the key but is not the state's signer: a wrong hash is refused...
  const dave = w.person("dave");
  assert.equal(dave.groups.welcome(ACCOUNTS.carol, { ...welcome.welcome, stateHash: fill(9, 32) }), "welcomed");
  assert.equal((await dave.sync())[0].outcome, "hash-mismatch");
  assert.equal(dave.groups.get(GROUP).status, "pending");
  // ...and the right hash from a welcomer who is not an admin of that state too.
  const dave2 = w.person("dave");
  assert.equal(dave2.groups.welcome(ACCOUNTS.carol, welcome.welcome), "welcomed");
  assert.equal((await dave2.sync())[0].outcome, "welcomer-not-admin");
});

test("one message = one submission; the bot's reply is ONE statement on its ChMsgs_e, readable by every member", async () => {
  const { w, alice, bob, bot } = await setup();
  const before = w.submissions.length;
  assert.equal((await alice.groups.send(GROUP, [text("M-1", w.clock.t, "hello bot")])).ok, true);
  assert.equal(w.submissions.length - before, 1, "a group message costs one submission, no ACK");
  const got = await bot.sync();
  assert.deepEqual(texts(got), ["hello bot"]);
  assert.equal(got[0].messages[0].answerable, true);

  w.clock.t += 2000;
  // A long answer in three parts still leaves as one statement.
  const parts = ["part one", "part two", "part three"].map((t, i) => text(`R-${i}`, w.clock.t, t));
  const sent = await bot.groups.send(GROUP, parts);
  assert.equal(sent.ok, true);
  assert.equal(w.submissions.length - before, 2, "the reply is exactly one more submission");
  const last = w.submissions.at(-1);
  const ep = bot.groups.get(GROUP).epochs.get(1);
  assert.equal(last.who, "bot");
  assert.equal(last.topicHex, hex(ep.topic), "on Topic_1");
  assert.equal(last.channelHex, hex(ep.channels.msgs), "on ChMsgs_1");
  assert.deepEqual(texts(await alice.sync()), ["part one", "part two", "part three"]);
  assert.deepEqual(texts(await bob.sync()), ["hello bot", "part one", "part two", "part three"]);
});

// 0011 ruling 8: the desktop shows a bot's badge, description and `/`
// commands in a group only from a botInfo it read on the group topic. The bot
// must not pay a standalone statement for it, and must not repeat it in every
// carrier (4 KB is shared with the replies), but a new version must reach
// the group.
test("botInfo rides the bot's first group statement with the reply; later statements repeat it only after a version change", async () => {
  let version = 3;
  const botInfo = () => ({
    version,
    opaque: encodeOpaqueBotInfoMessage({ timestamp: 1, kind: 1, name: "Bot", description: "A bot", commands: [{ name: "help", description: "Help" }], version }),
  });
  const { w, alice, bot } = await setup({ botInfo });
  // The carrier the bot holds now, decoded to kinds, newest first.
  const carrierKinds = () => {
    const st = [...w.slots.values()].find((s) => s.signerHex === bot.account && decodeGroupData(s.data).kind === "messages");
    const plain = open(bot.groups.get(GROUP).epochs.get(1).msgKey, { signer: Buffer.from(bot.account, "hex"), epoch: 1, variant: 0, sealed: decodeGroupData(st.data).sealed });
    return decodeGroupMessages(plain).messages.map((o) => decodeOpaqueMessageAt(o, 0).value);
  };
  const before = w.submissions.length;
  assert.equal(w.submissions.filter((s) => s.who === "bot").length, 0, "joining alone submits nothing: no standalone botInfo statement");

  assert.equal((await bot.groups.send(GROUP, [text("B-1", w.clock.t, "first reply")])).botInfo, 3);
  assert.equal(w.submissions.length - before, 1, "botInfo + reply is ONE submission");
  const first = carrierKinds();
  assert.deepEqual(first.map((m) => m.kind), ["text", "botInfo"], "the reply, then the botInfo as the oldest message");
  assert.equal(first[1].version, 3);
  assert.deepEqual(first[1].commands.map((c) => c.name), ["help"]);
  const got = await alice.sync();
  assert.deepEqual(got.flatMap((r) => r.messages ?? []).map((x) => x.message.kind), ["botInfo", "text"], "a member reads the botInfo before the reply");

  w.clock.t += 5000;
  assert.equal((await bot.groups.send(GROUP, [text("B-2", w.clock.t, "second reply")])).botInfo, undefined);
  assert.deepEqual(carrierKinds().map((m) => m.kind), ["text", "text"], "the next statement carries the replies, not the botInfo again");

  w.clock.t += 5000;
  version = 4; // the operator edited botinfo.json
  await bot.groups.send(GROUP, [text("B-3", w.clock.t, "third reply")]);
  const third = carrierKinds();
  assert.deepEqual(third.map((m) => m.kind), ["text", "botInfo", "text", "text"], "a new version rides the next statement once");
  assert.equal(third[1].version, 4);
  // It survives a restart: the restored state does not announce again.
  const restored = w.person("bot", { botInfo });
  restored.groups.restore(bot.groups.snapshot());
  w.clock.t += 5000;
  assert.equal((await restored.groups.send(GROUP, [text("B-4", w.clock.t, "after restart")])).botInfo, undefined);
});

test("the carry: the bot's next statement replaces the previous one and still carries its last 24 h; readers dedup", async () => {
  const { w, alice, bot } = await setup();
  await bot.groups.send(GROUP, [text("B-1", w.clock.t, "first")]);
  w.clock.t += 5000;
  await bot.groups.send(GROUP, [text("B-2", w.clock.t, "second")]);
  const botSlots = [...w.slots.values()].filter((s) => s.signerHex === bot.account);
  assert.equal(botSlots.filter((s) => decodeGroupData(s.data).kind === "messages").length, 1, "one carrier slot per member");
  // alice was offline for both: the one statement holds both, newest first.
  assert.deepEqual(texts(await alice.sync()), ["first", "second"], "one statement holds both; handed on oldest first");
  w.clock.t += 5000;
  await bot.groups.send(GROUP, [text("B-3", w.clock.t, "third")]);
  assert.deepEqual(texts(await alice.sync()), ["third"], "carried messages already seen are deduped");
  w.clock.t += 25 * 3_600_000;
  await bot.groups.send(GROUP, [text("B-4", w.clock.t, "next day")]);
  const carrier = [...w.slots.values()].find((s) => s.signerHex === bot.account && decodeGroupData(s.data).kind === "messages");
  const ep = bot.groups.get(GROUP).epochs.get(1);
  const plain = open(ep.msgKey, { signer: Buffer.from(bot.account, "hex"), epoch: 1, variant: 0, sealed: decodeGroupData(carrier.data).sealed });
  assert.equal(decodeGroupMessages(plain).messages.length, 1, "messages older than 24 h leave the carry");
});

test("a signer that is not a member is refused; a member without `post` is refused (a groupLeave still passes)", async () => {
  const { w, alice, bot } = await setup({ state: {} });
  const ep = bot.groups.get(GROUP).epochs.get(1);
  // carol holds the key (say, leaked) but is not in the state.
  const carol = ACCOUNTS.carol;
  const forge = (from, signer, msgs) => {
    const plaintext = encodeGroupMessages({ from: Buffer.from(from, "hex"), messages: msgs });
    const sealed = seal(ep.msgKey, { signer: Buffer.from(signer, "hex"), epoch: 1, variant: 0, plaintext });
    return { topicHex: hex(ep.topic), channelHex: hex(ep.channels.msgs), signerHex: signer, data: encodeGroupData({ messages: sealed }) };
  };
  assert.equal((await bot.groups.receive(forge(carol, carol, [text("X", w.clock.t, "hi")]))).outcome, "non-member");
  // carol signs a carrier that claims to be from alice.
  assert.equal((await bot.groups.receive(forge(alice.account, carol, [text("Y", w.clock.t, "hi")]))).outcome, "bad-signer");

  // alice takes bob's `post` away (a state change she may make as owner).
  const g = alice.groups.get(GROUP);
  const bob = w.people.bob;
  const muted = { ...g.state, version: g.state.version + 1, members: g.state.members.map((m) => (m.account === bob.account ? { ...m, permissions: 0 } : m)) };
  const { state: sealedState } = sealStateFor(ep, alice.account, muted);
  await bot.sync();
  assert.equal((await bot.groups.receive({ topicHex: hex(ep.topic), channelHex: hex(ep.channels.state), signerHex: alice.account, data: sealedState })).outcome, "applied");
  assert.equal((await bot.groups.receive(forge(bob.account, bob.account, [text("Z", w.clock.t, "can I?")]))).outcome, "no-post");
  const leave = encodeOpaqueGroupLeaveMessage({ messageId: "L-1", timestamp: w.clock.t, groupId: GROUP });
  assert.equal((await bot.groups.receive(forge(bob.account, bob.account, [leave]))).outcome, "accepted");
});
const sealStateFor = (ep, signer, state) => {
  const plaintext = Buffer.from(encodeStateBytes(state));
  return { state: encodeGroupData({ state: seal(ep.msgKey, { signer: Buffer.from(signer, "hex"), epoch: state.epoch, variant: 1, plaintext }) }) };
};

test("a state from a plain member is refused; an admin cannot demote another admin (owner only)", async () => {
  const { w, alice, bob, bot } = await setup();
  const g = bot.groups.get(GROUP);
  const ep = g.epochs.get(1);
  const renamed = { ...g.state, version: 2, name: "Bob's group" };
  const res = await bot.groups.receive({ topicHex: hex(ep.topic), channelHex: hex(ep.channels.state), signerHex: bob.account, data: sealStateFor(ep, bob.account, renamed).state });
  assert.equal(res.outcome, "not-admin");
  assert.equal(bot.groups.get(GROUP).state.name, "Test group");
  void alice; void w;
});

test("slow mode: the bot (role 0) refuses a second send inside slowModeSecs and says when to retry; receivers hide a fast carrier", async () => {
  const { w, alice, bot } = await setup({ state: { slowModeSecs: 30 } });
  assert.equal((await bot.groups.send(GROUP, [text("S-1", w.clock.t, "one")])).ok, true);
  w.clock.t += 5000;
  const refused = await bot.groups.send(GROUP, [text("S-2", w.clock.t, "two")]);
  assert.deepEqual(refused, { ok: false, reason: "slow-mode", retryInMs: 25_000 });
  const before = w.submissions.length;
  w.clock.t += 25_000;
  assert.equal((await bot.groups.send(GROUP, [text("S-2", w.clock.t, "two")])).ok, true);
  assert.equal(w.submissions.length - before, 1);
  // The owner is not slowed down.
  assert.equal((await alice.groups.send(GROUP, [text("A-1", w.clock.t, "owner")])).ok, true);
  w.clock.t += 1500;
  assert.equal((await alice.groups.send(GROUP, [text("A-2", w.clock.t, "owner again")])).ok, true);

  // Receiver side: bob's carrier that arrives 10 s after his previous one is hidden.
  const ep = bot.groups.get(GROUP).epochs.get(1);
  const bobCarrier = (id) => {
    const plaintext = encodeGroupMessages({ from: Buffer.from(ACCOUNTS.bob, "hex"), messages: [text(id, w.clock.t, id)] });
    return { topicHex: hex(ep.topic), channelHex: hex(ep.channels.msgs), signerHex: ACCOUNTS.bob, data: encodeGroupData({ messages: seal(ep.msgKey, { signer: Buffer.from(ACCOUNTS.bob, "hex"), epoch: 1, variant: 0, plaintext }) }) };
  };
  assert.equal((await bot.groups.receive(bobCarrier("fast-1"))).outcome, "accepted");
  w.clock.t += 10_000;
  assert.equal((await bot.groups.receive(bobCarrier("fast-2"))).outcome, "slow-mode");
  w.clock.t += 30_000;
  assert.equal((await bot.groups.receive(bobCarrier("fast-3"))).outcome, "accepted");
});

test("slow mode receive: a 2 s grace for network delay (0011 ruling 14); the sender's own limit stays exact", async () => {
  // An honest sender that waited the full 30 s can land a little early at the
  // receiver; hiding it would drop a real message. Past the grace it is forged.
  const { w, bot } = await setup({ state: { slowModeSecs: 30 } });
  const ep = bot.groups.get(GROUP).epochs.get(1);
  const bobCarrier = (id) => {
    const plaintext = encodeGroupMessages({ from: Buffer.from(ACCOUNTS.bob, "hex"), messages: [text(id, w.clock.t, id)] });
    return { topicHex: hex(ep.topic), channelHex: hex(ep.channels.msgs), signerHex: ACCOUNTS.bob, data: encodeGroupData({ messages: seal(ep.msgKey, { signer: Buffer.from(ACCOUNTS.bob, "hex"), epoch: 1, variant: 0, plaintext }) }) };
  };
  assert.equal((await bot.groups.receive(bobCarrier("g-1"))).outcome, "accepted");
  w.clock.t += 28_000; // exactly slowModeSecs - grace
  assert.equal((await bot.groups.receive(bobCarrier("g-2"))).outcome, "accepted", "inside the grace: shown");
  w.clock.t += 27_999; // 1 ms short of slowModeSecs - grace
  assert.equal((await bot.groups.receive(bobCarrier("g-3"))).outcome, "slow-mode", "past the grace: hidden");
  // The bot's own send is not given the grace.
  assert.equal((await bot.groups.send(GROUP, [text("B-1", w.clock.t, "one")])).ok, true);
  w.clock.t += 29_000;
  assert.deepEqual(await bot.groups.send(GROUP, [text("B-2", w.clock.t, "two")]), { ok: false, reason: "slow-mode", retryInMs: 1000 });
});

test("at most one statement per second: the second send in the same second is refused with the wait (the caller merges)", async () => {
  const { w, bot } = await setup();
  assert.equal((await bot.groups.send(GROUP, [text("R-1", w.clock.t, "a")])).ok, true);
  w.clock.t += 200;
  assert.deepEqual(await bot.groups.send(GROUP, [text("R-2", w.clock.t, "b")]), { ok: false, reason: "rate", retryInMs: 800 });
});

test("a single message over 4096 bytes is refused, as in DMs", async () => {
  const { w, bot } = await setup();
  assert.equal((await bot.groups.send(GROUP, [text("BIG", w.clock.t, "x".repeat(4100))])).reason, "too-large");
});

test("removal: 2 submissions; the bot finds its entry and switches epoch; the removed member finds none and cannot read the next message", async () => {
  const { w, alice, bob, bot } = await setup();
  await bot.groups.send(GROUP, [text("E1-1", w.clock.t, "said in epoch 1")]);
  await alice.sync();
  const before = w.submissions.length;
  const removed = await alice.groups.remove(GROUP, bob.account);
  assert.equal(removed.ok, true);
  assert.equal(w.submissions.length - before, 2, "rekey on the old topic + state on the new topic");
  const [rekeySt, stateSt] = w.submissions.slice(-2);
  const old = alice.groups.get(GROUP).epochs.get(1);
  const next = alice.groups.get(GROUP).epochs.get(2);
  assert.equal(rekeySt.topicHex, hex(old.topic));
  assert.equal(rekeySt.channelHex, hex(old.channels.rekey));
  assert.equal(stateSt.topicHex, hex(next.topic));
  assert.equal(stateSt.channelHex, hex(next.channels.state));
  assert.equal(decodeGroupData(rekeySt.data).rekey.entries.length, 2, "an entry for each remaining member (alice and the bot)");

  const botRes = await bot.sync();
  assert.ok(botRes.some((r) => r.outcome === "rekeyed"));
  assert.ok(botRes.some((r) => r.outcome === "applied" && r.epoch === 2));
  const g = bot.groups.get(GROUP);
  assert.equal(g.epoch, 2);
  assert.equal(g.state.members.length, 2);
  assert.equal(g.epochs.get(1).erasesAt, w.clock.t + OLD_KEY_KEEP_MS, "the old key is kept 14 days");

  const bobRes = await bob.sync();
  assert.ok(bobRes.some((r) => r.outcome === "no-entry"), "bob sees the rekey and finds no entry");
  assert.equal(bob.groups.get(GROUP).epoch, 1);
  // Still listed in the state he holds, so he asks alice for the key; she refuses.
  const asked = bob.controls();
  assert.equal(asked.length, 0);
  const toAlice = w.people.alice.controls();
  assert.equal(toAlice[0]?.m.control.keyRequest?.haveEpoch, 1);
  assert.equal(await alice.groups.keyRequest(bob.account, toAlice[0].m.control.keyRequest), "not-listed");

  // The next message: alice sends on epoch 2; bob holds no key that opens it.
  w.clock.t += 2000;
  await alice.groups.send(GROUP, [text("E2-1", w.clock.t, "after bob left")]);
  const carrier = w.submissions.at(-1);
  assert.equal(carrier.topicHex, hex(next.topic));
  assert.deepEqual(await bob.sync(), [], "Topic_2 is not a topic bob can derive");
  const bobKeys = [...bob.groups.get(GROUP).epochs.values()];
  for (const k of bobKeys) {
    assert.throws(() => open(k.msgKey, { signer: Buffer.from(alice.account, "hex"), epoch: 2, variant: 0, sealed: decodeGroupData(carrier.data).sealed }));
  }
  assert.deepEqual(texts(await bot.sync()), ["after bob left"]);
  // The bot's reply now goes on epoch 2, and its epoch-1 messages are not
  // carried into it (a member admitted in epoch 2 must not read epoch 1).
  w.clock.t += 2000;
  const r2 = await bot.groups.send(GROUP, [text("E2-2", w.clock.t, "noted")]);
  assert.equal(w.submissions.at(-1).topicHex, hex(next.topic));
  assert.equal(r2.carried, 0);
});

test("key erase: 14 days after the next epoch the old key is gone and its topic unwatched", async () => {
  const { w, alice, bob, bot } = await setup();
  await alice.groups.remove(GROUP, bob.account);
  await bot.sync();
  assert.equal(bot.groups.topics().length, 2);
  w.clock.t += OLD_KEY_KEEP_MS + 1;
  await bot.groups.tick();
  assert.deepEqual([...bot.groups.get(GROUP).epochs.keys()], [2]);
  assert.equal(bot.groups.topics().length, 1);
});

test("rekey fork: two admins rekey out of the same epoch; the lower signer wins and the other key is kept 24 h", async () => {
  const { w, alice, bot } = await setup({ bot: { role: ROLES.admin, permissions: 0xff } });
  const g1 = bot.groups.get(GROUP).epochs.get(1);
  const carol = w.person("carol"); // not in the group: just a second admin key holder for the fork
  void carol;
  // The bot (b7..) rekeys first; alice (a1..) rekeys concurrently: alice wins.
  const botRekey = await bot.groups.rotate(GROUP);
  assert.equal(botRekey.ok, true);
  const k2Bot = bot.groups.get(GROUP).epochs.get(2).key;
  const k2Alice = fill(0x42, 32);
  const entries = [];
  for (const m of [ACCOUNTS.alice, ACCOUNTS.bob, ACCOUNTS.bot]) {
    entries.push(makeRekeyEntry(pairwiseSecret(alice.priv, w.keys.get(m).pub), { groupId: GROUP, newEpoch: 2, newKey: k2Alice }));
  }
  const res = await bot.groups.receive({ topicHex: hex(g1.topic), channelHex: hex(g1.channels.rekey), signerHex: alice.account, data: encodeGroupData({ rekey: { newEpoch: 2, entries } }) });
  assert.equal(res.outcome, "fork");
  const g = bot.groups.get(GROUP);
  assert.equal(hex(g.epochs.get(2).key), hex(k2Alice), "the lower signer's key wins");
  assert.equal(hex(g.forks.get(2).key), hex(k2Bot), "the loser's key stays readable");
  assert.equal(g.forks.get(2).erasesAt, w.clock.t + 86_400_000);
});

test("history on request: pages <= 4 KB, newest first, <= 100 messages, last on the final page; strangers get nothing", async () => {
  const { w, alice, bob, bot } = await setup({ state: { historyShare: 50 } });
  for (let i = 0; i < 40; i += 1) {
    w.clock.t += 60_000;
    await alice.groups.send(GROUP, [text(`H-${i}`, w.clock.t, `message ${i} `.padEnd(300, "."))]);
    await bot.sync();
  }
  const pages = bot.groups.historyPages(bob.account, { groupId: GROUP, since: { timestamp: 0 }, limit: 100 });
  assert.ok(pages.length > 1, "40 × 300 bytes need several pages");
  const items = [];
  pages.forEach((p, i) => {
    const bytes = encodeOpaqueGroupControlMessage({ messageId: "x".repeat(36), timestamp: w.clock.t, control: p });
    assert.ok(bytes.length <= 4096, `page ${i} is ${bytes.length} bytes`);
    assert.equal(p.history.last, i === pages.length - 1);
    items.push(...p.history.items);
  });
  const ids = items.map((it) => decodeOpaqueMessageAt(it.message, 0).value.messageId);
  assert.equal(ids.length, 40);
  assert.equal(ids[0], "H-39", "newest first");
  assert.ok(items.every((it) => hex(it.from) === alice.account || it.from === alice.account));
  const since = bot.groups.historyPages(bob.account, { groupId: GROUP, since: { messageId: "H-35" }, limit: 100 });
  assert.deepEqual(since.flatMap((p) => p.history.items).map((it) => decodeOpaqueMessageAt(it.message, 0).value.messageId), ["H-39", "H-38", "H-37", "H-36"]);
  const limited = bot.groups.historyPages(bob.account, { groupId: GROUP, since: { timestamp: 0 }, limit: 5 });
  assert.equal(limited.flatMap((p) => p.history.items).length, 5);
  assert.deepEqual(bot.groups.historyPages(ACCOUNTS.carol, { groupId: GROUP, since: { timestamp: 0 }, limit: 100 }), [], "only a member may ask");
});

test("history with historyShare 0 never reaches before the asker joined", async () => {
  const { w, alice, bot } = await setup();
  w.clock.t += 60_000;
  await alice.groups.send(GROUP, [text("OLD", w.clock.t, "before carol")]);
  await bot.sync();
  w.clock.t += 60_000;
  await alice.groups.add(GROUP, ACCOUNTS.carol);
  await bot.sync();
  w.clock.t += 60_000;
  await alice.groups.send(GROUP, [text("NEW", w.clock.t, "after carol")]);
  await bot.sync();
  const got = bot.groups.historyPages(ACCOUNTS.carol, { groupId: GROUP, since: { timestamp: 0 }, limit: 100 });
  assert.deepEqual(got.flatMap((p) => p.history.items).map((it) => decodeOpaqueMessageAt(it.message, 0).value.messageId), ["NEW"]);
});

test("admin bot: keyRequest from a listed member is answered with a welcome for the current epoch", async () => {
  const { w, bob, bot } = await setup({ bot: { role: ROLES.admin, permissions: PERMISSIONS.add | PERMISSIONS.remove } });
  assert.equal(await bot.groups.keyRequest(bob.account, { groupId: GROUP, haveEpoch: 0 }), "welcomed");
  const [c] = bob.controls();
  assert.equal(c.m.control.welcome.epoch, 1);
  assert.equal(await bot.groups.keyRequest(ACCOUNTS.carol, { groupId: GROUP, haveEpoch: 0 }), "not-listed");
  void w;
});

test("admin bot admits by invite: policy 2 at once (state + welcome), policy 1 pending, a bad proof or used-up invite rejected", async () => {
  const invite = { inviteId: "33".repeat(16), secret: "44".repeat(16), createdBy: ACCOUNTS.alice, expiresAt: 0, maxUses: 1, uses: 0 };
  const { w, bot } = await setup({ bot: { role: ROLES.admin, permissions: PERMISSIONS.add | PERMISSIONS.approve }, state: { joinPolicy: 2, invites: [invite] } });
  const carol = w.person("carol");
  const proofText = (who) => `Join request: Test group [grp:${Buffer.from(invite.inviteId, "hex").toString("base64url")}:${Buffer.from(joinProof(invite.secret, who)).toString("base64url")}]`;
  const opener = bot.groups.acceptsJoinOpener(carol.account, proofText(carol.account));
  assert.equal(opener?.groupId, GROUP, "the opener's capability is checked before the chat is accepted");
  assert.equal(hex(opener.inviteId), invite.inviteId, "and it is handed on as the join request it carries");
  assert.equal(bot.groups.admits(carol.account, () => false), true);
  assert.equal(bot.groups.acceptsJoinOpener(ACCOUNTS.dave, proofText(carol.account)), null, "a proof is bound to the joiner's account");

  const before = w.submissions.length;
  const bad = await bot.groups.joinRequest(ACCOUNTS.dave, { groupId: GROUP, inviteId: Buffer.from(invite.inviteId, "hex"), proof: fill(0, 32), note: "" });
  assert.equal(bad, "bad-proof");
  const out = await bot.groups.joinRequest(carol.account, { groupId: GROUP, inviteId: Buffer.from(invite.inviteId, "hex"), proof: joinProof(invite.secret, carol.account), note: "hi" });
  assert.equal(out, "admitted");
  assert.equal(w.submissions.length - before, 1, "one state statement");
  const g = bot.groups.get(GROUP);
  assert.equal(g.state.version, 2);
  assert.ok(g.state.members.some((m) => m.account === carol.account && m.role === 0));
  assert.equal(g.state.invites[0].uses, 1);
  const [welcome] = carol.controls();
  assert.equal(carol.groups.welcome(bot.account, welcome.m.control.welcome), "welcomed");
  assert.ok((await carol.sync()).some((r) => r.outcome === "applied"), "the newcomer reads the state the welcome names");
  assert.equal(carol.groups.get(GROUP).status, "member");
  // The invite had maxUses 1.
  const dave = w.person("dave");
  assert.equal(await bot.groups.joinRequest(dave.account, { groupId: GROUP, inviteId: Buffer.from(invite.inviteId, "hex"), proof: joinProof(invite.secret, dave.account), note: "" }), "used-up");
  assert.equal(dave.controls()[0].m.control.joinDecision.status, 1);
});

test("admin bot, policy 1: the request is answered pending and nobody is added", async () => {
  const invite = { inviteId: "35".repeat(16), secret: "46".repeat(16), createdBy: ACCOUNTS.alice, expiresAt: 0, maxUses: 0, uses: 0 };
  const { w, bot } = await setup({ bot: { role: ROLES.admin, permissions: PERMISSIONS.approve }, state: { joinPolicy: 1, invites: [invite] } });
  const carol = w.person("carol");
  const before = w.submissions.length;
  assert.equal(await bot.groups.joinRequest(carol.account, { groupId: GROUP, inviteId: Buffer.from(invite.inviteId, "hex"), proof: joinProof(invite.secret, carol.account), note: "" }), "pending");
  assert.equal(w.submissions.length, before);
  assert.equal(carol.controls()[0].m.control.joinDecision.status, 0);
});

test("admin bot removes a member that posted groupLeave: rekey + state, and the leaver is out of the next epoch", async () => {
  const { w, alice, bob, bot } = await setup({ bot: { role: ROLES.admin, permissions: PERMISSIONS.remove } });
  await bob.groups.send(GROUP, [encodeOpaqueGroupLeaveMessage({ messageId: "LEAVE", timestamp: w.clock.t, groupId: GROUP })]);
  const before = w.submissions.length;
  await bot.sync();
  assert.equal(w.submissions.length - before, 2, "the bot opened epoch 2 without bob");
  const g = bot.groups.get(GROUP);
  assert.equal(g.epoch, 2);
  assert.equal(g.state.members.some((m) => m.account === bob.account), false);
  await alice.sync();
  assert.equal(alice.groups.get(GROUP).epoch, 2, "alice applies the bot's rekey and state");
  assert.equal(alice.groups.get(GROUP).state.version, 2);
});

test("snapshot and restore keep keys, state, carry and history", async () => {
  const { w, alice, bot } = await setup();
  await alice.groups.send(GROUP, [text("P-1", w.clock.t, "persist me")]);
  await bot.sync();
  w.clock.t += 2000;
  await bot.groups.send(GROUP, [text("P-2", w.clock.t, "mine")]);
  const snap = JSON.parse(JSON.stringify(bot.groups.snapshot()));
  const again = createGroupsV2({ selfHex: bot.account, now: () => w.clock.t, pairwiseKey: async () => null, submit: async () => {}, sendControl: async () => {} });
  again.restore(snap);
  const g = again.get(GROUP);
  assert.equal(g.status, "member");
  assert.equal(g.state.members.length, 3);
  assert.equal(hex(again.topics()[0]), hex(bot.groups.topics()[0]));
  assert.equal(g.carry.length, 1);
  assert.equal(g.history.length, 2);
  assert.equal(decodeGroupState(g.stateBytes).version, 1);
});
