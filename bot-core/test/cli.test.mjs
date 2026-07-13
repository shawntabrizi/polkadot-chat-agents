import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { entrypointForTransport } from "../lib/transport-entrypoint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "cli.mjs");
const ACCOUNT = "ab".repeat(32);

const runCli = (botsDir, args, extraEnv = {}) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: path.join(HERE, ".."),
  encoding: "utf8",
  env: { ...process.env, ...extraEnv, PCA_BOTS_DIR: botsDir, NO_COLOR: "1" },
});

const writeBot = (botsDir, name, config) => {
  const dir = path.join(botsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(config)}\n`);
  fs.writeFileSync(path.join(dir, "secret.json"), `${JSON.stringify({ seedHex: `0x${"11".repeat(32)}` })}\n`);
};

const readBot = (botsDir, name) => JSON.parse(fs.readFileSync(path.join(botsDir, name, "config.json"), "utf8"));

test("transport entrypoints keep legacy bots on index and route T3ams to its runtime", () => {
  assert.equal(entrypointForTransport("polkadot-app"), "index.mjs");
  assert.equal(entrypointForTransport("t3ams"), "t3ams.mjs");
  assert.throws(() => entrypointForTransport("unknown"), /Unsupported transport entrypoint/);
});

test("private T3ams creation requires and persists a trusted device signing-key pin", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    let result = runCli(botsDir, [
      "create", "pinnedbot", "--brain", "echo", "--transport", "t3ams",
      "--owner", `0x${ACCOUNT}`, "--no-register",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a tagged-CBOR signing-key pin/i);
    assert.equal(fs.existsSync(path.join(botsDir, "pinnedbot")), false);

    result = runCli(botsDir, [
      "create", "pinnedbot", "--brain", "echo", "--transport", "t3ams",
      "--owner", `0x${ACCOUNT}`,
      "--t3ams-peer-key", `0x${ACCOUNT}=11`,
      "--t3ams-display-name", "Pinned Bot",
      "--t3ams-no-auto-accept-workspaces",
      "--no-register",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const config = readBot(botsDir, "pinnedbot");
    assert.deepEqual(config.t3amsTrustedSigningKeys, { [ACCOUNT]: "11" });
    assert.equal(config.t3amsDisplayName, "Pinned Bot");
    assert.equal(config.t3amsAutoAcceptWorkspaces, false);

    result = runCli(botsDir, ["deploy", "pinnedbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_T3AMS_DISPLAY_NAME=Pinned Bot$/m);
    assert.match(result.stdout, /^BOT_T3AMS_AUTO_ACCEPT_WORKSPACES=0$/m);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("create persists the selected transport and deployment passes it to the runtime", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    let result = runCli(botsDir, ["create", "t3amsbot", "--brain", "echo", "--transport", "t3ams", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readBot(botsDir, "t3amsbot").transport, "t3ams");
    assert.match(result.stdout, /Message your bot in T3ams:/);
    assert.match(result.stdout, /no registered DotNS username yet/);
    assert.doesNotMatch(result.stdout, /polkadotapp:\/\//);

    result = runCli(botsDir, ["info", "t3amsbot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Reach this bot in T3ams:/);
    assert.match(result.stdout, /no registered DotNS username yet/);
    assert.doesNotMatch(result.stdout, /polkadotapp:\/\//);

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /command: \["node", "t3ams\.mjs"\]/);

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /T3ams transport requires a local T3ams SDK package/);
    assert.match(result.stderr, /npm install \/path\/to\/t3ams-bcts-\*\.tgz/);

    const moduleOverride = "./vendor/t3ams-bcts.mjs";
    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"], {
      BOT_T3AMS_BCTS_MODULE: moduleOverride,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_T3AMS_BCTS_MODULE=/);

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test"], {
      BOT_T3AMS_BCTS_MODULE: moduleOverride,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /T3ams transport requires a local T3ams SDK package/);

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_TRANSPORT=t3ams$/m);
    assert.match(result.stdout, /command: \["node", "t3ams\.mjs"\]/);

    writeBot(botsDir, "t3amsdirect", {
      name: "t3amsdirect",
      endpoint: "ws://127.0.0.1:9944",
      brain: "codex",
      transport: "t3ams",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "t3amsdirect", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CMD \["node", "t3ams\.mjs"\]/);
    assert.match(result.stdout, /command: \["node", "t3ams\.mjs"\]/);

    writeBot(botsDir, "t3amsharness", {
      name: "t3amsharness",
      endpoint: "ws://127.0.0.1:9944",
      brain: "bridge",
      transport: "t3ams",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "t3amsharness", "--host", "root@example.test", "--harness", "openclaw", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /command: \["node", "t3ams\.mjs"\]/);
    assert.match(result.stdout, /"dmPolicy":"open","allowFrom":\["\*"\]/);

    result = runCli(botsDir, ["deploy", "t3amsharness", "--host", "root@example.test", "--harness", "hermes", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /POLKADOT_ALLOW_ALL_USERS=1/);

    writeBot(botsDir, "t3amslive", {
      name: "t3amslive",
      endpoint: "ws://127.0.0.1:9944",
      brain: "echo",
      transport: "t3ams",
      username: "t3amsagent.42",
      registered: true,
      account: `0x${ACCOUNT}`,
      address: "5FakeT3amsAddress",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["info", "t3amslive"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Search or invite t3amsagent\.42 in T3ams/);
    assert.doesNotMatch(result.stdout, /polkadotapp:\/\//);

    result = runCli(botsDir, ["create", "defaultbot", "--brain", "echo", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readBot(botsDir, "defaultbot").transport, "polkadot-app");

    result = runCli(botsDir, ["deploy", "defaultbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_TRANSPORT=polkadot-app$/m);

    writeBot(botsDir, "legacybot", {
      name: "legacybot",
      endpoint: "ws://127.0.0.1:9944",
      brain: "echo",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "legacybot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_TRANSPORT=polkadot-app$/m);

    result = runCli(botsDir, ["create", "invalidbot", "--transport", "not-a-transport", "--no-register"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--transport must be one of: polkadot-app, t3ams/);
    assert.equal(fs.existsSync(path.join(botsDir, "invalidbot")), false);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

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
    assert.match(result.stdout, /Testnet file delivery:/);
    assert.match(result.stdout, /Bulletin Paseo Next v2/);
    assert.match(result.stdout, /pca storage filebot grant/);
    assert.doesNotMatch(result.stdout, /Faucet > Authorize Account/);
    assert.match(result.stdout, /account id: 0x[0-9a-f]{64}/i);
    assert.ok(!result.stdout.includes(privateSecret.seedHex));
    assert.ok(!result.stdout.includes(privateSecret.mnemonic));

    result = runCli(botsDir, ["info", "filebot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Message this bot in the Polkadot app:/);
    assert.match(result.stdout, /polkadotapp:\/\//);
    assert.match(result.stdout, /HOP delivery enabled/);
    assert.match(result.stdout, /allowance: 5/);
    assert.match(result.stdout, /pca storage filebot status/);
    assert.match(result.stdout, /pca storage filebot grant/);
    const allowanceAddress = /allowance:\s+(\S+)/.exec(result.stdout)?.[1];
    assert.ok(allowanceAddress, "pca info prints the derived allowance address");

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

    result = runCli(botsDir, ["storage", "publicbot"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no managed private Paseo testnet file-delivery profile/);

    const allowanceLock = path.join(
      botsDir,
      `.paseo-file-allowance-${createHash("sha256").update(allowanceAddress).digest("hex")}.lock`,
    );
    fs.writeFileSync(allowanceLock, `${JSON.stringify({ state: "unresolved" })}\n`);
    result = runCli(botsDir, ["storage", "filebot", "grant"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /prior Paseo file allowance submission/);
    assert.match(result.stdout, /pca storage filebot status/);
    assert.match(result.stdout, /pca storage filebot recover/);
    fs.rmSync(allowanceLock);

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
