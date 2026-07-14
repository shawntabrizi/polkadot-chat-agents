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
const HAS_LOCAL_T3AMS_SDK = fs.existsSync(
  path.join(HERE, "..", "node_modules", "@t3ams", "bcts", "package.json"),
);

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

    const moduleOverride = "./vendor/t3ams-bcts.mjs";
    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"], {
      BOT_T3AMS_BCTS_MODULE: moduleOverride,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_T3AMS_BCTS_MODULE=/);

    // The repository deliberately installs BCTS from a local tarball. Exercise
    // the missing-SDK guard only in a checkout where that optional package is
    // absent; a developer checkout with it present must not try real SSH just
    // to assert a condition that cannot occur there.
    if (!HAS_LOCAL_T3AMS_SDK) {
      result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /T3ams transport requires a local T3ams SDK package/);
      assert.match(result.stderr, /npm install \/path\/to\/t3ams-bcts-\*\.tgz/);

      result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test"], {
        BOT_T3AMS_BCTS_MODULE: moduleOverride,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /T3ams transport requires a local T3ams SDK package/);
    }

    result = runCli(botsDir, ["deploy", "t3amsbot", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_TRANSPORT=t3ams$/m);
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
    assert.match(result.stdout, /h\?\.ok===true.*h\.transport==='t3ams'.*h\.subscriptions.*>0/);
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

test("direct deployment defaults to no tools and makes private tool access explicit", () => {
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-cli-"));
  try {
    writeBot(botsDir, "privateclaude", {
      name: "privateclaude",
      endpoint: "ws://127.0.0.1:9944",
      brain: "claude",
      allow: [ACCOUNT],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    let result = runCli(botsDir, ["deploy", "privateclaude", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_AI_SKIP_PERMISSIONS=/);
    assert.doesNotMatch(result.stdout, /BOT_AI_ALLOWED_TOOLS=/);

    result = runCli(botsDir, ["deploy", "privateclaude", "--host", "root@example.test", "--safe-tools", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_ALLOWED_TOOLS=Bash,Read,Edit,Write/);
    assert.match(result.stdout, /BOT_AI_SAFE_MODE=1/);
    assert.doesNotMatch(result.stdout, /BOT_AI_SKIP_PERMISSIONS=/);

    result = runCli(botsDir, ["deploy", "privateclaude", "--host", "root@example.test", "--allowed-tools", "Read", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_ALLOWED_TOOLS=Read/);

    result = runCli(botsDir, ["deploy", "privateclaude", "--host", "root@example.test", "--full-autonomy", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_SKIP_PERMISSIONS=1/);
    assert.doesNotMatch(result.stdout, /BOT_AI_ALLOWED_TOOLS=/);

    writeBot(botsDir, "publicclaude", {
      name: "publicclaude",
      endpoint: "ws://127.0.0.1:9944",
      brain: "claude",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BOT_AI_SKIP_PERMISSIONS=/);
    assert.doesNotMatch(result.stdout, /BOT_AI_ALLOWED_TOOLS=/);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--safe-tools", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_ALLOWED_TOOLS=Bash,Read,Edit,Write/);
    assert.match(result.stdout, /BOT_AI_SAFE_MODE=1/);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--allowed-tools", "Read,Edit,Write", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_ALLOWED_TOOLS=Read,Edit,Write/);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--full-autonomy", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOT_AI_SKIP_PERMISSIONS=1/);

    writeBot(botsDir, "publiccodex", {
      name: "publiccodex",
      endpoint: "ws://127.0.0.1:9944",
      brain: "codex",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "publiccodex", "--host", "root@example.test", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Public direct deployment currently supports only Claude/);

    writeBot(botsDir, "publicmedia", {
      name: "publicmedia",
      endpoint: "ws://127.0.0.1:9944",
      brain: "claude",
      transport: "t3ams",
      allow: [],
      bridgePort: 8799,
      bridgeToken: "a-long-enough-bridge-token-for-tests",
    });
    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--media-analyzer", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_T3AMS_MEDIA_ANALYZER_URL=http:\/\/media-analyzer:8798\/v1\/analyze$/m);
    assert.match(result.stdout, /^BOT_T3AMS_MEDIA_ANALYZER_TOKEN=<hidden>$/m);
    assert.match(result.stdout, /media-analyzer:\n[\s\S]*cap_drop:\n      - ALL/);
    assert.match(result.stdout, /depends_on:\n      media-analyzer:\n        condition: service_healthy/);
    assert.match(result.stdout, /env_file:\n      - \.\/media\.env\n      - \.\/media-token\.env/);
    assert.doesNotMatch(result.stdout, /ANTHROPIC_API_KEY=/);
    const publicMedia = readBot(botsDir, "publicmedia");
    assert.equal(typeof publicMedia.mediaAnalyzerToken, "string");
    assert.ok(publicMedia.mediaAnalyzerToken.length >= 32);
    assert.notEqual(publicMedia.mediaAnalyzerToken, publicMedia.bridgeToken);

    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--attachment-read", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_T3AMS_PUBLIC_ATTACHMENT_READ=1$/m);
    assert.match(result.stdout, /^BOT_AI_ALLOWED_TOOLS=Read$/m);
    assert.doesNotMatch(result.stdout, /media-analyzer:\n/);

    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--safe-tools", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_ALLOWED_TOOLS=Bash,Read,Edit,Write$/m);
    assert.match(result.stdout, /^BOT_AI_SAFE_MODE=1$/m);

    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--full-autonomy", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BOT_AI_SKIP_PERMISSIONS=1$/m);

    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--attachment-read", "--safe-tools", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot be combined with --safe-tools/i);

    result = runCli(botsDir, ["deploy", "publicmedia", "--host", "root@example.test", "--attachment-read", "--media-analyzer", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose one attachment analysis route/i);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--attachment-read", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a public T3ams Claude direct-engine deployment/i);

    result = runCli(botsDir, ["deploy", "publicclaude", "--host", "root@example.test", "--media-analyzer", "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a T3ams direct-engine deployment/);
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
