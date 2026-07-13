import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAgentEnvironment,
  createAgentRuntime,
  isSafePrivateStagingRoot,
  isSafePrivilegedStagingParent,
} from "../lib/agent-runtime.mjs";
import { RUNNERS } from "../lib/runners.mjs";

// A runtime wired to a mock "CLI": `sh -c <script>` emitting claude-shaped
// stream-json, and a fake chat surface capturing what the peer would see.
const makeRuntime = ({ script, workspaces = null, workspace, ...runtimeOptions } = {}) => {
  const ws = workspace ?? fs.mkdtempSync(path.join(os.tmpdir(), "pca-agent-"));
  const sent = [];      // chat.sendText (commands, errors)
  const delivered = []; // chat.deliver (answers)
  const events = [];
  let persists = 0;
  const runtime = createAgentRuntime({
    engine: RUNNERS.claude,
    engineName: "claude",
    engineCommand: "sh",
    buildArgs: () => ["-c", script ?? `printf '{"type":"system","subtype":"init","session_id":"S1"}\\n{"type":"result","result":"the answer","usage":{"input_tokens":100,"output_tokens":7},"total_cost_usd":0.01}\\n'`],
    workspace: ws,
    workspaces,
    idleMs: 10_000,
    renderMessage: (msg) => msg.text,
    chat: {
      sendText: async (p, t) => { sent.push(t); },
      deliver: async (p, t) => { delivered.push(t); },
      beginTurn: () => null,
    },
    username: "unit.00",
    log: (event, extra) => events.push({ event, ...extra }),
    persist: () => { persists += 1; },
    ...runtimeOptions,
  });
  return { runtime, sent, delivered, events, workspace: ws, persists: () => persists };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fakeDirStat = (mode, uid = 0) => ({ mode, uid, isDirectory: () => true });

test("privileged attachment staging requires a root-owned sticky parent and protected root", () => {
  assert.equal(isSafePrivilegedStagingParent(fakeDirStat(0o1777)), true);
  assert.equal(isSafePrivilegedStagingParent(fakeDirStat(0o0777)), false, "the shared parent needs sticky protection");
  assert.equal(isSafePrivilegedStagingParent(fakeDirStat(0o1700)), false, "the dropped agent must be able to traverse it");
  assert.equal(isSafePrivilegedStagingParent(fakeDirStat(0o1777, 1000)), false);

  assert.equal(isSafePrivateStagingRoot(fakeDirStat(0o0711)), true);
  assert.equal(isSafePrivateStagingRoot(fakeDirStat(0o0731)), false, "the agent group must not write the root-owned staging parent");
  assert.equal(isSafePrivateStagingRoot(fakeDirStat(0o0711, 1000)), false);
});

test("a plain message runs a turn and delivers the answer with the one-time tip", async () => {
  const h = makeRuntime();
  await h.runtime.handleMessage("PEER", { text: "hi", messageId: "M1", kind: "text" });
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0], /^the answer/);
  assert.match(h.delivered[0], /\/help/);
  // Second turn: no tip repeat.
  await h.runtime.handleMessage("PEER", { text: "again", messageId: "M2", kind: "text" });
  assert.equal(h.delivered[1], "the answer");
});

test("introduced-peer state is bounded with the other per-peer runtime maps", async () => {
  const h = makeRuntime({ peerCap: 2 });
  for (const peer of ["one", "two", "three"]) {
    await h.runtime.handleMessage(peer, { text: "hi", messageId: `M-${peer}`, kind: "text" });
  }
  assert.deepEqual(h.runtime.introducedList(), ["two", "three"]);

  const restored = makeRuntime({ peerCap: 2 });
  restored.runtime.restoreIntroduced(["one", "two", "three"]);
  assert.deepEqual(restored.runtime.introducedList(), ["two", "three"]);
});

test("the resume token is captured, persisted, and exposed for the snapshot", async () => {
  const h = makeRuntime();
  await h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" });
  assert.deepEqual(h.runtime.peerSnapshot("peer"), { rs: "S1" });
  assert.ok(h.persists() >= 1, "capturing the session id must persist");
  assert.ok(h.events.some((e) => e.event === "BOT_AI_USAGE" && e.inputTokens === 100));
});

