// Internal CLI helper for named-testnet Bulletin file allowance provisioning.
//
// The supported testnets' public Bulletin Faucets sign
// TransactionStorage.authorize_account with the well-known //Eve development
// key. This helper performs that operation only for named, genesis-pinned
// profiles. Production and custom network provisioning require their own
// authorization flows and must never inherit a public development signer.

import { DEV_PHRASE, mnemonicToMiniSecret } from "@polkadot-labs/hdkd-helpers";
import { createClient, Enum } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws";
import { bulletinPaseoNextV2, productsDevnetBulletin } from "./descriptors.mjs";
import {
  DEFAULT_NETWORK_PROFILE,
  PASEO,
  PRODUCTS_DEVNET,
} from "./network-config.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";

const ALLOWANCE_NETWORKS = Object.freeze({
  [PRODUCTS_DEVNET.id]: Object.freeze({
    id: PRODUCTS_DEVNET.id,
    name: PRODUCTS_DEVNET.bulletin.name,
    rpcEndpoint: PRODUCTS_DEVNET.bulletin.rpcEndpoint,
    descriptor: productsDevnetBulletin,
  }),
  [PASEO.id]: Object.freeze({
    id: PASEO.id,
    name: PASEO.bulletin.name,
    rpcEndpoint: PASEO.bulletin.rpcEndpoint,
    descriptor: bulletinPaseoNextV2,
  }),
});

export function testnetFileAllowanceNetwork(profileId = DEFAULT_NETWORK_PROFILE) {
  const network = ALLOWANCE_NETWORKS[profileId];
  if (!network) throw new Error(`No managed testnet file allowance is configured for network profile "${String(profileId)}"`);
  return network;
}
// Match Playground CLI's automatic testnet allocation. This clears bot-core's
// 50 MiB file cap with room for HOP encryption and metadata overhead.
export const TESTNET_FILE_ALLOWANCE_TRANSACTIONS = 1_000;
export const TESTNET_FILE_ALLOWANCE_BYTES = 100_000_000n;
export const TESTNET_FILE_ALLOWANCE_MIN_TRANSACTIONS = 32;
export const TESTNET_FILE_ALLOWANCE_MIN_BYTES = 64n * 1024n * 1024n;
// Do not call an active authorization healthy when it is about to expire. The
// Bulletin pallet keeps the old expiry on an unexpired authorize_account call.
export const TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS = 256;
export const TESTNET_FILE_ALLOWANCE_TIMEOUT_MS = 30_000;
const AT_BEST = Object.freeze({ at: "best" });
const inFlightProvisioning = new Map();
const unresolvedProvisioning = new Set();

