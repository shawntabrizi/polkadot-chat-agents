import path from "node:path";
import {
  DEFAULT_TOOL_POLICY,
  ToolPolicyError,
  createToolPolicy,
  hasToolCapability,
} from "./tool-policy.mjs";

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

const absolutePath = (value, label) => {
  const resolved = path.resolve(String(value ?? "/workspace"));
  if (/[\x00\r\n]/.test(resolved)) throw new ToolPolicyError(`${label} contains an invalid path.`);
  return resolved;
};

const claudeRulePath = (directory) => {
  const resolved = absolutePath(directory, "tool policy path");
  // Claude's native rules are a comma-separated mini-language. Paths come
  // from deployer configuration, not chat input, but still reject grammar and
  // glob metacharacters rather than allowing a directory name to widen a rule.
  if (/[(),*?\[\]{}\\]/.test(resolved)) throw new ToolPolicyError("tool policy path contains characters unsafe for Claude permission rules.");
  return resolved;
};

const openCodeRulePath = (directory) => {
  const resolved = absolutePath(directory, "tool policy path");
  // OpenCode permission objects use glob keys. Never let a configured
  // workspace or staging path become a wildcard grant.
  if (/[*?\[\]{}\\]/.test(resolved)) throw new ToolPolicyError("tool policy path contains characters unsafe for OpenCode permission rules.");
  return resolved;
};

const pathPattern = (directory) => `${openCodeRulePath(directory)}/**`;
const claudePath = (directory) => `//${claudeRulePath(directory).replace(/^\/+/, "")}/**`;
const claudeRule = (tool, directory) => `${tool}(${claudePath(directory)})`;
const scopedPaths = ({ policy, workingDirectory, attachmentDir, outputDir }) => {
  const workspace = absolutePath(workingDirectory ?? "/workspace", "workspace");
  const readPaths = [workspace];
  const writePaths = hasToolCapability(policy, "write") ? [workspace] : [];
  if (hasToolCapability(policy, "read") && attachmentDir) readPaths.push(absolutePath(attachmentDir, "attachment directory"));
  // A transport-owned artifact handoff directory is writable only when the
  // deployer chose write. It is outside the project workspace so it must be
  // granted explicitly to every native runner.
  if (hasToolCapability(policy, "write") && outputDir) {
    const outputPath = absolutePath(outputDir, "artifact output directory");
    readPaths.push(outputPath);
    writePaths.push(outputPath);
  }
  return { workspace, readPaths: [...new Set(readPaths)], writePaths: [...new Set(writePaths)] };
};

const isAncestorPath = (ancestor, candidate) =>
  candidate === ancestor || candidate.startsWith(ancestor + path.sep);

const protectedPaths = (paths = []) => [...new Set(paths
  .filter((directory) => typeof directory === "string" && directory.trim())
  .map((directory) => absolutePath(directory, "protected path")))];

const withoutAllowedDescendants = (paths, allowedPaths) => paths
  .filter((directory) => !allowedPaths.some((allowedPath) => isAncestorPath(directory, allowedPath)));

const claudeTools = (policy) => {
  const tools = [];
  if (hasToolCapability(policy, "read")) tools.push("Read", "Glob", "Grep");
  if (hasToolCapability(policy, "write")) tools.push("Edit", "Write");
  if (hasToolCapability(policy, "bash")) tools.push("Bash");
  return tools;
};

const claudeApprovalRules = (policy, { readPaths, writePaths }) => {
  if (policy.scope === "container") return claudeTools(policy);
  const rules = [];
  if (hasToolCapability(policy, "read")) {
    for (const directory of readPaths) rules.push(...["Read", "Glob", "Grep"].map((tool) => claudeRule(tool, directory)));
  }
  if (hasToolCapability(policy, "write")) {
    for (const directory of writePaths) rules.push(claudeRule("Edit", directory), claudeRule("Write", directory));
  }
  if (hasToolCapability(policy, "bash")) rules.push("Bash(*)");
  return rules;
};

const claudeDeniedRules = (policy, paths) => {
  if (policy.scope !== "workspace") return [];
  const nativeFileTools = ["Read", "Glob", "Grep", "Edit", "Write"];
  return paths.flatMap((directory) => nativeFileTools.map((tool) => claudeRule(tool, directory)));
};

