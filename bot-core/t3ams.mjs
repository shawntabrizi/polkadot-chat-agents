#!/usr/bin/env node
// T3ams transport entry point.  The regular index.mjs continues to serve the
// Polkadot app codec; pca selects this file only for BOT_TRANSPORT=t3ams.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createStateStore } from "./lib/session-store.mjs";
import { createAgentRuntime } from "./lib/agent-runtime.mjs";
import { resolveModelPolicy } from "./lib/commands.mjs";
import { splitMessageText } from "./lib/chunk.mjs";
import { createWorkspaces } from "./lib/workspaces.mjs";
import { createKeyedDispatcher } from "./lib/keyed-dispatcher.mjs";
import { RUNNERS, resolveEngine } from "./lib/runners.mjs";
import { deriveT3amsIdentity } from "./lib/t3ams-identity.mjs";
import { createT3amsProtocol, hexToBytes, bareHex } from "./lib/t3ams-protocol.mjs";
import {
  MAX_T3AMS_TEXT_BYTES,
  normalizeT3amsInbound,
  restoreT3amsIngressRoute,
  toT3amsBridgeInbound,
} from "./lib/t3ams-routing.mjs";
import { createSerializedSubmitter, createT3amsPriorityClock } from "./lib/t3ams-submission.mjs";
import { createT3amsKnownChats } from "./lib/t3ams-known-chats.mjs";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { submitAppStatement, scaleEncodeBytes } from "./vendor/app-chat-codec.mjs";
import { createLazyClient } from "@novasamatech/statement-store";
import { getWsProvider, WsEvent } from "polkadot-api/ws";

const env = process.env;
const enc = new TextEncoder();
const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
const endpoint = (env.BOT_ENDPOINT ?? DEFAULT_ENDPOINT).trim();
const seedHex = (env.BOT_SEED_HEX ?? env.FAUCET_CHAT_SERVICE_SECRET ?? "").trim();
const transportName = (env.BOT_TRANSPORT ?? "").trim().toLowerCase();
if (transportName !== "t3ams") {
  console.error("t3ams.mjs requires BOT_TRANSPORT=t3ams");
  process.exit(2);
}
if (!seedHex) {
  console.error("BOT_SEED_HEX is required");
  process.exit(2);
}

const numberEnv = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    console.error(`${name} must be an integer between ${min} and ${max}`);
    process.exit(2);
  }
  return value;
};
const log = (event, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...extra }));
const stateDir = env.BOT_STATE_DIR?.trim() || fs.mkdtempSync(path.join(os.tmpdir(), "pca-t3ams-"));
try {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(stateDir, 0o700);
} catch (error) {
  console.error(`BOT_STATE_DIR must be a writable private directory: ${String(error?.message ?? error)}`);
  process.exit(2);
}
const stateStore = createStateStore(path.join(stateDir, "t3ams-state.json"));
const restored = stateStore.load();

// @t3ams/bcts is intentionally loaded at runtime so ordinary Polkadot-app
// installations do not need the optional, currently local T3ams SDK package.
const bctsModule = env.BOT_T3AMS_BCTS_MODULE?.trim() || "@t3ams/bcts";
let bcts;
try {
  bcts = await import(bctsModule);
} catch (error) {
  console.error(`Unable to load T3ams SDK module "${bctsModule}". Build and install the local @t3ams/bcts tarball in bot-core (or set BOT_T3AMS_BCTS_MODULE for pca run): ${String(error?.message ?? error)}`);
  process.exit(2);
}

let material;
try {
  material = deriveT3amsIdentity(seedHex);
} catch {
  console.error("BOT_SEED_HEX must be exactly 32 bytes of hexadecimal data");
  process.exit(2);
}
const identity = bcts.restoreIdentity(material.signingPrivateKey, material.agreementPrivateKey);
// T3ams usernames resolve to account-derived XIDs, not the local Ed25519 key
// fingerprint.  This is the same binding used by the SPA.
identity.xid = material.xid;
const selfXidHex = bareHex(bcts.formatXID(identity.xid));
const wallet = deriveSr25519PairFromSeed(hexToBytes(seedHex), "//wallet");
const username = (env.BOT_USERNAME ?? "").trim();
const displayName = (env.BOT_T3AMS_DISPLAY_NAME ?? username ?? "Polkadot AI").trim() || "Polkadot AI";
const bridgePort = numberEnv("BOT_BRIDGE_PORT", 8799, { min: 0, max: 65_535 });
const bridgeHost = env.BOT_BRIDGE_HOST ?? "127.0.0.1";
const bridgeToken = (env.BOT_BRIDGE_TOKEN ?? "").trim();
if (bridgeToken.length < 32) {
  console.error("BOT_BRIDGE_TOKEN must be set to a 32+ character random secret");
  process.exit(2);
}
const brain = (env.BOT_BRAIN ?? "bridge").trim().toLowerCase();
if (!new Set(["echo", "claude", "codex", "opencode", "bridge", "hermes"]).has(brain)) {
  console.error("BOT_BRAIN must be echo, claude, codex, opencode, bridge, or hermes");
  process.exit(2);
}

const allowedAccountIds = String(env.BOT_ALLOWED_PEERS ?? "")
  .split(",")
  .map((value) => bareHex(value))
  .filter((value) => /^[0-9a-f]{64}$/.test(value));
const accountXid = (account) => {
  const data = new Uint8Array(enc.encode("bcts:xid:v2:acct:").length + 32);
  data.set(enc.encode("bcts:xid:v2:acct:"));
  data.set(hexToBytes(account), enc.encode("bcts:xid:v2:acct:").length);
  return createHash("sha256").update(data).digest("hex");
};
const allowedXids = new Set(allowedAccountIds.map(accountXid));
const rawTrustedSigningKeys = (env.BOT_T3AMS_TRUSTED_SIGNING_KEYS ?? "").trim();
let configuredTrustedSigningKeys = {};
if (rawTrustedSigningKeys) {
  try { configuredTrustedSigningKeys = JSON.parse(rawTrustedSigningKeys); }
  catch { console.error("BOT_T3AMS_TRUSTED_SIGNING_KEYS must be a JSON object mapping account IDs to tagged-CBOR signing public keys"); process.exit(2); }
}
if (configuredTrustedSigningKeys == null || typeof configuredTrustedSigningKeys !== "object" || Array.isArray(configuredTrustedSigningKeys)) {
  console.error("BOT_T3AMS_TRUSTED_SIGNING_KEYS must be a JSON object mapping account IDs to tagged-CBOR signing public keys");
  process.exit(2);
}
const trustedPeerSigningKeys = {};
for (const [rawAccount, rawKey] of Object.entries(configuredTrustedSigningKeys)) {
  const account = bareHex(rawAccount);
  const signingKey = bareHex(rawKey);
  if (!/^[0-9a-f]{64}$/.test(account) || !/^[0-9a-f]{2,4096}$/.test(signingKey) || signingKey.length % 2 !== 0) {
    console.error("BOT_T3AMS_TRUSTED_SIGNING_KEYS contains an invalid account ID or tagged-CBOR signing key");
    process.exit(2);
  }
  if (trustedPeerSigningKeys[accountXid(account)] != null) {
    console.error("BOT_T3AMS_TRUSTED_SIGNING_KEYS contains duplicate account-derived XIDs");
    process.exit(2);
  }
  try { bcts.SigningPublicKey.fromTaggedCborData(hexToBytes(signingKey)); }
  catch { console.error(`BOT_T3AMS_TRUSTED_SIGNING_KEYS has an invalid tagged-CBOR signing key for ${account}`); process.exit(2); }
  trustedPeerSigningKeys[accountXid(account)] = signingKey;
}
const missingTrustedPeers = [...allowedXids].filter((xid) => trustedPeerSigningKeys[xid] == null);
if (missingTrustedPeers.length > 0) {
  console.error("Private T3ams bots require a configured tagged-CBOR signing-key pin for every BOT_ALLOWED_PEERS account");
  process.exit(2);
}
const isAllowed = (xid) => allowedXids.size === 0 || allowedXids.has(bareHex(xid));
const workspaceAutoAcceptSetting = (env.BOT_T3AMS_AUTO_ACCEPT_WORKSPACES ?? "").trim();
if (!["", "0", "1"].includes(workspaceAutoAcceptSetting)) {
  console.error("BOT_T3AMS_AUTO_ACCEPT_WORKSPACES must be 0 or 1");
  process.exit(2);
}
// An allowlisted bot may safely let one of its allowed operators invite it.
// An open bot must opt in explicitly: otherwise any stranger could enroll a
// quota-spending brain into an arbitrary workspace.
const autoAcceptWorkspaces = workspaceAutoAcceptSetting === "1"
  || (workspaceAutoAcceptSetting !== "0" && allowedXids.size > 0);
