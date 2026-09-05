// The network table: mock is the default and self-contained; paseo and
// devnet are bot-core's testnet profiles (one table for the bot and the
// persona), built by one rule so nothing is specific to either; an unknown
// id is an error, never a silent fall-back to the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PASEO, PRODUCTS_DEVNET } from "../../bot-core/lib/network-config.mjs";
import { DEFAULT_NETWORK, DEVNET, MOCK, NETWORK_IDS, PASEO_NEXT, networkProfile } from "../lib/network.mjs";

test("mock is the default and holds no endpoint; a typo is refused", () => {
  assert.equal(DEFAULT_NETWORK, "mock");
  assert.deepEqual(NETWORK_IDS, ["mock", "paseo", "devnet"]);
  assert.equal(networkProfile(), MOCK);
  assert.deepEqual([MOCK.mock, MOCK.peopleEndpoints, MOCK.identityBackendUrl, MOCK.identityRegistrationAuth, MOCK.hopUploadNode], [true, [], null, null, null]);
  assert.throws(() => networkProfile("local"), /unknown network "local"/);
  assert.throws(() => networkProfile("sandbox"), /unknown network/);
});

// Both testnets come from the same rule: every field is bot-core's, so a
// bot from `pca create --network <id>` and a persona see one network.
for (const [id, profile, sandbox, auth] of [["paseo", PASEO, PASEO_NEXT, "none"], ["devnet", PRODUCTS_DEVNET, DEVNET, "client-proof"]]) {
  test(`${id} mirrors bot-core's ${profile.name} profile; registration auth is ${auth}`, () => {
    const net = networkProfile(id);
    assert.equal(net, sandbox);
    assert.deepEqual([net.id, net.name, net.mock], [profile.id, profile.name, false]);
    assert.deepEqual(net.peopleEndpoints, profile.peopleEndpoints, "the statement store is the People RPC bot-core uses");
    assert.equal(net.identityBackendUrl, profile.identityBackendUrl);
    assert.equal(net.identityRegistrationAuth, auth, "how the backend admits a claim comes from the profile, not from the id");
    assert.equal(net.hopUploadNode, profile.bulletin.hopEndpoints[0], "uploads go to the same HOP node the bot uploads to");
    assert.deepEqual(net.hopEndpoints, profile.bulletin.hopEndpoints);
    assert.equal(net.bulletinRpcEndpoint, profile.bulletin.rpcEndpoint);
    assert.equal(net.botProfile, id, "bot-core's allowance helper (descriptor, genesis pin) is keyed by its profile id");
    assert.match(net.peopleEndpoints[0], /^wss:\/\//);
  });
}