const claudeSettings = (policy, {
  readPaths,
  writePaths,
  protectedReadPaths,
  protectedWritePaths,
  containerRuntime = false,
}) => {
  // Native Read/Edit/Write rules are sufficient when Bash is absent. Bash
  // needs Claude's Linux sandbox as the real filesystem boundary: a cwd alone
  // cannot stop `cat /home/node/...`.
  if (policy.scope !== "workspace" || !hasToolCapability(policy, "bash")) return null;
  // Claude's permission rules use `//path/**`; its Linux sandbox does not.
  // The sandbox passes these entries to Bubblewrap as real filesystem paths,
  // so glob-shaped permission-rule strings would be silently skipped.
  const sandboxReadPaths = readPaths.map((directory) => absolutePath(directory, "Claude sandbox read path"));
  const allowedWritePaths = hasToolCapability(policy, "write")
    ? writePaths.map((directory) => absolutePath(directory, "Claude sandbox write path"))
    : [];
  const deniedRead = protectedReadPaths.map((directory) => absolutePath(directory, "Claude sandbox denied-read path"));
  const deniedWrite = protectedWritePaths.map((directory) => absolutePath(directory, "Claude sandbox denied-write path"));
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowRead: sandboxReadPaths,
        allowWrite: allowedWritePaths,
        // Claude explicitly supports allowRead exceptions inside a denyRead
        // region. Keep a protected ancestor such as /home/node denied while
        // allowing the selected project below it.
        denyRead: deniedRead,
        // Do not rely on an allowWrite exception for a protected ancestor.
        // Bubblewrap's explicit write mounts still limit Bash to writePaths.
        denyWrite: deniedWrite,
      },
      network: {
        allowedDomains: policy.network === "internet" ? ["*"] : [],
        // Docker deployments opt out of Claude's optional Unix-socket seccomp
        // filter. `allowAllUnixSockets` leaves Unix-domain sockets visible
        // inside the container reachable from sandboxed Bash; it does not set
        // `enableWeakerNestedSandbox` or relax Bubblewrap's filesystem,
        // fresh-proc, or IP-network boundaries. Generated direct-agent
        // services mount no Docker or host socket.
        ...(containerRuntime ? { allowAllUnixSockets: true } : {}),
      },
    },
  };
};

const tomlBasicString = (value) => JSON.stringify(String(value));

const codexPermissionProfile = (policy, { workspace, readPaths, writePaths }) => {
  // `-c` parses a TOML assignment, rather than JSON. Keep this compact
  // inline table deliberately explicit: the built-in `workspace-write`
  // profile includes `:root` and would expose the agent OAuth home.
  const filesystem = [];

  filesystem[0] = '":minimal"="read"';
  if (hasToolCapability(policy, "read")) {
    const access = hasToolCapability(policy, "write") ? "write" : "read";
    if (policy.scope === "container") filesystem.push(`":root"=${tomlBasicString(access)}`);
    else filesystem.push(`":workspace_roots"={"."=${tomlBasicString(access)}}`);
  }
  // Staged attachments are read-only. A transport-owned artifact handoff
  // directory is writable only when it appears in writePaths.
  const writablePaths = new Set(writePaths);
  for (const directory of readPaths) {
    if (directory !== workspace) filesystem.push(`${tomlBasicString(directory)}=${tomlBasicString(writablePaths.has(directory) ? "write" : "read")}`);
  }
  const network = policy.network === "internet"
    ? ",network={enabled=true,mode=\"full\"}"
    : ",network={enabled=false}";
  return `permissions={pca={workspace_roots={${tomlBasicString(workspace)}=true},filesystem={${filesystem.join(",")}}${network}}}`;
};

const opencodePathRules = (directories) => {
  const rules = { "*": "deny" };
  for (const directory of directories) rules[pathPattern(directory)] = "allow";
  return rules;
};

