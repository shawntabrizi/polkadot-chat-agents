import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TESTNET_FILE_ALLOWANCE_BYTES,
  TESTNET_FILE_ALLOWANCE_MIN_BYTES,
  TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS,
  TESTNET_FILE_ALLOWANCE_MIN_TRANSACTIONS,
  TESTNET_FILE_ALLOWANCE_TRANSACTIONS,
  TestnetAllowanceFinalizationUnknownError,
  describeTestnetFileAllowance,
  ensureTestnetFileAllowance,
  hasSufficientTestnetFileAllowance,
  testnetFileAllowanceNetwork,
} from "../lib/testnet-file-allowance.mjs";
import { bulletinPaseoNextV2, productsDevnetBulletin } from "../lib/descriptors.mjs";

const ADDRESS = "5FaucetTestAddress";
const EXPECTED_GENESIS = productsDevnetBulletin.genesis;

function authorization({
  expiration = 1_000,
  transactions = 0,
  transactionsAllowance = TESTNET_FILE_ALLOWANCE_TRANSACTIONS,
  bytes = 0n,
  bytesAllowance = TESTNET_FILE_ALLOWANCE_BYTES,
} = {}) {
  return {
    expiration,
    extent: {
      transactions,
      transactions_allowance: transactionsAllowance,
      bytes,
      bytes_allowance: bytesAllowance,
    },
  };
}

function fakeAllowanceClient({
  current = null,
  block = 100,
  result = { ok: true, txHash: "0xabc" },
  genesisHash = EXPECTED_GENESIS,
  readAuthorization = null,
  submit = null,
} = {}) {
  let authorizationValue = current;
  let destroyed = 0;
  const calls = {
    chainSpec: 0,
    authorization: [],
    block: 0,
    descriptors: [],
    grants: [],
    refreshes: [],
    signers: [],
    submissions: [],
  };
  const transaction = (operation, args) => ({
    signAndSubmit: async (signer) => {
      calls.signers.push(signer);
      calls.submissions.push({ operation, args, signer });
      if (submit) return submit({
        operation,
        args,
        signer,
        calls,
        setAuthorization: (value) => { authorizationValue = value; },
      });
      if (result.ok) {
        if (operation === "refresh" && authorizationValue) {
          authorizationValue = {
            ...authorizationValue,
            expiration: block + TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS + 100,
          };
        } else {
          authorizationValue = authorization({
            expiration: block + TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS + 100,
          });
        }
      }
      return result;
    },
  });
  const api = {
    query: {
      TransactionStorage: {
        Authorizations: {
          getValue: async (...args) => {
            calls.authorization.push(args);
            if (readAuthorization) return readAuthorization({
              count: calls.authorization.length,
              current: authorizationValue,
            });
            return authorizationValue;
          },
        },
      },
      System: {
        Number: {
          getValue: async () => {
            calls.block += 1;
            return block;
          },
        },
      },
    },
    tx: {
      TransactionStorage: {
        authorize_account: (args) => {
          calls.grants.push(args);
          return transaction("authorize", args);
        },
        refresh_account_authorization: (args) => {
          calls.refreshes.push(args);
          return transaction("refresh", args);
        },
      },
    },
  };
  return {
    client: {
      getChainSpecData: async () => {
        calls.chainSpec += 1;
        return { genesisHash };
      },
      getTypedApi: (descriptor) => {
        calls.descriptors.push(descriptor);
        return api;
      },
      destroy: () => { destroyed += 1; },
    },
    calls,
    destroyed: () => destroyed,
  };
}

