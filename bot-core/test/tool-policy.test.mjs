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
