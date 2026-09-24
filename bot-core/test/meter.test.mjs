import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMeter, formatPas, METER_BATCH_MS, METER_BATCH_REPLIES, parsePlancks } from "../lib/meter.mjs";
import { meterCalldata, reviveAddress, selector } from "../lib/revive-chain.mjs";
import { createOutboundLanes } from "../lib/outbound-lanes.mjs";
import { createAgentRuntime } from "../lib/agent-runtime.mjs";
import { RUNNERS } from "../lib/runners.mjs";
import {
  decodeOpaqueMessageAt, decodeTxIntent, encodeOpaqueBotInfoMessage, encodeOpaqueButtonsMessage,
  encodeOpaqueSeenMessage, encodeOpaqueTextMessage, encodeOpaqueTransactionReferenceMessage,
} from "../vendor/app-chat-codec.mjs";

const PAS = 10_000_000_000n;
const RATIO = 100_000_000n; // Asset Hub NativeToEthRatio: 1 PAS = 1e18 in the contract
const GENESIS = `0x${"d6".repeat(32)}`;
const CONTRACT = `0x${"30".repeat(20)}`;
const PEER = "9eb681bc39734224669e4e261c271d628e8d87e4c3cb25636c0e248267ea2967";
const operator = { publicKey: new Uint8Array(32).fill(7) };

// A Meter contract in memory, reached only through the calldata the bot
// builds: a wrong selector or a wrong address encoding fails these tests.
const fakeChain = ({ balances = {}, failReads = false, dispatchFails = false, slow = false, delayMs = 0 } = {}) => {
  const state = { balances: new Map(Object.entries(balances).map(([a, p]) => [a, BigInt(p) * RATIO])), calls: [], mapped: 0, inFlight: 0, maxInFlight: 0 };
  const word = (hex, i) => hex.slice(10 + i * 64, 10 + (i + 1) * 64);
  return {
    state,
    genesisHash: async () => GENESIS,
    nativeToEthRatio: async () => RATIO,
    ensureMapped: async () => { state.mapped += 1; return state.mapped === 1; },
    async read({ dest, calldata }) {
      if (failReads) throw new Error("socket down");
      assert.equal(dest, CONTRACT);
      assert.equal(calldata.slice(0, 10), selector("balanceOf(address)"));
      const who = `0x${word(calldata, 0).slice(24)}`;
      return Uint8Array.from(Buffer.from((state.balances.get(who) ?? 0n).toString(16).padStart(64, "0"), "hex"));
    },
    async callContract(pair, { dest, calldata, value = 0n, onSlow }) {
      state.calls.push({ pair, dest, calldata, value });
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      state.inFlight -= 1;
      if (slow) onSlow?.(`0x${"cd".repeat(32)}`); // no block after 30 s, then included
      assert.equal(calldata.slice(0, 10), selector("charge(address,uint256)"));
      const who = `0x${word(calldata, 0).slice(24)}`;
      const amount = BigInt(`0x${word(calldata, 1)}`);
      const balance = state.balances.get(who) ?? 0n;
      if (balance < amount) return { ok: false, dryRun: true, error: "insufficient balance", hash: null, block: null };
      if (dispatchFails) return { ok: false, error: "Revive.OutOfGas", hash: `0x${"ab".repeat(32)}`, block: 9 };
      state.balances.set(who, balance - amount);
      return { ok: true, hash: `0x${"cd".repeat(32)}`, block: 123 };
    },
  };
};

// Timers that fire only when the test says so.
const manualTimers = () => {
  const pending = new Set();
  return {
    set: (fn, ms) => { const h = { fn, ms }; pending.add(h); return h; },
    clear: (h) => { pending.delete(h); },
    fire: () => { const all = [...pending]; pending.clear(); for (const h of all) h.fn(); return all.map((h) => h.ms); },
    size: () => pending.size,
  };
};

