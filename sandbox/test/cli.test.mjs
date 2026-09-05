// `pcs` against a live daemon: every command runs as a child process with
// --json and its output is parsed. Behaviour is covered by e2e.test.mjs;
// this checks the CLI's argument handling, its JSON contract and that no
// secret is ever printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon } from "../daemon.mjs";
import { waitFor } from "./helpers.mjs";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));

test("pcs: user add/list, request, requests, accept, send, inbox --device, react, edit, wire --peer", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-cli-"));
  const daemon = await startDaemon({ dir, port: 0 });
  t.after(async () => { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const pcs = (...args) => new Promise((resolve, reject) => {
    execFile(process.execPath, [cli, "--url", daemon.url, "--json", ...args], { env: { ...process.env } }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`pcs ${args.join(" ")} failed: ${stderr || stdout}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`pcs ${args.join(" ")} printed non-JSON: ${stdout}`)); }
    });
  });
  const pcsFails = (...args) => new Promise((resolve) => {
    execFile(process.execPath, [cli, "--url", daemon.url, "--json", ...args], (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stderr, stdout }));
  });

  const alice = await pcs("user", "add", "alice");
  const bob = await pcs("user", "add", "bob", "--devices", "2");
  assert.deepEqual([alice.devices.length, bob.devices.length], [1, 2]);
  assert.deepEqual((await pcs("user", "list")).map((p) => p.name), ["alice", "bob"]);
  const seeds = [daemon.personas.get("alice").identity.seed, daemon.personas.get("bob").devices[0].keys.statementSeed]
    .map((s) => Buffer.from(s).toString("hex").slice(0, 32));
  assert.ok(seeds.every((s) => !JSON.stringify(alice).includes(s) && !JSON.stringify(bob).includes(s)), "pcs output holds no seed");

  const request = await pcs("request", "alice", "bob", "--welcome", "hi bob");
  assert.equal(request.toName, "bob");
  await waitFor(async () => (await pcs("requests", "bob")).length === 1);
  const accepted = await pcs("accept", "bob");
  assert.deepEqual([accepted.requestId, accepted.status, accepted.device], [request.requestId, "accepted", 1]);
  assert.equal((await pcsFails("accept", "bob")).code, 1, "nothing pending: a clear failure, not a stack trace");

  await waitFor(async () => (await pcs("requests", "alice"))[0].status === "accepted");
  await waitFor(async () => (await pcs("wire", "--peer", "bob")).some((s) => s.channelLabel === "session bob#1→alice /request"), { attempts: 200, everyMs: 25 });
  const sent = await pcs("send", "alice", "bob", "hello bob");
  assert.equal(sent.status, "sent");
  const onDevice2 = await waitFor(async () => {
    const [view] = await pcs("inbox", "bob", "--peer", "alice", "--device", "2");
    const m = view.messages.find((x) => x.messageId === sent.messageId);
    return m && m.ackedBy.includes(2) ? m : null;
  }, { attempts: 200, everyMs: 25 });
  assert.deepEqual([onDevice2.content.text, onDevice2.receivedBy.includes(2)], ["hello bob", true]);
  await waitFor(async () => (await pcs("inbox", "alice", "--peer", "bob"))[0].messages.find((m) => m.messageId === sent.messageId).status === "delivered", { attempts: 200, everyMs: 25 });
  assert.equal((await pcs("inbox", "bob", "--unread"))[0].messages.length, 1);

  const reply = await pcs("send", "bob", "alice", "laptop here", "--reply", sent.messageId, "--device", "2");
  assert.deepEqual([reply.device, reply.content.type], [2, "reply"]);
  await waitFor(async () => (await pcs("inbox", "alice", "--peer", "bob"))[0].messages.some((m) => m.messageId === reply.messageId), { attempts: 200, everyMs: 25 });
  await pcs("react", "alice", "bob", reply.messageId, "👍");
  await waitFor(async () => (await pcs("inbox", "bob", "--peer", "alice"))[0].messages.find((m) => m.messageId === reply.messageId).reactions.length === 1, { attempts: 200, everyMs: 25 });
  const edited = await pcs("edit", "bob", "alice", reply.messageId, "laptop here (edited)", "--device", "2");
  assert.equal(edited.content.text, "laptop here (edited)");

  const wire = await pcs("wire", "--peer", "alice");
  assert.ok(wire.some((s) => s.signerLabel === "alice#1" && s.channelLabel === "session alice#1→bob /request"), "alice's text on bob's per-device channel");
  assert.ok(wire.every((s) => !("hex" in s)));
  assert.ok((await pcs("wire", "--raw")).every((s) => s.hex.startsWith("0x")));
  assert.equal((await pcsFails("bogus")).code, 1);
  assert.match((await pcsFails("send", "alice", "nobody", "x")).stderr, /unknown peer/);

  // bot attach reads a pca bot's public config only and registers it.
  const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-bots-"));
  fs.mkdirSync(path.join(botsDir, "echobot"));
  fs.writeFileSync(path.join(botsDir, "echobot", "config.json"), JSON.stringify({
    name: "echobot", account: `0x${"77".repeat(32)}`, identifierKey: `0x00${"78".repeat(32)}${"00".repeat(32)}`, username: "echobot.42", networkProfile: "sandbox", endpoint: daemon.storeUrl,
  }));
  fs.writeFileSync(path.join(botsDir, "echobot", "secret.json"), JSON.stringify({ seedHex: "0xdeadbeef" }), { mode: 0o000 });
  try {
    const attached = await new Promise((resolve, reject) => {
      execFile(process.execPath, [cli, "--url", daemon.url, "--json", "bot", "attach", "echobot"], { env: { ...process.env, PCA_BOTS_DIR: botsDir } }, (error, stdout, stderr) => {
        if (error) return reject(new Error(`bot attach failed: ${stderr || stdout}`));
        resolve(JSON.parse(stdout));
      });
    });
    assert.equal(attached.username, "echobot.42");
    assert.equal(daemon.directory.usernameOwner("echobot.42"), `0x${"77".repeat(32)}`);
    assert.equal((await pcsFails("bot", "attach", "nosuchbot")).code, 1);
  } finally {
    fs.rmSync(botsDir, { recursive: true, force: true });
  }
});
