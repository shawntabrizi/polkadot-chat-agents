// Internal CLI helper for testnet-only Bulletin file allowance provisioning.
//
// Paseo's public Bulletin Faucet signs TransactionStorage.authorize_account
// with the well-known //Eve development key. This helper performs that exact
// fixed-network operation locally so bot operators do not need to use the web
// console. It is deliberately not configurable: production and custom network
// provisioning require their own authorization flows and must never inherit a
// public development signer.

import { DEV_PHRASE, mnemonicToMiniSecret } from "@polkadot-labs/hdkd-helpers";
import { createClient, Enum } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws";
import { bulletinPaseoNextV2 } from "./descriptors.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";

export const PASEO_BULLETIN_RPC = "wss://paseo-bulletin-next-rpc.polkadot.io";
// Match Playground CLI's automatic testnet allocation. This clears bot-core's
// 50 MiB file cap with room for HOP encryption and metadata overhead.
export const PASEO_FILE_ALLOWANCE_TRANSACTIONS = 1_000;
export const PASEO_FILE_ALLOWANCE_BYTES = 100_000_000n;
export const PASEO_FILE_ALLOWANCE_MIN_TRANSACTIONS = 32;
export const PASEO_FILE_ALLOWANCE_MIN_BYTES = 64n * 1024n * 1024n;
// Do not call an active authorization healthy when it is about to expire. The
// Bulletin pallet keeps the old expiry on an unexpired authorize_account call.
export const PASEO_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS = 256;
export const PASEO_FILE_ALLOWANCE_TIMEOUT_MS = 30_000;
const AT_BEST = Object.freeze({ at: "best" });
const inFlightProvisioning = new Map();
const unresolvedProvisioning = new Set();

// A submission can reach the chain after the local RPC deadline. Callers must
// check status before considering another grant, otherwise an automatic retry
// would add another finite faucet allocation.
export class PaseoAllowanceFinalizationUnknownError extends Error {
  constructor(cause = null) {
    super("The Paseo Bulletin Faucet submission may have reached the chain, but finalization could not be confirmed. Check allowance status before retrying.");
    this.name = "PaseoAllowanceFinalizationUnknownError";
    this.code = "PASEO_ALLOWANCE_FINALIZATION_UNKNOWN";
    if (cause != null) this.cause = cause;
  }
}

function integer(value) {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  return Number.isSafeInteger(value) ? value : null;
}

function expirationBlock(authorization) {
  return integer(authorization?.expiration);
}

function remainingExtent(authorization, allowanceField, usedField) {
  const allowance = authorization?.extent?.[allowanceField];
  const used = authorization?.extent?.[usedField];
  if ((typeof allowance !== "bigint" && !Number.isSafeInteger(allowance))
      || (typeof used !== "bigint" && !Number.isSafeInteger(used))) return null;
  const remaining = BigInt(allowance) - BigInt(used);
  return remaining > 0n ? remaining : 0n;
}

export function describePaseoFileAllowance(authorization, currentBlock) {
  const expiresAt = expirationBlock(authorization);
  const block = integer(currentBlock);
  const remainingTransactions = remainingExtent(authorization, "transactions_allowance", "transactions");
  const remainingBytes = remainingExtent(authorization, "bytes_allowance", "bytes");
  const active = authorization != null && expiresAt != null && block != null && expiresAt > block;
  return {
    present: authorization != null,
    active,
    expiresAt,
    currentBlock: block,
    remainingBlocks: expiresAt == null || block == null ? null : Math.max(0, expiresAt - block),
    remainingTransactions: remainingTransactions == null || remainingTransactions > BigInt(Number.MAX_SAFE_INTEGER)
      ? null
      : Number(remainingTransactions),
    remainingBytes,
  };
}

function hasSufficientPaseoFileAllowanceQuota(status) {
  return status.remainingTransactions != null
    && status.remainingTransactions >= PASEO_FILE_ALLOWANCE_MIN_TRANSACTIONS
    && status.remainingBytes != null
    && status.remainingBytes >= PASEO_FILE_ALLOWANCE_MIN_BYTES;
}

