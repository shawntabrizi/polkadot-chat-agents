// Spec 0007 chain side: a small client for a pallet-revive chain (devnet
// Asset Hub) through Substrate extrinsics and runtime calls, with papi's
// metadata-driven (unsafe) API. No descriptors are generated for Asset Hub:
// the few calls used here are checked against the live metadata by papi.
//
// Used by the meter, faucet, flip and dao features (lib/meter.mjs, lib/faucet.mjs,
// lib/flip.mjs, lib/dao.mjs) and by contracts/*/deploy.mjs. Features take the object returned by
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
/**
 * Spec 0007 client rule 3 (revision 2026-09-23): one transactionReference per
 * transaction. Status 0 (submitted) goes out only when no best block holds the
 * extrinsic this long after the submit; otherwise the only reference is status
 * 1 or 3. Status 2 (finalized) is never sent: a receiver tracks it from the chain.
 */
export const REFERENCE_PENDING_AFTER_MS = 30_000;
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

// ---------- Solidity ABI: just what the meter, flip and dao contracts need ----------
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
// Dao (contracts/dao): groups by keccak256(group id), proposals, staked votes.
// Head/tail ABI encoding for the few argument types it takes.
const pad32 = (hex) => hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
const abiEncode = (types, values) => {
  const heads = [];
  const tails = [];
  let tailBytes = types.length * 32;
  for (const [i, type] of types.entries()) {
    const v = values[i];
    let tail = null;
    if (type === "address") heads.push(abiAddress(v));
    else if (type === "bytes32") heads.push(String(v).replace(/^0x/i, "").padStart(64, "0"));
    else if (type === "bool") heads.push(word(v ? 1n : 0n));
    else if (type === "uint256" || type === "uint64") heads.push(abiUint256(v));
    else if (type === "string" || type === "bytes") {
      const bytes = type === "string" ? new TextEncoder().encode(v) : typeof v === "string" ? fromHex(v) : v;
      tail = word(bytes.length) + pad32(toHex(bytes).slice(2));
    } else if (type === "address[]") tail = word(v.length) + v.map(abiAddress).join("");
    else throw new Error(`abi type ${type} is not supported here`);
    if (tail != null) { heads.push(word(tailBytes)); tails.push(tail); tailBytes += tail.length / 2; }
  }
  return heads.join("") + tails.join("");
};
/** The Dao's bytes32 for a chat group: keccak256 of the group id string. */
export const daoGroupKey = (groupId) => toHex(keccak_256(new TextEncoder().encode(String(groupId))));
export const daoCalldata = {
  setMembers: (groupKey, add, remove) => `${selector("setMembers(bytes32,address[],address[])")}${abiEncode(["bytes32", "address[]", "address[]"], [groupKey, add, remove])}`,
  fund: (groupKey) => `${selector("fund(bytes32)")}${abiEncode(["bytes32"], [groupKey])}`,
  propose: ({ groupKey, title, target, value, data = "0x", deadline }) => `${selector("propose(bytes32,string,address,uint256,bytes,uint64)")}${abiEncode(["bytes32", "string", "address", "uint256", "bytes", "uint64"], [groupKey, title, target, value, data, deadline])}`,
  vote: (id, support) => `${selector("vote(uint256,bool)")}${abiEncode(["uint256", "bool"], [id, support])}`,
  execute: (id) => `${selector("execute(uint256)")}${abiEncode(["uint256"], [id])}`,
  withdraw: (id) => `${selector("withdraw(uint256)")}${abiEncode(["uint256"], [id])}`,
  isMember: (groupKey, account) => `${selector("isMember(bytes32,address)")}${abiEncode(["bytes32", "address"], [groupKey, account])}`,
  groupAdmin: (groupKey) => `${selector("groupAdmin(bytes32)")}${abiEncode(["bytes32"], [groupKey])}`,
  treasury: (groupKey) => `${selector("treasury(bytes32)")}${abiEncode(["bytes32"], [groupKey])}`,
  count: () => selector("count()"),
  constructor: () => "0x",
};
export const eventTopic = (signature) => toHex(keccak_256(new TextEncoder().encode(signature)));

