import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOOL_POLICY,
  ToolPolicyError,
  createToolPolicy,
  hasToolCapability,
  parseToolCapabilities,
  toolPolicyEnvironment,
  toolPolicyFromEnvironment,
  toolPolicySummary,
} from "../lib/tool-policy.mjs";

test("tool policy defaults to no capabilities in workspace", () => {
  assert.deepEqual(createToolPolicy(), DEFAULT_TOOL_POLICY);
  assert.deepEqual(toolPolicySummary(DEFAULT_TOOL_POLICY), {
    capabilities: "none",
    scope: "workspace",
  });
});

test("tool policy closes write and bash capabilities consistently", () => {
  assert.deepEqual(createToolPolicy({ capabilities: ["write"] }).capabilities, ["read", "write"]);
  const bash = createToolPolicy({ capabilities: ["bash"] });
  assert.deepEqual(bash.capabilities, ["read", "write", "bash"]);
  assert.equal(hasToolCapability(bash, "read"), true);
  assert.equal(hasToolCapability(bash, "write"), true);
  assert.equal(hasToolCapability(bash, "bash"), true);
});

test("tool policy accepts only canonical lowercase portable capability names", () => {
  assert.deepEqual(parseToolCapabilities("read,bash"), ["read", "write", "bash"]);
  // "all" expands at parse time to the explicit list, and only stands alone.
  assert.deepEqual(parseToolCapabilities("all"), ["read", "write", "bash", "web", "subagents"]);
  assert.throws(() => parseToolCapabilities("all,web"), /"all" stands alone/);
  for (const value of ["Read", "Bash", "Edit", "read,read", "read,,write"]) {
    assert.throws(() => parseToolCapabilities(value), ToolPolicyError, value);
  }
  assert.throws(
    () => createToolPolicy({ capabilities: ["read"], scope: "host" }),
    /must be one of/,
  );
});

test("tool policy environment round-trips its canonical form", () => {
  const policy = createToolPolicy({
    capabilities: ["bash"],
    scope: "container",
  });
  const env = toolPolicyEnvironment(policy);
  assert.deepEqual(env, {
    BOT_AI_TOOL_CAPABILITIES: "read,write,bash",
    BOT_AI_TOOL_SCOPE: "container",
  });
  assert.deepEqual(toolPolicyFromEnvironment(env), policy);
});

test("web is orthogonal to the filesystem capability ladder", () => {
  // bash implies write+read, but neither implies web, and web implies nothing:
  // a shell is not egress, and egress is not file access.
  assert.deepEqual(createToolPolicy({ capabilities: "bash" }).capabilities, ["read", "write", "bash"]);
  assert.deepEqual(createToolPolicy({ capabilities: "web" }).capabilities, ["web"]);
  assert.deepEqual(
    createToolPolicy({ capabilities: "web,bash" }).capabilities,
    ["read", "write", "bash", "web"],
    "web sorts last and does not disturb the ladder's implications",
  );
  assert.equal(hasToolCapability({ capabilities: "web" }, "read"), false);
  assert.equal(hasToolCapability({ capabilities: "bash" }, "web"), false);
});

test("web survives an environment round-trip and is scope-independent", () => {
  const env = toolPolicyEnvironment({ capabilities: "read,web", scope: "workspace" });
  assert.equal(env.BOT_AI_TOOL_CAPABILITIES, "read,web");
  assert.deepEqual(toolPolicyFromEnvironment(env).capabilities, ["read", "web"]);
  // Scope bounds file tools only — the same web grant appears under both.
  for (const scope of ["workspace", "container"]) {
    assert.equal(hasToolCapability({ capabilities: "web", scope }, "web"), true);
  }
});

test("subagents is orthogonal and grants no reach of its own", () => {
  // Verified against Claude Code 2.1.220: a parent limited to Read+Agent
  // produced a subagent reporting exactly "Agent, Read". Delegation inherits
  // the parent's tools, so it must not imply — or be implied by — anything.
  assert.deepEqual(createToolPolicy({ capabilities: "subagents" }).capabilities, ["subagents"]);
  assert.equal(hasToolCapability({ capabilities: "subagents" }, "read"), false);
  assert.equal(hasToolCapability({ capabilities: "subagents" }, "bash"), false);
  assert.equal(hasToolCapability({ capabilities: "bash" }, "subagents"), false);
  assert.equal(hasToolCapability({ capabilities: "web" }, "subagents"), false);
  // Full grant keeps the ladder's order with both orthogonal capabilities last.
  assert.deepEqual(
    createToolPolicy({ capabilities: "subagents,web,bash" }).capabilities,
    ["read", "write", "bash", "web", "subagents"],
  );
});
