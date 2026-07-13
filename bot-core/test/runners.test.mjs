import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNNERS, toolActionTitle, resolveEngine, ENGINES } from "../lib/runners.mjs";

// Accumulate a fixture event stream through an engine's parseEvent the way
// bot-core's loop does, returning the normalized outcome.
const drive = (engine, objs) => {
  let sessionId = null, text = "", result = null, error = null;
  const actions = [];
  for (const obj of objs) {
    for (const ev of engine.parseEvent(obj)) {
      if (ev.kind === "started") sessionId ??= ev.sessionId;
      else if (ev.kind === "action") actions.push(ev.title);
      else if (ev.kind === "text") text += ev.text;
      else if (ev.kind === "result") result = ev;
      else if (ev.kind === "error") error = ev.message;
    }
  }
  const answer = error ? null : (result?.text || text);
  return { sessionId, actions, answer, error };
};

test("toolActionTitle renders known tools as one-liners", () => {
  assert.equal(toolActionTitle("Bash", { command: "cargo test" }), "$ cargo test");
  assert.equal(toolActionTitle("Read", { file_path: "/app/src/main.rs" }), "reading main.rs");
  assert.equal(toolActionTitle("Edit", { file_path: "a/b/foo.ts" }), "editing foo.ts");
  assert.equal(toolActionTitle("Grep", { pattern: "TODO" }), "searching TODO");
  assert.equal(toolActionTitle("WebSearch", { query: "polkadot" }), "searching: polkadot");
  assert.equal(toolActionTitle("MysteryTool", {}), "MysteryTool");
});

test("resolveEngine / ENGINES", () => {
  assert.deepEqual(ENGINES, ["claude", "codex", "opencode"]);
  assert.ok(resolveEngine("claude"));
  assert.equal(resolveEngine("gemini"), null);
});

// ---- claude ----------------------------------------------------------------
test("claude buildArgs: explicit no-tools default, allowlist, and bypass", () => {
  const none = RUNNERS.claude.buildArgs({ prompt: "hi" });
  assert.ok(none.includes("--permission-mode") && none[none.indexOf("--permission-mode") + 1] === "dontAsk");
  assert.ok(none.includes("--tools") && none[none.indexOf("--tools") + 1] === "");
  assert.ok(none.includes("--include-partial-messages"), "Claude live drafts require stream deltas");
  assert.ok(!none.includes("--allowedTools"));

  const fresh = RUNNERS.claude.buildArgs({ prompt: "hi", allowedTools: ["Bash", "Read", "Edit", "Write"] });
  assert.ok(fresh.includes("--tools") && fresh[fresh.indexOf("--tools") + 1] === "Bash,Read,Edit,Write");
  assert.ok(fresh.includes("--allowedTools") && fresh[fresh.indexOf("--allowedTools") + 1] === "Bash,Read,Edit,Write");
  // prompt is always last, after `--` (leading-dash safety)
  assert.equal(fresh.at(-2), "--");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.claude.buildArgs({ prompt: "next", model: "claude-sonnet-4-6", resume: "SID-1", allowedTools: ["Bash"] });
  assert.ok(resumed.includes("--resume") && resumed[resumed.indexOf("--resume") + 1] === "SID-1");
  assert.ok(resumed.includes("--model") && resumed[resumed.indexOf("--model") + 1] === "claude-sonnet-4-6");

  const skip = RUNNERS.claude.buildArgs({ prompt: "hi", skipPermissions: true, allowedTools: ["Bash"] });
  assert.ok(skip.includes("--dangerously-skip-permissions"));
  assert.ok(!skip.includes("--allowedTools"), "skip-permissions supersedes the allowlist");
  assert.ok(!skip.includes("--tools"), "skip-permissions supersedes the availability boundary");

  const hardened = RUNNERS.claude.buildArgs({ prompt: "hi", safeMode: true });
  assert.ok(hardened.includes("--safe-mode"));
  assert.ok(hardened.includes("--strict-mcp-config"));
  assert.ok(hardened.includes("--disable-slash-commands"));
});

