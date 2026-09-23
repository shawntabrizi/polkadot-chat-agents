// A devnet faucet (spec 0007 companion): `/drip <address>` sends
// BOT_FAUCET_AMOUNT (default 1 PAS) with `Balances.transfer_keep_alive` from
// an account of the PUBLIC Substrate dev phrase (BOT_FAUCET_KEY is only a
// derivation path such as //Alice), then posts a transactionReference with
// the note "Dripped 1 PAS". One drip per target account per 10 minutes.
//
// The key is never configurable as a phrase or a seed: a faucet bot that
// held a real key would hand out real funds to anyone who asks.

import { parseAccountId, PLANCKS_PER_PAS } from "./revive-chain.mjs";
import { formatPas } from "./meter.mjs";
import { deriveSr25519PairFromMnemonic } from "../vendor/lib/wallet-keys.mjs";

export const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";
export const DEFAULT_FAUCET_AMOUNT = PLANCKS_PER_PAS;
// Off by default (owner, 2026-09-23): a devnet faucet a rate limit only slows tests down.
// BOT_FAUCET_COOLDOWN_MS turns it on.
export const FAUCET_COOLDOWN_MS = 0;
const DRIP_RE = /^\s*\/drip(?:\s+(\S+))?\s*$/i;

/** BOT_FAUCET_KEY -> the sr25519 pair; only a derivation path of the dev phrase is accepted. */
export function faucetPairFromPath(path) {
  const text = String(path ?? "").trim();
  if (!/^(\/\/?[^/\s]+)+$/.test(text)) {
    throw new Error("BOT_FAUCET_KEY must be a derivation path of the public dev phrase, e.g. //Alice (never a phrase or a seed)");
  }
  return deriveSr25519PairFromMnemonic(DEV_PHRASE, text);
}

/**
 * chain: { genesisHash(), transfer(pair, {to, amount}) }
 * send:  { text(peerHex, text), reference(peerHex, ref) }
 */
export function createFaucet({ chain, pair, amount = DEFAULT_FAUCET_AMOUNT, cooldownMs = FAUCET_COOLDOWN_MS, send, log = () => {}, now = Date.now, maxEntries = 10_000 }) {
  if (amount <= 0n) throw new Error("BOT_FAUCET_AMOUNT must be above zero");
  const lastDrip = new Map(); // target account hex -> ms of the last drip (or the one in flight)
  return {
    /** true when the message was a /drip command (handled here, not for the brain). */
    async handle(peerHex, msg) {
      const match = msg?.kind === "text" ? DRIP_RE.exec(String(msg.text ?? "")) : null;
      if (!match) return false;
      if (!match[1]) {
        await send.text(peerHex, "Send /drip <your address> (SS58 or 0x account id).");
        return true;
      }
      const account = parseAccountId(match[1]);
      if (!account) {
        await send.text(peerHex, "That is not an account address. Send /drip <SS58 address or 0x + 64 hex>.");
        log("BOT_FAUCET_REFUSED", { peer: peerHex, reason: "invalid address" });
        return true;
      }
      const key = Buffer.from(account).toString("hex");
      const last = lastDrip.get(key);
      if (cooldownMs > 0 && last != null && now() - last < cooldownMs) {
        const minutes = Math.ceil((cooldownMs - (now() - last)) / 60_000);
        await send.text(peerHex, `That account got a drip recently. Try again in ${minutes} min.`);
        log("BOT_FAUCET_REFUSED", { peer: peerHex, reason: "rate limit", to: `0x${key}` });
        return true;
      }
      // Marked before the submit, so two quick /drip commands cannot both send.
      lastDrip.delete(key);
      lastDrip.set(key, now());
      while (lastDrip.size > maxEntries) lastDrip.delete(lastDrip.keys().next().value);
      let result;
      try {
        result = await chain.transfer(pair, { to: account, amount });
      } catch (error) {
        lastDrip.delete(key);
        log("BOT_FAUCET_FAILED", { peer: peerHex, to: `0x${key}`, error: String(error?.message ?? error) });
        await send.text(peerHex, "The transfer did not go through. Please try again later.");
        return true;
      }
      const chainId = await chain.genesisHash();
      if (!result.ok) {
        lastDrip.delete(key);
        log("BOT_FAUCET_FAILED", { peer: peerHex, to: `0x${key}`, hash: result.hash, block: result.block, error: result.error });
        await send.reference(peerHex, { chainId, hash: result.hash, status: 3, block: result.block, note: `Drip failed: ${String(result.error).slice(0, 120)}` });
        return true;
      }
      log("BOT_FAUCET_DRIPPED", { peer: peerHex, to: `0x${key}`, plancks: String(amount), hash: result.hash, block: result.block });
      await send.reference(peerHex, { chainId, hash: result.hash, status: 1, block: result.block, note: `Dripped ${formatPas(amount)}` });
      return true;
    },
  };
}
