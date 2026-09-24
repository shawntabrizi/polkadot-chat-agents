#!/usr/bin/env node
// Deploy Dao.sol (PolkaVM bytecode from `forge build --resolc`) to a
// pallet-revive chain through Substrate extrinsics (no ETH-RPC):
//
//   forge build --resolc
//   node deploy.mjs
//
// Options: --endpoint <wss> (repeatable; default devnet Asset Hub),
// --deployer //Alice (a derivation of the PUBLIC dev phrase; never a real
// key). The deployer has no role in the contract: a group's admin bot claims
// its group with its first setMembers call.
//
// Steps: map the deployer if needed, instantiate_with_code, wait for the
// best block, print the result as JSON (address, genesis, block).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReviveChain, daoCalldata, reviveAddress } from "../../bot-core/lib/revive-chain.mjs";
import { deriveSr25519PairFromMnemonic } from "../../bot-core/vendor/lib/wallet-keys.mjs";

const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";
const DEFAULT_ENDPOINTS = ["wss://asset-hub-paseo-rpc.n.dwellir.com", "wss://sys.turboflakes.io/asset-hub-paseo"];
const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, "out", "Dao.sol", "Dao.json");

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flags = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const fail = (message) => { console.error(`deploy: ${message}`); process.exit(1); };

const deployerPath = flag("deployer") ?? "//Alice";
if (!/^(\/\/?[^/]+)+$/.test(deployerPath)) fail("--deployer is a derivation path of the public dev phrase, e.g. //Alice");

const built = JSON.parse(fs.readFileSync(artifact, "utf8"));
const code = built.bytecode.object;
if (!code.startsWith("0x50564d00")) fail(`${artifact} is not PolkaVM bytecode; run \`forge build --resolc\` (not plain \`forge build\`)`);

const deployer = deriveSr25519PairFromMnemonic(DEV_PHRASE, deployerPath);
const chain = createReviveChain({ endpoints: flags("endpoint").length ? flags("endpoint") : DEFAULT_ENDPOINTS });
const log = (line) => console.error(`deploy: ${line}`);
try {
  const genesis = await chain.genesisHash();
  log(`chain ${genesis}; deployer ${deployerPath} (${reviveAddress(deployer.publicKey)})`);
  if (await chain.ensureMapped(deployer)) log("mapped the deployer (Revive.map_account)");
  const deployed = await chain.instantiateWithCode(deployer, { code, data: daoCalldata.constructor() });
  if (!deployed.ok) fail(`instantiate_with_code failed in block ${deployed.block}: ${deployed.error}`);
  log(`instantiated in block ${deployed.block} (${deployed.hash})`);
  console.log(JSON.stringify({
    genesis,
    address: deployed.address,
    block: deployed.block,
    extrinsic: deployed.hash,
    deployer: reviveAddress(deployer.publicKey),
    codeBytes: (code.length - 2) / 2,
  }, null, 2));
} finally {
  chain.destroy();
}