const publicTofuEnrollment = allowedXids.size === 0;
// Public pairing/enrollment is intentionally much smaller than the private
// protocol maxima. These caps bound memory, RPC subscriptions, and allowance
// spend even when an operator deliberately opens a bot to strangers.
const publicPeerCap = numberEnv("BOT_T3AMS_PUBLIC_PEER_CAP", 128, { min: 1, max: 1_000 });
const publicWorkspaceCap = numberEnv("BOT_T3AMS_PUBLIC_WORKSPACE_CAP", 8, { min: 1, max: 100 });
const publicPeerAdmissions = numberEnv("BOT_T3AMS_PUBLIC_PEER_ADMISSIONS_PER_HOUR", 32, { min: 1, max: 256 });
const publicWorkspaceAdmissions = numberEnv("BOT_T3AMS_PUBLIC_WORKSPACE_ADMISSIONS_PER_HOUR", 4, { min: 1, max: 256 });

const wsProvider = getWsProvider(endpoint);
const lazyClient = createLazyClient(wsProvider);
const requestRpc = lazyClient.getRequestFn();
const isChainConnected = () => wsProvider.getStatus?.().type === WsEvent.CONNECTED;
// T3ams uses an expiry packed as `(now + 24h) << 32 | sequence`, rather than
// the app transport's long-lived priority encoding. Persisting the high-water
// mark makes a fast restart safe, and the one global submit chain keeps writes
// ordered even when several inbox/channel subscriptions fire together.
const priorityClock = createT3amsPriorityClock({
  initialPriority: restored?.submissionPriority,
  onAdvance: () => persist(),
});
const submitQueueCap = numberEnv("BOT_T3AMS_SUBMIT_QUEUE_CAP", 128, { min: 1, max: 4_096 });
const submit = createSerializedSubmitter(async ({ channel, topics, data }) => {
  try {
    const result = await submitAppStatement(requestRpc, {
      walletPair: wallet,
      channel,
      topics,
      scaleEncodedPayload: scaleEncodeBytes(data),
      expiryFactory: priorityClock.nextPriority,
      noteRejectedPriority: priorityClock.noteRejectedPriority,
    });
    persist();
    return result;
  } catch (error) {
    if (error?.statementSubmitReason === "noAllowance" || String(error?.message ?? error).includes("noAllowance")) {
      log("T3AMS_STATEMENT_ALLOWANCE_REQUIRED", { account: material.accountIdHex });
    }
    throw error;
  }
}, { maxPending: submitQueueCap });

let protocol;
let agentRuntime = null;
// Every authenticated message is first placed in this bounded, disk-backed
// journal. This is deliberately shared by direct brains and HTTP harnesses:
// a full dispatcher, a bridge restart, or an unflushed lease must cause a
// retry, never silently consume the protocol-level deduplication slot.
const ingressCap = numberEnv("BOT_INBOUND_CAP", 1000, { min: 1, max: 100_000 });
const leaseMs = numberEnv("BOT_BRIDGE_LEASE_MS", 300_000, { min: 1000, max: 86_400_000 });
const deadLetterCap = numberEnv("BOT_T3AMS_DEAD_LETTER_CAP", 100, { min: 1, max: 10_000 });
const ingress = [];
const knownChatCap = numberEnv(
  "BOT_T3AMS_KNOWN_CHAT_CAP",
  publicTofuEnrollment ? publicPeerCap : 500,
  { min: 1, max: 10_000 },
);
const isT3amsConversationKey = (chatId) => /^t3ams:dm:[0-9a-f]{64}$/i.test(chatId)
  || /^t3ams:channel:[0-9a-f]{64}:[0-9a-f]{64}$/i.test(chatId);
const knownChats = createT3amsKnownChats({
  cap: knownChatCap,
  isProtected: (chatId) => ingress.some((entry) => entry.routed.conversationKey === chatId),
  isValid: isT3amsConversationKey,
});
const deadLetters = [];
const bridgeWaiters = new Set();
const wakeBridge = () => {
  for (const resolve of [...bridgeWaiters]) {
    bridgeWaiters.delete(resolve);
    resolve();
  }
};
const restoredIngressIds = new Set();
for (const raw of Array.isArray(restored?.ingress) ? restored.ingress.slice(-ingressCap) : []) {
  const routed = restoreT3amsIngressRoute(raw?.routed);
  const id = typeof raw?.id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(raw.id) && !restoredIngressIds.has(raw.id)
    ? raw.id
    : null;
  const kind = raw?.kind === "bridge" || raw?.kind === "turn" ? raw.kind : null;
  if (routed == null || id == null || kind == null) continue;
  restoredIngressIds.add(id);
  ingress.push({
    id,
    kind,
    routed,
    createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt : Date.now(),
    attempts: Number.isSafeInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
    retryAt: Number.isSafeInteger(raw.retryAt) && raw.retryAt > Date.now() ? raw.retryAt : 0,
    completedAt: Number.isSafeInteger(raw.completedAt) && raw.completedAt > 0 ? raw.completedAt : 0,
    // A process restart intentionally releases all harness leases. The next
    // adapter poll receives the durable delivery again rather than losing it.
    leaseId: null,
    leaseUntil: 0,
  });
  knownChats.note(routed.conversationKey);
}
for (const raw of Array.isArray(restored?.deadLetters) ? restored.deadLetters.slice(-deadLetterCap) : []) {
  if (typeof raw?.id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(raw.id)) continue;
  if (typeof raw?.conversationKey !== "string" || typeof raw?.code !== "string") continue;
  deadLetters.push({
    id: raw.id,
    conversationKey: raw.conversationKey,
    code: raw.code.slice(0, 128),
    droppedAt: Number.isSafeInteger(raw.droppedAt) ? raw.droppedAt : Date.now(),
  });
}
const stateSnapshot = () => ({
  v: 1,
  submissionPriority: priorityClock.priority().toString(),
  t3ams: protocol?.snapshot?.() ?? restored?.t3ams ?? null,
  agent: agentRuntime?.snapshotAgent?.() ?? restored?.agent ?? null,
  agentPeers: agentRuntime == null ? [] : knownChats.keys().flatMap((chatId) => {
    const peer = agentRuntime.peerSnapshot(chatId);
    return Object.keys(peer).length > 0 ? [{ chatId, ...peer }] : [];
  }),
  ingress: ingress.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    routed: entry.routed,
    createdAt: entry.createdAt,
    attempts: entry.attempts ?? 0,
    retryAt: entry.retryAt ?? 0,
    completedAt: entry.completedAt ?? 0,
    leaseId: entry.leaseId ?? null,
    leaseUntil: entry.leaseUntil ?? 0,
  })),
  deadLetters: deadLetters.map((entry) => ({ ...entry })),
});
const persist = () => stateStore.save(stateSnapshot());
const persistCritical = async () => {
  persist();
  return (await stateStore.flush()) === true;
};

