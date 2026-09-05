// Offline transport e2e: bot-core against the local sandbox
// (sandbox/daemon.mjs): its store node plays the statement store, its
// directory plays the People chain (identifier keys come through the same
// seam a deployed bot uses, lib/people-directory.mjs), its HOP node plays
// the Bulletin network, and a persona — a user on Polkadot Desktop's SDK,
// with a device whose statement account differs from its identity account,
// as a phone's does — plays the peer. No chain, no network — everything
// else is the real stack (vendored codec, sessions, dedup, persistence,
// ACKs, HOP uploads and downloads).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startDaemon } from "../../sandbox/daemon.mjs";
import { poisonMessage } from "../../sandbox/lib/scenario.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import {
  deriveX25519PrivateKey,
  encodeAccountEcdhKey,
  x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT_CORE = path.join(HERE, "..");
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => Uint8Array.from(String(h).replace(/^0x/i, "").match(/../g).map((b) => parseInt(b, 16)));

// Fixed throwaway seed for the bot; the peer is a persona minted per test.
const BOT_SEED = `0x${"22".repeat(32)}`;
const idKeyOf = (seedHex) =>
  bytesToHex(encodeAccountEcdhKey(x25519PublicKeyFromPrivateKey(deriveX25519PrivateKey(hexToBytes(seedHex)))));
const accountOf = (seedHex) => bytesToHex(deriveSr25519PairFromSeed(hexToBytes(seedHex), "//wallet").publicKey);
const BOT_ACCOUNT = accountOf(BOT_SEED);
const BOT_ID_KEY = idKeyOf(BOT_SEED);
const BOT_USERNAME = "e2etest.00";
// The bot's upload signer: registered with the identity so the sandbox's
// HOP node grants it the Bulletin allowance (what `pca create` does).
const BOT_BULLETIN_ACCOUNT = bytesToHex(deriveSr25519PairFromSeed(hexToBytes(BOT_SEED), "//allowance//bulletin//chat").publicKey);
const TEST_BRIDGE_TOKEN = "transport-e2e-bridge-token-0123456789";
// A 1×1 PNG: a real image header, so the bot's fileKind is `image`.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (probe, { timeoutMs = 20_000, everyMs = 100, label = "condition" } = {}) => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= until) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await sleep(everyMs);
  }
};

// One sandbox per test: a store node, a HOP node and the directory, on
// random ports, with the bot registered (username, identifier key,
// statement allowance, Bulletin allowance). `url` is the store node the bot
// connects to.
async function startSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-e2e-sandbox-"));
  const daemon = await startDaemon({ dir, port: 0 });
  const res = await fetch(`${daemon.url}/api/accounts/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: `0x${BOT_ACCOUNT}`, username: BOT_USERNAME, identifierKey: `0x${BOT_ID_KEY}`, bulletinAccount: `0x${BOT_BULLETIN_ACCOUNT}` }),
  });
  if (!res.ok) throw new Error(`register ${BOT_USERNAME}: ${res.status} ${await res.text()}`);
  return {
    url: daemon.storeUrl,
    apiUrl: daemon.url,
    hopUrl: daemon.hopUrl,
    daemon,
    dir,
    async close() {
      await daemon.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Spawn the bot and expose its JSON-line events for assertions.
async function startBot({ endpoint, apiUrl, stateDir, extraEnv = {} }) {
  const bridgeToken = extraEnv.BOT_BRIDGE_TOKEN ?? TEST_BRIDGE_TOKEN;
  const child = spawn(process.execPath, [path.join(BOT_CORE, "index.mjs")], {
    env: {
      ...process.env,
      BOT_SEED_HEX: BOT_SEED,
      BOT_NETWORK_PROFILE: "sandbox",
      BOT_SANDBOX_URL: apiUrl,
      BOT_ENDPOINT: endpoint,
      // Port 0: the OS assigns a free one (tests run concurrently, so a
      // pick-then-bind helper would race); BOT_BRIDGE_LISTENING reports it.
      BOT_BRIDGE_PORT: "0",
      BOT_BRIDGE_TOKEN: bridgeToken,
      BOT_STATE_DIR: stateDir,
      BOT_BRAIN: "echo",
      BOT_USERNAME,
      BOT_POLL_MS: "250",
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
    bridgePort: 0, // set below once BOT_BRIDGE_LISTENING reports the bound port
    bridgeToken,
    // Resolve when an event matching pred arrives (or already arrived).
    waitFor(pred, { timeoutMs = 15_000, label = "event" } = {}) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(l);
          reject(new Error(`timed out waiting for ${label}; recent events: ${JSON.stringify(events.slice(-12))}`));
        }, timeoutMs);
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
  const bridge = await bot.waitFor((e) => e.event === "BOT_BRIDGE_LISTENING", { label: "BOT_BRIDGE_LISTENING" });
  bot.bridgePort = bridge.port;
  return bot;
}

// A persona through the daemon's API, as `pcs` drives it: the phone's role
// on the SDK behind Polkadot Desktop. Its device signs statements with its
// own account (not the identity account) and encrypts with its own key, so
// the bot's per-device session polling is exercised for real. Every method
// returns the row the API returns; reads come from the persona's room with
// the bot.
async function startPersona(node, { name = "alice", devices = 1 } = {}) {
  const api = async (method, route, body) => {
    const res = await fetch(`${node.apiUrl}/api${route}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${data.error}`);
    return data;
  };
  const persona = await api("POST", "/personas", { name, devices });
  const room = (query = "") => api("GET", `/personas/${name}/rooms/${BOT_USERNAME}${query}`);
  const messages = async () => (await room()).messages;
  const post = (body) => api("POST", `/personas/${name}/rooms/${BOT_USERNAME}/messages`, body);
  const incoming = async () => (await messages()).filter((m) => m.direction === "incoming");
  return {
    name,
    /** The identity account (0x-hex); bot-core keys peers by it. */
    account: persona.account,
    /** The same without the prefix, as the bridge's chat_id and the vault path spell it. */
    accountHex: persona.account.slice(2),
    devices: persona.devices,
    api,
    /** Open the chat with a welcome text and wait for the bot's accept. */
    async open(welcome) {
      const r = await api("POST", `/personas/${name}/requests`, { to: BOT_USERNAME, welcome });
      await waitFor(async () => (await api("GET", `/personas/${name}/requests`)).find((x) => x.requestId === r.requestId)?.status === "accepted", { label: "the bot's accept" });
      return r;
    },
    /** A text (or a reply quoting `replyTo`) on the device session; resolves with the row. */
    send: (text, { device = 1, replyTo = null } = {}) => post({ text, replyTo, device }),
    /** Raw message bytes into the batch: an undecodable message next to good ones. */
    sendRaw: (bytes, { device = 1 } = {}) => post({ raw: `0x${bytesToHex(bytes)}`, device }),
    /** A file through the sandbox's HOP node (the desktop's upload path), with an optional caption. */
    attach: (file, text = null, { device = 1 } = {}) => post({ file, text, device }),
    react: (messageId, emoji, { device = 1 } = {}) => post({ react: { messageId, emoji, add: true }, device }),
    call: ({ device = 1 } = {}) => post({ call: true, device }),
    messages,
    incoming,
    /** The first incoming row matching `pred`, as soon as it exists. */
    reply: (pred, { timeoutMs = 20_000, label = "a reply" } = {}) => waitFor(async () => (await incoming()).find(pred), { timeoutMs, label }),
    /** The bot ACKed the message: its row is `delivered`. */
    delivered: (messageId, { timeoutMs = 20_000 } = {}) => waitFor(async () => (await messages()).find((m) => m.messageId === messageId)?.status === "delivered", { timeoutMs, label: `the bot's ACK of ${messageId}` }),
    /** The row by id (any direction). */
    row: async (messageId) => (await messages()).find((m) => m.messageId === messageId) ?? null,
    /** The persona never ACKs the bot again: the node drops every ACK its device would send (a peer that never fetches). */
    async neverAck() {
      for (const channel of [`session ${name}#1→${BOT_USERNAME} /response`, `identity ${name}→${BOT_USERNAME} /response`]) {
        await api("POST", "/faults", { kind: "drop", from: name, channel, count: null });
      }
    },
  };
}

