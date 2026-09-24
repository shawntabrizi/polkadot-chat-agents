import { test } from "node:test";
import assert from "node:assert/strict";
import { createFlip, FLIP_OFFER_TEXT, FLIP_STAKE_PLANCKS, FLIP_STAKE_WORST, FLIP_TOPICS } from "../lib/flip.mjs";
import { eventTopic, reviveAddress, reviveIntentLimits, selector } from "../lib/revive-chain.mjs";
import { decodeOpaqueMessageAt, decodeTxIntent, encodeOpaqueButtonsMessage } from "../vendor/app-chat-codec.mjs";

const PAS = 10_000_000_000n;
const RATIO = 100_000_000n; // 1 PAS = 1e18 in the contract
const GENESIS = `0x${"d6".repeat(32)}`;
const CONTRACT = "0x68b113b3ad6abbe9177997ea4645313c72656b58";
const ALICE = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const BOB = "8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";
const A160 = reviveAddress(`0x${ALICE}`);
const B160 = reviveAddress(`0x${BOB}`);
const SETTLE_HASH = `0x${"5e".repeat(32)}`;

// ABI shapes exactly as the Flip contract emits them (Solidity event encoding).
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const addrWord = (h160) => h160.slice(2).padStart(64, "0");
const bytesOf = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const staked = (round, h160, hash) => ({ topics: [FLIP_TOPICS.staked, `0x${word(round)}`, `0x${addrWord(h160)}`], data: new Uint8Array(0), extrinsicIndex: 2, extrinsicHash: hash });
const matched = (round, p1, p2) => ({ topics: [FLIP_TOPICS.matched, `0x${word(round)}`], data: bytesOf(addrWord(p1) + addrWord(p2)), extrinsicIndex: 2, extrinsicHash: SETTLE_HASH });
const settled = (round, winner) => ({ topics: [FLIP_TOPICS.settled, `0x${word(round)}`, `0x${addrWord(winner)}`], data: bytesOf(word(PAS * RATIO)), extrinsicIndex: 2, extrinsicHash: SETTLE_HASH });

const setup = ({ usernames = {} } = {}) => {
  const sent = [];
  const logs = [];
  let watcher = null;
  const chain = {
    genesisHash: async () => GENESIS,
    nativeToEthRatio: async () => RATIO,
    watchContractEvents(contract, onBlock) {
      assert.equal(contract, CONTRACT);
      watcher = onBlock;
      return () => { watcher = null; };
    },
  };
  const flip = createFlip({
    chain,
    contract: CONTRACT,
    now: () => 1_720_000_000_000,
    usernameOf: async (peer) => usernames[peer] ?? null,
    send: {
      buttons: async (peer, text, rows) => { sent.push({ type: "buttons", peer, text, rows }); },
      reference: async (peer, ref) => { sent.push({ type: "reference", peer, ref }); },
    },
    log: (event, extra) => logs.push({ event, ...extra }),
  });
  flip.start();
  return { flip, sent, logs, block: (number, events) => watcher({ number, hash: `0x${"0b".repeat(32)}`, events }) };
};

// The topics the bot filters on must be the contract's event signatures.
test("event topics are the Flip event signatures", () => {
  assert.equal(FLIP_TOPICS.settled, eventTopic("Settled(uint256,address,uint256)"));
  assert.equal(FLIP_TOPICS.staked, eventTopic("Staked(uint256,address)"));
  assert.equal(FLIP_STAKE_PLANCKS, PAS / 2n);
});

