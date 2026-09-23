// Spec 0007 chain side: a small client for a pallet-revive chain (devnet
// Asset Hub) through Substrate extrinsics and runtime calls, with papi's
// metadata-driven (unsafe) API. No descriptors are generated for Asset Hub:
// the few calls used here are checked against the live metadata by papi.
//
// Used by the meter, faucet and flip features (lib/meter.mjs, lib/faucet.mjs,
// lib/flip.mjs) and by contracts/*/deploy.mjs. Features take the object returned by
// createReviveChain, so tests pass a fake with the same methods.

import { blake2b } from "@noble/hashes/blake2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { AccountId, Binary, createClient } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws";

import { withTimeout } from "../vendor/lib/async-utils.mjs";
import { metadataCache } from "./chain-client.mjs";

/** Plancks in one PAS (10 decimals). */
export const PLANCKS_PER_PAS = 10_000_000_000n;
/** A best-block inclusion that takes longer than this is reported as a failure. */
export const INCLUSION_TIMEOUT_MS = 90_000;
/** Dry-run weight and deposit are raised by this percentage before signing. */
const MARGIN_PERCENT = 20n;

const toHex = (bytes) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex) => {
  const clean = String(hex).replace(/^0x/i, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(clean)) throw new Error(`invalid hex: ${hex}`);
  return Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16));
};
const ss58 = AccountId(42);
// papi decodes Vec<u8> as Uint8Array or as a Binary, by version.
const asHex = (value) => (typeof value === "string" ? value : value instanceof Uint8Array ? toHex(value) : typeof value?.asHex === "function" ? value.asHex() : String(value));
const asBytes = (value) => (value instanceof Uint8Array ? value : typeof value?.asBytes === "function" ? value.asBytes() : fromHex(value));

/**
 * The H160 address pallet-revive gives an AccountId32 (AccountId32Mapper):
 * an account that ends in twelve 0xEE bytes is an Ethereum-derived one and
 * maps to its first 20 bytes; any other maps to keccak256(account)[12..32].
 */
export function reviveAddress(accountId) {
  const bytes = typeof accountId === "string" ? fromHex(accountId) : accountId;
  if (bytes.length !== 32) throw new Error("an AccountId32 is 32 bytes");
  if (bytes.subarray(20).every((b) => b === 0xee)) return toHex(bytes.subarray(0, 20));
  return toHex(keccak_256(bytes).subarray(12));
}

/** An account id (0x hex or SS58 of any prefix) -> 32 bytes, or null. */
export function parseAccountId(input) {
  const text = String(input ?? "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(text)) return fromHex(text);
  try {
    const hex = AccountId().enc(text);
    return hex.length === 32 ? hex : null;
  } catch { return null; }
}

// ---------- Solidity ABI: just what the meter and flip contracts need ----------
export const selector = (signature) => toHex(keccak_256(new TextEncoder().encode(signature)).subarray(0, 4));
const word = (big) => BigInt(big).toString(16).padStart(64, "0");
export const abiAddress = (h160) => {
  const clean = String(h160).replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`invalid H160: ${h160}`);
  return clean.padStart(64, "0");
};
export const abiUint256 = (value) => {
  const big = BigInt(value);
  if (big < 0n || big >= 1n << 256n) throw new Error("uint256 out of range");
  return word(big);
};
export const decodeUint256 = (data) => {
  const bytes = typeof data === "string" ? fromHex(data) : data;
  if (bytes.length !== 32) throw new Error(`a uint256 return is 32 bytes, got ${bytes.length}`);
  return BigInt(toHex(bytes));
};
/** A revert's Error(string) reason, or null. */
export const decodeRevertReason = (data) => {
  const hex = toHex(typeof data === "string" ? fromHex(data) : data ?? new Uint8Array(0)).slice(2);
  if (!hex.startsWith("08c379a0") || hex.length < 8 + 128) return null;
  const length = Number(BigInt(`0x${hex.slice(8 + 64, 8 + 128)}`));
  try { return new TextDecoder().decode(fromHex(hex.slice(8 + 128, 8 + 128 + length * 2))); } catch { return null; }
};

export const meterCalldata = {
  topUp: () => selector("topUp()"),
  balanceOf: (user) => `${selector("balanceOf(address)")}${abiAddress(user)}`,
  charge: (user, amount) => `${selector("charge(address,uint256)")}${abiAddress(user)}${abiUint256(amount)}`,
  constructor: (operator) => `0x${abiAddress(operator)}`,
};

// Flip (contracts/flip): stake() payable; stakeOf/pending views; events.
export const flipCalldata = {
  stake: () => selector("stake()"),
  stakeOf: (player) => `${selector("stakeOf(address)")}${abiAddress(player)}`,
  pending: () => selector("pending()"),
  constructor: () => "0x",
};
export const eventTopic = (signature) => toHex(keccak_256(new TextEncoder().encode(signature)));

