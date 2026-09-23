import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOT_INFO_FILE,
  BOT_INFO_STATE_FILE,
  botInfoFromFile,
  createPeerBotInfo,
  defaultBotInfo,
  loadBotInfo,
  seedBotInfoFile,
} from "../lib/bot-info.mjs";
import { decodeOpaqueMessageAt, encodeOpaqueBotInfoMessage } from "../vendor/app-chat-codec.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pca-botinfo-"));
const write = (dir, value) => fs.writeFileSync(path.join(dir, BOT_INFO_FILE), typeof value === "string" ? value : JSON.stringify(value));

// Spec 0008 kind: an AI brain is an agent (1), the echo brain a plain bot
// (0). The command menu must list what the bot really answers: the chat
// command catalog for an AI brain, nothing for echo (it echoes /help).
test("defaults: kind and commands follow the brain", () => {
  const ai = defaultBotInfo({ name: "guide", brain: "claude" });
  assert.deepEqual([ai.kind, ai.name, ai.description, ai.greeting], [1, "guide", "A bot on Polkadot", "Hello!"]);
  assert.deepEqual(ai.commands.map((c) => c.name), ["help", "reset", "stop", "model", "file", "usage", "ping"]);
  assert.equal(ai.commands.find((c) => c.name === "model").description, "show the active model", "the default model policy is locked");
  assert.equal(defaultBotInfo({ name: "b", brain: "bridge" }).kind, 1);
  const echo = defaultBotInfo({ name: "echo-bot", brain: "echo" });
  assert.deepEqual([echo.kind, echo.commands], [0, []]);
  assert.equal(defaultBotInfo({ name: "", brain: "echo" }).name, "Bot");
  assert.equal([...defaultBotInfo({ name: "x".repeat(60), brain: "echo" }).name].length, 40);
  // Every default must be sendable as is.
  assert.doesNotThrow(() => encodeOpaqueBotInfoMessage({ ...ai, version: 1 }));
});

test("file -> document: fields override defaults, missing ones are filled in", () => {
  const defaults = defaultBotInfo({ name: "guide", brain: "claude" });
  const info = botInfoFromFile({ description: "Polkadot support guide", commands: [{ name: "staking", description: "Staking basics" }, { name: "faq" }] }, defaults);
  assert.deepEqual(info, {
    kind: 1,
    name: "guide",
    description: "Polkadot support guide",
    greeting: "Hello!",
    commands: [{ name: "staking", description: "Staking basics" }, { name: "faq", description: "" }],
  });
});

// A typo must not silently send the default greeting; a limit breach must
// not reach the wire (the encoder is the one validator).
test("file -> document: unknown fields and spec limits are errors", () => {
  const defaults = defaultBotInfo({ name: "guide", brain: "claude" });
  assert.throws(() => botInfoFromFile({ greting: "hi" }, defaults), /unknown field\(s\): greting/);
  assert.throws(() => botInfoFromFile({ version: 3 }, defaults), /unknown field\(s\): version/, "the version is the bot's, not the operator's");
  assert.throws(() => botInfoFromFile([], defaults), /JSON object/);
  assert.throws(() => botInfoFromFile({ commands: [{ name: "/help" }] }, defaults), /no slash/);
  assert.throws(() => botInfoFromFile({ description: "x".repeat(281) }, defaults), /description/);
  assert.throws(() => botInfoFromFile({ kind: 7 }, defaults), /kind/);
  assert.throws(() => botInfoFromFile({ commands: "help" }, defaults), /must be a list/);
});

// Clients keep the highest version they have seen, so an edit that does
// not raise the version would never reach them.
test("version: 1 at first, the same while the content is the same, +1 on each change", () => {
  const dir = tmp();
  try {
    const defaults = defaultBotInfo({ name: "guide", brain: "claude" });
    const first = loadBotInfo({ dir, defaults });
    assert.deepEqual([first.version, first.changed], [1, true], "no file: the defaults are version 1");
    assert.deepEqual([loadBotInfo({ dir, defaults }).version, loadBotInfo({ dir, defaults }).changed], [1, false]);
    write(dir, { description: "Polkadot support guide" });
    assert.equal(loadBotInfo({ dir, defaults }).version, 2);
    // Formatting is not content: the same document re-indented keeps it.
    fs.writeFileSync(path.join(dir, BOT_INFO_FILE), JSON.stringify({ description: "Polkadot support guide" }, null, 4));
    assert.deepEqual([loadBotInfo({ dir, defaults }).version, loadBotInfo({ dir, defaults }).changed], [2, false]);
    write(dir, { description: "Polkadot support guide", greeting: "Hi! Ask me about Polkadot." });
    assert.equal(loadBotInfo({ dir, defaults }).version, 3);
    const state = JSON.parse(fs.readFileSync(path.join(dir, BOT_INFO_STATE_FILE), "utf8"));
    assert.equal(state.version, 3);
    assert.match(state.hash, /^[0-9a-f]{64}$/);
    // An invalid edit is an error and does not use up a version.
    write(dir, "{ not json");
    assert.throws(() => loadBotInfo({ dir, defaults }), /botinfo\.json/);
    write(dir, { description: "Polkadot support guide", greeting: "Hi! Ask me about Polkadot." });
    assert.equal(loadBotInfo({ dir, defaults }).version, 3);
    // u16 on the wire: stop at the ceiling, never wrap to a lower version.
    fs.writeFileSync(path.join(dir, BOT_INFO_STATE_FILE), JSON.stringify({ hash: "0".repeat(64), version: 0xffff }));
    assert.equal(loadBotInfo({ dir, defaults }).version, 0xffff);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("version: an unwritable state keeps the document sendable and says why", () => {
  const missing = path.join(os.tmpdir(), `pca-botinfo-missing-${process.pid}-${Date.now()}`);
  const info = loadBotInfo({ dir: missing, defaults: defaultBotInfo({ name: "e", brain: "echo" }) });
  assert.equal(info.version, 1);
  assert.match(info.stateError, /ENOENT/);
});

test("seed: writes the defaults once, never overwrites an operator edit", () => {
  const dir = tmp();
  try {
    const defaults = defaultBotInfo({ name: "guide", brain: "claude" });
    const file = seedBotInfoFile(dir, defaults);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), defaults);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    write(dir, { description: "mine" });
    seedBotInfoFile(dir, defaults);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { description: "mine" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Spec 0008 recipient rule: store per peer, latest version wins.
test("peer botInfo: stored per peer, a lower version is stale, restore validates", () => {
  const store = createPeerBotInfo();
  const decoded = (version, name = "Guide") => decodeOpaqueMessageAt(encodeOpaqueBotInfoMessage({ kind: 1, name, commands: [{ name: "staking", description: "" }], version }), 0).value;
  assert.equal(store.record("bob", decoded(2)), "stored");
  assert.equal(store.record("bob", decoded(1, "Old")), "stale");
  assert.equal(store.get("bob").name, "Guide");
  assert.equal(store.record("bob", decoded(2, "Same version resent")), "stored");
  assert.deepEqual(store.get("bob"), { kind: 1, name: "Same version resent", description: "", greeting: "", commands: [{ name: "staking", description: "" }], version: 2 });
  assert.equal(store.get("alice"), null);
  const fresh = createPeerBotInfo();
  fresh.restore("bob", store.snapshot("bob"));
  assert.deepEqual(fresh.get("bob"), store.get("bob"));
  fresh.restore("carol", { name: 5 });
  assert.equal(fresh.get("carol"), null, "a malformed saved entry is dropped");
});
