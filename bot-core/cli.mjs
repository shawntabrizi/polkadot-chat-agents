#!/usr/bin/env node
// pca — Polkadot Chat Agents CLI.
//
// Headless, flag-driven onboarding. One bot = one folder under ./bots/<name>/
// (override with PCA_BOTS_DIR). Blockchain details (keys, addresses, topics)
// are handled for you; you just pick a name and a brain.
//
//   pca create <name> [--brain echo|codex|hermes] [--network paseo] [--allow 0x..,0x..]
//   pca run <name>              start the bot (foreground)
//   pca list                    list your bots
//   pca info <name>             show a bot's address + how to message it
//
// Registration on the network is added in the next step; `create` currently
// provisions the identity + config locally.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  generateMnemonic,
  mnemonicToMiniSecret,
  ss58Address,
} from "@polkadot-labs/hdkd-helpers";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { deriveP256PrivateKey, p256PublicKeyFromPrivateKey } from "./vendor/app-chat-codec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = process.env.PCA_BOTS_DIR ?? path.resolve(process.cwd(), "bots");
const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
const BRAINS = ["echo", "codex", "hermes"];

const bytesToHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const c = (s, code) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`${c("✓", "32")} ${s}`);
const step = (s) => console.log(`${c("→", "36")} ${s}`);
const note = (s) => console.log(`  ${c(s, "90")}`);
const fail = (s) => { console.error(`${c("✗", "31")} ${s}`); process.exit(1); };

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else positional.push(a);
  }
  return { flags, positional };
}

const botDir = (name) => path.join(BOTS_DIR, name);
const configPath = (name) => path.join(botDir(name), "config.json");
const secretPath = (name) => path.join(botDir(name), "secret.json");
const readConfig = (name) => {
  if (!fs.existsSync(configPath(name))) fail(`No bot named "${name}". Create it: pca create ${name}`);
  return JSON.parse(fs.readFileSync(configPath(name), "utf8"));
};
const listBots = () => (fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR).filter((n) => fs.existsSync(configPath(n))) : []);

const deeplink = (accountIdHex) => {
  const id = accountIdHex.replace(/^0x/, "");
  return `polkadotapp://chat?id=0:0x${id}&force=false&chatId=${id}`;
};

function cmdCreate(name, flags) {
  if (!name) fail("Usage: pca create <name>");
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) fail("Name must be lowercase letters/digits/hyphens, starting with a letter.");
  if (fs.existsSync(botDir(name))) fail(`Bot "${name}" already exists (${botDir(name)}).`);
  const brain = String(flags.brain ?? "echo").toLowerCase();
  if (!BRAINS.includes(brain)) fail(`--brain must be one of: ${BRAINS.join(", ")}`);
  const endpoint = flags.network === "paseo" || flags.network == null ? DEFAULT_ENDPOINT : String(flags.endpoint ?? flags.network);
  const allow = String(flags.allow ?? "").split(",").map((s) => s.trim().replace(/^0x/i, "").toLowerCase()).filter(Boolean);

  step(`Creating bot "${name}"…`);
  const mnemonic = generateMnemonic(128);
  const seed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const p256 = p256PublicKeyFromPrivateKey(deriveP256PrivateKey(deriveSr25519PairFromSeed(seed, "//wallet//chat")));
  const accountIdHex = bytesToHex(wallet.publicKey);
  ok("Generated your bot's identity");

  fs.mkdirSync(botDir(name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(secretPath(name), `${JSON.stringify({ mnemonic, seedHex: bytesToHex(seed) }, null, 2)}\n`, { mode: 0o600 });
  const config = {
    name,
    endpoint,
    brain,
    allow,
    bridgePort: Number(flags.port ?? 8799),
    account: accountIdHex,
    address: ss58Address(wallet.publicKey, 42),
    identifierKey: bytesToHex(p256),
    username: flags.username ? String(flags.username) : null,
    registered: false,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath(name), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  ok(`Saved to ${botDir(name)}`);
  console.log();
  note("Network registration (so people can message it) is the next step — coming shortly.");
  note(`Then: pca run ${name}`);
}

function cmdList() {
  const bots = listBots();
  if (bots.length === 0) { note("No bots yet. Create one: pca create <name>"); return; }
  for (const name of bots) {
    const cfg = readConfig(name);
    console.log(`${c(name, "1")}  brain=${cfg.brain}  ${cfg.registered ? c("registered", "32") : c("not registered", "33")}`);
    note(cfg.address);
  }
}

function cmdInfo(name) {
  const cfg = readConfig(name);
  console.log(`${c(name, "1")}${cfg.username ? ` (${cfg.username})` : ""}`);
  console.log(`  brain:    ${cfg.brain}`);
  console.log(`  network:  ${cfg.endpoint}`);
  console.log(`  address:  ${cfg.address}`);
  console.log(`  status:   ${cfg.registered ? c("registered — messageable", "32") : c("not registered yet", "33")}`);
  console.log();
  console.log(`  Message this bot in the Polkadot app:`);
  console.log(`    ${c(deeplink(cfg.account), "36")}`);
  if (cfg.username) note(`or search: ${cfg.username}`);
}

function cmdRun(name) {
  const cfg = readConfig(name);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  if (!cfg.registered) note("Warning: this bot isn't registered on the network yet, so people can't message it.");
  step(`Starting "${name}" (${cfg.brain})…`);
  const env = {
    ...process.env,
    BOT_SEED_HEX: secret.seedHex,
    BOT_ENDPOINT: cfg.endpoint,
    BOT_BRIDGE_PORT: String(cfg.bridgePort),
    BOT_ALLOWED_PEERS: (cfg.allow ?? []).join(","),
    BOT_BRAIN: cfg.brain,
    BOT_USERNAME: cfg.username ?? "",
  };
  const child = spawn(process.execPath, [path.join(HERE, "index.mjs")], { env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function usage() {
  console.log(`pca — Polkadot Chat Agents

  pca create <name> [--brain echo|codex|hermes] [--network paseo] [--allow 0x..,..] [--username name]
  pca run <name>       start the bot
  pca list             list your bots
  pca info <name>      show address + how to message it

Bots live in ${BOTS_DIR} (override with PCA_BOTS_DIR).`);
}

const { flags, positional } = parseFlags(process.argv.slice(2));
const [command, arg] = positional;
switch (command) {
  case "create": cmdCreate(arg, flags); break;
  case "run": cmdRun(arg); break;
  case "list": cmdList(); break;
  case "info": cmdInfo(arg); break;
  default: usage(); if (command != null) process.exit(1);
}
