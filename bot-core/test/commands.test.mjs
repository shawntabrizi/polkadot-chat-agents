import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler, resolveModelPolicy } from "../lib/commands.mjs";

const make = (over = {}) => {
  const resumeTokens = new Map();
  const peerModelOverrides = new Map();
  const peerProjects = new Map();
  const handler = createCommandHandler({
    clearResume: (peerKey) => resumeTokens.delete(peerKey),
    peerModelOverrides,
    defaultModel: over.defaultModel ?? "",
    allowedModels: over.allowedModels ?? null,
    username: over.username ?? "testbot.01",
    chainConnected: over.chainConnected ?? (() => true),
    workspaces: over.workspaces ?? null,
    getPeerProject: (peerKey) => peerProjects.get(peerKey) ?? null,
    setPeerProject: (peerKey, value) => {
      if (value) peerProjects.set(peerKey, value); else peerProjects.delete(peerKey);
      resumeTokens.delete(peerKey); // a project switch is a cwd switch
    },
  });
  return { handler, resumeTokens, peerModelOverrides, peerProjects };
};

// Minimal stand-in for lib/workspaces.mjs' registry surface.
const fakeWorkspaces = (aliases) => ({
  size: aliases.length,
  aliases: () => aliases,
  has: (a) => aliases.includes(a),
});

test("non-command text goes to the model (null)", () => {
  const { handler } = make();
  for (const text of ["hello", "what is /help?", "/ what do you think", "/two words here", "//nope", "/über"]) {
    assert.equal(handler("peer", text), null, `expected null for ${JSON.stringify(text)}`);
  }
});

test("unknown but command-shaped input redirects to /help, never the model", () => {
  const { handler } = make();
  for (const text of ["/rest", "/start", "/COMMANDS", "/new"]) {
    const reply = handler("peer", text);
    assert.ok(reply && reply.includes("/help"), `expected /help redirect for ${text}`);
  }
});

test("/help lists every command", () => {
  const { handler } = make();
  const help = handler("peer", "/help");
  for (const cmd of ["/reset", "/stop", "/model", "/file", "/ping"]) assert.ok(help.includes(cmd), `missing ${cmd}`);
});

test("/reset clears only that peer's session token", () => {
  const { handler, resumeTokens } = make();
  resumeTokens.set("alice", "SID-A");
  resumeTokens.set("bob", "SID-B");
  handler("alice", "/reset");
  assert.equal(resumeTokens.has("alice"), false);
  assert.equal(resumeTokens.has("bob"), true);
});

test("/ping reflects chain state and username", () => {
  const up = make({ chainConnected: () => true }).handler("p", "/ping");
  assert.ok(up.includes("testbot.01") && up.includes("connected"));
  const down = make({ chainConnected: () => false }).handler("p", "/ping");
  assert.ok(down.includes("reconnecting"));
});

test("/model shows, sets per-peer, and reverts with a fresh native session", () => {
  const { handler, resumeTokens, peerModelOverrides } = make({ defaultModel: "claude-sonnet" });
  assert.ok(handler("alice", "/model").includes("claude-sonnet"));
  resumeTokens.set("alice", "SID-A");
  handler("alice", "/model haiku");
  assert.equal(peerModelOverrides.get("alice"), "haiku");
  assert.equal(resumeTokens.has("alice"), false, "changing models must not reuse a token from another model");
  assert.ok(handler("alice", "/model").includes("haiku"));
  assert.equal(peerModelOverrides.has("bob"), false); // per-peer, not global
  resumeTokens.set("alice", "SID-B");
  handler("alice", "/model default");
  assert.equal(peerModelOverrides.has("alice"), false);
  assert.equal(resumeTokens.has("alice"), false, "returning to the default model must start a fresh session");
});

test("/model with no configured default says so", () => {
  const { handler } = make({ defaultModel: "" });
  assert.ok(handler("p", "/model").includes("(CLI default)"));
});

test("resolveModelPolicy: explicit config restricts, and switching locks by default", () => {
  // Explicit config always wins, whether public or not.
  assert.deepEqual(resolveModelPolicy({ configured: "a, b", isPublic: true }), ["a", "b"]);
  assert.deepEqual(resolveModelPolicy({ configured: "", isPublic: false }), []); // empty string = deliberate lock
  // No config locks regardless of reachability.
  assert.deepEqual(resolveModelPolicy({ configured: null, isPublic: true }), []);
  assert.deepEqual(resolveModelPolicy({ configured: null, isPublic: false }), []);
  // Open switching requires an explicit opt-in and is never allowed publicly.
  assert.equal(resolveModelPolicy({ configured: null, isPublic: false, allowOpen: true }), null);
  assert.deepEqual(resolveModelPolicy({ configured: null, isPublic: true, allowOpen: true }), []);
});

test("/model open: help and switching describe the available control", () => {
  const { handler, peerModelOverrides } = make({ defaultModel: "sonnet", allowedModels: null });
  assert.match(handler("p", "/help"), /\/model — show or switch model/);
  assert.match(handler("p", "/model"), /Switch with \/model/);
  assert.match(handler("p", "/model opus"), /answering you with opus/);
  assert.equal(peerModelOverrides.get("p"), "opus");
});

