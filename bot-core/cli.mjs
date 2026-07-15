#!/usr/bin/env node
// pca — Polkadot Chat Agents CLI.
//
// Headless, flag-driven onboarding. One bot = one folder under ~/.pca/bots/<name>/
// (override with PCA_BOTS_DIR). Blockchain details (keys, addresses, topics)
// are handled for you; you just pick a name and a brain.
//
//   pca create <botname> [--brain echo|claude|codex|opencode|bridge] [--transport polkadot-app|t3ams] [--network paseo] [--allow 0x..,0x..]
//   pca run <name>                  start the bot locally (foreground)
//   pca deploy <name> --host <ssh>  ship it to a server and run it in Docker
//   pca list                        list your bots
//   pca info <name>                 show a bot's address + how to message it

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
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
import { paseoPeopleNext } from "./lib/descriptors.mjs";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { deriveP256PrivateKey, p256PublicKeyFromPrivateKey } from "./vendor/app-chat-codec.mjs";
import { entrypointForTransport } from "./lib/transport-entrypoint.mjs";
import { assertEngineToolPolicy, toolPolicyEnforcement } from "./lib/runners.mjs";
import {
  DEFAULT_TOOL_POLICY,
  ToolPolicyError,
  createToolPolicy,
  parseToolCapabilities,
  toolPolicyEnvironment,
  toolPolicySummary,
} from "./lib/tool-policy.mjs";
import { registerIdentity, waitForAttestation, withTimeout, DEFAULT_BACKENDS } from "./lib/register.mjs";
import {
  PaseoAllowanceFinalizationUnknownError,
  ensurePaseoFileAllowance,
  getPaseoFileAllowanceStatus,
  hasSufficientPaseoFileAllowance,
} from "./lib/testnet-file-allowance.mjs";

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
// Keep testnet attachment delivery deliberate and named. An arbitrary People
// endpoint tells us nothing about the matching Bulletin/HOP network, so only a
// known profile receives automatic HOP configuration.
const PASEO_TESTNET_FILE_DELIVERY = Object.freeze({
  profile: "paseo-next-v2",
  bulletinNetwork: "Bulletin Paseo Next v2",
  consoleUrl: "https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet",
  uploadNode: "wss://paseo-hop-next-0.polkadot.io",
  allowedNodes: Object.freeze([
    "paseo-hop-next-0.polkadot.io",
    "paseo-hop-next-1.polkadot.io",
  ]),
});
// Immutable multi-architecture manifests prevent a later deploy from silently
// receiving a republished mutable image.
const NODE_IMAGE = "node:22.22.0-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94";
const HERMES_IMAGE = "nousresearch/hermes-agent@sha256:9c841866021c54c4596849f6135717e8a4d52ba510b7f52c50aef1de1a283973";
// Cap container log growth on a VPS (json-file grows unbounded by default).
const LOG_OPTS = `    logging:\n      driver: json-file\n      options: { max-size: "10m", max-file: "3" }\n`;
const BRAINS = ["echo", "claude", "codex", "opencode", "bridge"];
const DEFAULT_TRANSPORT = "polkadot-app";
const TRANSPORTS = [DEFAULT_TRANSPORT, "t3ams"];
// Brains that call a model and therefore spend your quota — never left open by default.
const PAID_BRAINS = new Set(["claude", "codex", "opencode", "bridge"]);
// Direct engines shell out to a same-named CLI on this machine. Warn (don't fail —
// the bot may be destined for a server) when it isn't installed, or every message
// dies with BOT_AI_SPAWN_FAILED and the user only sees the apology text.
const DIRECT_BRAIN_CLIS = new Set(["claude", "codex", "opencode"]);
function warnMissingBrainCli(brain) {
  if (!DIRECT_BRAIN_CLIS.has(brain) || process.env.BOT_AI_CMD) return;
  const r = spawnSync("which", [brain], { stdio: "ignore" });
  if (r.status !== 0) {
    warn(`The "${brain}" CLI isn't installed here — the bot will run, but it can't answer until it is.`);
  }
}

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
const BOOLEAN_FLAGS = new Set(["public", "dry-run", "no-register", "follow", "greet", "yes", "help", "version", "media-analyzer", "t3ams-auto-accept-workspaces", "t3ams-no-auto-accept-workspaces"]);
const SHORT_FLAGS = { "-f": "follow", "-h": "help", "-V": "version" };
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

const BOT_NAME_RE = /^[a-z][a-z0-9-]{1,30}(?:\.\d{2})?$/;
const botDir = (name) => path.join(BOTS_DIR, name);
const configPath = (name) => path.join(botDir(name), "config.json");
const secretPath = (name) => path.join(botDir(name), "secret.json");
const allowanceProvisioningLockPath = (address) => path.join(
  BOTS_DIR,
  `.paseo-file-allowance-${createHash("sha256").update(address).digest("hex")}.lock`,
);
const saveConfig = (name, cfg) => {
  fs.writeFileSync(configPath(name), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(configPath(name), 0o600);
};

class CurrentConfigError extends Error {}

const isRecord = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const nonEmptyConfigString = (value) => typeof value === "string" && value.trim() === value && value.length > 0;
const configError = (name, detail) => new CurrentConfigError(
  `Invalid config.json for "${name}": ${detail}. This is not a current PCA configuration; recreate it with: pca create ${name}`,
);

// Config files are written atomically by `pca create` and then updated only by
// PCA commands. Treat that format as one current contract rather than trying
// to infer missing fields or alternate shapes.
function validateCurrentConfig(name, cfg) {
  if (!isRecord(cfg)) throw configError(name, "expected an object");
  if (cfg.name !== name) throw configError(name, "name does not match its bot directory");
  if (!nonEmptyConfigString(cfg.endpoint)) throw configError(name, "endpoint is required");
  if (!nonEmptyConfigString(cfg.backendUrl)) throw configError(name, "backendUrl is required");
  if (typeof cfg.brain !== "string" || !BRAINS.includes(cfg.brain)) {
    throw configError(name, `brain must be one of: ${BRAINS.join(", ")}`);
  }
  if (typeof cfg.transport !== "string" || !TRANSPORTS.includes(cfg.transport)) {
    throw configError(name, `transport must be one of: ${TRANSPORTS.join(", ")}`);
  }
  if (!Array.isArray(cfg.allow) || cfg.allow.some((account) => !/^[0-9a-f]{64}$/.test(account))) {
    throw configError(name, "allow must be an array of lowercase 32-byte account IDs");
  }
  if (!isRecord(cfg.allowLabels)) throw configError(name, "allowLabels is required");
  if (!Number.isInteger(cfg.bridgePort) || cfg.bridgePort < 1 || cfg.bridgePort > 65535) {
    throw configError(name, "bridgePort must be an integer from 1 to 65535");
  }
  if (!nonEmptyConfigString(cfg.bridgeToken) || cfg.bridgeToken.length < 32) {
    throw configError(name, "bridgeToken must be a 32+ character secret");
  }
  if (typeof cfg.account !== "string" || !/^0x[0-9a-f]{64}$/i.test(cfg.account)) {
    throw configError(name, "account must be a 32-byte hexadecimal account ID");
  }
  if (!nonEmptyConfigString(cfg.address)) throw configError(name, "address is required");
  if (typeof cfg.identifierKey !== "string" || !/^0x[0-9a-f]+$/i.test(cfg.identifierKey) || cfg.identifierKey.length % 2 !== 0) {
    throw configError(name, "identifierKey must be hexadecimal");
  }
  if (cfg.username !== null && !nonEmptyConfigString(cfg.username)) {
    throw configError(name, "username must be null or a non-empty string");
  }
  if (typeof cfg.registered !== "boolean") throw configError(name, "registered must be true or false");
  if (!nonEmptyConfigString(cfg.createdAt)) throw configError(name, "createdAt is required");
  return cfg;
}

function loadCurrentConfig(name) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath(name), "utf8"));
  } catch (error) {
    throw configError(name, `could not read JSON (${String(error?.message ?? error)})`);
  }
  return validateCurrentConfig(name, raw);
}

const readConfig = (name) => {
  if (!name) fail("Which bot? Usage: pca <command> <botname>   (list yours with: pca list)");
  if (!BOT_NAME_RE.test(name)) fail(`Invalid bot name "${String(name)}".`);
  if (!fs.existsSync(configPath(name))) fail(`No bot named "${name}". Create it: pca create ${name}`);
  try {
    return loadCurrentConfig(name);
  } catch (error) {
    if (error instanceof CurrentConfigError) fail(error.message);
    throw error;
  }
};
const listBots = () => (fs.existsSync(BOTS_DIR) ? fs.readdirSync(BOTS_DIR).filter((n) => fs.existsSync(configPath(n))) : []);

function allowanceProvisioningPendingError(name) {
  const error = new Error(`A prior Paseo file allowance submission for "${name}" is unresolved. Check status and explicitly recover it before another grant.`);
  error.code = "PASEO_FILE_ALLOWANCE_PROVISIONING_PENDING";
  return error;
}

