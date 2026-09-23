#!/usr/bin/env node
// Deploy Meter.sol (PolkaVM bytecode from `forge build --resolc`) to a
// pallet-revive chain through Substrate extrinsics (no ETH-RPC):
//
//   forge build --resolc
//   node deploy.mjs --bot pcdmeter              # operator = that pca bot's wallet account
//   node deploy.mjs --operator <0x account32 | SS58>
//
// Options: --endpoint <wss> (repeatable; default devnet Asset Hub),
// --deployer //Alice (a derivation of the PUBLIC dev phrase; never a real
// key), --fund <PAS> (top the operator up to this free balance for fees,
// default 5; 0 = skip).
//
// Steps: map the deployer if needed, instantiate_with_code with
// constructor(operator's Revive address), wait for the best block, print the
// result as JSON (address, genesis, block, operator). The operator (the bot)
// maps its own account on its first charge.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReviveChain, meterCalldata, parseAccountId, reviveAddress, PLANCKS_PER_PAS } from "../../bot-core/lib/revive-chain.mjs";
import { deriveSr25519PairFromMnemonic } from "../../bot-core/vendor/lib/wallet-keys.mjs";

const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";
const DEFAULT_ENDPOINTS = ["wss://asset-hub-paseo-rpc.n.dwellir.com", "wss://sys.turboflakes.io/asset-hub-paseo"];
const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, "out", "Meter.sol", "Meter.json");

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flags = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const fail = (message) => { console.error(`deploy: ${message}`); process.exit(1); };

let operatorAccount = null;
if (flag("bot")) {
  const config = JSON.parse(fs.readFileSync(path.join(process.env.PCA_BOTS_DIR ?? path.join(os.homedir(), ".pca", "bots"), flag("bot"), "config.json"), "utf8"));
  operatorAccount = parseAccountId(config.account);
} else if (flag("operator")) {
  operatorAccount = parseAccountId(flag("operator"));
}
if (!operatorAccount) fail("pass --bot <pca bot name> or --operator <0x account32 | SS58>");
const deployerPath = flag("deployer") ?? "//Alice";
if (!/^(\/\/?[^/]+)+$/.test(deployerPath)) fail("--deployer is a derivation path of the public dev phrase, e.g. //Alice");
const fundPas = BigInt(flag("fund") ?? "5");

const built = JSON.parse(fs.readFileSync(artifact, "utf8"));
const code = built.bytecode.object;
if (!code.startsWith("0x50564d00")) fail(`${artifact} is not PolkaVM bytecode; run \`forge build --resolc\` (not plain \`forge build\`)`);

const deployer = deriveSr25519PairFromMnemonic(DEV_PHRASE, deployerPath);
const operator = reviveAddress(operatorAccount);
const chain = createReviveChain({ endpoints: flags("endpoint").length ? flags("endpoint") : DEFAULT_ENDPOINTS });
const log = (line) => console.error(`deploy: ${line}`);
try {
  const genesis = await chain.genesisHash();
  log(`chain ${genesis}; deployer ${deployerPath} (${reviveAddress(deployer.publicKey)}); operator ${operator}`);
  if (await chain.ensureMapped(deployer)) log("mapped the deployer (Revive.map_account)");
  const deployed = await chain.instantiateWithCode(deployer, { code, data: meterCalldata.constructor(operator) });
  if (!deployed.ok) fail(`instantiate_with_code failed in block ${deployed.block}: ${deployed.error}`);
  log(`instantiated in block ${deployed.block} (${deployed.hash})`);
  let funded = null;
  const target = fundPas * PLANCKS_PER_PAS;
  const free = await chain.freeBalance(operatorAccount);
  if (target > free) {
    const sent = await chain.transfer(deployer, { to: operatorAccount, amount: target - free });
    if (!sent.ok) fail(`funding the operator failed: ${sent.error}`);
    funded = { plancks: String(target - free), block: sent.block, hash: sent.hash };
    log(`funded the operator with ${target - free} plancks in block ${sent.block}`);
  }
  console.log(JSON.stringify({
    genesis,
    address: deployed.address,
    block: deployed.block,
    extrinsic: deployed.hash,
    deployer: reviveAddress(deployer.publicKey),
    operator,
    operatorAccount: `0x${Buffer.from(operatorAccount).toString("hex")}`,
    funded,
  }, null, 2));
} finally {
  chain.destroy();
}
