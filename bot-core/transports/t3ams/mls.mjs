// SPDX-License-Identifier: GPL-3.0-or-later

// T3ams transport on OpenMLS.
//
// The bot runs the T3ams app's own messaging stack headless (the runtime
// bundle `pca t3ams setup` builds from a T3ams SPA checkout, see
// runtime/agent.ts): it gets an MLS device of its own, joins DMs, public and
// private channels as an ordinary member, and follows the workspace's agent
// rules (mention-only thread replies, Direct messages only when an admin
// allowed them, silent while paused or when agents are off). Every statement
// goes over the Statement Store, signed by the bot's account.
//
// This file is only the PCA side: configuration, the brain (a direct engine
// CLI, or `echo`), and routing each reply back to where the question was
// asked — the mention's thread, or the DM.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { getPolkadotSigner } from "polkadot-api/signer";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";

import { createAgentRuntime } from "../../lib/agent-runtime.mjs";
import { splitMessageText } from "../../lib/chunk.mjs";
import { resolveModelPolicy } from "../../lib/commands.mjs";
import { RUNNERS, assertEngineToolPolicy, resolveEngine } from "../../lib/runners.mjs";
import { ToolPolicyError, toolPolicyFromEnvironment } from "../../lib/tool-policy.mjs";
import { createWorkspaces } from "../../lib/workspaces.mjs";
import { DEFAULT_NETWORK_PROFILE, configuredNetworkProfile, peopleEndpointsFor } from "../../lib/network-config.mjs";
import { deriveSr25519PairFromSeed } from "../../vendor/lib/wallet-keys.mjs";
import { botSeedFromHex, deriveT3amsIdentityFromSeed } from "./t3ams-identity.mjs";
import { createT3amsFileKv } from "./file-kv.mjs";
import { createT3amsStatementTransport } from "./statement-transport.mjs";

const env = process.env;
const log = (event, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...extra }));
const die = (message) => {
  console.error(message);
  process.exit(2);
};
const numberEnv = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) die(`${name} must be an integer between ${min} and ${max}`);
  return value;
};
const bareHex = (value) => String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();

// ---------- configuration ----------

let seed;
try { seed = botSeedFromHex(env.BOT_SEED_HEX); } catch (error) { die(String(error.message)); }
const username = (env.BOT_USERNAME ?? "").trim();
if (username === "") die("BOT_USERNAME is required: peers find the bot by its registered username");
const displayName = (env.BOT_T3AMS_DISPLAY_NAME ?? "").trim() || username;
const namespace = (env.BOT_T3AMS_TOPIC_NAMESPACE ?? "").trim();
if (namespace === "") log("T3AMS_NAMESPACE_UNSET", { hint: "unscoped topics are invisible to namespaced T3ams deployments" });
const stateDir = env.BOT_STATE_DIR?.trim() || die("BOT_STATE_DIR is required: it holds the bot's MLS keystore");
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

// An explicit BOT_ENDPOINT without a profile is used alone (a private node);
// a profile adds its public endpoints as fallbacks.
const explicitEndpoint = env.BOT_ENDPOINT?.trim() || "";
const profileId = (env.BOT_NETWORK_PROFILE ?? "").trim() || (explicitEndpoint ? "" : DEFAULT_NETWORK_PROFILE);
const profile = profileId === "" ? null : configuredNetworkProfile(profileId) ?? die("BOT_NETWORK_PROFILE must be devnet, paseo, or sandbox");
const endpoint = explicitEndpoint || profile.peopleEndpoints[0];

const runtimeEntry = env.BOT_T3AMS_RUNTIME?.trim()
  || path.join(path.dirname(new URL(import.meta.url).pathname), "../../.t3ams-runtime/agent.mjs");
if (!fs.existsSync(runtimeEntry)) {
  die(`The T3ams agent runtime is not built (${runtimeEntry}). Run: pca t3ams setup <path-to-t3ams-spa>`);
}

// Account ids (hex) allowed to DM the bot or bring it into a workspace. Empty
// means open: anyone may DM it, and it joins only workspaces it is invited to
// as an agent when BOT_T3AMS_AUTO_ACCEPT_WORKSPACES=1.
const allowedXids = new Set(
  String(env.BOT_ALLOWED_PEERS ?? "").split(",").map(bareHex).filter((hex) => /^[0-9a-f]{64}$/.test(hex)).map((account) =>
    createHash("sha256").update(Buffer.concat([Buffer.from("bcts:xid:v2:acct:"), Buffer.from(account, "hex")])).digest("hex")),
);
const isAllowed = (xid) => allowedXids.size === 0 || allowedXids.has(bareHex(xid));
const autoAcceptSetting = (env.BOT_T3AMS_AUTO_ACCEPT_WORKSPACES ?? "").trim();
if (!["", "0", "1"].includes(autoAcceptSetting)) die("BOT_T3AMS_AUTO_ACCEPT_WORKSPACES must be 0 or 1");
const autoAcceptWorkspaces = autoAcceptSetting === "1" || (autoAcceptSetting !== "0" && allowedXids.size > 0);
const replyChunkBytes = numberEnv("BOT_REPLY_CHUNK_BYTES", 4000, { min: 128, max: 64 * 1024 });