test("Products Devnet allowance status accounts for expiry, safety window, and remaining extent", () => {
  const healthy = describeTestnetFileAllowance(authorization({
    expiration: 199 + TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS,
    transactions: TESTNET_FILE_ALLOWANCE_TRANSACTIONS - TESTNET_FILE_ALLOWANCE_MIN_TRANSACTIONS,
    bytes: TESTNET_FILE_ALLOWANCE_BYTES - TESTNET_FILE_ALLOWANCE_MIN_BYTES,
  }), 199);
  assert.equal(healthy.active, true);
  assert.equal(healthy.remainingBlocks, TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS);
  assert.equal(healthy.remainingTransactions, TESTNET_FILE_ALLOWANCE_MIN_TRANSACTIONS);
  assert.equal(healthy.remainingBytes, TESTNET_FILE_ALLOWANCE_MIN_BYTES);
  assert.equal(hasSufficientTestnetFileAllowance(healthy), true);

  const exhausted = describeTestnetFileAllowance(authorization({
    transactions: TESTNET_FILE_ALLOWANCE_TRANSACTIONS,
    bytes: TESTNET_FILE_ALLOWANCE_BYTES,
  }), 199);
  assert.equal(exhausted.active, true);
  assert.equal(exhausted.remainingTransactions, 0);
  assert.equal(exhausted.remainingBytes, 0n);
  assert.equal(hasSufficientTestnetFileAllowance(exhausted), false);

  const expired = describeTestnetFileAllowance(authorization({ expiration: 199 }), 199);
  assert.equal(expired.active, false);

  const nearExpiry = describeTestnetFileAllowance(authorization({
    expiration: 199 + TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS - 1,
  }), 199);
  assert.equal(nearExpiry.active, true);
  assert.equal(hasSufficientTestnetFileAllowance(nearExpiry), false);

  const unrepresentableTransactions = describeTestnetFileAllowance(authorization({
    transactionsAllowance: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
  }), 199);
  assert.equal(unrepresentableTransactions.remainingTransactions, null);
  assert.equal(hasSufficientTestnetFileAllowance(unrepresentableTransactions), false);
});

test("Products Devnet allowance provisioning skips a sufficiently funded active authorization", async () => {
  const fixture = fakeAllowanceClient({ current: authorization() });
  const result = await ensureTestnetFileAllowance({
    address: ADDRESS,
    networkProfile: "devnet",
    createClient: () => fixture.client,
    createSigner: () => "faucet-signer",
  });

  assert.equal(result.action, "already-authorized");
  assert.equal(fixture.calls.chainSpec, 1);
  assert.equal(fixture.calls.grants.length, 0);
  assert.equal(fixture.calls.refreshes.length, 0);
  assert.equal(fixture.calls.authorization.length, 1);
  assert.equal(fixture.destroyed(), 1);
});

test("named testnet allowance profiles retain separate Devnet and Paseo chains", async () => {
  assert.equal(testnetFileAllowanceNetwork().descriptor, bulletinPaseoNextV2);
  assert.equal(testnetFileAllowanceNetwork("devnet").descriptor, productsDevnetBulletin);
  assert.equal(testnetFileAllowanceNetwork("paseo").descriptor, bulletinPaseoNextV2);
  assert.notEqual(
    testnetFileAllowanceNetwork("devnet").rpcEndpoint,
    testnetFileAllowanceNetwork("paseo").rpcEndpoint,
  );

  const fixture = fakeAllowanceClient({
    current: authorization(),
    genesisHash: bulletinPaseoNextV2.genesis,
  });
  const result = await ensureTestnetFileAllowance({
    address: "5PaseoFaucetTestAddress",
    networkProfile: "paseo",
    createClient: () => fixture.client,
    createSigner: () => "faucet-signer",
  });
  assert.equal(result.action, "already-authorized");
  assert.deepEqual(fixture.calls.descriptors, [bulletinPaseoNextV2]);
});

