import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { entrypointForTransport } from "../lib/transport-entrypoint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "cli.mjs");
const T3AMS_BCTS_LOADER = path.join(HERE, "fixtures", "t3ams", "bcts-loader.mjs");
const ACCOUNT = "ab".repeat(32);

import http from "node:http";
import { spawn } from "node:child_process";
// Async twin of runCli for tests that must keep the event loop free (an
// in-process mock server has to answer while the CLI runs).
const runCliAsync = (botsDir, args, extraEnv = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: path.join(HERE, ".."),
    env: { ...process.env, ...extraEnv, PCA_BOTS_DIR: botsDir, NO_COLOR: "1" },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});
const runCli = (botsDir, args, extraEnv = {}, nodeArgs = []) => spawnSync(process.execPath, [...nodeArgs, CLI, ...args], {
  cwd: path.join(HERE, ".."),
  encoding: "utf8",
  env: { ...process.env, ...extraEnv, PCA_BOTS_DIR: botsDir, NO_COLOR: "1" },
});

const currentBotConfig = (name, overrides = {}) => {
  const config = {
    name,
    endpoint: "ws://127.0.0.1:9944",
    backendUrl: "https://backend.example.test",
    brain: "echo",
    transport: "polkadot-app",
    allow: [],
    allowLabels: {},
    bridgePort: 8799,
    bridgeToken: "a-long-enough-bridge-token-for-tests",
    account: `0x${ACCOUNT}`,
    address: "5FakePcaAddress",
    identifierKey: `0x${"11".repeat(32)}`,
    username: null,
    registered: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "allowLabels")) {
    config.allowLabels = Object.fromEntries(config.allow.map((account) => [account, account]));
  }
  return config;
};

const writeBot = (botsDir, name, config) => {
  const dir = path.join(botsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(currentBotConfig(name, config))}\n`);
  fs.writeFileSync(path.join(dir, "secret.json"), `${JSON.stringify({ seedHex: `0x${"11".repeat(32)}` })}\n`);
};

const writeRawBot = (botsDir, name, config) => {
  const dir = path.join(botsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(config)}\n`);
  fs.writeFileSync(path.join(dir, "secret.json"), `${JSON.stringify({ seedHex: `0x${"11".repeat(32)}` })}\n`);
};

const readBot = (botsDir, name) => JSON.parse(fs.readFileSync(path.join(botsDir, name, "config.json"), "utf8"));

test("transport entrypoints route each supported transport to its runtime", () => {
  assert.equal(entrypointForTransport("polkadot-app"), "index.mjs");
  assert.equal(entrypointForTransport("t3ams"), "t3ams.mjs");
  assert.throws(() => entrypointForTransport("unknown"), /Unsupported transport entrypoint/);
});