let ingressMutationTail = Promise.resolve();
const mutateIngress = (operation) => {
  const next = ingressMutationTail.then(operation, operation);
  ingressMutationTail = next.catch(() => {});
  return next;
};
let ingressDurable = true;
let ingressDurabilityRetryTimer = null;
let ingressPumpTimer = null;
let ingressReplayTimer = null;
let pumpIngress = () => {};
let requestIngressReplay = () => {};
const scheduleIngressPump = (delayMs = 50) => {
  if (ingressPumpTimer != null) return;
  ingressPumpTimer = setTimeout(() => {
    ingressPumpTimer = null;
    pumpIngress();
  }, Math.max(1, delayMs));
  ingressPumpTimer.unref?.();
};
const scheduleIngressDurabilityRetry = () => {
  if (ingressDurabilityRetryTimer != null) return;
  ingressDurabilityRetryTimer = setTimeout(() => {
    ingressDurabilityRetryTimer = null;
    void mutateIngress(async () => {
      const saved = await persistCritical();
      if (!saved) {
        scheduleIngressDurabilityRetry();
        return false;
      }
      ingressDurable = true;
      wakeBridge();
      pumpIngress();
      return true;
    });
  }, 1000);
  ingressDurabilityRetryTimer.unref?.();
};

const subscriptions = new Map();
const subscriptionRetryTimers = new Map();
const subscriptionRetryAttempts = new Map();
const subscriptionCap = numberEnv("BOT_T3AMS_SUBSCRIPTION_CAP", 256, { min: 4, max: 4_096 });
const inboundCallbackCap = numberEnv("BOT_T3AMS_INGRESS_CALLBACK_CAP", 128, { min: 1, max: 1_024 });
const inboundCallbackConcurrency = numberEnv("BOT_T3AMS_INGRESS_CALLBACK_CONCURRENCY", 1, { min: 1, max: 16 });
const inboundCallbacks = [];
let activeInboundCallbacks = 0;
let drainInboundCallbacks = () => {};
const enqueueInboundCallback = (id, callback) => {
  if (inboundCallbacks.length + activeInboundCallbacks >= inboundCallbackCap) {
    log("T3AMS_INGRESS_CALLBACK_CAP_REACHED", { id, cap: inboundCallbackCap, queued: inboundCallbacks.length, active: activeInboundCallbacks });
    requestIngressReplay();
    return false;
  }
  inboundCallbacks.push({ id, callback });
  drainInboundCallbacks();
  return true;
};
drainInboundCallbacks = () => {
  while (activeInboundCallbacks < inboundCallbackConcurrency && inboundCallbacks.length > 0) {
    const next = inboundCallbacks.shift();
    activeInboundCallbacks += 1;
    Promise.resolve()
      .then(next.callback)
      .catch((error) => log("T3AMS_INGRESS_FAILED", { id: next.id, error: String(error?.message ?? error) }))
      .finally(() => {
        activeInboundCallbacks -= 1;
        drainInboundCallbacks();
      });
  }
};
const rawSubscriberModule = await import("./vendor/lib/statement-ingress-supervisor.mjs");
const subscribePages = rawSubscriberModule.createRawStatementPageSubscriber({ getClient: () => lazyClient.getClient() });
const asBytes = (data) => {
  try { return typeof data === "string" ? hexToBytes(data) : data; }
  catch { return null; }
};
const bytesEqual = (left, right) => left instanceof Uint8Array && right instanceof Uint8Array
  && left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
const clearSubscriptionRetry = (id) => {
  const timer = subscriptionRetryTimers.get(id);
  if (timer != null) clearTimeout(timer);
  subscriptionRetryTimers.delete(id);
  subscriptionRetryAttempts.delete(id);
};
const scheduleSubscriptionRetry = (id, token) => {
  if (subscriptions.get(id)?.token !== token || subscriptionRetryTimers.has(id)) return;
  const attempt = (subscriptionRetryAttempts.get(id) ?? 0) + 1;
  subscriptionRetryAttempts.set(id, attempt);
  const delay = Math.min(30_000, 500 * (2 ** Math.min(attempt - 1, 6)));
  const timer = setTimeout(() => {
    subscriptionRetryTimers.delete(id);
    if (subscriptions.get(id)?.token !== token) return;
    subscriptions.delete(id);
    syncSubscriptions();
  }, delay);
  timer.unref?.();
  subscriptionRetryTimers.set(id, timer);
  log("T3AMS_SUBSCRIPTION_RETRY_SCHEDULED", { id, attempt, delayMs: delay });
};
const subscription = (id, topic, callback, accepts = () => true, { force = false } = {}) => {
  const existing = subscriptions.get(id);
  if (!force && existing?.topicHex === Buffer.from(topic).toString("hex")) return;
  clearSubscriptionRetry(id);
  existing?.unsubscribe?.();
  const token = Symbol(id);
  const unsubscribe = subscribePages({ matchAll: [topic] }, (page) => {
    subscriptionRetryAttempts.delete(id);
    for (const statement of page.statements ?? []) {
      const data = asBytes(statement.data);
      if (!(data instanceof Uint8Array)) continue;
      if (!accepts(statement)) continue;
      enqueueInboundCallback(id, () => callback(data, statement));
    }
  }, (error) => {
    log("T3AMS_SUBSCRIPTION_FAILED", { id, error: String(error?.message ?? error) });
    scheduleSubscriptionRetry(id, token);
  });
  subscriptions.set(id, { topicHex: Buffer.from(topic).toString("hex"), unsubscribe, token });
};

const dispatcher = createKeyedDispatcher({
  concurrency: numberEnv("BOT_T3AMS_DISPATCH_CONCURRENCY", 4, { min: 1, max: 64 }),
  maxQueued: numberEnv("BOT_T3AMS_DISPATCH_QUEUE_CAP", 1000, { min: 1, max: 100_000 }),
});
// agent-runtime's transport-neutral chat API is keyed only by the stable
// conversation/session ID. The keyed dispatcher guarantees one active turn
// per such ID, so this short-lived map safely preserves the exact incoming
// thread root for commands, errors, and a model's eventual answer.
const activeReplyThreads = new Map();
const sendAgentReply = (chatId, text) => protocol.sendText(chatId, text, {
  threadRootId: activeReplyThreads.get(chatId) ?? null,
});

