// SPDX-License-Identifier: GPL-3.0-or-later

// Child process hosting one headless T3ams "person" (fixtures/human.ts,
// compiled). The app keeps its state in module-level stores, so every
// participant needs a process of its own. Driven over IPC: the parent sends
// { id, method, args } and gets { id, result } or { id, error } back.

import path from "node:path";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import { deriveSr25519PairFromSeed } from "../../../vendor/lib/wallet-keys.mjs";
import { botSeedFromHex, deriveT3amsIdentityFromSeed } from "../../../transports/t3ams/t3ams-identity.mjs";
import { createT3amsFileKv } from "../../../transports/t3ams/file-kv.mjs";
import { createT3amsStatementTransport } from "../../../transports/t3ams/statement-transport.mjs";

const { RUNTIME_DIR, SEED_HEX, USERNAME, DISPLAY_NAME, NAMESPACE, ENDPOINT, STATE_DIR } = process.env;
const seed = botSeedFromHex(SEED_HEX);
const material = deriveT3amsIdentityFromSeed(seed);
const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
const { startHuman } = await import(path.join(RUNTIME_DIR, "human.mjs"));

const human = await startHuman({
  signingPrivateKey: material.signingPrivateKey,
  agreementPrivateKey: material.agreementPrivateKey,
  accountAddress: ss58Address(material.accountId),
  accountPublicKey: material.accountId,
  username: USERNAME,
  displayName: DISPLAY_NAME,
  namespace: NAMESPACE,
  storage: createT3amsFileKv(STATE_DIR),
  createStatementTransport: () => createT3amsStatementTransport({ endpoints: [ENDPOINT], walletPair: wallet }),
  txSigner: getPolkadotSigner(wallet.publicKey, "Sr25519", (bytes) => wallet.sign(bytes)),
  deriveEntropy: async (context) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...seed, ...context]))),
  log: () => {},
});

process.on("message", async ({ id, method, args }) => {
  try {
    const result = method === "xidHex" ? human.xidHex : await human[method](...args);
    process.send({ id, result: result ?? null });
  } catch (error) {
    process.send({ id, error: String(error?.stack ?? error) });
  }
});
process.send({ ready: true, xidHex: human.xidHex });
