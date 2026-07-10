import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler } from "../lib/commands.mjs";

const make = (over = {}) => {
  const resumeTokens = new Map();
  const peerModelOverrides = new Map();
  const handler = createCommandHandler({
    clearResume: (peerKey) => resumeTokens.delete(peerKey),
    peerModelOverrides,
    defaultModel: over.defaultModel ?? "",
    username: over.username ?? "testbot.01",
    chainConnected: over.chainConnected ?? (() => true),
  });
  return { handler, resumeTokens, peerModelOverrides };
};

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
