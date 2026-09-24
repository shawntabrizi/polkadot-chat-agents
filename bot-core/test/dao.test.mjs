// DAO chat (M14) in memory: the pcddao bot is an admin of a real
// lib/groups-v2.mjs group (test/fixtures/group-world.mjs) and talks to a fake
// chain. Why each case matters:
//   - a proposal is money leaving the group treasury: only a member may ask
//     for one, and the calldata the bot signs must name the recipient, the
//     amount in contract units and the deadline it announces;
//   - the vote, execute and withdraw buttons are intents a member's client
//     signs: a wrong selector, value or limit stakes nothing, reverts, or
//     fails on another contract path (0007 "Limits of a Revive call");
//   - the group sees the vote as it happens: one tally line per Voted event,
//     never two for one vote (reorgs deliver an event again);
//   - the statement budget: /propose is 2 statements (message + pin), each
//     event 1, a withdrawal 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDao, DAO_CLOSE_GRACE_MS, DAO_STAKE_PLANCKS, DAO_SUBSCAN, DAO_TOPICS, DAO_WORST, emittedBy, isDaoCommand, parsePasAmount,
} from "../lib/dao.mjs";
import { daoCalldata, daoGroupKey, eventTopic, INTENT_DEPOSIT_HEADROOM, reviveAddress, reviveIntentLimits, selector } from "../lib/revive-chain.mjs";
import { decodeTxIntent } from "../vendor/app-chat-codec.mjs";
import { ACCOUNTS, GROUP, setup } from "./fixtures/group-world.mjs";

const PAS = 10_000_000_000n;
const RATIO = 100_000_000n;
const GENESIS = `0x${"d6".repeat(32)}`;
const CONTRACT = "0x073f0e29750b26286befd15619d24ee77e014d87";
const VOTING_SECS = 90;
const NAMES = { alice: "alice.01", bob: "bob.02", bot: "pcddao.03", carol: "carol.04", dave: "dave.05" };
const byAccount = Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [ACCOUNTS[k], v]));
const h160 = (name) => reviveAddress(`0x${ACCOUNTS[name]}`);
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const addrWord = (a) => a.slice(2).padStart(64, "0");
const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const ZERO_WORD = new Uint8Array(32);
const PROPOSE_HASH = `0x${"9a".repeat(32)}`;

// The Solidity event encodings the watcher reads.
const voted = (id, who, support, yes, no) => ({
  topics: [DAO_TOPICS.voted, `0x${word(id)}`, `0x${addrWord(h160(who))}`],
  data: bytesOf(word(support ? 1 : 0) + word(DAO_STAKE_PLANCKS * RATIO) + word(yes * RATIO) + word(no * RATIO)),
  extrinsicHash: `0x${"7e".repeat(32)}`,
});
const executed = (id) => ({ topics: [DAO_TOPICS.executed, `0x${word(id)}`, `0x${addrWord(h160("bob"))}`], data: bytesOf(word(2n * PAS / 10n * RATIO)), extrinsicHash: `0x${"e1".repeat(32)}` });
const withdrawn = (id, who) => ({ topics: [DAO_TOPICS.withdrawn, `0x${word(id)}`, `0x${addrWord(h160(who))}`], data: bytesOf(word(DAO_STAKE_PLANCKS * RATIO)), extrinsicHash: `0x${"d7".repeat(32)}` });