export function hasSufficientPaseoFileAllowance(status) {
  return status.active
    && status.remainingBlocks != null
    && status.remainingBlocks >= PASEO_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS
    && hasSufficientPaseoFileAllowanceQuota(status);
}

function needsPaseoFileAllowanceRefresh(status) {
  return status.active
    && status.remainingBlocks != null
    && status.remainingBlocks < PASEO_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS;
}

export function createPaseoFaucetSigner() {
  const pair = deriveSr25519PairFromSeed(mnemonicToMiniSecret(DEV_PHRASE), "//Eve");
  return getPolkadotSigner(pair.publicKey, "Sr25519", pair.sign);
}

export function createPaseoBulletinClient() {
  return createClient(getWsProvider(PASEO_BULLETIN_RPC));
}

function normalizedAllowanceAddress(address) {
  if (typeof address !== "string" || address.trim() === "") {
    throw new Error("a Bulletin allowance address is required");
  }
  return address.trim();
}

async function assertPaseoBulletinGenesis(client, timeoutMs) {
  const expected = String(bulletinPaseoNextV2.genesis ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(expected)) {
    throw new Error("The bundled Paseo Bulletin descriptor has no valid genesis hash");
  }
  const chainSpec = await withTimeout(
    client.getChainSpecData(),
    timeoutMs,
    "Paseo Bulletin chain identity query",
  );
  const actual = String(chainSpec?.genesisHash ?? "").toLowerCase();
  if (actual !== expected) {
    throw new Error(`Refusing to use the Paseo Bulletin Faucet on an unexpected chain (expected ${expected}, received ${actual || "no genesis hash"})`);
  }
}

async function readAllowance(api, address, timeoutMs) {
  const [authorization, block] = await withTimeout(Promise.all([
    api.query.TransactionStorage.Authorizations.getValue(Enum("Account", address), AT_BEST),
    api.query.System.Number.getValue(AT_BEST),
  ]), timeoutMs, "Paseo Bulletin allowance query");
  return describePaseoFileAllowance(authorization, block);
}

function pendingAllowanceStatus() {
  return {
    present: null,
    active: null,
    expiresAt: null,
    currentBlock: null,
    remainingBlocks: null,
    remainingTransactions: null,
    remainingBytes: null,
  };
}

async function submitFaucetTransaction({
  address,
  operation,
  transaction,
  signer,
  timeoutMs,
  onSubmissionStarting,
}) {
  // Persist any CLI-side ambiguity guard before signAndSubmit is invoked. A
  // process crash in or after this call must never make a duplicate grant the
  // automatic recovery path.
  await onSubmissionStarting?.(operation);
  let result;
  try {
    result = await withTimeout(
      transaction.signAndSubmit(signer),
      timeoutMs,
      `Paseo Bulletin Faucet ${operation} transaction`,
    );
  } catch (error) {
    // Once signAndSubmit has started, a timeout or transport failure is
    // ambiguous: the signed extrinsic may finalize after the client closes.
    unresolvedProvisioning.add(address);
    throw new PaseoAllowanceFinalizationUnknownError(error);
  }
  if (result?.ok === false) {
    throw new Error(`Paseo Bulletin Faucet ${operation} transaction was finalized without success`);
  }
  if (result?.ok !== true) {
    unresolvedProvisioning.add(address);
    throw new PaseoAllowanceFinalizationUnknownError();
  }
  return result;
}

function shareProvisioning(address, provision) {
  const existing = inFlightProvisioning.get(address);
  if (existing) return existing;

  const run = Promise.resolve().then(provision);
  inFlightProvisioning.set(address, run);
  const clear = () => {
    if (inFlightProvisioning.get(address) === run) inFlightProvisioning.delete(address);
  };
  run.then(clear, clear);
  return run;
}