const setup = (chainOptions = {}, meterOptions = {}) => {
  const chain = fakeChain(chainOptions);
  const timers = manualTimers();
  const sent = [];
  const logs = [];
  const changes = { count: 0 };
  const meter = createMeter({
    chain,
    contract: CONTRACT,
    operator,
    name: "Meter",
    now: () => 1_720_000_000_000,
    send: {
      text: async (peer, text) => { sent.push({ type: "text", peer, text }); },
      buttons: async (peer, text, rows) => { sent.push({ type: "buttons", peer, text, rows }); },
      // Spec 0008 v3: a final reference also carries the pending hint.
      reference: async (peer, ref, extra) => { sent.push({ type: "reference", peer, ref, ...(extra ? { pending: extra.pending } : {}) }); },
    },
    log: (event, extra) => logs.push({ event, ...extra }),
    timers,
    onChange: () => { changes.count += 1; },
    ...meterOptions,
  });
  return { chain, sent, logs, meter, timers, changes, user: reviveAddress(`0x${PEER}`) };
};
const text = (t) => ({ kind: "text", text: t });

// The user's contract address must be the one pallet-revive derives for
// their chat account, or a top-up by the user and a charge by the bot would
// touch two different balances.
test("the user's contract address is pallet-revive's AccountId32 mapping", () => {
  // Checked live on devnet Asset Hub: ReviveApi_address(//Alice) returned this.
  assert.equal(reviveAddress("0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"), "0x9621dde636de098b43efb0fa9b61facfe328f99d");
  const ethDerived = new Uint8Array(32).fill(0xee); ethDerived.set(new Uint8Array(20).fill(0x12));
  assert.equal(reviveAddress(ethDerived), `0x${"12".repeat(20)}`, "an 0xEE-padded account maps back to its H160");
  assert.equal(meterCalldata.balanceOf("0x9621dde636de098b43efb0fa9b61facfe328f99d"), "0x70a082310000000000000000000000009621dde636de098b43efb0fa9b61facfe328f99d");
});

test("below the price: no brain turn, and a Top up button with a valid spec 0007 intent", async () => {
  const { meter, sent, chain, user } = setup({ balances: {} });
  chain.state.balances.set(user, (PAS / 20n) * RATIO); // 0.05 PAS
  const gate = await meter.beforeTurn(PEER, text("what is staking?"));
  assert.equal(gate.run, false, "the brain must not answer an unpaid question");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "buttons");
  assert.match(sent[0].text, /0\.05 PAS; a reply costs 0\.1 PAS/);
  const button = sent[0].rows[0][0];
  assert.equal(button.label, "Top up 1 PAS");
  // What the client receives: encode and decode it as the wire does.
  const m = decodeOpaqueMessageAt(encodeOpaqueButtonsMessage({ text: sent[0].text, rows: sent[0].rows }), 0).value;
  const intent = decodeTxIntent(m.rows[0][0].action.tx);
  assert.equal(intent.chainId, GENESIS, "chainId is the meter chain's genesis hash");
  assert.equal(intent.calls.length, 1);
  assert.equal(intent.calls[0].kind, 1, "a Revive contract call");
  assert.equal(`0x${Buffer.from(intent.calls[0].to).toString("hex")}`, CONTRACT);
  assert.equal(`0x${Buffer.from(intent.calls[0].data).toString("hex")}`, selector("topUp()"));
  assert.equal(intent.calls[0].value, PAS, "Top up sends 1 PAS in plancks");
  // A top-up can land after a charge that emptied the balance (the slot is
  // gone, so it stores a new one): the limits cover that path, 26 400 000
  // plancks and its weight (ReviveApi_call on devnet Asset Hub, 2026-09-24).
  assert.ok(intent.calls[0].storageDepositLimit >= 26_400_000n + PAS / 10n, "0.1 PAS over a new slot's deposit");
  assert.ok(intent.calls[0].gasRefTime >= (453_538_335n * 3n) / 2n && intent.calls[0].gasProofSize >= (45_218n * 3n) / 2n, "1.5x a new slot's weight");
  assert.equal(intent.dryRunRequired, true);
  assert.equal(intent.expiresAt, 0n, "a top-up is a fixed call: it never expires (spec 0007 expiresAt 0)");
  assert.deepEqual(intent.display, { title: "Top up", description: "Adds 1 PAS to your prepaid balance with Meter", amount: "1", asset: "PAS" });
  assert.equal(chain.state.calls.length, 0, "nothing is charged");
});

