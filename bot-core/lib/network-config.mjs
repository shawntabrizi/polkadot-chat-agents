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
  identityRegistrationAuth: "voucher",
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

export const DEFAULT_NETWORK_PROFILE = PASEO.id;

export function configuredNetworkProfile(id) {
  if (id === PRODUCTS_DEVNET.id) return PRODUCTS_DEVNET;
  if (id === PASEO.id) return PASEO;
  return null;
}

export function peopleEndpointsFor(endpoint, profileId = null) {
  const primary = String(endpoint ?? "").trim();
  const profile = configuredNetworkProfile(profileId);
  const endpoints = profile ? [primary, ...profile.peopleEndpoints] : [primary];
  return [...new Set(endpoints.filter(Boolean))];
}