const inboundRetryTimers = new Map();
const inboundRetryAttempts = new Map();
const scheduleInboundRetry = (event, historyOnly) => {
  const key = typeof event?.ingressKey === "string" ? event.ingressKey : null;
  if (key == null || inboundRetryTimers.has(key)) return;
  const retryCap = Math.min(ingressCap, inboundCallbackCap);
  if (inboundRetryTimers.size >= retryCap) {
    log("T3AMS_INGRESS_RETRY_CAP_REACHED", { cap: retryCap });
    // A retained replay will restart this source once a timer slot frees.
    // Do not retain an orphaned exponential-backoff counter meanwhile.
    inboundRetryAttempts.delete(key);
    requestIngressReplay();
    return;
  }
  const attempt = (inboundRetryAttempts.get(key) ?? 0) + 1;
  const delay = Math.min(30_000, 500 * (2 ** Math.min(attempt - 1, 6)));
  const timer = setTimeout(() => {
    inboundRetryTimers.delete(key);
    const queued = enqueueInboundCallback(`retry:${key}`, async () => {
      const claimed = protocol.claimInbound(event);
      if (claimed == null) return;
      await routeOneInbound(claimed, { historyOnly });
    });
    // The retained subscription replay is the retry when the bounded callback
    // queue is full. Do not retain an orphaned per-message counter forever.
    if (!queued) inboundRetryAttempts.delete(key);
  }, delay);
  timer.unref?.();
  inboundRetryTimers.set(key, timer);
  inboundRetryAttempts.set(key, attempt);
  log("T3AMS_INGRESS_RETRY_SCHEDULED", { attempt, delayMs: delay });
};
const commitHistoryOnly = async (event) => mutateIngress(async () => {
  // Unaddressed channel traffic and carrier priors are only deduplicated.
  // They must not consume reply-route or relay-history state on a public bot.
  if (!protocol.commitInbound(event, { retainBackfill: false, retainConversation: false })) return false;
  const saved = await persistCritical();
  if (!saved) {
    ingressDurable = false;
    scheduleIngressDurabilityRetry();
    log("T3AMS_INGRESS_PERSIST_PENDING", { kind: "history" });
  } else {
    ingressDurable = true;
    pumpIngress();
  }
  return true;
});
const admitIngress = async (event, routed) => mutateIngress(async () => {
  if (ingress.length >= ingressCap) return { admitted: false, reason: "journal-full" };
  const entry = {
    id: randomUUID(),
    kind: brain === "bridge" || brain === "hermes" ? "bridge" : "turn",
    routed,
    createdAt: Date.now(),
    attempts: 0,
    retryAt: 0,
    completedAt: 0,
    leaseId: null,
    leaseUntil: 0,
  };
  ingress.push(entry);
  if (!protocol.commitInbound(event)) {
    ingress.pop();
    return { admitted: false, reason: "deduplicated" };
  }
  protocol.pinConversation(routed.conversationKey);
  knownChats.note(routed.conversationKey);
  const saved = await persistCritical();
  if (!saved) {
    // Keep the journal and the claimed/seen message in memory. The state
    // store retains this snapshot for retry; executing it before that retry
    // would turn a disk outage into a lost prompt on process crash.
    ingressDurable = false;
    scheduleIngressDurabilityRetry();
    log("T3AMS_INGRESS_PERSIST_PENDING", { kind: entry.kind });
    return { admitted: true, durable: false };
  }
  ingressDurable = true;
  wakeBridge();
  pumpIngress();
  return { admitted: true, durable: true };
});

const routeOneInbound = async (event, { historyOnly = false } = {}) => {
  if (event == null) return;
  if (!isAllowed(event.senderXid)) {
    protocol.releaseInbound(event);
    return;
  }
  const routed = normalizeT3amsInbound({
    conversationType: event.conversation.kind,
    senderXid: event.senderXid,
    senderName: event.senderName,
    workspaceId: event.conversation.wsId,
    channelId: event.conversation.channelIdHex,
    messageId: event.messageId,
    text: event.text,
    threadRootId: event.threadRootId,
    mentions: event.mentions,
  }, { xid: selfXidHex, aliases: [username, displayName] });
  if (!routed.accepted || historyOnly) {
    await commitHistoryOnly(event);
    if (!historyOnly) {
      log("T3AMS_INBOUND_IGNORED", { reason: routed.reason, chatId: event.chatId });
    }
    return;
  }
  const admission = await admitIngress(event, routed);
  if (!admission.admitted) {
    protocol.releaseInbound(event);
    log("T3AMS_INGRESS_BACKPRESSURE", { reason: admission.reason, chatId: event.chatId, queued: ingress.length, cap: ingressCap });
    if (admission.reason === "journal-full") scheduleInboundRetry(event, historyOnly);
    return;
  }
  inboundRetryAttempts.delete(event.ingressKey);
};

// A carrier's plaintext prior headers are never routed directly; protocol has
// already decrypted and authenticated each retained blob. Priors are history,
// not newly addressed prompts: retain/deduplicate them first, then send only
// the carrier's primary message to a brain or framework adapter.
const routeInbound = async (event) => {
  if (event == null) return;
  const { priorMessages, ...primary } = event;
  for (const prior of Array.isArray(priorMessages) ? priorMessages : []) {
    await routeOneInbound(prior, { historyOnly: true });
  }
  await routeOneInbound(primary);
};

const syncSubscriptions = ({ forceIds = new Set() } = {}) => {
  if (protocol == null) return;
  const desired = new Set();
  let omitted = 0;
  const subscribe = (id, topic, callback, accepts = () => true) => {
    if (!desired.has(id) && desired.size >= subscriptionCap) {
      omitted += 1;
      return false;
    }
    desired.add(id);
    subscription(id, topic, callback, accepts, { force: forceIds.has(id) });
    return true;
  };
  const inbox = bcts.derivePersonalInboxChannel(identity.xid);
  subscribe("inbox", inbox, async (data) => {
    const change = await protocol.receiveInbox(data);
    if (change != null) syncSubscriptions();
  }, (statement) => bytesEqual(asBytes(statement.channel), inbox));
  // Workspace control routes have priority over opportunistic public DMs: a
  // full DM roster must never orphan channel membership/key reconciliation.
  for (const wsId of protocol.workspaces()) {
    const planeTopic = bcts.deriveWorkspaceDiscoveryTopic(wsId);
    const notificationTopic = bcts.deriveUserNotificationTopic(identity.xid, wsId);
    const planeId = `ws-plane:${wsId}`;
    const notificationId = `ws-notify:${wsId}`;
    const planeChannelMatches = (statement) => {
      const actual = asBytes(statement.channel);
      if (!(actual instanceof Uint8Array)) return false;
      const expected = [bcts.deriveWorkspaceMetaChannel(wsId)];
      for (const memberXidHex of protocol.memberIds(wsId)) {
        try {
          const member = hexToBytes(memberXidHex);
          expected.push(bcts.deriveWorkspaceMemberChannel(wsId, member), bcts.deriveChannelRegistryChannel(wsId, member));
        } catch { /* ignore malformed restored member IDs */ }
      }
      return expected.some((channel) => bytesEqual(actual, channel));
    };
    subscribe(planeId, planeTopic, (data) => {
      if (protocol.receiveWorkspacePlane(wsId, data)) syncSubscriptions();
    }, planeChannelMatches);
    subscribe(notificationId, notificationTopic, (data) => {
      if (protocol.receiveWorkspaceNotification(wsId, data)) syncSubscriptions();
    }, (statement) => bytesEqual(asBytes(statement.channel), notificationTopic));
  }
  // Control-plane subscriptions come first. A channel-heavy early workspace
  // must not crowd out key/membership reconciliation for later workspaces.
  for (const wsId of protocol.workspaces()) {
    // The invite's initial state document need not yet include the bot. Keep
    // watching the workspace plane for the membership update, but do not
    // subscribe to or decrypt channel traffic until that update is verified.
    if (!protocol.isWorkspaceMember(wsId)) continue;
    for (const channel of protocol.channels(wsId)) {
      if (channel?.archived || channel?.deleted || typeof channel?.idHex !== "string") continue;
      // T3ams guests may read some channels but cannot post; a bot that cannot
      // respond must not spend a brain turn on that traffic. Announcement
      // channels also exclude guests at the read boundary.
      if (!protocol.canReadChannel(wsId, channel.idHex) || !protocol.canPostChannel(wsId, channel.idHex)) continue;
      let channelId;
      try { channelId = hexToBytes(channel.idHex); }
      catch {
        log("T3AMS_CHANNEL_ID_INVALID", { wsId });
        continue;
      }
      const topic = channel.isPrivate
        ? bcts.createPrivateChannelTopics(channelId, identity.xid, "message", true)[0]
        : bcts.createPublicChannelTopics(channelId, identity.xid, true)[0];
      const id = `channel:${wsId}:${bareHex(channel.idHex)}`;
      const messageChannel = channel.isPrivate ? bcts.derivePrivateChannel(channelId) : bcts.derivePublicChannel(channelId);
      subscribe(id, topic, (data) => routeInbound(protocol.receiveChannel(wsId, channel.idHex, data)), (statement) => bytesEqual(asBytes(statement.channel), messageChannel));
    }
  }
  for (const peerXidHex of protocol.peerIds()) {
    const peer = hexToBytes(peerXidHex);
    const dmChannel = bcts.derivePersonalDMChannel(identity.xid, peer);
    // The pairwise topic is keyed by the remote peer. Using our own XID here
    // would subscribe to the wrong half of the DM channel and miss replies.
    const topic = bcts.createDMTopics(dmChannel, peer, true)[0];
    const id = `dm:${peerXidHex}`;
    subscribe(id, topic, (data) => routeInbound(protocol.receiveDm(peerXidHex, data)), (statement) => bytesEqual(asBytes(statement.channel), dmChannel));
  }
  for (const [id, active] of subscriptions) {
    if (desired.has(id)) continue;
    clearSubscriptionRetry(id);
    active.unsubscribe();
    subscriptions.delete(id);
  }
  if (omitted > 0) {
    log("T3AMS_SUBSCRIPTION_CAP_REACHED", { cap: subscriptionCap, omitted, active: desired.size });
  }
};
const pendingTopologyRefreshes = new Set();
let topologySyncQueued = false;
const syncTopology = (change = null) => {
  const wsId = typeof change?.wsId === "string" ? change.wsId : null;
  if (wsId != null) {
    // A retained key notification may precede the registry/membership update,
    // and retained ciphertext may precede the key. Reopen the small affected
    // set after each verified topology change so neither is lost forever.
    pendingTopologyRefreshes.add(`ws-plane:${wsId}`);
    pendingTopologyRefreshes.add(`ws-notify:${wsId}`);
    if (change?.kind === "key" && typeof change.channelIdHex === "string") {
      pendingTopologyRefreshes.add(`channel:${wsId}:${bareHex(change.channelIdHex)}`);
    } else {
      for (const id of subscriptions.keys()) {
        if (id.startsWith(`channel:${wsId}:`)) pendingTopologyRefreshes.add(id);
      }
    }
  }
  if (topologySyncQueued) return;
  topologySyncQueued = true;
  queueMicrotask(() => {
    topologySyncQueued = false;
    const forceIds = new Set(pendingTopologyRefreshes);
    pendingTopologyRefreshes.clear();
    syncSubscriptions({ forceIds });
  });
};
// Statement Store streams can remain connected yet stop delivering retained
// updates. Reopen the bounded route set on a conservative cadence; all
// message handlers are idempotent/durable, so a replay is safer than a bot
// that silently stops hearing DMs or mentions.
const subscriptionRefreshMs = numberEnv("BOT_T3AMS_SUBSCRIPTION_REFRESH_MS", 120_000, { min: 10_000, max: 3_600_000 });
const subscriptionRefreshTimer = setInterval(() => {
  if (subscriptions.size === 0) return;
  log("T3AMS_SUBSCRIPTION_REFRESH", { count: subscriptions.size, intervalMs: subscriptionRefreshMs });
  syncSubscriptions({ forceIds: new Set(subscriptions.keys()) });
}, subscriptionRefreshMs);
subscriptionRefreshTimer.unref?.();
// Statement subscriptions are retained views, not destructive queues. When
// the bounded journal is full, reconnect once it drains so an uncommitted
// carrier is reconciled from its retained source instead of being forgotten.
requestIngressReplay = () => {
  if (ingressReplayTimer != null) return;
  ingressReplayTimer = setTimeout(() => {
    ingressReplayTimer = null;
    for (const [id, active] of subscriptions) {
      clearSubscriptionRetry(id);
      active.unsubscribe();
      subscriptions.delete(id);
    }
    syncSubscriptions();
  }, 1000);
  ingressReplayTimer.unref?.();
};