// Efficiency budget (M12c): one charge extrinsic per 5 metered replies, not
// one per reply. Each extrinsic also costs the user a reference message.
test("replies are charged in one extrinsic per 5, with one reference that reports what is left", async () => {
  assert.equal(METER_BATCH_REPLIES, 5);
  const { meter, sent, chain, user, logs } = setup();
  chain.state.balances.set(user, PAS * RATIO); // 1 PAS
  for (let i = 1; i <= 4; i += 1) {
    assert.deepEqual(await meter.beforeTurn(PEER, text(`question ${i}`)), { run: true, charge: true });
    assert.equal(await meter.afterTurn(PEER), null, `reply ${i} is pending, not charged`);
  }
  assert.equal(chain.state.calls.length, 0, "no extrinsic for 4 replies");
  assert.equal(sent.length, 0, "and no reference");
  assert.equal(meter.pendingDebit(PEER), 4n * PAS / 10n);
  await meter.beforeTurn(PEER, text("question 5"));
  const result = await meter.afterTurn(PEER);
  assert.equal(chain.state.calls.length, 1, "the 5th reply charges all five at once");
  assert.equal(chain.state.calls[0].pair, operator, "the bot's own wallet signs the charge");
  assert.equal(chain.state.calls[0].calldata, meterCalldata.charge(user, 5n * (PAS / 10n) * RATIO), "five prices, scaled into contract units");
  assert.equal(result.remaining, PAS / 2n);
  assert.deepEqual(sent, [{ type: "reference", peer: PEER, ref: { chainId: GENESIS, hash: `0x${"cd".repeat(32)}`, status: 1, block: 123, note: `balance: ${PAS / 2n}` }, pending: 0n }]);
  assert.equal(meter.pendingDebit(PEER), 0n);
  assert.ok(logs.some((l) => l.event === "BOT_METER_CHARGED" && l.replies === 5 && l.on === "batch"));
  for (let i = 0; i < 5; i += 1) { await meter.beforeTurn(PEER, text("more")); await meter.afterTurn(PEER); }
  assert.equal(chain.state.calls.length, 2);
  assert.equal(chain.state.mapped, 1, "the operator account is mapped once, not per charge");
});