const withMargin = (value) => value + (value * MARGIN_PERCENT) / 100n;
const chargeOf = (deposit) => (deposit?.type === "Charge" ? BigInt(deposit.value) : 0n);

/**
 * A client for one pallet-revive chain. `endpoints`: wss URLs (fallbacks
 * after the first). Every method reads or submits at the best block.
 */
export function createReviveChain({ endpoints, cacheDir, inclusionTimeoutMs = INCLUSION_TIMEOUT_MS } = {}) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) throw new Error("a revive chain needs at least one endpoint");
  const client = createClient(getWsProvider([...endpoints]), metadataCache(cacheDir ? { dir: cacheDir } : {}));
  const api = client.getUnsafeApi();
  const at = { at: "best" };
  let genesis = null;
  let ratio = null;

  const signerOf = (pair) => getPolkadotSigner(pair.publicKey, "Sr25519", pair.sign);

  // Sign, submit, and resolve at the first best block that holds the
  // extrinsic: { hash, block, ok, error }. A drop or timeout rejects.
  const submit = (tx, pair) => new Promise((resolve, reject) => {
    let hash = null;
    let settled = false;
    let sub = null;
    const timer = setTimeout(() => finish(null, new Error(`not in a best block after ${inclusionTimeoutMs} ms${hash ? ` (${hash})` : ""}`)), inclusionTimeoutMs);
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.unsubscribe();
      if (error) reject(error); else resolve(value);
    };
    sub = tx.signSubmitAndWatch(signerOf(pair)).subscribe({
      next: (event) => {
        if (event.type === "signed") hash = event.txHash;
        if (event.type === "txBestBlocksState" && event.found) {
          finish({
            hash: event.txHash,
            block: event.block.number,
            ok: event.ok,
            error: event.ok ? null : describeDispatchError(event.dispatchError),
            events: event.events,
          });
        }
      },
      error: (error) => finish(null, error),
    });
  });

  const self = {
    client,
    api,
    /** The chain's genesis hash, 0x hex (the spec 0007 chainId). */
    async genesisHash() {
      genesis ??= await withTimeout(client._request("chain_getBlockHash", [0]), 15_000, "genesis hash");
      return genesis;
    },
    /** EVM value units per native planck (1e8 on Asset Hub: 1 PAS = 1e10 plancks = 1e18 in the contract). */
    async nativeToEthRatio() {
      ratio ??= BigInt(await api.constants.Revive.NativeToEthRatio());
      return ratio;
    },
    async freeBalance(accountId) {
      const info = await api.query.System.Account.getValue(ss58.dec(accountId), at);
      return BigInt(info.data.free);
    },
    async isMapped(accountId) {
      return (await api.query.Revive.OriginalAccount.getValue(reviveAddress(accountId), at)) != null;
    },
    /** Dry-run a contract call at the best block: { ok, data, revert, weight, deposit }. */
    async dryRunCall({ origin, dest, calldata, value = 0n }) {
      const r = await api.apis.ReviveApi.call(ss58.dec(origin), dest, value, undefined, undefined, Binary.fromHex(calldata), at);
      const exec = r.result;
      const reverted = !exec.success || (exec.value.flags & 1) === 1;
      const data = exec.success ? asBytes(exec.value.data) : new Uint8Array(0);
      return {
        ok: !reverted,
        data,
        revert: !exec.success ? describeDispatchError(exec.value) : reverted ? decodeRevertReason(data) ?? "reverted" : null,
        weight: r.weight_required,
        deposit: chargeOf(r.max_storage_deposit ?? r.storage_deposit),
      };
    },
    /** A view call's return data, or throws with the revert reason. */
    async read({ origin, dest, calldata }) {
      const r = await self.dryRunCall({ origin, dest, calldata });
      if (!r.ok) throw new Error(`contract call reverted: ${r.revert}`);
      return r.data;
    },
    /** `Revive.map_account` once for the pair's account; true when it submitted one. */
    async ensureMapped(pair) {
      if (await self.isMapped(pair.publicKey)) return false;
      const result = await submit(api.tx.Revive.map_account(), pair);
      if (!result.ok) throw new Error(`map_account failed: ${result.error}`);
      return true;
    },
    /** Dry-run, then sign a `Revive.call` with the dry-run's weight and deposit plus a margin. */
    async callContract(pair, { dest, calldata, value = 0n }) {
      const dry = await self.dryRunCall({ origin: pair.publicKey, dest, calldata, value });
      if (!dry.ok) return { ok: false, dryRun: true, error: dry.revert, hash: null, block: null };
      const tx = api.tx.Revive.call({
        dest,
        value,
        weight_limit: { ref_time: withMargin(BigInt(dry.weight.ref_time)), proof_size: withMargin(BigInt(dry.weight.proof_size)) },
        storage_deposit_limit: withMargin(dry.deposit),
        data: Binary.fromHex(calldata),
      });
      return submit(tx, pair);
    },
    /** Dry-run, then sign a `Revive.instantiate_with_code`; resolves with the new contract address. */
    async instantiateWithCode(pair, { code, data, value = 0n }) {
      const codeBin = Binary.fromHex(typeof code === "string" ? code : toHex(code));
      const dataBin = Binary.fromHex(data);
      const dry = await api.apis.ReviveApi.instantiate(ss58.dec(pair.publicKey), value, undefined, undefined, { type: "Upload", value: codeBin }, dataBin, undefined, at);
      if (!dry.result.success || (dry.result.value.result.flags & 1) === 1) {
        throw new Error(`instantiate dry-run failed: ${JSON.stringify(dry.result, (k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
      }
      const tx = api.tx.Revive.instantiate_with_code({
        value,
        weight_limit: { ref_time: withMargin(BigInt(dry.weight_required.ref_time)), proof_size: withMargin(BigInt(dry.weight_required.proof_size)) },
        storage_deposit_limit: withMargin(chargeOf(dry.max_storage_deposit ?? dry.storage_deposit)),
        code: codeBin,
        data: dataBin,
        salt: undefined,
      });
      const result = await submit(tx, pair);
      const instantiated = result.events?.find((e) => e.type === "Revive" && e.value?.type === "Instantiated");
      return { ...result, address: instantiated?.value?.value?.contract ?? dry.result.value.addr };
    },
    /**
     * Calls onBlock({ number, hash, events }) for each new best block, in
     * order, with the `Revive.ContractEmitted` events of `contract`:
     * { topics: [0x hex], data: Uint8Array, extrinsicIndex, extrinsicHash }.
     * Blocks the best chain skipped over (up to the finalized one) are read
     * too; a reorg can deliver a block at a height already seen, so the
     * caller dedupes by content. Returns a stop function.
     */
    watchContractEvents(contract, onBlock, { onError = () => {} } = {}) {
      const want = String(contract).toLowerCase();
      const done = new Set();
      const DONE_CAP = 1024;
      let chain = Promise.resolve();
      const readBlock = async ({ hash, number }) => {
        const records = await api.query.System.Events.getValue({ at: hash });
        const events = [];
        let body = null;
        for (const record of records) {
          const { event, phase } = record;
          if (event?.type !== "Revive" || event.value?.type !== "ContractEmitted") continue;
          const emitted = event.value.value;
          if (String(asHex(emitted.contract)).toLowerCase() !== want) continue;
          const extrinsicIndex = phase?.type === "ApplyExtrinsic" ? phase.value : null;
          let extrinsicHash = null;
          if (extrinsicIndex != null) {
            body ??= await client.getBlockBody(hash);
            const xt = body[extrinsicIndex];
            if (xt) extrinsicHash = toHex(blake2b(asBytes(xt), { dkLen: 32 }));
          }
          events.push({ topics: emitted.topics.map((t) => String(asHex(t)).toLowerCase()), data: asBytes(emitted.data), extrinsicIndex, extrinsicHash });
        }
        return { number, hash, events };
      };
      let sub = null;
      let stopped = false;
      // The stream ends when papi loses block continuity (a reconnect):
      // subscribe again, so the watcher outlives a dropped socket.
      const restart = (error) => {
        onError(error ?? new Error("best-block stream ended"));
        if (!stopped) setTimeout(subscribe, 5_000).unref?.();
      };
      const subscribe = () => {
        if (stopped) return;
        sub = client.bestBlocks$.subscribe({
          next: (blocks) => {
            // blocks: best first, finalized last. Oldest unseen first.
            const fresh = blocks.filter((b) => !done.has(b.hash)).reverse();
            for (const b of fresh) {
              done.add(b.hash);
              while (done.size > DONE_CAP) done.delete(done.values().next().value);
              chain = chain.then(() => readBlock(b)).then((block) => onBlock(block)).catch(onError);
            }
          },
          error: restart,
          complete: () => restart(null),
        });
      };
      subscribe();
      return () => { stopped = true; sub?.unsubscribe(); };
    },
    /** `Balances.transfer_keep_alive` of `amount` plancks to a 32-byte account. */
    async transfer(pair, { to, amount }) {
      const tx = api.tx.Balances.transfer_keep_alive({ dest: { type: "Id", value: ss58.dec(to) }, value: BigInt(amount) });
      return submit(tx, pair);
    },
    destroy() { client.destroy(); },
  };
  return self;
}

function describeDispatchError(error) {
  if (!error) return "failed";
  const { type, value } = error;
  if (type === "Module" && value?.type) return `${value.type}.${value.value?.type ?? "?"}`;
  return typeof value === "string" ? `${type}: ${value}` : String(type ?? "failed");
}