test("commands answer via sendText without spawning the engine", async () => {
  const h = makeRuntime({ script: "exit 9" }); // would fail loudly if spawned
  await h.runtime.handleMessage("peer", { text: "/ping", messageId: "M1", kind: "text" });
  assert.equal(h.delivered.length, 0);
  assert.match(h.sent[0], /pong/);
  await h.runtime.handleMessage("peer", { text: "/usage", messageId: "M2", kind: "text" });
  assert.match(h.sent[1], /No usage recorded/);
});

test("an engine failure delivers the apology, not silence", async () => {
  const h = makeRuntime({ script: "echo nope >&2; exit 1" });
  await h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" });
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0], /couldn't reach my agent/);
  assert.ok(h.events.some((e) => e.event === "BOT_AI_FAILED"));
});

test("/stop kills the running turn and the turn resolves without delivering", async () => {
  const h = makeRuntime({ script: "sleep 30" });
  const turn = h.runtime.handleMessage("peer", { text: "long job", messageId: "M1", kind: "text" });
  await new Promise((r) => setTimeout(r, 300)); // let the child spawn
  assert.equal(h.runtime.stop("peer"), true);
  await turn;
  assert.equal(h.delivered.length, 0, "a stopped turn must not deliver");
  assert.equal(h.runtime.stop("peer"), false, "nothing left to stop");
});

test("agent children receive a minimal environment with no bot or provider secrets", async () => {
  const events = [];
  const env = buildAgentEnvironment({
    parentEnv: {
      PATH: process.env.PATH,
      HOME: "/agent-home",
      BOT_SEED_HEX: "bot-signing-seed",
      BOT_STATE_DIR: "/private/bot-state",
      FAUCET_CHAT_SERVICE_SECRET: "legacy-signing-seed",
      ANTHROPIC_API_KEY: "anthropic-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENROUTER_API_KEY: "openrouter-secret",
    },
    agentEnv: { SAFE_AGENT_MODE: "test", OPENAI_API_KEY: "still-secret", BOT_STATE_DIR: "/also-private" },
    log: (event, extra) => events.push({ event, ...extra }),
  });
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.HOME, "/agent-home");
  assert.equal(env.SAFE_AGENT_MODE, "test");
  for (const key of ["BOT_SEED_HEX", "BOT_STATE_DIR", "FAUCET_CHAT_SERVICE_SECRET", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]) assert.equal(env[key], undefined);
  assert.deepEqual(events.map((e) => e.key), ["OPENAI_API_KEY", "BOT_STATE_DIR"]);

  const h = makeRuntime({
    parentEnv: { ...env, BOT_SEED_HEX: "must-not-reach-child", OPENAI_API_KEY: "must-not-reach-child" },
    agentEnv: { SAFE_AGENT_MODE: "test" },
    script: 'test -z "$BOT_SEED_HEX" && test -z "$BOT_STATE_DIR" && test -z "$FAUCET_CHAT_SERVICE_SECRET" && test -z "$ANTHROPIC_API_KEY" && test -z "$OPENAI_API_KEY" && test "$SAFE_AGENT_MODE" = test && printf \'{"type":"result","result":"clean"}\\n\'',
  });
  await h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" });
  assert.match(h.delivered[0], /^clean/);
});

test("the global turn budget queues work, rejects overflow, and lets /stop cancel queued work", async () => {
  const h = makeRuntime({
    script: 'sleep 0.4; printf \'{"type":"result","result":"done"}\\n\'',
    maxConcurrentTurns: 1,
    maxQueuedTurns: 1,
  });
  const first = h.runtime.handleMessage("one", { text: "first", messageId: "M1", kind: "text" });
  await delay(75);
  const second = h.runtime.handleMessage("two", { text: "second", messageId: "M2", kind: "text" });
  await delay(25);
  assert.deepEqual(h.runtime.queueStats(), { active: 1, queued: 1, activeCap: 1, queuedCap: 1 });

  await h.runtime.handleMessage("three", { text: "overflow", messageId: "M3", kind: "text" });
  assert.ok(h.delivered.some((text) => /busy with other requests/.test(text)));
  assert.equal(h.runtime.stop("two"), true, "a queued turn should be cancellable");
  await Promise.all([first, second]);
  assert.equal(h.delivered.filter((text) => /done/.test(text)).length, 1);
  assert.deepEqual(h.runtime.queueStats(), { active: 0, queued: 0, activeCap: 1, queuedCap: 1 });
});