/**
 * Runs async jobs one at a time, in call order. The bot's own submits from one
 * account go through one queue: two extrinsics signed at the same best block
 * would get the same nonce, and one of them would be lost.
 */
export const serialQueue = () => {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  };
};

const withMargin = (value) => value + (value * MARGIN_PERCENT) / 100n;

/** The smallest headroom a `tx` intent's storage deposit limit gets over its worst case: 0.1 PAS. */
export const INTENT_DEPOSIT_HEADROOM = PLANCKS_PER_PAS / 10n;

/**
 * The limits a spec 0007 `tx` intent carries for one Revive call, from the
 * call's WORST case over every path the contract can take: the largest
 * storage deposit it can charge and the largest weight it can use.
 *   storageDepositLimit = max(deposit × 1.5, deposit + 0.1 PAS)
 *   gasRefTime, gasProofSize = weight × 1.5
 * Why the worst case, not a dry-run: the client's dry-run takes the path of
 * the state it reads, and the extrinsic can run in another state. A
 * contract's paths differ a lot: Flip's first stake stores two slots (a
 * charge), the settling stake clears them (a refund, so its dry-run says 0)
 * but needs 2.3× the weight. Two players, a third one, or a reorg of the
 * best block (seen 2026-09-24: a stake "in block #13630936" landed in
 * #13630955) move the extrinsic to the other path, and a limit sized from
 * the dry-run fails with `Revive.StorageDepositLimitExhausted` or
 * `Revive.OutOfGas`. The limits are caps: the signer pays only what the call
 * uses. The client signs with max(these limits, its own estimate + margin).
 */
export function reviveIntentLimits({ deposit, refTime, proofSize }) {
  const half = (value) => BigInt(value) + BigInt(value) / 2n;
  const byRatio = half(deposit);
  const byHeadroom = BigInt(deposit) + INTENT_DEPOSIT_HEADROOM;
  return {
    gasRefTime: half(refTime),
    gasProofSize: half(proofSize),
    storageDepositLimit: byRatio > byHeadroom ? byRatio : byHeadroom,
  };
}
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
  // onSlow(hash): called once when no best block holds it after
  // REFERENCE_PENDING_AFTER_MS (the caller may post a status 0 reference).
  const submit = (tx, pair, { onSlow = null } = {}) => new Promise((resolve, reject) => {
    let hash = null;
    let settled = false;
    let sub = null;
    const timer = setTimeout(() => finish(null, new Error(`not in a best block after ${inclusionTimeoutMs} ms${hash ? ` (${hash})` : ""}`)), inclusionTimeoutMs);
    const slowTimer = onSlow ? setTimeout(() => { if (!settled && hash) onSlow(hash); }, REFERENCE_PENDING_AFTER_MS) : null;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
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
    /**
     * Dry-run, then sign a `Revive.call` with the dry-run's weight and deposit
     * plus a margin. `limits` (a spec 0007 intent's gasRefTime, gasProofSize,
     * storageDepositLimit): the signer rule of 0007 "Limits of a Revive call",
     * each field is the larger of the intent's value and the estimate + margin.
     */
    async callContract(pair, { dest, calldata, value = 0n, onSlow = null, limits = null }) {
      const dry = await self.dryRunCall({ origin: pair.publicKey, dest, calldata, value });
      if (!dry.ok) return { ok: false, dryRun: true, error: dry.revert, hash: null, block: null };
      const atLeast = (estimate, cap) => (cap != null && BigInt(cap) > estimate ? BigInt(cap) : estimate);
      const tx = api.tx.Revive.call({
        dest,
        value,
        weight_limit: {
          ref_time: atLeast(withMargin(BigInt(dry.weight.ref_time)), limits?.gasRefTime),
          proof_size: atLeast(withMargin(BigInt(dry.weight.proof_size)), limits?.gasProofSize),
        },
        storage_deposit_limit: atLeast(withMargin(dry.deposit), limits?.storageDepositLimit),
        data: Binary.fromHex(calldata),
      });
      return submit(tx, pair, { onSlow });
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
    async transfer(pair, { to, amount, onSlow = null }) {
      const tx = api.tx.Balances.transfer_keep_alive({ dest: { type: "Id", value: ss58.dec(to) }, value: BigInt(amount) });
      return submit(tx, pair, { onSlow });
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