function readAllowanceProvisioningLock(address) {
  try {
    return JSON.parse(fs.readFileSync(allowanceProvisioningLockPath(address), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    // A malformed local marker is fail-closed. It can only be cleared through
    // the explicit recovery command after the operator checks on-chain state.
    return { state: "unresolved" };
  }
}

function clearAllowanceProvisioningLock(address) {
  try { fs.unlinkSync(allowanceProvisioningLockPath(address)); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

// Coordinate separate local `pca` processes by the allowance account, not the
// bot name. The marker is deliberately never time-expired: it changes to
// unresolved immediately before signAndSubmit, so clearing it requires an
// explicit, read-only recovery after an ambiguous result or interrupted CLI.
function acquireAllowanceProvisioningLock(name, address) {
  const lockPath = allowanceProvisioningLockPath(address);
  const token = randomBytes(18).toString("hex");
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify({
      token,
      state: "checking",
      address,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") throw allowanceProvisioningPendingError(name);
    throw error;
  }
  return {
    markUnresolved: (operation) => {
      const existing = readAllowanceProvisioningLock(address);
      if (existing?.token !== token) {
        throw new Error("Paseo allowance provisioning marker changed before submission");
      }
      fs.writeFileSync(lockPath, `${JSON.stringify({
        ...existing,
        state: "unresolved",
        operation,
        submissionStartedAt: new Date().toISOString(),
      })}\n`, { encoding: "utf8", mode: 0o600 });
    },
    release: () => {
      const existing = readAllowanceProvisioningLock(address);
      if (existing?.token === token) clearAllowanceProvisioningLock(address);
    },
  };
}

const newBridgeToken = () => randomBytes(32).toString("base64url");
function configuredBridgeToken(cfg) {
  const token = typeof cfg.bridgeToken === "string" ? cfg.bridgeToken.trim() : "";
  if (token.length >= 32) return token;
  fail(`Invalid bridgeToken in config.json for "${cfg.name ?? "this bot"}". Recreate the bot instead of mutating an incomplete configuration.`);
}

// The media worker gets a distinct capability, rather than reusing the bridge
// token. That makes its narrow attachment-analysis boundary independently
// revocable and keeps a leaked bridge credential from becoming an API caller.
function ensureMediaAnalyzerToken(name, cfg) {
  const token = typeof cfg.mediaAnalyzerToken === "string" ? cfg.mediaAnalyzerToken.trim() : "";
  if (token.length >= 32 && token !== cfg.bridgeToken) return token;
  cfg.mediaAnalyzerToken = newBridgeToken();
  saveConfig(name, cfg);
  return cfg.mediaAnalyzerToken;
}

function bridgePortFor(cfg) {
  const raw = cfg.bridgePort;
  if (typeof raw === "boolean" || String(raw).trim() === "") {
    fail(`Invalid bridgePort in config.json: ${String(cfg.bridgePort)}`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`Invalid bridgePort in config.json: ${String(cfg.bridgePort)}`);
  }
  return port;
}

function portFlag(value) {
  if (typeof value === "boolean" || String(value).trim() === "") {
    fail("--port requires an integer from 1 to 65535.");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`--port must be an integer from 1 to 65535 (got ${String(value)})`);
  }
  return port;
}

function flagValue(value, name) {
  if (value == null || typeof value === "boolean" || String(value).trim() === "") {
    fail(`--${name} requires a value.`);
  }
  return String(value);
}

// Model identifiers are passed through to the selected agent CLI, so keep the
// accepted syntax deliberately narrow and reject ambiguous comma-separated
// values outside of `pca model <bot> allow`.
const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const MAX_ALLOWED_MODELS = 32;
function modelName(value, label = "model") {
  if (value == null || typeof value === "boolean") fail(`${label} requires a value.`);
  const name = String(value).trim();
  if (!MODEL_NAME_RE.test(name)) {
    fail(`Invalid ${label} "${String(value)}". Model names may use letters, digits, ., _, :, /, @, +, and -.`);
  }
  return name;
}

function modelList(value, label = "allowed models") {
  if (value == null || typeof value === "boolean" || String(value).trim() === "") {
    fail(`${label} requires one or more comma-separated model names.`);
  }
  const models = String(value).split(",").map((entry) => modelName(entry, "model"));
  if (models.length > MAX_ALLOWED_MODELS) fail(`At most ${MAX_ALLOWED_MODELS} models may be allowed.`);
  if (new Set(models).size !== models.length) fail("Allowed models must not contain duplicates.");
  return models;
}

// `allowedModels` is absent for the default locked policy, [] for an explicit
// lock, and a non-empty array for a restricted set. `modelSwitching: "open"`
// is intentionally separate: only that explicit marker opens switching.
function configuredModelPolicy(cfg) {
  let allowedModels = null;
  if (cfg.allowedModels != null) {
    if (!Array.isArray(cfg.allowedModels)) fail(`Invalid allowedModels in config.json for "${cfg.name ?? "this bot"}".`);
    if (cfg.allowedModels.length > MAX_ALLOWED_MODELS) fail(`Invalid allowedModels in config.json: at most ${MAX_ALLOWED_MODELS} entries are supported.`);
    allowedModels = cfg.allowedModels.map((entry) => modelName(entry, "configured model"));
    if (new Set(allowedModels).size !== allowedModels.length) fail("Invalid allowedModels in config.json: duplicate entries.");
  }
  const mode = cfg.modelSwitching ?? null;
  if (mode != null && mode !== "open") fail(`Invalid modelSwitching in config.json for "${cfg.name ?? "this bot"}".`);
  if (mode === "open" && allowedModels != null) {
    fail(`Invalid model policy in config.json for "${cfg.name ?? "this bot"}": open switching cannot also have an allowlist.`);
  }
  return { allowedModels, open: mode === "open" };
}

const isPublicBot = (cfg) => cfg.allow.length === 0;
const TAGGED_T3AMS_KEY_RE = /^(?:0x)?[0-9a-f]{2,4096}$/i;

function normalizeT3amsDisplayName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    fail("--t3ams-display-name must be 1–128 printable characters.");
  }
  return name;
}

function normalizeT3amsSigningKey(value, label = "T3ams signing key") {
  const raw = String(value ?? "").trim();
  if (!TAGGED_T3AMS_KEY_RE.test(raw)) {
    fail(`${label} must be an even-length tagged-CBOR hexadecimal public key.`);
  }
  const key = raw.replace(/^0x/i, "").toLowerCase();
  if (key.length % 2 !== 0) fail(`${label} must be an even-length tagged-CBOR hexadecimal public key.`);
  return key;
}

async function requestedT3amsTrustedSigningKeys(value, backendUrl) {
  if (value == null) return {};
  if (typeof value === "boolean" || String(value).trim() === "") {
    fail("--t3ams-peer-key requires owner=tagged-cbor-public-key (comma-separate multiple pins).");
  }
  const keys = {};
  for (const entry of String(value).split(",").map((item) => item.trim()).filter(Boolean)) {
    const at = entry.indexOf("=");
    if (at <= 0 || at === entry.length - 1 || entry.indexOf("=", at + 1) !== -1) {
      fail(`Invalid --t3ams-peer-key entry "${entry}". Use owner=tagged-cbor-public-key.`);
    }
    const account = await resolvePeer(entry.slice(0, at), backendUrl);
    if (keys[account] != null) fail(`Duplicate T3ams signing-key pin for ${entry.slice(0, at)}.`);
    keys[account] = normalizeT3amsSigningKey(entry.slice(at + 1), `T3ams signing key for ${entry.slice(0, at)}`);
  }
  return keys;
}

function configuredTransport(cfg) {
  const transport = cfg.transport;
  if (typeof transport !== "string" || !TRANSPORTS.includes(transport)) {
    fail(`Invalid transport in config.json for "${cfg.name ?? "this bot"}": ${String(transport)}. Expected one of: ${TRANSPORTS.join(", ")}.`);
  }
  return transport;
}

function configuredT3amsTrustedSigningKeys(cfg, transport = configuredTransport(cfg)) {
  if (transport !== "t3ams") return {};
  const raw = cfg.t3amsTrustedSigningKeys ?? {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`Invalid t3amsTrustedSigningKeys in config.json for "${cfg.name ?? "this bot"}".`);
  }
  const keys = {};
  for (const [account, signingKey] of Object.entries(raw)) {
    const normalizedAccount = toAccountHex(account);
    if (keys[normalizedAccount] != null) fail(`Duplicate T3ams signing-key pin for ${normalizedAccount} in config.json.`);
    keys[normalizedAccount] = normalizeT3amsSigningKey(signingKey, `T3ams signing key for ${normalizedAccount}`);
  }
  const allow = cfg.allow.map((account) => toAccountHex(account));
  const missing = allow.filter((account) => keys[account] == null);
  if (missing.length > 0) {
    fail(`Private T3ams bot "${cfg.name ?? "this bot"}" needs an immutable tagged-CBOR signing-key pin for every allowlisted account. Recreate it with --t3ams-peer-key <owner>=<tagged-key>, or add t3amsTrustedSigningKeys to its private config.json.`);
  }
  return keys;
}

function t3amsEnvironment(cfg, transport = configuredTransport(cfg)) {
  if (transport !== "t3ams") return {};
  const values = { BOT_T3AMS_TRUSTED_SIGNING_KEYS: JSON.stringify(configuredT3amsTrustedSigningKeys(cfg, transport)) };
  if (cfg.t3amsDisplayName != null) values.BOT_T3AMS_DISPLAY_NAME = normalizeT3amsDisplayName(cfg.t3amsDisplayName);
  if (cfg.t3amsAutoAcceptWorkspaces != null) {
    if (typeof cfg.t3amsAutoAcceptWorkspaces !== "boolean") {
      fail(`Invalid t3amsAutoAcceptWorkspaces in config.json for "${cfg.name ?? "this bot"}".`);
    }
    values.BOT_T3AMS_AUTO_ACCEPT_WORKSPACES = cfg.t3amsAutoAcceptWorkspaces ? "1" : "0";
  }
  return values;
}

const t3amsSdkInstallHint = () => "Install the matching local T3ams BCTS tarball in bot-core, for example: npm install /path/to/t3ams-bcts-*.tgz";

async function inspectT3amsSdkForDeploy(transport) {
  if (transport !== "t3ams") return { ok: true };
  try {
    // Importing is the real deployment requirement. A package.json check can
    // pass while a packed SDK or one of its transitive dependencies fails to
    // load in the bot process.
    await import("@t3ams/bcts");
  } catch (error) {
    return {
      ok: false,
      message: `Could not import the local @t3ams/bcts package required for T3ams deployment: ${String(error?.message ?? error)}. ${t3amsSdkInstallHint()}`,
    };
  }
  return { ok: true };
}

async function requireT3amsSdkForDeploy(transport) {
  const preflight = await inspectT3amsSdkForDeploy(transport);
  if (!preflight.ok) fail(preflight.message);
}

async function warnForT3amsSdkDeployPreflight(transport) {
  const preflight = await inspectT3amsSdkForDeploy(transport);
  if (!preflight.ok) {
    warn(`${preflight.message} This is only a dry run, so no deployment was blocked; a real T3ams deploy will fail until it is fixed.`);
  }
}

function configuredFileDelivery(cfg) {
  if (cfg.fileDelivery == null) return null;
  if (typeof cfg.fileDelivery !== "object" || Array.isArray(cfg.fileDelivery)
      || cfg.fileDelivery.profile !== PASEO_TESTNET_FILE_DELIVERY.profile
      || cfg.networkProfile !== "paseo") {
    fail(`Invalid fileDelivery configuration for "${cfg.name ?? "this bot"}".`);
  }
  if (isPublicBot(cfg)) {
    fail(`"${cfg.name ?? "This bot"}" is public, so testnet file delivery is disabled to protect its finite storage allowance.`);
  }
  return PASEO_TESTNET_FILE_DELIVERY;
}

function fileDeliveryEnvironment(cfg) {
  const profile = configuredFileDelivery(cfg);
  if (!profile) return {};
  return {
    BOT_HOP_UPLOAD_NODE: profile.uploadNode,
    BOT_HOP_ALLOWED_NODES: profile.allowedNodes.join(","),
  };
}

function seedFromHex(seedHex) {
  const hex = String(seedHex ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("bot seed must be exactly 32 bytes of hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function fileAllowanceAccount(seed) {
  const pair = deriveSr25519PairFromSeed(seed, "//allowance//bulletin//chat");
  return { hex: bytesToHex(pair.publicKey), address: ss58Address(pair.publicKey, 42) };
}

function fileAllowanceAccountForBot(name) {
  if (!fs.existsSync(secretPath(name))) fail(`No secret found for "${name}".`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  return fileAllowanceAccount(seedFromHex(secret.seedHex));
}

function formatAllowanceBytes(value) {
  if (typeof value !== "bigint") return "quota unavailable";
  const mib = 1024n * 1024n;
  if (value >= mib) {
    const whole = value / mib;
    const tenths = (value % mib) * 10n / mib;
    return `${whole}.${tenths} MiB`;
  }
  if (value >= 1024n) return `${value / 1024n} KiB`;
  return `${value} B`;
}

function fileAllowanceStatusText(status) {
  if (status?.action === "finalization-unknown") {
    return "faucet finalization is unknown; check status and recover before another grant";
  }
  if (status?.action === "provisioning-pending") {
    return "a prior local allowance submission needs recovery before another grant";
  }
  if (status?.statusVerified === false) {
    return "faucet transaction finalized; storage status verification is pending";
  }
  if (!status.present) return "not authorized";
  if (!status.active) {
    return status.expiresAt == null ? "authorization status is incomplete" : `expired at block ${status.expiresAt}`;
  }
  const expiry = status.expiresAt == null ? "active"
    : `active through block ${status.expiresAt}${status.remainingBlocks == null ? "" : ` (${status.remainingBlocks} blocks remaining)`}`;
  if (status.remainingTransactions == null || status.remainingBytes == null) return expiry;
  return `${expiry}; ${status.remainingTransactions} transactions and ${formatAllowanceBytes(status.remainingBytes)} remain`;
}

function printFileAllowanceStatus(account, status) {
  console.log(`  allowance: ${account.address}`);
  console.log(`  storage:   ${fileAllowanceStatusText(status)}`);
}

async function provisionTestnetFileAllowance(name, cfg, { optional = true, account = null } = {}) {
  const profile = configuredFileDelivery(cfg);
  if (!profile) return null;
  const allowance = account ?? fileAllowanceAccountForBot(name);
  let provisioningLock = null;
  let retainLock = false;
  try {
    provisioningLock = acquireAllowanceProvisioningLock(name, allowance.address);
    step(`Provisioning ${profile.bulletinNetwork} file allowance…`);
    const result = await ensurePaseoFileAllowance({
      address: allowance.address,
      onSubmissionStarting: provisioningLock.markUnresolved,
    });
    if (result.statusVerified === false) {
      retainLock = true;
      ok("Paseo testnet file allowance transaction finalized.");
    } else if (!hasSufficientPaseoFileAllowance(result)) {
      warn("The Paseo faucet transaction finalized, but the resulting allowance is still too low or too close to expiry.");
    } else if (result.action === "already-authorized") {
      ok("Paseo testnet file allowance is already ready.");
    } else if (result.action === "refreshed") {
      ok("Paseo testnet file allowance expiry was refreshed.");
    } else {
      ok("Paseo testnet file allowance is ready.");
    }
    note(fileAllowanceStatusText(result));
    if (result.statusVerified === false) {
      warn("The faucet transaction finalized, but its follow-up status query could not be completed. Check it with pca storage " + name + " status.");
      note(`After verifying the result, clear the local guard:  pca storage ${name} recover`);
      if (!optional) process.exitCode = 1;
    }
    return { ...result, account: allowance };
  } catch (error) {
    const message = String(error?.message ?? error);
    if (error instanceof PaseoAllowanceFinalizationUnknownError) {
      // The marker was written before signAndSubmit. Keep it until an operator
      // checks current state and explicitly recovers the local guard.
      try { provisioningLock?.markUnresolved("unknown"); } catch { /* marker is already retained */ }
      retainLock = true;
      warn("The public Paseo faucet may have accepted this allowance grant. Do not retry it yet.");
      note(`Wait for finalization, then check:  pca storage ${name} status`);
      note(`After verifying the result, clear the local guard:  pca storage ${name} recover`);
      if (!optional) process.exitCode = 1;
      return {
        action: "finalization-unknown",
        present: null,
        active: null,
        expiresAt: null,
        currentBlock: null,
        remainingBlocks: null,
        remainingTransactions: null,
        remainingBytes: null,
        statusVerified: false,
        account: allowance,
        error: message,
      };
    }
    if (error?.code === "PASEO_FILE_ALLOWANCE_PROVISIONING_PENDING") {
      warn(message);
      note(`Check the current state:  pca storage ${name} status`);
      note(`After verifying it, recover the local guard:  pca storage ${name} recover`);
      if (!optional) process.exitCode = 1;
      return {
        action: "provisioning-pending",
        present: null,
        active: null,
        expiresAt: null,
        currentBlock: null,
        remainingBlocks: null,
        remainingTransactions: null,
        remainingBytes: null,
        account: allowance,
        error: message,
      };
    }
    if (!optional) throw new Error(`Paseo testnet file allowance could not be provisioned: ${message}`);
    warn(`Couldn't provision the Paseo testnet file allowance: ${message}`);
    note(`Check it locally:  pca storage ${name} status`);
    note(`Grant it only if needed:  pca storage ${name} grant`);
    note(`If the public testnet faucet is unavailable, use ${profile.consoleUrl}.`);
    return { action: "unavailable", account: allowance, error: message };
  } finally {
    if (provisioningLock && !retainLock) provisioningLock.release();
  }
}

function printTestnetFileAllowanceGuide(cfg, seed, provisioned = null) {
  const profile = configuredFileDelivery(cfg);
  if (!profile) return;
  const account = fileAllowanceAccount(seed);
  console.log("Testnet file delivery:");
  note(`${profile.bulletinNetwork} is configured for this private bot.`);
  console.log(`  ${c(account.address, "36")}`);
  note(`account id: ${account.hex}`);
  if (provisioned?.action === "finalization-unknown") {
    note(`The faucet submission is awaiting confirmation. Check it:  pca storage ${cfg.name} status`);
    note(`Then clear the local guard before another grant:  pca storage ${cfg.name} recover`);
  } else if (provisioned?.action === "provisioning-pending") {
    note(`A previous local submission needs recovery. Check it:  pca storage ${cfg.name} status`);
    note(`Then clear the local guard:  pca storage ${cfg.name} recover`);
  } else if (provisioned?.statusVerified === false) {
    note(`The faucet transaction needs a verified status check:  pca storage ${cfg.name} status`);
    note(`Then clear the local guard before another grant:  pca storage ${cfg.name} recover`);
  } else if (["authorized", "refreshed", "refreshed-and-authorized"].includes(provisioned?.action)) {
    note("The local PCA CLI provisioned this derived account through the public Paseo testnet faucet.");
  } else if (provisioned?.action === "already-authorized") {
    note("This derived account already has usable Paseo testnet storage allowance.");
  } else {
    note(`Check it:  pca storage ${cfg.name} status`);
    note(`Grant it only if needed:  pca storage ${cfg.name} grant`);
  }
  note("Only this derived account is authorized. This is a local CLI action, not a bot-runtime action; production uses a separate operator flow.");
}

function modelPolicyEnvironment(cfg) {
  const policy = configuredModelPolicy(cfg);
  if (policy.open) {
    if (isPublicBot(cfg)) {
      fail(`"${cfg.name ?? "This bot"}" is public, so unrestricted model switching is not allowed. Use an approved model list or lock switching.`);
    }
    return { BOT_AI_MODEL_SWITCHING: "open" };
  }
  // Always emit a policy for direct model engines. This makes an old config
  // with no model fields safely locked instead of inheriting a runtime default.
  return { BOT_AI_ALLOWED_MODELS: (policy.allowedModels ?? []).join(",") };
}

function applyModelPolicyEnvironment(env, cfg) {
  // Local runs begin with the caller's environment. Never let a shell-level
  // setting silently change the policy saved for this bot.
  delete env.BOT_AI_ALLOWED_MODELS;
  delete env.BOT_AI_MODEL_SWITCHING;
  Object.assign(env, modelPolicyEnvironment(cfg));
}

function envLine(key, value) {
  const text = String(value ?? "");
  if (/[\0\r\n]/.test(text)) fail(`${key} cannot contain a newline or NUL byte.`);
  return `${key}=${text}`;
}

function remoteDir(value) {
  const dir = flagValue(value, "remote-dir").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(dir)
      || dir.startsWith("/")
      || dir.split("/").some((part) => part === "..")) {
    fail(`--remote-dir must be a relative path made of letters, digits, ., _, -, and / (got ${String(value)})`);
  }
  return dir;
}

function containerName(value) {
  const name = String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    fail(`Invalid Docker container name in config: ${String(value)}`);
  }
  return name;
}

function sshTarget(value) {
  const target = flagValue(value, "host").trim();
  if (!/^[A-Za-z0-9_.:@\[\]-]+$/.test(target) || target.startsWith("-")) {
    fail(`Invalid SSH target: ${String(value)}`);
  }
  return target;
}

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const redactEnv = (content) => content.replace(/^([A-Z0-9_]*(?:SEED_HEX|TOKEN|API_KEY))=.*/gm, "$1=<hidden>");

const deeplink = (accountIdHex) => {
  if (!accountIdHex) return null;
  const id = String(accountIdHex).replace(/^0x/, "");
  return `polkadotapp://chat?id=0:0x${id}&force=false&chatId=${id}`;
};
// Print the "message it" block, skipping the deeplink when the account isn't in
// the local config (username search still works).
const printReachLine = (accountIdHex, username) => {
  const link = deeplink(accountIdHex);
  if (link) console.log(`  ${c(link, "36")}`);
  if (username) note(`${link ? "or search" : "search"}: ${username}`);
};

function printT3amsReachLine({ name, username, registered }) {
  const dotnsUsername = typeof username === "string" ? username.trim() : "";
  const registerCommand = `pca register ${name ?? "<botname>"}`;
  if (dotnsUsername && registered) {
    note(`Search or invite ${dotnsUsername} in T3ams.`);
    return;
  }
  if (dotnsUsername) {
    warn(`This T3ams bot's DotNS username (${dotnsUsername}) is not confirmed yet.`);
  } else {
    warn("This T3ams bot has no registered DotNS username yet.");
  }
  note(`Register it before people can search or invite it in T3ams:  ${registerCommand}`);
}

async function cmdCreate(name, flags) {
  if (!name) fail("Usage: pca create <botname>   (the first argument is your bot's name, e.g. pca create mycoolbot)");
  // A `.NN` suffix requests that username number (e.g. `create mycoolbot.69` =
  // `--digits 69`) and keeps the local name distinct, so several bots can share
  // one base name with different numbers.
  const dotted = /^([a-z][a-z0-9-]{1,30})\.(\d{2})$/.exec(name);
  if (dotted && !flags.digits) flags.digits = dotted[2];
  if (!dotted && !/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
    fail(`Name must be lowercase letters/digits/hyphens starting with a letter — optionally ending in ".NN" (two digits) to request that username number, e.g. mycoolbot or mycoolbot.69.`);
  }
  if (fs.existsSync(botDir(name))) fail(`Bot "${name}" already exists (${botDir(name)}). Use a different name.`);
  const brain = String(flags.brain ?? "echo").toLowerCase();
  if (!BRAINS.includes(brain)) fail(`--brain must be one of: ${BRAINS.join(", ")}`);
  const transport = String(flags.transport ?? DEFAULT_TRANSPORT).toLowerCase();
  if (!TRANSPORTS.includes(transport)) fail(`--transport must be one of: ${TRANSPORTS.join(", ")}`);
  warnMissingBrainCli(brain);
  const networkProfile = flags.network == null || flags.network === "paseo" ? "paseo" : null;
  const endpoint = networkProfile === "paseo" ? DEFAULT_ENDPOINT : String(flags.endpoint ?? flags.network);
  const backendUrl = flags.backend ? String(flags.backend) : DEFAULT_BACKENDS.paseo;
  const allowInputs = [
    ...String(flags.allow ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(flags.owner ? [String(flags.owner)] : []),
  ];
  const allow = [];
  const allowLabels = {}; // hex -> what the human typed (username/address), for display
  for (const input of allowInputs) {
    const hex = await resolvePeer(input, backendUrl);
    allow.push(hex);
    allowLabels[hex] = String(input).trim().replace(/^@/, "");
  }
  if (transport !== "t3ams" && flags["t3ams-peer-key"] != null) {
    fail("--t3ams-peer-key is only valid with --transport t3ams.");
  }
  if (transport !== "t3ams" && (flags["t3ams-display-name"] != null
      || flags["t3ams-auto-accept-workspaces"] != null || flags["t3ams-no-auto-accept-workspaces"] != null)) {
    fail("T3ams display-name and workspace-enrollment flags require --transport t3ams.");
  }
  if (flags["t3ams-auto-accept-workspaces"] === true && flags["t3ams-no-auto-accept-workspaces"] === true) {
    fail("Use only one of --t3ams-auto-accept-workspaces or --t3ams-no-auto-accept-workspaces.");
  }
  const t3amsDisplayName = flags["t3ams-display-name"] == null
    ? null
    : normalizeT3amsDisplayName(flagValue(flags["t3ams-display-name"], "t3ams-display-name"));
  const t3amsAutoAcceptWorkspaces = flags["t3ams-auto-accept-workspaces"] === true
    ? true
    : flags["t3ams-no-auto-accept-workspaces"] === true
      ? false
      : null;
  const t3amsTrustedSigningKeys = transport === "t3ams"
    ? await requestedT3amsTrustedSigningKeys(flags["t3ams-peer-key"], backendUrl)
    : {};
  const missingT3amsPins = allow.filter((account) => t3amsTrustedSigningKeys[account] == null);
  if (transport === "t3ams" && missingT3amsPins.length > 0) {
    fail("A private T3ams bot requires a tagged-CBOR signing-key pin for every --owner/--allow account. Add --t3ams-peer-key <owner>=<tagged-key>; account-derived XIDs alone are not an authenticated first-contact binding.");
  }
  const isPublic = flags.public === true;
  // Safety: a paid brain left open to everyone can burn the deployer's quota.
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
    name, endpoint, backendUrl, brain, transport, allow, allowLabels,
    ...(Object.keys(t3amsTrustedSigningKeys).length > 0 ? { t3amsTrustedSigningKeys } : {}),
    ...(t3amsDisplayName != null ? { t3amsDisplayName } : {}),
    ...(t3amsAutoAcceptWorkspaces != null ? { t3amsAutoAcceptWorkspaces } : {}),
    ...(networkProfile ? { networkProfile } : {}),
    // Testnet uploads can spend a finite Bulletin allowance. Configure the
    // known HOP profile only for an allowlisted bot, never a public one.
    ...(networkProfile === "paseo" && allow.length > 0 ? { fileDelivery: { profile: PASEO_TESTNET_FILE_DELIVERY.profile } } : {}),
    ...(flags.model != null ? { model: flagValue(flags.model, "model") } : {}), // pin per-brain model
    bridgePort: portFlag(flags.port ?? 8799),
    bridgeToken: newBridgeToken(),
    account: accountIdHex, address, identifierKey: bytesToHex(p256),
    username: null, registered: false, createdAt: new Date().toISOString(),
  };
  saveConfig(name, config);

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

  // This testnet-only grant is deliberately performed by the local CLI, not
  // by the deployed bot. A temporary faucet outage must not strand a newly
  // registered chat identity, so the helper leaves an explicit retry command.
  const provisionedAllowance = config.fileDelivery && register
    ? await provisionTestnetFileAllowance(name, config, { account: fileAllowanceAccount(seed) })
    : null;

  console.log();
  console.log(allow.length ? `Locked to ${allow.length} allowlisted address${allow.length > 1 ? "es" : ""}${transport === "t3ams" ? " with pinned T3ams signing keys" : ""} — only they can message it.`
                   : "Open — anyone can message it.");
  if (transport === "t3ams") {
    console.log("Message your bot in T3ams:");
    printT3amsReachLine(config);
  } else {
    console.log("Message your bot in the Polkadot app:");
    console.log(`  ${c(deeplink(accountIdHex), "36")}`);
    if (config.username) note(`or search: ${config.username}`);
  }
  console.log();
  note(`Start it:  pca run ${name}`);
  if (config.fileDelivery) {
    console.log();
    printTestnetFileAllowanceGuide(config, seed, provisionedAllowance);
  } else if (networkProfile === "paseo" && allow.length === 0) {
    note("Testnet outbound file delivery is disabled for this public bot to protect a finite storage allowance.");
  }
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
  const save = () => saveConfig(name, config);
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
  if (cfg.registered) {
    ok(`"${name}" is already registered as ${cfg.username}.`);
    await provisionTestnetFileAllowance(name, cfg);
    return;
  }
  if (!fs.existsSync(secretPath(name))) fail(`No secret found for "${name}".`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  const wantUsername = String(flags.username ?? cfg.username ?? name);
  const wantDigits = flags.digits ? String(flags.digits) : (/\.(\d{2})$/.exec(wantUsername)?.[1] ?? null);
  const reg = await runRegistration(name, cfg, { mnemonic: secret.mnemonic, wantUsername, digits: wantDigits, wait: flags.wait });
  if (reg === "failed") process.exitCode = 1;
  else await provisionTestnetFileAllowance(name, cfg);
}

function cmdDelete(name, flags) {
  const cfg = readConfig(name);
  if (cfg.deploy?.host) {
    fail(`"${name}" is deployed on ${cfg.deploy.host} — stop it first:  pca stop ${name}\nThen delete again.`);
  }
  if (flags.yes !== true) {
    warn(`Deleting "${name}" destroys its secret key — the identity${cfg.username ? ` and the username ${cfg.username}` : ""} can never be recovered or re-registered by anyone.`);
    note(`Folder: ${botDir(name)}`);
    fail(`If you're sure:  pca delete ${name} --yes`);
  }
  fs.rmSync(botDir(name), { recursive: true, force: true });
  ok(`Deleted "${name}"${cfg.username ? ` (${cfg.username} is gone for good)` : ""}.`);
}

// Project registry for direct-engine bots: named directories the agent can
// work in (in chat: /project <alias>, or /project <alias>@<branch> for an
// isolated git worktree). Stored in the bot's config; pca run hands it to the
// bot as BOT_AI_PROJECTS. Paths are local to wherever the bot process runs, so
// deployed (Docker) bots can't see them — deploy warns instead.
function cmdProject(positional) {
  const [name, action, alias, dir] = positional;
  if (!name) fail("Usage: pca project <botname> [add <alias> <path> | rm <alias>]");
  const cfg = readConfig(name);
  const projects = cfg.projects ?? {};
  const aliasRe = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  if (action === "add") {
    if (!alias || !dir) fail(`Usage: pca project ${name} add <alias> <path>`);
    const key = alias.toLowerCase();
    if (!aliasRe.test(key)) fail(`"${alias}" isn't a usable alias — lowercase letters/digits/dashes, e.g. "my-app".`);
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) fail(`${abs} is not a directory.`);
    if (!fs.existsSync(path.join(abs, ".git"))) note(`Heads up: ${abs} isn't a git repo — /project ${key} works, but @branch worktrees won't.`);
    projects[key] = abs;
    saveConfig(name, { ...cfg, projects });
    ok(`Project "${key}" -> ${abs}`);
    note(`In chat: /project ${key}   (or /project ${key}@some-branch for an isolated worktree)`);
    if (cfg.deploy?.host) warn(`"${name}" is deployed on ${cfg.deploy.host} — projects only work where the bot process can see the path (pca run).`);
    return;
  }
  if (action === "rm" || action === "remove") {
    if (!alias || !projects[alias.toLowerCase()]) fail(`No project "${alias}" on "${name}".`);
    delete projects[alias.toLowerCase()];
    saveConfig(name, { ...cfg, projects });
    ok(`Removed project "${alias.toLowerCase()}".`);
    return;
  }
  if (action) fail(`Unknown action "${action}" — use: pca project ${name} [add <alias> <path> | rm <alias>]`);
  const entries = Object.entries(projects);
  if (!entries.length) { note(`No projects on "${name}" yet. Add one:  pca project ${name} add <alias> <path>`); return; }
  for (const [a, p] of entries) console.log(`  ${a}  ->  ${p}`);
}

function modelCommandUsage(name = "<botname>") {
  return `Usage: pca model ${name} [show | set <model> | allow <model-a,model-b> | lock | open]`;
}

// Operator-owned model configuration for direct CLI engines. Chat users only
// ever receive the policy this command persists; they cannot broaden it.
function cmdModel(positional) {
  const [name, rawAction = "show", value, ...extra] = positional;
  if (!name) fail(modelCommandUsage());
  const cfg = readConfig(name);
  if (!DIRECT_BRAIN_CLIS.has(cfg.brain)) {
    fail(`Model controls apply only to direct claude, codex, or opencode bots. "${name}" uses the ${cfg.brain} brain.`);
  }
  const action = String(rawAction).toLowerCase();
  const policy = configuredModelPolicy(cfg);
  const save = (message) => {
    saveConfig(name, cfg);
    ok(message);
    if (cfg.deploy?.host) note(`Redeploy to apply it:  pca deploy ${name} --host ${cfg.deploy.host}`);
    else note(`Takes effect the next time it runs:  pca run ${name}`);
  };

  if (action === "show") {
    if (value || extra.length) fail(modelCommandUsage(name));
    console.log(`${c(name, "1")} model settings`);
    console.log(`  default:   ${cfg.model ?? "(CLI default)"}`);
    if (policy.open) console.log("  switching: open to allowlisted peers");
    else if (policy.allowedModels?.length) console.log(`  switching: approved models only (${policy.allowedModels.join(", ")})`);
    else console.log(`  switching: locked${policy.allowedModels == null ? " (default)" : ""}`);
    return;
  }

  if (action === "set") {
    if (!value || extra.length) fail(modelCommandUsage(name));
    cfg.model = modelName(value);
    save(`Default model for "${name}" set to ${cfg.model}.`);
    return;
  }

  if (action === "allow") {
    if (!value || extra.length) fail(modelCommandUsage(name));
    cfg.allowedModels = modelList(value);
    delete cfg.modelSwitching;
    save(`Model switching for "${name}" is limited to: ${cfg.allowedModels.join(", ")}.`);
    return;
  }

  if (action === "lock") {
    if (value || extra.length) fail(modelCommandUsage(name));
    cfg.allowedModels = [];
    delete cfg.modelSwitching;
    save(`Model switching for "${name}" is locked.`);
    return;
  }

  if (action === "open") {
    if (value || extra.length) fail(modelCommandUsage(name));
    if (isPublicBot(cfg)) {
      fail(`Cannot open model switching for public bot "${name}". Add an allowlist first, or use: pca model ${name} allow <model-a,model-b>`);
    }
    delete cfg.allowedModels;
    cfg.modelSwitching = "open";
    save(`Model switching for "${name}" is open to its allowlisted peers.`);
    return;
  }

  fail(`Unknown model action "${rawAction}". ${modelCommandUsage(name)}`);
}

// Short human form of an allowlist account hex for display.
function shortAllowEntry(hex) {
  try {
    const bytes = Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
    const addr = ss58Address(bytes, 42);
    return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
  } catch { return `${hex.slice(0, 8)}…`; }
}

function cmdList() {
  const bots = listBots();
  if (bots.length === 0) { note("No bots yet. Create one: pca create <name>"); return; }
  const rows = [];
  const broken = [];
  for (const name of bots) {
    // One damaged config must not make every bot unlistable.
    let cfg;
    try { cfg = loadCurrentConfig(name); }
    catch { broken.push(name); continue; }
    const username = cfg.username
      ? (cfg.registered ? { text: cfg.username } : { text: `${cfg.username} (pending)`, color: "33" })
      : { text: "not registered", color: "33" };
    const brain = cfg.model ? `${cfg.brain} · ${cfg.model}` : cfg.brain;
    const labels = cfg.allow.map((hex) => cfg.allowLabels[hex] ?? shortAllowEntry(hex));
    const access = labels.length === 0
      ? { text: "public", color: "33" }
      : { text: labels.length <= 2 ? labels.join(", ") : `${labels[0]} +${labels.length - 1} more` };
    const where = cfg.deploy?.host ? { text: `deployed → ${cfg.deploy.host}`, color: "36" } : { text: "local" };
    rows.push([{ text: name, color: "1" }, username, { text: brain }, access, where]);
  }
  const headers = ["NAME", "USERNAME", "BRAIN", "WHO CAN MESSAGE IT", "WHERE"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].text.length)));
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
  console.log(headers.map((h, i) => c(pad(h, widths[i]), "90")).join("  "));
  for (const row of rows) {
    console.log(row.map((cell, i) => {
      const padded = pad(cell.text, widths[i]);
      return cell.color ? c(padded, cell.color) : padded;
    }).join("  "));
  }
  for (const name of broken) warn(`"${name}" has a damaged config.json — skipped (${configPath(name)})`);
  console.log();
  note(`Details + message link: pca info <name>`);
  note(`Stored in ${BOTS_DIR} — back that folder up; it holds each bot's keys.`);
}

