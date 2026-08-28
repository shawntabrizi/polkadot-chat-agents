import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNNERS, toolActionTitle, resolveEngine, ENGINES, toolPolicyEnforcement } from "../lib/runners.mjs";

const policy = (capabilities = [], scope = "workspace") => ({ capabilities, scope });

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
  assert.deepEqual(ENGINES, ["claude", "codex", "opencode", "kimi"]);
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
  assert.equal(fresh.includes("--settings"), false, "Bash uses the agent process boundary, not a Claude-specific sandbox");
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
  assert.equal(args.includes("--settings"), false);
  assert.equal(args.includes("Bash"), false, "no shell tool is exposed");
  assert.equal(args.includes("Edit"), false, "no write tool is exposed");
});

test("claude keeps native file tools scoped while Bash follows the process boundary", () => {
  const args = RUNNERS.claude.buildArgs({
    prompt: "inspect",
    policy: policy(["bash"]),
    workingDirectory: "/home/node/projects/demo",
    protectedPaths: ["/home/node", "/state"],
  });
  const denied = args[args.indexOf("--disallowedTools") + 1];
  const allowed = args[args.indexOf("--allowedTools") + 1];
  assert.doesNotMatch(denied, /home\/node/);
  assert.match(denied, /state/);
  assert.match(allowed, /Read\(\/\/home\/node\/projects\/demo\/\*\*\)/);
  assert.doesNotMatch(allowed, /Read\(\/\/home\/node\/\*\*\)/);
  assert.equal(args.includes("--settings"), false);
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
  assert.doesNotMatch(profile, /network=/);
  assert.ok(fresh.includes("features.shell_tool=false"), "read/write must not quietly enable Bash");
  assert.equal(fresh.at(-1), "hi");

  const resumed = RUNNERS.codex.buildArgs({ prompt: "more", resume: "THREAD-9", policy: policy(["read"]) });
  const ri = resumed.indexOf("resume");
  assert.deepEqual(resumed.slice(ri), ["resume", "THREAD-9", "--", "more"]);

  const untrustedPrompt = "--dangerously-bypass-approvals-and-sandbox";
  const guarded = RUNNERS.codex.buildArgs({ prompt: untrustedPrompt, policy: policy(["read"]) });
  assert.deepEqual(guarded.slice(-2), ["--", untrustedPrompt]);

  const container = RUNNERS.codex.buildArgs({ prompt: "hi", policy: policy(["bash"], "container") });
  const containerProfile = container.find((value) => String(value).startsWith("permissions="));
  assert.equal(container.includes("-s"), false, "container scope still uses Codex's native profile");
  assert.match(containerProfile, /":root"="write"/);
  assert.doesNotMatch(containerProfile, /network=/);
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
  assert.ok(RUNNERS.opencode.buildArgs({ prompt: "bash", policy: policy(["bash"]) }).includes("bash"));
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

// ---- kimi ------------------------------------------------------------------
// Point the runner at a fixture KIMI_CODE_HOME for the duration of fn.
const withKimiHome = (home, fn) => {
  const previous = process.env.KIMI_CODE_HOME;
  process.env.KIMI_CODE_HOME = home;
  try { return fn(); }
  finally {
    if (previous == null) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = previous;
  }
};

test("kimi builds prompt-mode args with resume and model", () => {
  const fresh = RUNNERS.kimi.buildArgs({ prompt: "hi", policy: policy(["read"]) });
  assert.deepEqual(fresh.slice(0, 4), ["-p", "hi", "--output-format", "stream-json"]);
  // Skill auto-discovery (user + project) is replaced with an empty directory,
  // so a planted workspace skill can't inject a persona into later turns.
  const sd = fresh.indexOf("--skills-dir");
  assert.ok(sd > 0 && fs.statSync(fresh[sd + 1]).isDirectory());

  const resumed = RUNNERS.kimi.buildArgs({ prompt: "next", model: "kimi-code/kimi-for-coding", resume: "session_abc" });
  assert.equal(resumed[1], "next");
  assert.ok(resumed.includes("-S") && resumed[resumed.indexOf("-S") + 1] === "session_abc");
  assert.ok(resumed.includes("-m") && resumed[resumed.indexOf("-m") + 1] === "kimi-code/kimi-for-coding");

  // A dash-prefixed chat message is the -p value, not a flag.
  assert.equal(RUNNERS.kimi.buildArgs({ prompt: "-5 + 3?" })[1], "-5 + 3?");
  assert.equal(RUNNERS.kimi.effortLevels, null, "prompt mode has no reasoning-effort flag");
});

test("kimi compiles the tool policy into an overlay KIMI_CODE_HOME", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pca-kimi-test-home-"));
  fs.mkdirSync(path.join(home, "sessions"));
  fs.writeFileSync(path.join(home, "mcp.json"), "{}");
  fs.mkdirSync(path.join(home, "skills"));
  fs.writeFileSync(path.join(home, "config.toml"), 'default_model = "kimi-code/kimi-for-coding"\n');
  withKimiHome(home, () => {
    const env = RUNNERS.kimi.buildEnvironment({ policy: policy(["read", "web"]) });
    assert.equal(env.KIMI_CODE_NO_AUTO_UPDATE, "1");
    const overlay = env.KIMI_CODE_HOME;
    assert.ok(overlay && overlay !== home, "the CLI must run against the overlay, not the real home");
    // Sessions (and any login state) link through so resume/auth keep working;
    // MCP servers and skills would widen PCA's policy, so they do not.
    assert.equal(fs.readlinkSync(path.join(overlay, "sessions")), path.join(home, "sessions"));
    // Pinned by empty placeholders (not symlinks) so a write-capable turn cannot
    // create them in the sticky overlay either.
    assert.equal(fs.lstatSync(path.join(overlay, "mcp.json")).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(overlay, "mcp.json"), "utf8").trim(), "{}");
    for (const dir of ["skills", "plugins", "agents"]) {
      const st = fs.lstatSync(path.join(overlay, dir));
      assert.ok(st.isDirectory() && !st.isSymbolicLink(), `${dir} is an empty placeholder directory`);
      assert.deepEqual(fs.readdirSync(path.join(overlay, dir)), []);
    }
    // A dropped agent uid must be able to read the policy but never replace it:
    // world-searchable sticky directory, world-readable config.
    assert.equal(fs.statSync(overlay).mode & 0o1777, 0o1777);
    assert.equal(fs.statSync(path.join(overlay, "config.toml")).mode & 0o777, 0o644);
    // The directories kimi writes into exist in the REAL home so writes land
    // there (through the symlinks) instead of dying with the overlay.
    for (const dir of ["sessions", "credentials", "logs", "cache", "updates"]) {
      assert.ok(fs.statSync(path.join(home, dir)).isDirectory(), `${dir} pre-created in the real home`);
      assert.equal(fs.readlinkSync(path.join(overlay, dir)), path.join(home, dir));
    }
    const config = fs.readFileSync(path.join(overlay, "config.toml"), "utf8");
    assert.match(config, /default_model = "kimi-code\/kimi-for-coding"/, "the operator's own config carries over");
    // Static deny rules per ungranted builtin (the [tools] switch is not
    // honored in prompt mode — verified live against kimi 0.31.1).
    assert.match(config, /\[\[permission\.rules\]\]\ndecision = "deny"\npattern = "Bash"/);
    assert.match(config, /pattern = "Write"/);
    assert.match(config, /pattern = "Agent"/);
    assert.match(config, /pattern = "CronCreate"/);
    assert.match(config, /pattern = "mcp__\*"/, "every MCP tool is denied — a planted workspace mcp.json must not widen a turn");
    assert.doesNotMatch(config, /pattern = "Read"/);
    assert.doesNotMatch(config, /pattern = "WebSearch"/);
    assert.doesNotMatch(config, /pattern = "FetchURL"/);
  });
});