// Every message (accept opener, /stake, any text) gets the same stake
// button: a spec 0007 tx intent for stake() with exactly 0.5 PAS, which the
// client dry-runs. A wrong selector or value would stake nothing or revert.
test("any message is answered with a Stake 0.5 PAS tx button", async () => {
  const { flip, sent, logs } = setup();
  assert.equal(await flip.handle(ALICE, { kind: "text", text: "hello" }), true);
  assert.equal(await flip.handle(ALICE, { kind: "text", text: "/stake" }), true);
  assert.equal(sent.length, 2);
  const [offer] = sent;
  assert.equal(offer.text, FLIP_OFFER_TEXT);
  assert.equal(offer.text, "Stake 0.5 PAS to flip. The second staker triggers the flip; the winner takes 1 PAS.");
  const [[button]] = offer.rows;
  assert.equal(button.label, "Stake 0.5 PAS");
  const intent = button.action.tx;
  assert.equal(intent.chainId, GENESIS);
  assert.deepEqual(intent.calls, [{ kind: 1, to: CONTRACT, data: selector("stake()"), value: 5_000_000_000n, ...reviveIntentLimits(FLIP_STAKE_WORST) }]);
  assert.deepEqual([intent.display.amount, intent.display.asset], ["0.5", "PAS"]);
  assert.equal(intent.expiresAt, 1_720_000_000_000 + 10 * 60_000);
  assert.deepEqual(logs.filter((l) => l.event === "BOT_FLIP_OFFERED").map((l) => l.on), ["message", "command"]);
  // It encodes as a buttons message whose tx payload decodes back to the call.
  const opaque = encodeOpaqueButtonsMessage({ text: offer.text, rows: offer.rows });
  const decoded = decodeTxIntent(decodeOpaqueMessageAt(opaque, 0).value.rows[0][0].action.tx);
  assert.equal(decoded.calls[0].value, 5_000_000_000n);
  assert.equal(`0x${Buffer.from(decoded.calls[0].to).toString("hex")}`, CONTRACT);
});

// M12h, 2026-09-24: a second stake was dry-run while the first one waited
// (the settling path: a refund, so the estimate's deposit was 0), then ran
// as a FIRST stake (a reorg put it before the first one) and failed with
// Revive.StorageDepositLimitExhausted. The mirror case (dry-run of a first
// stake, run as the settling one) failed with Revive.OutOfGas. The intent's
// limits must cover the worst path of the stake whatever path the client's
// dry-run took. Values: ReviveApi_call on devnet Asset Hub, 2026-09-24.
test("the stake intent's limits cover both paths of stake(), whatever the client's dry-run saw", async () => {
  const { flip, sent } = setup();
  await flip.handle(ALICE, { kind: "text", text: "hi" });
  const opaque = encodeOpaqueButtonsMessage({ text: sent[0].text, rows: sent[0].rows });
  const [call] = decodeTxIntent(decodeOpaqueMessageAt(opaque, 0).value.rows[0][0].action.tx).calls;
  const firstStake = { deposit: 52_800_000n, refTime: 669_639_182n, proofSize: 76_080n };
  const settlingStake = { deposit: 0n /* Refund 52 800 000 */, refTime: 1_515_302_851n, proofSize: 104_574n };
  for (const path of [firstStake, settlingStake]) {
    assert.ok(call.storageDepositLimit >= path.deposit + PAS / 10n, "at least 0.1 PAS over the deposit of either path");
    assert.ok(call.gasRefTime >= path.refTime + path.refTime / 2n, "ref_time 1.5x either path");
    assert.ok(call.gasProofSize >= path.proofSize + path.proofSize / 2n, "proof_size 1.5x either path");
  }
  // What the desktop signed with in the failed run: its estimate of the settling path + 20% + 1.
  assert.ok(call.storageDepositLimit > 1n, "a limit from the settling dry-run (1 planck) is what failed");
});

// The rule (spec 0007 note for kind 1): a small deposit gets 0.1 PAS of
// headroom (one more storage slot is ~0.0026 PAS, so x1.5 alone would not
// cover a path that stores one slot more); a large one gets x1.5.
test("reviveIntentLimits: deposit max(x1.5, +0.1 PAS), weight x1.5", () => {
  assert.deepEqual(reviveIntentLimits({ deposit: 0n, refTime: 10n, proofSize: 4n }), { gasRefTime: 15n, gasProofSize: 6n, storageDepositLimit: PAS / 10n });
  assert.equal(reviveIntentLimits({ deposit: 52_800_000n, refTime: 0n, proofSize: 0n }).storageDepositLimit, 52_800_000n + PAS / 10n);
  assert.equal(reviveIntentLimits({ deposit: PAS, refTime: 0n, proofSize: 0n }).storageDepositLimit, (PAS * 3n) / 2n);
});

