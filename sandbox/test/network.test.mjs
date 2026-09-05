// The network table: mock is the default and self-contained; paseo is
// bot-core's Paseo Next profile (one table for the bot and the persona), and
// an unknown id is an error, never a silent fall-back to the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PASEO } from "../../bot-core/lib/network-config.mjs";
import { DEFAULT_NETWORK, MOCK, NETWORK_IDS, PASEO_NEXT, networkProfile } from "../lib/network.mjs";

test("mock is the default; paseo mirrors bot-core's PASEO profile; a typo is refused", () => {
  assert.equal(DEFAULT_NETWORK, "mock");
  assert.deepEqual(NETWORK_IDS, ["mock", "paseo"]);
  assert.equal(networkProfile(), MOCK);
  assert.deepEqual([MOCK.mock, MOCK.peopleEndpoints, MOCK.identityBackendUrl, MOCK.hopUploadNode], [true, [], null, null]);
  const paseo = networkProfile("paseo");
  assert.equal(paseo, PASEO_NEXT);
  assert.equal(paseo.mock, false);
  assert.deepEqual(paseo.peopleEndpoints, PASEO.peopleEndpoints, "the statement store is the People RPC bot-core uses");
  assert.equal(paseo.identityBackendUrl, PASEO.identityBackendUrl);
  assert.equal(paseo.hopUploadNode, PASEO.bulletin.hopEndpoints[0], "uploads go to the same HOP node a paseo bot uploads to");
  assert.deepEqual(paseo.hopEndpoints, PASEO.bulletin.hopEndpoints);
  assert.equal(paseo.bulletinRpcEndpoint, PASEO.bulletin.rpcEndpoint);
  assert.equal(paseo.botProfile, "paseo", "bot-core's allowance helper is keyed by its profile id");
  assert.match(paseo.peopleEndpoints[0], /^wss:\/\//);
  assert.throws(() => networkProfile("local"), /unknown network "local"/);
  assert.throws(() => networkProfile("sandbox"), /unknown network/);
});
