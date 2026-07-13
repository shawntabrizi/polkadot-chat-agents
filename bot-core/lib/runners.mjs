// Agent-CLI runners. Each engine is a small config that knows how to invoke a
// headless coding-agent CLI and normalize its JSONL event stream to one
// vocabulary; bot-core owns the generic spawn/stream/idle-backstop loop.
//
// The runners preserve verbatim prompts, native --resume session continuity,
// and engine tools without injecting a persona.
//
// A normalized event is one of:
//   { kind: "started", sessionId }  — capture for --resume next turn
//   { kind: "action",  title }      — one-line progress line ("▸ $ cargo test")
//   { kind: "text",    text }       — a chunk of the answer (accumulate)
//   { kind: "result",  text, ok, usage? } — terminal; text may be "" (use
//       accumulated); usage is { inputTokens?, outputTokens?, costUsd? } when
//       the CLI reported it
//   { kind: "error",   message }    — terminal failure
// parseEvent is PURE (obj -> Event[]); the caller accumulates and picks the
// answer, which keeps every engine unit-testable against fixture JSONL.
//
// effortLevels lists the values an engine's reasoning-effort flag accepts
// (null = the engine has no such flag); buildArgs takes `effort` accordingly.
// Each list matches the supported CLI values.

// Shared one-line titles for tool events across engines.
export const toolActionTitle = (name, input = {}) => {
  const n = String(name || "").toLowerCase();
  const base = (p) => String(p ?? "").split("/").filter(Boolean).pop() || String(p ?? "");
  if (n === "bash" || n === "shell") return `$ ${String(input.command ?? input.cmd ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}`;
  if (n === "read") return `reading ${base(input.file_path ?? input.filePath ?? input.path)}`;
  if (n === "write" || n === "edit" || n === "multiedit" || n === "notebookedit") return `editing ${base(input.file_path ?? input.filePath ?? input.path)}`;
  if (n === "grep" || n === "glob") return `searching ${String(input.pattern ?? "")}`.trim();
  if (n === "websearch") return `searching: ${String(input.query ?? "")}`.trim();
  if (n === "webfetch") return `fetching ${String(input.url ?? "")}`.trim();
  if (n === "task" || n === "agent") return `subagent: ${String(input.description ?? input.subagent_type ?? "").slice(0, 60)}`.trim();
  return String(name || "tool");
};

// ---- claude (Claude Code) --------------------------------------------------
// Invocation & event schema verified live against the claude CLI.
const claude = {
  command: "claude",
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  buildArgs({ prompt, model, resume, allowedTools, skipPermissions, effort }) {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (resume) args.push("--resume", resume);
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (skipPermissions) args.push("--dangerously-skip-permissions");
    else if (allowedTools?.length) args.push("--allowedTools", allowedTools.join(","));
    args.push("--", prompt);
    return args;
  },
  parseEvent(obj) {
    if (obj?.type === "system" && obj.subtype === "init" && obj.session_id) {
      return [{ kind: "started", sessionId: obj.session_id }];
    }
    if (obj?.type === "assistant" && Array.isArray(obj.message?.content)) {
      const out = [];
      for (const block of obj.message.content) {
        if (block?.type === "tool_use") out.push({ kind: "action", title: toolActionTitle(block.name, block.input) });
        else if (block?.type === "text" && block.text) out.push({ kind: "text", text: block.text });
      }
      return out;
    }
    if (obj?.type === "result") {
      if (obj.is_error) return [{ kind: "error", message: String(obj.result ?? obj.subtype ?? "claude error") }];
      const usage = {
        ...(obj.usage?.input_tokens != null ? { inputTokens: obj.usage.input_tokens } : {}),
        ...(obj.usage?.output_tokens != null ? { outputTokens: obj.usage.output_tokens } : {}),
        ...(obj.total_cost_usd != null ? { costUsd: obj.total_cost_usd } : {}),
      };
      return [{ kind: "result", text: typeof obj.result === "string" ? obj.result : "", ok: true, ...(Object.keys(usage).length ? { usage } : {}) }];
    }
    return [];
  },
};

