// Named network profiles keep People, identity, Bulletin, and HOP endpoints
// together. A People endpoint alone cannot identify the matching off-chain
// services or attachment network.

const PEOPLE_ENDPOINTS = Object.freeze([
  "wss://people-paseo.rotko.net",
  "wss://rpc.interweb-it.com/people-paseo",
  "wss://people-paseo.gatotech.network",
]);

const BULLETIN_HOP_ENDPOINTS = Object.freeze([
  "wss://bullet.sik.rocks",
  "wss://bulletin-paseo.tservices.es:8443",
  "wss://bullet.tunastaking.eu",
]);

export const PRODUCTS_DEVNET = Object.freeze({
  id: "devnet",
  name: "Polkadot Products Devnet",
  peopleEndpoints: PEOPLE_ENDPOINTS,
  identityBackendUrl: "https://polkadot-app.api.polkadotcommunity.foundation",
  identityRegistrationAuth: "client-proof",
  bulletin: Object.freeze({
    name: "Bulletin Products Devnet",
    rpcEndpoint: BULLETIN_HOP_ENDPOINTS[0],
    hopEndpoints: BULLETIN_HOP_ENDPOINTS,
  }),
});

export const PASEO = Object.freeze({
  id: "paseo",
  name: "Paseo Next v2",
  peopleEndpoints: Object.freeze([
    "wss://paseo-people-next-system-rpc.polkadot.io",
  ]),
  identityBackendUrl: "https://identity-backend-next.parity-testnet.parity.io",
  identityRegistrationAuth: "none",
  bulletin: Object.freeze({
    name: "Bulletin Paseo Next v2",
    rpcEndpoint: "wss://paseo-bulletin-next-rpc.polkadot.io",
    hopEndpoints: Object.freeze([
      "wss://paseo-hop-next-0.polkadot.io",
      "wss://paseo-hop-next-1.polkadot.io",
    ]),
  }),
});

// The local sandbox (sandbox/): a store node and a directory that plays the
// People chain and the identity backend, on this machine only. It has no
// fixed endpoints — `pca create --network sandbox` reads them from the running
// daemon — and its store node speaks plain ws:// on loopback, the one place a
// bot may connect without TLS. No Bulletin/HOP network exists yet (v1.5).
export const SANDBOX = Object.freeze({
  id: "sandbox",
  name: "Local sandbox",
  peopleEndpoints: Object.freeze([]),
  identityBackendUrl: null,
  identityRegistrationAuth: "sandbox",
  bulletin: null,
  insecureEndpoints: true,
});

export const DEFAULT_NETWORK_PROFILE = PRODUCTS_DEVNET.id;
export const NETWORK_PROFILES = Object.freeze([PRODUCTS_DEVNET, PASEO, SANDBOX]);
export const NETWORK_PROFILE_IDS = Object.freeze(NETWORK_PROFILES.map((profile) => profile.id));

export function configuredNetworkProfile(id) {
  return NETWORK_PROFILES.find((profile) => profile.id === id) ?? null;
}

export function peopleEndpointsFor(endpoint, profileId = null) {
  const primary = String(endpoint ?? "").trim();
  const profile = configuredNetworkProfile(profileId);
  const endpoints = profile ? [primary, ...profile.peopleEndpoints] : [primary];
  return [...new Set(endpoints.filter(Boolean))];
}
