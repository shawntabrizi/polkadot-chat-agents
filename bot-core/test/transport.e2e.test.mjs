// Offline transport e2e: bot-core + test-client-device against the in-memory
// mock statement node. No chain, no network — the identifier lookup is pinned
// via BOT_PEER_IDENTIFIER_KEYS, everything else is the real stack (vendored
// codec, sessions, dedup, persistence, ACKs).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startMockStatementNode } from "./mock-statement-node.mjs";
import { startMockHopNode } from "./mock-hop-node.mjs";
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
const TEST_BRIDGE_TOKEN = "transport-e2e-bridge-token-0123456789";

// Spawn the bot and expose its JSON-line events for assertions.
async function startBot({ endpoint, stateDir, extraEnv = {} }) {
  const bridgeToken = extraEnv.BOT_BRIDGE_TOKEN ?? TEST_BRIDGE_TOKEN;
  const child = spawn(process.execPath, [path.join(BOT_CORE, "index.mjs")], {
    env: {
      ...process.env,
      BOT_SEED_HEX: BOT_SEED,
      BOT_ENDPOINT: endpoint,
      // Port 0: the OS assigns a free one (tests run concurrently, so a
      // pick-then-bind helper would race); BOT_BRIDGE_LISTENING reports it.
      BOT_BRIDGE_PORT: "0",
      BOT_BRIDGE_TOKEN: bridgeToken,
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

// Run the device-channel client; returns { code, out }.
function runClient(endpoint, extraArgs, texts) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(BOT_CORE, "test-client-device.mjs"),
      // extraArgs go FIRST: the client's flag parser takes the first
      // occurrence, so per-test overrides (e.g. --wait-secs) must precede the
      // defaults or they are silently ignored.
      ...extraArgs,
      "--seed-hex", CLIENT_SEED,
      "--bot-account", `0x${BOT_ACCOUNT}`,
      "--bot-identifier-key", `0x${BOT_ID_KEY}`,
      "--endpoint", endpoint,
      "--wait-secs", "8",
      // End each wait window once the bot has answered and gone quiet for 4s
      // (the slowest legitimate in-window gap is a 3s mock brain). Tests whose
      // bot goes quiet LONGER mid-window must opt out with --settle-ms 0.
      "--settle-ms", "4000", "--poll-ms", "500",
      ...texts,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (code) => resolve({ code, out }));
  });
}

const tmpState = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-e2e-"));

// --attach spec for test-client-device: a file pre-uploaded to the mock HOP node.
const attachSpecOf = (file, bytes, mime = "image/jpeg") => JSON.stringify({
  identifier: `0x${bytesToHex(file.identifier)}`,
  ticket: `0x${bytesToHex(file.claimTicket)}`,
  url: file.wssUrl,
  mime,
  size: bytes.length,
});

