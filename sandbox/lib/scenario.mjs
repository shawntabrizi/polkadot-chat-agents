// The scenario runner: a scripted conversation between personas and a pca
// bot, run as a test. A scenario module exports `run({ sandbox, pcs, bot, log })`
// and asserts with node:assert; the runner gives it a fresh daemon on random
// ports, a `pcs` that returns parsed JSON, and a `bot` helper that creates
// and runs bots through the real `pca` CLI (create --network sandbox, run),
// then tears everything down — every bot it started is stopped even when the
// scenario throws, so a scenario can never leave an echo bot behind.
//
// The bot is started with `pca run <name>`, the path an operator uses. Its
// pid comes from the bot.pid the runtime writes, so a scenario can kill -9
// the bot itself (not the pca wrapper, which would orphan it) and restart it
// with the same state dir. The runner never reads secret.json.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createExpiry, getStatementSigner, statementCodec } from "@novasamatech/sdk-statement";
import { getPublicKey, secretFromSeed, sign } from "@scure/sr25519";
import { randomBytes } from "@noble/hashes/utils.js";
import WebSocket from "ws";

import { startDaemon } from "../daemon.mjs";
import { bytesToHex } from "./bytes.mjs";

const PCS = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const PCA = fileURLToPath(new URL("../../bot-core/cli.mjs", import.meta.url));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `probe` until it returns a truthy value. */
export async function waitFor(probe, { timeoutMs = 20_000, everyMs = 100, label = "condition" } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= until) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await sleep(everyMs);
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

const exec = (args, { env = {}, cwd } = {}) => new Promise((resolve) => {
  execFile(process.execPath, args, { env: { ...process.env, ...env }, cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
  });
});

/** `pcs <args>` against the daemon, parsed from --json output. Throws on a non-zero exit. */
export const createPcs = (url) => async (...args) => {
  const r = await exec([PCS, "--url", url, "--json", ...args.map(String)]);
  if (r.code !== 0) throw new Error(`pcs ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  try { return JSON.parse(r.stdout); } catch { throw new Error(`pcs ${args.join(" ")} printed non-JSON: ${r.stdout}`); }
};

/** Thin HTTP client on the control API, for reads the CLI does not expose. */
export function createSandboxClient(daemon) {
  const call = async (method, route, body) => {
    const res = await fetch(daemon.url + route, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${data.error}`);
    return data;
  };
  return {
    url: daemon.url,
    storeUrl: daemon.storeUrl,
    daemon,
    get: (route) => call("GET", route),
    post: (route, body) => call("POST", route, body),
    waitFor,
  };
}

// ── What scenarios send that no persona command builds ───────────────────

/**
 * The poison of bot-core's device test client: a richText (kind 15) whose
 * attachment body is junk. Neither the SDK's codec nor bot-core's can read
 * it; both must skip it and keep the rest of the batch.
 */
export const poisonMessage = () => {
  const id = new TextEncoder().encode(crypto.randomUUID());
  return Uint8Array.from([id.length << 2, ...id, ...new Uint8Array(8), 0, 15, 0, 1, 4, 0, 0, 0, 0]);
};

/**
 * A throwaway sr25519 signer for statements built by hand (the node's rules
 * are tested with real proofs). `sign` returns statement hex the store
 * accepts once the account has an allowance (`POST /accounts`).
 */
export const createRawSigner = () => {
  const secret = secretFromSeed(randomBytes(32));
  const publicKey = getPublicKey(secret);
  const signer = getStatementSigner(publicKey, "sr25519", async (data) => sign(secret, data));
  return {
    account: bytesToHex(publicKey),
    /** expiresInSecs: a real expiration (chat clients use 0xffffffff = never). */
    async sign({ channel, topics, expiresInSecs, sequence = 0, data }) {
      const expiry = createExpiry(Math.floor(Date.now() / 1000) + expiresInSecs, sequence);
      const statement = await signer.sign({ expiry, channel, topics, data });
      return `0x${bytesToHex(statementCodec.enc(statement)).slice(2)}`;
    },
  };
};

/** `statement_submit` straight at the store node, bypassing every client-side queue. */
export const submitRaw = (storeUrl, hex) => new Promise((resolve, reject) => {
  const ws = new WebSocket(storeUrl);
  ws.once("error", reject);
  ws.once("open", () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "statement_submit", params: [hex] })));
  ws.once("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    ws.close();
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  });
});