test("claude parseEvent: session, tool action, text, result", () => {
  const out = drive(RUNNERS.claude, [
    { type: "system", subtype: "init", session_id: "CLA-1" },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "done." }] } },
    { type: "result", subtype: "success", result: "the answer", is_error: false },
  ]);
  assert.equal(out.sessionId, "CLA-1");
  assert.deepEqual(out.actions, ["$ ls"]);
  assert.equal(out.answer, "the answer"); // result.text wins over accumulated
  assert.equal(out.error, null);
});

test("claude parseEvent: is_error result surfaces an error", () => {
  const out = drive(RUNNERS.claude, [
    { type: "system", subtype: "init", session_id: "CLA-2" },
    { type: "result", subtype: "error_max_turns", result: "hit the limit", is_error: true },
  ]);
  assert.equal(out.answer, null);
  assert.match(out.error, /hit the limit/);
});

test("claude parseEvent: falls back to accumulated text when result.result is empty", () => {
  const out = drive(RUNNERS.claude, [
    { type: "assistant", message: { content: [{ type: "text", text: "partial " }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "answer" }] } },
    { type: "result", is_error: false },
  ]);
  assert.equal(out.answer, "partial answer");
});

test("claude parseEvent: stream deltas are presentation-only partial text", () => {
  const [event] = RUNNERS.claude.parseEvent({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "draft" } },
  });
  assert.deepEqual(event, { kind: "partial", text: "draft" });
  assert.deepEqual(RUNNERS.claude.parseEvent({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hidden" } },
  }), []);
});

// ---- codex -----------------------------------------------------------------
test("codex buildArgs: fresh vs resume, sandbox vs bypass", () => {
  const fresh = RUNNERS.codex.buildArgs({ prompt: "hi", model: "gpt-5" });
  assert.deepEqual(fresh.slice(0, 4), ["exec", "--json", "--skip-git-repo-check", "--color=never"]);
  assert.ok(fresh.includes("-m") && fresh[fresh.indexOf("-m") + 1] === "gpt-5");
  assert.ok(fresh.includes("-s") && fresh[fresh.indexOf("-s") + 1] === "workspace-write");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.codex.buildArgs({ prompt: "more", resume: "THREAD-9" });
  const ri = resumed.indexOf("resume");
  assert.deepEqual(resumed.slice(ri), ["resume", "THREAD-9", "more"]);

  const bypass = RUNNERS.codex.buildArgs({ prompt: "hi", skipPermissions: true });
  assert.ok(bypass.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!bypass.includes("-s"), "bypass supersedes the sandbox flag");
});

test("codex parseEvent: thread id is the session, turn.failed is an error", () => {
  const started = drive(RUNNERS.codex, [{ type: "thread.started", thread_id: "TH-1" }, { type: "turn.started" }]);
  assert.equal(started.sessionId, "TH-1");

  const failed = drive(RUNNERS.codex, [
    { type: "thread.started", thread_id: "TH-2" },
    { type: "turn.failed", error: { message: "usage limit" } },
  ]);
  assert.match(failed.error, /usage limit/);
});

test("codex parseEvent: command action + agent_message answer", () => {
  const out = drive(RUNNERS.codex, [
    { type: "thread.started", thread_id: "TH-3" },
    { type: "item.started", item: { type: "command_execution", command: "npm test" } },
    { type: "item.completed", item: { type: "agent_message", text: "all green" } },
    { type: "turn.completed" },
  ]);
  assert.equal(out.sessionId, "TH-3");
  assert.deepEqual(out.actions, ["$ npm test"]);
  assert.equal(out.answer, "all green");
});