// ---------- brain ----------

const brain = (env.BOT_BRAIN ?? "echo").trim().toLowerCase();
if (brain === "bridge") die("BOT_BRAIN=bridge is not supported by the MLS T3ams transport yet; use a direct engine (claude, codex, opencode, kimi), BOT_AI_CMD, or echo.");
const customCmd = (env.BOT_AI_CMD ?? "").trim();
const engine = customCmd ? RUNNERS.custom : resolveEngine(brain);
if (engine == null && brain !== "echo") die("BOT_BRAIN must be echo, claude, codex, opencode or kimi");
let toolPolicy;
try {
  toolPolicy = toolPolicyFromEnvironment(env);
  if (engine != null && !customCmd) toolPolicy = assertEngineToolPolicy(brain, toolPolicy);
} catch (error) {
  die(error instanceof ToolPolicyError ? error.message : String(error?.message ?? error));
}
let customArgs = null;
if (customCmd && env.BOT_AI_ARGS) {
  try { customArgs = JSON.parse(env.BOT_AI_ARGS); } catch { die("BOT_AI_ARGS must be a JSON array"); }
  if (!Array.isArray(customArgs)) die("BOT_AI_ARGS must be a JSON array");
}
const aiWorkspace = env.BOT_AI_WORKSPACE ?? path.join(path.resolve(stateDir), "workspace");
if (engine != null) fs.mkdirSync(aiWorkspace, { recursive: true, mode: 0o700 });

// ---------- chain, identity, storage ----------

const material = deriveT3amsIdentityFromSeed(seed);
const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
const txSigner = getPolkadotSigner(wallet.publicKey, "Sr25519", (bytes) => wallet.sign(bytes));
const runtime = await import(runtimeEntry);

// Host entropy, the way a wallet host derives it: per context, from the bot
// seed. Keys derived from it (the app's vault key) survive restarts.
const deriveEntropy = async (context) =>
  new Uint8Array(createHash("sha256").update("pca:t3ams:entropy:v1").update(seed).update(context).digest());

// ---------- routing replies ----------

// One agent session per DM and per channel thread. The delivery context says
// where a reply goes; the runtime hands it back with every reply.
const dmKey = (peerXid) => `t3ams-dm-${bareHex(peerXid)}`;
const threadKey = (route) => `t3ams-ch-${route.wsId}-${route.channelId}-${route.threadRootId}`;
const routes = new Map(); // chat key -> route

let agent;
const sendText = async (chatKey, text, deliveryContext = null) => {
  const route = deliveryContext ?? routes.get(chatKey);
  if (route == null) throw new Error(`no T3ams route for ${chatKey}`);
  for (const part of splitMessageText(text, replyChunkBytes)) {
    if (route.kind === "dm") await agent.replyInDm(route.peerXid, part);
    else await agent.replyInThread(route.wsId, route.channelId, route.threadRootId, part);
  }
  log("T3AMS_REPLY_SENT", { to: chatKey, chars: text.length });
};
const beginTurn = (chatKey) => {
  const route = routes.get(chatKey);
  try {
    if (route?.kind === "dm") agent.dmTyping(route.peerXid);
    else if (route != null) agent.channelTyping(route.wsId, route.channelId);
  } catch { /* typing is best effort */ }
  return () => {};
};

const agentRuntime = engine == null ? null : createAgentRuntime({
  engine,
  engineName: customCmd ? "custom" : brain,
  engineCommand: customCmd || engine.command,
  buildArgs: ({ prompt, operatorContext, model, resume, effort, attachmentDir, outputDir, workingDirectory }) => customCmd
    ? (customArgs ? customArgs.map((item) => (item === "__PROMPT__" ? prompt : item)) : [prompt])
    : engine.buildArgs({
      prompt, operatorContext, model, resume, effort, policy: toolPolicy, attachmentDir, outputDir, workingDirectory,
      protectedPaths: [stateDir, env.HOME ?? os.homedir(), "/app"],
    }),
  buildTurnEnvironment: ({ attachmentDir, outputDir, workingDirectory }) => customCmd
    ? null
    : engine.buildEnvironment?.({ policy: toolPolicy, attachmentDir, outputDir, workingDirectory }) ?? null,
  workspace: aiWorkspace,
  workspaces: env.BOT_AI_PROJECTS ? createWorkspaces({ projects: JSON.parse(env.BOT_AI_PROJECTS), worktreesDir: path.join(aiWorkspace, ".worktrees"), log }) : null,
  model: (env.BOT_AI_MODEL ?? "").trim(),
  allowedModels: resolveModelPolicy({ configured: env.BOT_AI_ALLOWED_MODELS ?? null, isPublic: allowedXids.size === 0 }),
  reasoning: (env.BOT_AI_REASONING ?? "").trim(),
  idleMs: numberEnv("BOT_AI_IDLE_TIMEOUT_MS", 600_000, { min: 1000, max: 7 * 86_400_000 }),
  maxMs: numberEnv("BOT_AI_MAX_MS", 3_600_000, { min: 1000, max: 7 * 86_400_000 }),
  renderMessage: (msg) => (msg.senderName ? `${msg.senderName}: ${msg.text}` : msg.text),
  operatorContext: {
    enabled: env.BOT_AI_CONTEXT !== "0",
    username,
    transport: "t3ams",
    policy: toolPolicy,
    personaPath: path.join(aiWorkspace, "PERSONA.md"),
  },
  chat: { sendText, deliver: sendText, beginTurn },
  username,
  log,
});

