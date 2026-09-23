import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOT_INFO_FILE,
  BOT_INFO_STATE_FILE,
  botInfoFromFile,
  createBotInfoSent,
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

// Spec 0008 v2: the operator declares where a client reads "your balance
// with this bot". The file holds bytes as hex and the u128 price as a
// string; a malformed hint must fail at startup, not in a client header.
const meterHint = {
  chainId: "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
  contract: "0x30b0c001431a1addb8c11a060ada4d6a7033cf21",
  selector: "0x70a08231",
  decimals: 18,
  unit: "PAS",
  perReply: "100000000000000000",
  label: "with Meter",
};
test("file -> document: the balance hint is validated and reaches the wire", () => {
  const defaults = defaultBotInfo({ name: "pcdmeter", brain: "echo" });
  const info = botInfoFromFile({ balance: meterHint }, defaults);
  assert.deepEqual(info.balance, meterHint);
  const m = decodeOpaqueMessageAt(encodeOpaqueBotInfoMessage({ ...info, version: 1 }), 0).value;
  assert.equal(m.balance.perReply, 100_000_000_000_000_000n);
  assert.equal(m.balance.label, "with Meter");
  assert.equal(botInfoFromFile({ balance: { ...meterHint, perReply: null } }, defaults).balance.perReply, null);
  assert.equal("balance" in botInfoFromFile({}, defaults), false, "no hint: no field, so v1 bytes");
  assert.throws(() => botInfoFromFile({ balance: { ...meterHint, contract: "0x30b0" } }, defaults), /balance.contract/);
  assert.throws(() => botInfoFromFile({ balance: { ...meterHint, selector: "balanceOf" } }, defaults), /balance.selector/);
  assert.throws(() => botInfoFromFile({ balance: { ...meterHint, chainId: "paseo" } }, defaults), /balance.chainId/);
  assert.throws(() => botInfoFromFile({ balance: { ...meterHint, perReply: 1e17 } }, defaults), /perReply/, "a JSON number loses u128 precision");
  assert.throws(() => botInfoFromFile({ balance: { ...meterHint, lable: "x" } }, defaults), /unknown field\(s\): lable/);
  assert.throws(() => botInfoFromFile({ balance: { ...meterHint, label: "" } }, defaults), /label/);
});

// Adding the hint is a change clients must see (+1); a document without a
// hint keeps the hash it had before v2 (no version bump on upgrade).
test("version: adding a balance hint bumps the version", () => {
  const dir = tmp();
  try {
    const defaults = defaultBotInfo({ name: "pcdmeter", brain: "echo" });
    write(dir, { description: "Pay per reply" });
    assert.equal(loadBotInfo({ dir, defaults }).version, 1);
    write(dir, { description: "Pay per reply", balance: meterHint });
    const withHint = loadBotInfo({ dir, defaults });
    assert.deepEqual([withHint.version, withHint.changed, withHint.balance.label], [2, true, "with Meter"]);
    assert.equal(loadBotInfo({ dir, defaults }).changed, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

// Spec 0008 catch-up: send when the peer lacks the current version, once
// per version; a failed send must not count as sent.
test("sent botInfo: needs until marked, a bump needs again, revert and restore", () => {
  const sent = createBotInfoSent();
  assert.equal(sent.needs("bob", 1), true, "no record: a peer from before the document");
  assert.equal(sent.mark("bob", 1), null);
  assert.equal(sent.needs("bob", 1), false);
  assert.equal(sent.needs("bob", 2), true, "a version bump needs one more send");
  const previous = sent.mark("bob", 2);
  sent.revert("bob", 2, previous);
  assert.equal(sent.snapshot("bob"), 1, "a failed send goes back");
  sent.mark("bob", 3);
  sent.revert("bob", 2, 1);
  assert.equal(sent.snapshot("bob"), 3, "a stale revert never undoes a later send");
  sent.mark("bob", 2);
  assert.equal(sent.snapshot("bob"), 3, "never goes down");
  const fresh = createBotInfoSent();
  fresh.restore("bob", sent.snapshot("bob"));
  fresh.restore("carol", "7");
  assert.deepEqual([fresh.snapshot("bob"), fresh.snapshot("carol")], [3, null]);
});
