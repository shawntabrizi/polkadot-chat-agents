// Portable direct-agent tool policy.
//
// This module is deliberately independent of each CLI's native tool names.
// Operators choose the outcomes they want (`read`, `write`, `bash`, `web`, and
// `subagents`) and the filesystem scope those tools may reach. Runners compile
// that policy to the selected engine.
//
// `web` and `subagents` are deliberately ORTHOGONAL to the filesystem ladder:
// neither implies nor is implied by read/write/bash.
//
//  - `web` is not constrained by `scope` either — a filesystem scope cannot
//    bound where the internet is. It grants the engine's NATIVE web tools.
//    It is NOT the egress boundary: `bash` already implies arbitrary egress,
//    because a shell can reach the network through the runtime that is
//    necessarily present (node, git, and anything else installed). Withholding
//    `web` from a bash-capable bot narrows what the model reaches for, not what
//    it is able to reach. Treat granting `bash` as accepting egress.
//  - `subagents` widens nothing on its own: a spawned subagent inherits the
//    parent's tool set (verified against Claude Code 2.1.220 — a parent limited
//    to `Read,Agent` produced a subagent reporting exactly `Agent, Read`). It
//    is a force multiplier on whatever the other capabilities already allow,
//    which is why it grants no file or network reach by itself.

export const TOOL_CAPABILITIES = Object.freeze(["read", "write", "bash", "web", "subagents"]);
export const TOOL_SCOPES = Object.freeze(["workspace", "container"]);

export const DEFAULT_TOOL_POLICY = Object.freeze({
  capabilities: Object.freeze([]),
  scope: "workspace",
});

const capabilityRank = new Map(TOOL_CAPABILITIES.map((capability, index) => [capability, index]));

export class ToolPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolPolicyError";
  }
}

const stringValue = (value, label) => {
  if (typeof value !== "string") throw new ToolPolicyError(`${label} must be a string.`);
  return value;
};

const canonicalCapabilities = (values, label) => {
  const listed = Array.isArray(values)
    ? values
    : stringValue(values ?? "", label).split(",");
  const selected = new Set();
  for (const raw of listed) {
    const capability = String(raw).trim();
    if (!capability) {
      if (listed.length === 1) continue;
      throw new ToolPolicyError(`${label} cannot contain an empty capability.`);
    }
    if (!TOOL_CAPABILITIES.includes(capability)) {
      throw new ToolPolicyError(`${label} contains unsupported capability "${capability}". Choose: ${TOOL_CAPABILITIES.join(", ")}.`);
    }
    if (selected.has(capability)) throw new ToolPolicyError(`${label} contains duplicate capability "${capability}".`);
    selected.add(capability);
  }

  // These are outcome capabilities, not a promise about one engine's native
  // tool names. A shell is inherently able to inspect and change files within
  // its selected filesystem scope, and edits require the ability to inspect
  // the target. Close those implications once here so every adapter receives
  // the same unambiguous policy. `web` and `subagents` participate in none of
  // it: granting egress is not granting file access, and delegation inherits
  // whatever was already granted. Note this is about which TOOLS are exposed —
  // a shell can still reach the network by other means (see the header).
  if (selected.has("bash")) {
    selected.add("write");
    selected.add("read");
  } else if (selected.has("write")) {
    selected.add("read");
  }
  return Object.freeze([...selected].sort((a, b) => capabilityRank.get(a) - capabilityRank.get(b)));
};

const canonicalEnum = (value, values, label, fallback) => {
  const selected = value == null || value === "" ? fallback : stringValue(value, label).trim();
  if (!values.includes(selected)) throw new ToolPolicyError(`${label} must be one of: ${values.join(", ")}.`);
  return selected;
};

export const createToolPolicy = ({ capabilities = [], scope = "workspace" } = {}) => {
  const canonical = canonicalCapabilities(capabilities, "tool capabilities");
  const selectedScope = canonicalEnum(scope, TOOL_SCOPES, "tool scope", "workspace");
  return Object.freeze({ capabilities: canonical, scope: selectedScope });
};

export const parseToolCapabilities = (value, label = "--allowed-tools") =>
  canonicalCapabilities(value, label);

export const toolPolicyFromEnvironment = (env = process.env) => createToolPolicy({
  capabilities: env.BOT_AI_TOOL_CAPABILITIES ?? "",
  scope: env.BOT_AI_TOOL_SCOPE ?? "workspace",
});

export const toolPolicyEnvironment = (policy) => {
  const normalized = createToolPolicy(policy);
  return {
    BOT_AI_TOOL_CAPABILITIES: normalized.capabilities.join(","),
    BOT_AI_TOOL_SCOPE: normalized.scope,
  };
};

export const hasToolCapability = (policy, capability) =>
  createToolPolicy(policy).capabilities.includes(capability);

export const toolPolicySummary = (policy) => {
  const normalized = createToolPolicy(policy);
  return {
    capabilities: normalized.capabilities.length ? normalized.capabilities.join(", ") : "none",
    scope: normalized.scope,
  };
};