const daoWorld = async ({ members = ["carol"] } = {}) => {
  const world = await setup({ bot: { role: 1, permissions: 0x00ff } });
  const { w, alice, bot } = world;
  for (const name of members) await alice.groups.add(GROUP, ACCOUNTS[name]);
  await bot.sync();
  const calls = []; // the bot's signed contract calls
  const admins = new Map(); // group key -> admin H160 (the contract's groupAdmin)
  let nextId = 0n;
  let watcher = null;
  const chain = {
    genesisHash: async () => GENESIS,
    nativeToEthRatio: async () => RATIO,
    ensureMapped: async () => false,
    read: async ({ calldata }) => {
      if (calldata.startsWith(selector("groupAdmin(bytes32)"))) {
        const admin = admins.get(`0x${calldata.slice(10, 74)}`);
        return admin ? bytesOf(addrWord(admin)) : ZERO_WORD;
      }
      throw new Error(`unexpected read ${calldata.slice(0, 10)}`);
    },
    callContract: async (pair, { dest, calldata, value = 0n }) => {
      assert.equal(dest, CONTRACT);
      calls.push({ calldata, value });
      if (calldata.startsWith(selector("setMembers(bytes32,address[],address[])"))) admins.set(`0x${calldata.slice(10, 74)}`, h160("bot"));
      const events = [];
      if (calldata.startsWith(selector("propose(bytes32,string,address,uint256,bytes,uint64)"))) {
        nextId += 1n;
        events.push({ type: "Revive", value: { type: "ContractEmitted", value: {
          contract: CONTRACT, topics: [DAO_TOPICS.proposed, `0x${word(nextId)}`, `0x${calldata.slice(10, 74)}`, `0x${addrWord(h160("bot"))}`], data: new Uint8Array(0),
        } } });
      }
      return { ok: true, hash: PROPOSE_HASH, block: 100 + calls.length, events };
    },
    watchContractEvents(contract, onBlock) { assert.equal(contract, CONTRACT); watcher = onBlock; return () => { watcher = null; }; },
  };
  const logs = [];
  const dao = createDao({
    chain, contract: CONTRACT, pair: { publicKey: bytesOf(ACCOUNTS.bot) }, selfHex: ACCOUNTS.bot, groupsV2: bot.groups,
    // The bot's own group statement; one per second at most (0011), as the
    // index.mjs outbox waits for it.
    sendGroup: async (groupId, opaques) => {
      w.clock.t += 1000;
      const res = await bot.groups.send(groupId, opaques);
      assert.equal(res.ok, true, JSON.stringify(res));
    },
    accountOf: async (name) => Object.entries(byAccount).find(([, v]) => v === name)?.[0] ?? null,
    usernameOf: async (account) => byAccount[account] ?? null,
    votingSecs: VOTING_SECS,
    now: () => w.clock.t,
    log: (event, extra) => logs.push({ event, ...extra }),
  });
  dao.start({ tickMs: 3_600_000 });
  // What alice reads from the bot: every new message, decoded.
  const fromBot = async () => (await alice.sync()).flatMap((r) => (r.from === ACCOUNTS.bot ? r.messages : [])).map((x) => x.message);
  const botStatements = async (fn) => {
    const before = w.submissions.filter((s) => s.who === "bot").length;
    await fn();
    return w.submissions.filter((s) => s.who === "bot").length - before;
  };
  return { ...world, dao, calls, admins, logs, fromBot, botStatements, block: (number, events) => watcher({ number, hash: `0x${"0b".repeat(32)}`, events }) };
};
const buttonIntent = (msg, row, index) => decodeTxIntent(msg.rows[row][index].action.tx);

test("only /propose and /proposals are DAO commands", () => {
  for (const t of ["/propose Pay | 1 PAS to bob", "/proposals", " /PROPOSE x ", "/propose"]) assert.equal(isDaoCommand(t), true, t);
  for (const t of ["/proposal", "/proposeall", "propose x", "please /propose x", "/pin x"]) assert.equal(isDaoCommand(t), false, t);
  assert.equal(parsePasAmount("0.2"), 2n * PAS / 10n);
  assert.equal(parsePasAmount("1"), PAS);
  assert.equal(parsePasAmount("0.00000000001"), null, "below a planck");
});

// The encoder must match the Solidity ABI (cast calldata output), or the
// contract reads a wrong group, amount or deadline.
test("Dao calldata matches the Solidity ABI encoding", () => {
  const g = `0x${"11".repeat(32)}`;
  assert.equal(
    daoCalldata.propose({ groupKey: g, title: "hi", target: `0x${"22".repeat(20)}`, value: 5n, deadline: 100 }),
    `0x118f2fc8${"11".repeat(32)}${word(0xc0)}${addrWord(`0x${"22".repeat(20)}`)}${word(5)}${word(0x100)}${word(100)}${word(2)}6869${"0".repeat(60)}${word(0)}`,
  );
  assert.equal(
    daoCalldata.setMembers(g, [`0x${"aa".repeat(20)}`], []),
    `0x542cb45c${"11".repeat(32)}${word(0x60)}${word(0xa0)}${word(1)}${addrWord(`0x${"aa".repeat(20)}`)}${word(0)}`,
  );
  assert.equal(daoCalldata.vote(7n, true), `${selector("vote(uint256,bool)")}${word(7)}${word(1)}`);
  assert.equal(DAO_TOPICS.voted, eventTopic("Voted(uint256,address,bool,uint256,uint256,uint256)"));
});