const opencodePermissions = (policy, { workingDirectory = "/workspace", attachmentDir = null, outputDir = null } = {}) => {
  // OpenCode applies matching rules in insertion order, with the later match
  // winning. Keep the catch-all first, then explicitly open only PCA's chosen
  // capabilities.
  const scope = scopedPaths({ policy, workingDirectory, attachmentDir, outputDir });
  const permissions = { "*": "deny" };
  if (hasToolCapability(policy, "read")) {
    permissions.read = policy.scope === "container" ? "allow" : opencodePathRules(scope.readPaths);
    permissions.glob = "allow";
    permissions.grep = "allow";
    permissions.list = "allow";
  }
  if (hasToolCapability(policy, "write")) {
    permissions.edit = policy.scope === "container" ? "allow" : opencodePathRules(scope.writePaths);
  }
  if (hasToolCapability(policy, "bash")) permissions.bash = "allow";
  if (policy.scope === "container") {
    permissions.external_directory = "allow";
  } else {
    // The attachment and output leaves are generated by bot-core and vanish
    // after this turn. OpenCode applies edit path rules as defense in depth,
    // but its external-directory gate is not an OS filesystem sandbox.
    const externalPaths = scope.readPaths.filter((directory) => directory !== scope.workspace);
    permissions.external_directory = externalPaths.length ? opencodePathRules(externalPaths) : "deny";
  }
  return permissions;
};

export const assertEngineToolPolicy = (engineName, policyInput = DEFAULT_TOOL_POLICY) => {
  const policy = createToolPolicy(policyInput);
  if (!["claude", "codex", "opencode", "custom"].includes(engineName)) {
    throw new ToolPolicyError(`No direct-agent tool-policy adapter exists for "${engineName}".`);
  }
  // Claude's container profile uses its native tools without a filesystem or
  // network sandbox. Codex's native permission profile can still enforce its
  // network-disabled setting, so do not apply this restriction there.
  if (engineName === "claude" && policy.scope === "container" && hasToolCapability(policy, "bash") && policy.network !== "internet") {
    throw new ToolPolicyError("Claude container-scoped Bash has no network sandbox; use --tool-network internet or workspace scope.");
  }
  if (engineName === "opencode" && hasToolCapability(policy, "bash") && policy.network !== "internet") {
    throw new ToolPolicyError("OpenCode Bash has no network sandbox; --allowed-tools bash requires --tool-network internet. Use Claude or Codex for workspace-scoped Bash with network disabled.");
  }
  // OpenCode's Bash runner does not provide a hard filesystem sandbox for
  // command arguments. Its workspace policy still constrains its file tools,
  // but the deployer must see this distinction in the deploy report.
  return policy;
};

export const toolPolicyEnforcement = (engineName, policyInput = DEFAULT_TOOL_POLICY) => {
  const policy = assertEngineToolPolicy(engineName, policyInput);
  if (!policy.capabilities.length) return { kind: "none", detail: "all native tools disabled" };
  if (policy.scope === "container") return { kind: "container", detail: "selected tools run as the non-root agent across its container-visible files" };
  if (engineName === "claude") {
    return hasToolCapability(policy, "bash")
      ? { kind: "native-sandbox", detail: "Claude workspace sandbox; a real Bubblewrap readiness probe must pass before startup" }
      : { kind: "native-rules", detail: "Claude path-scoped file-tool rules" };
  }
  if (engineName === "codex") return { kind: "native-sandbox", detail: "Codex native workspace permission/sandbox profile" };
  if (engineName === "opencode" && hasToolCapability(policy, "bash")) {
    return { kind: "permission-policy", detail: "OpenCode deny-first file policy; Bash remains limited by the container, not a filesystem sandbox" };
  }
  return { kind: "permission-policy", detail: "OpenCode deny-first file-tool policy" };
};