test("kimi denies every builtin tool when no capability is granted", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pca-kimi-test-home-"));
  withKimiHome(home, () => {
    const env = RUNNERS.kimi.buildEnvironment({ policy: policy() });
    const config = fs.readFileSync(path.join(env.KIMI_CODE_HOME, "config.toml"), "utf8");
    for (const tool of ["Read", "Write", "Bash", "WebSearch", "Agent", "CronCreate"]) {
      assert.match(config, new RegExp(`pattern = "${tool}"`), `${tool} must be denied`);
    }
  });
});

test("kimi refuses a config that already owns the tool policy or installs hooks", () => {
  for (const section of ['[tools]\nenabled = ["Read"]\n', '[[permission.rules]]\ndecision = "allow"\npattern = "Bash"\n', '[hooks]\n', '[[hooks.pre_tool_call]]\ncommand = "true"\n']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pca-kimi-test-home-"));
    fs.writeFileSync(path.join(home, "config.toml"), section);
    withKimiHome(home, () => {
      assert.throws(
        () => RUNNERS.kimi.buildEnvironment({ policy: policy(["read"]) }),
        /sets \[tools\], \[\[permission\.rules\]\] or \[hooks\]/,
        `${section.split("\n")[0]} must be refused — hooks run before the deny rules`,
      );
    });
  }
});

