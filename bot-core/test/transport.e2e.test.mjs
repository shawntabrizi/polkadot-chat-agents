// Offline transport e2e: bot-core + test-client-device against the in-memory
// mock statement node. No chain, no network — the identifier lookup is pinned
// via BOT_PEER_IDENTIFIER_KEYS, everything else is the real stack (vendored
// codec, sessions, dedup, persistence, ACKs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startMockStatementNode } from "./mock-statement-node.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { deriveP256PrivateKey, p256PublicKeyFromPrivateKey } from "../vendor/app-chat-codec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT_CORE = path.join(HERE, "..");
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => Uint8Array.from(String(h).replace(/^0x/i, "").match(/../g).map((b) => parseInt(b, 16)));

// Deterministic throwaway identities (never touch a real network).
const BOT_SEED = `0x${"22".repeat(32)}`;
const CLIENT_SEED = `0x${"11".repeat(32)}`;
const idKeyOf = (seedHex) =>
  bytesToHex(p256PublicKeyFromPrivateKey(deriveP256PrivateKey(deriveSr25519PairFromSeed(hexToBytes(seedHex), "//wallet//chat"))));
const accountOf = (seedHex) => bytesToHex(deriveSr25519PairFromSeed(hexToBytes(seedHex), "//wallet").publicKey);
const BOT_ACCOUNT = accountOf(BOT_SEED);
const BOT_ID_KEY = idKeyOf(BOT_SEED);
const CLIENT_ACCOUNT = accountOf(CLIENT_SEED);
const CLIENT_ID_KEY = idKeyOf(CLIENT_SEED);

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// Spawn the bot and expose its JSON-line events for assertions.
async function startBot({ endpoint, stateDir, extraEnv = {} }) {
  const bridgePort = await freePort();
  const child = spawn(process.execPath, [path.join(BOT_CORE, "index.mjs")], {
    env: {
      ...process.env,
      BOT_SEED_HEX: BOT_SEED,
      BOT_ENDPOINT: endpoint,
      BOT_BRIDGE_PORT: String(bridgePort),
      BOT_STATE_DIR: stateDir,
      BOT_BRAIN: "echo",
      BOT_USERNAME: "e2etest.00",
      BOT_POLL_MS: "250",
      BOT_PEER_IDENTIFIER_KEYS: `${CLIENT_ACCOUNT}=${CLIENT_ID_KEY}`,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const events = [];
  const listeners = new Set();
  let buffer = "";
  const onData = (d) => {
    buffer += d;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      try {
        const ev = JSON.parse(line);
        events.push(ev);
        for (const l of listeners) l(ev);
      } catch { /* non-JSON line */ }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const bot = {
    child,
    events,
    // Resolve when an event matching pred arrives (or already arrived).
    waitFor(pred, { timeoutMs = 15_000, label = "event" } = {}) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(l); reject(new Error(`timed out waiting for ${label}`)); }, timeoutMs);
        const l = (ev) => { if (pred(ev)) { clearTimeout(timer); listeners.delete(l); resolve(ev); } };
        listeners.add(l);
      });
    },
    stop(signal = "SIGTERM") {
      return new Promise((resolve) => {
        if (child.exitCode != null) return resolve();
        child.once("exit", resolve);
        child.kill(signal);
      });
    },
  };
  await bot.waitFor((e) => e.event === "BOT_LISTENING", { label: "BOT_LISTENING" });
  return bot;
}

// Run the device-channel client; returns { code, out }.
function runClient(endpoint, extraArgs, texts) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(BOT_CORE, "test-client-device.mjs"),
      "--seed-hex", CLIENT_SEED,
      "--bot-account", `0x${BOT_ACCOUNT}`,
      "--bot-identifier-key", `0x${BOT_ID_KEY}`,
      "--endpoint", endpoint,
      "--wait-secs", "8",
      ...extraArgs, ...texts,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (code) => resolve({ code, out }));
  });
}

const tmpState = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-e2e-"));