test("the pending debit is charged 10 min after the first pending reply", async () => {
  assert.equal(METER_BATCH_MS, 600_000);
  const { meter, chain, user, timers, sent } = setup();
  chain.state.balances.set(user, PAS * RATIO);
  await meter.afterTurn(PEER);
  await meter.afterTurn(PEER);
  assert.equal(timers.size(), 1, "one timer per user, armed by the first pending reply");
  assert.deepEqual(timers.fire(), [600_000]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(chain.state.calls.length, 1);
  assert.equal(chain.state.calls[0].calldata, meterCalldata.charge(user, 2n * (PAS / 10n) * RATIO));
  assert.equal(sent[0].ref.status, 1);
});

test("shutdown (flushAll) charges every user's pending debit; nothing pending sends nothing", async () => {
  const { meter, chain, user } = setup();
  const OTHER = "11".repeat(32);
  chain.state.balances.set(user, PAS * RATIO);
  chain.state.balances.set(reviveAddress(`0x${OTHER}`), PAS * RATIO);
  await meter.afterTurn(PEER);
  await meter.afterTurn(OTHER);
  await meter.flushAll();
  assert.equal(chain.state.calls.length, 2, "one charge per user");
  await meter.flushAll();
  assert.equal(chain.state.calls.length, 2, "a second flush finds nothing pending");
});

test("the balance the bot reports and gates on is the chain balance minus the pending debit", async () => {
  const { meter, sent, chain, user } = setup();
  chain.state.balances.set(user, (PAS * 3n / 10n) * RATIO); // 0.3 PAS on chain
  await meter.afterTurn(PEER);
  await meter.afterTurn(PEER); // 0.2 PAS pending
  await meter.beforeTurn(PEER, text("/balance"));
  assert.equal(sent[0].text, "Balance: 0.1 PAS · ~1 reply at 0.1 PAS each.");
  assert.deepEqual(await meter.beforeTurn(PEER, text("one more")), { run: true, charge: true }, "0.1 PAS left: one more reply");
  await meter.afterTurn(PEER); // 0.3 PAS pending: nothing left
  const gate = await meter.beforeTurn(PEER, text("and another"));
  assert.equal(gate.run, false, "balance minus pending is below the price");
  assert.equal(chain.state.calls.length, 1, "the pending charge is settled before the refusal");
  assert.equal(chain.state.calls[0].calldata, meterCalldata.charge(user, 3n * (PAS / 10n) * RATIO));
  assert.deepEqual(sent.map((m) => m.type), ["buttons", "reference", "buttons"]);
  assert.match(sent[2].text, /^Your balance is 0 PAS; a reply costs 0\.1 PAS/);
});

// Two extrinsics signed at the same best block share a nonce: one is lost.
test("charges from the operator account never overlap", async () => {
  const OTHER = "11".repeat(32);
  const { meter, chain, user } = setup({ delayMs: 20 }, { batchReplies: 1 });
  chain.state.balances.set(user, PAS * RATIO);
  chain.state.balances.set(reviveAddress(`0x${OTHER}`), PAS * RATIO);
  await Promise.all([meter.afterTurn(PEER), meter.afterTurn(OTHER)]);
  assert.equal(chain.state.calls.length, 2);
  assert.equal(chain.state.maxInFlight, 1);
});

// Spec 0007 client rule 3 (2026-09-23): one reference per transaction; status 0
// only when no block holds it after 30 s; status 2 never.
test("references: one per charge; a slow inclusion adds status 0 first; never status 2", async () => {
  const fast = setup({}, { batchReplies: 1 });
  fast.chain.state.balances.set(fast.user, PAS * RATIO);
  await fast.meter.afterTurn(PEER);
  assert.deepEqual(fast.sent.map((m) => m.ref.status), [1]);
  const slow = setup({ slow: true }, { batchReplies: 1 });
  slow.chain.state.balances.set(slow.user, PAS * RATIO);
  await slow.meter.afterTurn(PEER);
  assert.deepEqual(slow.sent.map((m) => m.ref.status), [0, 1]);
  assert.equal(slow.sent[0].ref.block, null);
  assert.equal(slow.sent[0].ref.hash, slow.sent[1].ref.hash, "both describe the same extrinsic");
});

test("/balance and /topup answer without the brain; other commands are free", async () => {
  const { meter, sent, chain, user } = setup();
  chain.state.balances.set(user, (PAS * 3n / 10n) * RATIO);
  assert.equal((await meter.beforeTurn(PEER, text("/balance"))).run, false);
  assert.equal(sent[0].text, "Balance: 0.3 PAS · ~3 replies at 0.1 PAS each.");
  assert.equal(sent[0].rows[0][0].label, "Top up 1 PAS");
  assert.equal((await meter.beforeTurn(PEER, text(" /TOPUP "))).run, false);
  assert.equal(sent[1].type, "buttons");
  assert.deepEqual(await meter.beforeTurn(PEER, text("/help")), { run: true, charge: false }, "/help is not a paid reply");
  chain.state.balances.set(user, 0n);
  assert.deepEqual(await meter.beforeTurn(PEER, text("/reset")), { run: true, charge: false }, "commands work at zero balance");
  assert.equal(chain.state.calls.length, 0);
});

// Fail closed: a chain outage must not turn the paid bot into a free one.
test("a failed balance read answers with a notice and runs no brain", async () => {
  const { meter, sent, logs } = setup({ failReads: true });
  assert.equal((await meter.beforeTurn(PEER, text("hi"))).run, false);
  assert.equal(sent[0].type, "text");
  assert.ok(logs.some((l) => l.event === "BOT_METER_READ_FAILED"));
});

test("a charge that fails is logged; one that failed on chain is reported as status 3", async () => {
  const low = setup({}, { batchReplies: 1 });
  assert.equal(await low.meter.afterTurn(PEER), null, "a dry-run revert sends nothing (there is no extrinsic to reference)");
  assert.equal(low.sent.length, 0);
  assert.ok(low.logs.some((l) => l.event === "BOT_METER_CHARGE_FAILED" && l.stage === "dry-run" && l.error === "insufficient balance"));
  const failing = setup({ dispatchFails: true }, { batchReplies: 1 });
  failing.chain.state.balances.set(failing.user, PAS * RATIO);
  await failing.meter.afterTurn(PEER);
  assert.equal(failing.sent[0].ref.status, 3);
  assert.match(failing.sent[0].ref.note, /^charge failed: Revive\.OutOfGas/);
});

test("a peer's transactionReference only triggers a balance re-read, never a message", async () => {
  const { meter, sent, chain, user, logs } = setup();
  chain.state.balances.set(user, PAS * RATIO);
  assert.equal(await meter.onReference(PEER, { status: 1 }), PAS);
  assert.equal(sent.length, 0);
  assert.ok(logs.some((l) => l.event === "BOT_METER_BALANCE" && l.on === "reference"));
});

test("config: contract address and price are validated; PAS formatting", () => {
  assert.throws(() => createMeter({ chain: fakeChain(), contract: "0x1234", operator, send: {} }), /20-byte/);
  assert.throws(() => createMeter({ chain: fakeChain(), contract: CONTRACT, operator, price: 0n, send: {} }), /above zero/);
  assert.equal(parsePlancks("", 5n), 5n);
  assert.equal(parsePlancks("1000000000", 5n), 1_000_000_000n);
  assert.throws(() => parsePlancks("0.1", 5n), /integer number of plancks/);
  assert.equal(formatPas(0n), "0 PAS");
  assert.equal(formatPas(PAS), "1 PAS");
  assert.equal(formatPas(8n * PAS / 10n), "0.8 PAS");
  assert.equal(formatPas(12_345_678_901n), "1.2345 PAS");
});

// Spec 0008 v3: the client shows balance - pending, the bot's own /balance
// number. pendingHint is that pending in the hint's unit (the contract's 1e18
// scale), so it must scale by NativeToEthRatio and follow every reply.
test("pendingHint is the pending debit in the contract's unit; a final reference carries it", async () => {
  const { meter, chain, user, sent } = setup();
  chain.state.balances.set(user, PAS * RATIO);
  assert.equal(meter.pendingHint(PEER), null, "no balance read yet: the ratio is unknown, so no hint");
  await meter.beforeTurn(PEER, text("q1"));
  assert.equal(meter.pendingHint(PEER), 0n);
  assert.equal(meter.pendingHint(PEER, 1), (PAS / 10n) * RATIO, "the reply going out adds one price");
  await meter.afterTurn(PEER);
  await meter.beforeTurn(PEER, text("q2"));
  await meter.afterTurn(PEER);
  await meter.beforeTurn(PEER, text("q3"));
  assert.equal(meter.pendingHint(PEER, 1), 3n * (PAS / 10n) * RATIO, "0.3 PAS = 3e17, the vectors-0008c value");
  // A refusal flushes: the reference that closes the charge says pending 0.
  chain.state.balances.set(user, (PAS / 10n) * 2n * RATIO); // 0.2 PAS on chain, 0.2 pending
  await meter.beforeTurn(PEER, text("q4"));
  const ref = sent.find((m) => m.type === "reference");
  assert.equal(ref.ref.status, 1);
  assert.equal(ref.pending, 0n, "after the charge lands nothing is pending");
});

// Crash safety (M12f): the pending replies live in the session state. A
// restart restores them and charges them when the batch timer, counted from
// the first reply, ends; nothing is lost and nothing is charged twice.
test("the pending replies survive a restart through snapshot/restore", async () => {
  const first = setup();
  first.chain.state.balances.set(first.user, PAS * RATIO);
  assert.equal(first.meter.snapshot(PEER), null);
  for (let i = 0; i < 3; i += 1) { await first.meter.beforeTurn(PEER, text("q")); await first.meter.afterTurn(PEER); }
  const saved = first.meter.snapshot(PEER);
  assert.deepEqual(saved, { r: 3, t: 1_720_000_000_000 });
  assert.equal(first.changes.count, 3, "each pending reply asks for a state save");

  // The process dies; a new one restores 4 min later.
  let clock = 1_720_000_000_000 + 240_000;
  const second = setup({}, { now: () => clock });
  second.chain.state.balances.set(second.user, PAS * RATIO);
  second.meter.restore(PEER, saved);
  second.meter.restore(PEER, { r: "3", t: 1 }); // malformed: ignored
  assert.equal(second.meter.pendingDebit(PEER), 3n * PAS / 10n, "the restored debit gates and reports as before");
  assert.deepEqual(second.meter.snapshot(PEER), saved);
  const waits = second.timers.fire();
  assert.deepEqual(waits, [360_000], "the charge waits only what was left of the 10 min");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(second.chain.state.calls.length, 1, "one charge for the restored replies");
  assert.equal(second.chain.state.calls[0].calldata, meterCalldata.charge(second.user, 3n * (PAS / 10n) * RATIO));
  assert.equal(second.meter.snapshot(PEER), null, "a charge in flight is not saved: a crash now never charges twice");
  assert.ok(second.changes.count >= 1);
});

// Efficiency budget (M12c ruling, M12f): the botInfo with the new pending
// costs no submission of its own. On the real outbound lane, a metered reply,
// its botInfo and the pending seen enqueued in one tick are ONE statement;
// the charge's reference and its botInfo (pending 0) are one more.
test("botInfo with pending rides the reply's statement, and the charge's reference, on the lane", async () => {
  const submissions = [];
  let lastRequestId = null;
  const lanes = createOutboundLanes({
    encodeBatch: (_peer, requestId, opaques) => ({ requestId, opaques, length: 0 }),
    submitPayload: async (_peer, { requestId, opaques }) => {
      lastRequestId = requestId;
      submissions.push(opaques.map((o) => decodeOpaqueMessageAt(o, 0).value));
    },
    makeRequestId: (() => { let n = 0; return () => `r${(n += 1)}`; })(),
  });
  const ack = () => lanes.onAck(PEER, lastRequestId); // the client fetched it
  const hint = { chainId: GENESIS, contract: CONTRACT, selector: "0x70a08231", decimals: 18, unit: "PAS", perReply: (PAS / 10n) * RATIO, label: "with Meter" };
  const botInfo = (pending) => encodeOpaqueBotInfoMessage({ kind: 1, name: "Meter", version: 1, balance: { ...hint, pending } });
  // As index.mjs sendTransactionReference does: the botInfo in the same tick.
  const reference = async (peer, ref, { pending }) => {
    const sent = lanes.enqueue(peer, encodeOpaqueTransactionReferenceMessage(ref)).submitted;
    lanes.enqueue(peer, botInfo(pending));
    await sent;
  };
  const { meter, chain, user } = setup({}, { batchReplies: 2, send: { reference } });
  chain.state.balances.set(user, PAS * RATIO);
  // As index.mjs submitMessage does: the pending seen, botInfo and the reply in one tick.
  const reply = async (n) => {
    await meter.beforeTurn(PEER, text(`q${n}`));
    lanes.enqueue(PEER, encodeOpaqueSeenMessage({ upTo: `in-${n}`, at: 1 }));
    lanes.enqueue(PEER, botInfo(meter.pendingHint(PEER, 1)));
    await lanes.enqueue(PEER, encodeOpaqueTextMessage({ text: `answer ${n}` })).submitted;
    ack();
  };
  await reply(1);
  assert.equal(submissions.length, 1, "reply + botInfo + seen = 1 submission");
  assert.deepEqual(submissions[0].map((m) => m.kind), ["seen", "botInfo", "text"]);
  assert.equal(submissions[0][1].balance.pending, (PAS / 10n) * RATIO, "0.1 PAS pending after the first reply");
  assert.equal(await meter.afterTurn(PEER), null);

  await reply(2);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1][1].balance.pending, 2n * (PAS / 10n) * RATIO, "0.2 PAS pending after the second");
  // The second reply fills the batch: the charge's reference and a botInfo
  // with pending 0 are one more submission, not two.
  const charged = await meter.afterTurn(PEER);
  assert.equal(charged.ok, true);
  assert.equal(submissions.length, 3, "reference + botInfo = 1 submission");
  assert.deepEqual(submissions[2].map((m) => m.kind), ["transactionReference", "botInfo"]);
  assert.equal(submissions[2][0].status, 1);
  assert.equal(submissions[2][1].balance.pending, 0n, "charged: nothing pending");
});

