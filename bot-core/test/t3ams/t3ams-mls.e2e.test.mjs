// SPDX-License-Identifier: GPL-3.0-or-later

// End to end over OpenMLS: a pca bot (transports/t3ams/mls.mjs, the real
// entrypoint) and a person running the same T3ams app headless, both talking
// to an in-memory Statement Store node through the bot's RPC transport.
//
// The person creates a workspace, turns agents on, adds the bot as an agent
// with "reply when mentioned" and "react", adds it to #general and @mentions
// it; the bot must answer in the mention's thread, on MLS. Then the person
// DMs the bot, which must answer only once an admin allows direct messages.
//
// Needs a T3ams SPA checkout with dependencies installed (the one `pca t3ams
// setup` uses): T3AMS_SPA_PATH=<checkout> npm test. Skipped otherwise.

import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";

import { buildT3amsAgentRuntime, typecheckT3amsAgentRuntime } from "../../transports/t3ams/runtime/build.mjs";
import { deriveT3amsIdentityFromSeed } from "../../transports/t3ams/t3ams-identity.mjs";
import { startStatementNode } from "./fixtures/statement-node.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BOT_CORE = path.resolve(HERE, "../..");
const SPA = process.env.T3AMS_SPA_PATH;
const NAMESPACE = "pca-mls-e2e";

const waitFor = async (what, check, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

function startPerson({ runtimeDir, endpoint, seedHex, username, displayName, directory, registryDir, stateDir }) {
  const child = fork(path.join(HERE, "fixtures/human-child.mjs"), [], {
    env: {
      ...process.env,
      RUNTIME_DIR: runtimeDir,
      SEED_HEX: seedHex,
      USERNAME: username,
      DISPLAY_NAME: displayName,
      NAMESPACE,
      ENDPOINT: endpoint,
      STATE_DIR: stateDir,
      T3AMS_TEST_DIRECTORY: JSON.stringify(directory),
      T3AMS_TEST_REGISTRY_DIR: registryDir,
    },
    stdio: ["ignore", fs.openSync(`${stateDir}.log`, "w"), "inherit", "ipc"],
  });
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    child.on("message", (message) => {
      if (message.ready) return resolve();
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error != null) call?.reject(new Error(message.error));
      else call?.resolve(message.result);
    });
    child.once("exit", (code) => reject(new Error(`person exited with ${code}`)));
  });
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.send({ id, method, args });
  });
  return { ready, call, stop: () => child.kill() };
}