export function createBotHelper({ sandboxUrl, botsDir, log = () => {} }) {
  fs.mkdirSync(botsDir, { recursive: true, mode: 0o700 });
  const baseEnv = { PCA_BOTS_DIR: botsDir, PCA_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };
  const running = new Map(); // name -> handle
  const started = []; // every handle ever started, for diagnostics
  const botDir = (name) => path.join(botsDir, name);

  const pca = async (...args) => {
    const r = await exec([PCA, ...args.map(String)], { env: baseEnv });
    if (r.code !== 0) throw new Error(`pca ${args.join(" ")} failed (${r.code}): ${r.stderr || r.stdout}`);
    return r;
  };

  const readJson = (name, file) => JSON.parse(fs.readFileSync(path.join(botDir(name), file), "utf8"));

  const start = async (name, { env = {}, timeoutMs = 30_000 } = {}) => {
    if (running.has(name)) throw new Error(`${name} is already running`);
    const child = spawn(process.execPath, [PCA, "run", name], { env: { ...process.env, ...baseEnv, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const events = [];
    const listeners = new Set();
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const event = JSON.parse(line);
          events.push(event);
          for (const fn of listeners) fn(event);
        } catch { /* a human line from pca run */ }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

    const handle = {
      name,
      events,
      pid: null,
      exited,
      /** Resolve with the first event matching `pred` (past or future). */
      waitFor(pred, { timeoutMs: waitMs = 20_000, label = "event" } = {}) {
        const hit = events.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            listeners.delete(listener);
            reject(new Error(`${name}: timed out waiting for ${label}; recent events: ${JSON.stringify(events.slice(-8).map((e) => e.event))}`));
          }, waitMs);
          const listener = (event) => { if (pred(event)) { clearTimeout(timer); listeners.delete(listener); resolve(event); } };
          listeners.add(listener);
        });
      },
      /** Signal the BOT process (from its pidfile), then wait for pca run to exit. */
      async stop(signal = "SIGTERM") {
        if (child.exitCode != null || child.signalCode != null) { running.delete(name); return exited; }
        try { process.kill(handle.pid, signal); } catch { child.kill(signal); }
        const result = await Promise.race([exited, sleep(10_000).then(() => null)]);
        if (result == null) {
          try { process.kill(handle.pid, "SIGKILL"); } catch { /* gone */ }
          child.kill("SIGKILL");
          await exited;
        }
        running.delete(name);
        log(`${name} stopped (${signal})`);
        return exited;
      },
    };
    running.set(name, handle);
    started.push(handle);
    try {
      await handle.waitFor((e) => e.event === "BOT_LISTENING", { timeoutMs, label: "BOT_LISTENING" });
      await handle.waitFor((e) => e.event === "BOT_BRIDGE_LISTENING", { timeoutMs, label: "BOT_BRIDGE_LISTENING" });
      handle.pid = Number(fs.readFileSync(path.join(botDir(name), "bot.pid"), "utf8").trim());
      if (!Number.isInteger(handle.pid) || handle.pid <= 0) throw new Error(`${name}: no bot.pid after start`);
    } catch (error) {
      child.kill("SIGKILL");
      running.delete(name);
      throw error;
    }
    log(`${name} running (pid ${handle.pid})`);
    return handle;
  };

  return {
    botsDir,
    pca,
    /** `pca create <name> --network sandbox …` on a free bridge port; returns config.json. */
    async create(name, extra = []) {
      const port = await freePort();
      const r = await pca("create", name, "--network", "sandbox", "--sandbox-url", sandboxUrl, "--port", port, ...extra);
      log(`created ${name}: ${r.stdout.split("\n").find((l) => l.includes("Registered")) ?? "(no registration line)"}`);
      return readJson(name, "config.json");
    },
    config: (name) => readJson(name, "config.json"),
    /** The runtime's session-state.json (0600; it holds session keys, so scenarios only inspect it). */
    state: (name) => readJson(name, "session-state.json"),
    /** The bot's HTTP bridge, as an agent framework drives it. The token never leaves this process. */
    bridge(name) {
      const cfg = readJson(name, "config.json");
      const call = async (route, body) => {
        const res = await fetch(`http://127.0.0.1:${cfg.bridgePort}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.bridgeToken}` }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(`bridge ${route} -> ${res.status} ${data.error}`);
        return data;
      };
      return {
        /** POST /send: a message from the bot to `peer` (a 0x account). */
        send: (peer, text) => call("/send", { chat_id: peer.replace(/^0x/, ""), text }),
      };
    },
    start,
    running: (name) => running.get(name) ?? null,
    /** Recent events of every bot this helper started, newest run last; for failure reports. */
    recentEvents: (n = 12) => started.map((h) => `${h.name}[pid ${h.pid}]: ${h.events.slice(-n).map((e) => e.event + (e.error ? `(${e.error})` : "")).join(" ")}`),
    async stopAll() {
      for (const handle of [...running.values()]) {
        try { await handle.stop("SIGTERM"); } catch { /* best effort */ }
      }
    },
  };
}

