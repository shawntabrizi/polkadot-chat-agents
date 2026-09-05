import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStoreNode } from "../../../sandbox/lib/store-node.mjs";
import {
  bytesToHex,
  deriveT3amsIdentity,
} from "../../transports/t3ams/t3ams-identity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT_CORE = path.join(HERE, "..", "..");
const CLI = path.join(BOT_CORE, "cli.mjs");
const T3AMS = path.join(BOT_CORE, "t3ams.mjs");
const BOT_SEED_HEX = `0x${"61".repeat(32)}`;
const BRIDGE_TOKEN = "doctor-test-bridge-token-is-long-enough";
// Without the (unpublished) SDK the spawned bot never comes online and the
// doctor waits for it; skip with a reason rather than hang CI to its timeout.
const SDK_SKIP = fs.existsSync(path.join(BOT_CORE, "node_modules", "@t3ams", "bcts", "package.json"))
  ? false
  : "@t3ams/bcts is not installed (run pca t3ams setup)";

function waitForOutput(child, pattern, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${pattern}:\n${output}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`process exited ${code} before ${pattern}:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}

function runProcess(file, args, env, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: BOT_CORE,
      env: { ...process.env, ...env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process timed out:\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("pca t3ams doctor proves a live public bot inbox end to end", { timeout: 30_000, skip: SDK_SKIP }, async () => {
  const node = await startStoreNode();
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-t3ams-doctor-"));
  const name = "doctorbot";
  const dir = path.join(botsDir, name);
  const material = deriveT3amsIdentity(BOT_SEED_HEX);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify({
    name,
    endpoint: node.url,
    backendUrl: "https://backend.example.test",
    brain: "echo",
    transport: "t3ams",
    allow: [],
    allowLabels: {},
    t3amsNamespace: "doctor-test",
    bridgePort: 8799,
    bridgeToken: BRIDGE_TOKEN,
    account: material.accountIdHex,
    address: "5DoctorBot",
    identifierKey: `0x${"11".repeat(33)}`,
    username: "doctorbot.42",
    registered: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "secret.json"), `${JSON.stringify({ seedHex: BOT_SEED_HEX })}\n`);

  const bot = spawn(process.execPath, [T3AMS], {
    cwd: BOT_CORE,
    env: {
      ...process.env,
      BOT_SEED_HEX,
      BOT_ENDPOINT: node.url,
      BOT_NETWORK_PROFILE: "",
      BOT_BRAIN: "echo",
      BOT_TRANSPORT: "t3ams",
      BOT_ALLOWED_PEERS: "",
      BOT_T3AMS_TRUSTED_SIGNING_KEYS: "{}",
      BOT_T3AMS_TOPIC_NAMESPACE: "doctor-test",
      BOT_T3AMS_BULLETIN_RPC: "",
      BOT_BRIDGE_PORT: "0",
      BOT_BRIDGE_TOKEN: BRIDGE_TOKEN,
      BOT_STATE_DIR: dir,
      BOT_USERNAME: "doctorbot.42",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForOutput(bot, /BOT_LISTENING/);
    const result = await runProcess(CLI, ["t3ams", "doctor", name], { PCA_BOTS_DIR: botsDir });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /SDK present and protocol contract matches/);
    assert.match(result.stdout, /Namespace configured: doctor-test/);
    assert.match(result.stdout, /OAuth\/model preflight: echo does not use a direct engine CLI/);
    assert.match(result.stdout, /Loopback proof received the bot's signed dmAccept with its agreementPubKey/);
    assert.match(result.stdout, /PASS T3ams doctor: all hard checks passed/);
    assert.equal(node.statements.length >= 2, true, "request and accept must both reach the store");
  } finally {
    bot.kill("SIGTERM");
    await once(bot, "exit").catch(() => {});
    await node.close();
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("pca t3ams doctor detects an allowlist before using a throwaway identity", { skip: SDK_SKIP }, async () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-t3ams-doctor-private-"));
  const name = "privatebot";
  const dir = path.join(botsDir, name);
  const material = deriveT3amsIdentity(BOT_SEED_HEX);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify({
    name,
    endpoint: "ws://127.0.0.1:1",
    backendUrl: "https://backend.example.test",
    brain: "echo",
    transport: "t3ams",
    allow: ["ab".repeat(32)],
    allowLabels: { ["ab".repeat(32)]: "owner" },
    t3amsNamespace: "doctor-test",
    bridgePort: 8799,
    bridgeToken: BRIDGE_TOKEN,
    account: material.accountIdHex,
    address: "5PrivateBot",
    identifierKey: `0x${"11".repeat(33)}`,
    username: "privatebot.42",
    registered: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "secret.json"), `${JSON.stringify({ seedHex: BOT_SEED_HEX })}\n`);
  try {
    const result = await runProcess(CLI, ["t3ams", "doctor", name], { PCA_BOTS_DIR: botsDir });
    assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /the bot is allowlisted, so a throwaway identity will be rejected/);
    assert.match(result.stdout, /Rerun with --as <account-seed-hex>/);
    assert.match(result.stdout, /FAIL T3ams doctor: 1 hard check failed/);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});