protocol = createT3amsProtocol({
  bcts,
  identity,
  displayName,
  state: restored?.t3ams ?? null,
  submit,
  isPeerAllowed: isAllowed,
  trustedPeerSigningKeys,
  requireTrustedPeers: allowedXids.size > 0,
  publicTofuEnrollment,
  maxPeers: publicTofuEnrollment ? publicPeerCap : undefined,
  maxWorkspaces: publicTofuEnrollment ? publicWorkspaceCap : undefined,
  maxConversations: Math.min(10_000, ingressCap + 128),
  publicPeerAdmissionLimit: publicPeerAdmissions,
  publicWorkspaceAdmissionLimit: publicWorkspaceAdmissions,
  acceptWorkspaceInvite: () => autoAcceptWorkspaces,
  onStateChange: () => persist(),
  onTopologyChange: syncTopology,
  log,
});
for (const entry of ingress) {
  if (!protocol.restoreInboundConversation(entry.routed)) {
    log("T3AMS_INGRESS_RESTORE_SKIPPED", { id: entry.id });
  } else {
    protocol.pinConversation(entry.routed.conversationKey);
  }
}
const presenceIntervalMs = numberEnv("BOT_T3AMS_PRESENCE_INTERVAL_MS", 60_000, { min: 10_000, max: 3_600_000 });
const presenceInFlight = new Set();
const publishWorkspacePresence = () => {
  for (const wsId of protocol.workspaces()) {
    // Never announce after removal or while an invite is still waiting for the
    // owner-signed state document to add the bot.
    if (!protocol.isWorkspaceMember(wsId) || presenceInFlight.has(wsId)) continue;
    presenceInFlight.add(wsId);
    void protocol.publishMemberAnnounce(wsId)
      .catch((error) => {
        log("T3AMS_MEMBER_HEARTBEAT_FAILED", { wsId, error: String(error?.message ?? error) });
      })
      .finally(() => presenceInFlight.delete(wsId));
  }
};
const presenceTimer = setInterval(publishWorkspacePresence, presenceIntervalMs);
presenceTimer.unref?.();
if (!autoAcceptWorkspaces) {
  log("T3AMS_WORKSPACE_AUTO_ACCEPT_DISABLED", { publicBot: allowedXids.size === 0 });
}