async function cmdInfo(name) {
  const cfg = readConfig(name);
  const transport = configuredTransport(cfg);
  // Live re-check: has the network confirmed (attested) the bot yet?
  let messageable = cfg.registered;
  let reachedNetwork = true;
  if (cfg.username && !cfg.registered) {
    try {
      messageable = await withPeopleApi(cfg.endpoint, async (api) =>
        withTimeout(api.query.Resources.Consumers.getValue(cfg.address), 12_000, "network check")
          .then((consumer) => consumer?.identifier_key != null));
      if (messageable) { cfg.registered = true; saveConfig(name, cfg); }
    } catch { reachedNetwork = false; }
  }
  // Distinguish never-registered from claimed-but-pending from confirmed.
  const status = messageable ? c("live — people can message it", "32")
    : !reachedNetwork ? c("can't reach the network right now (try again)", "31")
    : !cfg.username ? c(`not registered — run: pca register ${name}`, "33")
    : c(`username claimed, confirmation pending — check again or run: pca register ${name}`, "33");
  console.log(`${c(name, "1")}${cfg.username ? ` (${cfg.username})` : ""}`);
  console.log(`  brain:    ${cfg.brain}`);
  console.log(`  transport: ${transport}`);
  console.log(`  network:  ${cfg.endpoint}`);
  console.log(`  address:  ${cfg.address}`);
  const allowShown = cfg.allow.map((hex) => cfg.allowLabels[hex] ?? shortAllowEntry(hex));
  console.log(`  access:   ${allowShown.length ? `only ${allowShown.join(", ")} can message it` : c("open to anyone", "33")}`);
  console.log(`  status:   ${status}`);
  const delivery = configuredFileDelivery(cfg);
  if (delivery) {
    try {
      const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
      const allowance = fileAllowanceAccount(seedFromHex(secret.seedHex));
      console.log(`  files:    ${delivery.bulletinNetwork} HOP delivery enabled`);
      console.log(`  allowance: ${allowance.address}`);
      note(`Check it: pca storage ${name} status; grant only when needed: pca storage ${name} grant`);
    } catch (error) {
      warn(`Testnet file delivery is configured, but its allowance account could not be derived: ${String(error?.message ?? error)}`);
    }
  }
  if (cfg.deploy?.host) console.log(`  deployed: ${cfg.deploy.host} (container ${cfg.deploy.container}) — pca status ${name}`);
  console.log();
  if (transport === "t3ams") {
    console.log("  Reach this bot in T3ams:");
    printT3amsReachLine({ ...cfg, registered: messageable });
  } else {
    console.log("  Message this bot in the Polkadot app:");
    printReachLine(cfg.account, cfg.username);
  }
}