// A submission can reach the chain after the local RPC deadline. Callers must
// check status before considering another grant, otherwise an automatic retry
// would add another finite faucet allocation.
export class TestnetAllowanceFinalizationUnknownError extends Error {
  constructor(networkName, cause = null) {
    super(`The ${networkName} Faucet submission may have reached the chain, but finalization could not be confirmed. Check allowance status before retrying.`);
    this.name = "TestnetAllowanceFinalizationUnknownError";
    this.code = "TESTNET_ALLOWANCE_FINALIZATION_UNKNOWN";
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

export function describeTestnetFileAllowance(authorization, currentBlock) {
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

function hasSufficientTestnetFileAllowanceQuota(status) {
  return status.remainingTransactions != null
    && status.remainingTransactions >= TESTNET_FILE_ALLOWANCE_MIN_TRANSACTIONS
    && status.remainingBytes != null
    && status.remainingBytes >= TESTNET_FILE_ALLOWANCE_MIN_BYTES;
}

export function hasSufficientTestnetFileAllowance(status) {
  return status.active
    && status.remainingBlocks != null
    && status.remainingBlocks >= TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS
    && hasSufficientTestnetFileAllowanceQuota(status);
}

function needsTestnetFileAllowanceRefresh(status) {
  return status.active
    && status.remainingBlocks != null
    && status.remainingBlocks < TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS;
}

export function createTestnetFaucetSigner() {
  const pair = deriveSr25519PairFromSeed(mnemonicToMiniSecret(DEV_PHRASE), "//Eve");
  return getPolkadotSigner(pair.publicKey, "Sr25519", pair.sign);
}

export function createTestnetBulletinClient(networkProfile = DEFAULT_NETWORK_PROFILE) {
  return createClient(getWsProvider(testnetFileAllowanceNetwork(networkProfile).rpcEndpoint));
}

function normalizedAllowanceAddress(address) {
  if (typeof address !== "string" || address.trim() === "") {
    throw new Error("a Bulletin allowance address is required");
  }
  return address.trim();
}

async function assertTestnetBulletinGenesis(client, network, timeoutMs) {
  const expected = String(network.descriptor.genesis ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`The bundled ${network.name} descriptor has no valid genesis hash`);
  }
  const chainSpec = await withTimeout(
    client.getChainSpecData(),
    timeoutMs,
    `${network.name} chain identity query`,
  );
  const actual = String(chainSpec?.genesisHash ?? "").toLowerCase();
  if (actual !== expected) {
    throw new Error(`Refusing to use the ${network.name} Faucet on an unexpected chain (expected ${expected}, received ${actual || "no genesis hash"})`);
  }
}

async function readAllowance(api, address, networkName, timeoutMs) {
  const [authorization, block] = await withTimeout(Promise.all([
    api.query.TransactionStorage.Authorizations.getValue(Enum("Account", address), AT_BEST),
    api.query.System.Number.getValue(AT_BEST),
  ]), timeoutMs, `${networkName} allowance query`);
  return describeTestnetFileAllowance(authorization, block);
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
  provisioningKey,
  networkName,
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
      `${networkName} Faucet ${operation} transaction`,
    );
  } catch (error) {
    // Once signAndSubmit has started, a timeout or transport failure is
    // ambiguous: the signed extrinsic may finalize after the client closes.
    unresolvedProvisioning.add(provisioningKey);
    throw new TestnetAllowanceFinalizationUnknownError(networkName, error);
  }
  if (result?.ok === false) {
    throw new Error(`${networkName} Faucet ${operation} transaction was finalized without success`);
  }
  if (result?.ok !== true) {
    unresolvedProvisioning.add(provisioningKey);
    throw new TestnetAllowanceFinalizationUnknownError(networkName);
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

async function provisionTestnetFileAllowance({
  address,
  network,
  provisioningKey,
  makeClient,
  createSigner,
  timeoutMs,
  onSubmissionStarting,
}) {
  const client = makeClient();
  try {
    // The signer is a public development key. Verify the fixed genesis before
    // obtaining a typed API or constructing a transaction with it.
    await assertTestnetBulletinGenesis(client, network, timeoutMs);
    const api = client.getTypedApi(network.descriptor);
    const before = await readAllowance(api, address, network.name, timeoutMs);
    if (hasSufficientTestnetFileAllowance(before)) {
      return { action: "already-authorized", ...before };
    }

    const signer = createSigner();
    const transactions = [];
    const refreshNeeded = needsTestnetFileAllowanceRefresh(before);
    if (refreshNeeded) {
      transactions.push({
        operation: "refresh",
        result: await submitFaucetTransaction({
          provisioningKey,
          networkName: network.name,
          operation: "refresh",
          transaction: api.tx.TransactionStorage.refresh_account_authorization({ who: address }),
          signer,
          timeoutMs,
          onSubmissionStarting,
        }),
      });
    }
    if (!before.active || !hasSufficientTestnetFileAllowanceQuota(before)) {
      transactions.push({
        operation: "authorize",
        result: await submitFaucetTransaction({
          provisioningKey,
          networkName: network.name,
          operation: "authorize",
          transaction: api.tx.TransactionStorage.authorize_account({
            who: address,
            transactions: TESTNET_FILE_ALLOWANCE_TRANSACTIONS,
            bytes: TESTNET_FILE_ALLOWANCE_BYTES,
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
      const after = await readAllowance(api, address, network.name, timeoutMs);
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
      unresolvedProvisioning.add(provisioningKey);
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

// Check and, only when needed, authorize an account on a supported named
// testnet. Dependency injection keeps the decision testable without a real
// network or faucet submission.
export async function ensureTestnetFileAllowance({
  address,
  networkProfile = DEFAULT_NETWORK_PROFILE,
  createClient: makeClient = null,
  createSigner = createTestnetFaucetSigner,
  timeoutMs = TESTNET_FILE_ALLOWANCE_TIMEOUT_MS,
  onSubmissionStarting = null,
} = {}) {
  const target = normalizedAllowanceAddress(address);
  const network = testnetFileAllowanceNetwork(networkProfile);
  const provisioningKey = `${network.id}:${target}`;
  if (unresolvedProvisioning.has(provisioningKey)) {
    throw new TestnetAllowanceFinalizationUnknownError(network.name);
  }
  return shareProvisioning(provisioningKey, () => provisionTestnetFileAllowance({
    address: target,
    network,
    provisioningKey,
    makeClient: makeClient ?? (() => createTestnetBulletinClient(network.id)),
    createSigner,
    timeoutMs,
    onSubmissionStarting,
  }));
}

export async function getTestnetFileAllowanceStatus({
  address,
  networkProfile = DEFAULT_NETWORK_PROFILE,
  createClient: makeClient = null,
  timeoutMs = TESTNET_FILE_ALLOWANCE_TIMEOUT_MS,
} = {}) {
  const target = normalizedAllowanceAddress(address);
  const network = testnetFileAllowanceNetwork(networkProfile);
  const provisioningKey = `${network.id}:${target}`;
  const client = (makeClient ?? (() => createTestnetBulletinClient(network.id)))();
  try {
    await assertTestnetBulletinGenesis(client, network, timeoutMs);
    const status = await readAllowance(
      client.getTypedApi(network.descriptor),
      target,
      network.name,
      timeoutMs,
    );
    if (hasSufficientTestnetFileAllowance(status)) unresolvedProvisioning.delete(provisioningKey);
    return status;
  } finally {
    client.destroy?.();
  }
}
