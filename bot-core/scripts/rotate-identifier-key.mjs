#!/usr/bin/env node
// One-shot RFC-0004 identifier-key rotation.
//
// Peers encrypt to the identifier key registered on-chain, so a consumer
// record still carrying a pre-X25519 key leaves the bot unreachable after the
// protocol cutover. This script compares the on-chain container with the key
// bot-core derives from the bot's seed and, when they differ, submits the
// owner-signed Resources.update_identifier_key call.
//
// Deliberately a separate operator command (not runtime self-healing): a bot
// should not sign extrinsics on boot without a human deciding it should.
//
// Usage (same env the bot runs with):
//   BOT_SEED_HEX=… BOT_ENDPOINT=wss://… [BOT_NETWORK_PROFILE=…] node scripts/rotate-identifier-key.mjs
//   Add --dry-run to only report what would happen.

import process from "node:process";
import { createClient as createPapiClient } from "polkadot-api";
import { getPolkadotSigner } from "polkadot-api/signer";
import { getWsProvider } from "polkadot-api/ws";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { withTimeout } from "../vendor/lib/async-utils.mjs";
import {
  deriveX25519PrivateKey,
  x25519PublicKeyFromPrivateKey,
  encodeAccountEcdhKey,
} from "../vendor/app-chat-codec.mjs";
import {
  DEFAULT_NETWORK_PROFILE,
  PRODUCTS_DEVNET,
  configuredNetworkProfile,
  peopleEndpointsFor,
} from "../lib/network-config.mjs";

const env = process.env;
const dryRun = process.argv.includes("--dry-run");

const seedHex = (env.BOT_SEED_HEX ?? "").trim().replace(/^0x/i, "");
if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
  console.error("BOT_SEED_HEX must be a 32-byte hex seed");
  process.exit(2);
}
const seed = Uint8Array.from(seedHex.match(/../g).map((b) => Number.parseInt(b, 16)));
const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
const container = encodeAccountEcdhKey(x25519PublicKeyFromPrivateKey(deriveX25519PrivateKey(seed)));
const containerHex = Buffer.from(container).toString("hex");
const address = ss58Address(wallet.publicKey, 42);

// Same profile/endpoint resolution as index.mjs, so the script talks to
// exactly the chain the bot runs against.
const explicitNetworkProfile = (env.BOT_NETWORK_PROFILE ?? "").trim();
const networkProfile = explicitNetworkProfile
  ? configuredNetworkProfile(explicitNetworkProfile)
  : env.BOT_ENDPOINT?.trim() ? null : configuredNetworkProfile(DEFAULT_NETWORK_PROFILE);
if (explicitNetworkProfile && !networkProfile) {
  console.error("BOT_NETWORK_PROFILE must be devnet, paseo, or empty for a compatible custom endpoint");
  process.exit(2);
}
const endpoint = env.BOT_ENDPOINT?.trim() || networkProfile?.peopleEndpoints[0] || PRODUCTS_DEVNET.peopleEndpoints[0];
const endpoints = peopleEndpointsFor(endpoint, networkProfile?.id);

const client = createPapiClient(getWsProvider(endpoints));
const norm = (hex) => String(hex ?? "").trim().replace(/^0x/i, "").toLowerCase();

// The bundled descriptors lag the testnet runtimes, and a checksum mismatch
// hard-blocks typed tx creation. This is a one-shot operator script talking to
// whatever runtime is live, so build the call from the runtime's own metadata
// (papi's untyped runtime-metadata API) instead of a vendored descriptor.
const api = client.getUnsafeApi();

try {
  const consumer = await withTimeout(api.query.Resources.Consumers.getValue(address), 20_000, "consumer lookup");
  if (consumer == null) {
    console.error(`no consumer record for ${address} — is the bot registered on this network?`);
    process.exit(1);
  }
  const onChain = norm(String(consumer.identifier_key ?? ""));
  if (onChain === containerHex) {
    console.log(`identifier key already current (x25519, 0x${containerHex.slice(0, 18)}…) — nothing to do`);
    process.exit(0);
  }
  console.log(`on-chain: 0x${onChain.slice(0, 18)}… (marker 0x${onChain.slice(0, 2) || "??"})`);
  console.log(`wanted:   0x${containerHex.slice(0, 18)}… (marker 0x00 = x25519)`);
  if (dryRun) {
    console.log("dry run — would submit Resources.update_identifier_key");
    process.exit(0);
  }
  const signer = getPolkadotSigner(wallet.publicKey, "Sr25519", (data) => wallet.sign(data));
  // papi 2.1.7's dynamic codec takes fixed-size [u8; N] values as hex strings.
  const tx = api.tx.Resources.update_identifier_key({ identifier_key: `0x${containerHex}` });
  // v15 metadata carries two non-optional custom signed extensions papi cannot
  // default: VerifyMultiSignature (variant; 0x00 = Disabled) and RestrictOrigins
  // (bool; 0x00 = false). A plain signed origin wants both switched off.
  const result = await withTimeout(tx.signAndSubmit(signer, {
    customSignedExtensions: {
      VerifyMultiSignature: { value: Uint8Array.of(0), additionalSigned: new Uint8Array() },
      RestrictOrigins: { value: Uint8Array.of(0), additionalSigned: new Uint8Array() },
    },
  }), 180_000, "identifier key update");
  if (result?.ok === false) {
    console.error(`update_identifier_key failed on-chain: ${JSON.stringify(result.dispatchError ?? null)}`);
    process.exit(1);
  }
  console.log(`identifier key rotated in block ${result?.block?.number ?? "?"} (tx ${result?.txHash ?? "?"})`);
  process.exit(0);
} catch (error) {
  console.error(`rotation failed: ${String(error?.message ?? error)}`);
  process.exit(1);
} finally {
  client.destroy();
}