// Every test is self-contained (own mock node, own bot process, own state
// dir, OS-assigned ports), and the suite is sleep-dominated — so run them
// concurrently. 8 keeps the process count (bot + client per test) tame.
describe("transport e2e", { concurrency: 8 }, () => {

  test("public built-in direct brains start without an allowlist", async () => {
    const node = await startMockStatementNode();
    const bots = [];
    const stateDirs = [];
    try {
      for (const brain of ["codex", "opencode"]) {
        const stateDir = tmpState();
        stateDirs.push(stateDir);
        const bot = await startBot({
          endpoint: node.url,
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
        const received = bot.events.filter((e) => e.event === "BOT_RECEIVED_TEXT");
        assert.deepEqual(received.map((e) => e.chars), ["after-restart".length], `re-answered old messages: ${JSON.stringify(received)}`);
      } finally {
        await bot.stop();
        await node.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });

    test(`attachment download, reply quotes, reaction, call decline (${mode})`, async () => {
      const node = await startMockStatementNode();
      const hop = await startMockHopNode();
      const stateDir = tmpState();
      const photo = new Uint8Array(crypto.randomBytes(300_000));
      const file = hop.putFile(photo);
      const bot = await startBot({ endpoint: node.url, stateDir, extraEnv: { ...extraEnv, BOT_HOP_ALLOW_INSECURE: "1" } });
      try {
        if (extraEnv.BOT_SUBSCRIBE === "1") await bot.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });
        const r = await runClient(node.url, [
          "--attach", attachSpecOf(file, photo), "--attach-caption", "look at this",
          "--reply", "1", "--react", "🔥", "--offer-call", "1",
        ], ["rich opener", "quoted follow"]);
        assert.equal(r.code, 0, `client failed (incl. call-decline check):\n${r.out}`);
        // The caption came through as the message text and was echoed after the
        // download; the photo landed byte-exact in the media store.
        assert.match(r.out, /Echo: look at this/);
        await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "BOT_MEDIA_DOWNLOADED" });
        const stored = fs.readFileSync(path.join(stateDir, "media", `${bytesToHex(file.identifier)}.jpg`));
        assert.equal(Buffer.compare(stored, photo), 0, "stored media differs from the uploaded photo");
        // The follow-up arrived as a quote of the bot's previous message.
        const reply = bot.events.find((e) => e.event === "BOT_RECEIVED_TEXT" && e.kind === "reply");
        assert.ok(reply, "no reply-kind message observed");
        // The reaction was recorded but never answered: exactly the three Echo
        // replies (opener, follow-up, photo) went out.
        const reaction = await bot.waitFor((e) => e.event === "BOT_RECEIVED_REACTION", { label: "BOT_RECEIVED_REACTION" });
        assert.equal(reaction.emoji, "🔥");
        await bot.waitFor((e) => e.event === "BOT_CALL_DECLINED", { label: "BOT_CALL_DECLINED" });
        assert.equal(bot.events.filter((e) => e.event === "BOT_SENT_TEXT").length, 3, "unexpected extra replies (reaction answered?)");
      } finally {
        await bot.stop();
        await node.close();
        await hop.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });

    test(`owed reply survives kill -9 mid-brain (${mode})`, async () => {
      const node = await startMockStatementNode();
      const stateDir = tmpState();
      const slowBrain = {
        ...extraEnv,
        BOT_BRAIN: "claude", // engine parser; the CLI itself is the mock sh below
        BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3; printf '{\"type\":\"result\",\"result\":\"recovered-answer\"}\\n'"]),
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
        await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "crash question".length, { label: "crash question received" });
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

  test("removing an allowlisted peer drops its restored session", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    let bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: { BOT_SUBSCRIBE: "0", BOT_ALLOWED_PEERS: CLIENT_ACCOUNT },
    });
    try {
      const first = await runClient(node.url, [], ["allowlisted opener", "before removal"]);
      assert.equal(first.code, 0, `client failed:\n${first.out}`);
      await bot.stop();

      bot = await startBot({
        endpoint: node.url,
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
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const slowBrain = {
      BOT_SUBSCRIBE: "0",
      BOT_BRAIN: "claude",
      BOT_AI_CMD: "sh",
      BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3; printf '{\"type\":\"result\",\"result\":\"graceful-recovered\"}\\n'"]),
      BOT_THINKING_TEXT: "",
    };
    let bot = await startBot({ endpoint: node.url, stateDir, extraEnv: slowBrain });
    try {
      const opener = await runClient(node.url, [], ["graceful opener", "warmup"]);
      assert.equal(opener.code, 0, opener.out);

      const clientDone = runClient(node.url, ["--no-opener", "1"], ["graceful question"]);
      await bot.waitFor(
        (event) => event.event === "BOT_RECEIVED_TEXT" && event.chars === "graceful question".length,
        { label: "graceful question received" },
      );
      await bot.stop("SIGTERM");
      await clientDone;

      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      assert.equal(state.owed?.some((owed) => owed.t === "graceful question"), true, "graceful shutdown lost owed work");

      bot = await startBot({ endpoint: node.url, stateDir, extraEnv: slowBrain });
      const restored = await bot.waitFor((event) => event.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.owed >= 1, true, `expected owed >= 1, got ${restored.owed}`);
      await bot.waitFor((event) => event.event === "BOT_SENT_TEXT", { label: "recovered direct reply", timeoutMs: 20_000 });
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("bridge surface: /inbound shape, /media, reply/edit/react, events", async () => {
    const node = await startMockStatementNode();
    const hop = await startMockHopNode();
    const stateDir = tmpState();
    const photo = new Uint8Array(crypto.randomBytes(200_000));
    const file = hop.putFile(photo);
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      // Thinking placeholder disabled: this test exercises the raw bridge
      // contract; the live-reply lifecycle has its own dedicated test.
      extraEnv: { BOT_SUBSCRIBE: "0", BOT_BRAIN: "bridge", BOT_HOP_ALLOW_INSECURE: "1", BOT_THINKING_TEXT: "" },
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
      const client1 = runClient(node.url, ["--attach", attachSpecOf(file, photo)], ["bridge opener"]);
      // Opener arrives over the bridge; answer it as a quote so the client's
      // exit-0 rule (a reply + an ACK) is satisfied.
      const opener = await pump((i) => i.text === "bridge opener", { label: "opener" });
      assert.match(opener.delivery_id, /^[0-9A-F-]{36}$/);
      assert.match(opener.lease_id, /^[0-9A-F-]{36}$/);
      const sent = await post("/send", { chat_id: opener.chat_id, text: "seen it", reply_to: opener.message_id });
      assert.equal(sent.success, true, JSON.stringify(sent));
      assert.match(sent.message_id, /^[0-9A-F-]{36}$/, "expected a real envelope UUID");

      // The caption-less photo: synthesized text, attachment metadata without the
      // claim ticket, bytes served at /media.
      const photoItem = await pump((i) => i.attachments?.length > 0, { label: "photo item" });
      assert.equal(photoItem.kind, "richText");
      assert.match(photoItem.text, /\[photo, image\/jpeg/);
      const [att] = photoItem.attachments;
      assert.equal(att.downloaded, true, JSON.stringify(att));
      assert.equal(att.url, `/media/${bytesToHex(file.identifier)}`);
      assert.equal(att.mime, "image/jpeg");
      assert.equal(Object.keys(att).some((k) => /ticket|ct/i.test(k)), false, "claim ticket leaked across the bridge");
      const served = Buffer.from(await fetch(`${base}${att.url}`, { headers: authHeaders }).then((r) => r.arrayBuffer()));
      assert.equal(Buffer.compare(served, photo), 0, "served media differs from the uploaded photo");

      // Edit the earlier reply in place, then check the send path recorded it.
      // (edit_of is throttled/coalesced through the live outbox, so the actual
      // submit is asynchronous — wait for the log event.)
      const edited = await post("/send", { chat_id: opener.chat_id, text: "seen it (edited)", edit_of: sent.message_id });
      assert.equal(edited.success, true, JSON.stringify(edited));
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT" && e.editOf === sent.message_id, { label: "edit submitted" });
      const both = await post("/send", { chat_id: opener.chat_id, text: "x", reply_to: "a", edit_of: "b" });
      assert.equal(both.success, false, "reply_to+edit_of must be rejected");
      await client1;

      // Second client run: the bot answers "ping", the client reacts to that
      // reply, and the reaction surfaces only on the events=1 poller.
      const client2 = runClient(node.url, ["--no-opener", "1", "--react", "💯"], ["ping"]);
      const ping = await pump((i) => i.text === "ping", { label: "ping" });
      const pong = await post("/send", { chat_id: ping.chat_id, text: "pong" });
      assert.equal(pong.success, true);
      const reactionEvent = await pump((i) => i.kind === "reaction", { events: true, label: "reaction event" });
      assert.equal(reactionEvent.emoji, "💯");
      assert.equal(reactionEvent.target_message_id, pong.message_id, "reaction targets the bot's pong");
      // Outbound reaction route.
      const reacted = await post("/react", { chat_id: ping.chat_id, message_id: ping.message_id, emoji: "👀" });
      assert.equal(reacted.success, true, JSON.stringify(reacted));
      await bot.waitFor((e) => e.event === "BOT_SENT_REACTION", { label: "BOT_SENT_REACTION" });
      await client2;
    } finally {
      await bot.stop();
      await node.close();
      await hop.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("/file put saves a same-message attachment in the durable peer vault", async () => {
    const node = await startMockStatementNode();
    const hop = await startMockHopNode();
    const stateDir = tmpState();
    const bytes = new Uint8Array(Buffer.from("durable client attachment\n"));
    const attachment = hop.putFile(bytes);
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: { BOT_SUBSCRIBE: "0", BOT_HOP_ALLOW_INSECURE: "1" },
    });
    try {
      const result = await runClient(node.url, [
        "--attach", attachSpecOf(attachment, bytes, "text/plain"),
        "--attach-caption", "/file put incoming/spec.txt",
        "--wait-secs", "14",
      ], ["file vault opener"]);
      assert.equal(result.code, 0, `client failed:\n${result.out}`);
      assert.match(result.out, /Saved incoming\/spec\.txt/, `file command did not reply:\n${result.out}`);
      assert.doesNotMatch(result.out, /Echo: \/file put/, "file commands must not be passed to the brain");

      const saved = await bot.waitFor(
        (event) => event.event === "BOT_FILE_SAVED" && event.path === "incoming/spec.txt",
        { label: "BOT_FILE_SAVED" },
      );
      assert.equal(saved.peer, CLIENT_ACCOUNT);
      assert.equal(saved.bytes, bytes.length);
      const vaultPath = path.join(stateDir, "files", "peers", CLIENT_ACCOUNT, "incoming", "spec.txt");
      assert.equal(Buffer.compare(fs.readFileSync(vaultPath), bytes), 0, "durable vault bytes differ from the attachment");
    } finally {
      await bot.stop();
      await node.close();
      await hop.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("bridge /files uploads, lists, retrieves, and sends a vault file", async () => {
    const node = await startMockStatementNode();
    const hop = await startMockHopNode();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0",
        BOT_HOP_ALLOW_INSECURE: "1",
        BOT_HOP_UPLOAD_NODE: hop.url,
      },
    });
    const base = `http://127.0.0.1:${bot.bridgePort}`;
    const authHeaders = { authorization: `Bearer ${bot.bridgeToken}` };
    const vaultPath = "exports/bridge-note.txt";
    const payload = Buffer.from("bridge durable payload\n");
    try {
      // Establish the encrypted device session before bridge-driven file delivery.
      const opener = await runClient(node.url, ["--wait-secs", "12"], ["bridge file opener", "bridge file warmup"]);
      assert.equal(opener.code, 0, `client failed:\n${opener.out}`);

      const putResponse = await fetch(`${base}/files/${CLIENT_ACCOUNT}/${vaultPath}`, {
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

      const listResponse = await fetch(`${base}/files/${CLIENT_ACCOUNT}?prefix=exports`, { headers: authHeaders });
      assert.equal(listResponse.status, 200);
      const listed = await listResponse.json();
      assert.equal(listed.success, true);
      assert.equal(listed.files.length, 1);
      assert.equal(listed.files[0].path, vaultPath);
      assert.equal(listed.files[0].mime, "text/plain");
      assert.equal(listed.files[0].size, payload.length);
      assert.equal(Object.hasOwn(listed.files[0], "peer"), false, "bridge listing must not expose a peer namespace field");

      const getResponse = await fetch(`${base}/files/${CLIENT_ACCOUNT}/${vaultPath}`, { headers: authHeaders });
      assert.equal(getResponse.status, 200);
      assert.match(getResponse.headers.get("content-type") ?? "", /^text\/plain/);
      const fetched = Buffer.from(await getResponse.arrayBuffer());
      assert.equal(Buffer.compare(fetched, payload), 0, "bridge GET returned different durable-file bytes");

      const sendResponse = await fetch(`${base}/send`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: CLIENT_ACCOUNT,
          text: "Bridge file delivery",
          file_path: vaultPath,
        }),
      });
      assert.equal(sendResponse.status, 200);
      const sent = await sendResponse.json();
      assert.equal(sent.success, true, JSON.stringify(sent));
      assert.match(sent.message_id, /^[0-9A-F-]{36}$/);
      await bot.waitFor((event) => event.event === "BOT_SENT_FILE", { label: "BOT_SENT_FILE" });
      assert.equal(hop.submissions.length, 2, "small file upload should submit one encrypted chunk and metadata");
      const expectedSigner = `0x${bytesToHex(deriveSr25519PairFromSeed(hexToBytes(BOT_SEED), "//allowance//bulletin//chat").publicKey)}`;
      assert.ok(hop.submissions.every((submission) => submission.signer === expectedSigner), "outbound HOP upload used the wrong signer");

      // The deterministic device client sees the rich-text caption and ACKs it;
      // its own follow-up makes the run wait long enough to observe the file.
      const recipient = await runClient(node.url, ["--no-opener", "1", "--wait-secs", "14"], ["bridge file follow-up"]);
      assert.equal(recipient.code, 0, `recipient failed:\n${recipient.out}`);
      assert.match(recipient.out, /Bridge file delivery/, `outbound file caption was not delivered:\n${recipient.out}`);
    } finally {
      await bot.stop();
      await node.close();
      await hop.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("bridge leases renew long work and reject stale acknowledgements", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url,
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
      const client = runClient(node.url, [], ["lease question"]);
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

      await new Promise((resolve) => setTimeout(resolve, 1_100));
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
      const result = await client;
      assert.match(result.out, /lease answer/);
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

  test("live reply: placeholder becomes progress frames, then the answer", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({ endpoint: node.url, stateDir, extraEnv: liveBrainEnv });
    try {
      // Two texts: the follow-up rides the device channel and earns the client
      // its exit-0 ACK; both turns are slow enough to get a placeholder.
      const r = await runClient(node.url, ["--wait-secs", "16"], ["live question", "again please"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      const placeholders = bot.events.filter((e) => e.event === "BOT_LIVE_PLACEHOLDER").map((e) => e.messageId);
      assert.ok(placeholders.length >= 1, "no live placeholder was posted");
      // The placeholder bubble was seen, then edited — same message id.
      assert.match(r.out, new RegExp(`\\[BOT ${placeholders[0]}\\] ⏳ thinking…`), `placeholder not seen:\n${r.out}`);
      const edits = [...r.out.matchAll(/\[BOT EDIT ([0-9A-F-]+)\] (.*)/g)];
      assert.ok(edits.length >= 2, `expected progress + final edits, got:\n${r.out}`);
      assert.ok(edits.every((m) => placeholders.includes(m[1])), `edits must target placeholders:\n${r.out}`);
      // A progress frame carried the tool action line; a final edit carried the answer.
      assert.match(r.out, /▸ \$ npm test/, `no tool action frame:\n${r.out}`);
      assert.match(r.out, /\[BOT EDIT [0-9A-F-]+\] live final answer/, `final-as-edit missing:\n${r.out}`);
      // The ONLY plain sends are the placeholders themselves — answers arrived
      // as edits, never as second bubbles.
      const plainSends = bot.events.filter((e) => e.event === "BOT_SENT_TEXT" && !e.editOf);
      assert.equal(plainSends.length, placeholders.length, `unexpected plain sends: ${JSON.stringify(plainSends)}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("live reply: a peer that never ACKs gets a plain final message", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({ endpoint: node.url, stateDir, extraEnv: liveBrainEnv });
    try {
      // --settle-ms 0: the bot is silent for ~10s mid-window (brain + final-ACK
      // wait) before the plain fallback, so quiet-time early exit would cut it off.
      const r = await runClient(node.url, ["--no-ack", "1", "--wait-secs", "18", "--settle-ms", "0"], ["silent question", "still here"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      assert.equal(r.out.includes("[BOT EDIT"), false, `no edits may reach a non-ACKing peer:\n${r.out}`);
      assert.ok([...r.out.matchAll(/\[BOT [0-9A-F-]+\] live final answer/g)].length >= 1, `plain final missing:\n${r.out}`);
      await bot.waitFor((e) => e.event === "BOT_LIVE_FALLBACK", { label: "BOT_LIVE_FALLBACK" });
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("live reply: bridge auto-upgrade finalizes the placeholder", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url,
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
      const clientP = runClient(node.url, ["--wait-secs", "14"], ["bridge live question"]);
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
          } catch { await new Promise((r) => setTimeout(r, 250)); }
        }
        throw new Error("inbound item never arrived");
      })();
      // Wait for the placeholder, then answer with a PLAIN send: it must be
      // auto-upgraded into the placeholder's final edit.
      const placeholder = await bot.waitFor((e) => e.event === "BOT_LIVE_PLACEHOLDER", { label: "BOT_LIVE_PLACEHOLDER" });
      const sent = await post("/send", { chat_id: item.chat_id, text: "answer from harness" });
      assert.equal(sent.success, true, JSON.stringify(sent));
      assert.equal(sent.message_id, placeholder.messageId, "plain send must finalize the open placeholder");
      // Follow-up streaming edit from the harness flows through the throttled lane.
      const revised = await post("/send", { chat_id: item.chat_id, text: "answer from harness (revised)", edit_of: sent.message_id });
      assert.equal(revised.success, true, JSON.stringify(revised));
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT" && e.editOf === sent.message_id && e.chars > 20, { label: "revised edit submitted", timeoutMs: 10_000 });
      // No exit-code assertion: the client's exit rule expects a session ACK,
      // which opener-only runs never get (the opener is ACKed via the accept
      // message). The observable behavior is what matters here.
      const r = await clientP;
      assert.match(r.out, new RegExp(`\\[BOT EDIT ${placeholder.messageId}\\] answer from harness`), `upgrade edit not seen:\n${r.out}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("live reply: an unanswered placeholder resolves to a timeout note", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    // Bridge brain with NO harness attached: the answer never comes; the
    // placeholder must finalize itself instead of ticking forever.
    const bot = await startBot({
      endpoint: node.url,
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
      const r = await runClient(node.url, ["--wait-secs", "12"], ["never answered"]);
      const placeholder = await bot.waitFor((e) => e.event === "BOT_LIVE_PLACEHOLDER", { label: "BOT_LIVE_PLACEHOLDER" });
      await bot.waitFor((e) => e.event === "BOT_LIVE_TTL_EXPIRED", { label: "BOT_LIVE_TTL_EXPIRED" });
      assert.match(r.out, new RegExp(`\\[BOT EDIT ${placeholder.messageId}\\] timed out, resend please`), `timeout note not seen:\n${r.out}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: session token is captured from the stream and persisted per peer", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh", BOT_THINKING_TEXT: "",
        // Emit a claude-style init (carries session_id) then the answer.
        BOT_AI_ARGS: JSON.stringify(["-c",
          "printf '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"SES-XYZ\"}\\n'; printf '{\"type\":\"result\",\"result\":\"hi\"}\\n'"]),
      },
    });
    try {
      const r = await runClient(node.url, [], ["capture opener", "again"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT", { label: "answer sent" });
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
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url,
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
      const r = await runClient(node.url, ["--wait-secs", "6"], ["do something slow", "/stop"]);
      const stop = await bot.waitFor((e) => e.event === "BOT_STOP", { label: "BOT_STOP" });
      assert.equal(stop.stopped, true, "a running turn should have been stopped");
      assert.match(r.out, /\[BOT EDIT [0-9A-F-]+\] ⏹ Stopped\./, `stop edit not seen:\n${r.out}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: idle-silence backstop kills a wedged turn and apologizes", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        // Emit once (resets the idle timer), then go silent forever.
        BOT_AI_ARGS: JSON.stringify(["-c", "printf '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"S2\"}\\n'; sleep 120"]),
        BOT_THINKING_TEXT: "", BOT_AI_IDLE_TIMEOUT_MS: "2500",
      },
    });
    try {
      // Single opener (no device follow-up), so the client never sees a session
      // ACK and its exit rule fails — assert on behavior, not exit code.
      const r = await runClient(node.url, ["--wait-secs", "12"], ["wedge me"]);
      await bot.waitFor((e) => e.event === "BOT_AI_IDLE_TIMEOUT", { label: "BOT_AI_IDLE_TIMEOUT" });
      assert.match(r.out, /couldn't reach my agent/, `apology not sent after idle kill:\n${r.out}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: a long answer is chunked into ordered parts, none lost", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    // Three ~300-byte paragraphs against a 400-byte chunk cap -> 3+ parts. The
    // paragraphs use only sh-quote-safe characters.
    const paras = ["alpha " + "a".repeat(300), "bravo " + "b".repeat(300), "charlie " + "c".repeat(300)];
    const resultLine = JSON.stringify({ type: "result", result: paras.join("\n\n") });
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", `printf '%s\n' '${resultLine}'`]),
        BOT_THINKING_TEXT: "", BOT_REPLY_CHUNK_BYTES: "400",
      },
    });
    try {
      const r = await runClient(node.url, ["--wait-secs", "12"], ["give me a long answer", "and again"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      const chunked = await bot.waitFor((e) => e.event === "BOT_REPLY_CHUNKED", { label: "BOT_REPLY_CHUNKED" });
      assert.ok(chunked.parts >= 3, `expected >=3 parts, got ${chunked.parts}`);
      // Every paragraph reached the peer, in order, torn nowhere.
      const positions = paras.map((p) => r.out.indexOf(p));
      assert.ok(positions.every((p) => p >= 0), `missing answer parts:\n${r.out.slice(0, 2000)}`);
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, "parts arrived out of order");
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: a sent file is privately staged for the turn then cleaned up", async () => {
    const node = await startMockStatementNode();
    const hop = await startMockHopNode();
    const stateDir = tmpState();
    const bytes = new Uint8Array(Buffer.from("spec-content-123"));
    const file = hop.putFile(bytes);
    // The mock CLI answers with the prompt it was given ($1 = the verbatim
    // prompt), which carries the attachment's staged path.
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", "printf '{\"type\":\"result\",\"result\":\"PROMPT %s\"}\\n' \"$1\"", "sh", "__PROMPT__"]),
        BOT_THINKING_TEXT: "", BOT_HOP_ALLOW_INSECURE: "1",
      },
    });
    try {
      const r = await runClient(node.url, [
        "--attach", attachSpecOf(file, bytes), "--attach-caption", "here is the spec",
        "--wait-secs", "14",
      ], ["hello first", "follow-up"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      // The prompt references a private per-turn copy, not the media store;
      // that copy is removed once the engine has completed.
      const m = /PROMPT .*saved at (\S+)/.exec(r.out);
      assert.ok(m, `no staged path in the engine prompt:\n${r.out}`);
      assert.ok(m[1].includes(`${path.sep}.pca-attachment-`), `not staged into a private turn directory: ${m[1]}`);
      assert.equal(fs.existsSync(m[1]), false, "staged attachment must be cleaned up after the turn");
    } finally {
      await bot.stop();
      await node.close();
      await hop.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("engine: /project switches the turn cwd to the registered project", async () => {
    const node = await startMockStatementNode();
    const stateDir = tmpState();
    const projDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pca-proj-")));
    // The mock CLI answers with its own cwd, so the reply proves where it ran.
    const bot = await startBot({
      endpoint: node.url,
      stateDir,
      extraEnv: {
        BOT_SUBSCRIBE: "0", BOT_BRAIN: "claude", BOT_AI_CMD: "sh",
        BOT_AI_ARGS: JSON.stringify(["-c", "printf '{\"type\":\"result\",\"result\":\"cwd:%s\"}\\n' \"$(pwd)\""]),
        BOT_THINKING_TEXT: "",
        BOT_AI_PROJECTS: JSON.stringify({ proj: projDir }),
      },
    });
    try {
      const r = await runClient(node.url, ["--wait-secs", "14"], ["where are you", "/project proj", "where now"]);
      assert.equal(r.code, 0, `client failed:\n${r.out}`);
      // Turn 1: shared workspace. Command: switch confirmation. Turn 2: project dir.
      assert.match(r.out, /cwd:.*workspace/, `first turn not in the shared workspace:\n${r.out}`);
      assert.match(r.out, /Working in proj/, `switch confirmation missing:\n${r.out}`);
      assert.ok(r.out.includes(`cwd:${projDir}`), `second turn did not run in the project dir:\n${r.out}`);
    } finally {
      await bot.stop();
      await node.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  test("owed attachment survives kill -9 and re-processes after restart", async () => {
    const node = await startMockStatementNode();
    const hop = await startMockHopNode();
    const stateDir = tmpState();
    const photo = new Uint8Array(crypto.randomBytes(100_000));
    const file = hop.putFile(photo);
    const slowBrain = {
      BOT_SUBSCRIBE: "0",
      BOT_BRAIN: "claude",
      BOT_AI_CMD: "sh",
      BOT_AI_ARGS: JSON.stringify(["-c", "sleep 3; printf '{\"type\":\"result\",\"result\":\"recovered-answer\"}\\n'"]),
      BOT_THINKING_TEXT: "",
      BOT_HOP_ALLOW_INSECURE: "1",
    };
    let bot = await startBot({ endpoint: node.url, stateDir, extraEnv: slowBrain });
    try {
      const opener = await runClient(node.url, [], ["owed opener", "warmup"]);
      assert.equal(opener.code, 0, `client failed:\n${opener.out}`);

      // Photo arrives, gets ACKed and downloaded, then the bot dies mid-brain:
      // the owed journal is the only way the message comes back.
      const clientDone = runClient(node.url, ["--no-opener", "1", "--attach", attachSpecOf(file, photo), "--attach-caption", "crash photo"], []);
      await bot.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "crash photo".length, { label: "crash photo received" });
      await bot.waitFor((e) => e.event === "BOT_MEDIA_DOWNLOADED", { label: "BOT_MEDIA_DOWNLOADED" });
      await bot.stop("SIGKILL");
      await clientDone;

      const state = JSON.parse(fs.readFileSync(path.join(stateDir, "session-state.json"), "utf8"));
      const owed = state.owed?.find((o) => o.c === "crash photo");
      assert.ok(owed, `owed journal missing the photo message: ${JSON.stringify(state.owed)}`);
      assert.equal(owed.a?.[0]?.i, bytesToHex(file.identifier), "journal lost the attachment identifier");
      assert.ok(owed.a?.[0]?.ct, "journal lost the claim ticket (restart couldn't re-download)");

      bot = await startBot({ endpoint: node.url, stateDir, extraEnv: slowBrain });
      const restored = await bot.waitFor((e) => e.event === "BOT_STATE_RESTORED", { label: "BOT_STATE_RESTORED" });
      assert.equal(restored.owed >= 1, true, `expected owed >= 1, got ${restored.owed}`);
      await bot.waitFor((e) => e.event === "BOT_SENT_TEXT", { label: "owed reply sent", timeoutMs: 20_000 });
      const replies = await runClient(node.url, ["--no-opener", "1"], ["post-crash ping"]);
      assert.match(replies.out, /recovered-answer/, `owed reply not observed:\n${replies.out}`);
    } finally {
      await bot.stop();
      await node.close();
      await hop.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
