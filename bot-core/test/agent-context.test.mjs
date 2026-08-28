import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOperatorContext } from "../lib/agent-context.mjs";
import { commandCatalog } from "../lib/commands.mjs";

const build = (overrides = {}) => buildOperatorContext({
  username: "atlas.42",
  transport: "t3ams",
  policy: { capabilities: ["read", "web"], scope: "workspace" },
  model: "gpt-5.6",
  modelPolicy: ["gpt-5.6", "gpt-5.6-mini"],
  commands: commandCatalog({
    allowedModels: ["gpt-5.6", "gpt-5.6-mini"],
    effortLevels: ["low", "high"],
    hasProjects: true,
  }),
  ...overrides,
});

test("operator context reports identity, transport, exact tools, model policy, commands, and format facts", () => {
  const context = build();
  assert.match(context, /You are `atlas\.42`/);
  assert.match(context, /transport: t3ams/);
  assert.match(context, /Tools: read, web \(scope: workspace\)/);
  assert.doesNotMatch(context, /Tools: read, write/);
  assert.match(context, /Model: gpt-5\.6; \/model switching is restricted to gpt-5\.6, gpt-5\.6-mini/);
  for (const { command, meaning } of commandCatalog({
    allowedModels: ["gpt-5.6", "gpt-5.6-mini"],
    effortLevels: ["low", "high"],
    hasProjects: true,
  })) {
    assert.ok(context.includes(`${command}—${meaning}`), `missing shared command ${command}`);
  }
  assert.match(context, /incoming files are staged/);
  assert.doesNotMatch(context, /Generated files placed/, "write is not granted");
  assert.match(context, /no Markdown tables/);
  assert.match(context, /transport adds the status receipt/);
  assert.match(context, /shawntabrizi\.com\/polkadot-chat-agents/);
  assert.ok(context.length <= 1400, `operator context is ${context.length} chars`);
});

test("the no-tools sentence appears only for an empty policy", () => {
  const none = build({ policy: { capabilities: [], scope: "workspace" } });
  assert.match(none, /Tools: no tools/);
  assert.match(none, /tools are disabled/);
  assert.doesNotMatch(none, /incoming files are staged/);

  const write = build({ policy: { capabilities: ["write"], scope: "container" } });
  assert.match(write, /Tools: read, write \(scope: container\)/, "policy implications are canonicalized");
  assert.doesNotMatch(write, /Tools: no tools|tools are disabled/);
  assert.match(write, /incoming files are staged/);
  assert.match(write, /Generated files placed/);
});

test("model switching facts distinguish open, locked, and engine-default states", () => {
  assert.match(build({ model: "", modelPolicy: null }), /Model: engine default; \/model switching is open/);
  assert.match(build({ modelPolicy: [] }), /\/model switching is locked by the operator/);
});