test("kimi picks up login state that appears after the first turn", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pca-kimi-test-home-"));
  withKimiHome(home, () => {
    const first = RUNNERS.kimi.buildEnvironment({ policy: policy(["read"]) }).KIMI_CODE_HOME;
    assert.equal(RUNNERS.kimi.buildEnvironment({ policy: policy(["read"]) }).KIMI_CODE_HOME, first, "unchanged home reuses the overlay");
    // The operator runs `kimi login` while the bot is up: the new entry must be
    // visible to the very next turn, not after a restart.
    fs.writeFileSync(path.join(home, "device_id"), "abc\n");
    const second = RUNNERS.kimi.buildEnvironment({ policy: policy(["read"]) }).KIMI_CODE_HOME;
    assert.notEqual(second, first);
    assert.equal(fs.readlinkSync(path.join(second, "device_id")), path.join(home, "device_id"));
  });
});

test("kimi parseEvent: tool action, text answer, terminal resume hint", () => {
  const out = drive(RUNNERS.kimi, [
    { role: "assistant", tool_calls: [{ type: "function", id: "t1", function: { name: "Bash", arguments: "{\"command\":\"ls\"}" } }] },
    { role: "tool", tool_call_id: "t1", content: "file.txt\n" },
    { role: "assistant", content: "the answer" },
    { role: "meta", type: "session.resume_hint", session_id: "session_1", command: "kimi -r session_1" },
  ]);
  assert.equal(out.sessionId, "session_1");
  assert.deepEqual(out.actions, ["$ ls"]);
  assert.equal(out.answer, "the answer");
  assert.equal(out.error, null);
});

test("kimi parseEvent: step narration with tool calls is not part of the answer", () => {
  const out = drive(RUNNERS.kimi, [
    { role: "assistant", content: "Let me check.", tool_calls: [{ function: { name: "Read", arguments: "{\"path\":\"/tmp/a.txt\"}" } }] },
    { role: "assistant", content: "final" },
  ]);
  assert.deepEqual(out.actions, ["reading a.txt"]);
  assert.equal(out.answer, "final");
});

