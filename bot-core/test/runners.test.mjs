import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNNERS, toolActionTitle, resolveEngine, ENGINES, toolPolicyEnforcement } from "../lib/runners.mjs";

const policy = (capabilities = [], scope = "workspace", network = "none") => ({ capabilities, scope, network });

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
test("claude compiles portable capabilities to scoped native tools", () => {
  const none = RUNNERS.claude.buildArgs({ prompt: "hi" });
  assert.ok(none.includes("--permission-mode") && none[none.indexOf("--permission-mode") + 1] === "dontAsk");
  assert.ok(none.includes("--tools") && none[none.indexOf("--tools") + 1] === "");
  assert.ok(none.includes("--include-partial-messages"), "Claude live drafts require stream deltas");
  assert.ok(!none.includes("--allowedTools"));
  assert.ok(none.includes("--setting-sources") && none[none.indexOf("--setting-sources") + 1] === "");

  const fresh = RUNNERS.claude.buildArgs({
    prompt: "hi",
    policy: policy(["read", "write", "bash"]),
    workingDirectory: "/workspace/project",
    attachmentDir: "/tmp/pca-stage/attachment",
    outputDir: "/tmp/pca-stage/output",
    protectedPaths: ["/home/node", "/state", "/app"],
  });
  assert.equal(fresh[fresh.indexOf("--tools") + 1], "Read,Glob,Grep,Edit,Write,Bash");
  const allow = fresh[fresh.indexOf("--allowedTools") + 1];
  assert.match(allow, /Read\(\/\/workspace\/project\/\*\*\)/);
  assert.match(allow, /Read\(\/\/tmp\/pca-stage\/attachment\/\*\*\)/);
  assert.match(allow, /Edit\(\/\/workspace\/project\/\*\*\)/);
  assert.match(allow, /Edit\(\/\/tmp\/pca-stage\/output\/\*\*\)/);
  assert.match(allow, /Bash\(\*\)/);
  const deny = fresh[fresh.indexOf("--disallowedTools") + 1];
  assert.match(deny, /Read\(\/\/home\/node\/\*\*\)/);
  const settings = JSON.parse(fresh[fresh.indexOf("--settings") + 1]);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(settings.sandbox.network.allowedDomains, []);
  assert.ok(settings.sandbox.filesystem.allowWrite.includes("/tmp/pca-stage/output/**"));
  // prompt is always last, after `--` (leading-dash safety)
  assert.equal(fresh.at(-2), "--");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.claude.buildArgs({ prompt: "next", model: "claude-sonnet-4-6", resume: "SID-1", policy: policy(["read"]) });
  assert.ok(resumed.includes("--resume") && resumed[resumed.indexOf("--resume") + 1] === "SID-1");
  assert.ok(resumed.includes("--model") && resumed[resumed.indexOf("--model") + 1] === "claude-sonnet-4-6");
});

test("claude read policy exposes staged attachments without shell or edits", () => {
  const args = RUNNERS.claude.buildArgs({
    prompt: "inspect the attachment",
    policy: policy(["read"]),
    workingDirectory: "/workspace",
    attachmentDir: "/tmp/pca-agent-stage-123/.pca-attachment-456",
    protectedPaths: ["/home/node", "/state"],
  });
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.match(args[args.indexOf("--allowedTools") + 1], /Read\(\/\/tmp\/pca-agent-stage-123\/\.pca-attachment-456\/\*\*\)/);
  assert.equal(args.includes("--settings"), false, "Bash is the only capability that needs Claude's command sandbox");
  assert.equal(args.includes("Bash"), false, "no shell tool is exposed");
  assert.equal(args.includes("Edit"), false, "no write tool is exposed");
});

test("claude does not deny a local workspace through its protected home ancestor", () => {
  const args = RUNNERS.claude.buildArgs({
    prompt: "inspect",
    policy: policy(["bash"]),
    workingDirectory: "/home/node/projects/demo",
    protectedPaths: ["/home/node", "/state"],
  });
  const denied = args[args.indexOf("--disallowedTools") + 1];
  assert.doesNotMatch(denied, /home\/node/);
  assert.match(denied, /state/);
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
  assert.deepEqual(settings.sandbox.filesystem.denyRead, ["/state/**"]);
});

