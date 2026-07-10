import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentRuntime } from "../lib/agent-runtime.mjs";
import { RUNNERS } from "../lib/runners.mjs";

// A runtime wired to a mock "CLI": `sh -c <script>` emitting claude-shaped
// stream-json, and a fake chat surface capturing what the peer would see.
const makeRuntime = ({ script, workspaces = null, workspace } = {}) => {
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
  });
  return { runtime, sent, delivered, events, workspace: ws, persists: () => persists };
};

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

test("downloaded attachments are staged into the turn cwd before rendering", async () => {
  const blob = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pca-media-")), "abc123.jpg");
  fs.writeFileSync(blob, "img-bytes");
  const h = makeRuntime();
  const msg = { text: "look", messageId: "M1", kind: "richText", attachments: [{ id: "abc123", downloaded: true, path: blob, mime: "image/jpeg", size: 9, fileKind: "image" }] };
  await h.runtime.handleMessage("peer", msg);
  assert.equal(msg.attachments[0].path, path.join(h.workspace, ".attachments", "abc123.jpg"));
  assert.equal(fs.readFileSync(msg.attachments[0].path).toString(), "img-bytes");
});
