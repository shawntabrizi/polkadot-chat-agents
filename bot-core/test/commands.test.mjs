import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler } from "../lib/commands.mjs";

const make = (over = {}) => {
  const resumeTokens = new Map();
  const peerModelOverrides = new Map();
  const peerProjects = new Map();
  const handler = createCommandHandler({
    clearResume: (peerKey) => resumeTokens.delete(peerKey),
    peerModelOverrides,
    defaultModel: over.defaultModel ?? "",
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
  for (const cmd of ["/reset", "/stop", "/model", "/ping"]) assert.ok(help.includes(cmd), `missing ${cmd}`);
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

test("/model shows, sets per-peer, and reverts with default", () => {
  const { handler, peerModelOverrides } = make({ defaultModel: "claude-sonnet" });
  assert.ok(handler("alice", "/model").includes("claude-sonnet"));
  handler("alice", "/model haiku");
  assert.equal(peerModelOverrides.get("alice"), "haiku");
  assert.ok(handler("alice", "/model").includes("haiku"));
  assert.equal(peerModelOverrides.has("bob"), false); // per-peer, not global
  handler("alice", "/model default");
  assert.equal(peerModelOverrides.has("alice"), false);
});

test("/model with no configured default says so", () => {
  const { handler } = make({ defaultModel: "" });
  assert.ok(handler("p", "/model").includes("(CLI default)"));
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