// The transport matrix runs the same scenarios in both ingress modes.
for (const [mode, extraEnv] of [
  ["poll", { BOT_SUBSCRIBE: "0" }],
  ["subscribe", { BOT_SUBSCRIBE: "1" }],
]) {
  test(`round trip with poison batches (${mode})`, async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({ endpoint: node.url, stateDir, extraEnv });
    try {
      // In subscribe mode the sweep only runs every 30s, so replies inside the
      // client's 8s windows can only have arrived by subscription — but assert
      // the mode explicitly too.
      if (extraEnv.BOT_SUBSCRIBE === "1") await bot.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });
      const r = await runClient(node.url, [], ["hello opener", "follow-one", "follow-two"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      assert.match(r.out, /Echo: hello opener/);
      assert.match(r.out, /Echo: follow-one/);
      assert.match(r.out, /Echo: follow-two/);
      // Every follow-up request must be ACKed despite the poison message.
      assert.equal((r.out.match(/\[ACK\]/g) ?? []).length >= 2, true, `missing ACKs:\n${r.out}`);
      if (extraEnv.BOT_SUBSCRIBE === "1") {
        // The startup heartbeat has fired by now; a malformed heartbeat would
        // show up as a submit failure and a recovery loop.
        const hbFailures = bot.events.filter((e) => e.event === "BOT_STATEMENT_INGRESS_HEARTBEAT_SUBMIT_FAILED");
        assert.deepEqual(hbFailures, [], "heartbeat submissions failed");
      }
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test(`restart survival: session + dedup persist (${mode})`, async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    let bot = await startBot({ endpoint: node.url, stateDir, extraEnv });
    try {
      const first = await runClient(node.url, [], ["restart opener", "before-restart"]);
      assert.equal(first.code, 0, `client failed:\n${first.out}`);
      await bot.stop(); // SIGTERM: flushes state, removes pidfile

      bot = await startBot({ endpoint: node.url, stateDir, extraEnv });
      const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.peers, 1);
      // Old statements are still in the store; none may be re-answered.
      const second = await runClient(node.url, ["--no-opener", "1"], ["after-restart"]);
      assert.equal(second.code, 0, `client failed:\n${second.out}`);
      assert.match(second.out, /Echo: after-restart/);
      const reanswered = bot.events.filter((e) => e.event === "BOT_RECEIVED_TEXT" && e.text !== "after-restart");
      assert.deepEqual(reanswered, [], `re-answered old messages: ${JSON.stringify(reanswered)}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test(`owed reply survives kill -9 mid-brain (${mode})`, async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const slowBrain = {
      ...extraEnv,
      BOT_BRAIN: "claude", // any AI brain; the CLI is overridden below
      BOT_AI_CMD: "sh",
      BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3 && echo recovered-answer"]),
      BOT_THINKING_TEXT: "", // keep the send log unambiguous
    };
    let bot = await startBot({ endpoint: node.url, stateDir, extraEnv: slowBrain });
    try {
      // Establish the session (the client's exit-0 rule needs at least one
      // ACKed follow-up, so warm up with one; each reply takes ~3s).
      const opener = await runClient(node.url, [], ["owed opener", "warmup"]);
      assert.equal(opener.code, 0, `client failed:\n${opener.out}`);

      // Send a follow-up, kill the bot the moment it's ACKed but before the
      // 3s brain finishes — the reply now exists only in the owed journal.
      const clientDone = runClient(node.url, ["--no-opener", "1"], ["crash question"]);
      await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.text === "crash question", { label: "crash question received" });
      await bot.stop("SIGKILL");
      await clientDone;

      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      assert.equal(state.owed?.some((o) => o.t === "crash question"), true, "owed journal missing the question");

      bot = await startBot({ endpoint: node.url, stateDir, extraEnv: slowBrain });
      const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.owed >= 1, true, `expected owed >= 1, got ${restored.owed}`);
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT", { label: "owed reply sent", timeoutMs: 20_000 });
      // The reply reached the store: the mock holds a statement the client can decode.
      const replies = await runClient(node.url, ["--no-opener", "1"], ["post-crash ping"]);
      assert.match(replies.out, /recovered-answer/, `owed reply not observed:\n${replies.out}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
}