test("kimi parseEvent: malformed tool arguments fall back to a bare title", () => {
  const [ev] = RUNNERS.kimi.parseEvent({ role: "assistant", tool_calls: [{ function: { name: "Bash", arguments: "not json" } }] });
  assert.deepEqual(ev, { kind: "action", title: "$ " });
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
  assert.equal(toolPolicyEnforcement("claude", policy(["bash"])).kind, "process-boundary");
  assert.match(toolPolicyEnforcement("claude", policy(["bash"])).detail, /Bash follows the agent process boundary/);
  assert.equal(toolPolicyEnforcement("codex", policy(["read", "write"])).kind, "native-sandbox");
  const openCode = toolPolicyEnforcement("opencode", policy(["bash"]));
  assert.equal(openCode.kind, "process-boundary");
  assert.match(openCode.detail, /process boundary/);
  // Kimi compiles to static deny rules per ungranted tool — no path scoping.
  assert.equal(toolPolicyEnforcement("kimi", policy(["read"])).kind, "permission-policy");
  assert.match(toolPolicyEnforcement("kimi", policy(["read"])).detail, /not path-scoped/);
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

test("input tokens include the cached prompt, not just the uncached residue", () => {
  // Claude Code reports `input_tokens` as the UNCACHED remainder. An agent turn
  // caches its system prompt and history, so the residue is tiny — reporting it
  // raw showed a ~30k-token turn as "16 input tokens".
  const [ev] = RUNNERS.claude.parseEvent({
    type: "result", result: "done", is_error: false,
    usage: {
      input_tokens: 16,
      cache_read_input_tokens: 28_000,
      cache_creation_input_tokens: 2_400,
      output_tokens: 5_000,
    },
  });
  assert.equal(ev.usage.inputTokens, 30_416, "must sum uncached + cache reads + cache writes");
  assert.equal(ev.usage.outputTokens, 5_000);
  // Engines that report no cache fields are unaffected.
  const [plain] = RUNNERS.claude.parseEvent({
    type: "result", result: "done", is_error: false,
    usage: { input_tokens: 1200, output_tokens: 345 },
  });
  assert.equal(plain.usage.inputTokens, 1200);
});

test("codex turn.completed carries token usage", () => {
  const [ev] = RUNNERS.codex.parseEvent({ type: "turn.completed", usage: { input_tokens: 900, output_tokens: 88 } });
  assert.equal(ev.kind, "result");
  assert.deepEqual(ev.usage, { inputTokens: 900, outputTokens: 88 });
});

test("web capability compiles to each engine's own web tools", () => {
  const web = { capabilities: "web", scope: "workspace" };
  const none = { capabilities: "", scope: "workspace" };

  // claude: web tools must appear in BOTH --tools (availability) and
  // --allowedTools (approval). Under --permission-mode dontAsk an available but
  // unapproved tool fails the turn instead of prompting.
  const claudeArgs = RUNNERS.claude.buildArgs({ prompt: "hi", policy: web });
  const tools = claudeArgs[claudeArgs.indexOf("--tools") + 1];
  const allowed = claudeArgs[claudeArgs.indexOf("--allowedTools") + 1];
  for (const t of ["WebSearch", "WebFetch"]) {
    assert.match(tools, new RegExp(t), `${t} missing from --tools`);
    assert.match(allowed, new RegExp(t), `${t} missing from --allowedTools`);
  }
  // Web is not file access: no file tool is granted alongside it.
  assert.doesNotMatch(tools, /Read|Write|Edit|Bash/);

  // …and stays absent without the capability.
  const bare = RUNNERS.claude.buildArgs({ prompt: "hi", policy: none });
  assert.equal(bare[bare.indexOf("--tools") + 1], "");

  // codex: flip the feature flag on, and stop forcing the disable override.
  const codexOn = RUNNERS.codex.buildArgs({ prompt: "hi", policy: web }).join(" ");
  assert.match(codexOn, /tools\.web_search=true/);
  // The feature flag alone leaves Codex on cached results. Its config validator
  // enumerates disabled|cached|indexed|live, so the granted branch must pick
  // `live` to actually match what the capability advertises.
  assert.match(codexOn, /web_search="live"/);
  assert.doesNotMatch(codexOn, /web_search="disabled"/);
  const codexOff = RUNNERS.codex.buildArgs({ prompt: "hi", policy: none }).join(" ");
  assert.match(codexOff, /tools\.web_search=false/);
  assert.match(codexOff, /web_search="disabled"/);
});

test("subagents compiles to each engine's delegation tool", () => {
  const sub = { capabilities: "subagents", scope: "workspace" };
  const none = { capabilities: "", scope: "workspace" };

  // claude: Agent must be both available and approved, and must not drag in
  // any file or web tool — a subagent inherits whatever the parent has.
  const args = RUNNERS.claude.buildArgs({ prompt: "hi", policy: sub });
  assert.equal(args[args.indexOf("--tools") + 1], "Agent");
  assert.match(args[args.indexOf("--allowedTools") + 1], /Agent/);

  // codex: flip its multi_agent feature rather than leaving it forced off.
  const on = RUNNERS.codex.buildArgs({ prompt: "hi", policy: sub }).join(" ");
  assert.match(on, /features\.multi_agent=true/);
  const off = RUNNERS.codex.buildArgs({ prompt: "hi", policy: none }).join(" ");
  assert.match(off, /features\.multi_agent=false/);

  // opencode: `task` is its delegation tool, blocked by the deny-first default.
  // Its permissions ride OPENCODE_PERMISSION in the environment, not argv.
  const permitted = JSON.parse(RUNNERS.opencode.buildEnvironment({ policy: sub }).OPENCODE_PERMISSION);
  assert.equal(permitted.task, "allow");
  assert.equal(permitted["*"], "deny", "the catch-all must still deny everything else");
  const denied = JSON.parse(RUNNERS.opencode.buildEnvironment({ policy: none }).OPENCODE_PERMISSION);
  assert.equal(denied.task, undefined, "no delegation without the capability");
});

test("web opens both fetch and search on opencode", () => {
  // OpenCode gates search separately from fetch; allowing only webfetch left
  // every search denied by the deny-first catch-all.
  const on = JSON.parse(RUNNERS.opencode.buildEnvironment({ policy: { capabilities: "web" } }).OPENCODE_PERMISSION);
  assert.equal(on.webfetch, "allow");
  assert.equal(on.websearch, "allow");
  assert.equal(on["*"], "deny");
  const off = JSON.parse(RUNNERS.opencode.buildEnvironment({ policy: { capabilities: "" } }).OPENCODE_PERMISSION);
  assert.equal(off.webfetch, undefined);
  assert.equal(off.websearch, undefined);
});

test("enforcement summaries admit what the file scope does not contain", () => {
  // Every enforcement detail describes FILE containment. Granting web or
  // subagents must not leave an operator reading "path-scoped file-tool rules"
  // and inferring a boundary that does not cover them.
  const files = toolPolicyEnforcement("claude", { capabilities: "read", scope: "workspace" });
  assert.match(files.detail, /path-scoped/);
  assert.equal(files.unscoped, undefined);

  const web = toolPolicyEnforcement("claude", { capabilities: "read,web", scope: "workspace" });
  assert.match(web.detail, /web tools reach any URL/);
  assert.deepEqual([...web.unscoped], ["web tools reach any URL"]);

  const both = toolPolicyEnforcement("claude", { capabilities: "read,web,subagents", scope: "workspace" });
  assert.match(both.detail, /web tools reach any URL; subagents inherit this same policy/);

  // No capabilities at all stays the plain "disabled" summary.
  assert.equal(toolPolicyEnforcement("claude", { capabilities: "" }).kind, "none");
});

test("codex delegation events become subagent progress lines", () => {
  // codex exec --json reports delegation as item.started/collab_tool_call.
  const [ev] = RUNNERS.codex.parseEvent({
    type: "item.started",
    item: { type: "collab_tool_call", description: "review the auth module" },
  });
  assert.equal(ev.kind, "action");
  assert.match(ev.title, /^subagent: review the auth module/);
});

test("claude is told when it has no tools, and only then", () => {
  const none = RUNNERS.claude.buildArgs({ prompt: "hi", policy: policy() });
  assert.equal(none[none.indexOf("--tools") + 1], "");
  const i = none.indexOf("--append-system-prompt");
  assert.ok(i > 0, "a no-tools turn carries the system prompt");
  assert.match(none[i + 1], /NO tools/);
  assert.match(none[i + 1], /<invoke>/, "names the markup the model must not emit");
  assert.ok(i < none.indexOf("--"), "flags precede the prompt separator");

  const some = RUNNERS.claude.buildArgs({ prompt: "hi", policy: policy(["read"]) });
  assert.equal(some.includes("--append-system-prompt"), false, "with tools the CLI's own prompt stands");
});
