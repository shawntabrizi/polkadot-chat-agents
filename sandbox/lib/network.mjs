// The networks the sandbox can run on. `mock` is the default: every part of
// the network is a process on this machine. `paseo` is the real Paseo Next
// network: the People chain's statement store, its Resources pallet as the
// directory, Parity's identity backend for registration, and the Bulletin
// HOP nodes for attachments — so personas can chat with deployed bots and
// with a phone. The endpoints come from bot-core's network table so a bot
// created with `pca create --network paseo` and a persona see one network.
//
// bot-core import allowed here by the S6 rules: lib/network-config.mjs is
// configuration, not the chat protocol under test.

import { PASEO } from "../../bot-core/lib/network-config.mjs";

export const MOCK = Object.freeze({
  id: "mock",
  name: "Local mock network",
  mock: true,
  peopleEndpoints: Object.freeze([]),
  identityBackendUrl: null,
  hopUploadNode: null,
  bulletinRpcEndpoint: null,
});

export const PASEO_NEXT = Object.freeze({
  id: "paseo",
  name: PASEO.name,
  mock: false,
  peopleEndpoints: PASEO.peopleEndpoints,
  identityBackendUrl: PASEO.identityBackendUrl,
  // Uploads go to the first HOP node, as bot-core's profile does; every
  // node in the list is a trusted download host.
  hopUploadNode: PASEO.bulletin.hopEndpoints[0],
  hopEndpoints: PASEO.bulletin.hopEndpoints,
  bulletinRpcEndpoint: PASEO.bulletin.rpcEndpoint,
  /** bot-core's profile id, for its allowance helper and `pca create --network`. */
  botProfile: PASEO.id,
});

export const NETWORKS = Object.freeze([MOCK, PASEO_NEXT]);
export const NETWORK_IDS = Object.freeze(NETWORKS.map((n) => n.id));
export const DEFAULT_NETWORK = MOCK.id;

/** The profile for an id; throws for an unknown one so a typo never falls back to the mock. */
export function networkProfile(id = DEFAULT_NETWORK) {
  const found = NETWORKS.find((n) => n.id === id);
  if (!found) throw new Error(`unknown network "${id}" (use ${NETWORK_IDS.join(" or ")})`);
  return found;
}