const tmpState = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-e2e-"));
const tmpFile = (dir, name, bytes) => { const file = path.join(dir, name); fs.writeFileSync(file, bytes); return file; };
const textOf = (m) => (typeof m.content.text === "string" ? m.content.text : "");

// Every test is self-contained (own sandbox, own bot process, own state
// dir, OS-assigned ports), and the suite is sleep-dominated — so run them
// concurrently. 8 keeps the process count tame.
describe("transport e2e", { concurrency: 8 }, () => {

  test("public built-in direct brains start without an allowlist", async () => {
    const node = await startSandbox();
    const bots = [];
    const stateDirs = [];
    try {
      for (const brain of ["codex", "opencode"]) {
        const stateDir = tmpState();
        stateDirs.push(stateDir);
        const bot = await startBot({
          endpoint: node.url, apiUrl: node.apiUrl,
          stateDir,
          extraEnv: {
            BOT_SUBSCRIBE: "0",
            BOT_BRAIN: brain,
            BOT_ALLOWED_PEERS: "",
            BOT_AI_CMD: "",
            BOT_AI_ARGS: "",
            BOT_AI_ALLOWED_MODELS: "",
            BOT_AI_MODEL_SWITCHING: "locked",
            BOT_AI_TOOL_CAPABILITIES: "",
            BOT_AI_TOOL_SCOPE: "workspace",
          },
        });
        bots.push(bot);
        assert.ok(bot.bridgePort > 0, `${brain} public direct bot did not start its bridge`);
      }
    } finally {
      await Promise.all(bots.map((bot) => bot.stop()));
      await node.close();
      for (const stateDir of stateDirs) fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  // The transport matrix runs the same scenarios in both ingress modes.
  for (const [mode, extraEnv] of [
    ["poll", { BOT_SUBSCRIBE: "0" }],
    ["subscribe", { BOT_SUBSCRIBE: "1" }],
  ]) {
    test(`round trip with poison batches (${mode})`, async () => {
      const node = await startSandbox();
      const stateDir = tmpState();
      const bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv });
      try {
        // In subscribe mode the sweep only runs every 30s, so replies inside
        // the waits below can only have arrived by subscription — but assert
        // the mode explicitly too.
        if (extraEnv.BOT_SUBSCRIBE === "1") await bot.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });
        const alice = await startPersona(node);
        await alice.open("hello opener");
        await alice.reply((m) => textOf(m) === "Echo: hello opener", { label: "the opener's echo" });
        // Every follow-up rides the device session with an undecodable
        // message in front of it (the device client's poison), and must be
        // answered and ACKed despite it.
        for (const text of ["follow-one", "follow-two"]) {
          await alice.sendRaw(poisonMessage());
          const sent = await alice.send(text);
          await alice.reply((m) => textOf(m) === `Echo: ${text}`, { label: `echo of ${text}` });
          await alice.delivered(sent.messageId);
        }
        assert.ok(bot.events.filter((e) => e.event === "BOT_UNDECODABLE_MESSAGES").length >= 1, "the poison was seen and skipped");
        assert.deepEqual(bot.events.filter((e) => e.event === "BOT_RECEIVED_TEXT").map((e) => e.chars), ["follow-one".length, "follow-two".length]);
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
      const node = await startSandbox();
      const stateDir = tmpState();
      let bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv });
      try {
        const alice = await startPersona(node);
        await alice.open("restart opener");
        const before = await alice.send("before-restart");
        await alice.reply((m) => textOf(m) === "Echo: before-restart");
        await alice.delivered(before.messageId);
        await bot.stop(); // SIGTERM: flushes state, removes pidfile

        const beforeRestart = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
        assert.equal(beforeRestart.v, 3);
        assert.match(beforeRestart.devicePrivateKeyHex, /^[0-9a-f]{64}$/);
        assert.match(beforeRestart.peers[0].identifierKeyHex, /^[0-9a-f]{64}$/);
        assert.ok(beforeRestart.peers[0].devices.every((device) => /^[0-9a-f]{64}$/.test(device.e)));
        assert.equal(beforeRestart.peers[0].devices[0].s, alice.devices[0].account.slice(2), "the roster holds the persona's DEVICE account, not its identity account");

        bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv });
        const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
        assert.equal(restored.peers, 1);
        const afterRestart = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
        assert.equal(afterRestart.devicePrivateKeyHex, beforeRestart.devicePrivateKeyHex);
        // Old statements are still in the store; none may be re-answered.
        const after = await alice.send("after-restart");
        await alice.reply((m) => textOf(m) === "Echo: after-restart");
        await alice.delivered(after.messageId);
        const received = bot.events.filter((e) => e.event === "BOT_RECEIVED_TEXT");
        assert.deepEqual(received.map((e) => e.chars), ["after-restart".length], `re-answered old messages: ${JSON.stringify(received)}`);
        assert.equal((await alice.incoming()).filter((m) => textOf(m) === "Echo: before-restart").length, 1, "the old answer was not sent again");
      } finally {
        await bot.stop();
        await node.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });

    test(`attachment download, reply quotes, reaction, call decline (${mode})`, async () => {
      const node = await startSandbox();
      const stateDir = tmpState();
      const bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv });
      try {
        if (extraEnv.BOT_SUBSCRIBE === "1") await bot.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });
        const alice = await startPersona(node);
        await alice.open("rich opener");
        const opener = await alice.reply((m) => textOf(m) === "Echo: rich opener");
        // The follow-up arrives as a quote of the bot's previous message.
        const quoted = await alice.send("quoted follow", { replyTo: opener.messageId });
        await alice.reply((m) => textOf(m) === "Echo: quoted follow");
        await alice.delivered(quoted.messageId);
        const reply = bot.events.find((e) => e.event === "BOT_RECEIVED_TEXT" && e.kind === "reply");
        assert.ok(reply, "no reply-kind message observed");
        // A photo with a caption: uploaded through the sandbox's HOP node,
        // the caption came through as the message text and was echoed after
        // the download; the photo landed byte-exact in the media store.
        const photo = tmpFile(stateDir, "photo.png", PNG);
        const sent = await alice.attach(photo, "look at this");
        const [ref] = sent.content.attachments;
        await alice.reply((m) => textOf(m) === "Echo: look at this");
        const downloaded = await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "BOT_MEDIA_DOWNLOADED" });
        assert.deepEqual([downloaded.mime, downloaded.bytes], ["image/png", PNG.length]);
        const stored = fs.readFileSync(path.join(stateDir, "media", `${ref.identifier.slice(2)}.png`));
        assert.equal(Buffer.compare(stored, PNG), 0, "stored media differs from the uploaded photo");
        const received = bot.events.find((e) => e.event === "BOT_RECEIVED_TEXT" && e.kind === "richText");
        assert.deepEqual([received.chars, received.attachments], ["look at this".length, 1]);
        // The reaction was recorded but never answered.
        const last = (await alice.incoming()).at(-1);
        await alice.react(last.messageId, "🔥");
        const reaction = await bot.waitFor((e) => e.event === "BOT_RECEIVED_REACTION", { label: "BOT_RECEIVED_REACTION" });
        assert.deepEqual([reaction.emoji, reaction.target], ["🔥", last.messageId]);
        // A call offer is ACKed and declined; the persona sees the decline under its offer.
        const offer = await alice.call();
        const declined = await bot.waitFor((e) => e.event === "BOT_CALL_DECLINED", { label: "BOT_CALL_DECLINED" });
        assert.equal(declined.offerId, offer.messageId);
        await waitFor(async () => (await alice.messages()).some((m) => m.messageId === `call-closed:${offer.messageId}`), { label: "the decline under the offer" });
        await alice.delivered(offer.messageId);
        // Exactly the three Echo replies (opener, follow-up, photo) went out.
        assert.equal(bot.events.filter((e) => e.event === "BOT_SENT_TEXT").length, 3, "unexpected extra replies (reaction or call answered?)");
        assert.ok(!JSON.stringify(bot.events).match(/ticket/i), "the claim ticket never reaches the log");
      } finally {
        await bot.stop();
        await node.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });

    test(`owed reply survives kill -9 mid-brain (${mode})`, async () => {
      const node = await startSandbox();
      const stateDir = tmpState();
      const slowBrain = {
        ...extraEnv,
        BOT_BRAIN: "claude", // engine parser; the CLI itself is the mock sh below
        BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3; printf '{\"type\":\"result\",\"result\":\"recovered-answer\"}\\n'"]),
        BOT_THINKING_TEXT: "", // keep the send log unambiguous
      };
      let bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: slowBrain });
      try {
        const alice = await startPersona(node);
        await alice.open("owed opener");
        await alice.reply((m) => textOf(m).startsWith("recovered-answer"));

        // Send a follow-up, kill the bot the moment it's ACKed but before the
        // 3s brain finishes — the reply now exists only in the owed journal.
        const crash = await alice.send("crash question");
        await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "crash question".length, { label: "crash question received" });
        await alice.delivered(crash.messageId);
        await bot.stop("SIGKILL");

        const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
        assert.equal(state.owed?.some((o) => o.t === "crash question"), true, "owed journal missing the question");
        assert.equal((await alice.incoming()).length, 1, "the kill landed before the answer");

        bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: slowBrain });
        const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
        assert.equal(restored.owed >= 1, true, `expected owed >= 1, got ${restored.owed}`);
        await bot.waitFor((e) => e.event === "BOT_SENT_TEXT", { label: "owed reply sent", timeoutMs: 20_000 });
        // The reply reached the persona: the journal, not a resend, brought the question back.
        await waitFor(async () => (await alice.incoming()).filter((m) => textOf(m).startsWith("recovered-answer")).length === 2, { label: "the owed answer" });
        assert.equal(bot.events.filter((e) => e.event === "BOT_RECEIVED_TEXT").length, 0, "the old statements were not re-received as new messages");
      } finally {
        await bot.stop();
        await node.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });
  }

  test("v2 P-256 session keys are reset while key-independent state survives", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const peerHex = "ab".repeat(32);
    fs.writeFileSync(path.join(stateDir, "session-state.json"), JSON.stringify({
      v: 2,
      peers: [{
        peerHex,
        identifierKeyHex: `04${"11".repeat(64)}`,
        devices: [{ s: peerHex, e: `04${"22".repeat(64)}` }],
      }],
      seen: ["keep-this-dedup-marker"],
      owed: [{ id: "old", p: peerHex, t: "cannot decrypt", r: "old-request" }],
      pendingOpenerAcks: ["old"],
      greeted: [peerHex],
    }), { mode: 0o600 });
    const bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: { BOT_SUBSCRIBE: "0" } });
    try {
      const reset = await bot.waitFor((event) => event.event === "BOT_STATE_KEYS_RESET", { label: "BOT_STATE_KEYS_RESET" });
      assert.equal(reset.version, 2);
      assert.equal(reset.peers, 1);
      const restored = await bot.waitFor((event) => event.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.peers, 0);
      assert.equal(restored.seen, 1);
      assert.equal(restored.owed, 0);
      const migrated = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      assert.equal(migrated.v, 3);
      assert.match(migrated.devicePrivateKeyHex, /^[0-9a-f]{64}$/);
      assert.deepEqual(migrated.peers, []);
      assert.deepEqual(migrated.seen, ["keep-this-dedup-marker"]);
      assert.deepEqual(migrated.owed, []);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("legacy on-chain P-256 containers are rejected with a clear event", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const peerHex = "ab".repeat(32);
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0",
        BOT_PEER_IDENTIFIER_KEYS: `${peerHex}=04${"11".repeat(64)}`,
      },
    });
    try {
      const rejected = await bot.waitFor(
        (event) => event.event === "BOT_PEER_KEY_UNSUPPORTED",
        { label: "BOT_PEER_KEY_UNSUPPORTED" },
      );
      assert.equal(rejected.peer, peerHex);
      assert.equal(rejected.reason, "unsupported_type");
      assert.equal(rejected.type, 4);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("removing an allowlisted peer drops its restored session", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const alice = await startPersona(node);
    let bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: { BOT_SUBSCRIBE: "0", BOT_ALLOWED_PEERS: alice.accountHex },
    });
    try {
      await alice.open("allowlisted opener");
      const before = await alice.send("before removal");
      await alice.reply((m) => textOf(m) === "Echo: before removal");
      await alice.delivered(before.messageId);
      await bot.stop();

      bot = await startBot({
        endpoint: node.url, apiUrl: node.apiUrl,
        stateDir,
        extraEnv: { BOT_SUBSCRIBE: "0", BOT_ALLOWED_PEERS: "ff".repeat(32) },
      });
      const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.peers, 0);
      assert.equal(restored.unauthorized, 1);
      assert.ok(bot.events.some((e) => e.event === "BOT_STATE_PEER_UNAUTHORIZED"));
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("graceful shutdown preserves an in-flight direct-agent turn", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const slowBrain = {
      BOT_SUBSCRIBE: "0",
      BOT_BRAIN: "claude",
      BOT_AI_CMD: "sh",
      BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3; printf '{\"type\":\"result\",\"result\":\"graceful-recovered\"}\\n'"]),
      BOT_THINKING_TEXT: "",
    };
    let bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: slowBrain });
    try {
      const alice = await startPersona(node);
      await alice.open("graceful opener");
      await alice.reply((m) => textOf(m).startsWith("graceful-recovered"));

      const question = await alice.send("graceful question");
      await bot.waitFor(
        (event) => event.event === "BOT_RECEIVED_TEXT" && event.chars === "graceful question".length,
        { label: "graceful question received" },
      );
      await alice.delivered(question.messageId);
      await bot.stop("SIGTERM");

      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      assert.equal(state.owed?.some((owed) => owed.t === "graceful question"), true, "graceful shutdown lost owed work");

      bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: slowBrain });
      const restored = await bot.waitFor((event) => event.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.owed >= 1, true, `expected owed >= 1, got ${restored.owed}`);
      await bot.waitFor((event) => event.event === "BOT_SENT_TEXT", { label: "recovered direct reply", timeoutMs: 20_000 });
      await waitFor(async () => (await alice.incoming()).filter((m) => textOf(m).startsWith("graceful-recovered")).length === 2, { label: "the recovered answer" });
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("bridge surface: /inbound shape, /media, reply/edit/react, events", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      // Thinking placeholder disabled: this test exercises the raw bridge
      // contract; the live-reply lifecycle has its own dedicated test.
      extraEnv: { BOT_SUBSCRIBE: "0", BOT_BRAIN: "bridge", BOT_THINKING_TEXT: "" },
    });
    const base = `http://127.0.0.1:${bot.bridgePort}`;
    const authHeaders = { authorization: `Bearer ${bot.bridgeToken}` };
    const post = (route, body) => fetch(`${base}${route}`, {
      method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => r.json());
    // Lease /inbound into one shared list, acknowledging each item after this
    // test harness has accepted it so sibling predicates never lose work.
    const received = [];
    const pump = async (pred, { events = false, timeoutMs = 30_000, label = "inbound item" } = {}) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const hit = received.find(pred);
        if (hit) return hit;
        const items = await fetch(`${base}/inbound?wait=2${events ? "&events=1" : ""}`, { headers: authHeaders }).then((r) => r.json());
        for (const item of items) {
          if (!item.delivery_id) continue;
          const ack = await post("/inbound/ack", { delivery_id: item.delivery_id, lease_id: item.lease_id });
          assert.equal(ack.success, true, JSON.stringify(ack));
        }
        received.push(...items);
      }
      throw new Error(`timed out waiting for ${label}; got ${JSON.stringify(received)}`);
    };
    try {
      const unauthorized = await fetch(`${base}/health`);
      assert.equal(unauthorized.status, 401, "bridge must reject unauthenticated local clients");
      const alice = await startPersona(node);
      await alice.open("bridge opener");
      // Opener arrives over the bridge; answer it as a quote.
      const opener = await pump((i) => i.text === "bridge opener", { label: "opener" });
      assert.match(opener.delivery_id, /^[0-9A-F-]{36}$/);
      assert.match(opener.lease_id, /^[0-9A-F-]{36}$/);
      assert.equal(opener.chat_id, alice.accountHex, "chat_id is the peer's identity account");
      assert.match(opener.context, /You are `e2etest\.00`/);
      assert.match(opener.context, /transport: polkadot-app/);
      assert.match(opener.context, /Chat commands: \/help—list these commands/);
      const sent = await post("/send", { chat_id: opener.chat_id, text: "seen it", reply_to: opener.message_id });
      assert.equal(sent.success, true, JSON.stringify(sent));
      assert.match(sent.message_id, /^[0-9A-F-]{36}$/, "expected a real envelope UUID");
      const seen = await alice.reply((m) => textOf(m) === "seen it");
      assert.deepEqual([seen.content.type, seen.content.messageId], ["reply", opener.message_id], "the quote names the opener");

      // The caption-less photo: synthesized text, attachment metadata without the
      // claim ticket, bytes served at /media.
      const photo = tmpFile(stateDir, "photo.png", PNG);
      const attached = await alice.attach(photo);
      const photoItem = await pump((i) => i.attachments?.length > 0, { label: "photo item" });
      assert.equal(photoItem.kind, "richText");
      assert.match(photoItem.text, /\[photo, image\/png/);
      const [att] = photoItem.attachments;
      assert.equal(att.downloaded, true, JSON.stringify(att));
      assert.equal(att.url, `/media/${attached.content.attachments[0].identifier.slice(2)}`);
      assert.equal(att.mime, "image/png");
      assert.deepEqual([att.width, att.height, att.kind], [1, 1, "image"]);
      assert.equal(Object.keys(att).some((k) => /ticket|ct/i.test(k)), false, "claim ticket leaked across the bridge");
      const served = Buffer.from(await fetch(`${base}${att.url}`, { headers: authHeaders }).then((r) => r.arrayBuffer()));
      assert.equal(Buffer.compare(served, PNG), 0, "served media differs from the uploaded photo");

      // Edit the earlier reply in place, then check the send path recorded it
      // and the persona applied it. (edit_of is throttled/coalesced through
      // the live outbox, so the actual submit is asynchronous.)
      const edited = await post("/send", { chat_id: opener.chat_id, text: "seen it (edited)", edit_of: sent.message_id });
      assert.equal(edited.success, true, JSON.stringify(edited));
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT" && e.editOf === sent.message_id, { label: "edit submitted" });
      await waitFor(async () => (await alice.row(sent.message_id))?.editedAt != null, { label: "the edit applied on the persona" });
      assert.equal(textOf(await alice.row(sent.message_id)), "seen it (edited)");
      const both = await post("/send", { chat_id: opener.chat_id, text: "x", reply_to: "a", edit_of: "b" });
      assert.equal(both.success, false, "reply_to+edit_of must be rejected");

      // Second round: the bot answers "ping", the persona reacts to that
      // reply, and the reaction surfaces only on the events=1 poller.
      await alice.send("ping");
      const ping = await pump((i) => i.text === "ping", { label: "ping" });
      const pong = await post("/send", { chat_id: ping.chat_id, text: "pong" });
      assert.equal(pong.success, true);
      await alice.reply((m) => m.messageId === pong.message_id, { label: "pong on the persona" });
      await alice.react(pong.message_id, "💯");
      const reactionEvent = await pump((i) => i.kind === "reaction", { events: true, label: "reaction event" });
      assert.equal(reactionEvent.emoji, "💯");
      assert.equal(reactionEvent.target_message_id, pong.message_id, "reaction targets the bot's pong");
      // Outbound reaction route.
      const reacted = await post("/react", { chat_id: ping.chat_id, message_id: ping.message_id, emoji: "👀" });
      assert.equal(reacted.success, true, JSON.stringify(reacted));
      await bot.waitFor((e) => e.event === "BOT_SENT_REACTION", { label: "BOT_SENT_REACTION" });
      await waitFor(async () => (await alice.row(ping.message_id))?.reactions.some((r) => r.emoji === "👀" && r.by === "peer"), { label: "the bot's reaction on the persona's row" });
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("/file put saves a same-message attachment in the durable peer vault", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bytes = Buffer.from("durable client attachment\n");
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: { BOT_SUBSCRIBE: "0" },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("file vault opener");
      const spec = tmpFile(stateDir, "spec.txt", bytes);
      const put = await alice.attach(spec, "/file put incoming/spec.txt");
      const confirm = await alice.reply((m) => textOf(m).startsWith("Saved incoming/spec.txt"), { label: "the file command's reply" });
      assert.match(textOf(confirm), /Saved incoming\/spec\.txt/);
      await alice.delivered(put.messageId);
      assert.ok((await alice.incoming()).every((m) => !textOf(m).startsWith("Echo: /file put")), "file commands must not be passed to the brain");

      const saved = await bot.waitFor(
        (event) => event.event === "BOT_FILE_SAVED" && event.path === "incoming/spec.txt",
        { label: "BOT_FILE_SAVED" },
      );
      assert.equal(saved.peer, alice.accountHex);
      assert.equal(saved.bytes, bytes.length);
      const vaultPath = path.join(stateDir, "files", "peers", alice.accountHex, "incoming", "spec.txt");
      assert.equal(Buffer.compare(fs.readFileSync(vaultPath), bytes), 0, "durable vault bytes differ from the attachment");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("bridge /files uploads, lists, retrieves, and sends a vault file", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0",
        BOT_HOP_UPLOAD_NODE: node.hopUrl,
      },
    });
    const base = `http://127.0.0.1:${bot.bridgePort}`;
    const authHeaders = { authorization: `Bearer ${bot.bridgeToken}` };
    const vaultPath = "exports/bridge-note.txt";
    const payload = Buffer.from("bridge durable payload\n");
    try {
      // Establish the encrypted device session before bridge-driven file delivery.
      const alice = await startPersona(node);
      await alice.open("bridge file opener");
      const warm = await alice.send("bridge file warmup");
      await alice.reply((m) => textOf(m) === "Echo: bridge file warmup");
      await alice.delivered(warm.messageId);

      const putResponse = await fetch(`${base}/files/${alice.accountHex}/${vaultPath}`, {
        method: "PUT",
        headers: { ...authHeaders, "content-type": "text/plain; charset=utf-8" },
        body: payload,
      });
      assert.equal(putResponse.status, 201);
      const put = await putResponse.json();
      assert.deepEqual(put, {
        success: true,
        path: vaultPath,
        mime: "text/plain",
        size: payload.length,
      });

      const listResponse = await fetch(`${base}/files/${alice.accountHex}?prefix=exports`, { headers: authHeaders });
      assert.equal(listResponse.status, 200);
      const listed = await listResponse.json();
      assert.equal(listed.success, true);
      assert.equal(listed.files.length, 1);
      assert.equal(listed.files[0].path, vaultPath);
      assert.equal(listed.files[0].mime, "text/plain");
      assert.equal(listed.files[0].size, payload.length);
      assert.equal(Object.hasOwn(listed.files[0], "peer"), false, "bridge listing must not expose a peer namespace field");

      const getResponse = await fetch(`${base}/files/${alice.accountHex}/${vaultPath}`, { headers: authHeaders });
      assert.equal(getResponse.status, 200);
      assert.match(getResponse.headers.get("content-type") ?? "", /^text\/plain/);
      const fetched = Buffer.from(await getResponse.arrayBuffer());
      assert.equal(Buffer.compare(fetched, payload), 0, "bridge GET returned different durable-file bytes");

      const sendResponse = await fetch(`${base}/send`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: alice.accountHex,
          text: "Bridge file delivery",
          file_path: vaultPath,
        }),
      });
      assert.equal(sendResponse.status, 200);
      const sent = await sendResponse.json();
      assert.equal(sent.success, true, JSON.stringify(sent));
      assert.match(sent.message_id, /^[0-9A-F-]{36}$/);
      await bot.waitFor((event) => event.event === "BOT_SENT_FILE", { label: "BOT_SENT_FILE" });
      const hop = node.daemon.hop;
      assert.equal(hop.submissions.length, 2, "small file upload should submit one encrypted chunk and metadata");
      assert.ok(hop.submissions.every((submission) => submission.signer === `0x${BOT_BULLETIN_ACCOUNT}`), "outbound HOP upload used the wrong signer");

      // The persona receives the rich text with the caption, claims the
      // one-shot entries and holds the bytes.
      const delivered = await alice.reply((m) => m.messageId === sent.message_id, { label: "the file message on the persona" });
      assert.deepEqual([delivered.content.type, delivered.content.text], ["richText", "Bridge file delivery"]);
      const claimed = await waitFor(async () => { const m = await alice.row(sent.message_id); return m?.content.attachments[0].status === "claimed" ? m : null; }, { label: "the persona's claim" });
      const [a] = claimed.content.attachments;
      assert.deepEqual([a.kind, a.mimeType, a.fileSize, a.claimedBy], ["general", "text/plain", payload.length, 1]);
      const held = Buffer.from(await fetch(`${node.apiUrl}/api/personas/alice/media/${a.mediaId}`).then((r) => r.arrayBuffer()));
      assert.equal(Buffer.compare(held, payload), 0, "the persona holds the vault file byte-exact");
      assert.ok(hop.list().every((e) => e.claims === 1 && e.acked), "each pool entry claimed once and acked");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("bridge leases renew long work and reject stale acknowledgements", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: { BOT_SUBSCRIBE: "0", BOT_BRAIN: "bridge", BOT_THINKING_TEXT: "", BOT_BRIDGE_LEASE_MS: "1000" },
    });
    const base = `http://127.0.0.1:${bot.bridgePort}`;
    const headers = { authorization: `Bearer ${bot.bridgeToken}`, "content-type": "application/json" };
    const post = async (route, body) => {
      const response = await fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const inbound = async () => {
      const response = await fetch(`${base}/inbound?wait=2&limit=1`, { headers: { authorization: `Bearer ${bot.bridgeToken}` } });
      return response.json();
    };
    try {
      const alice = await startPersona(node);
      await alice.open("lease question");
      let first = null;
      for (let attempt = 0; attempt < 10 && !first; attempt += 1) {
        const items = await inbound();
        first = items.find((item) => item.text === "lease question") ?? null;
      }
      assert.ok(first, "expected bridge delivery");
      assert.equal(first.lease_ms, 1000);
      const renewed = await post("/inbound/renew", { delivery_id: first.delivery_id, lease_id: first.lease_id });
      assert.equal(renewed.status, 200);
      assert.equal(renewed.body.renewed, 1);

      await sleep(1_100);
      let second = null;
      for (let attempt = 0; attempt < 10 && !second; attempt += 1) {
        const items = await inbound();
        second = items.find((item) => item.delivery_id === first.delivery_id) ?? null;
      }
      assert.ok(second, "expired delivery should be re-leased");
      assert.notEqual(second.lease_id, first.lease_id);

      const stale = await post("/inbound/ack", { delivery_id: first.delivery_id, lease_id: first.lease_id });
      assert.equal(stale.status, 200);
      assert.equal(stale.body.acknowledged, 0, "stale lease must not settle the delivery");
      const secondRenew = await post("/inbound/renew", { delivery_id: second.delivery_id, lease_id: second.lease_id });
      assert.equal(secondRenew.status, 200);
      const sent = await post("/send", { chat_id: second.chat_id, text: "lease answer" });
      assert.equal(sent.status, 200);
      const settled = await post("/inbound/ack", { delivery_id: second.delivery_id, lease_id: second.lease_id });
      assert.equal(settled.status, 200);
      assert.equal(settled.body.acknowledged, 1);
      await alice.reply((m) => textOf(m) === "lease answer");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  // Shared env for the live-replies tests: a mock "agent CLI" that emits
  // claude-style stream-json (one tool event, then the result) slowly enough
  // for the placeholder + progress machinery to engage.
  const liveBrainEnv = {
    BOT_SUBSCRIBE: "0",
    BOT_BRAIN: "claude",
    BOT_AI_CMD: "sh",
    BOT_AI_ARGS: JSON.stringify(["-c",
      "sleep 3; printf '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"npm test\"}}]}}\\n'; sleep 4; printf '{\"type\":\"result\",\"result\":\"live final answer\"}\\n'"]),
    BOT_AI_STREAM: "1",
    BOT_THINKING_TEXT: "⏳ thinking…",
    BOT_THINKING_AFTER_MS: "1000",
    BOT_LIVE_EDIT_MIN_MS: "300",
    BOT_LIVE_HEARTBEAT_MS: "1500",
    BOT_LIVE_FINAL_ACK_WAIT_MS: "4000",
    // The no-ACK scenarios must not wait the production-length outbound grace
    // before the placeholder/final can take the channel slot.
    BOT_OUTBOUND_ACK_GRACE_MS: "2000",
  };
  // Every text a row ever showed, oldest first: the persona keeps the edit
  // history of a row, so progress frames that a later edit replaced are
  // still readable.
  const versions = (row) => [...(row.editHistory ?? []).map((e) => e.text), textOf(row)];

  test("live reply: placeholder becomes progress frames, then a status line; the answer is a new message", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: liveBrainEnv });
    try {
      // Two texts: the follow-up rides the device channel; both turns are
      // slow enough to get a placeholder.
      const alice = await startPersona(node);
      await alice.open("live question");
      // (The first answer carries the /help tip; the answer text is its first line.)
      const isAnswer = (m) => textOf(m).startsWith("live final answer");
      await alice.reply(isAnswer, { label: "the first answer", timeoutMs: 30_000 });
      const again = await alice.send("again please");
      await waitFor(async () => (await alice.incoming()).filter(isAnswer).length === 2, { label: "the second answer", timeoutMs: 30_000 });
      await alice.delivered(again.messageId);
      const placeholders = bot.events.filter((e) => e.event === "BOT_LIVE_PLACEHOLDER").map((e) => e.messageId);
      assert.ok(placeholders.length >= 1, "no live placeholder was posted");
      // The placeholder bubble was seen with its id, then edited in place:
      // the same row, its history holding the progress frames.
      const bubble = await alice.row(placeholders[0]);
      assert.ok(bubble, "the placeholder row exists on the persona");
      const frames = versions(bubble);
      assert.equal(frames[0], "⏳ thinking…", `placeholder not seen first: ${JSON.stringify(frames)}`);
      assert.ok(frames.length >= 3, `expected progress + final edits, got ${JSON.stringify(frames)}`);
      // A progress frame carried the tool action line; the terminal edit is a
      // one-line status summary of what the turn cost, NOT the answer.
      assert.ok(frames.some((f) => /▸ \$ npm test/.test(f)), `no tool action frame: ${JSON.stringify(frames)}`);
      assert.match(frames.at(-1), /✓ Answered in \d+s/, "terminal status line missing");
      // The answer must arrive as a NEW bubble: an edit raises no phone
      // notification, so a user who locked their phone mid-turn would never
      // learn the answer landed.
      const answers = (await alice.incoming()).filter(isAnswer);
      assert.ok(answers.every((m) => m.editedAt == null && !placeholders.includes(m.messageId)), "the answer must be a new message, not an edit of the placeholder");
      // Two plain sends per turn: the placeholder, then the answer.
      const plainSends = bot.events.filter((e) => e.event === "BOT_SENT_TEXT" && !e.editOf);
      assert.equal(plainSends.length, placeholders.length * 2, `unexpected plain sends: ${JSON.stringify(plainSends)}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("live reply: a peer that never ACKs gets a plain final message", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: liveBrainEnv });
    try {
      // The persona opens the chat normally, then stops ACKing for good: the
      // node drops every ACK its device would send (a peer that never fetches).
      const alice = await startPersona(node);
      await alice.open("silent question");
      await alice.neverAck();
      await alice.send("still here");
      await bot.waitFor((e) => e.event === "BOT_LIVE_FALLBACK", { label: "BOT_LIVE_FALLBACK", timeoutMs: 40_000 });
      await waitFor(async () => (await alice.incoming()).some((m) => textOf(m).startsWith("live final answer")), { label: "a plain final", timeoutMs: 30_000 });
      const rows = await alice.incoming();
      assert.ok(rows.every((m) => m.editedAt == null), `no edits may reach a non-ACKing peer: ${JSON.stringify(rows.map(versions))}`);
      assert.ok(rows.filter((m) => textOf(m).startsWith("live final answer")).length >= 1, "plain final missing");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("live reply: a bridge plain send retires the placeholder to a status line", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0",
        BOT_BRAIN: "bridge",
        BOT_THINKING_TEXT: "⏳ thinking…",
        BOT_THINKING_AFTER_MS: "1000",
        BOT_LIVE_EDIT_MIN_MS: "300",
        BOT_LIVE_FINAL_ACK_WAIT_MS: "4000",
      },
    });
    const base = `http://127.0.0.1:${bot.bridgePort}`;
    const authHeaders = { authorization: `Bearer ${bot.bridgeToken}` };
    const post = (route, body) => fetch(`${base}${route}`, {
      method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => r.json());
    try {
      const alice = await startPersona(node);
      await alice.open("bridge live question");
      const item = await (async () => {
        const until = Date.now() + 20_000;
        while (Date.now() < until) {
          try {
            const items = await fetch(`${base}/inbound?wait=2`, { headers: authHeaders }).then((r) => r.json());
            const hit = items.find((i) => i.text === "bridge live question");
            if (hit) {
              const ack = await post("/inbound/ack", { delivery_id: hit.delivery_id, lease_id: hit.lease_id });
              assert.equal(ack.success, true, JSON.stringify(ack));
              return hit;
            }
          } catch { await sleep(250); }
        }
        throw new Error("inbound item never arrived");
      })();
      // Wait for the placeholder, then answer with a PLAIN send: the placeholder
      // retires to a status line and the answer becomes its own message, so the
      // harness gets back a NEW id rather than the placeholder's.
      const placeholder = await bot.waitFor((e) => e.event === "BOT_LIVE_PLACEHOLDER", { label: "BOT_LIVE_PLACEHOLDER" });
      const sent = await post("/send", { chat_id: item.chat_id, text: "answer from harness" });
      assert.equal(sent.success, true, JSON.stringify(sent));
      assert.notEqual(sent.message_id, placeholder.messageId, "the answer must not reuse the placeholder message");
      const status = await bot.waitFor((e) => e.event === "BOT_LIVE_STATUS", { label: "BOT_LIVE_STATUS" });
      assert.equal(status.messageId, placeholder.messageId, "the status line must land on the placeholder");
      // Follow-up streaming edit from the harness flows through the throttled lane.
      const revised = await post("/send", { chat_id: item.chat_id, text: "answer from harness (revised)", edit_of: sent.message_id });
      assert.equal(revised.success, true, JSON.stringify(revised));
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT" && e.editOf === sent.message_id && e.chars > 20, { label: "revised edit submitted", timeoutMs: 10_000 });
      // The placeholder carries the status line; the answer is its own bubble,
      // and the harness's follow-up edit lands on the answer, not the placeholder.
      await waitFor(async () => /^✓ /.test(textOf((await alice.row(placeholder.messageId)) ?? { content: {} })), { label: "the status line on the placeholder" });
      await waitFor(async () => textOf((await alice.row(sent.message_id)) ?? { content: {} }) === "answer from harness (revised)", { label: "the revised answer" });
      const answer = await alice.row(sent.message_id);
      assert.deepEqual(versions(answer), ["answer from harness", "answer from harness (revised)"], "the answer bubble, then its edit");
      assert.equal(versions(await alice.row(placeholder.messageId))[0], "⏳ thinking…");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("live reply: an unanswered placeholder resolves to a timeout note", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    // Bridge brain with NO harness attached: the answer never comes; the
    // placeholder must finalize itself instead of ticking forever.
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0",
        BOT_BRAIN: "bridge",
        BOT_THINKING_TEXT: "⏳ thinking…",
        BOT_THINKING_AFTER_MS: "1000",
        BOT_LIVE_EDIT_MIN_MS: "300",
        BOT_LIVE_TTL_MS: "4000",
        BOT_LIVE_TIMEOUT_TEXT: "timed out, resend please",
      },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("never answered");
      const placeholder = await bot.waitFor((e) => e.event === "BOT_LIVE_PLACEHOLDER", { label: "BOT_LIVE_PLACEHOLDER" });
      await bot.waitFor((e) => e.event === "BOT_LIVE_TTL_EXPIRED", { label: "BOT_LIVE_TTL_EXPIRED" });
      await waitFor(async () => textOf((await alice.row(placeholder.messageId)) ?? { content: {} }) === "timed out, resend please", { label: "the timeout note on the placeholder" });
      assert.equal(versions(await alice.row(placeholder.messageId))[0], "⏳ thinking…", "the note is an edit of the placeholder");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: session token is captured from the stream and persisted per peer", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh", BOT_THINKING_TEXT: "",
        // Emit a claude-style init (carries session_id) then the answer.
        BOT_AI_ARGS: JSON.stringify(["-c",
          "printf '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"SES-XYZ\"}\\n'; printf '{\"type\":\"result\",\"result\":\"hi\"}\\n'"]),
      },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("capture opener");
      await alice.reply((m) => textOf(m).startsWith("hi"));
      const again = await alice.send("again");
      await waitFor(async () => (await alice.incoming()).filter((m) => textOf(m).startsWith("hi")).length === 2, { label: "the second answer" });
      await alice.delivered(again.messageId);
      // The captured session id is persisted so the next turn resumes it.
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      assert.equal(state.agent?.engine, "custom");
      assert.ok(state.peers.some((p) => p.rs === "SES-XYZ"), `no peer carries the session token: ${JSON.stringify(state.peers)}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: /stop cancels a running turn and finalizes the placeholder", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        // A turn that never finishes on its own (until killed).
        BOT_AI_ARGS: JSON.stringify(["-c", "printf '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"S1\"}\\n'; sleep 120"]),
        BOT_THINKING_TEXT: "⏳ thinking…", BOT_THINKING_AFTER_MS: "1000", BOT_LIVE_EDIT_MIN_MS: "300",
      },
    });
    try {
      // First message starts the long turn; "/stop" arrives as a device follow-up
      // while it runs and must cancel it (bypassing the per-peer queue).
      const alice = await startPersona(node);
      await alice.open("do something slow");
      const placeholder = await bot.waitFor((e) => e.event === "BOT_LIVE_PLACEHOLDER", { label: "BOT_LIVE_PLACEHOLDER" });
      await alice.send("/stop");
      const stop = await bot.waitFor((e) => e.event === "BOT_STOP", { label: "BOT_STOP" });
      assert.equal(stop.stopped, true, "a running turn should have been stopped");
      await waitFor(async () => textOf((await alice.row(placeholder.messageId)) ?? { content: {} }) === "⏹ Stopped.", { label: "the stop edit on the placeholder" });
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: idle-silence backstop kills a wedged turn and apologizes", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        // Emit once (resets the idle timer), then go silent forever.
        BOT_AI_ARGS: JSON.stringify(["-c", "printf '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"S2\"}\\n'; sleep 120"]),
        BOT_THINKING_TEXT: "", BOT_AI_IDLE_TIMEOUT_MS: "2500",
      },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("wedge me");
      await bot.waitFor((e) => e.event === "BOT_AI_IDLE_TIMEOUT", { label: "BOT_AI_IDLE_TIMEOUT" });
      await alice.reply((m) => /couldn't reach my agent/.test(textOf(m)), { label: "the apology after the idle kill" });
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: a long answer is chunked into ordered parts, none lost", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    // Three ~300-byte paragraphs against a 400-byte chunk cap -> 3+ parts. The
    // paragraphs use only sh-quote-safe characters.
    const paras = ["alpha " + "a".repeat(300), "bravo " + "b".repeat(300), "charlie " + "c".repeat(300)];
    const resultLine = JSON.stringify({ type: "result", result: paras.join("\n\n") });
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", `printf '%s\n' '${resultLine}'`]),
        BOT_THINKING_TEXT: "", BOT_REPLY_CHUNK_BYTES: "400",
      },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("give me a long answer");
      const chunked = await bot.waitFor((e) => e.event === "BOT_REPLY_CHUNKED", { label: "BOT_REPLY_CHUNKED" });
      assert.ok(chunked.parts >= 3, `expected >=3 parts, got ${chunked.parts}`);
      // Every paragraph reached the peer, in order, torn nowhere: the room
      // lists the parts as separate messages in the order they were sent.
      await waitFor(async () => (await alice.incoming()).map(textOf).join("\n").includes(paras[2]), { label: "the last part" });
      const joined = (await alice.incoming()).map(textOf).join("\n");
      const positions = paras.map((p) => joined.indexOf(p));
      assert.ok(positions.every((p) => p >= 0), `missing answer parts:\n${joined.slice(0, 2000)}`);
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, "parts arrived out of order");
      const again = await alice.send("and again");
      await alice.delivered(again.messageId);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: a sent file is privately staged for the turn then cleaned up", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const bytes = Buffer.from("spec-content-123");
    // The mock CLI answers with the prompt it was given, which carries the
    // attachment's staged path. JSON.stringify keeps generated context
    // newlines valid in the mock result event.
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: process.execPath,
        BOT_AI_ARGS: JSON.stringify([
          "-e",
          "process.stdout.write(JSON.stringify({ type: 'result', result: `PROMPT ${process.argv[1]}` }) + '\\n')",
          "__PROMPT__",
        ]),
        BOT_THINKING_TEXT: "",
      },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("hello first");
      await alice.reply((m) => textOf(m).startsWith("PROMPT"));
      const spec = tmpFile(stateDir, "spec.txt", bytes);
      const sent = await alice.attach(spec, "here is the spec");
      const answer = await alice.reply((m) => textOf(m).includes("here is the spec"), { label: "the prompt echoed back" });
      await alice.delivered(sent.messageId);
      // The prompt references a private per-turn copy, not the media store;
      // that copy is removed once the engine has completed.
      const m = /saved at (\S+)/.exec(textOf(answer));
      assert.ok(m, `no staged path in the engine prompt:\n${textOf(answer)}`);
      assert.ok(m[1].includes(`${path.sep}.pca-attachment-`), `not staged into a private turn directory: ${m[1]}`);
      assert.equal(fs.existsSync(m[1]), false, "staged attachment must be cleaned up after the turn");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: /project switches the turn cwd to the registered project", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const projDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pca-proj-")));
    // The mock CLI answers with its own cwd, so the reply proves where it ran.
    const bot = await startBot({
      endpoint: node.url, apiUrl: node.apiUrl,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", "printf '{\"type\":\"result\",\"result\":\"cwd:%s\"}\\n' \"$(pwd)\""]),
        BOT_THINKING_TEXT: "",
        BOT_AI_PROJECTS: JSON.stringify({ proj: projDir }),
      },
    });
    try {
      const alice = await startPersona(node);
      await alice.open("where are you");
      // Turn 1: shared workspace. Command: switch confirmation. Turn 2: project dir.
      const first = await alice.reply((m) => textOf(m).startsWith("cwd:"), { label: "the first cwd" });
      assert.match(textOf(first), /cwd:.*workspace/, "first turn not in the shared workspace");
      await alice.send("/project proj");
      await alice.reply((m) => /Working in proj/.test(textOf(m)), { label: "the switch confirmation" });
      const now = await alice.send("where now");
      await alice.reply((m) => textOf(m) === `cwd:${projDir}`, { label: "the second turn in the project dir" });
      await alice.delivered(now.messageId);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  test("owed attachment survives kill -9 and re-processes after restart", async () => {
    const node = await startSandbox();
    const stateDir = tmpState();
    const slowBrain = {
      BOT_SUBSCRIBE: "0",
      BOT_BRAIN: "claude",
      BOT_AI_CMD: "sh",
      BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3; printf '{\"type\":\"result\",\"result\":\"recovered-answer\"}\\n'"]),
      BOT_THINKING_TEXT: "",
    };
    let bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: slowBrain });
    try {
      const alice = await startPersona(node);
      await alice.open("owed opener");
      await alice.reply((m) => textOf(m).startsWith("recovered-answer"));

      // Photo arrives, gets ACKed and downloaded, then the bot dies mid-brain:
      // the owed journal is the only way the message comes back.
      const photo = tmpFile(stateDir, "photo.png", PNG);
      const sent = await alice.attach(photo, "crash photo");
      const id = sent.content.attachments[0].identifier.slice(2);
      await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "crash photo".length, { label: "crash photo received" });
      await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "BOT_MEDIA_DOWNLOADED" });
      await alice.delivered(sent.messageId);
      await bot.stop("SIGKILL");

      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      const owed = state.owed?.find((o) => o.c === "crash photo");
      assert.ok(owed, `owed journal missing the photo message: ${JSON.stringify(state.owed)}`);
      assert.equal(owed.a?.[0]?.i, id, "journal lost the attachment identifier");
      assert.ok(owed.a?.[0]?.ct, "journal lost the claim ticket (restart couldn't re-download)");

      bot = await startBot({ endpoint: node.url, apiUrl: node.apiUrl, stateDir, extraEnv: slowBrain });
      const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.owed >= 1, true, `expected owed >= 1, got ${restored.owed}`);
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT", { label: "owed reply sent", timeoutMs: 20_000 });
      await waitFor(async () => (await alice.incoming()).filter((m) => textOf(m).startsWith("recovered-answer")).length === 2, { label: "the owed answer" });
      assert.equal(bot.events.filter((e) => e.event === "BOT_MEDIA_DOWNLOADED").length, 0, "the cached photo was not downloaded again (the pool entry is gone anyway)");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
