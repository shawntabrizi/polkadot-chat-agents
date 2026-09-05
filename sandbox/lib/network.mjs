// The networks the sandbox can run on. `mock` is the default: every part of
// the network is a process on this machine. The others are real testnets —
// the People chain's statement store, its Resources pallet as the
// directory, the identity backend for registration, and the Bulletin HOP
// nodes for attachments — so personas can chat with deployed bots and with
// a phone. Their endpoints come from bot-core's network table, one entry
// per testnet, so a bot created with `pca create --network <id>` and a
// persona on `pcs up --network <id>` see one network; nothing below is
// specific to one testnet, the table is the only difference between them.
//
// bot-core import allowed here by the S6 rules: lib/network-config.mjs is
// configuration, not the chat protocol under test.

import { PASEO, PRODUCTS_DEVNET } from "../../bot-core/lib/network-config.mjs";

export const MOCK = Object.freeze({
  id: "mock",
  name: "Local mock network",
  mock: true,
  peopleEndpoints: Object.freeze([]),
  identityBackendUrl: null,
  identityRegistrationAuth: null,
  hopUploadNode: null,
  bulletinRpcEndpoint: null,
});

/** A sandbox profile for one of bot-core's testnet profiles: the same id, the same endpoints. */
const testnet = (profile) => Object.freeze({
  id: profile.id,
  name: profile.name,
  mock: false,
  peopleEndpoints: profile.peopleEndpoints,
  identityBackendUrl: profile.identityBackendUrl,
  // How the identity backend admits a username claim: "none" (Paseo Next)
  // or "client-proof" (Products Devnet: a bearer minted by proving the
  // //wallet key, as `pca create` does).
  identityRegistrationAuth: profile.identityRegistrationAuth,
  // Uploads go to the first HOP node, as bot-core's profile does; every
  // node in the list is a trusted download host.
  hopUploadNode: profile.bulletin.hopEndpoints[0],
  hopEndpoints: profile.bulletin.hopEndpoints,
  bulletinRpcEndpoint: profile.bulletin.rpcEndpoint,
  /** bot-core's profile id, for its allowance helper (descriptor and genesis pin) and `pca create --network`. */
  botProfile: profile.id,
});

export const PASEO_NEXT = testnet(PASEO);
export const DEVNET = testnet(PRODUCTS_DEVNET);

export const NETWORKS = Object.freeze([MOCK, PASEO_NEXT, DEVNET]);
export const NETWORK_IDS = Object.freeze(NETWORKS.map((n) => n.id));
export const DEFAULT_NETWORK = MOCK.id;

/** The profile for an id; throws for an unknown one so a typo never falls back to the mock. */
export function networkProfile(id = DEFAULT_NETWORK) {
  const found = NETWORKS.find((n) => n.id === id);
  if (!found) throw new Error(`unknown network "${id}" (use ${NETWORK_IDS.join(", ")})`);
  return found;
}