// The index.mjs rule: a metered turn joins the pending debit only when the
// brain answered (the runtime's onAnswer). A failed turn answers with an
// apology ("couldn't reach my agent", BOT_AI_FAILED) and must cost nothing.
test("a failed brain turn adds no pending debit; an answered turn adds one price", async () => {
  const { meter, chain, user } = setup();
  chain.state.balances.set(user, PAS * RATIO);
  const turn = async (script) => {
    const delivered = [];
    const runtime = createAgentRuntime({
      engine: RUNNERS.claude, engineName: "claude", engineCommand: "sh",
      buildArgs: () => ["-c", script],
      workspace: fs.mkdtempSync(path.join(os.tmpdir(), "pca-meter-")),
      idleMs: 10_000, renderMessage: (m) => m.text,
      chat: { sendText: async () => {}, deliver: async (p, t) => { delivered.push(t); }, beginTurn: () => () => {} },
      username: "unit.00", log: () => {}, persist: () => {},
    });
    const gate = await meter.beforeTurn(PEER, text("what is staking?"));
    assert.deepEqual(gate, { run: true, charge: true });
    let answered = false;
    await runtime.handleMessage(PEER, { text: "what is staking?", messageId: "M1", kind: "text" }, { onAnswer: () => { answered = true; } });
    if (answered) await meter.afterTurn(PEER);
    return delivered;
  };
  const failed = await turn("echo nope >&2; exit 1");
  assert.match(failed[0], /couldn't reach my agent/);
  assert.equal(meter.pendingDebit(PEER), 0n, "the failed turn is not charged");
  assert.equal(meter.snapshot(PEER), null, "and leaves no pending reply to save");
  const answered = await turn(`printf '{"type":"result","result":"staking is","usage":{"input_tokens":1,"output_tokens":1}}\\n'`);
  assert.match(answered[0], /staking is/);
  assert.equal(meter.pendingDebit(PEER), PAS / 10n, "the answered turn adds one price");
});
