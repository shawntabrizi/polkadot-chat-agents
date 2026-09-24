// Pay-as-you-go replies (spec 0007): a Meter contract (contracts/meter) on a
// pallet-revive chain holds each user's prepaid balance. Before a brain turn
// the bot reads the user's balance at the best block; below the price it
// answers with a Top up button (a `tx` intent the client dry-runs and signs)
// and the brain does not run. A turn that ran adds the price to the user's
// PENDING debit. The bot charges the pending debit from its own wallet (the
// contract's operator) in ONE extrinsic when `batchReplies` replies are
// pending, `batchMs` after the first pending reply, before a refusal, or on
// shutdown (flushAll), and posts one transactionReference for it whose note is
// `balance: <remaining plancks>` (spec 0007 client rule 3; efficiency.md: one
// Asset Hub extrinsic per 5 metered replies or 10 min, not one per reply).
// Everything the bot says about a balance is the chain balance minus the
// pending debit.
//
// Spec 0008 v3: the client's header shows the botInfo balance hint minus its
// `pending`, so the bot tells the client its pending debit (pendingHint, in
// the contract's unit): index.mjs resends botInfo with each metered reply and
// with each charge's final reference (`send.reference`'s third argument), in
// the same request statement. The pending replies are session state
// (snapshot/restore, `onChange` saves it), so a crash does not lose them. A
// charge in flight is not saved: after a crash it counts as charged, so a
// restart never charges the same replies twice.
//
// Enabled by BOT_METER_CONTRACT + BOT_METER_CHAIN (index.mjs). Everything
// chain-shaped goes through `chain` (lib/revive-chain.mjs or a test fake).
//
// Units: the chain's native value is in plancks (1 PAS = 1e10); inside the
// contract it is scaled by the runtime's NativeToEthRatio (1e8 on Asset Hub).
// This module speaks plancks and converts at the contract boundary.

import { COMMAND_RE } from "./commands.mjs";
import { decodeUint256, meterCalldata, PLANCKS_PER_PAS, reviveAddress, reviveIntentLimits, serialQueue } from "./revive-chain.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";

export const DEFAULT_METER_PRICE = PLANCKS_PER_PAS / 10n; // 0.1 PAS
export const METER_TOPUP_PLANCKS = PLANCKS_PER_PAS; // the Top up button adds 1 PAS
export const METER_INTENT_TTL_MS = 10 * 60_000;
/**
 * topUp()'s worst case (ReviveApi_call on devnet Asset Hub, 2026-09-24): a
 * user with no balance gets a new slot, 26 400 000 plancks and the most
 * weight. A top-up signed from a dry-run with a balance can still land after
 * a charge that took the balance to 0 (the slot is gone): the intent's limits
 * come from the worst case (reviveIntentLimits).
 */
export const METER_TOPUP_WORST = Object.freeze({ deposit: 26_400_000n, refTime: 453_538_335n, proofSize: 45_218n });
export const METER_BATCH_REPLIES = 5;
export const METER_BATCH_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 20_000;

const BALANCE_RE = /^\s*\/balance\s*$/i;
const TOPUP_RE = /^\s*\/topup\s*$/i;

/** Plancks -> "0.8 PAS" (at most 4 decimals, trailing zeros dropped). */
export const formatPas = (plancks) => {
  const p = BigInt(plancks);
  const whole = p / PLANCKS_PER_PAS;
  const frac = ((p % PLANCKS_PER_PAS) * 10_000n) / PLANCKS_PER_PAS;
  const decimals = frac === 0n ? "" : `.${frac.toString().padStart(4, "0").replace(/0+$/, "")}`;
  return `${whole}${decimals} PAS`;
};

/** A decimal integer of plancks (BOT_METER_PRICE, BOT_FAUCET_AMOUNT) -> bigint; empty -> fallback. */
export const parsePlancks = (raw, fallback) => {
  const text = String(raw ?? "").trim();
  if (text === "") return fallback;
  if (!/^\d+$/.test(text)) throw new Error(`expected an integer number of plancks, got "${text}"`);
  return BigInt(text);
};

