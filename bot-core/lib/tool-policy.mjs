// Portable direct-agent tool policy.
//
// This module is deliberately independent of each CLI's native tool names.
// Operators choose the outcomes they want (`read`, `write`, and `bash`), the
// filesystem scope those tools may reach, and whether tool subprocesses may
// use the network. Runners compile that policy to the selected engine.

export const TOOL_CAPABILITIES = Object.freeze(["read", "write", "bash"]);
export const TOOL_SCOPES = Object.freeze(["workspace", "container"]);
export const TOOL_NETWORKS = Object.freeze(["none", "internet"]);

export const DEFAULT_TOOL_POLICY = Object.freeze({
  capabilities: Object.freeze([]),
  scope: "workspace",
  network: "none",
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
  // the same unambiguous policy.
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

export const createToolPolicy = ({ capabilities = [], scope = "workspace", network = "none" } = {}) => {
  const canonical = canonicalCapabilities(capabilities, "tool capabilities");
  const selectedScope = canonicalEnum(scope, TOOL_SCOPES, "tool scope", "workspace");
  const selectedNetwork = canonicalEnum(network, TOOL_NETWORKS, "tool network", "none");
  if (selectedNetwork !== "none" && !canonical.includes("bash")) {
    throw new ToolPolicyError("--tool-network internet requires the bash capability.");
  }
  return Object.freeze({ capabilities: canonical, scope: selectedScope, network: selectedNetwork });
};

export const parseToolCapabilities = (value, label = "--allowed-tools") =>
  canonicalCapabilities(value, label);

export const toolPolicyFromEnvironment = (env = process.env) => createToolPolicy({
  capabilities: env.BOT_AI_TOOL_CAPABILITIES ?? "",
  scope: env.BOT_AI_TOOL_SCOPE ?? "workspace",
  network: env.BOT_AI_TOOL_NETWORK ?? "none",
});

export const toolPolicyEnvironment = (policy) => {
  const normalized = createToolPolicy(policy);
  return {
    BOT_AI_TOOL_CAPABILITIES: normalized.capabilities.join(","),
    BOT_AI_TOOL_SCOPE: normalized.scope,
    BOT_AI_TOOL_NETWORK: normalized.network,
  };
};

export const hasToolCapability = (policy, capability) =>
  createToolPolicy(policy).capabilities.includes(capability);

export const toolPolicySummary = (policy) => {
  const normalized = createToolPolicy(policy);
  return {
    capabilities: normalized.capabilities.length ? normalized.capabilities.join(", ") : "none",
    scope: normalized.scope,
    network: normalized.network,
  };
};