test("commands require the current config contract without adding defaults", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    const missingTransport = currentBotConfig("missingtransport");
    delete missingTransport.transport;
    writeRawBot(botsDir, "missingtransport", missingTransport);

    let result = runCli(botsDir, ["deploy", "missingtransport", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid config\.json.*transport must be one of/i);
    assert.deepEqual(readBot(botsDir, "missingtransport"), missingTransport);

    const missingToken = currentBotConfig("missingtoken");
    delete missingToken.bridgeToken;
    writeRawBot(botsDir, "missingtoken", missingToken);

    result = runCli(botsDir, ["deploy", "missingtoken", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid config\.json.*bridgeToken must be a 32\+ character secret/i);
    assert.deepEqual(readBot(botsDir, "missingtoken"), missingToken);

    const retiredHermesAlias = currentBotConfig("retiredhermes", { brain: "hermes" });
    writeRawBot(botsDir, "retiredhermes", retiredHermesAlias);
    result = runCli(botsDir, ["info", "retiredhermes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid config\.json.*brain must be one of: echo, claude, codex, opencode, kimi, bridge/i);
    assert.deepEqual(readBot(botsDir, "retiredhermes"), retiredHermesAlias);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("list shows each bot's named or custom network", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    writeBot(botsDir, "custombot", {
      username: "custombot.01",
      registered: true,
    });
    writeBot(botsDir, "devnetbot", {
      username: "devnetbot.01",
      registered: true,
      networkProfile: "devnet",
    });
    writeBot(botsDir, "paseobot", {
      username: "paseobot.01",
      registered: true,
      networkProfile: "paseo",
    });

    const result = runCli(botsDir, ["list"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^NAME\s+USERNAME\s+NETWORK\s+BRAIN\s+WHO CAN MESSAGE IT\s+WHERE$/m);
    assert.match(result.stdout, /^custombot\s+custombot\.01\s+custom\s+echo\s+public\s+local$/m);
    assert.match(result.stdout, /^devnetbot\s+devnetbot\.01\s+devnet\s+echo\s+public\s+local$/m);
    assert.match(result.stdout, /^paseobot\s+paseobot\.01\s+paseo\s+echo\s+public\s+local$/m);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("T3ams deployment preflight accepts an importable BCTS SDK without native-group APIs", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    writeBot(botsDir, "t3amssdk", { transport: "t3ams" });
    const loaderArgs = ["--experimental-loader", T3AMS_BCTS_LOADER];

    let result = runCli(botsDir, ["deploy", "t3amssdk", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /native[ -]?group/i);

    writeBot(botsDir, "t3amsharnesssdk", { brain: "bridge", transport: "t3ams" });
    result = runCli(botsDir, [
      "deploy", "t3amsharnesssdk", "--host", "root@example.test",
      "--harness", "openclaw", "--dry-run",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /native[ -]?group/i);

    const brokenSdk = path.join(botsDir, "broken-bcts.mjs");
    fs.writeFileSync(brokenSdk, "throw new Error('synthetic BCTS import failure');\n");
    const before = readBot(botsDir, "t3amssdk");
    result = runCli(
      botsDir,
      ["deploy", "t3amssdk", "--host", "root@example.test"],
      { PCA_TEST_T3AMS_BCTS_MODULE: pathToFileURL(brokenSdk).href },
      loaderArgs,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not import the local @t3ams\/bcts package required for T3ams deployment/i);
    assert.match(result.stderr, /synthetic BCTS import failure/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Checking root@example\.test|ssh root@example\.test/i);
    assert.deepEqual(readBot(botsDir, "t3amssdk"), before);

    const harnessBefore = readBot(botsDir, "t3amsharnesssdk");
    result = runCli(
      botsDir,
      ["deploy", "t3amsharnesssdk", "--host", "root@example.test", "--harness", "openclaw"],
      { PCA_TEST_T3AMS_BCTS_MODULE: pathToFileURL(brokenSdk).href },
      loaderArgs,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not import the local @t3ams\/bcts package required for T3ams deployment/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Checking root@example\.test|ssh root@example\.test/i);
    assert.deepEqual(readBot(botsDir, "t3amsharnesssdk"), harnessBefore);

    const wrongSdk = path.join(botsDir, "wrong-bcts.mjs");
    fs.writeFileSync(wrongSdk, "export const sdk = 'wrong';\n");
    result = runCli(
      botsDir,
      ["deploy", "t3amssdk", "--host", "root@example.test"],
      { PCA_TEST_T3AMS_BCTS_MODULE: pathToFileURL(wrongSdk).href },
      loaderArgs,
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /incompatible with this T3ams transport/i);
    assert.match(result.stderr, /T3ams SDK contract mismatch at "Envelope"/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Checking root@example\.test|ssh root@example\.test/i);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("private T3ams creation persists a supplied pin and defers a missing one to pca trust", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    // No pin is no longer fatal: the bot parks first contact until the
    // operator approves the presented key with `pca trust`.
    let result = runCli(botsDir, [
      "create", "unpinnedbot", "--brain", "echo", "--transport", "t3ams",
      "--owner", `0x${ACCOUNT}`, "--no-register",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal("t3amsTrustedSigningKeys" in readBot(botsDir, "unpinnedbot"), false);
    assert.match(result.stdout, /pca trust unpinnedbot/);
    assert.match(result.stdout, /derive unscoped topics and be invisible to namespaced app deployments/i);
    assert.match(result.stdout, /Settings → Debug → topic context/);

    result = runCli(botsDir, [
      "create", "pinnedbot", "--brain", "echo", "--transport", "t3ams",
      "--owner", `0x${ACCOUNT}`,
      "--t3ams-peer-key", `0x${ACCOUNT}=11`,
      "--t3ams-namespace", "team-app",
      "--t3ams-display-name", "Pinned Bot",
      "--t3ams-no-auto-accept-workspaces",
      "--no-register",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const config = readBot(botsDir, "pinnedbot");
    assert.deepEqual(config.t3amsTrustedSigningKeys, { [ACCOUNT]: "11" });
    assert.equal(config.t3amsNamespace, "team-app");
    assert.equal(config.t3amsDisplayName, "Pinned Bot");
    assert.equal(config.t3amsAutoAcceptWorkspaces, false);

    result = runCli(botsDir, ["deploy", "pinnedbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_T3AMS_DISPLAY_NAME=Pinned Bot$/m);
    assert.match(result.stdout, /^BOT_T3AMS_TOPIC_NAMESPACE=team-app$/m);
    assert.match(result.stdout, /^BOT_T3AMS_AUTO_ACCEPT_WORKSPACES=0$/m);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("create persists the selected transport and deployment passes it to the runtime", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    let result = runCli(botsDir, ["create", "t3amsbot", "--brain", "echo", "--transport", "t3ams", "--t3ams-namespace", "app", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readBot(botsDir, "t3amsbot").transport, "t3ams");
    assert.equal(readBot(botsDir, "t3amsbot").t3amsNamespace, "app");
    assert.match(result.stdout, /Message your bot in T3ams:/);
    assert.match(result.stdout, /no registered DotNS username yet/);
    assert.doesNotMatch(result.stdout, /polkadotapp:\/\//);

    result = runCli(botsDir, ["info", "t3amsbot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Reach this bot in T3ams:/);
    assert.match(result.stdout, /namespace: app/);
    assert.match(result.stdout, /no registered DotNS username yet/);
    assert.doesNotMatch(result.stdout, /polkadotapp:\/\//);

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /command: \["node", "t3ams\.mjs"\]/);

    const moduleOverride = "./vendor/t3ams-bcts.mjs";
    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"], {
      BOT_T3AMS_BCTS_MODULE: moduleOverride,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_T3AMS_BCTS_MODULE=/);

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_TRANSPORT=t3ams$/m);
    assert.match(result.stdout, /^BOT_T3AMS_TOPIC_NAMESPACE=app$/m);
    assert.match(result.stdout, /command: \["node", "t3ams\.mjs"\]/);

    writeBot(botsDir, "t3amsdirect", {
      name: "t3amsdirect",
      endpoint: "ws://127.0.0.1:9944",
      brain: "claude",
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

    result = runCli(botsDir, ["create", "invalidbot", "--transport", "not-a-transport", "--no-register"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--transport must be one of: polkadot-app, t3ams/);
    assert.equal(fs.existsSync(path.join(botsDir, "invalidbot")), false);

    result = runCli(botsDir, ["create", "blanknamespace", "--transport", "t3ams", "--t3ams-namespace", "   ", "--no-register"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--t3ams-namespace must be non-empty/);
    assert.equal(fs.existsSync(path.join(botsDir, "blanknamespace")), false);

    result = runCli(botsDir, ["create", "wrongtransport", "--t3ams-namespace", "app", "--no-register"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /T3ams namespace.*require --transport t3ams/);
    assert.equal(fs.existsSync(path.join(botsDir, "wrongtransport")), false);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("create writes a per-bot direct-engine persona template once", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-persona-"));
  try {
    const result = runCli(botsDir, ["create", "personabot", "--brain", "codex", "--public", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    const persona = path.join(botsDir, "personabot", "workspace", "PERSONA.md");
    const template = fs.readFileSync(persona, "utf8");
    assert.match(template, /Name or role:/);
    assert.match(template, /Who this bot is for:/);
    assert.match(template, /Tone:/);

    fs.writeFileSync(persona, "# Custom persona\nNever overwrite me.\n");
    const deploy = runCli(botsDir, ["deploy", "personabot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(deploy.status, 0, deploy.stderr);
    assert.equal(fs.readFileSync(persona, "utf8"), "# Custom persona\nNever overwrite me.\n");

    const bridge = runCli(botsDir, ["create", "bridgepersona", "--brain", "bridge", "--public", "--no-register"]);
    assert.equal(bridge.status, 0, bridge.stderr);
    assert.equal(fs.existsSync(path.join(botsDir, "bridgepersona", "workspace", "PERSONA.md")), false);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("T3ams deploys use authenticated bridge health for readiness", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  const bridgeToken = "a-long-enough-bridge-token-for-tests";
  try {
    writeBot(botsDir, "t3amshealth", {
      name: "t3amshealth",
      endpoint: "ws://127.0.0.1:9944",
      brain: "echo",
      transport: "t3ams",
      allow: [],
      bridgePort: 8799,
      bridgeToken,
    });
    let result = runCli(botsDir, ["deploy", "t3amshealth", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /healthcheck:\n      test: \["CMD", "node", "-e", ".*BOT_BRIDGE_TOKEN.*"\]/);
    assert.match(result.stdout, /h\?\.healthy===true.*h\.transport==='t3ams'/);
    assert.doesNotMatch(result.stdout, /h\?\.ok===true.*h\.subscriptions.*>0/);
    assert.match(result.stdout, /interval: 5s\n      timeout: 5s\n      retries: 3\n      start_period: 20s/);
    assert.doesNotMatch(result.stdout, new RegExp(bridgeToken));

    writeBot(botsDir, "plainhealth", {
      name: "plainhealth",
      endpoint: "ws://127.0.0.1:9944",
      brain: "echo",
      transport: "polkadot-app",
      allow: [],
      bridgePort: 8799,
      bridgeToken,
    });
    result = runCli(botsDir, ["deploy", "plainhealth", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /healthcheck:/);

    writeBot(botsDir, "t3amsharnesshealth", {
      name: "t3amsharnesshealth",
      endpoint: "ws://127.0.0.1:9944",
      brain: "bridge",
      transport: "t3ams",
      allow: [],
      bridgePort: 8799,
      bridgeToken,
    });
    result = runCli(botsDir, [
      "deploy", "t3amsharnesshealth", "--host", "root@example.test",
      "--harness", "openclaw", "--dry-run",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /healthcheck:\n      test: \["CMD", "node", "-e", ".*BOT_BRIDGE_TOKEN.*"\]/);
    assert.match(result.stdout, /openclaw:[\s\S]*depends_on:\n      bot:\n        condition: service_healthy/);
    assert.doesNotMatch(result.stdout, new RegExp(bridgeToken));
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("status warns when a deployed T3ams bot reports a different version", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-bin-"));
  try {
    writeBot(botsDir, "oldstatus", {
      transport: "t3ams",
      deploy: { host: "root@example.test", container: "pca-oldstatus" },
    });
    const ssh = path.join(binDir, "ssh");
    fs.writeFileSync(ssh, [
      "#!/bin/sh",
      "printf '%s\\n' 'Up 1 minute (healthy)'",
      "printf '%s\\n' '{\"ok\":true,\"healthy\":true,\"transport\":\"t3ams\",\"version\":\"0.0.0\",\"username\":\"oldstatus\"}'",
      "printf '%s\\n' '\"event\":\"BOT_LISTENING\"'",
      "",
    ].join("\n"));
    fs.chmodSync(ssh, 0o755);

    const result = runCli(botsDir, ["status", "oldstatus"], {
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });
    const localVersion = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")).version;
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /oldstatus · healthy/);
    assert.match(result.stdout, new RegExp(`reports pca 0\\.0\\.0, but this CLI is ${localVersion.replaceAll(".", "\\.")}`));
    assert.match(result.stdout, /Redeploy it/);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
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

test("direct deployment uses one portable tool policy across every direct engine", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    const directBots = [
      ["privateclaude", "claude", [ACCOUNT]],
      ["publicclaude", "claude", []],
      ["publiccodex", "codex", []],
      ["publicopencode", "opencode", []],
      ["publickimi", "kimi", []],
    ];
    for (const [name, brain, allow] of directBots) {
      writeBot(botsDir, name, {
        name,
        endpoint: "ws://127.0.0.1:9944",
        brain,
        allow,
        bridgePort: 8799,
        bridgeToken: "a-long-enough-bridge-token-for-tests",
      });
    }

    for (const [name] of directBots) {
      const result = runCli(botsDir, ["deploy", name, "--host", "root@example.test", "--dry-run"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^BOT_AI_TOOL_CAPABILITIES=$/m);
      assert.match(result.stdout, /^BOT_AI_TOOL_SCOPE=workspace$/m);
      assert.match(result.stdout, /Tool policy: none; scope=workspace\./);
      assert.doesNotMatch(result.stdout, /BOT_AI_TOOL_NETWORK=|BOT_AI_RUNTIME_CONTAINER=|BOT_AI_ALLOWED_TOOLS=|BOT_AI_SAFE_MODE=|BOT_AI_SKIP_PERMISSIONS=|BOT_T3AMS_PUBLIC_ATTACHMENT_READ=|apparmor=|seccomp=|bubblewrap/);
    }

    let result = runCli(botsDir, ["deploy", "privateclaude", "--host", "root@example.test", "--allowed-tools", "write", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_TOOL_CAPABILITIES=read,write$/m);
    assert.match(result.stdout, /^BOT_AI_TOOL_SCOPE=workspace$/m);
    assert.match(result.stdout, /git ca-certificates ripgrep/);
    assert.doesNotMatch(result.stdout, /bubblewrap|socat|util-linux/);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--allowed-tools", "bash", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_TOOL_CAPABILITIES=read,write,bash$/m);
    assert.match(result.stdout, /Bash runs inside this bot's container/i);
    assert.match(result.stdout, /no-new-privileges:true/);
    assert.doesNotMatch(result.stdout, /apparmor=|seccomp=|bubblewrap|prepare-host|cap_drop:/);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--allowed-tools", "bash", "--tool-scope", "container", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_TOOL_SCOPE=container$/m);

    result = runCli(botsDir, ["deploy", "publiccodex", "--host", "root@example.test", "--allowed-tools", "bash", "--tool-scope", "container", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_TOOL_CAPABILITIES=read,write,bash$/m);
    assert.match(result.stdout, /^BOT_AI_TOOL_SCOPE=container$/m);
    assert.doesNotMatch(result.stdout, /apparmor=|seccomp=|bubblewrap/);

    result = runCli(botsDir, ["deploy", "publicopencode", "--host", "root@example.test", "--allowed-tools", "bash", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bash.*container/i);

    for (const [args, pattern] of [
      [["--allowed-tools", "Read"], /unsupported capability/i],
      [["--allowed-tools", "read,read"], /duplicate capability/i],
      [["--allowed-tools", "read,,write"], /empty capability/i],
      [["--tool-network", "internet"], /Unknown flag.*tool-network/i],
      [["--tool-scope", "host"], /must be one of/i],
      [["--safe-tools"], /Unknown flag.*safe-tools/i],
      [["--full-autonomy"], /Unknown flag.*full-autonomy/i],
      [["--attachment-read"], /Unknown flag.*attachment-read/i],
    ]) {
      result = runCli(botsDir, ["deploy", "privateclaude", "--host", "root@example.test", ...args, "--dry-run"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, pattern);
    }

    writeBot(botsDir, "bridgebot", {
      name: "bridgebot",
      endpoint: "ws://127.0.0.1:9944",
      brain: "bridge",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "bridgebot", "--host", "root@example.test", "--harness", "openclaw", "--allowed-tools", "read", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /require a built-in direct engine/i);

    result = runCli(botsDir, ["run", "bridgebot", "--allowed-tools", "read"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bridge has no direct-agent tools/i);
    // --flag=value spelling must behave exactly like --flag value.
    const eqForm = runCli(botsDir, ["run", "bridgebot", "--allowed-tools=read"]);
    assert.equal(eqForm.status, result.status);
    assert.doesNotMatch(eqForm.stderr, /Unknown flag/);
    assert.equal(eqForm.stderr, result.stderr);

    writeBot(botsDir, "publicmedia", {
      name: "publicmedia",
      endpoint: "ws://127.0.0.1:9944",
      brain: "claude",
      transport: "t3ams",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--allowed-tools", "read", "--media-analyzer", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_TOOL_CAPABILITIES=read$/m);
    assert.match(result.stdout, /^BOT_T3AMS_MEDIA_ANALYZER_URL=http:\/\/media-analyzer:8798\/v1\/analyze$/m);
    assert.match(result.stdout, /^BOT_T3AMS_MEDIA_ANALYZER_TOKEN=<hidden>$/m);
    assert.match(result.stdout, /media-analyzer:\n[\s\S]*cap_drop:\n      - ALL/);
    assert.match(result.stdout, /depends_on:\n      media-analyzer:\n        condition: service_healthy/);
    assert.match(result.stdout, /env_file:\n      - \.\/media\.env\n      - \.\/media-token\.env/);
    assert.doesNotMatch(result.stdout, /ANTHROPIC_API_KEY=|BOT_T3AMS_PUBLIC_ATTACHMENT_READ=/);
    const publicMedia = readBot(botsDir, "publicmedia");
    assert.equal(typeof publicMedia.mediaAnalyzerToken, "string");
    assert.ok(publicMedia.mediaAnalyzerToken.length >= 32);
    assert.notEqual(publicMedia.mediaAnalyzerToken, publicMedia.bridgeToken);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--media-analyzer", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a T3ams direct-engine deployment/i);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});
test("Devnet is the default network while Paseo remains a complete named profile", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    let result = runCli(botsDir, ["create", "filebot", "--brain", "echo", "--owner", `0x${ACCOUNT}`, "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    const privateBot = readBot(botsDir, "filebot");
    const privateSecret = JSON.parse(fs.readFileSync(path.join(botsDir, "filebot", "secret.json"), "utf8"));
    assert.equal(privateBot.networkProfile, "devnet");
    assert.equal(privateBot.endpoint, "wss://people-paseo.rotko.net");
    assert.equal(privateBot.backendUrl, "https://polkadot-app.api.polkadotcommunity.foundation");
    assert.deepEqual(privateBot.fileDelivery, { profile: "products-devnet" });
    assert.match(result.stdout, /Testnet file delivery:/);
    assert.match(result.stdout, /Bulletin Products Devnet/);
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
    assert.match(result.stdout, /^BOT_NETWORK_PROFILE=devnet$/m);
    assert.match(result.stdout, /^BOT_HOP_UPLOAD_NODE=wss:\/\/bullet\.sik\.rocks$/m);
    assert.match(result.stdout, /^BOT_HOP_ALLOWED_NODES=bullet\.sik\.rocks,bulletin-paseo\.tservices\.es,bullet\.tunastaking\.eu$/m);

    result = runCli(botsDir, [
      "create", "paseobot", "--brain", "echo", "--owner", `0x${ACCOUNT}`,
      "--network", "paseo", "--no-register",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const paseoBot = readBot(botsDir, "paseobot");
    assert.equal(paseoBot.networkProfile, "paseo");
    assert.equal(paseoBot.endpoint, "wss://paseo-people-next-system-rpc.polkadot.io");
    assert.equal(paseoBot.backendUrl, "https://identity-backend-next.parity-testnet.parity.io");
    assert.deepEqual(paseoBot.fileDelivery, { profile: "paseo-next-v2" });
    assert.match(result.stdout, /Bulletin Paseo Next v2/);

    result = runCli(botsDir, ["deploy", "paseobot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_NETWORK_PROFILE=paseo$/m);
    assert.match(result.stdout, /^BOT_HOP_UPLOAD_NODE=wss:\/\/paseo-hop-next-0\.polkadot\.io$/m);
    assert.match(result.stdout, /^BOT_HOP_ALLOWED_NODES=paseo-hop-next-0\.polkadot\.io,paseo-hop-next-1\.polkadot\.io$/m);

    result = runCli(botsDir, ["info", "paseobot"]);
    assert.equal(result.status, 0, result.stderr);
    const paseoAllowanceAddress = /allowance:\s+(\S+)/.exec(result.stdout)?.[1];
    assert.ok(paseoAllowanceAddress, "Paseo retains its derived allowance account");

    result = runCli(botsDir, ["create", "publicbot", "--brain", "echo", "--public", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    const publicBot = readBot(botsDir, "publicbot");
    assert.equal(publicBot.networkProfile, "devnet");
    assert.equal("fileDelivery" in publicBot, false);
    assert.match(result.stdout, /outbound file delivery is disabled for this public bot/i);

    result = runCli(botsDir, ["deploy", "publicbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_HOP_UPLOAD_NODE=/);
    assert.doesNotMatch(result.stdout, /BOT_HOP_ALLOWED_NODES=/);

    result = runCli(botsDir, ["storage", "publicbot"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no managed private testnet file-delivery profile/);

    const allowanceLock = path.join(
      botsDir,
      `.products-devnet-file-allowance-${createHash("sha256").update(allowanceAddress).digest("hex")}.lock`,
    );
    fs.writeFileSync(allowanceLock, `${JSON.stringify({ state: "unresolved" })}\n`);
    result = runCli(botsDir, ["storage", "filebot", "grant"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /prior Polkadot Products Devnet file allowance submission/);
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

test("help documents automatic default Devnet registration and explicit Paseo fallback", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    const result = runCli(botsDir, ["help"], {
      PCA_IDENTITY_TOKEN: "",
      PCA_IDENTITY_VOUCHER: "",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /devnet \(default\), paseo/);
    assert.match(result.stdout, /Products Devnet registration is automatic/);
    assert.match(result.stdout, /Paseo remains available explicitly with --network paseo/);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("pca t3ams setup validates its target before touching anything", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    // Wrong/missing subcommand and missing path all fail fast with usage hints.
    let result = runCli(botsDir, ["t3ams"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pca t3ams setup <path-to-t3ams-spa>/);

    result = runCli(botsDir, ["t3ams", "setup"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Where is your T3ams SPA checkout/);

    // A directory without the @t3ams/bcts package is rejected by name check,
    // not by guessing from the path shape.
    const notSpa = fs.mkdtempSync(path.join(os.tmpdir(), "pca-not-spa-"));
    try {
      fs.mkdirSync(path.join(notSpa, "packages", "bcts"), { recursive: true });
      fs.writeFileSync(path.join(notSpa, "packages", "bcts", "package.json"), JSON.stringify({ name: "something-else" }));
      result = runCli(botsDir, ["t3ams", "setup", notSpa]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /doesn't look like a T3ams SPA checkout/);
    } finally {
      fs.rmSync(notSpa, { recursive: true, force: true });
    }

    // A real-looking checkout without installed dependencies gets the npm
    // install hint instead of a confusing downstream build failure.
    const spa = fs.mkdtempSync(path.join(os.tmpdir(), "pca-spa-"));
    try {
      fs.mkdirSync(path.join(spa, "packages", "bcts"), { recursive: true });
      fs.writeFileSync(path.join(spa, "packages", "bcts", "package.json"), JSON.stringify({ name: "@t3ams/bcts", version: "0.0.0" }));
      result = runCli(botsDir, ["t3ams", "setup", spa]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /no dependencies installed yet/);
      assert.match(result.stderr, /npm install/);
    } finally {
      fs.rmSync(spa, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("pca trust lists parked T3ams keys and pins exactly the approved one", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  const accountXid = createHash("sha256")
    .update(Buffer.concat([Buffer.from("bcts:xid:v2:acct:"), Buffer.from(ACCOUNT, "hex")]))
    .digest("hex");
  const parkedKey = "aabbccddeeff00112233";
  try {
    writeBot(botsDir, "trustbot", {
      name: "trustbot",
      transport: "t3ams",
      allow: [ACCOUNT],
    });

    // Trust is a T3ams concept; other transports get a clear refusal.
    writeBot(botsDir, "appbot", { name: "appbot", allow: [ACCOUNT] });
    let result = runCli(botsDir, ["trust", "appbot"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a T3ams bot/);

    // Before any DM arrives there is nothing to approve, and that is said.
    result = runCli(botsDir, ["trust", "trustbot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no pin and no pending request yet/);

    // The transport parked a first-contact request (state written by the bot).
    fs.writeFileSync(path.join(botsDir, "trustbot", "t3ams-state.json"), JSON.stringify({
      v: 1,
      t3ams: { pendingTrust: { [accountXid]: [{ keyHex: parkedKey, dataHex: "08", senderName: "Owner", at: 1 }] } },
    }));
    result = runCli(botsDir, ["trust", "trustbot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`key ${parkedKey}`));
    assert.match(result.stdout, /Compare a key/);

    // Approval needs a meaningful prefix and a matching parked entry.
    result = runCli(botsDir, ["trust", "trustbot", `0x${ACCOUNT}`, "aabb"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /first 12 hex characters/);

    result = runCli(botsDir, ["trust", "trustbot", `0x${ACCOUNT}`, "ffffffffffff"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No pending request/);

    result = runCli(botsDir, ["trust", "trustbot", `0x${"cd".repeat(32)}`, parkedKey]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /isn't on "trustbot"'s allowlist/);

    // A 12-char prefix of the parked key approves it and persists the pin.
    result = runCli(botsDir, ["trust", "trustbot", `0x${ACCOUNT}`, parkedKey.slice(0, 12)]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readBot(botsDir, "trustbot").t3amsTrustedSigningKeys, { [ACCOUNT]: parkedKey });
    assert.match(result.stdout, /Restart the bot/);

    // Re-approving is idempotent; a different key is a deliberate rotation.
    result = runCli(botsDir, ["trust", "trustbot", `0x${ACCOUNT}`, parkedKey]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already pinned/);

    result = runCli(botsDir, ["trust", "trustbot", `0x${ACCOUNT}`, "ffffffffffff"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Key rotation is deliberate/);

    // The pinned account now shows as such, and run/deploy would see the pin.
    result = runCli(botsDir, ["trust", "trustbot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /signing key pinned/);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

// npm's min-release-age silently installs an older version than `latest`, so
// pca itself has to say when a newer release exists.
test("pca --version notes a newer registry release, and stays quiet otherwise", async () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  let served = "99.0.0";
  const server = http.createServer((req, res) => {
    if (req.url !== "/polkadot-chat-agents/latest") { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: served }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const registry = `http://127.0.0.1:${server.address().port}`;
  try {
    const env = { PCA_REGISTRY_URL: registry, CI: "" };
    let result = await runCliAsync(botsDir, ["--version"], env);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /newer release is available: 99\.0\.0/);
    assert.match(result.stdout, /min-release-age=0/, "names the npm setting that hides new releases");

    served = "0.0.1"; // registry behind the local checkout: nothing to say
    result = await runCliAsync(botsDir, ["--version"], env);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /newer release/);

    served = "99.0.0";
    result = await runCliAsync(botsDir, ["--version"], { ...env, PCA_NO_UPDATE_CHECK: "1" });
    assert.doesNotMatch(result.stdout, /newer release/, "opt-out is honored");
    result = await runCliAsync(botsDir, ["--version"], { ...env, CI: "true" });
    assert.doesNotMatch(result.stdout, /newer release/, "quiet in CI");

    // An unreachable registry must never break or slow the command down much.
    const started = Date.now();
    result = await runCliAsync(botsDir, ["--version"], { PCA_REGISTRY_URL: "http://127.0.0.1:9", CI: "" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split("\n")[0].length > 0, true);
    assert.doesNotMatch(result.stdout, /newer release/);
    assert.ok(Date.now() - started < 10_000);
  } finally {
    server.close();
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

test("pca logs reads the local bot.log that pca run keeps", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    let result = runCli(botsDir, ["create", "loggy", "--brain", "echo", "--no-register"]);
    assert.equal(result.status, 0, result.stderr);
    result = runCli(botsDir, ["logs", "loggy"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No local log for "loggy" yet/);
    assert.match(result.stderr, /pca run loggy/);

    const file = path.join(botsDir, "loggy", "bot.log");
    fs.writeFileSync(file, ["one", "two", "three"].map((l) => JSON.stringify({ event: l })).join("\n") + "\n");
    result = runCli(botsDir, ["logs", "loggy", "--tail", "2"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n").map((l) => JSON.parse(l).event), ["two", "three"]);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});

// A bot created for the local sandbox registers through its directory (no
// proof, no identity backend) and runs against its store node over ws://.
test("create --network sandbox registers through the sandbox directory and runs against its store node", async () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  const registered = new Map(); // account -> entry, what the sandbox directory would hold
  const server = http.createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/api/node") return reply(200, { url: "ws://127.0.0.1:1" });
    if (req.method === "POST" && req.url === "/api/accounts/register") {
      let raw = "";
      req.on("data", (d) => { raw += d; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        if ([...registered.values()].some((e) => e.username === body.username)) return reply(409, { error: `username taken: ${body.username}` });
        registered.set(body.account, body);
        reply(200, body);
      });
      return undefined;
    }
    const consumer = /^\/api\/consumers\/(0x[0-9a-f]{64})$/.exec(req.url ?? "");
    if (req.method === "GET" && consumer) return registered.has(consumer[1]) ? reply(200, registered.get(consumer[1])) : reply(404, { error: "no consumer" });
    const username = /^\/api\/usernames\/(.+)$/.exec(req.url ?? "");
    if (req.method === "GET" && username) {
      const entry = [...registered.values()].find((e) => e.username === decodeURIComponent(username[1]));
      return entry ? reply(200, entry) : reply(404, { error: "no username" });
    }
    return reply(404, { error: `no route ${req.method} ${req.url}` });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const sandboxUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    let result = await runCliAsync(botsDir, ["create", "sandboxbot", "--brain", "echo", "--network", "sandbox", "--sandbox-url", sandboxUrl]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Registering your bot in the sandbox/);
    assert.match(result.stdout, /Registered as sandboxbot/);
    assert.match(result.stdout, /Confirmed — your bot is live/);
    const bot = readBot(botsDir, "sandboxbot");
    assert.equal(bot.networkProfile, "sandbox");
    assert.equal(bot.endpoint, "ws://127.0.0.1:1", "the store node the daemon reported");
    assert.equal(bot.backendUrl, sandboxUrl, "the control API doubles as identity backend and directory");
    assert.deepEqual([bot.username, bot.registered], ["sandboxbot", true]);
    assert.equal("fileDelivery" in bot, false, "no Bulletin/HOP network in the sandbox yet");
    const entry = registered.get(bot.account);
    assert.ok(entry, "the bot's account was registered");
    assert.equal(entry.identifierKey, bot.identifierKey);
    assert.equal(entry.identifierKey.length, 2 + 65 * 2, "the 65-byte RFC-0004 container");
    const secret = JSON.parse(fs.readFileSync(path.join(botsDir, "sandboxbot", "secret.json"), "utf8"));
    assert.ok(!result.stdout.includes(secret.seedHex) && !result.stdout.includes(secret.mnemonic));

    // A second bot cannot take the username; the failure is friendly and resumable.
    result = await runCliAsync(botsDir, ["create", "secondbot", "--brain", "echo", "--network", "sandbox", "--sandbox-url", sandboxUrl, "--username", "sandboxbot"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /username taken: sandboxbot/);
    assert.match(result.stdout, /pca register secondbot/);
    assert.doesNotMatch(result.stdout + result.stderr, /at .*\.mjs:\d+/, "no stack trace");
    // A requested number is checked against the directory before any key is made.
    result = await runCliAsync(botsDir, ["create", "sandboxbot.42", "--brain", "echo", "--network", "sandbox", "--sandbox-url", sandboxUrl]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readBot(botsDir, "sandboxbot.42").username, "sandboxbot.42");
    result = await runCliAsync(botsDir, ["create", "thirdbot", "--brain", "echo", "--network", "sandbox", "--sandbox-url", sandboxUrl, "--username", "sandboxbot", "--digits", "42"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sandboxbot\.42 is already taken/);
    assert.equal(fs.existsSync(path.join(botsDir, "thirdbot")), false);

    // info needs no network for a confirmed bot; run/deploy hand the runtime the directory URL.
    result = await runCliAsync(botsDir, ["info", "sandboxbot"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /live — people can message it/);
    assert.match(result.stdout, /network:\s+ws:\/\/127\.0\.0\.1:1/);
    result = await runCliAsync(botsDir, ["deploy", "sandboxbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_NETWORK_PROFILE=sandbox$/m);
    assert.match(result.stdout, new RegExp(`^BOT_SANDBOX_URL=${sandboxUrl.replace(/[.]/g, "\\.")}$`, "m"));
    assert.match(result.stdout, /^BOT_ENDPOINT=ws:\/\/127\.0\.0\.1:1$/m);

    // No daemon: a clear failure before any key is generated; ws:// stays sandbox-only.
    result = await runCliAsync(botsDir, ["create", "nodaemon", "--brain", "echo", "--network", "sandbox", "--sandbox-url", "http://127.0.0.1:9"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No sandbox at http:\/\/127\.0\.0\.1:9/);
    assert.match(result.stderr, /pcs up/);
    assert.equal(fs.existsSync(path.join(botsDir, "nodaemon")), false);
    result = await runCliAsync(botsDir, ["create", "insecure", "--brain", "echo", "--endpoint", "ws://127.0.0.1:1", "--no-register"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /credential-free wss:\/\//);
    result = await runCliAsync(botsDir, ["create", "misflag", "--brain", "echo", "--sandbox-url", sandboxUrl, "--no-register"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--sandbox-url only applies with --network sandbox/);
  } finally {
    server.close();
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});