// Direct-engine setup mirrors the existing transport.  Its session key is the
// T3ams conversation key, so every DM and every channel has isolated native
// model memory while all threads in that channel share context.
const aiModel = (env.BOT_AI_MODEL ?? "").trim();
const modelSwitching = (env.BOT_AI_MODEL_SWITCHING ?? "locked").trim().toLowerCase();
const aiAllowedModels = resolveModelPolicy({
  configured: env.BOT_AI_ALLOWED_MODELS ?? null,
  isPublic: allowedXids.size === 0,
  allowOpen: modelSwitching === "open",
});
const customCmd = (env.BOT_AI_CMD ?? "").trim();
let customArgs = null;
if (customCmd && env.BOT_AI_ARGS) {
  try { customArgs = JSON.parse(env.BOT_AI_ARGS); } catch { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
  if (!Array.isArray(customArgs)) { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
}
const engine = customCmd ? RUNNERS.custom : resolveEngine(brain);
const optionalPosixId = (name) => {
  if (env[name] == null || env[name] === "") return null;
  return numberEnv(name, 0, { min: 0, max: 2_147_483_647 });
};
const aiAgentUid = optionalPosixId("BOT_AI_AGENT_UID");
const aiAgentGid = optionalPosixId("BOT_AI_AGENT_GID");
const defaultAiWorkspace = env.BOT_STATE_DIR
  ? path.join(path.dirname(path.resolve(stateDir)), `${path.basename(path.resolve(stateDir))}-workspace`)
  : fs.mkdtempSync(path.join(os.tmpdir(), "pca-t3ams-workspace-"));
const aiWorkspace = env.BOT_AI_WORKSPACE ?? defaultAiWorkspace;
let aiProjects = {};
if (env.BOT_AI_PROJECTS) {
  try { aiProjects = JSON.parse(env.BOT_AI_PROJECTS); } catch { console.error("BOT_AI_PROJECTS must be a JSON object {alias: path}"); process.exit(2); }
  if (aiProjects == null || typeof aiProjects !== "object" || Array.isArray(aiProjects)) {
    console.error("BOT_AI_PROJECTS must be a JSON object {alias: path}");
    process.exit(2);
  }
}
const aiReasoning = (env.BOT_AI_REASONING ?? "").trim();
if (engine && aiReasoning && !engine.effortLevels?.includes(aiReasoning)) {
  console.error(`BOT_AI_REASONING=${aiReasoning} is not valid for this engine${engine.effortLevels ? ` (levels: ${engine.effortLevels.join(", ")})` : " (it has no reasoning control)"}`);
  process.exit(2);
}
const renderT3amsForBrain = (message) => {
  const sender = message.senderName || message.senderXid || "unknown sender";
  const scope = message.conversationType === "channel"
    ? `channel ${message.workspaceId}/${message.channelId}`
    : "direct message";
  const thread = message.threadRootId ? `; thread ${message.threadRootId}` : "";
  // Channel sessions intentionally share memory. Include the authenticated
  // sender/scope so a direct brain can distinguish participants without
  // changing the transport-neutral message API.
  return `[T3ams ${scope}; sender ${sender}${thread}]\n${message.text}`;
};
if (engine != null) {
  fs.mkdirSync(aiWorkspace, { recursive: true, mode: 0o700 });
  const workspaces = createWorkspaces({
    projects: aiProjects,
    worktreesDir: env.BOT_AI_WORKTREES_DIR ?? path.join(aiWorkspace, ".worktrees"),
    agentUid: aiAgentUid,
    agentGid: aiAgentGid,
    log,
  });
  agentRuntime = createAgentRuntime({
    engine,
    engineName: customCmd ? "custom" : brain,
    engineCommand: customCmd || engine.command,
    buildArgs: ({ prompt, model, resume, effort }) => customCmd
      ? (customArgs ? customArgs.map((item) => item === "__PROMPT__" ? prompt : item) : [prompt])
      : engine.buildArgs({
        prompt, model, resume, effort,
        allowedTools: String(env.BOT_AI_ALLOWED_TOOLS ?? "Bash,Read,Edit,Write").split(",").map((item) => item.trim()).filter(Boolean),
        skipPermissions: env.BOT_AI_SKIP_PERMISSIONS === "1",
      }),
    workspace: aiWorkspace,
    workspaces,
    model: aiModel,
    allowedModels: aiAllowedModels,
    reasoning: aiReasoning,
    idleMs: numberEnv("BOT_AI_IDLE_TIMEOUT_MS", 600_000, { min: 1000, max: 7 * 86_400_000 }),
    maxMs: numberEnv("BOT_AI_MAX_MS", 3_600_000, { min: 1000, max: 7 * 86_400_000 }),
    maxConcurrentTurns: numberEnv("BOT_AI_MAX_CONCURRENT_TURNS", 4, { min: 1, max: 128 }),
    maxQueuedTurns: numberEnv("BOT_AI_MAX_QUEUED_TURNS", 100, { min: 0, max: 10_000 }),
    maxOutputBytes: numberEnv("BOT_AI_MAX_OUTPUT_BYTES", 1_000_000, { min: 1024, max: 64 * 1024 * 1024 }),
    peerCap: knownChatCap,
    agentUid: aiAgentUid,
    agentGid: aiAgentGid,
    renderMessage: renderT3amsForBrain,
    chat: {
      sendText: sendAgentReply,
      deliver: async (chatId, text) => {
        for (const part of splitMessageText(text, numberEnv("BOT_REPLY_CHUNK_BYTES", 4000, { min: 128, max: MAX_T3AMS_TEXT_BYTES }))) {
          await sendAgentReply(chatId, part);
        }
      },
      beginTurn: () => null,
    },
    throwOnReplyFailure: true,
    username,
    chainConnected: isChainConnected,
    log,
    persist,
  });
  agentRuntime.noteRestoredAgent(restored?.agent ?? null);
  // A current snapshot contains at most the bounded known-chat index plus
  // its bounded durable ingress overflow. Cap legacy/corrupt state too.
  const restoredAgentPeers = Array.isArray(restored?.agentPeers)
    ? restored.agentPeers.slice(-(knownChatCap + ingressCap))
    : [];
  for (const entry of restoredAgentPeers) {
    if (typeof entry?.chatId !== "string") continue;
    if (!knownChats.note(entry.chatId)) continue;
    agentRuntime.restorePeer(entry.chatId, entry);
  }
}

// Direct brains consume journal entries through the normal keyed dispatcher.
// The entry stays durable until the turn completes, yielding at-least-once
// processing after a crash rather than a prompt silently disappearing.
const runningIngress = new Set();
const completeIngressTurn = async (entry) => mutateIngress(async () => {
  const index = ingress.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0) return true;
  const current = ingress[index];
  // First durably mark that the external side effect has completed. If the
  // later removal write fails, retries only finish the journal cleanup rather
  // than invoking a model (or echo) a second time.
  if (!Number.isSafeInteger(current.completedAt) || current.completedAt <= 0) {
    current.completedAt = Date.now();
    const marked = await persistCritical();
    if (!marked) {
      ingressDurable = false;
      scheduleIngressDurabilityRetry();
      return false;
    }
    ingressDurable = true;
  }
  const [removed] = ingress.splice(index, 1);
  const saved = await persistCritical();
  if (saved) {
    protocol.unpinConversation(removed.routed.conversationKey);
    // A completed turn is the most recently useful native session. Refresh
    // it after releasing its journal pin, then contract any temporary
    // protected-only known-chat overflow.
    knownChats.note(removed.routed.conversationKey);
    knownChats.trim();
    ingressDurable = true;
    return true;
  }
  // Do not forget a successfully answered prompt until the removal itself is
  // durable. A retry can duplicate an answer after a disk outage, but never
  // loses the customer's message.
  ingress.splice(index, 0, removed);
  ingressDurable = false;
  persist();
  scheduleIngressDurabilityRetry();
  return false;
});
const isTerminalIngressError = (error) => error?.t3amsTerminal === true
  || new Set([
    "T3AMS_UNKNOWN_CONVERSATION",
    "T3AMS_INVALID_TEXT",
    "T3AMS_INVALID_THREAD",
    "T3AMS_CHANNEL_UNAVAILABLE",
    "T3AMS_CHANNEL_FORBIDDEN",
    "T3AMS_CHANNEL_KEY_MISSING",
    "T3AMS_INVALID_INGRESS",
  ]).has(error?.code);
const deadLetterIngressTurn = async (entry, error) => mutateIngress(async () => {
  const index = ingress.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0) return true;
  const [removed] = ingress.splice(index, 1);
  const priorDeadLetters = deadLetters.map((candidate) => ({ ...candidate }));
  const record = {
    id: removed.id,
    conversationKey: removed.routed.conversationKey,
    code: String(error?.code ?? "T3AMS_TERMINAL_DELIVERY_ERROR").slice(0, 128),
    droppedAt: Date.now(),
  };
  deadLetters.push(record);
  while (deadLetters.length > deadLetterCap) deadLetters.shift();
  const saved = await persistCritical();
  if (saved) {
    protocol.unpinConversation(removed.routed.conversationKey);
    knownChats.trim();
    ingressDurable = true;
    log("T3AMS_DISPATCH_DEAD_LETTER", { id: removed.id, chatId: record.conversationKey, code: record.code });
    return true;
  }
  deadLetters.splice(0, deadLetters.length, ...priorDeadLetters);
  ingress.splice(index, 0, removed);
  ingressDurable = false;
  persist();
  scheduleIngressDurabilityRetry();
  return false;
});
const deferIngressTurn = async (entry, error) => {
  const delay = await mutateIngress(async () => {
    const current = ingress.find((candidate) => candidate.id === entry.id);
    if (current == null) return null;
    current.attempts = Math.min(100, (Number(current.attempts) || 0) + 1);
    const retryDelay = Math.min(60_000, 1000 * (2 ** Math.min(current.attempts - 1, 6)));
    current.retryAt = Date.now() + retryDelay;
    const saved = await persistCritical();
    if (!saved) {
      ingressDurable = false;
      scheduleIngressDurabilityRetry();
    } else {
      ingressDurable = true;
    }
    return retryDelay;
  });
  if (delay != null) scheduleIngressPump(delay);
  log("T3AMS_DISPATCH_FAILED", { error: String(error?.message ?? error) });
};
const executeIngressTurn = async (entry) => {
  const routed = entry.routed;
  if (!protocol.restoreInboundConversation(routed)) {
    const error = new Error("invalid durable T3ams ingress route");
    error.code = "T3AMS_INVALID_INGRESS";
    error.t3amsTerminal = true;
    throw error;
  }
  const message = {
    text: routed.message.text,
    ...(typeof routed.message.commandText === "string" ? { commandText: routed.message.commandText } : {}),
    messageId: routed.message.messageId,
    kind: "text",
    threadRootId: routed.message.threadRootId,
    conversationType: routed.message.conversationType,
    workspaceId: routed.message.workspaceId,
    channelId: routed.message.channelId,
    senderXid: routed.message.senderXid,
    senderName: routed.message.senderName,
  };
  if (brain === "echo") {
    await protocol.sendText(routed.conversationKey, `Echo: ${message.text}`, { threadRootId: routed.replyTarget.threadRootId });
    return;
  }
  if (agentRuntime == null) throw new Error("no direct T3ams agent runtime is configured");
  const hadPrevious = activeReplyThreads.has(routed.conversationKey);
  const previous = activeReplyThreads.get(routed.conversationKey);
  activeReplyThreads.set(routed.conversationKey, routed.replyTarget.threadRootId);
  try {
    const handled = await agentRuntime.handleMessage(routed.conversationKey, message);
    if (handled !== true) throw new Error("agent turn was interrupted before completion");
  } finally {
    if (hadPrevious) activeReplyThreads.set(routed.conversationKey, previous);
    else activeReplyThreads.delete(routed.conversationKey);
  }
};
pumpIngress = () => {
  if (!ingressDurable) return;
  const current = Date.now();
  const blockedChats = new Set();
  let nextRetryAt = null;
  for (const entry of ingress) {
    if (entry.kind !== "turn") continue;
    const chatId = entry.routed.conversationKey;
    if (blockedChats.has(chatId)) continue;
    if (runningIngress.has(entry.id)) {
      blockedChats.add(chatId);
      continue;
    }
    if (Number(entry.retryAt) > current) {
      blockedChats.add(chatId);
      nextRetryAt = nextRetryAt == null ? entry.retryAt : Math.min(nextRetryAt, entry.retryAt);
      continue;
    }
    const task = dispatcher.run(chatId, async () => {
      try {
        if (!Number.isSafeInteger(entry.completedAt) || entry.completedAt <= 0) {
          await executeIngressTurn(entry);
        }
        if (!await completeIngressTurn(entry)) throw new Error("ingress completion is not durable yet");
      } catch (error) {
        if (isTerminalIngressError(error) && await deadLetterIngressTurn(entry, error)) return;
        await deferIngressTurn(entry, error);
        throw error;
      }
    });
    if (task == null) {
      log("T3AMS_DISPATCH_BACKPRESSURE", dispatcher.stats());
      scheduleIngressPump(100);
      break;
    }
    runningIngress.add(entry.id);
    blockedChats.add(chatId);
    task.catch(() => {}).finally(() => {
      runningIngress.delete(entry.id);
      pumpIngress();
    });
  }
  if (nextRetryAt != null) scheduleIngressPump(Math.max(1, nextRetryAt - Date.now()));
};

