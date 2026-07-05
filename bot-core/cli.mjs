#!/usr/bin/env node
// pca — Polkadot Chat Agents CLI.
//
// Headless, flag-driven onboarding. One bot = one folder under ~/.pca/bots/<name>/
// (override with PCA_BOTS_DIR). Blockchain details (keys, addresses, topics)
// are handled for you; you just pick a name and a brain.
//
//   pca create <botname> [--brain echo|codex|claude|gemini|grok|hermes] [--network paseo] [--allow 0x..,0x..]
//   pca run <name>                  start the bot locally (foreground)
//   pca deploy <name> --host <ssh>  ship it to a server and run it in Docker
//   pca list                        list your bots
//   pca info <name>                 show a bot's address + how to message it

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
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
import { registerIdentity, waitForAttestation, withTimeout, DEFAULT_BACKENDS } from "./lib/register.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Proofs run via the vendored wasm build by default (no Rust toolchain needed);
// set PCA_BANDERSNATCH_CLI to a natively built binary to override.
const BANDERSNATCH_BIN = process.env.PCA_BANDERSNATCH_CLI ?? null;

async function withPeopleApi(endpoint, fn) {
  const client = createPapiClient(getWsProvider(endpoint));
  try { return await fn(client.getTypedApi(paseoPeopleNext)); }
  finally { client.destroy(); }
}

// Bots live in a stable per-user location so `pca list` finds them regardless of
// the working directory. Override with PCA_BOTS_DIR.
const BOTS_DIR = process.env.PCA_BOTS_DIR ?? path.join(os.homedir(), ".pca", "bots");
const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
// Cap container log growth on a VPS (json-file grows unbounded by default).
const LOG_OPTS = `    logging:\n      driver: json-file\n      options: { max-size: "10m", max-file: "3" }\n`;
const BRAINS = ["echo", "codex", "claude", "gemini", "grok", "hermes"];
// Brains that call a model and therefore spend your quota — never left open by default.
const PAID_BRAINS = new Set(["codex", "claude", "gemini", "grok", "hermes"]);

const bytesToHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

// Accept a Polkadot app address (SS58, e.g. "5Ggw…") or a raw 32-byte account
// hex, and return the bare lowercase account-id hex used by the allowlist.
function toAccountHex(addr) {
  const s = String(addr).trim();
  const hex = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(s);
  if (hex) return hex[1].toLowerCase();
  try {
    const [publicKey] = ss58Decode(s);
    return Array.from(publicKey, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch { fail(`"${addr}" isn't a valid address — use your app username (e.g. myname.42), your address (5…), or a 0x… account id.`); }
}

// Accept what a human actually knows: an app username (myname.42), an SS58
// address, or account hex. Usernames resolve to the account via the identity
// backend (the same registry the app's search uses).
async function resolvePeer(input, backendUrl) {
  const s = String(input).trim().replace(/^@/, "");
  if (/^[a-z]{6,}(\.\d{2,})?$/.test(s)) {
    let data;
    try {
      const res = await fetch(new URL(`/api/v1/usernames/${s}`, backendUrl));
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch { fail(`Couldn't find the username "${s}" on the network — check the spelling (it's shown in the app under your profile).`); }
    if (!data?.candidateAccountId) fail(`Username "${s}" has no account on the network yet.`);
    note(`${s} → ${data.candidateAccountId}`);
    return toAccountHex(data.candidateAccountId);
  }
  return toAccountHex(s);
}
const c = (s, code) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`${c("✓", "32")} ${s}`);
const step = (s) => console.log(`${c("→", "36")} ${s}`);
const note = (s) => console.log(`  ${c(s, "90")}`);
const warn = (s) => console.log(`${c("⚠", "33")} ${s}`);
const fail = (s) => { console.error(`${c("✗", "31")} ${s}`); process.exit(1); };

// Flags that are always boolean — they must never consume the following token,
// or `pca create --public mybot` would swallow the bot name into --public.
const BOOLEAN_FLAGS = new Set(["public", "dry-run", "no-register", "follow"]);
const SHORT_FLAGS = { "-f": "follow" };
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (SHORT_FLAGS[a]) { flags[SHORT_FLAGS[a]] = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      // Boolean flags take no value; otherwise consume the next token unless it's
      // itself a flag (values here are addresses/hex/usernames, never start with -).
      if (BOOLEAN_FLAGS.has(key) || next == null || next.startsWith("-")) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else positional.push(a);
  }
  return { flags, positional };
}

const botDir = (name) => path.join(BOTS_DIR, name);
const configPath = (name) => path.join(botDir(name), "config.json");
const secretPath = (name) => path.join(botDir(name), "secret.json");
const readConfig = (name) => {
  if (!name) fail("Which bot? Usage: pca <command> <botname>   (list yours with: pca list)");
  if (!fs.existsSync(configPath(name))) fail(`No bot named "${name}". Create it: pca create ${name}`);
  return JSON.parse(fs.readFileSync(configPath(name), "utf8"));
};
const listBots = () => (fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR).filter((n) => fs.existsSync(configPath(n))) : []);

