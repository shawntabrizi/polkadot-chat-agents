import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "cli.mjs");
const ACCOUNT = "ab".repeat(32);

const runCli = (botsDir, args) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: path.join(HERE, ".."),
  encoding: "utf8",
  env: { ...process.env, PCA_BOTS_DIR: botsDir, NO_COLOR: "1" },
});

const writeBot = (botsDir, name, config) => {
  const dir = path.join(botsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(config)}\n`);
  fs.writeFileSync(path.join(dir, "secret.json"), `${JSON.stringify({ seedHex: `0x${"11".repeat(32)}` })}\n`);
};

const readBot = (botsDir, name) => JSON.parse(fs.readFileSync(path.join(botsDir, name, "config.json"), "utf8"));

test("pca model persists a safe policy and serializes it for direct deploys", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  const name = "modelbot";
  writeBot(botsDir, name, {
    name,
    endpoint: "ws://127.0.0.1:9944",
    brain: "codex",
    allow: [ACCOUNT],
    bridgePort: 8799,
    bridgeToken: "a-long-enough-bridge-token-for-tests",
  });
  try {
    let result = runCli(botsDir, ["model", name, "show"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /switching: locked \(default\)/);

    result = runCli(botsDir, ["model", name, "set", "gpt-5"]);
    assert.equal(result.status, 0, result.stderr);
    result = runCli(botsDir, ["model", name, "allow", "gpt-5,opus"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readBot(botsDir, name).allowedModels, ["gpt-5", "opus"]);

    result = runCli(botsDir, ["deploy", name, "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_ALLOWED_MODELS=gpt-5,opus/);
    assert.doesNotMatch(result.stdout, /BOT_AI_MODEL_SWITCHING=open/);

    result = runCli(botsDir, ["model", name, "open"]);
    assert.equal(result.status, 0, result.stderr);
    const open = readBot(botsDir, name);
    assert.equal(open.modelSwitching, "open");
    assert.equal("allowedModels" in open, false);

    result = runCli(botsDir, ["deploy", name, "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_MODEL_SWITCHING=open/);
    assert.doesNotMatch(result.stdout, /BOT_AI_ALLOWED_MODELS=/);

    result = runCli(botsDir, ["model", name, "lock"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readBot(botsDir, name).allowedModels, []);
    result = runCli(botsDir, ["deploy", name, "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_ALLOWED_MODELS=\n/);

    const publicName = "publicbot";
    writeBot(botsDir, publicName, {
      name: publicName,
      endpoint: "ws://127.0.0.1:9944",
      brain: "codex",
      allow: [],
    });
    result = runCli(botsDir, ["model", publicName, "open"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot open model switching for public bot/);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("Paseo private-bot onboarding configures a testnet file-delivery profile", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    let result = runCli(botsDir, ["create", "filebot", "--brain", "echo", "--owner", `0x${ACCOUNT}`, "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    const privateBot = readBot(botsDir, "filebot");
    const privateSecret = JSON.parse(fs.readFileSync(path.join(botsDir, "filebot", "secret.json"), "utf8"));
    assert.equal(privateBot.networkProfile, "paseo");
    assert.deepEqual(privateBot.fileDelivery, { profile: "paseo-next-v2" });
    assert.match(result.stdout, /Testnet file delivery \(optional\):/);
    assert.match(result.stdout, /Bulletin Paseo Next v2/);
    assert.match(result.stdout, /Faucet > Authorize Account/);
    assert.match(result.stdout, /account id: 0x[0-9a-f]{64}/i);
    assert.ok(!result.stdout.includes(privateSecret.seedHex));
    assert.ok(!result.stdout.includes(privateSecret.mnemonic));

    result = runCli(botsDir, ["info", "filebot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HOP delivery enabled/);
    assert.match(result.stdout, /allowance: 5/);

    result = runCli(botsDir, ["deploy", "filebot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_HOP_UPLOAD_NODE=wss:\/\/paseo-hop-next-0\.polkadot\.io$/m);
    assert.match(result.stdout, /^BOT_HOP_ALLOWED_NODES=paseo-hop-next-0\.polkadot\.io,paseo-hop-next-1\.polkadot\.io$/m);

    result = runCli(botsDir, ["create", "publicbot", "--brain", "echo", "--public", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    const publicBot = readBot(botsDir, "publicbot");
    assert.equal(publicBot.networkProfile, "paseo");
    assert.equal("fileDelivery" in publicBot, false);
    assert.match(result.stdout, /outbound file delivery is disabled for this public bot/i);

    result = runCli(botsDir, ["deploy", "publicbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_HOP_UPLOAD_NODE=/);
    assert.doesNotMatch(result.stdout, /BOT_HOP_ALLOWED_NODES=/);

    result = runCli(botsDir, ["create", "openbot", "--brain", "echo", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal("fileDelivery" in readBot(botsDir, "openbot"), false);
    assert.match(result.stdout, /outbound file delivery is disabled for this public bot/i);

    result = runCli(botsDir, ["create", "custombot", "--brain", "echo", "--owner", `0x${ACCOUNT}`, "--network", "wss://people.example.test", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    const customBot = readBot(botsDir, "custombot");
    assert.equal("networkProfile" in customBot, false);
    assert.equal("fileDelivery" in customBot, false);
    assert.doesNotMatch(result.stdout, /Testnet file delivery/);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});