const answer = (chatKey, route, message) => {
  routes.set(chatKey, route);
  if (agentRuntime == null) {
    sendText(chatKey, message.text, route).catch((error) => log("T3AMS_REPLY_FAILED", { to: chatKey, error: String(error?.message ?? error) }));
    return;
  }
  agentRuntime.handleMessage(chatKey, { ...message, deliveryContext: route }).catch((error) =>
    log("T3AMS_TURN_FAILED", { to: chatKey, error: String(error?.message ?? error) }));
};

// ---------- start ----------

agent = await runtime.startT3amsAgent({
  signingPrivateKey: material.signingPrivateKey,
  agreementPrivateKey: material.agreementPrivateKey,
  accountAddress: ss58Address(material.accountId),
  accountPublicKey: material.accountId,
  username,
  displayName,
  namespace,
  storage: createT3amsFileKv(path.join(stateDir, "t3ams-kv")),
  createStatementTransport: () =>
    createT3amsStatementTransport({ endpoints: peopleEndpointsFor(endpoint, profile?.id ?? null), walletPair: wallet }),
  txSigner,
  deriveEntropy,
  log,
  onMention(mention) {
    log("T3AMS_MENTION", { wsId: mention.wsId, channel: mention.channelName, from: mention.senderXid });
    if (mention.canReact) {
      agent.react(mention.wsId, mention.channelId, mention.messageId, "👀").catch(() => {});
    }
    if (!mention.canReply) return;
    const route = { kind: "thread", wsId: mention.wsId, channelId: mention.channelId, threadRootId: mention.threadRootId };
    answer(threadKey(route), route, { text: mention.text, senderName: mention.senderName });
  },
  onDirectMessage(dm) {
    // A workspace agent answers DMs only where an admin turned them on; a
    // plain bot answers whoever the operator allowed.
    if (dm.isWorkspaceAgent ? !dm.workspaceAllowsDm : !isAllowed(dm.peerXid)) {
      log("T3AMS_DM_IGNORED", { from: dm.peerXid, workspaceAgent: dm.isWorkspaceAgent });
      return;
    }
    const route = { kind: "dm", peerXid: dm.peerXid };
    answer(dmKey(dm.peerXid), route, { text: dm.text, senderName: dm.senderName });
  },
  onWorkspaceInvite(invite) {
    const trusted = isAllowed(invite.inviterXid) || (invite.ownerXid != null && isAllowed(invite.ownerXid));
    const accept = invite.asAgent && autoAcceptWorkspaces && trusted;
    log("T3AMS_WORKSPACE_INVITE", { wsId: invite.wsId, workspace: invite.workspaceName, asAgent: invite.asAgent, accept });
    return accept;
  },
});

log("T3AMS_READY", { username, xid: agent.xidHex, namespace, brain: customCmd ? "custom" : brain });
if (env.BOT_T3AMS_PUBLISH_IDENTITY !== "0") {
  // Peers treat an account as MLS-capable only once its key attestation is on
  // the T3ams registry; until then they keep it on the legacy carrier.
  agent.publishIdentity().then(
    (status) => log(status.startsWith("failed") || status.startsWith("unavailable") ? "T3AMS_IDENTITY_PUBLISH_FAILED" : "T3AMS_IDENTITY_PUBLISHED", {
      status,
      // The app records why a registry write failed here; it is otherwise only in its own logs.
      ...(globalThis.__t3amsIdentityBindingWriteError ? { error: globalThis.__t3amsIdentityBindingWriteError } : {}),
    }),
    (error) => log("T3AMS_IDENTITY_PUBLISH_FAILED", { error: String(error?.message ?? error) }),
  );
}

const shutdown = () => {
  agent.stop();
  Promise.resolve(agentRuntime?.shutdown()).finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