test("Products Devnet allowance provisioning grants a missing or depleted authorization", async () => {
  const fixture = fakeAllowanceClient({ current: authorization({
    transactions: TESTNET_FILE_ALLOWANCE_TRANSACTIONS - 1,
    bytes: TESTNET_FILE_ALLOWANCE_BYTES - 1n,
  }) });
  const result = await ensureTestnetFileAllowance({
    address: ADDRESS,
    networkProfile: "devnet",
    createClient: () => fixture.client,
    createSigner: () => "faucet-signer",
  });

  assert.equal(result.action, "authorized");
  assert.equal(result.statusVerified, true);
  assert.equal(result.txHash, "0xabc");
  assert.equal(result.active, true);
  assert.equal(fixture.calls.grants.length, 1);
  assert.equal(fixture.calls.refreshes.length, 0);
  assert.deepEqual(fixture.calls.grants[0], {
    who: ADDRESS,
    transactions: TESTNET_FILE_ALLOWANCE_TRANSACTIONS,
    bytes: TESTNET_FILE_ALLOWANCE_BYTES,
  });
  assert.deepEqual(fixture.calls.signers, ["faucet-signer"]);
  assert.equal(fixture.calls.authorization.length, 2, "re-reads status after finalization");
  assert.equal(fixture.destroyed(), 1);
});

test("Products Devnet allowance provisioning refreshes a funded authorization near expiry", async () => {
  const fixture = fakeAllowanceClient({ current: authorization({
    expiration: 100 + TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS - 1,
  }) });
  const started = [];
  const result = await ensureTestnetFileAllowance({
    address: ADDRESS,
    networkProfile: "devnet",
    createClient: () => fixture.client,
    createSigner: () => "faucet-signer",
    onSubmissionStarting: (operation) => { started.push(operation); },
  });

  assert.equal(result.action, "refreshed");
  assert.equal(result.statusVerified, true);
  assert.equal(hasSufficientTestnetFileAllowance(result), true);
  assert.deepEqual(fixture.calls.refreshes, [{ who: ADDRESS }]);
  assert.equal(fixture.calls.grants.length, 0);
  assert.deepEqual(started, ["refresh"]);
  assert.deepEqual(fixture.calls.submissions.map(({ operation }) => operation), ["refresh"]);
  assert.equal(fixture.destroyed(), 1);
});

test("Products Devnet allowance provisioning refreshes before topping up a near-expiry depleted authorization", async () => {
  const fixture = fakeAllowanceClient({ current: authorization({
    expiration: 100 + TESTNET_FILE_ALLOWANCE_MIN_REMAINING_BLOCKS - 1,
    transactions: TESTNET_FILE_ALLOWANCE_TRANSACTIONS - 1,
    bytes: TESTNET_FILE_ALLOWANCE_BYTES - 1n,
  }) });
  const result = await ensureTestnetFileAllowance({
    address: ADDRESS,
    networkProfile: "devnet",
    createClient: () => fixture.client,
    createSigner: () => "faucet-signer",
  });

  assert.equal(result.action, "refreshed-and-authorized");
  assert.equal(result.statusVerified, true);
  assert.equal(hasSufficientTestnetFileAllowance(result), true);
  assert.deepEqual(fixture.calls.refreshes, [{ who: ADDRESS }]);
  assert.equal(fixture.calls.grants.length, 1);
  assert.deepEqual(fixture.calls.submissions.map(({ operation }) => operation), ["refresh", "authorize"]);
  assert.equal(fixture.destroyed(), 1);
});

test("Products Devnet allowance provisioning rejects failed faucet transactions and closes the client", async () => {
  const fixture = fakeAllowanceClient({ current: null, result: { ok: false, txHash: "0xfailed" } });
  await assert.rejects(
    ensureTestnetFileAllowance({
      address: ADDRESS,
      networkProfile: "devnet",
      createClient: () => fixture.client,
      createSigner: () => "faucet-signer",
    }),
    /finalized without success/,
  );
  assert.equal(fixture.destroyed(), 1);
});

test("Products Devnet allowance provisioning refuses an unexpected chain before it queries or signs", async () => {
  const fixture = fakeAllowanceClient({ genesisHash: `0x${"00".repeat(32)}` });
  await assert.rejects(
    ensureTestnetFileAllowance({
      address: ADDRESS,
      networkProfile: "devnet",
      createClient: () => fixture.client,
      createSigner: () => "faucet-signer",
    }),
    /unexpected chain/,
  );
  assert.equal(fixture.calls.authorization.length, 0);
  assert.equal(fixture.calls.grants.length, 0);
  assert.equal(fixture.destroyed(), 1);
});