function storageCommandUsage(name = "<botname>") {
  return `Usage: pca storage ${name} [status | grant | recover] [--yes]`;
}

// The storage command is intentionally a local operator command. Bot-core's
// runtime never imports its fixed Paseo faucet helper.
async function cmdStorage(positional, flags = {}) {
  const [name, rawAction = "status", ...extra] = positional;
  if (!name) fail(storageCommandUsage());
  if (extra.length) fail(storageCommandUsage(name));
  const cfg = readConfig(name);
  if (!configuredFileDelivery(cfg)) {
    fail(`"${name}" has no managed private Paseo testnet file-delivery profile. Automatic allowance provisioning is unavailable.`);
  }
  const account = fileAllowanceAccountForBot(name);
  const action = String(rawAction).toLowerCase();
  if (action === "status") {
    step(`Checking ${PASEO_TESTNET_FILE_DELIVERY.bulletinNetwork} file allowance…`);
    const status = await getPaseoFileAllowanceStatus({ address: account.address });
    printFileAllowanceStatus(account, status);
    const recoveryPending = readAllowanceProvisioningLock(account.address) != null;
    if (recoveryPending) {
      warn("A previous local faucet submission remains guarded until it is explicitly recovered.");
      note(`After verifying this status:  pca storage ${name} recover`);
    }
    if (!hasSufficientPaseoFileAllowance(status)) {
      note(recoveryPending
        ? `Grant or top it up only after recovery, if needed:  pca storage ${name} grant`
        : `Grant or top it up locally:  pca storage ${name} grant`);
    }
    return;
  }
  if (action === "grant") {
    const result = await provisionTestnetFileAllowance(name, cfg, { optional: false, account });
    printFileAllowanceStatus(account, result);
    return;
  }
  if (action === "recover") {
    step(`Checking ${PASEO_TESTNET_FILE_DELIVERY.bulletinNetwork} file allowance before recovery…`);
    const status = await getPaseoFileAllowanceStatus({ address: account.address });
    printFileAllowanceStatus(account, status);
    if (!readAllowanceProvisioningLock(account.address)) {
      note("No unresolved local faucet submission is recorded.");
      return;
    }
    if (hasSufficientPaseoFileAllowance(status)) {
      clearAllowanceProvisioningLock(account.address);
      ok("Verified allowance is sufficient; cleared the local recovery guard.");
      return;
    }
    if (flags.yes !== true) {
      warn("The allowance is still not sufficient, so the original faucet submission cannot be resolved automatically.");
      note(`After verifying that no old transaction will finalize, clear the guard:  pca storage ${name} recover --yes`);
      process.exitCode = 1;
      return;
    }
    clearAllowanceProvisioningLock(account.address);
    warn("Cleared the local recovery guard without submitting a faucet transaction.");
    note(`After verifying the prior transaction is no longer pending, grant only if needed:  pca storage ${name} grant`);
    return;
  }
  fail(storageCommandUsage(name));
}