// Bridge/Hermes/OpenClaw adapters receive the same durable entries as leased
// array items. The HTTP shape remains unchanged, while ACK and renewal now
// update the on-disk journal before reporting success.
const bridgeQueued = () => ingress.filter((entry) => entry.kind === "bridge").length;
const leaseBridgeIngress = async (limit) => mutateIngress(async () => {
  if (!ingressDurable) return [];
  const current = Date.now();
  const leased = [];
  for (const entry of ingress) {
    if (leased.length >= limit) break;
    if (entry.kind !== "bridge" || Number(entry.leaseUntil) > current) continue;
    entry.leaseId = randomUUID();
    entry.leaseUntil = current + leaseMs;
    leased.push(entry);
  }
  if (leased.length === 0) return [];
  const saved = await persistCritical();
  if (!saved) {
    for (const entry of leased) {
      entry.leaseId = null;
      entry.leaseUntil = 0;
    }
    ingressDurable = false;
    persist();
    scheduleIngressDurabilityRetry();
    return [];
  }
  ingressDurable = true;
  return leased.map((entry) => ({
    ...toT3amsBridgeInbound(entry.routed),
    delivery_id: entry.id,
    lease_id: entry.leaseId,
    lease_until: entry.leaseUntil,
    lease_ms: leaseMs,
  }));
});
const updateBridgeLeases = async (claims, acknowledge) => mutateIngress(async () => {
  const before = ingress.map((entry) => ({ ...entry }));
  const acknowledged = [];
  let changed = 0;
  for (const claim of claims) {
    if (claim == null || typeof claim.delivery_id !== "string" || typeof claim.lease_id !== "string") continue;
    const index = ingress.findIndex((entry) => entry.id === claim.delivery_id && entry.leaseId === claim.lease_id);
    if (index < 0) continue;
    if (acknowledge) acknowledged.push(...ingress.splice(index, 1));
    else ingress[index].leaseUntil = Date.now() + leaseMs;
    changed += 1;
  }
  if (changed === 0) return { changed: 0, durable: true };
  const saved = await persistCritical();
  if (saved) {
    for (const entry of acknowledged) protocol.unpinConversation(entry.routed.conversationKey);
    knownChats.trim();
    ingressDurable = true;
    pumpIngress();
    return { changed, durable: true };
  }
  ingress.splice(0, ingress.length, ...before);
  ingressDurable = false;
  persist();
  scheduleIngressDurabilityRetry();
  return { changed: 0, durable: false };
});
const readBody = (request, max = 1_000_000) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  request.on("data", (chunk) => { size += chunk.length; if (size > max) { reject(new Error("request body too large")); request.destroy(); } else chunks.push(chunk); });
  request.on("end", () => resolve(Buffer.concat(chunks)));
  request.on("error", reject);
});
const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
const authorized = (request) => {
  const supplied = String(request.headers.authorization ?? request.headers["x-bridge-token"] ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied); const b = Buffer.from(bridgeToken);
  return a.length === b.length && timingSafeEqual(a, b);
};
const bridge = http.createServer(async (request, response) => {
  try {
    if (!authorized(request)) return json(response, 401, { success: false, error: "unauthorized" });
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: isChainConnected(), transport: "t3ams", account: material.accountIdHex, identifierKey: null, xid: selfXidHex, username, subscriptions: subscriptions.size, bridge: { queued: bridgeQueued() } });
    }
    if (request.method === "GET" && url.pathname === "/inbound") {
      const limit = Math.min(32, Math.max(1, Number(url.searchParams.get("limit") ?? 1) || 1));
      let items = await leaseBridgeIngress(limit);
      if (items.length === 0) {
        const wait = Math.min(30, Math.max(0, Number(url.searchParams.get("wait") ?? 0) || 0));
        if (wait > 0) {
          await new Promise((resolve) => {
            const wake = () => { clearTimeout(timer); bridgeWaiters.delete(wake); resolve(); };
            const timer = setTimeout(wake, wait * 1000);
            bridgeWaiters.add(wake);
          });
        }
        items = await leaseBridgeIngress(limit);
      }
      // Keep the established bridge contract: framework adapters expect a
      // leased array directly, not a transport-specific response envelope.
      return json(response, 200, items);
    }
    if (request.method === "POST" && (url.pathname === "/inbound/ack" || url.pathname === "/inbound/renew")) {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const claims = Array.isArray(body.deliveries)
        ? body.deliveries
        : Array.isArray(body.claims)
          ? body.claims
          : body.delivery_id || body.lease_id
            ? [body]
            : [];
      const result = await updateBridgeLeases(claims, url.pathname.endsWith("/ack"));
      if (!result.durable) return json(response, 503, { success: false, error: "state persistence pending; retry the claim" });
      return json(response, 200, { success: true, [url.pathname.endsWith("/ack") ? "acknowledged" : "renewed"]: result.changed });
    }
    if (request.method === "POST" && url.pathname === "/send") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const chatId = typeof body.chat_id === "string" ? body.chat_id : "";
      const text = typeof body.text === "string" ? body.text : "";
      if (!chatId || !text) return json(response, 400, { success: false, error: "chat_id and text are required" });
      if (Buffer.byteLength(text, "utf8") > MAX_T3AMS_TEXT_BYTES) return json(response, 413, { success: false, error: "text too large" });
      if (body.edit_of != null || body.file_path != null) return json(response, 400, { success: false, error: "T3ams v1 supports text replies only" });
      if (body.thread_root_id != null && typeof body.thread_root_id !== "string") {
        return json(response, 400, { success: false, error: "thread_root_id must be a string" });
      }
      const replyTo = typeof body.reply_to === "string"
        ? body.reply_to
        : typeof body.reply_to_message_id === "string"
          ? body.reply_to_message_id
          : null;
      const root = body.thread_root_id == null
        ? protocol.replyThreadFor(chatId, replyTo)
        : bareHex(body.thread_root_id);
      const sent = await protocol.sendText(chatId, text, { threadRootId: root });
      return json(response, 200, { success: true, message_id: sent.messageId });
    }
    return json(response, 404, { success: false, error: "not found" });
  } catch (error) {
    return json(response, 500, { success: false, error: String(error?.message ?? error).slice(0, 300) });
  }
});