test("claude rejects paths that could alter native permission rules", () => {
  assert.throws(
    () => RUNNERS.claude.buildArgs({ prompt: "hi", policy: policy(["read"]), workingDirectory: "/workspace/evil),Bash(*)" }),
    /unsafe for Claude permission rules/,
  );
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
test("codex compiles a custom workspace permission profile", () => {
  const fresh = RUNNERS.codex.buildArgs({ prompt: "hi", model: "gpt-5", policy: policy(["read", "write"]), workingDirectory: "/workspace/project", attachmentDir: "/tmp/pca-attachment", outputDir: "/tmp/pca-output" });
  assert.deepEqual(fresh.slice(0, 7), ["--ask-for-approval", "never", "exec", "--json", "--skip-git-repo-check", "--color=never", "--ignore-user-config"]);
  assert.ok(fresh.includes("-m") && fresh[fresh.indexOf("-m") + 1] === "gpt-5");
  assert.ok(fresh.includes("--ignore-rules"));
  assert.ok(fresh.includes("-C") && fresh[fresh.indexOf("-C") + 1] === "/workspace/project");
  assert.equal(fresh.includes("-s"), false, "the broad workspace-write profile reads :root");
  assert.ok(fresh.includes("default_permissions=\"pca\""));
  const profile = fresh.find((value) => String(value).startsWith("permissions="));
  assert.match(profile, /":minimal"="read"/);
  assert.match(profile, /":workspace_roots"=\{"\."="write"\}/);
  assert.match(profile, /"\/tmp\/pca-attachment"="read"/);
  assert.match(profile, /"\/tmp\/pca-output"="write"/);
  assert.match(profile, /network=\{enabled=false\}/);
  assert.ok(fresh.includes("features.shell_tool=false"), "read/write must not quietly enable Bash");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.codex.buildArgs({ prompt: "more", resume: "THREAD-9", policy: policy(["read"]) });
  const ri = resumed.indexOf("resume");
  assert.deepEqual(resumed.slice(ri), ["resume", "THREAD-9", "--", "more"]);

  const untrustedPrompt = "--dangerously-bypass-approvals-and-sandbox";
  const guarded = RUNNERS.codex.buildArgs({ prompt: untrustedPrompt, policy: policy(["read"]) });
  assert.deepEqual(guarded.slice(-2), ["--", untrustedPrompt]);

  const container = RUNNERS.codex.buildArgs({ prompt: "hi", policy: policy(["bash"], "container", "internet") });
  const containerProfile = container.find((value) => String(value).startsWith("permissions="));
  assert.equal(container.includes("-s"), false, "container scope still uses Codex's native profile");
  assert.match(containerProfile, /":root"="write"/);
  assert.match(containerProfile, /network=\{enabled=true,mode="full"\}/);
  assert.ok(container.includes("features.shell_tool=true"));

  const noTools = RUNNERS.codex.buildArgs({ prompt: "hi" });
  const noToolsProfile = noTools.find((value) => String(value).startsWith("permissions="));
  assert.doesNotMatch(noToolsProfile, /workspace_roots"=\{"\."/);
  assert.ok(noTools.includes("features.shell_tool=false"));
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
test("opencode compiles deny-first permissions and isolates configuration", () => {
  const fresh = RUNNERS.opencode.buildArgs({ prompt: "hi", model: "google/gemini-2.5-pro", policy: policy(["read", "write"]), workingDirectory: "/workspace/project" });
  assert.deepEqual(fresh.slice(0, 6), ["--pure", "run", "--format", "json", "--dir", "/workspace/project"]);
  assert.ok(fresh.includes("--model") && fresh[fresh.indexOf("--model") + 1] === "google/gemini-2.5-pro");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.opencode.buildArgs({ prompt: "more", resume: "ses_abc", policy: policy(["read"]) });
  assert.ok(resumed.includes("--session") && resumed[resumed.indexOf("--session") + 1] === "ses_abc");

  assert.equal(RUNNERS.opencode.buildArgs({ prompt: "42" }).at(-1), "42.", "numeric prompt gets a trailing dot");
  assert.equal(RUNNERS.opencode.buildArgs({ prompt: "42" }).at(-2), "--");
  const guarded = RUNNERS.opencode.buildArgs({ prompt: "--dangerously-skip-permissions", policy: policy(["read"]) });
  assert.deepEqual(guarded.slice(-2), ["--", "--dangerously-skip-permissions"]);
  const env = RUNNERS.opencode.buildEnvironment({ policy: policy(["read", "write"]), workingDirectory: "/workspace/project", attachmentDir: "/tmp/pca-stage", outputDir: "/tmp/pca-output" });
  const permission = JSON.parse(env.OPENCODE_PERMISSION);
  assert.equal(Object.keys(permission)[0], "*", "catch-all must be evaluated before explicit allows");
  assert.equal(permission["*"], "deny");
  assert.deepEqual(permission.read, { "*": "deny", "/workspace/project/**": "allow", "/tmp/pca-stage/**": "allow", "/tmp/pca-output/**": "allow" });
  assert.deepEqual(permission.edit, { "*": "deny", "/workspace/project/**": "allow", "/tmp/pca-output/**": "allow" });
  assert.equal(permission.bash, undefined);
  assert.deepEqual(permission.external_directory, { "*": "deny", "/tmp/pca-stage/**": "allow", "/tmp/pca-output/**": "allow" });
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "1");
  assert.throws(
    () => RUNNERS.opencode.buildArgs({ prompt: "bash", policy: policy(["bash"]) }),
    /no network sandbox/,
  );
  assert.throws(
    () => RUNNERS.opencode.buildEnvironment({ policy: policy(["read"]), workingDirectory: "/workspace/evil*" }),
    /unsafe for OpenCode permission rules/,
  );
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
  const claude = RUNNERS.claude.buildArgs({ prompt: "hi", effort: "high", policy: policy(["bash"]) });
  assert.ok(claude.includes("--effort") && claude.includes("high"));
  const codex = RUNNERS.codex.buildArgs({ prompt: "hi", effort: "minimal" });
  assert.ok(codex.includes("-c") && codex.includes("model_reasoning_effort=minimal"));
  // opencode has no reasoning flag; the engine advertises that.
  assert.equal(RUNNERS.opencode.effortLevels, null);
  assert.deepEqual(RUNNERS.claude.effortLevels, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(RUNNERS.codex.effortLevels, ["minimal", "low", "medium", "high", "xhigh"]);
  // No effort -> no flag.
  assert.equal(RUNNERS.claude.buildArgs({ prompt: "hi", policy: policy(["bash"]) }).includes("--effort"), false);
});

test("runner reports the scope enforcement it actually provides", () => {
  assert.equal(toolPolicyEnforcement("claude", policy(["bash"])).kind, "native-sandbox");
  assert.equal(toolPolicyEnforcement("codex", policy(["read", "write"])).kind, "native-sandbox");
  const openCode = toolPolicyEnforcement("opencode", policy(["bash"], "workspace", "internet"));
  assert.equal(openCode.kind, "permission-policy");
  assert.match(openCode.detail, /container/);
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