const defaultTimers = {
  set: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clear: (t) => clearTimeout(t),
};

/**
 * chain:    { genesisHash(), nativeToEthRatio(), read({origin,dest,calldata}),
 *             callContract(pair,{dest,calldata,value,onSlow}), ensureMapped(pair) }
 * operator: the bot's sr25519 wallet pair (the contract's operator)
 * send:     { text(peerHex, text), buttons(peerHex, text, rows), reference(peerHex, ref) }
 *           reference(peerHex, ref, { pending }) gets the pending hint on a
 *           charge's final (status 1 or 3) reference.
 * batchReplies, batchMs: charge after this many pending replies, or this long
 *           after the first one (BOT_METER_BATCH_REPLIES, BOT_METER_BATCH_MS).
 * onChange: called when the pending replies change (save the session state).
 */

export function createMeter({
  chain, contract, operator, price = DEFAULT_METER_PRICE, name = "the bot", send, log = () => {}, now = Date.now,
  batchReplies = METER_BATCH_REPLIES, batchMs = METER_BATCH_MS, timers = defaultTimers, onChange = () => {},
}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(contract))) throw new Error("BOT_METER_CONTRACT must be a 20-byte 0x address");
  if (price <= 0n) throw new Error("BOT_METER_PRICE must be above zero");
  if (!(Number.isInteger(batchReplies) && batchReplies >= 1)) throw new Error("BOT_METER_BATCH_REPLIES must be an integer of 1 or more");
  let mapped = false;
  const queue = serialQueue(); // one operator account: one charge at a time
  const pending = new Map(); // peerHex -> { replies, since, timer }: replies the next flush charges
  const charging = new Map(); // peerHex -> plancks of a flush whose extrinsic is not in a block yet
  // What the user owes that the chain balance does not show yet.
  const pendingDebit = (peerHex) => price * BigInt(pending.get(peerHex)?.replies ?? 0) + (charging.get(peerHex) ?? 0n);
  let ratio = null; // NativeToEthRatio, cached at the first balance read
  // The pending debit (plus `extraReplies` not yet added) in the contract's
  // unit, the unit of the botInfo balance hint. null until a balance read has
  // learned the ratio.
  const pendingHint = (peerHex, extraReplies = 0) => (ratio == null ? null : (pendingDebit(peerHex) + price * BigInt(extraReplies)) * ratio);

  const userAddress = (peerHex) => reviveAddress(`0x${String(peerHex).replace(/^0x/i, "")}`);
  const balanceOf = async (peerHex) => {
    const data = await withTimeout(
      chain.read({ origin: operator.publicKey, dest: contract, calldata: meterCalldata.balanceOf(userAddress(peerHex)) }),
      READ_TIMEOUT_MS, "meter balance read");
    ratio = await chain.nativeToEthRatio();
    return decodeUint256(data) / ratio;
  };
  const replies = (balance) => balance / price;

  const topUpRows = async () => [[{
    label: `Top up ${formatPas(METER_TOPUP_PLANCKS)}`,
    action: {
      tx: {
        version: 1,
        chainId: await chain.genesisHash(),
        calls: [{ kind: 1, to: contract, data: meterCalldata.topUp(), value: METER_TOPUP_PLANCKS, ...reviveIntentLimits(METER_TOPUP_WORST) }],
        display: {
          title: "Top up",
          description: `Adds ${formatPas(METER_TOPUP_PLANCKS)} to your prepaid balance with ${name}`,
          amount: formatPas(METER_TOPUP_PLANCKS).replace(/ PAS$/, ""),
          asset: "PAS",
        },
        dryRunRequired: true,
        expiresAt: now() + METER_INTENT_TTL_MS,
      },
    },
  }]];

  // Charge the user's pending debit in one extrinsic and post one reference.
  // Resolves the chain result plus `remaining` (the balance after the charge
  // minus any debit added meanwhile), or null when nothing was charged.
  const flush = (peerHex, on) => {
    const entry = pending.get(peerHex);
    if (!entry) return Promise.resolve(null);
    pending.delete(peerHex);
    timers.clear(entry.timer);
    onChange();
    const count = entry.replies;
    const plancks = price * BigInt(count);
    const note = (delta) => charging.set(peerHex, (charging.get(peerHex) ?? 0n) + delta);
    note(plancks);
    let settled = false;
    const settle = () => { if (!settled) { settled = true; note(-plancks); if (charging.get(peerHex) === 0n) charging.delete(peerHex); } };
    return queue(async () => {
      const user = userAddress(peerHex);
      let chainId = null;
      let pendingHash = null; // set when a status 0 reference went out
      try {
        if (!mapped) {
          if (await chain.ensureMapped(operator)) log("BOT_METER_OPERATOR_MAPPED", {});
          mapped = true;
        }
        chainId = await chain.genesisHash();
        const amount = plancks * (await chain.nativeToEthRatio());
        const onSlow = (hash) => {
          pendingHash = hash;
          send.reference(peerHex, { chainId, hash, status: 0, block: null, note: `charging ${count} ${count === 1 ? "reply" : "replies"}` })
            .catch((error) => log("BOT_METER_REFERENCE_FAILED", { peer: peerHex, error: String(error?.message ?? error) }));
        };
        const result = await chain.callContract(operator, { dest: contract, calldata: meterCalldata.charge(user, amount), onSlow });
        settle(); // in a block (or failed): the chain balance now tells the truth
        if (!result.hash) {
          log("BOT_METER_CHARGE_FAILED", { peer: peerHex, on, replies: count, stage: "dry-run", error: result.error });
          return null;
        }
        if (!result.ok) {
          log("BOT_METER_CHARGE_FAILED", { peer: peerHex, on, replies: count, stage: "dispatch", hash: result.hash, block: result.block, error: result.error });
          await send.reference(peerHex, { chainId, hash: result.hash, status: 3, block: result.block, note: `charge failed: ${String(result.error).slice(0, 120)}` }, { pending: pendingHint(peerHex) });
          return result;
        }
        const balance = await balanceOf(peerHex);
        const debit = pendingDebit(peerHex);
        const remaining = balance > debit ? balance - debit : 0n;
        log("BOT_METER_CHARGED", { peer: peerHex, on, replies: count, plancks: String(plancks), remaining: String(remaining), hash: result.hash, block: result.block });
        await send.reference(peerHex, { chainId, hash: result.hash, status: 1, block: result.block, note: `balance: ${remaining}` }, { pending: pendingHint(peerHex) });
        return { ...result, remaining };
      } catch (error) {
        settle();
        log("BOT_METER_CHARGE_FAILED", { peer: peerHex, on, replies: count, stage: "submit", error: String(error?.message ?? error) });
        // A status 0 is closed with status 3, or the peer's bubble stays pending.
        if (pendingHash) {
          await send.reference(peerHex, { chainId, hash: pendingHash, status: 3, block: null, note: "charge not included" })
            .catch((e) => log("BOT_METER_REFERENCE_FAILED", { peer: peerHex, error: String(e?.message ?? e) }));
        }
        return null;
      }
    });
  };

  const balanceLine = (balance) => `Balance: ${formatPas(balance)} · ~${replies(balance)} ${replies(balance) === 1n ? "reply" : "replies"} at ${formatPas(price)} each.`;

  return {
    userAddress,
    balanceOf,
    /** Plancks the user owes that the chain balance does not show yet. */
    pendingDebit,
    pendingHint,
    price,
    /**
     * Before a brain turn. { run: true } lets the brain answer; { run: false }
     * means the meter answered (a command, a top-up prompt, or a read error).
     */
    async beforeTurn(peerHex, msg) {
      const text = msg?.kind === "text" ? String(msg.text ?? "") : "";
      if (TOPUP_RE.test(text)) {
        await send.buttons(peerHex, `Add ${formatPas(METER_TOPUP_PLANCKS)} to your balance. Each reply costs ${formatPas(price)}.`, await topUpRows());
        log("BOT_METER_TOPUP_OFFERED", { peer: peerHex, on: "command" });
        return { run: false };
      }
      const isBalance = BALANCE_RE.test(text);
      // Other slash commands (/help, /reset, ...) are free: no brain turn runs.
      if (!isBalance && COMMAND_RE.test(text)) return { run: true, charge: false };
      let balance;
      try { balance = await balanceOf(peerHex); }
      catch (error) {
        log("BOT_METER_READ_FAILED", { peer: peerHex, error: String(error?.message ?? error) });
        await send.text(peerHex, "I can't read your balance on the chain right now, so I can't answer yet. Please try again in a minute.");
        return { run: false };
      }
      const debit = pendingDebit(peerHex);
      let available = balance > debit ? balance - debit : 0n;
      log("BOT_METER_BALANCE", { peer: peerHex, plancks: String(balance), ...(debit ? { pending: String(debit) } : {}), on: isBalance ? "command" : "turn" });
      if (isBalance) {
        await send.buttons(peerHex, balanceLine(available), await topUpRows());
        return { run: false };
      }
      if (available < price) {
        // Settle what the user already owes before the refusal, so the chain
        // (and the client's balance badge) shows the true balance.
        if (debit) {
          const charged = await flush(peerHex, "refusal");
          if (charged?.remaining != null) available = charged.remaining;
        }
        await send.buttons(peerHex, `Your balance is ${formatPas(available)}; a reply costs ${formatPas(price)}. Top up to continue.`, await topUpRows());
        log("BOT_METER_TOPUP_OFFERED", { peer: peerHex, on: "low balance", plancks: String(available) });
        return { run: false };
      }
      return { run: true, charge: true };
    },
    /**
     * After a brain turn that ran with charge: true: the price joins the
     * user's pending debit. Returns the flush result when this reply filled
     * the batch, else null. Never throws.
     */
    async afterTurn(peerHex) {
      let entry = pending.get(peerHex);
      if (!entry) {
        entry = { replies: 0, since: now(), timer: timers.set(() => { void flush(peerHex, "timer"); }, batchMs) };
        pending.set(peerHex, entry);
      }
      entry.replies += 1;
      onChange();
      log("BOT_METER_PENDING", { peer: peerHex, replies: entry.replies, plancks: String(pendingDebit(peerHex)) });
      return entry.replies >= batchReplies ? flush(peerHex, "batch") : null;
    },
    /** The pending replies for the session state: { r: replies, t: first reply ms } or null. */
    snapshot(peerHex) {
      const entry = pending.get(peerHex);
      return entry ? { r: entry.replies, t: entry.since } : null;
    },
    /** After a restart: the saved pending replies, charged when the batch timer ends. */
    restore(peerHex, saved) {
      if (!(Number.isSafeInteger(saved?.r) && saved.r >= 1 && Number.isSafeInteger(saved?.t)) || pending.has(peerHex)) return;
      const wait = Math.max(0, saved.t + batchMs - now());
      pending.set(peerHex, { replies: saved.r, since: saved.t, timer: timers.set(() => { void flush(peerHex, "timer"); }, wait) });
      log("BOT_METER_PENDING_RESTORED", { peer: peerHex, replies: saved.r, chargeInMs: wait });
    },
    /** Charge every pending debit now (shutdown). Never throws. */
    flushAll(on = "shutdown") {
      return Promise.all([...pending.keys()].map((peerHex) => flush(peerHex, on)));
    },
    /** A peer's transactionReference (spec 0007): never trusted, only re-read. Never throws. */
    async onReference(peerHex, ref) {
      try {
        const balance = await balanceOf(peerHex);
        log("BOT_METER_BALANCE", { peer: peerHex, plancks: String(balance), on: "reference", status: ref?.status });
        return balance;
      } catch (error) {
        log("BOT_METER_READ_FAILED", { peer: peerHex, error: String(error?.message ?? error), on: "reference" });
        return null;
      }
    },
  };
}