const pidfile = path.join(stateDir, "t3ams.pid");
const pidTakeoverFile = `${pidfile}.takeover`;
const refusePidfile = (holder) => {
  console.error(`Another T3ams bot process (${holder}) may already be using ${stateDir}`);
  process.exit(1);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pidIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};
const lockFileIsFreshAndEmpty = (content, stat) => content === "" && Date.now() - Number(stat?.mtimeMs ?? 0) < 1000;
const acquirePidTakeover = async () => {
  // Stale recovery needs a second, short-lived mutex. Normal process startup
  // never touches this path; it serializes the rename/recreate sequence so a
  // second contender cannot move the first contender's newly created pidfile.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let fd = null;
    try {
      fd = fs.openSync(pidTakeoverFile, "wx", 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (error) {
      try { if (fd != null) fs.closeSync(fd); } catch { /* noop */ }
      if (error?.code !== "EEXIST") throw error;
      let holder = "";
      let stat = null;
      try {
        holder = fs.readFileSync(pidTakeoverFile, "utf8").trim();
        stat = fs.statSync(pidTakeoverFile);
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      if (pidIsAlive(Number.parseInt(holder, 10)) || lockFileIsFreshAndEmpty(holder, stat)) {
        await delay(25);
        continue;
      }
      // The previous takeover owner crashed before it could release its tiny
      // mutex. Quarantine rather than unlinking a path we only observed.
      const quarantine = `${pidTakeoverFile}.stale.${process.pid}.${randomUUID()}`;
      try {
        fs.renameSync(pidTakeoverFile, quarantine);
      } catch (renameError) {
        if (renameError?.code === "ENOENT") continue;
        throw renameError;
      }
      try { fs.rmSync(quarantine, { force: true }); } catch { /* best effort */ }
    }
  }
  throw new Error("could not acquire the stale-pid takeover mutex");
};
const releasePidTakeover = () => {
  try {
    if (fs.readFileSync(pidTakeoverFile, "utf8").trim() === String(process.pid)) fs.rmSync(pidTakeoverFile, { force: true });
  } catch { /* noop */ }
};
const acquirePidfile = async () => {
  // `wx` handles the normal case. A stale-file takeover is a two-step
  // operation, so never unlink the shared path after merely reading it: move
  // the stale candidate to a per-process quarantine first. Only one contender
  // can win that atomic rename; everyone else retries `wx` against the winner.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let fd = null;
    try {
      fd = fs.openSync(pidfile, "wx", 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (error) {
      try { if (fd != null) fs.closeSync(fd); } catch { /* noop */ }
      if (error?.code !== "EEXIST") throw error;
      let previous = "";
      let stat = null;
      try {
        previous = fs.readFileSync(pidfile, "utf8").trim();
        stat = fs.statSync(pidfile);
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      const previousPid = Number.parseInt(previous, 10);
      if (pidIsAlive(previousPid)) refusePidfile(`pid ${previousPid}`);
      // A newly created exclusive file has a tiny window before its owner
      // writes the PID. Treat a fresh empty file as in-progress, rather than
      // stealing it and allowing two starters to run.
      if (lockFileIsFreshAndEmpty(previous, stat)) {
        await delay(25);
        continue;
      }
      await acquirePidTakeover();
      try {
        // Re-read after acquiring the mutex: another contender could have
        // recovered the stale pidfile while we were waiting for it.
        try {
          previous = fs.readFileSync(pidfile, "utf8").trim();
          stat = fs.statSync(pidfile);
        } catch (readError) {
          if (readError?.code === "ENOENT") continue;
          throw readError;
        }
        const currentPid = Number.parseInt(previous, 10);
        if (pidIsAlive(currentPid)) refusePidfile(`pid ${currentPid}`);
        if (lockFileIsFreshAndEmpty(previous, stat)) {
          await delay(25);
          continue;
        }
        const quarantine = `${pidfile}.stale.${process.pid}.${randomUUID()}`;
        try {
          fs.renameSync(pidfile, quarantine);
        } catch (renameError) {
          if (renameError?.code === "ENOENT") continue;
          throw renameError;
        }
        try { fs.rmSync(quarantine, { force: true }); } catch { /* best effort */ }
      } finally {
        releasePidTakeover();
      }
    }
  }
  throw new Error("could not acquire an exclusive T3ams state lock");
};
try {
  await acquirePidfile();
} catch (error) {
  console.error(`Unable to acquire the T3ams state lock in ${stateDir}: ${String(error?.message ?? error)}`);
  process.exit(1);
}
const cleanupPidfile = () => {
  try {
    if (fs.readFileSync(pidfile, "utf8").trim() === String(process.pid)) fs.rmSync(pidfile, { force: true });
  } catch { /* noop */ }
};
process.once("exit", cleanupPidfile);
const shutdown = async (code = 0) => {
  for (const [id, entry] of subscriptions) {
    clearSubscriptionRetry(id);
    entry.unsubscribe();
  }
  if (ingressDurabilityRetryTimer != null) clearTimeout(ingressDurabilityRetryTimer);
  if (ingressPumpTimer != null) clearTimeout(ingressPumpTimer);
  if (ingressReplayTimer != null) clearTimeout(ingressReplayTimer);
  clearInterval(subscriptionRefreshTimer);
  for (const timer of inboundRetryTimers.values()) clearTimeout(timer);
  clearInterval(presenceTimer);
  wakeBridge();
  bridge.close();
  await agentRuntime?.shutdown?.();
  await stateStore.flush();
  cleanupPidfile();
  process.exit(code);
};
process.once("SIGINT", () => { void shutdown(0); });
process.once("SIGTERM", () => { void shutdown(0); });

syncSubscriptions();
publishWorkspacePresence();
pumpIngress();
bridge.listen(bridgePort, bridgeHost, () => {
  log("BOT_LISTENING", { transport: "t3ams", endpoint, account: material.accountIdHex, xid: selfXidHex, username, brain });
});
