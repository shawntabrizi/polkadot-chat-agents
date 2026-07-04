#!/usr/bin/env node
// pca — Polkadot Chat Agents CLI.
//
// Headless, flag-driven onboarding. One bot = one folder under ./bots/<name>/
// (override with PCA_BOTS_DIR). Blockchain details (keys, addresses, topics)
// are handled for you; you just pick a name and a brain.
//
//   pca create <name> [--brain echo|codex|claude|gemini|grok|hermes] [--network paseo] [--allow 0x..,0x..]
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
  ss58Decode,
} from "@polkadot-labs/hdkd-helpers";
import { createClient as createPapiClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { paseoPeopleNext } from "@polkadot-api/descriptors";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { deriveP256PrivateKey, p256PublicKeyFromPrivateKey } from "./vendor/app-chat-codec.mjs";
import { registerIdentity, waitForAttestation, DEFAULT_BACKENDS } from "./lib/register.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANDERSNATCH_BIN = process.env.PCA_BANDERSNATCH_CLI
  ?? path.join(HERE, "..", "tools", "bandersnatch-cli", "target", "debug", "summit-bandersnatch-cli");

async function withPeopleApi(endpoint, fn) {
  const client = createPapiClient(getWsProvider(endpoint));
  try { return await fn(client.getTypedApi(paseoPeopleNext)); }
  finally { client.destroy(); }
}

const BOTS_DIR = process.env.PCA_BOTS_DIR ?? path.resolve(process.cwd(), "bots");
const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
const BRAINS = ["echo", "codex", "claude", "gemini", "grok", "hermes"];
// Brains that call a model and therefore spend your quota — never left open by default.
const PAID_BRAINS = new Set(["codex", "claude", "gemini", "grok", "hermes"]);

const bytesToHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

// Accept a Polkadot app address (SS58, e.g. "5Ggw…") or a raw 32-byte account
// hex, and return the bare lowercase account-id hex used by the allowlist.
function toAccountHex(addr) {
  const s = String(addr).trim();
  const hex = /^0x?([0-9a-fA-F]{64})$/.exec(s);
  if (hex) return hex[1].toLowerCase();
  try {
    const [publicKey] = ss58Decode(s);
    return Array.from(publicKey, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch { fail(`"${addr}" isn't a valid address — use your Polkadot app address (starts with 5…) or a 0x… account id.`); }
}
const c = (s, code) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`${c("✓", "32")} ${s}`);
const step = (s) => console.log(`${c("→", "36")} ${s}`);
const note = (s) => console.log(`  ${c(s, "90")}`);
const warn = (s) => console.log(`${c("⚠", "33")} ${s}`);
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

async function cmdCreate(name, flags) {
  if (!name) fail("Usage: pca create <name>");
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) fail("Name must be lowercase letters/digits/hyphens, starting with a letter.");
  if (fs.existsSync(botDir(name))) fail(`Bot "${name}" already exists (${botDir(name)}). Use a different name.`);
  const brain = String(flags.brain ?? "echo").toLowerCase();
  if (!BRAINS.includes(brain)) fail(`--brain must be one of: ${BRAINS.join(", ")}`);
  const endpoint = flags.network == null || flags.network === "paseo" ? DEFAULT_ENDPOINT : String(flags.endpoint ?? flags.network);
  const backendUrl = flags.backend ? String(flags.backend) : DEFAULT_BACKENDS.paseo;
  const allowInputs = [
    ...String(flags.allow ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(flags.owner ? [String(flags.owner)] : []),
  ];
  const allow = allowInputs.map(toAccountHex);
  const isPublic = flags.public === true;
  // Safety: a paid brain (codex/claude/gemini/grok/hermes) left open to everyone can burn your quota.
  if (allow.length === 0 && !isPublic && PAID_BRAINS.has(brain)) {
    fail(`The "${brain}" brain spends your quota, so this bot can't be left open by default.\n  Lock it to you:  --owner <your Polkadot app address>\n  Or open to all:  --public`);
  }
  const register = flags["no-register"] !== true;
  // Network username must be >=6 lowercase letters; default to the bot name.
  const wantUsername = String(flags.username ?? name);
  if (register && !/^[a-z]{6,}(\.\d{2})?$/.test(wantUsername)) {
    fail(`To register, the name/username must be 6+ lowercase letters. Pass --username <letters> (or --no-register).`);
  }

  step(`Creating bot "${name}"…`);
  const mnemonic = generateMnemonic(128);
  const seed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const p256 = p256PublicKeyFromPrivateKey(deriveP256PrivateKey(deriveSr25519PairFromSeed(seed, "//wallet//chat")));
  const accountIdHex = bytesToHex(wallet.publicKey);
  const address = ss58Address(wallet.publicKey, 42);
  ok("Generated your bot's identity");

  fs.mkdirSync(botDir(name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(secretPath(name), `${JSON.stringify({ mnemonic, seedHex: bytesToHex(seed) }, null, 2)}\n`, { mode: 0o600 });
  const config = {
    name, endpoint, backendUrl, brain, allow,
    bridgePort: Number(flags.port ?? 8799),
    account: accountIdHex, address, identifierKey: bytesToHex(p256),
    username: null, registered: false, createdAt: new Date().toISOString(),
  };
  const save = () => fs.writeFileSync(configPath(name), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  save();

  if (register) {
    if (!fs.existsSync(BANDERSNATCH_BIN)) {
      fail(`Identity tool not built. Run:\n  cargo build --manifest-path ${path.relative(process.cwd(), path.join(HERE, "..", "tools", "bandersnatch-cli", "Cargo.toml"))}\nThen: pca create ${name}  (or pass --no-register to skip)`);
    }
    step("Registering your bot on the network…");
    let result;
    try {
      result = await registerIdentity({ mnemonic, username: wantUsername, digits: flags.digits ? String(flags.digits) : null, backendUrl, bandersnatchBin: BANDERSNATCH_BIN });
    } catch (e) { fail(`Registration failed: ${e instanceof Error ? e.message : String(e)}`); }
    config.username = result.username;
    save();
    ok(`Registered as ${result.username}`);
    const waitMs = Number(flags.wait ?? 180) * 1000;
    step(`Waiting for the network to confirm (up to ${Math.round(waitMs / 1000)}s)…`);
    const attested = await withPeopleApi(endpoint, (api) =>
      waitForAttestation(api, address, { timeoutMs: waitMs, onTick: () => process.stdout.write(".") }));
    process.stdout.write("\n");
    if (attested) { config.registered = true; save(); ok("Confirmed — your bot is live and people can message it!"); }
    else { warn(`Not confirmed yet — this can take a few minutes. Check later:  pca info ${name}`); }
  } else {
    note("Skipped registration (--no-register); the bot won't be messageable until registered.");
  }

  console.log();
  console.log(allow.length ? `Locked to ${allow.length} allowlisted address${allow.length > 1 ? "es" : ""} — only they can message it.`
                   : "Open — anyone can message it.");
  console.log("Message your bot in the Polkadot app:");
  console.log(`  ${c(deeplink(accountIdHex), "36")}`);
  if (config.username) note(`or search: ${config.username}`);
  console.log();
  note(`Start it:  pca run ${name}`);
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

async function cmdInfo(name) {
  const cfg = readConfig(name);
  // Live re-check: has the network confirmed (attested) the bot yet?
  let messageable = cfg.registered;
  if (cfg.username && !cfg.registered) {
    try {
      messageable = await withPeopleApi(cfg.endpoint, async (api) => {
        const consumer = await api.query.Resources.Consumers.getValue(cfg.address);
        return consumer?.identifier_key != null;
      });
      if (messageable) { cfg.registered = true; fs.writeFileSync(configPath(name), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 }); }
    } catch { /* offline; fall back to stored status */ }
  }
  console.log(`${c(name, "1")}${cfg.username ? ` (${cfg.username})` : ""}`);
  console.log(`  brain:    ${cfg.brain}`);
  console.log(`  network:  ${cfg.endpoint}`);
  console.log(`  address:  ${cfg.address}`);
  console.log(`  access:   ${(cfg.allow?.length) ? `locked to ${cfg.allow.length} address${cfg.allow.length > 1 ? "es" : ""}` : c("open to anyone", "33")}`);
  console.log(`  status:   ${messageable ? c("live — people can message it", "32") : c("registration pending (check again in a bit)", "33")}`);
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

  pca create <name> [--brain echo|codex|claude|gemini|grok|hermes] [--owner <your address>] [--public] [--network paseo] [--username name]
  pca run <name>       start the bot
  pca list             list your bots
  pca info <name>      show address + how to message it

  --owner <addr>   lock the bot so only your Polkadot app address can message it (recommended)
  --public         let anyone message it (required to leave an AI/hermes bot open)

Brains:  echo (test)  ·  codex/claude/gemini/grok (direct — shells to that CLI, which owns its own auth)  ·  hermes (hand off to an external agent harness)

Bots live in ${BOTS_DIR} (override with PCA_BOTS_DIR).`);
}

const { flags, positional } = parseFlags(process.argv.slice(2));
const [command, arg] = positional;
try {
  switch (command) {
    case "create": await cmdCreate(arg, flags); break;
    case "run": cmdRun(arg); break;
    case "list": cmdList(); break;
    case "info": await cmdInfo(arg); break;
    default: usage(); if (command != null) process.exit(1);
  }
} catch (e) { fail(e instanceof Error ? e.message : String(e)); }