// ---- codex (OpenAI Codex CLI) ----------------------------------------------
// `codex exec --json`. Session id + error events verified live; the success-path
// item schema (agent_message / command_execution / file_change) is best-effort
// from codex's documented item types and MUST be confirmed live (this machine's
// codex is over quota). Prompt is a positional arg with stdin ignored — codex
// otherwise blocks "Reading additional input from stdin".
const codex = {
  command: "codex",
  effortLevels: ["minimal", "low", "medium", "high", "xhigh"],
  buildArgs({ prompt, model, resume, skipPermissions, effort }) {
    const args = ["exec", "--json", "--skip-git-repo-check", "--color=never"];
    if (model) args.push("-m", model);
    if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
    if (skipPermissions) args.push("--dangerously-bypass-approvals-and-sandbox");
    else args.push("-s", "workspace-write");
    // `exec resume <id> <prompt>` continues a thread; fresh runs take the prompt
    // positionally. The prompt goes last either way.
    if (resume) args.push("resume", resume, prompt);
    else args.push(prompt);
    return args;
  },
  parseEvent(obj) {
    if (obj?.type === "thread.started" && obj.thread_id) return [{ kind: "started", sessionId: obj.thread_id }];
    if (obj?.type === "error") return [{ kind: "error", message: String(obj.message ?? "codex error") }];
    if (obj?.type === "turn.failed") return [{ kind: "error", message: String(obj.error?.message ?? "codex turn failed") }];
    if (obj?.type === "item.completed" || obj?.type === "item.started") {
      const item = obj.item ?? {};
      const it = String(item.type ?? item.item_type ?? "");
      if (it === "agent_message" || it === "assistant_message") {
        // Only the completed message is the answer; started is a boundary.
        return obj.type === "item.completed" && item.text ? [{ kind: "text", text: String(item.text) }] : [];
      }
      if (obj.type === "item.started") {
        if (it === "command_execution") return [{ kind: "action", title: toolActionTitle("bash", { command: item.command }) }];
        if (it === "file_change" || it === "patch_apply") return [{ kind: "action", title: `editing ${(item.path ?? item.files?.[0] ?? "files")}` }];
        if (it === "web_search") return [{ kind: "action", title: `searching: ${item.query ?? ""}`.trim() }];
        if (it === "mcp_tool_call" || it === "tool_call") return [{ kind: "action", title: toolActionTitle(item.tool ?? item.name, item.arguments ?? {}) }];
      }
      return [];
    }
    if (obj?.type === "turn.completed") {
      const usage = {
        ...(obj.usage?.input_tokens != null ? { inputTokens: obj.usage.input_tokens } : {}),
        ...(obj.usage?.output_tokens != null ? { outputTokens: obj.usage.output_tokens } : {}),
      };
      return [{ kind: "result", text: "", ok: true, ...(Object.keys(usage).length ? { usage } : {}) }];
    }
    return [];
  },
};

// ---- opencode --------------------------------------------------------------
// `opencode run --format json`. sessionID field + error shape verified live;
// step/tool/text/step_finish per opencode's documented event schema. The
// --model provider/model flag is the many-providers path (anthropic/…, google/…,
// xai/…, openrouter/…, ollama/…) and is effectively required (opencode's default
// model may be an unconfigured local one).
const opencode = {
  command: "opencode",
  effortLevels: null, // OpenCode exposes no reasoning-effort flag.
  buildArgs({ prompt, model, resume, skipPermissions }) {
    const args = ["run", "--format", "json"];
    if (resume) args.push("--session", resume);
    if (model) args.push("--model", model);
    if (skipPermissions) args.push("--dangerously-skip-permissions");
    // Append a period so OpenCode does not misparse a purely numeric prompt.
    args.push(/^\d+$/.test(prompt) ? `${prompt}.` : prompt);
    return args;
  },
  parseEvent(obj) {
    const out = [];
    if (obj?.sessionID) out.push({ kind: "started", sessionId: obj.sessionID });
    if (obj?.type === "tool_use") out.push({ kind: "action", title: toolActionTitle(obj.tool ?? obj.name, obj.input ?? obj.args ?? {}) });
    else if (obj?.type === "text" && obj.text) out.push({ kind: "text", text: String(obj.text) });
    else if (obj?.type === "step_finish" && obj.reason === "stop") out.push({ kind: "result", text: "", ok: true });
    else if (obj?.type === "error") out.push({ kind: "error", message: String(obj.error?.data?.message ?? obj.error?.message ?? "opencode error") });
    return out;
  },
};

// Test/escape-hatch engine: BOT_AI_CMD/BOT_AI_ARGS with claude-shaped
// stream-json output. Lets the offline e2e drive the full loop with a mock `sh`
// script and no real CLI, and lets an operator wire an unlisted CLI that speaks
// the same format.
const custom = { ...claude, command: null };

export const RUNNERS = { claude, codex, opencode, custom };
export const ENGINES = ["claude", "codex", "opencode"]; // user-selectable

export const resolveEngine = (name) => RUNNERS[name] ?? null;