async function provisionPaseoFileAllowance({
  address,
  makeClient,
  createSigner,
  timeoutMs,
  onSubmissionStarting,
}) {
  const client = makeClient();
  try {
    // The signer is a public development key. Verify the fixed genesis before
    // obtaining a typed API or constructing a transaction with it.
    await assertPaseoBulletinGenesis(client, timeoutMs);
    const api = client.getTypedApi(bulletinPaseoNextV2);
    const before = await readAllowance(api, address, timeoutMs);
    if (hasSufficientPaseoFileAllowance(before)) {
      return { action: "already-authorized", ...before };
    }

    const signer = createSigner();
    const transactions = [];
    const refreshNeeded = needsPaseoFileAllowanceRefresh(before);
    if (refreshNeeded) {
      transactions.push({
        operation: "refresh",
        result: await submitFaucetTransaction({
          address,
          operation: "refresh",
          transaction: api.tx.TransactionStorage.refresh_account_authorization({ who: address }),
          signer,
          timeoutMs,
          onSubmissionStarting,
        }),
      });
    }
    if (!before.active || !hasSufficientPaseoFileAllowanceQuota(before)) {
      transactions.push({
        operation: "authorize",
        result: await submitFaucetTransaction({
          address,
          operation: "authorize",
          transaction: api.tx.TransactionStorage.authorize_account({
            who: address,
            transactions: PASEO_FILE_ALLOWANCE_TRANSACTIONS,
            bytes: PASEO_FILE_ALLOWANCE_BYTES,
          }),
          signer,
          timeoutMs,
          onSubmissionStarting,
        }),
      });
    }
    const action = transactions.length === 2
      ? "refreshed-and-authorized"
      : transactions[0]?.operation === "refresh" ? "refreshed" : "authorized";
    const txHashes = transactions.map(({ result }) => result.txHash ?? null);

    // A best-effort re-read confirms the effective expiry and makes the CLI's
    // status output useful. Do not fall back to the pre-grant status: it would
    // incorrectly display a finalized grant as "not authorized".
    try {
      const after = await readAllowance(api, address, timeoutMs);
      return {
        action,
        ...after,
        txHash: txHashes.at(-1) ?? null,
        txHashes,
        statusVerified: true,
      };
    } catch {
      // A finalized faucet call without a verified post-state must not be
      // automatically retried: authorize_account is additive and the query
      // outage may be hiding the allocation that just landed.
      unresolvedProvisioning.add(address);
      return {
        action,
        ...pendingAllowanceStatus(),
        txHash: txHashes.at(-1) ?? null,
        txHashes,
        statusVerified: false,
      };
    }
  } finally {
    client.destroy?.();
  }
}

// Check and, only when needed, authorize an account using the public Paseo
// faucet. Dependency injection keeps the transaction decision testable without
// a real network or faucet submission.
export async function ensurePaseoFileAllowance({
  address,
  createClient: makeClient = createPaseoBulletinClient,
  createSigner = createPaseoFaucetSigner,
  timeoutMs = PASEO_FILE_ALLOWANCE_TIMEOUT_MS,
  onSubmissionStarting = null,
} = {}) {
  const target = normalizedAllowanceAddress(address);
  if (unresolvedProvisioning.has(target)) throw new PaseoAllowanceFinalizationUnknownError();
  return shareProvisioning(target, () => provisionPaseoFileAllowance({
    address: target,
    makeClient,
    createSigner,
    timeoutMs,
    onSubmissionStarting,
  }));
}

export async function getPaseoFileAllowanceStatus({
  address,
  createClient: makeClient = createPaseoBulletinClient,
  timeoutMs = PASEO_FILE_ALLOWANCE_TIMEOUT_MS,
} = {}) {
  const target = normalizedAllowanceAddress(address);
  const client = makeClient();
  try {
    await assertPaseoBulletinGenesis(client, timeoutMs);
    const status = await readAllowance(client.getTypedApi(bulletinPaseoNextV2), target, timeoutMs);
    if (hasSufficientPaseoFileAllowance(status)) unresolvedProvisioning.delete(target);
    return status;
  } finally {
    client.destroy?.();
  }
}