// Older versions kept bots in ./bots relative to the working directory. A user
// upgrading with bots there would see "No bots yet" — and following the
// suggested `pca create` would mint a SECOND identity while the original
// (possibly deployed) one sits stranded. Point them at the move instead.
function warnLegacyBotsDir() {
  if (process.env.PCA_BOTS_DIR) return;
  const legacy = path.resolve(process.cwd(), "bots");
  if (legacy === BOTS_DIR) return;
  try {
    const legacyHasBots = fs.existsSync(legacy)
      && fs.readdirSync(legacy).some((n) => fs.existsSync(path.join(legacy, n, "config.json")));
    if (legacyHasBots && listBots().length === 0) {
      warn(`Found bots in ${legacy} from an older pca version — bots now live in ${BOTS_DIR}.`);
      note(`Move them:  mkdir -p ${path.dirname(BOTS_DIR)} && mv "${legacy}" "${BOTS_DIR}"`);
      note(`Or keep the old location:  export PCA_BOTS_DIR="${legacy}"`);
    }
  } catch { /* best-effort hint only */ }
}

const deeplink = (accountIdHex) => {
  const id = accountIdHex.replace(/^0x/, "");
  return `polkadotapp://chat?id=0:0x${id}&force=false&chatId=${id}`;
};

async function cmdCreate(name, flags) {
  if (!name) fail("Usage: pca create <botname>   (the first argument is your bot's name, e.g. pca create mycoolbot)");
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
  const allow = [];
  for (const input of allowInputs) allow.push(await resolvePeer(input, backendUrl));
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
  // If a specific .NN was requested, check it's free BEFORE any crypto or
  // registration — a taken number should fail fast and friendly, not as a raw
  // backend error. (No request = the network auto-assigns a free number.)
  const wantDigits = flags.digits ? String(flags.digits) : (/\.(\d{2})$/.exec(wantUsername)?.[1] ?? null);
  if (register && wantDigits) {
    const full = `${wantUsername.replace(/\.\d{2}$/, "")}.${wantDigits}`;
    let taken = false;
    try {
      const res = await fetch(new URL(`/api/v1/usernames/${full}`, backendUrl));
      taken = res.ok;
    } catch { /* backend unreachable here — let registration surface it */ }
    if (taken) fail(`The username ${full} is already taken.\n  Pick another number:  --digits <NN>\n  Or drop --digits and the network assigns a free one automatically.`);
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

  let reg = "skipped";
  if (register) {
    // Registration can fail or stay unconfirmed; the bot dir already exists, so
    // don't hard-exit — leave it resumable via `pca register`.
    reg = await runRegistration(name, config, { mnemonic, wantUsername, digits: wantDigits, wait: flags.wait });
  } else {
    note("Skipped registration (--no-register). Register later:  pca register " + name);
  }

  // A hard registration failure means nobody can message the bot yet — don't
  // print the success epilogue (deeplink + "Start it"), and exit non-zero so a
  // scripted `pca create … && pca deploy …` stops instead of deploying it.
  if (reg === "failed") {
    console.log();
    warn(`"${name}" was created but isn't registered, so people can't message it yet.`);
    note(`Finish registration:  pca register ${name}`);
    process.exitCode = 1;
    return;
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

// Register a bot on the network and wait for confirmation. Idempotent and
// resumable: claims the username only if not already claimed (re-POSTing a
// claimed name risks a conflict), then waits for attestation. Never throws —
// on failure it explains how to retry, so a bot dir is never a dead end.
// Returns "registered" | "pending" (claim ok, confirmation outstanding) |
// "failed" (no claim happened) so callers can set an honest exit code.
async function runRegistration(name, config, { mnemonic, wantUsername, digits, wait }) {
  if (BANDERSNATCH_BIN && !fs.existsSync(BANDERSNATCH_BIN)) {
    fail(`PCA_BANDERSNATCH_CLI points at ${BANDERSNATCH_BIN}, which doesn't exist.`);
  }
  const save = () => fs.writeFileSync(configPath(name), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (!config.username) {
    if (!mnemonic) { warn(`No mnemonic stored for "${name}" (imported bot?), so it can't be registered here.`); return "failed"; }
    step("Registering your bot on the network…");
    let result;
    try {
      result = await registerIdentity({ mnemonic, username: wantUsername, digits: digits ?? null, backendUrl: config.backendUrl, bandersnatchBin: BANDERSNATCH_BIN });
    } catch (e) {
      warn(`Registration didn't complete: ${e instanceof Error ? e.message : String(e)}`);
      note(`Retry when ready:  pca register ${name}`);
      return "failed";
    }
    config.username = result.username;
    save();
    ok(`Registered as ${result.username}`);
  } else if (config.registered) {
    ok(`Already registered as ${config.username}.`); return "registered";
  } else {
    step(`Username ${config.username} already claimed; waiting for the network to confirm…`);
  }
  const waitMs = Number(wait ?? 180) * 1000;
  step(`Waiting for the network to confirm (up to ${Math.round(waitMs / 1000)}s)…`);
  let attested = false;
  try {
    attested = await withPeopleApi(config.endpoint, (api) =>
      waitForAttestation(api, config.address, { timeoutMs: waitMs, onTick: () => process.stdout.write(".") }));
    process.stdout.write("\n");
  } catch (e) { process.stdout.write("\n"); warn(`Couldn't reach the network: ${e instanceof Error ? e.message : String(e)}`); }
  if (attested) { config.registered = true; save(); ok("Confirmed — your bot is live and people can message it!"); return "registered"; }
  warn(`Not confirmed yet — this can take a few minutes. Check or retry:  pca register ${name}`);
  return "pending";
}

async function cmdRegister(name, flags) {
  if (!name) fail("Usage: pca register <botname>");
  const cfg = readConfig(name);
  if (cfg.registered) { ok(`"${name}" is already registered as ${cfg.username}.`); return; }
  if (!fs.existsSync(secretPath(name))) fail(`No secret found for "${name}".`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  const wantUsername = String(flags.username ?? cfg.username ?? name);
  const wantDigits = flags.digits ? String(flags.digits) : (/\.(\d{2})$/.exec(wantUsername)?.[1] ?? null);
  const reg = await runRegistration(name, cfg, { mnemonic: secret.mnemonic, wantUsername, digits: wantDigits, wait: flags.wait });
  if (reg === "failed") process.exitCode = 1;
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
  let reachedNetwork = true;
  if (cfg.username && !cfg.registered) {
    try {
      messageable = await withPeopleApi(cfg.endpoint, async (api) =>
        withTimeout(api.query.Resources.Consumers.getValue(cfg.address), 12_000, "network check")
          .then((consumer) => consumer?.identifier_key != null));
      if (messageable) { cfg.registered = true; fs.writeFileSync(configPath(name), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 }); }
    } catch { reachedNetwork = false; }
  }
  // Distinguish never-registered from claimed-but-pending from confirmed.
  const status = messageable ? c("live — people can message it", "32")
    : !reachedNetwork ? c("can't reach the network right now (try again)", "31")
    : !cfg.username ? c(`not registered — run: pca register ${name}`, "33")
    : c(`username claimed, confirmation pending — check again or run: pca register ${name}`, "33");
  console.log(`${c(name, "1")}${cfg.username ? ` (${cfg.username})` : ""}`);
  console.log(`  brain:    ${cfg.brain}`);
  console.log(`  network:  ${cfg.endpoint}`);
  console.log(`  address:  ${cfg.address}`);
  console.log(`  access:   ${(cfg.allow?.length) ? `locked to ${cfg.allow.length} address${cfg.allow.length > 1 ? "es" : ""}` : c("open to anyone", "33")}`);
  console.log(`  status:   ${status}`);
  console.log();
  console.log(`  Message this bot in the Polkadot app:`);
  console.log(`    ${c(deeplink(cfg.account), "36")}`);
  if (cfg.username) note(`or search: ${cfg.username}`);
}

function cmdRun(name) {
  const cfg = readConfig(name);
  if (!fs.existsSync(secretPath(name))) fail(`"${name}" has no secret.json — its identity is missing. Recreate it: pca create ${name}`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  if (!cfg.registered) note("Warning: this bot isn't registered on the network yet, so people can't message it.");
  if (cfg.deploy?.host) warn(`Heads up: "${name}" is also deployed on ${cfg.deploy.host}. Running it here too = two processes on one identity (they will double-reply). Stop one first.`);
  step(`Starting "${name}" (${cfg.brain})…`);
  const env = {
    ...process.env,
    BOT_SEED_HEX: secret.seedHex,
    BOT_ENDPOINT: cfg.endpoint,
    BOT_BRIDGE_PORT: String(cfg.bridgePort),
    BOT_ALLOWED_PEERS: (cfg.allow ?? []).join(","),
    BOT_BRAIN: cfg.brain,
    BOT_USERNAME: cfg.username ?? "",
    BOT_STATE_DIR: botDir(name),   // persist sessions so a restart keeps open threads
  };
  const child = spawn(process.execPath, [path.join(HERE, "index.mjs")], { env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// Run a local command (ssh/rsync/scp), streaming progress; optionally capture stdout.
function runLocal(cmd, args, { capture = false } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
}

// Brains deploy can stand up as a single self-contained container. echo needs no
// model CLI; claude installs Claude Code and authenticates via ANTHROPIC_API_KEY.
// (codex/gemini/grok/hermes need an interactive login or a second container — not
// yet automated; see docs/HARNESSES.md.)
const DEPLOY_BRAINS = { echo: { install: null }, claude: { install: "npm i -g @anthropic-ai/claude-code" } };

async function cmdDeploy(name, flags) {
  if (!name) fail("Usage: pca deploy <name> --host <ssh-target> [--harness openclaw|hermes] [--anthropic-key <key>] [--model <m>] [--dry-run]");
  const host = flags.host ? String(flags.host) : null;
  if (!host) fail(`--host <ssh-target> is required, e.g.  pca deploy ${name} --host root@1.2.3.4`);
  const cfg = readConfig(name);
  if (!fs.existsSync(secretPath(name))) fail(`No secret found for "${name}".`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  if (cfg.brain === "hermes" || cfg.brain === "bridge") {
    const harness = flags.harness ? String(flags.harness).toLowerCase() : null;
    if (harness !== "openclaw" && harness !== "hermes") {
      fail(`"${name}" is a bridge-mode bot — pick which agent framework drives it:\n  pca deploy ${name} --host ${host} --harness openclaw   (fully headless if the server has Claude creds)\n  pca deploy ${name} --host ${host} --harness hermes     (one interactive codex login after deploy)`);
    }
    return deployHarnessStack(name, cfg, secret, flags, host, harness);
  }
  const spec = DEPLOY_BRAINS[cfg.brain];
  if (!spec) fail(`deploy supports the echo/claude brains and --harness openclaw|hermes for bridge bots.\nFor "${cfg.brain}", set it up manually — see docs/HARNESSES.md.`);
  if (!fs.existsSync(path.join(HERE, "node_modules")) || !fs.existsSync(path.join(HERE, ".papi"))) {
    fail(`bot-core dependencies missing. Run:  (cd ${HERE} && npm ci)  then retry.`);
  }
  const key = flags["anthropic-key"] ? String(flags["anthropic-key"]) : process.env.ANTHROPIC_API_KEY;
  if (cfg.brain === "claude" && !key) warn("No Anthropic key (--anthropic-key or ANTHROPIC_API_KEY) — the bot will start but can't answer until the container has one.");
  if (!cfg.registered) warn(`"${name}" isn't confirmed on the network yet — people can't message it until it is (pca info ${name}).`);

  const cn = `pca-${name}`;
  const base = flags["remote-dir"] ? String(flags["remote-dir"]) : `pca-bots/${name}`;
  const sshOpts = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];

  // Generate env + compose locally, then (unless dry-run) ship and launch.
  const envLines = [
    `BOT_SEED_HEX=${secret.seedHex}`,
    `BOT_ENDPOINT=${cfg.endpoint}`,
    `BOT_BRAIN=${cfg.brain}`,
    `BOT_ALLOWED_PEERS=${(cfg.allow ?? []).join(",")}`,
    `BOT_USERNAME=${cfg.username ?? ""}`,
    `BOT_STATE_DIR=/app/state`,   // persist sessions to the state volume (survives redeploys)
  ];
  if (flags.model) envLines.push(`BOT_AI_MODEL=${String(flags.model)}`);
  if (cfg.brain === "claude" && key) envLines.push(`ANTHROPIC_API_KEY=${key}`);
  const command = spec.install
    ? JSON.stringify(["sh", "-lc", `${spec.install} && exec node index.mjs`])
    : JSON.stringify(["node", "index.mjs"]);
  const compose = `services:\n  bot:\n    image: node:22-slim\n    container_name: ${cn}\n    restart: unless-stopped\n${LOG_OPTS}    working_dir: /app\n    volumes:\n      - ./app:/app\n      - ./state:/app/state\n    env_file:\n      - ./bot.env\n    command: ${command}\n`;

  if (flags["dry-run"] === true) {
    console.log(`\n--- ${base}/docker-compose.yml ---\n${compose}`);
    console.log(`--- ${base}/bot.env (secrets hidden) ---\n${envLines.map((l) => l.replace(/((?:SEED_HEX|ANTHROPIC_API_KEY)=).*/, "$1<hidden>")).join("\n")}`);
    note(`\nDry run — nothing deployed.`);
    return;
  }

  step(`Checking ${host}…`);
  const pf = runLocal("ssh", [...sshOpts, host, "docker version --format '{{.Server.Version}}' && docker compose version --short"], { capture: true });
  if (pf.status !== 0) fail(`Can't reach ${host} or Docker isn't available there.\n${(pf.stderr || "").trim()}`);
  ok(`Connected — Docker ${(pf.stdout || "").trim().replace(/\n/g, " / ")}`);

  runLocal("ssh", [...sshOpts, host, `mkdir -p ${base}/app ${base}/state`]);
  step("Uploading bot-core (code + dependencies)…");
  const rs = runLocal("rsync", ["-az", "--delete",
    "--exclude", "bots/", "--exclude", "*.log", "--exclude", "*.bak*", "--exclude", ".git",
    "-e", `ssh ${sshOpts.join(" ")}`, `${HERE}/`, `${host}:${base}/app/`]);
  if (rs.status !== 0) fail("Upload (rsync) failed.");
  ok("Uploaded");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pca-deploy-"));
  fs.writeFileSync(path.join(tmp, "bot.env"), `${envLines.join("\n")}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(tmp, "docker-compose.yml"), compose);
  const cp = runLocal("scp", [...sshOpts, path.join(tmp, "bot.env"), path.join(tmp, "docker-compose.yml"), `${host}:${base}/`]);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (cp.status !== 0) fail("Copying config (scp) failed.");
  // scp applies the remote umask, so restore 0600 on the env (it holds the seed).
  runLocal("ssh", [...sshOpts, host, `chmod 600 ${base}/bot.env`]);

  step("Starting the container…");
  const up = runLocal("ssh", [...sshOpts, host, `cd ${base} && docker compose -p ${cn} up -d`]);
  if (up.status !== 0) fail("docker compose up failed.");

  // Remember where this bot lives so `pca stop/logs/status` don't need --host.
  cfg.deploy = { host, dir: base, container: cn, at: new Date().toISOString() };
  fs.writeFileSync(configPath(name), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });

  step("Waiting for the bot to come online…");
  const wait = runLocal("ssh", [...sshOpts, host,
    `for i in $(seq 1 20); do docker logs ${cn} 2>&1 | grep -q BOT_LISTENING && break; sleep 2; done; docker logs --tail 30 ${cn} 2>&1`], { capture: true });
  const logs = wait.stdout || "";
  if (/BOT_LISTENING/.test(logs)) {
    ok(`"${name}" is live on ${host} (container ${cn}).`);
    console.log();
    console.log("Message it in the Polkadot app:");
    console.log(`  ${c(deeplink(cfg.account), "36")}`);
    if (cfg.username) note(`or search: ${cfg.username}`);
    console.log();
    note(`Logs:  ssh ${host} 'docker logs -f ${cn}'`);
    note(`Stop:  ssh ${host} 'docker rm -f ${cn}'`);
  } else {
    warn("Container started, but I didn't see BOT_LISTENING. Recent logs:");
    console.log(logs.split("\n").slice(-15).join("\n"));
    note(`Check:  ssh ${host} 'docker logs -f ${cn}'`);
  }
}

// Deploy a bridge-mode bot + its agent framework as a two-container compose
// stack — the exact topologies validated in production (see docs/HARNESSES.md).
// openclaw: fully headless if the server has Claude CLI creds (seeded into the
// container's non-root home — no root override needed). hermes: everything but
// the interactive codex login.
async function deployHarnessStack(name, cfg, secret, flags, host, harness) {
  const pluginSrc = path.join(HERE, "..", `${harness}-plugin`, "polkadot");
  if (!fs.existsSync(pluginSrc)) fail(`Plugin not found at ${pluginSrc} — deploy needs the full repo checkout.`);
  if (!fs.existsSync(path.join(HERE, "node_modules")) || !fs.existsSync(path.join(HERE, ".papi"))) {
    fail(`bot-core dependencies missing. Run:  (cd ${HERE} && npm ci)  then retry.`);
  }
  if (!cfg.registered) warn(`"${name}" isn't confirmed on the network yet — people can't message it until it is (pca info ${name}).`);
  const cn = `pca-${name}`;
  const hn = `pca-${name}-${harness}`;
  const base = flags["remote-dir"] ? String(flags["remote-dir"]) : `pca-bots/${name}`;
  const sshOpts = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];
  const allow = cfg.allow ?? [];
  const model = flags.model ? String(flags.model) : "claude-cli/claude-sonnet-4-6";

  const botEnv = [
    `BOT_SEED_HEX=${secret.seedHex}`,
    `BOT_ENDPOINT=${cfg.endpoint}`,
    `BOT_BRAIN=bridge`,
    `BOT_ALLOWED_PEERS=${allow.join(",")}`,
    `BOT_USERNAME=${cfg.username ?? ""}`,
    `BOT_STATE_DIR=/app/state`,
    // The harness container reaches the bridge over the compose network, so the
    // bridge must bind beyond loopback here (no ports are published to the host).
    `BOT_BRIDGE_HOST=0.0.0.0`,
  ].join("\n");
  const botService = `  bot:\n    image: node:22-slim\n    container_name: ${cn}\n    restart: unless-stopped\n${LOG_OPTS}    working_dir: /app\n    volumes:\n      - ./app:/app\n      - ./state:/app/state\n    env_file:\n      - ./bot.env\n    command: ["node", "index.mjs"]\n`;

  const files = { "bot.env": `${botEnv}\n` };  // path (relative to base) -> content
  let compose, setup, afterUp;
  if (harness === "openclaw") {
    compose = `services:\n${botService}\n  openclaw:\n    build: ./image\n    container_name: ${hn}\n    restart: unless-stopped\n${LOG_OPTS}    env_file:\n      - ./gateway.env\n    volumes:\n      - ./openclaw-home:/home/node\n      - ./plugin:/plugin:ro\n    depends_on: [bot]\n    command: ["openclaw", "gateway"]\n`;
    files["image/Dockerfile"] = `FROM node:22-slim\nRUN npm i -g openclaw @anthropic-ai/claude-code && npm cache clean --force\nENV HOME=/home/node\nWORKDIR /home/node\nUSER node\nCMD ["openclaw", "gateway"]\n`;
    files["gateway.env"] = `OPENCLAW_GATEWAY_TOKEN=${randomBytes(24).toString("hex")}\n`;
    // Runs inside the one-off setup container (home volume mounted) after `models set`
    // has created the config; merges in gateway mode + our channel.
    const channel = allow.length
      ? { enabled: true, bridgeUrl: "http://bot:8799", dmPolicy: "allowlist", allowFrom: allow }
      : { enabled: true, bridgeUrl: "http://bot:8799", dmPolicy: "open", allowFrom: ["*"] };
    files["openclaw-home/setup-config.cjs"] = `const fs = require("fs");
const p = "/home/node/.openclaw/openclaw.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.gateway = { ...(j.gateway ?? {}), mode: "local" };
j.channels = { ...(j.channels ?? {}), polkadot: ${JSON.stringify(channel)} };
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log("openclaw config ok");
`;
    setup = `set -e
cd ${base}
chown -R root:root plugin 2>/dev/null || true
mkdir -p openclaw-home/.claude
if [ -f "$HOME/.claude/.credentials.json" ]; then
  cp "$HOME/.claude/.credentials.json" openclaw-home/.claude/
  [ -f "$HOME/.claude.json" ] && cp "$HOME/.claude.json" openclaw-home/.claude.json
  chmod 700 openclaw-home/.claude
  echo CREDS_SEEDED
else
  echo NO_CREDS
fi
chown -R 1000:1000 openclaw-home 2>/dev/null || true
docker compose -p ${cn} build openclaw >/dev/null 2>&1 && echo IMAGE_BUILT
docker compose -p ${cn} run --rm openclaw sh -lc 'openclaw plugins install --link /plugin >/dev/null; openclaw models set ${model} >/dev/null; node /home/node/setup-config.cjs' 2>&1 | tail -2
`;
    afterUp = (creds) => {
      if (!creds) {
        warn("No Claude creds found on the server (~/.claude/.credentials.json) — the gateway is up but the model can't answer.");
        note(`Fix: log in on the server once (claude login), then rerun: pca deploy ${name} --host ${host} --harness openclaw`);
      }
    };
  } else {
    compose = `services:\n${botService}\n  hermes:\n    image: nousresearch/hermes-agent:latest\n    container_name: ${hn}\n    restart: unless-stopped\n${LOG_OPTS}    command: ["gateway", "run"]\n    environment:\n      - HERMES_UID=0\n      - HERMES_GID=0\n      - POLKADOT_BRIDGE_URL=http://bot:8799\n      - POLKADOT_ALLOWED_USERS=${allow.join(",")}\n    volumes:\n      - hermes-data:/opt/data\n      - ./plugin:/opt/data/plugins/polkadot:ro\n    depends_on: [bot]\n\nvolumes:\n  hermes-data:\n`;
    setup = `cd ${base}\nchown -R root:root plugin 2>/dev/null || true\necho SETUP_OK`;
    afterUp = () => {
      console.log();
      warn("Hermes needs a one-time model login (interactive, can't be automated):");
      note(`ssh ${host} 'docker exec -it ${hn} hermes auth add openai-codex --type oauth --no-browser'`);
      note(`then set the model in the hermes config — see docs/HARNESSES.md (gpt-5.5 / openai-codex).`);
    };
  }
  files["docker-compose.yml"] = compose;

  if (flags["dry-run"] === true) {
    for (const [rel, content] of Object.entries(files)) {
      console.log(`\n--- ${base}/${rel} ---\n${content.replace(/((?:SEED_HEX|TOKEN)=).*/g, "$1<hidden>")}`);
    }
    console.log(`\n--- remote setup ---\n${setup}`);
    note("Dry run — nothing deployed.");
    return;
  }

  step(`Checking ${host}…`);
  const pf = runLocal("ssh", [...sshOpts, host, "docker version --format '{{.Server.Version}}' >/dev/null && echo docker-ok"], { capture: true });
  if (pf.status !== 0) fail(`Can't reach ${host} or Docker isn't available there.\n${(pf.stderr || "").trim()}`);
  ok("Connected");

  runLocal("ssh", [...sshOpts, host, `mkdir -p ${base}/app ${base}/state ${base}/plugin ${base}/image ${base}/openclaw-home`]);
  step("Uploading bot-core + plugin…");
  const rs1 = runLocal("rsync", ["-az", "--delete", "--exclude", "bots/", "--exclude", "*.log", "--exclude", "*.bak*", "--exclude", ".git",
    "-e", `ssh ${sshOpts.join(" ")}`, `${HERE}/`, `${host}:${base}/app/`]);
  const rs2 = runLocal("rsync", ["-az", "--delete", "-e", `ssh ${sshOpts.join(" ")}`, `${pluginSrc}/`, `${host}:${base}/plugin/`]);
  if (rs1.status !== 0 || rs2.status !== 0) fail("Upload (rsync) failed.");
  ok("Uploaded");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pca-deploy-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, { mode: rel.endsWith(".env") ? 0o600 : 0o644 });
  }
  fs.writeFileSync(path.join(tmp, "setup.sh"), setup);
  const cp = runLocal("rsync", ["-az", "-e", `ssh ${sshOpts.join(" ")}`, `${tmp}/`, `${host}:${base}/`]);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (cp.status !== 0) fail("Copying config failed.");

  step(`Setting up ${harness} (image build — first run takes a few minutes)…`);
  const su = runLocal("ssh", [...sshOpts, host, `bash ${base}/setup.sh`], { capture: true });
  const setupOut = (su.stdout || "").trim();
  if (su.status !== 0) fail(`Remote setup failed:\n${setupOut.split("\n").slice(-5).join("\n")}`);
  const credsSeeded = /CREDS_SEEDED/.test(setupOut);
  ok(`Setup done${/IMAGE_BUILT/.test(setupOut) ? " (image built)" : ""}`);

  step("Starting the stack…");
  const up = runLocal("ssh", [...sshOpts, host, `cd ${base} && docker compose -p ${cn} up -d`]);
  if (up.status !== 0) fail("docker compose up failed.");
  cfg.deploy = { host, dir: base, container: cn, harness, at: new Date().toISOString() };
  fs.writeFileSync(configPath(name), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });

  step("Waiting for the bot to come online…");
  const wait = runLocal("ssh", [...sshOpts, host,
    `for i in $(seq 1 25); do docker logs ${cn} 2>&1 | grep -q BOT_LISTENING && break; sleep 2; done; docker logs --tail 5 ${cn} 2>&1`], { capture: true });
  if (/BOT_LISTENING/.test(wait.stdout || "")) {
    ok(`"${name}" is live on ${host} (${cn} + ${hn}).`);
    console.log();
    console.log("Message it in the Polkadot app:");
    console.log(`  ${c(deeplink(cfg.account), "36")}`);
    if (cfg.username) note(`or search: ${cfg.username}`);
    afterUp(credsSeeded);
    console.log();
    note(`Logs:   pca logs ${name} -f   (bridge)  ·  ssh ${host} 'docker logs -f ${hn}'  (${harness})`);
    note(`Status: pca status ${name}   ·  Stop: pca stop ${name}`);
  } else {
    warn("Stack started, but the bot didn't report BOT_LISTENING. Recent logs:");
    console.log((wait.stdout || "").split("\n").slice(-6).join("\n"));
  }
}

// Resolve the ssh target + container for a deployed bot: --host wins, else the
// deploy metadata saved by `pca deploy`.
function deployTarget(name, flags) {
  const cfg = readConfig(name);
  const host = flags.host ? String(flags.host) : cfg.deploy?.host;
  const cn = cfg.deploy?.container ?? `pca-${name}`;
  const dir = cfg.deploy?.dir;
  if (!host) fail(`"${name}" hasn't been deployed (no saved host). Deploy it, or pass --host <ssh>.`);
  return { cfg, host, cn, dir };
}
const SSH_OPTS = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];

function cmdLogs(name, flags) {
  const { host, cn } = deployTarget(name, flags);
  const follow = flags.follow === true || flags.f === true;
  const tail = String(flags.tail ?? 100);
  step(`Logs for "${name}" on ${host}${follow ? " (following — Ctrl-C to stop)" : ""}…`);
  // stdio inherit so -f streams live and Ctrl-C ends it.
  spawnSync("ssh", [...SSH_OPTS, ...(follow ? ["-t"] : []), host,
    `docker logs ${follow ? "-f " : ""}--tail ${tail} ${cn}`], { stdio: "inherit" });
}

function cmdStatus(name, flags) {
  const { host, cn } = deployTarget(name, flags);
  step(`Status of "${name}" on ${host}…`);
  const r = runLocal("ssh", [...SSH_OPTS, host,
    `docker ps --filter name=^/${cn}$ --format '{{.Status}}' | head -1; ` +
    // Probe /health with node (curl isn't in node:22-slim); BOT_BRIDGE_PORT defaults to 8799.
    `docker exec ${cn} node -e 'fetch("http://127.0.0.1:8799/health",{signal:AbortSignal.timeout(4000)}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.stdout.write("NO_HEALTH"))' 2>/dev/null; echo; ` +
    `docker logs --tail 1 ${cn} 2>&1 | grep -oE '"event":"[A-Z_]+"' | tail -1`], { capture: true });
  const [statusLine = "", health = "", lastEvent = ""] = (r.stdout || "").trim().split("\n");
  if (!statusLine) { warn(`Container ${cn} is not running on ${host}.`); return; }
  ok(`${cn}: ${statusLine}`);
  if (health.startsWith("{")) {
    try {
      const h = JSON.parse(health);
      const chain = h.ok ? c("reaching the network", "32") : c(`not reaching the network (last ok ${Math.round((h.lastPollAgoMs ?? 0) / 1000)}s ago)`, "31");
      note(`${h.username || "(no username)"} · ${chain}`);
    } catch { /* ignore */ }
  } else if (health) note(`health: ${health}`);
  if (lastEvent) note(`last event: ${lastEvent}`);
}

function cmdStop(name, flags) {
  const { host, cn, dir } = deployTarget(name, flags);
  step(`Stopping "${name}" (${cn}) on ${host}…`);
  // Prefer `compose down` (removes the network too) when we know the dir; fall back to rm -f.
  const cmd = dir ? `cd ${dir} && docker compose -p ${cn} down` : `docker rm -f ${cn}`;
  const r = runLocal("ssh", [...SSH_OPTS, host, cmd], { capture: true });
  if (r.status === 0) ok(`Stopped "${name}".`);
  else fail(`Could not stop "${name}" (exit ${r.status}).`);
}

function usage() {
  console.log(`pca — Polkadot Chat Agents

  pca create <botname> [--brain echo|codex|claude|gemini|grok|hermes] [--owner <your username or address>] [--public] [--network paseo] [--username name]
  pca register <name>                  finish/retry registration for an existing bot
  pca run <name>                       start the bot locally (foreground)
  pca deploy <name> --host <ssh>       ship it to a server and run it in Docker
  pca logs <name> [-f] [--tail N]      tail a deployed bot's logs
  pca status <name>                    is a deployed bot running + healthy?
  pca stop <name>                      stop a deployed bot
  pca list                             list your bots
  pca info <name>                      show address + how to message it

create flags:
  --owner <who>    lock the bot to you — your app username (myname.42), address, or 0x hex (recommended)
  --allow a,b      allowlist several owners (usernames/addresses/hex, comma-separated)
  --public         let anyone message it (required to leave an AI/hermes bot open)
  --username <u>   network username base if different from the bot name (6+ lowercase letters)
  --digits <NN>    request a specific username number (mybot.NN); omit to auto-assign a free one
  --no-register    create the identity locally without registering (finish later with pca register)
  --wait <secs>    how long to wait for on-chain confirmation (default 180)
  --network <ep>   target network: paseo (default) or a full wss:// endpoint

deploy flags:  --host root@1.2.3.4 (required)  ·  --harness openclaw|hermes (bridge bots)  ·  --anthropic-key <key> (claude brain)  ·  --model <m>  ·  --dry-run
  Needs Docker on the server + SSH access. Direct brains (echo/claude) deploy as one
  container; bridge bots deploy bot-core + the chosen agent framework as a two-container
  stack (openclaw is fully headless if the server has Claude CLI creds).
  logs/status/stop reuse the deploy host saved in the bot's config (override with --host).

Brains:  echo (test)  ·  codex/claude/gemini/grok (direct — shells to that CLI, which owns its own auth)  ·  hermes (hand off to an external agent harness)

Bots live in ${BOTS_DIR} (override with PCA_BOTS_DIR).`);
}

const { flags, positional } = parseFlags(process.argv.slice(2));
const [command, arg] = positional;
try {
  warnLegacyBotsDir();
  switch (command) {
    case "create": await cmdCreate(arg, flags); break;
    case "register": await cmdRegister(arg, flags); break;
    case "run": cmdRun(arg); break;                 // spawns a child; manages its own exit
    case "deploy": await cmdDeploy(arg, flags); break;
    case "logs": cmdLogs(arg, flags); break;
    case "status": cmdStatus(arg, flags); break;
    case "stop": cmdStop(arg, flags); break;
    case "list": cmdList(); break;
    case "info": await cmdInfo(arg); break;
    default: usage(); if (command != null) process.exit(1);
  }
  // Commands that open chain WS clients (create/info/deploy) keep the event loop
  // alive after finishing; exit explicitly (honoring any failure exit code set
  // by the command). `run` is the exception — it stays.
  if (command !== "run") process.exit(process.exitCode ?? 0);
} catch (e) { fail(e instanceof Error ? e.message : String(e)); }