test("a pca bot is a T3ams agent over MLS: mention → thread reply, DM gated by admins", { skip: SPA == null ? "set T3AMS_SPA_PATH to a T3ams SPA checkout" : false, timeout: 600_000 }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pca-mls-e2e-"));
  const runtimeDir = path.join(work, "runtime");
  typecheckT3amsAgentRuntime({
    spaRoot: SPA,
    include: [path.join(BOT_CORE, "transports/t3ams/runtime/*.ts"), path.join(HERE, "fixtures/*.ts")],
    paths: {
      "@t3ams-test-real/people-resources": ["src/shared/chain/people-resources.ts"],
      "@t3ams-test-real/t3ams-registry": ["src/shared/chain/t3ams-registry.ts"],
    },
  });
  await buildT3amsAgentRuntime({
    spaRoot: SPA,
    outDir: runtimeDir,
    registryAddress: "",
    entries: { agent: path.join(BOT_CORE, "transports/t3ams/runtime/agent.ts"), human: path.join(HERE, "fixtures/human.ts") },
    aliases: [
      { find: /^@shared\/chain\/people-resources\.ts$/, replacement: path.join(HERE, "fixtures/people-shim.ts") },
      { find: /^@t3ams-test-real\/people-resources$/, replacement: path.join(path.resolve(SPA), "src/shared/chain/people-resources.ts") },
      { find: /^@shared\/chain\/t3ams-registry\.ts$/, replacement: path.join(HERE, "fixtures/registry-shim.ts") },
      { find: /^@t3ams-test-real\/t3ams-registry$/, replacement: path.join(path.resolve(SPA), "src/shared/chain/t3ams-registry.ts") },
    ],
  });
  const registryDir = path.join(work, "registry");
  fs.mkdirSync(registryDir);
  const node = await startStatementNode();
  t.after(() => node.close());

  const botSeed = randomBytes(32).toString("hex");
  const personSeed = randomBytes(32).toString("hex");
  const accountOf = (seedHex) => ss58Address(deriveT3amsIdentityFromSeed(Buffer.from(seedHex, "hex")).accountId);
  const directory = { "mlsbot.01": accountOf(botSeed), "maya.01": accountOf(personSeed) };

  const bot = spawn(process.execPath, [path.join(BOT_CORE, "t3ams.mjs")], {
    env: {
      ...process.env,
      BOT_TRANSPORT: "t3ams",
      BOT_SEED_HEX: botSeed,
      BOT_USERNAME: "mlsbot.01",
      BOT_T3AMS_TOPIC_NAMESPACE: NAMESPACE,
      BOT_ENDPOINT: node.url,
      BOT_STATE_DIR: path.join(work, "bot"),
      BOT_BRAIN: "echo",
      BOT_T3AMS_RUNTIME: path.join(runtimeDir, "agent.mjs"),
      BOT_T3AMS_AUTO_ACCEPT_WORKSPACES: "1",
      T3AMS_TEST_DIRECTORY: JSON.stringify(directory),
      T3AMS_TEST_REGISTRY_DIR: registryDir,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const botLog = [];
  bot.stdout.on("data", (chunk) => botLog.push(...String(chunk).split("\n").filter(Boolean)));
  t.after(() => {
    bot.kill();
    fs.writeFileSync(path.join(work, "bot.log"), botLog.join("\n"));
  });
  t.diagnostic(`work dir: ${work}`);
  await waitFor("the bot to start", () => botLog.some((line) => line.includes("T3AMS_READY")));
  await waitFor("the bot to publish its MLS key attestation", () => botLog.some((line) => line.includes("T3AMS_IDENTITY_PUBLISHED")));
  const botXid = JSON.parse(botLog.find((line) => line.includes("T3AMS_READY"))).xid;

  const maya = startPerson({
    runtimeDir, endpoint: node.url, seedHex: personSeed, username: "maya.01", displayName: "Maya", directory, registryDir, stateDir: path.join(work, "maya"),
  });
  t.after(() => maya.stop());
  await maya.ready;
  assert.equal(await maya.call("publishIdentity"), "published");

  const { wsId, generalId } = await maya.call("createWorkspace", "Agents test");
  await maya.call("enableAgents", wsId);
  const invited = await maya.call("inviteAgent", wsId, "mlsbot.01", ["replyWhenMentioned", "react"]);
  assert.equal(invited, botXid);
  await waitFor("the bot to accept the agent invite", () => maya.call("agentSeated", wsId, botXid));
  await maya.call("addAgentToChannel", wsId, botXid, generalId);
  // The bot joins #general's MLS group by external commit; messages sealed
  // before that cannot be opened by it (by design), so mention once Maya's
  // group holds the bot's leaf — what the join notice tells a person.
  await waitFor("the bot to join #general's MLS group", () => maya.call("channelGroupHas", wsId, generalId, botXid));

  // A mention gets an MLS-encrypted reply in the mention's own thread.
  const askedAt = Date.now();
  const mentionId = await maya.call("mention", wsId, generalId, botXid, "@mlsbot ping over mls");
  const reply = await waitFor("the bot's thread reply", async () =>
    (await maya.call("channelMessages", wsId, generalId)).find((m) => m.senderXid === botXid && m.threadRootId === mentionId));
  assert.match(reply.body, /ping over mls/);
  assert.equal(reply.scheme, "CHAT_V1:SCHEME:MLS", "the reply rides the channel's MLS group");
  assert.ok(botLog.some((line) => line.includes("T3AMS_MENTION")), "the bot saw the mention");
  t.diagnostic(`mention → thread reply in ${Date.now() - askedAt} ms`);

  // DMs: closed until an admin turns them on for this agent.
  // A first DM sets the pair up first ("Securing this conversation — resend"),
  // the way the app asks a person to resend.
  const dm = (body) => waitFor(`the DM "${body}" to go out`, () => maya.call("dm", botXid, body).then(
    () => true,
    (error) => (/DmPeerNotReady|Securing this conversation/.test(String(error.message)) ? null : Promise.reject(error)),
  ));
  await maya.call("startDm", botXid, "mlsbot.01");
  await dm("hello in a dm");
  await waitFor("the bot to ignore a DM it may not answer", () => botLog.some((line) => line.includes("T3AMS_DM_IGNORED")));
  assert.ok(!(await maya.call("dmMessages", botXid)).some((m) => m.senderXid === botXid));

  await maya.call("setAgentPermissions", wsId, botXid, ["replyWhenMentioned", "react", "directMessages"]);
  await waitFor("the bot to see Direct messages allowed", async () => {
    await dm("dm after admins allowed it");
    return waitFor("a DM reply", async () =>
      (await maya.call("dmMessages", botXid)).find((m) => m.senderXid === botXid && /dm after admins allowed it/.test(m.body)), 20_000)
      .catch(() => null);
  }, 180_000).then((dmReply) => {
    assert.equal(dmReply.scheme, "CHAT_V1:SCHEME:MLS", "the DM reply rides the pair's MLS group");
  });
});