test("Products Devnet allowance provisioning keeps an unverified finalized grant from being retried", async () => {
  const unverifiedAddress = "5FaucetUnverifiedFinalizationAddress";
  const fixture = fakeAllowanceClient({
    current: null,
    readAuthorization: ({ count, current }) => {
      if (count === 2) throw new Error("follow-up query lost");
      return current;
    },
  });
  const result = await ensureTestnetFileAllowance({
    address: unverifiedAddress,
    networkProfile: "devnet",
    createClient: () => fixture.client,
    createSigner: () => "faucet-signer",
  });

  assert.equal(result.action, "authorized");
  assert.equal(result.statusVerified, false);
  assert.equal(result.present, null);
  assert.equal(result.active, null);
  assert.equal(result.remainingBlocks, null);
  assert.equal(result.remainingTransactions, null);
  assert.equal(result.remainingBytes, null);
  assert.equal(fixture.destroyed(), 1);
  await assert.rejects(
    ensureTestnetFileAllowance({
      address: unverifiedAddress,
      networkProfile: "devnet",
      createClient: () => fixture.client,
      createSigner: () => "faucet-signer",
    }),
    (error) => error instanceof TestnetAllowanceFinalizationUnknownError,
  );
  assert.equal(fixture.calls.chainSpec, 1, "the unverified finalized grant cannot be automatically retried");
});

test("Products Devnet allowance provisioning marks a stalled submission as unknown and closes the client", async () => {
  const unknownAddress = "5FaucetUnknownSubmissionAddress";
  let destroyed = 0;
  let clientCalls = 0;
  const client = {
    getChainSpecData: async () => ({ genesisHash: EXPECTED_GENESIS }),
    getTypedApi: () => ({
      query: {
        TransactionStorage: { Authorizations: { getValue: async () => null } },
        System: { Number: { getValue: async () => 100 } },
      },
      tx: {
        TransactionStorage: {
          authorize_account: () => ({ signAndSubmit: () => new Promise(() => {}) }),
        },
      },
    }),
    destroy: () => { destroyed += 1; },
  };
  await assert.rejects(
    ensureTestnetFileAllowance({
      address: unknownAddress,
      networkProfile: "devnet",
      createClient: () => {
        clientCalls += 1;
        return client;
      },
      createSigner: () => "faucet-signer",
      timeoutMs: 5,
    }),
    (error) => error instanceof TestnetAllowanceFinalizationUnknownError,
  );
  assert.equal(destroyed, 1);
  assert.equal(clientCalls, 1);
  await assert.rejects(
    ensureTestnetFileAllowance({
      address: unknownAddress,
      networkProfile: "devnet",
      createClient: () => {
        clientCalls += 1;
        return client;
      },
      createSigner: () => "faucet-signer",
    }),
    (error) => error instanceof TestnetAllowanceFinalizationUnknownError,
  );
  assert.equal(clientCalls, 1, "an ambiguous submission cannot be automatically retried");
});

test("Products Devnet allowance provisioning coalesces concurrent grants for the same account", async () => {
  let finishSubmission;
  let submissionStarted;
  const started = new Promise((resolve) => { submissionStarted = resolve; });
  const finished = new Promise((resolve) => { finishSubmission = resolve; });
  const fixture = fakeAllowanceClient({
    current: null,
    submit: async ({ setAuthorization }) => {
      submissionStarted();
      await finished;
      setAuthorization(authorization());
      return { ok: true, txHash: "0xconcurrent" };
    },
  });
  let clientCalls = 0;
  const options = {
    address: ADDRESS,
    networkProfile: "devnet",
    createClient: () => {
      clientCalls += 1;
      return fixture.client;
    },
    createSigner: () => "faucet-signer",
  };

  const first = ensureTestnetFileAllowance(options);
  await started;
  const second = ensureTestnetFileAllowance(options);
  assert.equal(fixture.calls.grants.length, 1);
  assert.equal(clientCalls, 1);
  finishSubmission();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.action, "authorized");
  assert.equal(secondResult.action, "authorized");
  assert.equal(fixture.destroyed(), 1);
});