// ---- opencode --------------------------------------------------------------
test("opencode buildArgs: session, model, numeric-prompt workaround", () => {
  const fresh = RUNNERS.opencode.buildArgs({ prompt: "hi", model: "google/gemini-2.5-pro" });
  assert.deepEqual(fresh.slice(0, 3), ["run", "--format", "json"]);
  assert.ok(fresh.includes("--model") && fresh[fresh.indexOf("--model") + 1] === "google/gemini-2.5-pro");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.opencode.buildArgs({ prompt: "more", resume: "ses_abc" });
  assert.ok(resumed.includes("--session") && resumed[resumed.indexOf("--session") + 1] === "ses_abc");

  assert.equal(RUNNERS.opencode.buildArgs({ prompt: "42" }).at(-1), "42.", "numeric prompt gets a trailing dot");

  const skip = RUNNERS.opencode.buildArgs({ prompt: "hi", skipPermissions: true });
  assert.ok(skip.includes("--dangerously-skip-permissions"));
});

test("opencode parseEvent: sessionID capture, tool, text, step_finish", () => {
  const out = drive(RUNNERS.opencode, [
    { type: "step_start", sessionID: "ses_1" },
    { type: "tool_use", tool: "read", input: { file_path: "x.ts" }, sessionID: "ses_1" },
    { type: "text", text: "hi there", sessionID: "ses_1" },
    { type: "step_finish", reason: "stop", sessionID: "ses_1" },
  ]);
  assert.equal(out.sessionId, "ses_1");
  assert.deepEqual(out.actions, ["reading x.ts"]);
  assert.equal(out.answer, "hi there");
});

test("opencode parseEvent: error event", () => {
  const out = drive(RUNNERS.opencode, [
    { type: "error", sessionID: "ses_2", error: { name: "APIError", data: { message: "model not found" } } },
  ]);
  assert.match(out.error, /model not found/);
});

// ---- custom (escape hatch) -------------------------------------------------
test("custom engine reuses claude parsing but has no fixed command", () => {
  assert.equal(RUNNERS.custom.command, null);
  const out = drive(RUNNERS.custom, [
    { type: "system", subtype: "init", session_id: "C-1" },
    { type: "result", result: "ok", is_error: false },
  ]);
  assert.equal(out.sessionId, "C-1");
  assert.equal(out.answer, "ok");
});

test("reasoning effort maps to each engine's own flag", () => {
  const claude = RUNNERS.claude.buildArgs({ prompt: "hi", effort: "high", allowedTools: ["Bash"] });
  assert.ok(claude.includes("--effort") && claude.includes("high"));
  const codex = RUNNERS.codex.buildArgs({ prompt: "hi", effort: "minimal" });
  assert.ok(codex.includes("-c") && codex.includes("model_reasoning_effort=minimal"));
  // opencode has no reasoning flag; the engine advertises that.
  assert.equal(RUNNERS.opencode.effortLevels, null);
  assert.deepEqual(RUNNERS.claude.effortLevels, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(RUNNERS.codex.effortLevels, ["minimal", "low", "medium", "high", "xhigh"]);
  // No effort -> no flag.
  assert.equal(RUNNERS.claude.buildArgs({ prompt: "hi", allowedTools: ["Bash"] }).includes("--effort"), false);
});

test("claude result events carry token/cost usage", () => {
  const [ev] = RUNNERS.claude.parseEvent({
    type: "result", result: "done", is_error: false,
    usage: { input_tokens: 1200, output_tokens: 345 }, total_cost_usd: 0.0123,
  });
  assert.equal(ev.kind, "result");
  assert.deepEqual(ev.usage, { inputTokens: 1200, outputTokens: 345, costUsd: 0.0123 });
  // No usage reported -> no usage field.
  const [bare] = RUNNERS.claude.parseEvent({ type: "result", result: "done", is_error: false });
  assert.equal(bare.usage, undefined);
});

test("codex turn.completed carries token usage", () => {
  const [ev] = RUNNERS.codex.parseEvent({ type: "turn.completed", usage: { input_tokens: 900, output_tokens: 88 } });
  assert.equal(ev.kind, "result");
  assert.deepEqual(ev.usage, { inputTokens: 900, outputTokens: 88 });
});