// ---- claude (Claude Code) --------------------------------------------------
// Invocation & event schema verified live against the claude CLI.
const claude = {
  command: "claude",
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  buildArgs({ prompt, model, resume, policy: policyInput = DEFAULT_TOOL_POLICY, effort, attachmentDir = null, outputDir = null, workingDirectory = "/workspace", protectedPaths: protectedList = [], containerRuntime = false }) {
    const policy = assertEngineToolPolicy("claude", policyInput);
    const scope = scopedPaths({ policy, workingDirectory, attachmentDir, outputDir });
    const protectedDirectories = protectedPaths(protectedList);
    // Native deny rules cannot express an allow exception: a deny for
    // /home/node would also block /home/node/project. In dontAsk mode the
    // generated path-specific --allowedTools list is already default-deny for
    // native file tools, so omit only such ancestors from the redundant
    // explicit native deny list. The Bash sandbox retains the full read deny
    // list and re-allows the selected paths via filesystem.allowRead.
    const nativeProtectedDirectories = withoutAllowedDescendants(protectedDirectories, scope.readPaths);
    const protectedWriteDirectories = withoutAllowedDescendants(protectedDirectories, scope.writePaths);
    // Claude emits final-answer deltas as `stream_event` frames only when
    // this flag is present. They are intentionally kept separate from the
    // terminal assistant message below: transports can safely live-render
    // user-visible prose without treating it as model reasoning or doubling
    // the durable final answer.
    const args = [
      "-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose",
      // PCA owns the policy for a bot turn. Do not let project/user settings,
      // MCP configuration, browser control, or slash-command customizations
      // silently widen it.
      "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--no-chrome",
    ];
    if (resume) args.push("--resume", resume);
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    // `--tools` is the availability boundary. `dontAsk` makes an attempt to
    // use anything outside the generated allowlist fail instead of blocking a
    // chat turn on an invisible terminal prompt.
    const tools = claudeTools(policy);
    args.push("--permission-mode", "dontAsk", "--tools", tools.join(","));
    if (tools.length) {
      const approvals = claudeApprovalRules(policy, scope);
      if (approvals.length) args.push("--allowedTools", approvals.join(","));
      const denied = claudeDeniedRules(policy, nativeProtectedDirectories);
      if (denied.length) args.push("--disallowedTools", denied.join(","));
    }
    const settings = claudeSettings(policy, {
      ...scope,
      protectedReadPaths: protectedDirectories,
      protectedWritePaths: protectedWriteDirectories,
      containerRuntime: containerRuntime === true,
    });
    if (settings) {
      args.push("--settings", JSON.stringify(settings));
    }
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
    if (obj?.type === "stream_event" && obj.event?.type === "content_block_delta") {
      const delta = obj.event.delta;
      if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        return [{ kind: "partial", text: delta.text }];
      }
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
  buildArgs({ prompt, model, resume, policy: policyInput = DEFAULT_TOOL_POLICY, effort, attachmentDir = null, outputDir = null, workingDirectory = "/workspace" }) {
    const policy = assertEngineToolPolicy("codex", policyInput);
    const scope = scopedPaths({ policy, workingDirectory, attachmentDir, outputDir });
    const args = ["--ask-for-approval", "never", "exec", "--json", "--skip-git-repo-check", "--color=never", "--ignore-user-config", "--ignore-rules", "-C", scope.workspace];
    if (model) args.push("-m", model);
    if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
    // Codex's built-in workspace-write profile grants read access to `:root`,
    // which includes the OAuth home. The custom profile below deliberately
    // starts from `:minimal` and opens only this turn's workspace (and staged
    // attachment/output directories) through its native permission profile.
    args.push("-c", "default_permissions=\"pca\"");
    args.push("-c", codexPermissionProfile(policy, scope));
    args.push("-c", `features.shell_tool=${hasToolCapability(policy, "bash") ? "true" : "false"}`);
    args.push("-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.multi_agent=false", "-c", "tools.web_search=false", "-c", "web_search=\"disabled\"");
    // `exec resume <id> <prompt>` continues a thread; fresh runs take the prompt
    // positionally. The prompt goes last either way.
    if (resume) args.push("resume", resume, "--", prompt);
    else args.push("--", prompt);
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
  buildArgs({ prompt, model, resume, policy: policyInput = DEFAULT_TOOL_POLICY, workingDirectory = "/workspace" }) {
    const policy = assertEngineToolPolicy("opencode", policyInput);
    const workspace = absolutePath(workingDirectory, "workspace");
    const args = ["--pure", "run", "--format", "json", "--dir", workspace];
    if (resume) args.push("--session", resume);
    if (model) args.push("--model", model);
    // Append a period so OpenCode does not misparse a purely numeric prompt.
    args.push("--", /^\d+$/.test(prompt) ? `${prompt}.` : prompt);
    return args;
  },
  buildEnvironment({ policy: policyInput = DEFAULT_TOOL_POLICY, attachmentDir = null, outputDir = null, workingDirectory = "/workspace" }) {
    const policy = assertEngineToolPolicy("opencode", policyInput);
    const permission = opencodePermissions(policy, { workingDirectory, attachmentDir, outputDir });
    const config = { permission, plugin: [] };
    return {
      OPENCODE_PERMISSION: JSON.stringify(permission),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    };
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