// Both players learn the result in their own chat, with the settling
// extrinsic, and the note names the winner by username.
test("a settlement posts a reference to both players' chats", async () => {
  const { flip, sent, logs, block } = setup({ usernames: { [BOB]: "bob.01" } });
  await flip.handle(ALICE, { kind: "text", text: "hi" });
  await flip.handle(BOB, { kind: "text", text: "hi" });
  sent.length = 0;
  await block(100, [staked(1, A160, `0x${"aa".repeat(32)}`)]);
  assert.equal(sent.length, 0, "a first stake alone settles nothing");
  await block(101, [staked(1, B160, SETTLE_HASH), matched(1, A160, B160), settled(1, B160)]);
  assert.deepEqual(sent.map((s) => s.peer).sort(), [ALICE, BOB].sort());
  for (const s of sent) {
    assert.equal(s.type, "reference");
    assert.deepEqual(s.ref, { chainId: GENESIS, hash: SETTLE_HASH, status: 1, block: 101, note: "Flip settled: bob.01 won 1 PAS" });
  }
  assert.deepEqual(logs.filter((l) => l.event === "BOT_FLIP_NOTIFIED").map((l) => [l.peer, l.winner]).sort(), [[ALICE, false], [BOB, true]].sort());
  // The same block again (a reorg re-delivers it): no second notice.
  await block(101, [staked(1, B160, SETTLE_HASH), matched(1, A160, B160), settled(1, B160)]);
  assert.equal(sent.length, 2);
});

// No username on the People chain: the note falls back to the address.
// A player the bot never talked to is logged, not guessed.
test("unknown username falls back to 0x; an unknown player is not notified", async () => {
  const { flip, sent, logs, block } = setup();
  flip.remember(ALICE); // e.g. restored from the session state
  await block(7, [matched(3, A160, B160), settled(3, A160)]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].peer, ALICE);
  assert.equal(sent[0].ref.note, `Flip settled: ${A160} won 1 PAS`);
  assert.deepEqual(logs.filter((l) => l.event === "BOT_FLIP_UNKNOWN_PLAYER").map((l) => l.player), [B160]);
});

// A received reference (the client's own stake report) maps that peer's
// address, so a peer who only sent a reference still gets the result.
test("a received transactionReference maps the peer's contract address", async () => {
  const { flip, sent, block } = setup();
  flip.onReference(BOB, { status: 1, hash: "0x01" });
  await block(9, [matched(4, A160, B160), settled(4, B160)]);
  assert.deepEqual(sent.map((s) => s.peer), [BOB]);
});

// One failed send must not stop the other player's notice.
test("a failed reference to one player still notifies the other", async () => {
  const sent = [];
  const logs = [];
  let watcher;
  const flip = createFlip({
    chain: { genesisHash: async () => GENESIS, nativeToEthRatio: async () => RATIO, watchContractEvents: (c, f) => { watcher = f; return () => {}; } },
    contract: CONTRACT,
    send: {
      buttons: async () => {},
      reference: async (peer, ref) => { if (peer === ALICE) throw new Error("no active session for peer"); sent.push({ peer, ref }); },
    },
    log: (event, extra) => logs.push({ event, ...extra }),
  });
  flip.start();
  flip.remember(ALICE);
  flip.remember(BOB);
  await watcher({ number: 5, hash: "0x", events: [matched(5, A160, B160), settled(5, A160)] });
  assert.deepEqual(sent.map((s) => s.peer), [BOB]);
  assert.equal(logs.filter((l) => l.event === "BOT_FLIP_NOTIFY_FAILED").length, 1);
});

test("the contract address is validated", () => {
  assert.throws(() => createFlip({ chain: {}, contract: "0x1234", send: {} }), /BOT_FLIP_CONTRACT/);
});