test("shutdown cancels every active detached child and drains queued turns", async () => {
  const h = makeRuntime({
    script: "sleep 30",
    maxConcurrentTurns: 2,
    maxQueuedTurns: 2,
  });
  const first = h.runtime.handleMessage("one", { text: "first", messageId: "M1", kind: "text" });
  const second = h.runtime.handleMessage("two", { text: "second", messageId: "M2", kind: "text" });
  const queued = h.runtime.handleMessage("three", { text: "third", messageId: "M3", kind: "text" });
  await delay(300);
  await Promise.race([
    h.runtime.shutdown(),
    delay(5_000).then(() => { throw new Error("shutdown did not reap agent children"); }),
  ]);
  await Promise.all([first, second, queued]);
  assert.equal(h.delivered.length, 0);
  assert.deepEqual(h.runtime.queueStats(), { active: 0, queued: 0, activeCap: 2, queuedCap: 2 });
});

test("agent output is bounded before a malformed stream can consume unbounded memory", async () => {
  const h = makeRuntime({
    script: 'i=0; while [ "$i" -lt 4096 ]; do printf x; i=$((i + 1)); done; sleep 30',
    maxOutputBytes: 1024,
  });
  await h.runtime.handleMessage("peer", { text: "noisy", messageId: "M1", kind: "text" });
  assert.ok(h.events.some((e) => e.event === "BOT_AI_OUTPUT_LIMIT"));
  assert.match(h.delivered[0], /couldn't reach my agent/);
});

test("restore honors the engine+workspace scoping of resume tokens", () => {
  const h = makeRuntime();
  // Same engine + workspace: token restores.
  h.runtime.noteRestoredAgent({ engine: "claude", workspace: h.workspace });
  h.runtime.restorePeer("p1", { rs: "TOK" });
  assert.deepEqual(h.runtime.peerSnapshot("p1"), { rs: "TOK" });
  // Different workspace: token dropped for shared-workspace peers.
  const h2 = makeRuntime();
  h2.runtime.noteRestoredAgent({ engine: "claude", workspace: "/somewhere/else" });
  h2.runtime.restorePeer("p1", { rs: "TOK" });
  assert.deepEqual(h2.runtime.peerSnapshot("p1"), {});
  assert.ok(h2.events.some((e) => e.event === "BOT_RESUME_INVALIDATED"));
  // A project peer whose project vanished loses both project and token.
  const h3 = makeRuntime();
  h3.runtime.noteRestoredAgent({ engine: "claude", workspace: h3.workspace });
  h3.runtime.restorePeer("p1", { rs: "TOK", pj: "ghost" });
  assert.deepEqual(h3.runtime.peerSnapshot("p1"), {});
  assert.ok(h3.events.some((e) => e.event === "BOT_PROJECT_DROPPED"));
});

test("downloaded attachments are privately staged for a turn then cleaned up", async () => {
  const blob = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pca-media-")), "abc123.jpg");
  fs.writeFileSync(blob, "img-bytes");
  let stagedPath = null;
  const h = makeRuntime({
    renderMessage: (message) => {
      stagedPath = message.attachments[0].path;
      assert.equal(fs.readFileSync(stagedPath, "utf8"), "img-bytes");
      return message.text;
    },
  });
  const msg = { text: "look", messageId: "M1", kind: "richText", attachments: [{ id: "abc123", downloaded: true, path: blob, mime: "image/jpeg", size: 9, fileKind: "image" }] };
  await h.runtime.handleMessage("peer", msg);
  assert.match(stagedPath, new RegExp(`^${h.workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.pca-attachment-.+/0-abc123\\.jpg$`));
  assert.equal(fs.existsSync(stagedPath), false, "per-turn attachment copy must be removed");
  assert.equal(msg.attachments[0].path, blob, "message metadata must retain the cache path after cleanup");
});
