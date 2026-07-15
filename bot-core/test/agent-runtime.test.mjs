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
  const partials = [];  // presentation-only streamed final-text deltas
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
      beginTurn: () => {
        const onAction = () => {};
        onAction.onPartial = (text) => partials.push(text);
        return onAction;
      },
    },
    username: "unit.00",
    log: (event, extra) => events.push({ event, ...extra }),
    persist: () => { persists += 1; },
    ...runtimeOptions,
  });
  return { runtime, sent, delivered, partials, events, workspace: ws, persists: () => persists };
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

test("final-text stream deltas reach the transport without changing the durable answer", async () => {
  const h = makeRuntime({
    script: `printf '%s\\n' \
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"draft "}}}' \
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}}' \
      '{"type":"assistant","message":{"content":[{"type":"text","text":"the final answer"}]}}' \
      '{"type":"result","is_error":false,"result":"the final answer"}'`,
  });
  await h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" });
  assert.deepEqual(h.partials, ["draft ", "answer"]);
  assert.match(h.delivered[0], /^the final answer/);
  assert.doesNotMatch(h.delivered[0], /draft answer/);
});

test("a durable transport can opt into reply-delivery failures propagating to its ingress journal", async () => {
  const h = makeRuntime({
    throwOnReplyFailure: true,
    chat: {
      sendText: async () => {},
      deliver: async () => { throw new Error("statement submission unavailable"); },
      beginTurn: () => null,
    },
  });
  await assert.rejects(
    h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" }),
    /statement submission unavailable/,
  );
  assert.ok(h.events.some((event) => event.event === "BOT_REPLY_FAILED"));
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

test("a transport can isolate model sessions while keeping one delivery target", async () => {
  const deliveries = [];
  const h = makeRuntime({
    chat: {
      sendText: async () => {},
      deliver: async (peer, text) => deliveries.push({ peer, text }),
      beginTurn: () => null,
    },
  });
  const chat = "t3ams:channel:workspace:general";
  const firstThread = `${chat}:thread:first`;
  const secondThread = `${chat}:thread:second`;

  await h.runtime.handleMessage(chat, { text: "first", messageId: "M1", kind: "text", sessionKey: firstThread });
  await h.runtime.handleMessage(chat, { text: "second", messageId: "M2", kind: "text", sessionKey: secondThread });

  assert.deepEqual(h.runtime.peerSnapshot(firstThread), { rs: "S1" });
  assert.deepEqual(h.runtime.peerSnapshot(secondThread), { rs: "S1" });
  assert.deepEqual(h.runtime.peerSnapshot(chat), {});
  assert.deepEqual(new Set(h.runtime.stateKeys()), new Set([firstThread, secondThread]));
  assert.deepEqual(deliveries.map(({ peer }) => peer), [chat, chat]);
  // Discovery remains one hint per visible chat, not one hint per thread.
  assert.match(deliveries[0].text, /\/help/);
  assert.doesNotMatch(deliveries[1].text, /\/help/);
});

test("an opaque delivery context follows one turn without entering the model prompt", async () => {
  const began = [];
  const delivered = [];
  const prompts = [];
  const context = Object.freeze({ chatId: "t3ams:channel:one", laneKey: "lane:thread-a", threadRootId: "a" });
  const h = makeRuntime({
    renderMessage: (message) => {
      prompts.push(message);
      return message.text;
    },
    chat: {
      sendText: async () => {},
      deliver: async (peer, text, supplied) => delivered.push({ peer, text, supplied }),
      beginTurn: (peer, supplied) => {
        began.push({ peer, supplied });
        return null;
      },
    },
  });

  await h.runtime.handleMessage("t3ams:channel:one", {
    text: "reply in the first thread",
    messageId: "M1",
    kind: "text",
    sessionKey: "lane:thread-a",
    deliveryContext: context,
  });

  assert.deepEqual(began.map((call) => call.supplied), [context]);
  assert.deepEqual(delivered.map((call) => call.supplied), [context]);
  assert.equal(prompts[0]?.deliveryContext, undefined);
  assert.equal(prompts[0]?.text, "reply in the first thread");
});

test("commands answer via sendText without spawning the engine", async () => {
  const h = makeRuntime({ script: "exit 9" }); // would fail loudly if spawned
  await h.runtime.handleMessage("peer", { text: "/ping", messageId: "M1", kind: "text" });
  assert.equal(h.delivered.length, 0);
  assert.match(h.sent[0], /pong/);
  await h.runtime.handleMessage("peer", { text: "/usage", messageId: "M2", kind: "text" });
  assert.match(h.sent[1], /No usage recorded/);
});

test("a transport-supplied command candidate handles mentioned channel commands without spawning the engine", async () => {
  const h = makeRuntime({ script: "exit 9" }); // would fail loudly if spawned
  await h.runtime.handleMessage("peer", {
    text: "@dotbot /help",
    commandText: "/help",
    messageId: "M1",
    kind: "text",
  });
  assert.equal(h.delivered.length, 0);
  assert.match(h.sent[0], /^Commands:/);
  assert.ok(h.events.some((event) => event.event === "BOT_COMMAND" && event.command === "/help"));
});

test("model overrides are persisted and removed with /model default", async () => {
  const h = makeRuntime({ model: "sonnet", allowedModels: ["sonnet", "opus"] });
  await h.runtime.handleMessage("peer", { text: "/model opus", messageId: "M1", kind: "text" });
  assert.deepEqual(h.runtime.peerSnapshot("peer"), { mo: "opus" });
  assert.ok(h.persists() >= 1, "model override must survive a restart");
  await h.runtime.handleMessage("peer", { text: "/model default", messageId: "M2", kind: "text" });
  assert.deepEqual(h.runtime.peerSnapshot("peer"), {});
  assert.ok(h.persists() >= 2, "reverting the model must remove the persisted override");
});

test("a thread-only reasoning override persists and restores with its session", async () => {
  const chat = "t3ams:channel:workspace:general";
  const thread = `${chat}:thread:thread-one`;
  const source = makeRuntime({ reasoning: "medium" });
  await source.runtime.handleMessage(chat, {
    text: "/reasoning high", messageId: "M1", kind: "text", sessionKey: thread,
  });
  assert.deepEqual(source.runtime.peerSnapshot(thread), { ro: "high" });
  assert.deepEqual(source.runtime.peerSnapshot(chat), {});
  assert.deepEqual(source.runtime.stateKeys(), [thread]);

  const restored = makeRuntime({ reasoning: "medium" });
  restored.runtime.restorePeer(thread, source.runtime.peerSnapshot(thread));
  assert.deepEqual(restored.runtime.peerSnapshot(thread), { ro: "high" });

  const revoked = makeRuntime({ engine: { ...RUNNERS.claude, effortLevels: ["low"] } });
  revoked.runtime.restorePeer(thread, { ro: "high" });
  assert.deepEqual(revoked.runtime.peerSnapshot(thread), {});
  assert.ok(revoked.events.some((event) => event.event === "BOT_REASONING_OVERRIDE_DROPPED"));
});

test("usage-only state is excluded from durable session keys", async () => {
  const h = makeRuntime({
    script: `printf '{"type":"result","result":"done","usage":{"input_tokens":1}}\\n'`,
  });
  await h.runtime.handleMessage("usage-only", { text: "hi", messageId: "M1", kind: "text" });
  assert.deepEqual(h.runtime.peerSnapshot("usage-only"), {});
  assert.deepEqual(h.runtime.stateKeys(), []);
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

test("/stop can target a threaded session without cancelling by its base delivery chat", async () => {
  const h = makeRuntime({ script: "sleep 30" });
  const chat = "t3ams:channel:workspace:general";
  const thread = `${chat}:thread:root-message`;
  const turn = h.runtime.handleMessage(chat, {
    text: "long threaded job",
    messageId: "M1",
    kind: "text",
    sessionKey: thread,
  });
  await new Promise((resolve) => setTimeout(resolve, 300)); // let the child spawn
  assert.equal(h.runtime.stop(chat), false, "the base delivery chat is not this thread session");
  assert.equal(h.runtime.stop(chat, thread), true);
  await turn;
  assert.equal(h.delivered.length, 0, "a targeted threaded stop must suppress its reply");
});

test("agent children receive a minimal environment with no bot or provider secrets", async () => {
  const events = [];
  const env = buildAgentEnvironment({
    parentEnv: {
      PATH: process.env.PATH,
      HOME: "/agent-home",
      BOT_SEED_HEX: "bot-signing-seed",
      BOT_STATE_DIR: "/private/bot-state",
      EXTRA_SECRET: "unrelated-secret",
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
  for (const key of ["BOT_SEED_HEX", "BOT_STATE_DIR", "EXTRA_SECRET", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]) assert.equal(env[key], undefined);
  assert.deepEqual(events.map((e) => e.key), ["OPENAI_API_KEY", "BOT_STATE_DIR"]);

  const h = makeRuntime({
    parentEnv: { ...env, BOT_SEED_HEX: "must-not-reach-child", OPENAI_API_KEY: "must-not-reach-child" },
    agentEnv: { SAFE_AGENT_MODE: "test" },
    script: 'test -z "$BOT_SEED_HEX" && test -z "$BOT_STATE_DIR" && test -z "$EXTRA_SECRET" && test -z "$ANTHROPIC_API_KEY" && test -z "$OPENAI_API_KEY" && test "$SAFE_AGENT_MODE" = test && printf \'{"type":"result","result":"clean"}\\n\'',
  });
  await h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" });
  assert.match(h.delivered[0], /^clean/);
});

test("direct-agent output artifacts are flat, bounded, snapshotted before delivery, and expose PCA_OUTPUT_DIR only for an artifact transport", async () => {
  let observed = [];
  let snapshotDir = null;
  let renderedOutputDir = null;
  let buildInput = null;
  let environmentInput = null;
  const outputScript = [
    'test -n "$PCA_OUTPUT_DIR"',
    'printf "first" > "$PCA_OUTPUT_DIR/b.txt"',
    'printf "second" > "$PCA_OUTPUT_DIR/a.txt"',
    'printf "third" > "$PCA_OUTPUT_DIR/c.txt"',
    'mkdir "$PCA_OUTPUT_DIR/nested"',
    'printf "nested" > "$PCA_OUTPUT_DIR/nested/ignored.txt"',
    'ln -s a.txt "$PCA_OUTPUT_DIR/linked.txt"',
    'printf \'{"type":"result","result":"done"}\\n\'',
  ].join("; ");
  const h = makeRuntime({
    maxOutputArtifacts: 2,
    buildArgs: (input) => {
      buildInput = input;
      return ["-c", outputScript];
    },
    buildTurnEnvironment: (input) => {
      environmentInput = input;
      return {};
    },
    renderMessage: (message) => {
      renderedOutputDir = message.outputDir ?? null;
      return message.text;
    },
    chat: {
      sendText: async () => {},
      deliver: async () => {},
      beginTurn: () => null,
      deliverArtifacts: async (peerHex, artifacts) => {
        assert.equal(peerHex, "peer");
        snapshotDir = path.dirname(artifacts[0].filePath);
        assert.equal(fs.existsSync(snapshotDir), true, "the callback must receive files before cleanup");
        assert.notEqual(snapshotDir, buildInput.outputDir, "the transport must receive a snapshot, not the agent-writable directory");
        assert.equal(fs.existsSync(buildInput.outputDir), false, "the agent-writable handoff directory must be gone before delivery");
        observed = artifacts.map((artifact) => ({
          ...artifact,
          contents: fs.readFileSync(artifact.filePath, "utf8"),
        }));
      },
    },
  });

  await h.runtime.handleMessage("peer", { text: "make files", messageId: "M1", kind: "text" });

  assert.deepEqual(observed, [
    { filename: "a.txt", filePath: path.join(snapshotDir, "a.txt"), size: 6, contents: "second" },
    { filename: "b.txt", filePath: path.join(snapshotDir, "b.txt"), size: 5, contents: "first" },
  ]);
  assert.match(renderedOutputDir, /\.pca-output-/);
  assert.equal(path.isAbsolute(renderedOutputDir), false, "the model receives a workspace-relative output path");
  assert.equal(path.resolve(h.workspace, renderedOutputDir), buildInput.outputDir, "the prompt path resolves to the runner-scoped output leaf");
  assert.equal(environmentInput.outputDir, buildInput.outputDir, "runner environment receives the absolute scoped output path");
  assert.equal(fs.existsSync(snapshotDir), false, "the private transport snapshot must be removed after delivery");
});
test("a durable deliverTurn handoff receives immutable artifacts and final text together", async () => {
  const turns = [];
  const h = makeRuntime({
    script: 'printf image > "$PCA_OUTPUT_DIR/chart.png"; printf \'{"type":"result","result":"done"}\\n\'',
    chat: {
      sendText: async () => {},
      deliver: async () => { throw new Error("separate delivery must not run"); },
      deliverArtifacts: async () => { throw new Error("separate artifact delivery must not run"); },
      deliverTurn: async (peerHex, turn) => {
        assert.equal(peerHex, "peer");
        assert.equal(turn.text.startsWith("done"), true);
        assert.equal(turn.artifacts.length, 1);
        assert.equal(fs.readFileSync(turn.artifacts[0].filePath, "utf8"), "image");
        turns.push({ text: turn.text, filename: turn.artifacts[0].filename });
      },
      beginTurn: () => null,
    },
  });

  await h.runtime.handleMessage("peer", { text: "make chart", messageId: "M1", kind: "text" });
  assert.deepEqual(turns, [{ text: "done\n\n(Tip: send /help to see my commands.)", filename: "chart.png" }]);
});

test("a failed durable deliverTurn propagates and cleans its immutable snapshot", async () => {
  let snapshotDir = null;
  const h = makeRuntime({
    throwOnReplyFailure: true,
    script: 'printf output > "$PCA_OUTPUT_DIR/report.txt"; printf \'{"type":"result","result":"done"}\\n\'',
    chat: {
      sendText: async () => {},
      deliver: async () => { throw new Error("separate delivery must not run"); },
      deliverArtifacts: async () => { throw new Error("separate artifact delivery must not run"); },
      deliverTurn: async (_peerHex, turn) => {
        snapshotDir = path.dirname(turn.artifacts[0].filePath);
        assert.equal(fs.readFileSync(turn.artifacts[0].filePath, "utf8"), "output");
        throw new Error("durable handoff unavailable");
      },
      beginTurn: () => null,
    },
  });

  await assert.rejects(
    h.runtime.handleMessage("peer", { text: "make report", messageId: "M1", kind: "text" }),
    /durable handoff unavailable/,
  );
  assert.equal(fs.existsSync(snapshotDir), false, "the runtime must always remove its private snapshot");
  assert.ok(h.events.some((event) => event.event === "BOT_TURN_DELIVERY_FAILED"));
});

test("oversized direct-agent artifacts are skipped before delivery while the final reply succeeds", async () => {
  let observed = [];
  const h = makeRuntime({
    maxOutputArtifactBytes: 5,
    script: [
      'printf "small" > "$PCA_OUTPUT_DIR/ok.txt"',
      'printf "too-large" > "$PCA_OUTPUT_DIR/skip.txt"',
      'printf \'{"type":"result","result":"done"}\\n\'',
    ].join("; "),
    chat: {
      sendText: async () => {},
      deliver: async (_peerHex, text) => { observed.push({ text }); },
      beginTurn: () => null,
      deliverArtifacts: async (_peerHex, artifacts) => {
        observed.push({ artifacts: artifacts.map((artifact) => ({ filename: artifact.filename, size: artifact.size })) });
      },
    },
  });

  await h.runtime.handleMessage("peer", { text: "make files", messageId: "M1", kind: "text" });

  assert.deepEqual(observed[0], { artifacts: [{ filename: "ok.txt", size: 5 }] });
  assert.match(observed[1].text, /^done/);
  assert.ok(h.events.some((event) => event.event === "BOT_ARTIFACT_OUTPUT_SKIPPED" && event.reason === "too-large"));
});

test("cumulative direct-agent artifact cap stops later snapshots while the final reply succeeds", async () => {
  const observed = [];
  const h = makeRuntime({
    maxOutputArtifactBytes: 10,
    maxOutputArtifactTotalBytes: 7,
    script: [
      'printf "one" > "$PCA_OUTPUT_DIR/a.txt"',
      'printf "second" > "$PCA_OUTPUT_DIR/b.txt"',
      // This file would exceed the total cap. `c.txt` would fit after `a.txt`,
      // but deterministic ordering stops the turn at the first overflow.
      'printf "four" > "$PCA_OUTPUT_DIR/c.txt"',
      'printf "later" > "$PCA_OUTPUT_DIR/d.txt"',
      'printf \'{"type":"result","result":"done"}\\n\'',
    ].join("; "),
    chat: {
      sendText: async () => {},
      deliver: async (_peerHex, text) => { observed.push({ text }); },
      beginTurn: () => null,
      deliverArtifacts: async (_peerHex, artifacts) => {
        observed.push({ artifacts: artifacts.map((artifact) => ({ filename: artifact.filename, size: artifact.size })) });
      },
    },
  });

  await h.runtime.handleMessage("peer", { text: "make files", messageId: "M1", kind: "text" });

  assert.deepEqual(observed[0], { artifacts: [{ filename: "a.txt", size: 3 }] });
  assert.match(observed[1].text, /^done/);
  assert.ok(h.events.some((event) => event.event === "BOT_ARTIFACT_OUTPUT_SKIPPED"
    && event.reason === "total-limit" && event.bytes === 6 && event.usedBytes === 3 && event.maxBytes === 7));
});

test("direct-agent artifact output is disabled without a delivery callback", async () => {
  const h = makeRuntime({
    agentEnv: { PCA_OUTPUT_DIR: "/must-not-reach-the-agent" },
    script: 'test -z "${PCA_OUTPUT_DIR+x}" && printf \'{"type":"result","result":"clean"}\\n\'',
  });

  await h.runtime.handleMessage("peer", { text: "hi", messageId: "M1", kind: "text" });

  assert.match(h.delivered[0], /^clean/);
  assert.ok(h.events.some((event) => event.event === "BOT_AI_ENV_REJECTED" && event.key === "PCA_OUTPUT_DIR"));
});

test("artifact output is cleaned when a durable artifact delivery fails", async () => {
  let outputDir = null;
  const h = makeRuntime({
    throwOnReplyFailure: true,
    script: 'printf output > "$PCA_OUTPUT_DIR/report.txt"; printf \'{"type":"result","result":"done"}\\n\'',
    chat: {
      sendText: async () => {},
      deliver: async () => {},
      beginTurn: () => null,
      deliverArtifacts: async (_peerHex, artifacts) => {
        outputDir = path.dirname(artifacts[0].filePath);
        throw new Error("upload unavailable");
      },
    },
  });

  await assert.rejects(
    h.runtime.handleMessage("peer", { text: "make file", messageId: "M1", kind: "text" }),
    /upload unavailable/,
  );
  assert.equal(fs.existsSync(outputDir), false, "cleanup must run even when artifact delivery rejects");
  assert.ok(h.events.some((event) => event.event === "BOT_ARTIFACT_DELIVERY_FAILED"));
});

test("shutdown waits for an in-flight artifact handoff before removing its snapshot", async () => {
  let snapshotDir = null;
  let releaseDelivery;
  const deliveryGate = new Promise((resolve) => { releaseDelivery = resolve; });
  let signalStarted;
  const deliveryStarted = new Promise((resolve) => { signalStarted = resolve; });
  const h = makeRuntime({
    script: 'printf output > "$PCA_OUTPUT_DIR/report.txt"; printf \'{"type":"result","result":"done"}\\n\'',
    chat: {
      sendText: async () => {},
      deliver: async () => {},
      beginTurn: () => null,
      deliverArtifacts: async (_peerHex, artifacts) => {
        snapshotDir = path.dirname(artifacts[0].filePath);
        signalStarted();
        await deliveryGate;
        assert.equal(fs.existsSync(artifacts[0].filePath), true, "shutdown must retain the snapshot while the transport reads it");
      },
    },
  });

  const turn = h.runtime.handleMessage("peer", { text: "make file", messageId: "M1", kind: "text" });
  await deliveryStarted;
  let shutdownSettled = false;
  const shutdown = h.runtime.shutdown().then(() => { shutdownSettled = true; });
  await delay(25);
  assert.equal(shutdownSettled, false);
  assert.equal(fs.existsSync(snapshotDir), true);
  releaseDelivery();
  await Promise.all([turn, shutdown]);
  assert.equal(fs.existsSync(snapshotDir), false);
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

test("restore honors engine, workspace, and model scoping of resume tokens", () => {
  const h = makeRuntime({ model: "sonnet" });
  // Same engine, workspace, and model: token restores.
  h.runtime.noteRestoredAgent({ engine: "claude", workspace: h.workspace, model: "sonnet" });
  h.runtime.restorePeer("p1", { rs: "TOK" });
  assert.deepEqual(h.runtime.peerSnapshot("p1"), { rs: "TOK" });
  // Different workspace: token dropped for shared-workspace peers.
  const h2 = makeRuntime({ model: "sonnet" });
  h2.runtime.noteRestoredAgent({ engine: "claude", workspace: "/somewhere/else", model: "sonnet" });
  h2.runtime.restorePeer("p1", { rs: "TOK" });
  assert.deepEqual(h2.runtime.peerSnapshot("p1"), {});
  assert.ok(h2.events.some((e) => e.event === "BOT_RESUME_INVALIDATED"));
  // Changing the operator-selected default model also starts a new session.
  const hModel = makeRuntime({ model: "opus" });
  hModel.runtime.noteRestoredAgent({ engine: "claude", workspace: hModel.workspace, model: "sonnet" });
  hModel.runtime.restorePeer("p1", { rs: "TOK" });
  assert.deepEqual(hModel.runtime.peerSnapshot("p1"), {});
  assert.ok(hModel.events.some((e) => e.event === "BOT_RESUME_INVALIDATED"));
  // A project peer whose project vanished loses both project and token.
  const h3 = makeRuntime({ model: "sonnet" });
  h3.runtime.noteRestoredAgent({ engine: "claude", workspace: h3.workspace, model: "sonnet" });
  h3.runtime.restorePeer("p1", { rs: "TOK", pj: "ghost" });
  assert.deepEqual(h3.runtime.peerSnapshot("p1"), {});
  assert.ok(h3.events.some((e) => e.event === "BOT_PROJECT_DROPPED"));
});

test("restore preserves an approved model override and drops a revoked one with its token", () => {
  const h = makeRuntime({ model: "sonnet", allowedModels: ["sonnet", "opus"] });
  h.runtime.noteRestoredAgent({ engine: "claude", workspace: h.workspace, model: "sonnet" });
  h.runtime.restorePeer("p1", { rs: "TOK", mo: "opus" });
  assert.deepEqual(h.runtime.peerSnapshot("p1"), { rs: "TOK", mo: "opus" });

  const locked = makeRuntime({ model: "sonnet", allowedModels: ["sonnet"] });
  locked.runtime.noteRestoredAgent({ engine: "claude", workspace: locked.workspace, model: "sonnet" });
  locked.runtime.restorePeer("p1", { rs: "TOK", mo: "opus" });
  assert.deepEqual(locked.runtime.peerSnapshot("p1"), {});
  assert.ok(locked.events.some((e) => e.event === "BOT_MODEL_OVERRIDE_DROPPED"));
});

test("downloaded attachments are privately staged for a turn then cleaned up", async () => {
  const blob = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pca-media-")), "abc123.jpg");
  fs.writeFileSync(blob, "img-bytes");
  let stagedPath = null;
  let buildInput = null;
  const h = makeRuntime({
    buildArgs: (input) => {
      buildInput = input;
      return ["-c", `printf '{"type":"result","result":"done"}\\n'`];
    },
    renderMessage: (message) => {
      stagedPath = message.attachments[0].path;
      assert.equal(fs.readFileSync(stagedPath, "utf8"), "img-bytes");
      return message.text;
    },
  });
  const msg = { text: "look", messageId: "M1", kind: "richText", attachments: [{ id: "abc123", downloaded: true, path: blob, mime: "image/jpeg", size: 9, fileKind: "image" }] };
  await h.runtime.handleMessage("peer", msg);
  assert.match(stagedPath, new RegExp(`^${h.workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.pca-attachment-.+/0-abc123\\.jpg$`));
  assert.equal(buildInput.attachmentDir, path.dirname(stagedPath), "runners receive only the temporary attachment directory for scoped permissions");
  assert.equal(buildInput.workingDirectory, h.workspace, "runners also receive the primary cwd to deny its implicit Read access");
  assert.equal(fs.existsSync(stagedPath), false, "per-turn attachment copy must be removed");
  assert.equal(fs.existsSync(buildInput.attachmentDir), false, "the scoped attachment directory must be removed after the turn");
  assert.equal(msg.attachments[0].path, blob, "message metadata must retain the cache path after cleanup");
});
