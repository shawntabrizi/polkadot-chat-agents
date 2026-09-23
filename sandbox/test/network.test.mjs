// The network table: mock is the default and self-contained; paseo and
// devnet are bot-core's testnet profiles (one table for the bot and the
// persona), built by one rule so nothing is specific to either; an unknown
// id is an error, never a silent fall-back to the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NETWORK, MOCK, NETWORK_IDS, networkProfile } from "../lib/network.mjs";

test("mock is the default and holds no endpoint; a typo is refused", () => {
  assert.equal(DEFAULT_NETWORK, "mock");
  assert.deepEqual(NETWORK_IDS, ["mock", "paseo", "devnet"]);
  assert.equal(networkProfile(), MOCK);
  assert.deepEqual([MOCK.mock, MOCK.peopleEndpoints, MOCK.identityBackendUrl, MOCK.identityRegistrationAuth, MOCK.hopUploadNode], [true, [], null, null, null]);
  assert.throws(() => networkProfile("local"), /unknown network "local"/);
  assert.throws(() => networkProfile("sandbox"), /unknown network/);
});