function requestedDirectToolPolicy(brain, flags, command) {
  const toolPolicyFlagUsed = flags["allowed-tools"] != null || flags["tool-scope"] != null;
  if (!DIRECT_BRAIN_CLIS.has(brain)) {
    if (toolPolicyFlagUsed) {
      fail(`--allowed-tools and --tool-scope require a built-in direct engine (claude, codex, or opencode); ${brain} has no direct-agent tools.`);
    }
    return DEFAULT_TOOL_POLICY;
  }
  try {
    return assertEngineToolPolicy(brain, createToolPolicy({
      capabilities: flags["allowed-tools"] == null
        ? []
        : parseToolCapabilities(flagValue(flags["allowed-tools"], "allowed-tools")),
      scope: flags["tool-scope"] == null ? "workspace" : flagValue(flags["tool-scope"], "tool-scope"),
    }));
  } catch (error) {
    fail(error instanceof ToolPolicyError ? error.message : `Invalid tool policy for ${command}: ${String(error?.message ?? error)}`);
  }
}

function cmdRun(name, flags = {}) {
  const cfg = readConfig(name);
  if (!fs.existsSync(secretPath(name))) fail(`"${name}" has no secret.json — its identity is missing. Recreate it: pca create ${name}`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  const bridgeToken = configuredBridgeToken(cfg);
  const bridgePort = bridgePortFor(cfg);
  const transport = configuredTransport(cfg);
  const runToolPolicy = requestedDirectToolPolicy(cfg.brain, flags, "run");
  const transportEnv = t3amsEnvironment(cfg, transport);
  // Keep agent work away from the bot state directory. Local runs still share
  // the invoking user's permissions, so run them only on trusted machines.
  const workspace = path.join(BOTS_DIR, `${name}-workspace`);
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  if (!cfg.registered) note("Warning: this bot isn't registered on the network yet, so people can't message it.");
  warnMissingBrainCli(cfg.brain);
  if (cfg.deploy?.host) warn(`Heads up: "${name}" is also deployed on ${cfg.deploy.host}. Running it here too = two processes on one identity (they will double-reply). Stop one first.`);
  step(`Starting "${name}" (${cfg.brain})…`);
  if (DIRECT_BRAIN_CLIS.has(cfg.brain)) {
    const summary = toolPolicySummary(runToolPolicy);
    note(`Tool policy: ${summary.capabilities}; scope=${summary.scope}.`);
    if (runToolPolicy.capabilities.includes("bash") || runToolPolicy.scope === "container") {
      warn("Local agent tools follow this machine's process boundary; use pca deploy for per-bot container isolation.");
    }
  }
  note(`Check health from another terminal:  pca status ${name}   (Ctrl-C here stops the bot)`);
  const env = {
    ...process.env,
    BOT_SEED_HEX: secret.seedHex,
    BOT_ENDPOINT: cfg.endpoint,
    BOT_BRIDGE_PORT: String(bridgePort),
    BOT_BRIDGE_TOKEN: bridgeToken,
    BOT_ALLOWED_PEERS: cfg.allow.join(","),
    BOT_BRAIN: cfg.brain,
    BOT_TRANSPORT: transport,
    ...transportEnv,
    BOT_USERNAME: cfg.username ?? "",
    BOT_STATE_DIR: botDir(name),   // persist sessions so a restart keeps open threads
    BOT_AI_WORKSPACE: workspace,
  };
  // Tool authority is always selected by this invocation. Never inherit a
  // broader policy from the operator's shell for a local bot run.
  delete env.BOT_AI_TOOL_CAPABILITIES;
  delete env.BOT_AI_TOOL_SCOPE;
  if (DIRECT_BRAIN_CLIS.has(cfg.brain)) Object.assign(env, toolPolicyEnvironment(runToolPolicy));
  // A local operator may deliberately override a test HOP endpoint in their
  // shell. Deploys always use the persisted profile, but don't erase that
  // local test override here.
  for (const [key, value] of Object.entries(fileDeliveryEnvironment(cfg))) {
    if (!env[key]) env[key] = value;
  }
  // Model: --model overrides the one saved by create (both land in BOT_AI_MODEL,
  // which each direct brain passes to its CLI's own model flag).
  const model = flags.model != null ? flagValue(flags.model, "model") : cfg.model;
  if (model) env.BOT_AI_MODEL = model;
  if (DIRECT_BRAIN_CLIS.has(cfg.brain)) applyModelPolicyEnvironment(env, cfg);
  if (cfg.projects && Object.keys(cfg.projects).length) {
    env.BOT_AI_PROJECTS = JSON.stringify(cfg.projects);
    note(`Projects: ${Object.keys(cfg.projects).join(", ")} (switch in chat with /project <name>)`);
  }
  if (flags.greet === true) {
    env.BOT_GREET = "1";
    note("Greet mode: the bot will message its owner(s) first — watch your phone.");
  }
  const child = spawn(process.execPath, [path.join(HERE, entrypointForTransport(transport))], { env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// Run a local command (ssh/rsync/scp), streaming progress; optionally capture stdout.
function runLocal(cmd, args, { capture = false } = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
}

// Direct engines deploy as a single self-contained container. The transport
// runs as root solely to hold the signing seed and state; its spawned agent is
// dropped to the image's `node` user and can only write its workspace/home.
// Keep each global CLI exact, rather than resolving the moving npm `latest`
// tag during every deploy.
const DEPLOY_ENGINES = {
  echo:     { pkg: null },
  claude:   { pkg: "@anthropic-ai/claude-code@2.1.207" },
  codex:    { pkg: "@openai/codex@0.144.1" },
  opencode: { pkg: "opencode-ai@1.17.18" },
};
const KEY_FLAGS = { ANTHROPIC_API_KEY: "anthropic-key", OPENAI_API_KEY: "openai-key", OPENROUTER_API_KEY: "openrouter-key", GEMINI_API_KEY: "gemini-key", GROQ_API_KEY: "groq-key" };

// A T3ams process can emit BOT_LISTENING before its websocket is connected or
// before it has rebuilt its retained inbox/workspace subscriptions. Keep the
// readiness check inside the container: it authenticates to the loopback-only
// bridge with the container's token, without exposing either the port or token
// on the VPS. The endpoint's `ok` means the chain is connected; a nonzero
// subscription count proves the bot is also listening for messages.
const t3amsBotHealthcheck = (transport) =>
  transport === "t3ams"
    ? `    healthcheck:\n      test: ["CMD", "node", "-e", "const port=process.env.BOT_BRIDGE_PORT||'8799';fetch('http://127.0.0.1:'+port+'/health',{headers:{authorization:'Bearer '+(process.env.BOT_BRIDGE_TOKEN||'')},signal:AbortSignal.timeout(4000)}).then(async(r)=>{let h;try{h=await r.json()}catch{process.exit(1);return}process.exit(r.ok&&h?.ok===true&&h.transport==='t3ams'&&Number.isInteger(h.subscriptions)&&h.subscriptions>0?0:1)}).catch(()=>process.exit(1))"]\n      interval: 5s\n      timeout: 5s\n      retries: 3\n      start_period: 20s\n`
    : "";

// This waits on the healthcheck above rather than on a log line. Keep the
// final logs in the command output so a failed deploy remains diagnosable.
const t3amsHealthWaitCommand = (container, tail = 30) =>
  `status=unknown; for i in $(seq 1 45); do status="$(docker inspect --format '{{.State.Health.Status}}' ${container} 2>/dev/null || true)"; [ "$status" = healthy ] && break; sleep 2; done; echo "T3AMS_BOT_HEALTH=$status"; docker logs --tail ${tail} ${container} 2>&1; [ "$status" = healthy ]`;

async function cmdDeploy(name, flags) {
  if (!name) fail("Usage: pca deploy <name> --host <ssh-target> [--harness openclaw|hermes] [--model <m>] [--allowed-tools <read,write,bash>] [--tool-scope workspace|container] [--media-analyzer] [--dry-run]");
  const host = flags.host ? sshTarget(flags.host) : null;
  if (!host) fail(`--host <ssh-target> is required, e.g.  pca deploy ${name} --host root@1.2.3.4`);
  const cfg = readConfig(name);
  if (!fs.existsSync(secretPath(name))) fail(`No secret found for "${name}".`);
  const secret = JSON.parse(fs.readFileSync(secretPath(name), "utf8"));
  const transport = configuredTransport(cfg);
  const mediaAnalyzerEnabled = flags["media-analyzer"] === true;
  const toolPolicyFlagUsed = flags["allowed-tools"] != null || flags["tool-scope"] != null;
  const suppliedKeyFlag = Object.values(KEY_FLAGS).find((key) => flags[key] != null);
  if (suppliedKeyFlag) {
    fail(`--${suppliedKeyFlag} is no longer accepted: API keys are not injected into autonomous agents. Authenticate the selected CLI or framework through its own persistent credential store instead.`);
  }
  if (cfg.brain === "bridge") {
    if (mediaAnalyzerEnabled) {
      fail("--media-analyzer requires a T3ams direct-engine deployment (claude, codex, or opencode); bridge bots own their attachment runtime.");
    }
    if (toolPolicyFlagUsed) {
      fail("--allowed-tools and --tool-scope require a built-in direct engine (claude, codex, or opencode); bridge bots own their agent runtime.");
    }
    const harness = flags.harness ? String(flags.harness).toLowerCase() : null;
    if (harness !== "openclaw" && harness !== "hermes") {
      fail(`"${name}" is a bridge-mode bot — pick which agent framework drives it:\n  pca deploy ${name} --host ${host} --harness openclaw   (fully headless if the server has Claude creds)\n  pca deploy ${name} --host ${host} --harness hermes     (one interactive codex login after deploy)`);
    }
    return deployHarnessStack(name, cfg, secret, flags, host, harness);
  }
  const spec = DEPLOY_ENGINES[cfg.brain];
  if (!spec) fail(`deploy supports echo/claude/codex/opencode and --harness openclaw|hermes for bridge bots.\nFor "${cfg.brain}", set it up manually — see docs/HARNESSES.md.`);
  if (mediaAnalyzerEnabled && (transport !== "t3ams" || !spec.pkg)) {
    fail("--media-analyzer requires a T3ams direct-engine deployment (claude, codex, or opencode); it has no effect for echo or bridge bots.");
  }
  if (!fs.existsSync(path.join(HERE, "node_modules")) || !fs.existsSync(path.join(HERE, ".papi"))) {
    fail(`bot-core dependencies missing. Run:  (cd ${HERE} && npm ci)  then retry.`);
  }
  if (spec.pkg && Object.keys(KEY_FLAGS).some((key) => process.env[key])) {
    warn("Provider API keys from this shell are intentionally not copied into the container. Use the deployed CLI's OAuth login instead.");
  }
  if (!cfg.registered) warn(`"${name}" isn't confirmed on the network yet — people can't message it until it is (pca info ${name}).`);

  const cn = containerName(`pca-${name.replace(/\./g, "-")}`);
  const base = remoteDir(flags["remote-dir"] ?? `pca-bots/${name}`);
  const sshOpts = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];
  const deployToolPolicy = requestedDirectToolPolicy(cfg.brain, flags, "deploy");

  // Verify the SDK before generating any deployment credentials or touching
  // the VPS. A dry run remains inspectable, but reports an import failure that
  // would block the real deployment.
  if (flags["dry-run"] === true) await warnForT3amsSdkDeployPreflight(transport);
  else await requireT3amsSdkForDeploy(transport);

  // Generate env + compose + Dockerfile locally, then (unless dry-run) ship & launch.
  const bridgeToken = configuredBridgeToken(cfg);
  const mediaAnalyzerToken = mediaAnalyzerEnabled ? ensureMediaAnalyzerToken(name, cfg) : null;
  const bridgePort = bridgePortFor(cfg);
  const entrypoint = entrypointForTransport(transport);
  const transportEnv = t3amsEnvironment(cfg, transport);
  const envLines = [
    envLine("BOT_SEED_HEX", secret.seedHex),
    envLine("BOT_ENDPOINT", cfg.endpoint),
    envLine("BOT_BRAIN", cfg.brain),
    envLine("BOT_TRANSPORT", transport),
    ...Object.entries(transportEnv).map(([key, value]) => envLine(key, value)),
    envLine("BOT_ALLOWED_PEERS", cfg.allow.join(",")),
    envLine("BOT_USERNAME", cfg.username ?? ""),
    envLine("BOT_STATE_DIR", "/state"),
    envLine("BOT_AI_WORKSPACE", "/workspace"),
    envLine("BOT_BRIDGE_PORT", bridgePort),
    envLine("BOT_BRIDGE_TOKEN", bridgeToken),
  ];
  if (mediaAnalyzerEnabled) {
    envLines.push(
      envLine("BOT_T3AMS_MEDIA_ANALYZER_URL", "http://media-analyzer:8798/v1/analyze"),
      envLine("BOT_T3AMS_MEDIA_ANALYZER_TOKEN", mediaAnalyzerToken),
      envLine("BOT_T3AMS_MEDIA_ANALYZER_HTTP_HOSTS", "media-analyzer"),
    );
  }
  for (const [key, value] of Object.entries(fileDeliveryEnvironment(cfg))) {
    envLines.push(envLine(key, value));
  }
  const deployModel = flags.model != null ? flagValue(flags.model, "model") : cfg.model;
  if (deployModel) envLines.push(envLine("BOT_AI_MODEL", deployModel));
  if (DIRECT_BRAIN_CLIS.has(cfg.brain)) {
    for (const [key, value] of Object.entries(modelPolicyEnvironment(cfg))) {
      envLines.push(envLine(key, value));
    }
  }
  if (spec.pkg) {
    for (const [key, value] of Object.entries(toolPolicyEnvironment(deployToolPolicy))) {
      envLines.push(envLine(key, value));
    }
  }
  if (flags.greet === true) envLines.push("BOT_GREET=1");
  if (spec.pkg) {
    envLines.push(
      "BOT_AI_AGENT_UID=1000",
      "BOT_AI_AGENT_GID=1000",
    );
  }

  // echo needs no CLI; direct engines get a fixed CLI image. Keep the bot as
  // root so it can read `/state`, then let agent-runtime setuid to node.
  const dockerfile = spec.pkg
    ? `FROM ${NODE_IMAGE}\nRUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*\nRUN npm install --global --no-audit --no-fund ${spec.pkg} && npm cache clean --force\nRUN mkdir -p /home/node /workspace /state && chown -R 1000:1000 /home/node /workspace && chmod 700 /home/node /workspace /state\nENV HOME=/home/node\nWORKDIR /app\nCMD ["node", "${entrypoint}"]\n`
    : null;
  const mediaDependsOn = mediaAnalyzerEnabled
    ? "    depends_on:\n      media-analyzer:\n        condition: service_healthy\n"
    : "";
  const botHealthcheck = t3amsBotHealthcheck(transport);
  const engineSecurityOptions = "      - no-new-privileges:true\n";
  const engineService = spec.pkg
    ? `  bot:\n    build: ./image\n    user: "0:0"\n    init: true\n    read_only: true\n    pids_limit: 256\n    mem_limit: 2g\n    cpus: "2.0"\n    security_opt:\n${engineSecurityOptions}    tmpfs:\n      - /tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777\n    container_name: ${cn}\n    restart: unless-stopped\n${mediaDependsOn}${LOG_OPTS}    working_dir: /app\n    env_file:\n      - ./bot.env\n    volumes:\n      - ./app:/app:ro\n      - ./state:/state\n      - ./workspace:/workspace\n      - ./home:/home/node\n${botHealthcheck}    command: ["node", "${entrypoint}"]\n`
    : `  bot:\n    image: ${NODE_IMAGE}\n    user: "1000:1000"\n    init: true\n    read_only: true\n    pids_limit: 128\n    mem_limit: 512m\n    cpus: "1.0"\n    security_opt:\n      - no-new-privileges:true\n    tmpfs:\n      - /tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777\n    container_name: ${cn}\n    restart: unless-stopped\n${mediaDependsOn}${LOG_OPTS}    working_dir: /app\n    env_file:\n      - ./bot.env\n    volumes:\n      - ./app:/app:ro\n      - ./state:/state\n${botHealthcheck}    command: ["node", "${entrypoint}"]\n`;
  const mediaContainer = mediaAnalyzerEnabled ? containerName(`${cn}-media`) : null;
  // This service has no bot state, workspace, OAuth home, host port, or Docker
  // socket. Its `media.env` is intentionally provisioned by the operator on
  // the VPS and never read or overwritten by pca deploy.
  const mediaService = mediaAnalyzerEnabled
    ? `  media-analyzer:\n    image: ${NODE_IMAGE}\n    user: "1000:1000"\n    init: true\n    read_only: true\n    pids_limit: 64\n    mem_limit: 512m\n    cpus: "1.0"\n    cap_drop:\n      - ALL\n    security_opt:\n      - no-new-privileges:true\n    tmpfs:\n      - /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777\n    container_name: ${mediaContainer}\n    restart: unless-stopped\n${LOG_OPTS}    working_dir: /app\n    env_file:\n      - ./media.env\n      - ./media-token.env\n    volumes:\n      - ./app:/app:ro\n    healthcheck:\n      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8798/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]\n      interval: 30s\n      timeout: 5s\n      retries: 3\n      start_period: 10s\n    command: ["node", "media-analyzer.mjs"]\n`
    : "";
  const compose = `services:\n${engineService}${mediaService}`;
  if (spec.pkg) {
    const summary = toolPolicySummary(deployToolPolicy);
    const enforcement = toolPolicyEnforcement(cfg.brain, deployToolPolicy);
    note(`Tool policy: ${summary.capabilities}; scope=${summary.scope}.`);
    note(`Enforcement: ${enforcement.detail}.`);
    if (enforcement.kind === "process-boundary" && deployToolPolicy.capabilities.includes("bash")) {
      warn("Bash runs inside this bot's container; workspace scope still applies to native file tools.");
    }
  }

  if (flags["dry-run"] === true) {
    console.log(`\n--- ${base}/docker-compose.yml ---\n${compose}`);
    if (dockerfile) console.log(`--- ${base}/image/Dockerfile ---\n${dockerfile}`);
    console.log(`--- ${base}/bot.env (secrets hidden) ---\n${redactEnv(envLines.join("\n"))}`);
    if (mediaAnalyzerEnabled) {
      console.log(`--- ${base}/media-token.env (secrets hidden) ---\n${redactEnv(envLine("MEDIA_ANALYZER_TOKEN", mediaAnalyzerToken))}`);
      note("Before a real deploy, create a mode-0600 media.env on the VPS with ANTHROPIC_API_KEY and MEDIA_ANALYZER_MODEL. pca never reads or overwrites that file.");
    }
    note(`\nDry run — nothing deployed.`);
    return;
  }

  step(`Checking ${host}…`);
  const pf = runLocal("ssh", [...sshOpts, host, "docker version --format '{{.Server.Version}}' && docker compose version --short"], { capture: true });
  if (pf.status !== 0) fail(`Can't reach ${host} or Docker isn't available there.\n${(pf.stderr || "").trim()}`);
  ok(`Connected — Docker ${(pf.stdout || "").trim().replace(/\n/g, " / ")}`);

  // The transport owns /state and runs as root. Only the spawned agent gets
  // the node-owned workspace and OAuth home; it cannot read the signing seed.
  const remoteBase = shellQuote(base);
  if (mediaAnalyzerEnabled) {
    // Create the parent before credential preflight. The credentials themselves
    // remain operator-provisioned on the VPS and are never read by this CLI.
    const mediaBase = runLocal("ssh", [...sshOpts, host, `mkdir -p ${remoteBase} && chmod 700 ${remoteBase}`], { capture: true });
    if (mediaBase.status !== 0) {
      fail(`Could not securely prepare ${base} on ${host} for --media-analyzer.`);
    }
    // Do not inspect the credentials file: its API key must never transit the
    // local CLI or stdout. We only prove the operator provisioned a regular,
    // nonempty file before generating a compose service that depends on it.
    const mediaEnv = runLocal("ssh", [...sshOpts, host,
      `test -f ${remoteBase}/media.env && test ! -L ${remoteBase}/media.env && test -s ${remoteBase}/media.env && test "$(stat -c %a ${remoteBase}/media.env)" = 600`], { capture: true });
    if (mediaEnv.status !== 0) {
      fail(`--media-analyzer requires a regular, nonempty mode-0600 ${base}/media.env on ${host}. Create it there with ANTHROPIC_API_KEY and MEDIA_ANALYZER_MODEL; pca never reads or overwrites this file.`);
    }
  }
  await provisionTestnetFileAllowance(name, cfg);
  const prepareVolumes = spec.pkg
    ? `mkdir -p ${remoteBase}/app ${remoteBase}/state ${remoteBase}/workspace ${remoteBase}/home ${remoteBase}/image && chown -R root:root ${remoteBase}/state && chmod 700 ${remoteBase}/state && chown -R 1000:1000 ${remoteBase}/workspace ${remoteBase}/home && chmod 700 ${remoteBase}/workspace ${remoteBase}/home`
    : `mkdir -p ${remoteBase}/app ${remoteBase}/state ${remoteBase}/image && chown -R 1000:1000 ${remoteBase}/state && chmod 700 ${remoteBase}/state`;
  const prep = runLocal("ssh", [...sshOpts, host, prepareVolumes]);
  if (prep.status !== 0) fail("Could not prepare the remote bot directories.");
  step("Uploading bot-core (code + dependencies)…");
  const rs = runLocal("rsync", ["-az", "--delete",
    "--exclude", "bots/", "--exclude", "*.log", "--exclude", "*.bak*", "--exclude", ".git",
    "-e", `ssh ${sshOpts.join(" ")}`, `${HERE}/`, `${host}:${base}/app/`]);
  if (rs.status !== 0) fail("Upload (rsync) failed.");
  ok("Uploaded");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pca-deploy-"));
  fs.writeFileSync(path.join(tmp, "bot.env"), `${envLines.join("\n")}\n`, { mode: 0o600 });
  if (mediaAnalyzerEnabled) {
    fs.writeFileSync(path.join(tmp, "media-token.env"), `${envLine("MEDIA_ANALYZER_TOKEN", mediaAnalyzerToken)}\n`, { mode: 0o600 });
  }
  fs.writeFileSync(path.join(tmp, "docker-compose.yml"), compose);
  if (dockerfile) fs.writeFileSync(path.join(tmp, "Dockerfile"), dockerfile);
  const scpFiles = [path.join(tmp, "bot.env"), path.join(tmp, "docker-compose.yml")];
  if (mediaAnalyzerEnabled) scpFiles.push(path.join(tmp, "media-token.env"));
  const cp = runLocal("scp", [...sshOpts, ...scpFiles, `${host}:${base}/`]);
  const dockerCp = dockerfile
    ? runLocal("scp", [...sshOpts, path.join(tmp, "Dockerfile"), `${host}:${base}/image/`])
    : null;
  fs.rmSync(tmp, { recursive: true, force: true });
  if (cp.status !== 0 || dockerCp?.status !== 0) fail("Copying config (scp) failed.");
  // scp applies the remote umask, so fail closed unless every generated secret
  // is mode 0600 before Compose is allowed to start a container with it.
  const remoteSecretFiles = [`${remoteBase}/bot.env`];
  if (mediaAnalyzerEnabled) remoteSecretFiles.push(`${remoteBase}/media-token.env`);
  const secureSecrets = runLocal("ssh", [...sshOpts, host,
    `chmod 600 ${remoteSecretFiles.join(" ")} && ${remoteSecretFiles.map((file) => `test "$(stat -c %a ${file})" = 600`).join(" && ")}`], { capture: true });
  if (secureSecrets.status !== 0) fail("Could not secure generated deployment secret files.");

  if (dockerfile) {
    step("Building the agent image (first run pulls the CLI — a few minutes)…");
    const build = runLocal("ssh", [...sshOpts, host, `cd ${base} && docker compose -p ${cn} build`]);
    if (build.status !== 0) fail("docker compose build failed.");
  }
  step("Starting the container…");
  const up = runLocal("ssh", [...sshOpts, host, `cd ${base} && docker compose -p ${cn} up -d --force-recreate --remove-orphans`]);
  if (up.status !== 0) fail("docker compose up failed.");

  // Remember where this bot lives so `pca stop/logs/status` don't need --host.
  cfg.deploy = { host, dir: base, container: cn, at: new Date().toISOString() };
  saveConfig(name, cfg);

  step(transport === "t3ams" ? "Waiting for authenticated T3ams health and subscriptions…" : "Waiting for the bot to come online…");
  const wait = runLocal("ssh", [...sshOpts, host,
    transport === "t3ams"
      ? t3amsHealthWaitCommand(cn)
      : `for i in $(seq 1 20); do docker logs ${cn} 2>&1 | grep -q BOT_LISTENING && break; sleep 2; done; docker logs --tail 30 ${cn} 2>&1`], { capture: true });
  const logs = wait.stdout || "";
  const botReady = transport === "t3ams"
    ? wait.status === 0 && /T3AMS_BOT_HEALTH=healthy/.test(logs)
    : /BOT_LISTENING/.test(logs);
  if (botReady) {
    ok(`"${name}" is live on ${host} (container ${cn}).`);
    console.log();
    if (transport === "t3ams") {
      console.log("Message it in T3ams:");
      printT3amsReachLine(cfg);
    } else {
      console.log("Message it in the Polkadot app:");
      printReachLine(cfg.account, cfg.username);
    }
    console.log();
    note(`Logs:  ssh ${host} 'docker logs -f ${cn}'`);
    if (mediaAnalyzerEnabled) {
      const mediaWait = runLocal("ssh", [...sshOpts, host,
        `for i in $(seq 1 20); do status="$(docker inspect --format '{{.State.Health.Status}}' ${mediaContainer} 2>/dev/null || true)"; [ "$status" = healthy ] && break; sleep 1; done; docker inspect --format 'MEDIA_ANALYZER_HEALTH={{.State.Health.Status}}' ${mediaContainer} 2>&1; docker logs --tail 10 ${mediaContainer} 2>&1`], { capture: true });
      if (/MEDIA_ANALYZER_HEALTH=healthy/.test(mediaWait.stdout || "")) {
        ok(`Attachment analysis worker is live (container ${mediaContainer}).`);
        note(`Worker logs: ssh ${host} 'docker logs -f ${mediaContainer}'`);
      } else {
        warn("Bot is live, but the attachment analysis worker did not report ready. Check its logs; normal chat replies remain available.");
        console.log((mediaWait.stdout || "").split("\n").slice(-10).join("\n"));
      }
    }
    note(`Stop:  pca stop ${name}`);
    if (spec.pkg) {
      const login = cfg.brain === "opencode" ? "opencode auth login" : `${cfg.brain} login`;
      note(`Model login (once): ssh ${host} 'docker exec -it --user 1000:1000 ${cn} ${login}'`);
    }
  } else {
    warn(transport === "t3ams"
      ? "Container started, but it did not become healthy with a connected T3ams chain and active subscriptions. Recent logs:"
      : "Container started, but I didn't see BOT_LISTENING. Recent logs:");
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
  const cn = containerName(`pca-${name.replace(/\./g, "-")}`);
  const hn = containerName(`pca-${name}-${harness}`);
  const base = remoteDir(flags["remote-dir"] ?? `pca-bots/${name}`);
  const sshOpts = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];
  const allow = cfg.allow;
  const model = flags.model != null ? flagValue(flags.model, "model") : "claude-cli/claude-sonnet-4-6";
  if (/[\0\r\n]/.test(model)) fail("--model cannot contain a newline or NUL byte.");
  const transport = configuredTransport(cfg);
  if (flags["dry-run"] === true) await warnForT3amsSdkDeployPreflight(transport);
  else await requireT3amsSdkForDeploy(transport);
  const bridgePort = bridgePortFor(cfg);
  const bridgeToken = configuredBridgeToken(cfg);
  const bridgeUrl = `http://bot:${bridgePort}`;
  const entrypoint = entrypointForTransport(transport);
  const transportEnv = t3amsEnvironment(cfg, transport);

  const botEnv = [
    envLine("BOT_SEED_HEX", secret.seedHex),
    envLine("BOT_ENDPOINT", cfg.endpoint),
    envLine("BOT_BRAIN", "bridge"),
    envLine("BOT_TRANSPORT", transport),
    ...Object.entries(transportEnv).map(([key, value]) => envLine(key, value)),
    envLine("BOT_ALLOWED_PEERS", allow.join(",")),
    envLine("BOT_USERNAME", cfg.username ?? ""),
    envLine("BOT_STATE_DIR", "/state"),
    envLine("BOT_BRIDGE_PORT", bridgePort), // keep in sync with bridgeUrl/status
    envLine("BOT_BRIDGE_TOKEN", bridgeToken),
    ...Object.entries(fileDeliveryEnvironment(cfg)).map(([key, value]) => envLine(key, value)),
    // The harness container reaches the bridge over the compose network, so the
    // bridge must bind beyond loopback here (no ports are published to the host).
    `BOT_BRIDGE_HOST=0.0.0.0`,
    ...(flags.greet === true ? ["BOT_GREET=1"] : []),
  ].join("\n");
  // State mounts at top-level /state, NOT nested under the read-only ./app:ro
  // mount — Docker cannot create a mountpoint inside a read-only bind.
  const botHealthcheck = t3amsBotHealthcheck(transport);
  // A T3ams harness should not start consuming bridge work before the bot has
  // connected to the chain and installed its subscriptions. Polkadot-app
  // deployments use their normal start-only dependency.
  const harnessBotDependency = transport === "t3ams"
    ? "    depends_on:\n      bot:\n        condition: service_healthy\n"
    : "    depends_on: [bot]\n";
  const botService = `  bot:\n    image: ${NODE_IMAGE}\n    user: "1000:1000"\n    container_name: ${cn}\n    restart: unless-stopped\n${LOG_OPTS}    working_dir: /app\n    volumes:\n      - ./app:/app:ro\n      - ./state:/state\n    env_file:\n      - ./bot.env\n${botHealthcheck}    command: ["node", "${entrypoint}"]\n`;

  const files = { "bot.env": `${botEnv}\n` };  // path (relative to base) -> content
  let compose, setup, afterUp;
  if (harness === "openclaw") {
    compose = `services:\n${botService}\n  openclaw:\n    build: ./image\n    container_name: ${hn}\n    restart: unless-stopped\n${LOG_OPTS}    env_file:\n      - ./gateway.env\n    volumes:\n      - ./openclaw-home:/home/node\n      - ./plugin:/plugin:ro\n${harnessBotDependency}    command: ["openclaw", "gateway"]\n`;
    files["image/Dockerfile"] = `FROM ${NODE_IMAGE}\nRUN npm install --global --no-audit --no-fund openclaw@2026.6.11 @anthropic-ai/claude-code@2.1.207 && npm cache clean --force\nENV HOME=/home/node\nWORKDIR /home/node\nUSER node\nCMD ["openclaw", "gateway"]\n`;
    files["gateway.env"] = `${envLine("OPENCLAW_GATEWAY_TOKEN", randomBytes(32).toString("base64url"))}\n${envLine("POLKADOT_BRIDGE_TOKEN", bridgeToken)}\n`;
    // Runs inside the one-off setup container (home volume mounted) after `models set`
    // has created the config; merges in gateway mode + our channel.
    const channel = transport === "t3ams"
      // T3ams deliveries are addressed to a workspace-channel session,
      // not an owner's account ID. bot-core has already authenticated and
      // allowlisted the actual T3ams sender, so do not make OpenClaw's
      // DM-only gate reject that channel key a second time.
      ? { enabled: true, bridgeUrl, dmPolicy: "open", allowFrom: ["*"] }
      : allow.length
      ? { enabled: true, bridgeUrl, dmPolicy: "allowlist", allowFrom: allow }
      : { enabled: true, bridgeUrl, dmPolicy: "open", allowFrom: ["*"] };
    files["openclaw-home/setup-config.cjs"] = `const fs = require("fs");
const p = "/home/node/.openclaw/openclaw.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.gateway = { ...(j.gateway ?? {}), mode: "local" };
j.channels = { ...(j.channels ?? {}), polkadot: ${JSON.stringify(channel)} };
fs.writeFileSync(p, JSON.stringify(j, null, 2));
fs.chmodSync(p, 0o600);
console.log("openclaw config ok");
`;
    setup = `set -e
cd ${base}
chown -R root:root plugin 2>/dev/null || true
mkdir -p openclaw-home/.claude
if [ -f openclaw-home/.claude/.credentials.json ]; then
  # Keep the container's own (possibly OAuth-refreshed) token — re-copying the
  # host's original would clobber a rotated token and break auth on redeploy.
  echo CREDS_KEPT
elif [ -f "$HOME/.claude/.credentials.json" ]; then
  cp "$HOME/.claude/.credentials.json" openclaw-home/.claude/
  [ -f "$HOME/.claude.json" ] && cp "$HOME/.claude.json" openclaw-home/.claude.json
  chmod 700 openclaw-home/.claude
  echo CREDS_SEEDED
else
  echo NO_CREDS
fi
chown -R 1000:1000 openclaw-home 2>/dev/null || true
docker compose -p ${cn} build openclaw >/dev/null 2>&1 && echo IMAGE_BUILT
docker compose -p ${cn} run --rm openclaw sh -lc ${shellQuote(`openclaw plugins install --link /plugin >/dev/null; openclaw models set ${shellQuote(model)} >/dev/null; node /home/node/setup-config.cjs; rm -f /home/node/setup-config.cjs`)} 2>&1 | tail -2
`;
    afterUp = (creds) => {
      if (!creds) {
        warn("No Claude creds found on the server (~/.claude/.credentials.json) — the gateway is up but the model can't answer.");
        note(`Fix: log in on the server once (claude login), then rerun: pca deploy ${name} --host ${host} --harness openclaw`);
      }
    };
  } else {
    const hermesAccess = transport === "t3ams"
      ? "      - POLKADOT_ALLOW_ALL_USERS=1\n"
      : `      - POLKADOT_ALLOWED_USERS=${allow.join(",")}\n`;
    compose = `services:\n${botService}\n  hermes:\n    image: ${HERMES_IMAGE}\n    container_name: ${hn}\n    restart: unless-stopped\n${LOG_OPTS}    command: ["gateway", "run"]\n    env_file:\n      - ./hermes.env\n    environment:\n      - HERMES_UID=0\n      - HERMES_GID=0\n      - POLKADOT_BRIDGE_URL=${bridgeUrl}\n${hermesAccess}    volumes:\n      - hermes-data:/opt/data\n      - ./plugin:/opt/data/plugins/polkadot:ro\n${harnessBotDependency}\nvolumes:\n  hermes-data:\n`;
    files["hermes.env"] = `${envLine("POLKADOT_BRIDGE_TOKEN", bridgeToken)}\n`;
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
      console.log(`\n--- ${base}/${rel} ---\n${redactEnv(content)}`);
    }
    console.log(`\n--- remote setup ---\n${setup}`);
    note("Dry run — nothing deployed.");
    return;
  }

  await provisionTestnetFileAllowance(name, cfg);

  step(`Checking ${host}…`);
  const pf = runLocal("ssh", [...sshOpts, host, "docker version --format '{{.Server.Version}}' >/dev/null && echo docker-ok"], { capture: true });
  if (pf.status !== 0) fail(`Can't reach ${host} or Docker isn't available there.\n${(pf.stderr || "").trim()}`);
  ok("Connected");

  const remoteBase = shellQuote(base);
  const prep = runLocal("ssh", [...sshOpts, host,
    `mkdir -p ${remoteBase}/app ${remoteBase}/state ${remoteBase}/plugin ${remoteBase}/image ${remoteBase}/openclaw-home && chown -R 1000:1000 ${remoteBase}/state && chmod 700 ${remoteBase}/state`]);
  if (prep.status !== 0) fail("Could not prepare the remote harness directories.");
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
  const credsSeeded = /CREDS_SEEDED|CREDS_KEPT/.test(setupOut);
  ok(`Setup done${/IMAGE_BUILT/.test(setupOut) ? " (image built)" : ""}`);

  step("Starting the stack…");
  const up = runLocal("ssh", [...sshOpts, host, `cd ${base} && docker compose -p ${cn} up -d --force-recreate --remove-orphans`]);
  if (up.status !== 0) fail("docker compose up failed.");
  cfg.deploy = { host, dir: base, container: cn, harness, at: new Date().toISOString() };
  saveConfig(name, cfg);

  step(transport === "t3ams" ? "Waiting for authenticated T3ams health and subscriptions…" : "Waiting for the bot to come online…");
  const wait = runLocal("ssh", [...sshOpts, host,
    transport === "t3ams"
      ? t3amsHealthWaitCommand(cn, 5)
      : `for i in $(seq 1 25); do docker logs ${cn} 2>&1 | grep -q BOT_LISTENING && break; sleep 2; done; docker logs --tail 5 ${cn} 2>&1`], { capture: true });
  const stackReady = transport === "t3ams"
    ? wait.status === 0 && /T3AMS_BOT_HEALTH=healthy/.test(wait.stdout || "")
    : /BOT_LISTENING/.test(wait.stdout || "");
  if (stackReady) {
    ok(`"${name}" is live on ${host} (${cn} + ${hn}).`);
    console.log();
    if (transport === "t3ams") {
      console.log("Message it in T3ams:");
      printT3amsReachLine(cfg);
    } else {
      console.log("Message it in the Polkadot app:");
      printReachLine(cfg.account, cfg.username);
    }
    afterUp(credsSeeded);
    console.log();
    note(`Logs:   pca logs ${name} -f   (bridge)  ·  ssh ${host} 'docker logs -f ${hn}'  (${harness})`);
    note(`Status: pca status ${name}   ·  Stop: pca stop ${name}`);
  } else {
    warn(transport === "t3ams"
      ? "Stack started, but the bot did not become healthy with a connected T3ams chain and active subscriptions. Recent logs:"
      : "Stack started, but the bot didn't report BOT_LISTENING. Recent logs:");
    console.log((wait.stdout || "").split("\n").slice(-6).join("\n"));
  }
}

// Resolve the ssh target + container for a deployed bot: --host wins, else the
// deploy metadata saved by `pca deploy`.
function deployTarget(name, flags) {
  const cfg = readConfig(name);
  const hostValue = flags.host ? flags.host : cfg.deploy?.host;
  const host = hostValue ? sshTarget(hostValue) : null;
  const cn = containerName(cfg.deploy?.container ?? `pca-${name.replace(/\./g, "-")}`);
  const dir = cfg.deploy?.dir ? remoteDir(cfg.deploy.dir) : null;
  if (!host) fail(`"${name}" hasn't been deployed (no saved host). Deploy it, or pass --host <ssh>.`);
  return { cfg, host, cn, dir };
}
const SSH_OPTS = ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes"];

function cmdLogs(name, flags) {
  const { host, cn } = deployTarget(name, flags);
  const follow = flags.follow === true || flags.f === true;
  const rawTail = flags.tail ?? 100;
  if (typeof rawTail === "boolean" || String(rawTail).trim() === "") fail("--tail requires an integer from 1 to 10000.");
  const tail = Number(rawTail);
  if (!Number.isInteger(tail) || tail < 1 || tail > 10_000) fail("--tail must be an integer from 1 to 10000.");
  step(`Logs for "${name}" on ${host}${follow ? " (following — Ctrl-C to stop)" : ""}…`);
  // stdio inherit so -f streams live and Ctrl-C ends it.
  spawnSync("ssh", [...SSH_OPTS, ...(follow ? ["-t"] : []), host,
    `docker logs ${follow ? "-f " : ""}--tail ${tail} ${cn}`], { stdio: "inherit" });
}

const healthLine = (h) => {
  const chain = h.ok ? c("reaching the network", "32") : c(`not reaching the network (last ok ${Math.round((h.lastPollAgoMs ?? 0) / 1000)}s ago)`, "31");
  return `${h.username || "(no username)"} · ${chain}`;
};

async function cmdStatus(name, flags) {
  const cfg = readConfig(name);
  const hostValue = flags.host ? flags.host : cfg.deploy?.host;
  const host = hostValue ? sshTarget(hostValue) : null;
  const port = bridgePortFor(cfg);
  const bridgeToken = configuredBridgeToken(cfg);
  const auth = { authorization: `Bearer ${bridgeToken}` };
  if (!host) {
    // Not deployed: a locally running bot's bridge binds loopback, so its
    // /health endpoint is the status source.
    step(`Status of "${name}" (local)…`);
    let h = null;
    try {
      h = await fetch(`http://127.0.0.1:${port}/health`, { headers: auth, signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    } catch { /* nothing listening */ }
    if (!h) {
      warn(`"${name}" isn't running here (nothing on port ${port}).`);
      note(`Start it:  pca run ${name}   ·  or deploy it: pca deploy ${name} --host <ssh>`);
      process.exitCode = 1;
      return;
    }
    if (h.error === "unauthorized") {
      warn(`The local bridge on port ${port} predates bridge authentication. Restart it with: pca run ${name}`);
      process.exitCode = 1;
      return;
    }
    if (String(h.account ?? "").toLowerCase() !== String(cfg.account ?? "").toLowerCase()) {
      warn(`Port ${port} is serving a different bot (${h.username || h.account || "unknown"}), not "${name}".`);
      process.exitCode = 1;
      return;
    }
    ok(`"${name}" is running locally.`);
    note(healthLine(h));
    return;
  }
  const cn = containerName(cfg.deploy?.container ?? `pca-${name.replace(/\./g, "-")}`);
  step(`Status of "${name}" on ${host}…`);
  const healthProbe = `fetch("http://127.0.0.1:${port}/health",{headers:{authorization:"Bearer "+(process.env.BOT_BRIDGE_TOKEN||"")},signal:AbortSignal.timeout(4000)}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.stdout.write("NO_HEALTH"))`;
  const r = runLocal("ssh", [...SSH_OPTS, host,
    `docker ps --filter name=^/${cn}$ --format '{{.Status}}' | head -1; ` +
    // Probe inside the bot container so neither the port nor bridge secret is
    // exposed on the remote host. The container already has its own token.
    `docker exec ${shellQuote(cn)} node -e ${shellQuote(healthProbe)} 2>/dev/null; echo; ` +
    `docker logs --tail 1 ${cn} 2>&1 | grep -oE '"event":"[A-Z_]+"' | tail -1`], { capture: true });
  const [statusLine = "", health = "", lastEvent = ""] = (r.stdout || "").trim().split("\n");
  if (!statusLine) { warn(`Container ${cn} is not running on ${host}.`); return; }
  ok(`${cn}: ${statusLine}`);
  if (health.startsWith("{")) {
    try {
      const parsed = JSON.parse(health);
      if (parsed.error === "unauthorized") warn("Bridge authentication failed. This deployment predates bridge tokens; rerun pca deploy to rotate it.");
      else note(healthLine(parsed));
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

  pca create <botname> [--brain echo|claude|codex|opencode|bridge] [--transport polkadot-app|t3ams] [--owner <your username or address>] [--public] [--network paseo] [--username name]
  pca register <name>                  finish/retry registration for an existing bot
  pca run <name> [--model <m>] [--allowed-tools <read,write,bash>] [--tool-scope workspace|container] [--greet]
                                       start the bot locally (foreground)
  pca deploy <name> --host <ssh>       ship it to a server and run it in Docker
  pca logs <name> [-f] [--tail N]      tail a deployed bot's logs
  pca status <name>                    is the bot running + healthy? (local or deployed)
  pca stop <name>                      stop a deployed bot
  pca delete <name> --yes              delete a local bot (destroys its key — irreversible)
  pca list                             list your bots
  pca project <name> [add <alias> <path> | rm <alias>]   projects a direct-engine bot can work in
                                       (in chat: /project <alias>[@branch] — branches get isolated git worktrees)
  pca model <name> [show|set|allow|lock|open]            inspect or set a direct bot's model policy
  pca storage <name> [status|grant|recover]  check, provision, or recover the private Paseo testnet file allowance
  pca info <name>                      show address + how to message it

create flags:
  --transport <name> select the message transport: polkadot-app (default) or t3ams
  --owner <who>    lock the bot to you — your app username (myname.42), address, or 0x hex (recommended)
  --allow a,b      allowlist several owners (usernames/addresses/hex, comma-separated)
  --t3ams-peer-key owner=hex[,owner=hex]
                   required for each private T3ams owner: immutable tagged-CBOR signing-key pin
  --t3ams-display-name <name>
                   name shown by a T3ams bot (defaults to its registered username)
  --t3ams-auto-accept-workspaces
                   allow public T3ams workspace enrollment; private bots default to allowed inviters
  --t3ams-no-auto-accept-workspaces
                   disable automatic T3ams workspace enrollment, including for private bots
  --public         let anyone message it (required to leave a paid bot open)
  --username <u>   network username base if different from the bot name (6+ lowercase letters)
  --digits <NN>    request a specific username number (mybot.NN); omit to auto-assign a free one
  --model <m>      pin the AI model, passed to the brain CLI's own model flag
                   (e.g. claude-haiku-4-5-20251001); saved to the bot, --model on run/deploy overrides
  --greet          (run/deploy) the bot opens the chat with its owner on first start — proof of life
  --no-register    create the identity locally without registering (finish later with pca register)
  --wait <secs>    how long to wait for on-chain confirmation (default 180)
  --network <ep>   target People network: paseo (default) or a full wss:// endpoint. Private Paseo bots get the named testnet file-delivery profile and local automatic allowance provisioning.

model controls:  show current policy  ·  set <model> pins the default model  ·  allow <a,b>
  restricts chat-side switching  ·  lock disables it  ·  open permits it only for allowlisted bots

deploy flags:  --host root@1.2.3.4 (required)  ·  --harness openclaw|hermes (bridge bots)  ·  --model <m>  ·  --allowed-tools <read,write,bash>  ·  --tool-scope workspace|container  ·  --media-analyzer  ·  --dry-run
  Needs Docker on the server + SSH access. Direct engines (echo/claude/codex/opencode)
  deploy with root-only transport state and a non-root agent CLI, with a persistent
  /workspace the agent works in; bridge bots deploy a two-container stack. Direct
  agents start with no tools. --allowed-tools accepts portable lowercase
  capabilities: read (inspect files), write (edit files; includes read), and
  bash (run commands; includes read and write). --tool-scope workspace keeps
  native file tools in the selected project; container grants those tools the
  non-root agent account's container-visible files. Bash always runs inside
  the bot container, so a workspace-scoped policy still uses the container as
  its Bash boundary. Every direct bot starts no-tools, including public Claude,
  Codex, and OpenCode bots. Inbound attachments are staged per turn and become
  readable when the read capability is enabled. Alternatively,
  --media-analyzer adds an isolated API-only photo/document worker; provision
  its remote media.env with a provider API key and model first. The deploy output
  gives the one-time OAuth login command for direct engines; logs/status/stop reuse
  the saved host (override with --host).

Brains:  echo (test)  ·  claude/codex/opencode (direct agent engines — verbatim prompts,
  native session resume, tools in a container; opencode reaches many providers via
  --model provider/model)  ·  bridge (hand off to an agent harness)

Bots live in ${BOTS_DIR} (override with PCA_BOTS_DIR).`);
}

// Which flags each command accepts. A flag not on the list is almost always a
// typo (--modle) or a misplaced flag (--greet on create) — and silently
// ignoring it means the user believes a setting took effect when it didn't.
const COMMAND_FLAGS = {
  create: ["brain", "transport", "owner", "allow", "t3ams-peer-key", "t3ams-display-name", "t3ams-auto-accept-workspaces", "t3ams-no-auto-accept-workspaces", "public", "network", "endpoint", "backend", "username", "digits", "model", "port", "wait", "no-register"],
  register: ["username", "digits", "wait"],
  run: ["model", "allowed-tools", "tool-scope", "greet"],
  deploy: ["host", "harness", "anthropic-key", "openai-key", "openrouter-key", "gemini-key", "groq-key", "allowed-tools", "tool-scope", "media-analyzer", "model", "dry-run", "remote-dir", "greet"],
  logs: ["host", "follow", "tail"],
  status: ["host"],
  stop: ["host"],
  delete: ["yes"],
  list: [], info: [], help: [], project: [], model: [], storage: ["yes"],
};

const { flags, positional } = parseFlags(process.argv.slice(2));
const [command, arg] = positional;
if (flags.help === true || flags.h === true) { usage(); process.exit(0); }
if (flags.version === true || flags.V === true || command === "version") {
  console.log(JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).version);
  process.exit(0);
}
{
  const known = COMMAND_FLAGS[command];
  if (known) {
    const bad = Object.keys(flags).filter((k) => !known.includes(k));
    if (bad.length) {
      fail(`Unknown flag${bad.length > 1 ? "s" : ""} for "${command}": ${bad.map((b) => `--${b}`).join(", ")}\n  Flags for ${command}: ${known.length ? known.map((f) => `--${f}`).join(", ") : "(none)"}`);
    }
  }
}
try {
  switch (command) {
    case "create": await cmdCreate(arg, flags); break;
    case "register": await cmdRegister(arg, flags); break;
    case "run": cmdRun(arg, flags); break;                 // spawns a child; manages its own exit
    case "deploy": await cmdDeploy(arg, flags); break;
    case "logs": cmdLogs(arg, flags); break;
    case "status": await cmdStatus(arg, flags); break;
    case "stop": cmdStop(arg, flags); break;
    case "delete": cmdDelete(arg, flags); break;
    case "list": cmdList(); break;
    case "project": cmdProject(positional.slice(1)); break;
    case "model": cmdModel(positional.slice(1)); break;
    case "storage": await cmdStorage(positional.slice(1), flags); break;
    case "info": await cmdInfo(arg); break;
    case "help": usage(); break;
    default: usage(); if (command != null) process.exit(1);
  }
  // Commands that open chain WS clients (create/info/deploy) keep the event loop
  // alive after finishing; exit explicitly (honoring any failure exit code set
  // by the command). `run` is the exception — it stays.
  if (command !== "run") process.exit(process.exitCode ?? 0);
} catch (e) { fail(e instanceof Error ? e.message : String(e)); }
