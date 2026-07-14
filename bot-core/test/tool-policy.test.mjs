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

test("tool policy defaults to no capabilities in workspace with no tool network", () => {
  assert.deepEqual(createToolPolicy(), DEFAULT_TOOL_POLICY);
  assert.deepEqual(toolPolicySummary(DEFAULT_TOOL_POLICY), {
    capabilities: "none",
    scope: "workspace",
    network: "none",
  });
});

test("tool policy closes write and bash capabilities consistently", () => {
  assert.deepEqual(createToolPolicy({ capabilities: ["write"] }).capabilities, ["read", "write"]);
  const bash = createToolPolicy({ capabilities: ["bash"], network: "internet" });
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
    () => createToolPolicy({ capabilities: ["read"], network: "internet" }),
    /requires the bash capability/,
  );
  assert.throws(
    () => createToolPolicy({ capabilities: ["read"], scope: "host" }),
    /must be one of/,
  );
});

test("tool policy environment round-trips its canonical form", () => {
  const policy = createToolPolicy({
    capabilities: ["bash"],
    scope: "container",
    network: "internet",
  });
  const env = toolPolicyEnvironment(policy);
  assert.deepEqual(env, {
    BOT_AI_TOOL_CAPABILITIES: "read,write,bash",
    BOT_AI_TOOL_SCOPE: "container",
    BOT_AI_TOOL_NETWORK: "internet",
  });
  assert.deepEqual(toolPolicyFromEnvironment(env), policy);
});