test("/model open rejects option-shaped model names", () => {
  const { handler, peerModelOverrides } = make({ defaultModel: "sonnet", allowedModels: null });
  assert.match(handler("p", "/model --dangerously-bypass-approvals-and-sandbox"), /isn't a valid model name/);
  assert.equal(peerModelOverrides.has("p"), false);
});

test("/model locked: help shows status and the operator manages switching", () => {
  const { handler, peerModelOverrides } = make({ defaultModel: "sonnet", allowedModels: [] });
  assert.match(handler("p", "/help"), /\/model — show the active model/);
  assert.match(handler("p", "/model"), /managed by this bot's operator/);
  assert.match(handler("p", "/model opus"), /managed by this bot's operator/);
  assert.equal(peerModelOverrides.has("p"), false, "a locked bot must not record an override");
  // Reverting to the default is always allowed.
  peerModelOverrides.set("p", "leftover");
  assert.match(handler("p", "/model default"), /Back to sonnet/);
  assert.equal(peerModelOverrides.has("p"), false);
});

test("/model restricted (explicit list): only listed models switch", () => {
  const { handler, peerModelOverrides } = make({ defaultModel: "sonnet", allowedModels: ["haiku", "opus"] });
  assert.match(handler("p", "/help"), /\/model — show or select an approved model/);
  assert.match(handler("p", "/model"), /Available: haiku, opus/);
  assert.match(handler("p", "/model haiku"), /answering you with haiku/);
  assert.equal(peerModelOverrides.get("p"), "haiku");
  const reject = handler("p", "/model gpt-5");
  assert.match(reject, /isn't available/);
  assert.match(reject, /Available models: haiku, opus/);
  assert.equal(peerModelOverrides.get("p"), "haiku", "a rejected switch must not change the override");
});

test("commands are case-insensitive and tolerate trailing space", () => {
  const { handler, resumeTokens } = make();
  resumeTokens.set("p", "SID");
  assert.ok(handler("p", "/RESET ").includes("Fresh start"));
  assert.equal(resumeTokens.has("p"), false);
});

test("/project without any registry points at the operator", () => {
  const { handler } = make();
  assert.ok(handler("p", "/project").includes("No projects"));
});

test("/project lists, switches (clearing the session), and reverts", () => {
  const { handler, resumeTokens, peerProjects } = make({ workspaces: fakeWorkspaces(["sdk", "docs"]) });
  assert.ok(handler("p", "/project").includes("sdk, docs"));
  resumeTokens.set("p", "SID");
  assert.ok(handler("p", "/project sdk").includes("Working in sdk"));
  assert.deepEqual(peerProjects.get("p"), { alias: "sdk", branch: null });
  assert.equal(resumeTokens.has("p"), false, "switching projects must start a fresh session");
  assert.ok(handler("p", "/project sdk").includes("Already working"));
  assert.ok(handler("p", "/project default").includes("shared workspace"));
  assert.equal(peerProjects.has("p"), false);
});

test("/project alias@branch records the branch; bad specs are rejected", () => {
  const { handler, peerProjects } = make({ workspaces: fakeWorkspaces(["sdk"]) });
  assert.ok(handler("p", "/project sdk@feat/x").includes("sdk@feat/x"));
  assert.deepEqual(peerProjects.get("p"), { alias: "sdk", branch: "feat/x" });
  assert.ok(handler("p", "/project sdk@../evil").includes("don't know the project"));
  assert.ok(handler("p", "/project ghost").includes("don't know the project"));
});

test("bare /<alias> and /<alias> @branch are switch shortcuts", () => {
  const { handler, peerProjects } = make({ workspaces: fakeWorkspaces(["my-app"]) });
  assert.ok(handler("p", "/my-app").includes("Working in my-app"));
  assert.ok(handler("p", "/my-app @dev").includes("my-app@dev"));
  assert.deepEqual(peerProjects.get("p"), { alias: "my-app", branch: "dev" });
  // Unknown aliases still get the /help redirect, not the model.
  assert.ok(handler("p", "/other-app").includes("/help"));
});

test("/help mentions /project only when projects exist", () => {
  assert.equal(make().handler("p", "/help").includes("/project"), false);
  assert.ok(make({ workspaces: fakeWorkspaces(["sdk"]) }).handler("p", "/help").includes("/project"));
});

test("/reasoning validates levels, sets per-peer, and reverts", () => {
  const peerEffortOverrides = new Map();
  const handler = createCommandHandler({
    clearResume: () => {}, peerModelOverrides: new Map(), defaultModel: "",
    username: "t", chainConnected: () => true,
    effortLevels: ["low", "medium", "high"], defaultEffort: "medium", peerEffortOverrides,
  });
  assert.ok(handler("p", "/reasoning").includes("medium"));
  assert.ok(handler("p", "/reasoning warp").includes("low, medium, high"));
  assert.ok(handler("p", "/reasoning HIGH").includes("high"));
  assert.equal(peerEffortOverrides.get("p"), "high");
  assert.ok(handler("p", "/reasoning default").includes("medium"));
  assert.equal(peerEffortOverrides.has("p"), false);
});

test("/reasoning on an engine without the control says so", () => {
  const { handler } = make(); // effortLevels defaults to null
  assert.ok(handler("p", "/reasoning").includes("no reasoning control"));
});

test("/usage reports the per-chat tally or its absence", () => {
  const usage = new Map([["alice", { turns: 3, inputTokens: 5000, outputTokens: 1200, costUsd: 0.05 }]]);
  const handler = createCommandHandler({
    clearResume: () => {}, peerModelOverrides: new Map(), defaultModel: "",
    username: "t", chainConnected: () => true, getUsage: (k) => usage.get(k) ?? null,
  });
  const reply = handler("alice", "/usage");
  assert.ok(reply.includes("3 turns") && reply.includes("5,000") && reply.includes("$0.0500"), reply);
  assert.ok(handler("bob", "/usage").includes("No usage recorded"));
});