test("a non-member cannot propose; nothing goes on chain", async () => {
  const { dao, calls, fromBot, logs } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.dave, "/propose Pay me | 5 PAS to dave.05");
  assert.equal(calls.length, 0);
  const [reply] = await fromBot();
  assert.equal(reply.text, "Refused: only members of Test group can make proposals.");
  assert.equal(logs.find((l) => l.event === "BOT_DAO_REFUSED")?.reason, "not-member");
});

test("/propose registers the members, creates the proposal, posts it with vote buttons and pins it: 2 statements", async () => {
  const { w, dao, calls, fromBot, botStatements, alice } = await daoWorld();
  const t0 = w.clock.t;
  const count = await botStatements(() => dao.command(GROUP, ACCOUNTS.alice, "/propose Pay the designer | 0.2 PAS to bob.02"));
  assert.equal(count, 2, "the proposal message + one state statement for the pin");
  const key = daoGroupKey(GROUP);
  // Members are every account in the group but the bot.
  assert.equal(calls[0].calldata, daoCalldata.setMembers(key, [h160("alice"), h160("bob"), h160("carol")], []));
  const deadline = Math.floor(t0 / 1000) + VOTING_SECS;
  assert.equal(calls[1].calldata, daoCalldata.propose({ groupKey: key, title: "Pay the designer", target: h160("bob"), value: 2n * PAS / 10n * RATIO, deadline }));
  const [msg] = await fromBot();
  assert.equal(msg.kind, "buttons");
  assert.match(msg.text, /^Proposal #1: Pay the designer\nPay 0\.2 PAS to bob\.02 from the group treasury\.\nProposed by alice\.01\. Voting closes in 90 s/);
  assert.deepEqual(msg.rows.map((r) => r.map((b) => b.label)), [["Vote yes (stake 0.1 PAS)", "Vote no (stake 0.1 PAS)"], ["View on Subscan"]]);
  assert.equal(msg.rows[1][0].action.url, `${DAO_SUBSCAN}/extrinsic/${PROPOSE_HASH}`);
  for (const [i, support] of [[0, true], [1, false]]) {
    const intent = buttonIntent(msg, 0, i);
    assert.equal(intent.chainId, GENESIS);
    assert.equal(intent.expiresAt, BigInt(deadline * 1000), "no vote after the deadline");
    const [call] = intent.calls;
    assert.equal(`0x${Buffer.from(call.to).toString("hex")}`, CONTRACT);
    assert.equal(`0x${Buffer.from(call.data).toString("hex")}`, daoCalldata.vote(1n, support));
    assert.equal(call.value, DAO_STAKE_PLANCKS, "the contract's MIN_STAKE, 0.1 PAS");
  }
  assert.deepEqual(alice.groups.get(GROUP).state.pinned, [msg.messageId], "the members see the pin");
  // Same roster: the second proposal needs no setMembers.
  await dao.command(GROUP, ACCOUNTS.bob, "/propose Buy snacks | 1 PAS to carol");
  assert.equal(calls.length, 3);
  assert.match(calls[2].calldata, new RegExp(`^${selector("propose(bytes32,string,address,uint256,bytes,uint64)")}`));
});

// 0007: each intent's limits are its worst case over every contract path, x1.5.
test("every intent carries the worst-case limits", async () => {
  const { w, dao, fromBot } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Pay | 0.2 PAS to bob.02");
  const [msg] = await fromBot();
  const limitsOf = (intent) => { const [c] = intent.calls; return { gasRefTime: c.gasRefTime, gasProofSize: c.gasProofSize, storageDepositLimit: c.storageDepositLimit }; };
  assert.deepEqual(limitsOf(buttonIntent(msg, 0, 0)), reviveIntentLimits(DAO_WORST.vote));
  await dao.onBlock({ number: 1, events: [voted(1, "alice", true, DAO_STAKE_PLANCKS, 0n)] });
  await fromBot();
  w.clock.t += VOTING_SECS * 1000 + DAO_CLOSE_GRACE_MS;
  await dao.tick();
  const [closed] = (await fromBot()).filter((m) => m.kind === "buttons");
  assert.deepEqual(limitsOf(buttonIntent(closed, 0, 0)), reviveIntentLimits(DAO_WORST.execute));
  assert.deepEqual(limitsOf(buttonIntent(closed, 0, 1)), reviveIntentLimits(DAO_WORST.withdraw));
  const vote = reviveIntentLimits(DAO_WORST.vote);
  assert.equal(vote.gasRefTime, DAO_WORST.vote.refTime * 3n / 2n);
  assert.equal(vote.storageDepositLimit, DAO_WORST.vote.deposit + INTENT_DEPOSIT_HEADROOM, "a small deposit gets the 0.1 PAS headroom");
  assert.equal(reviveIntentLimits(DAO_WORST.withdraw).storageDepositLimit, INTENT_DEPOSIT_HEADROOM, "a refund path still has a cap");
});

test("lifecycle: votes tally one line each, the deadline posts Execute and Withdraw, execution is announced", async () => {
  const { w, dao, fromBot, botStatements, logs } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Pay the designer | 0.2 PAS to bob.02");
  const [proposal] = await fromBot();
  const S = DAO_STAKE_PLANCKS;
  const lines = [];
  for (const [ev, expected] of [
    [voted(1, "alice", true, S, 0n), "Tally #1: yes 0.1 PAS (1 vote), no 0 PAS (0 votes). alice.01 voted yes with 0.1 PAS."],
    [voted(1, "bob", true, 2n * S, 0n), "Tally #1: yes 0.2 PAS (2 votes), no 0 PAS (0 votes). bob.02 voted yes with 0.1 PAS."],
    [voted(1, "carol", false, 2n * S, S), "Tally #1: yes 0.2 PAS (2 votes), no 0.1 PAS (1 vote). carol.04 voted no with 0.1 PAS."],
  ]) {
    assert.equal(await botStatements(() => dao.onBlock({ number: 10, events: [ev] })), 1, "one statement per Voted event");
    const [line] = await fromBot();
    assert.equal(line.kind, "reply");
    assert.equal(line.replyToMessageId, proposal.messageId, "the tally answers the proposal message");
    assert.equal(line.text, expected);
    lines.push(line.text);
  }
  // A reorg delivers the same event again: no second line.
  assert.equal(await botStatements(() => dao.onBlock({ number: 11, events: [voted(1, "carol", false, 2n * S, S)] })), 0);
  // Before the deadline (and its grace) nothing closes.
  w.clock.t += VOTING_SECS * 1000;
  assert.equal(await botStatements(() => dao.tick()), 0);
  w.clock.t += DAO_CLOSE_GRACE_MS;
  assert.equal(await botStatements(() => dao.tick()), 1);
  const [closed] = await fromBot();
  assert.match(closed.text, /^Voting on #1 "Pay the designer" closed: passed\. Yes 0\.2 PAS, no 0\.1 PAS\.\nAnyone can press Execute to pay 0\.2 PAS to bob\.02/);
  assert.deepEqual(closed.rows.map((r) => r.map((b) => b.label)), [["Execute", "Withdraw stake"]]);
  assert.equal(`0x${Buffer.from(buttonIntent(closed, 0, 0).calls[0].data).toString("hex")}`, daoCalldata.execute(1n));
  assert.equal(buttonIntent(closed, 0, 0).calls[0].value, 0n);
  assert.equal(`0x${Buffer.from(buttonIntent(closed, 0, 1).calls[0].data).toString("hex")}`, daoCalldata.withdraw(1n));
  assert.equal(await botStatements(() => dao.tick()), 0, "the result is posted once");
  assert.equal(await botStatements(() => dao.onBlock({ number: 30, events: [executed(1)] })), 1);
  const [done] = await fromBot();
  assert.equal(done.text, "Proposal #1 executed: 0.2 PAS paid to bob.02.");
  // A withdrawal costs no statement; it is logged.
  assert.equal(await botStatements(() => dao.onBlock({ number: 31, events: [withdrawn(1, "bob")] })), 0);
  assert.equal(logs.find((l) => l.event === "BOT_DAO_WITHDRAWN")?.voter, h160("bob"));
  assert.equal(dao.proposals()[0].executed, true);
});

test("a rejected proposal offers only Withdraw stake; /proposals lists what is still open", async () => {
  const { w, dao, fromBot } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose One | 1 PAS to bob.02");
  await dao.command(GROUP, ACCOUNTS.bob, "/propose Two | 2 PAS to alice.01");
  await dao.onBlock({ number: 5, events: [voted(1, "alice", true, DAO_STAKE_PLANCKS, 0n), voted(1, "bob", false, DAO_STAKE_PLANCKS, DAO_STAKE_PLANCKS)] });
  await fromBot();
  await dao.command(GROUP, ACCOUNTS.carol, "/proposals");
  const [list] = await fromBot();
  assert.match(list.text, /^Open proposals in Test group:\n#1 One: 1 PAS to bob\.02\. Yes 0\.1 PAS, no 0\.1 PAS; closes in \d+ s\.\n#2 Two: 2 PAS to alice\.01\. Yes 0 PAS, no 0 PAS; closes in/);
  w.clock.t += VOTING_SECS * 1000 + DAO_CLOSE_GRACE_MS;
  await dao.tick();
  const closed = await fromBot();
  const one = closed.find((m) => m.text.includes("#1"));
  assert.match(one.text, /closed: rejected\. Yes 0\.1 PAS, no 0\.1 PAS\.\nNothing is paid/, "a tie does not pass");
  assert.deepEqual(one.rows.map((r) => r.map((b) => b.label)), [["Withdraw stake"]]);
  const two = closed.find((m) => m.text.includes("#2"));
  assert.match(two.text, /Nobody voted\.$/);
  await dao.command(GROUP, ACCOUNTS.carol, "/proposals");
  assert.equal((await fromBot())[0].text, "No open proposals in Test group.");
});

test("the roster follows the group: a removed member is taken off the contract", async () => {
  const { dao, calls, alice, bot } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose One | 1 PAS to bob.02");
  await alice.groups.remove(GROUP, ACCOUNTS.carol);
  await bot.sync();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Two | 1 PAS to bob.02");
  assert.equal(calls[2].calldata, daoCalldata.setMembers(daoGroupKey(GROUP), [], [h160("carol")]));
});

test("a bad /propose gets the usage; a group another account manages is refused", async () => {
  const { dao, fromBot, calls, admins } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Pay bob 5");
  assert.match((await fromBot())[0].text, /^Usage: \/propose <title> \| <amount> PAS to <username>/);
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Pay | 1 PAS to nobody.99");
  assert.equal((await fromBot())[0].text, "I cannot find the user nobody.99.");
  assert.equal(calls.length, 0);
  // Someone else claimed this group id on the contract first: the bot must not propose there.
  admins.set(daoGroupKey(GROUP), `0x${"66".repeat(20)}`);
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Pay | 1 PAS to bob.02");
  assert.equal((await fromBot())[0].text, "The proposal did not go through: another account manages this group on the Dao contract.");
  assert.equal(calls.length, 0);
});

test("proposals and the registered roster survive a restart", async () => {
  const { dao, fromBot } = await daoWorld();
  await dao.command(GROUP, ACCOUNTS.alice, "/propose Pay | 0.2 PAS to bob.02");
  await dao.onBlock({ number: 2, events: [voted(1, "bob", true, DAO_STAKE_PLANCKS, 0n)] });
  await fromBot();
  const snap = JSON.parse(JSON.stringify(dao.snapshot()));
  const again = await daoWorld();
  again.dao.restore(snap);
  const [p] = again.dao.proposals();
  assert.equal(p.yes, DAO_STAKE_PLANCKS);
  assert.equal(p.to.name, "bob.02");
  await again.dao.command(GROUP, ACCOUNTS.alice, "/propose Next | 0.2 PAS to bob.02");
  assert.equal(again.calls.length, 1, "no setMembers: the roster was restored");
});

test("emittedBy reads a papi event list and ignores other contracts", () => {
  const ev = (contract) => ({ type: "Revive", value: { type: "ContractEmitted", value: { contract, topics: [DAO_TOPICS.proposed], data: "0x01" } } });
  const out = emittedBy([ev(CONTRACT), ev(`0x${"00".repeat(20)}`), { type: "System", value: { type: "ExtrinsicSuccess" } }], CONTRACT);
  assert.equal(out.length, 1);
  assert.deepEqual([...out[0].data], [1]);
});