/**
 * The opening every bot scenario shares: a persona, an echo bot created and
 * run through pca, the persona's request, the bot's accept and the device
 * fan-out folded into the bot's roster. Resolves once the bot knows every
 * device, with the handles a scenario asserts on.
 */
export async function openChat({ sandbox, pcs, bot }, { user = "alice", devices = 1, name = "echobot", brain = "echo", env = {}, welcome = "hello bot" } = {}) {
  const persona = await pcs("user", "add", user, "--devices", devices);
  const cfg = await bot.create(name, ["--brain", brain, "--public"]);
  const handle = await bot.start(name, { env });
  await handle.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });
  const request = await pcs("request", user, name, "--welcome", welcome);
  await handle.waitFor((e) => e.event === "BOT_RECEIVED_OPENER", { label: "BOT_RECEIVED_OPENER" });
  await sandbox.waitFor(async () => (await pcs("requests", user)).find((r) => r.requestId === request.requestId)?.status === "accepted", { label: `${user} sees the accept` });
  // The persona fans its devices out after the accept; wait until the bot's
  // persisted roster holds all of them, or an early send reaches a subset.
  await sandbox.waitFor(() => { try { return bot.state(name).peers[0]?.devices.length === devices; } catch { return false; } }, { label: `the bot's roster holds ${devices} device(s)` });
  // Everything before this mark is the opening (the opener's own echo included).
  const mark = handle.events.length;
  const inbox = async () => (await pcs("inbox", user, "--peer", name))[0];
  const answers = async () => (await inbox()).messages.filter((m) => m.direction === "incoming" && typeof m.content.text === "string" && m.content.text.startsWith("Echo:"));
  return {
    persona, cfg, bot: handle, request, inbox, answers,
    /** The bot's log events since the chat was open, optionally one event name. */
    events: (event = null) => handle.events.slice(mark).filter((e) => event == null || e.event === event),
    /** A text from the persona's device `device` (default 1); the row as the API returns it. */
    send: (text, device = 1) => sandbox.post(`/personas/${user}/rooms/${name}/messages`, { text, device }),
    /** The bot's answer `text` on every device of the persona, with an ACK from each. */
    answered: (text, on = Array.from({ length: devices }, (_, i) => i + 1)) => sandbox.waitFor(async () => {
      const m = (await answers()).find((x) => x.content.text === text);
      return m && on.every((d) => m.receivedBy.includes(d) && m.ackedBy.includes(d)) ? m : null;
    }, { label: `"${text}" on device(s) ${on.join(",")} with ACKs` }),
    /** The bot ACKed the persona's message: its row is `delivered`. */
    delivered: (messageId) => sandbox.waitFor(async () => (await inbox()).messages.find((m) => m.messageId === messageId)?.status === "delivered", { label: `bot ACK for ${messageId}` }),
    wire: (query = "") => sandbox.get(`/wire?${query}`).then((r) => r.statements),
    history: (channel) => sandbox.get(`/wire/history?channel=${encodeURIComponent(channel)}`).then((r) => r.history),
    slot: (channel) => sandbox.get(`/wire?channel=${encodeURIComponent(channel)}`).then((r) => r.statements[0] ?? null),
  };
}

/**
 * Run one scenario file against a fresh daemon. Resolves with { ms } or
 * rejects with the scenario's assertion error. Everything it started is gone
 * by the time the promise settles.
 */
export async function runScenario(file, { log = () => {} } = {}) {
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  if (typeof mod.run !== "function") throw new Error(`${file} does not export run()`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-scenario-"));
  const daemon = await startDaemon({ dir: path.join(work, "state"), port: 0 });
  const sandbox = createSandboxClient(daemon);
  const pcs = createPcs(daemon.url);
  const bot = createBotHelper({ sandboxUrl: daemon.url, botsDir: path.join(work, "bots"), log });
  const started = Date.now();
  try {
    await mod.run({ sandbox, pcs, bot, log, waitFor, sleep, openChat: (options) => openChat({ sandbox, pcs, bot }, options) });
    return { ms: Date.now() - started };
  } catch (error) {
    error.message += `\nbot events:\n  ${bot.recentEvents().join("\n  ")}`;
    throw error;
  } finally {
    await bot.stopAll();
    await daemon.stop();
    fs.rmSync(work, { recursive: true, force: true });
  }
}
