// Pay-as-you-go replies (spec 0007): a Meter contract (contracts/meter) on a
// pallet-revive chain holds each user's prepaid balance. Before a brain turn
// the bot reads the user's balance at the best block; below the price it
// answers with a Top up button (a `tx` intent the client dry-runs and signs)
// and the brain does not run. After a turn it charges the price from its own
// wallet (the contract's operator) and posts a transactionReference whose
// note is `balance: <remaining plancks>`.
//
// Enabled by BOT_METER_CONTRACT + BOT_METER_CHAIN (index.mjs). Everything
// chain-shaped goes through `chain` (lib/revive-chain.mjs or a test fake).
//
// Units: the chain's native value is in plancks (1 PAS = 1e10); inside the
// contract it is scaled by the runtime's NativeToEthRatio (1e8 on Asset Hub).
// This module speaks plancks and converts at the contract boundary.

import { COMMAND_RE } from "./commands.mjs";
import { decodeUint256, meterCalldata, PLANCKS_PER_PAS, reviveAddress } from "./revive-chain.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";

export const DEFAULT_METER_PRICE = PLANCKS_PER_PAS / 10n; // 0.1 PAS
export const METER_TOPUP_PLANCKS = PLANCKS_PER_PAS; // the Top up button adds 1 PAS
export const METER_INTENT_TTL_MS = 10 * 60_000;
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

/**
 * chain:    { genesisHash(), nativeToEthRatio(), read({origin,dest,calldata}),
 *             callContract(pair,{dest,calldata,value}), ensureMapped(pair) }
 * operator: the bot's sr25519 wallet pair (the contract's operator)
 * send:     { text(peerHex, text), buttons(peerHex, text, rows), reference(peerHex, ref) }
 */
export function createMeter({ chain, contract, operator, price = DEFAULT_METER_PRICE, name = "the bot", send, log = () => {}, now = Date.now }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(contract))) throw new Error("BOT_METER_CONTRACT must be a 20-byte 0x address");
  if (price <= 0n) throw new Error("BOT_METER_PRICE must be above zero");
  let mapped = false;

  const userAddress = (peerHex) => reviveAddress(`0x${String(peerHex).replace(/^0x/i, "")}`);
  const balanceOf = async (peerHex) => {
    const data = await withTimeout(
      chain.read({ origin: operator.publicKey, dest: contract, calldata: meterCalldata.balanceOf(userAddress(peerHex)) }),
      READ_TIMEOUT_MS, "meter balance read");
    return decodeUint256(data) / (await chain.nativeToEthRatio());
  };
  const replies = (balance) => balance / price;

  const topUpRows = async () => [[{
    label: `Top up ${formatPas(METER_TOPUP_PLANCKS)}`,
    action: {
      tx: {
        version: 1,
        chainId: await chain.genesisHash(),
        calls: [{ kind: 1, to: contract, data: meterCalldata.topUp(), value: METER_TOPUP_PLANCKS }],
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

  const balanceLine = (balance) => `Balance: ${formatPas(balance)} · ~${replies(balance)} ${replies(balance) === 1n ? "reply" : "replies"} at ${formatPas(price)} each.`;

  return {
    userAddress,
    balanceOf,
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
      log("BOT_METER_BALANCE", { peer: peerHex, plancks: String(balance), on: isBalance ? "command" : "turn" });
      if (isBalance) {
        await send.buttons(peerHex, balanceLine(balance), await topUpRows());
        return { run: false };
      }
      if (balance < price) {
        await send.buttons(peerHex, `Your balance is ${formatPas(balance)}; a reply costs ${formatPas(price)}. Top up to continue.`, await topUpRows());
        log("BOT_METER_TOPUP_OFFERED", { peer: peerHex, on: "low balance", plancks: String(balance) });
        return { run: false };
      }
      return { run: true, charge: true };
    },
    /** After a brain turn that ran with charge: true. Never throws. */
    async afterTurn(peerHex) {
      const user = userAddress(peerHex);
      try {
        if (!mapped) {
          if (await chain.ensureMapped(operator)) log("BOT_METER_OPERATOR_MAPPED", {});
          mapped = true;
        }
        const amount = price * (await chain.nativeToEthRatio());
        const result = await chain.callContract(operator, { dest: contract, calldata: meterCalldata.charge(user, amount) });
        if (!result.hash) {
          log("BOT_METER_CHARGE_FAILED", { peer: peerHex, stage: "dry-run", error: result.error });
          return null;
        }
        const chainId = await chain.genesisHash();
        if (!result.ok) {
          log("BOT_METER_CHARGE_FAILED", { peer: peerHex, stage: "dispatch", hash: result.hash, block: result.block, error: result.error });
          await send.reference(peerHex, { chainId, hash: result.hash, status: 3, block: result.block, note: `charge failed: ${String(result.error).slice(0, 120)}` });
          return result;
        }
        const remaining = await balanceOf(peerHex);
        log("BOT_METER_CHARGED", { peer: peerHex, plancks: String(price), remaining: String(remaining), hash: result.hash, block: result.block });
        await send.reference(peerHex, { chainId, hash: result.hash, status: 1, block: result.block, note: `balance: ${remaining}` });
        return { ...result, remaining };
      } catch (error) {
        log("BOT_METER_CHARGE_FAILED", { peer: peerHex, stage: "submit", error: String(error?.message ?? error) });
        return null;
      }
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
