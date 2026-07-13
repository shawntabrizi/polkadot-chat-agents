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
import { createLiveReplies, createProgressTracker } from "./lib/live-reply.mjs";
import { createWorkspaces } from "./lib/workspaces.mjs";
import { createKeyedDispatcher } from "./lib/keyed-dispatcher.mjs";
import { createFileStore } from "./lib/file-store.mjs";
import { createFileCommandHandler } from "./lib/file-commands.mjs";
import { RUNNERS, resolveEngine } from "./lib/runners.mjs";
import { deriveT3amsIdentity } from "./lib/t3ams-identity.mjs";
import { createT3amsProtocol, hexToBytes, bareHex } from "./lib/t3ams-protocol.mjs";
import { createT3amsMedia } from "./lib/t3ams-media.mjs";
import { DEFAULT_T3AMS_ATTACHMENT_MIME_TYPES } from "./lib/t3ams-attachments.mjs";
import { createT3amsChannelContext } from "./lib/t3ams-channel-context.mjs";
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
const DEFAULT_BULLETIN_ENDPOINT = "wss://paseo-bulletin-next-rpc.polkadot.io";
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
// A slow turn should visibly make progress in the T3ams client. The native
// protocol supports durable edits, so a single placeholder becomes thinking,
// tool activity, then the final answer (rather than accumulating bubbles).
const thinkingText = env.BOT_THINKING_TEXT ?? "🤔 One moment — thinking…";
const thinkingAfterMs = numberEnv("BOT_THINKING_AFTER_MS", 5_000, { min: 0, max: 86_400_000 });
const liveMinEditMs = numberEnv("BOT_LIVE_EDIT_MIN_MS", 3_000, { min: 100, max: 86_400_000 });
const liveMaxEditMs = numberEnv("BOT_LIVE_EDIT_MAX_MS", 15_000, { min: liveMinEditMs, max: 86_400_000 });
const liveHeartbeatMs = numberEnv("BOT_LIVE_HEARTBEAT_MS", 15_000, { min: 100, max: 86_400_000 });
const liveFinalAckWaitMs = numberEnv("BOT_LIVE_FINAL_ACK_WAIT_MS", 10_000, { min: 100, max: 86_400_000 });
const liveProgress = env.BOT_LIVE_PROGRESS !== "0";
const liveTtlMs = numberEnv("BOT_LIVE_TTL_MS", 600_000, { min: 1000, max: 7 * 86_400_000 });
const liveTimeoutText = env.BOT_LIVE_TIMEOUT_TEXT
  ?? "⚠️ I lost track of this one — something went wrong on my end. Please send it again.";
const replyChunkBytes = numberEnv("BOT_REPLY_CHUNK_BYTES", 4_000, { min: 128, max: MAX_T3AMS_TEXT_BYTES });

// T3ams puts a small encrypted HOP capability inside each BCTS attachment
// reference.  Keep the accepted surface explicit: bot-core treats the bytes
// as inert files and never executes them, while an operator may narrow the
// MIME list for a public deployment.  These caps are shared by protocol
// decoding, the private media cache, and outbound file delivery.
const attachmentMaxBytes = numberEnv("BOT_T3AMS_ATTACHMENT_MAX_BYTES", 25 * 1024 * 1024, { min: 1, max: 25 * 1024 * 1024 });
const attachmentMaxCount = numberEnv("BOT_T3AMS_ATTACHMENT_MAX_COUNT", 4, { min: 0, max: 4 });
const attachmentMimeRaw = env.BOT_T3AMS_ATTACHMENT_MIME_TYPES;
const attachmentMimeTypes = attachmentMimeRaw == null || attachmentMimeRaw.trim() === ""
  ? [...DEFAULT_T3AMS_ATTACHMENT_MIME_TYPES]
  : attachmentMimeRaw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const attachmentMimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
if (attachmentMimeTypes.length === 0 || attachmentMimeTypes.some((mime) => !attachmentMimePattern.test(mime))) {
  console.error("BOT_T3AMS_ATTACHMENT_MIME_TYPES must be a comma-separated list of MIME types");
  process.exit(2);
}
const attachmentOptions = {
  maxBytes: attachmentMaxBytes,
  maxCount: attachmentMaxCount,
  allowedMimeTypes: [...new Set(attachmentMimeTypes)],
};
// Explicit empty value turns retrieval/upload off, which is useful for an
// operator who wants metadata-only bot behavior.  Otherwise use the exact
// Bulletin network configured by the current T3ams SPA.
const bulletinRpc = env.BOT_T3AMS_BULLETIN_RPC == null
  ? DEFAULT_BULLETIN_ENDPOINT
  : env.BOT_T3AMS_BULLETIN_RPC.trim();
const t3amsHopAllowInsecure = env.BOT_T3AMS_HOP_ALLOW_INSECURE === "1"; // test-only ws:// mock support
const t3amsHopTimeoutMs = numberEnv("BOT_T3AMS_HOP_TIMEOUT_MS", 120_000, { min: 1000, max: 86_400_000 });
const t3amsHopRpcFrameMaxBytes = numberEnv("BOT_T3AMS_HOP_RPC_FRAME_MAX_BYTES", 4_500_000, { min: 1024, max: 32 * 1024 * 1024 });
const t3amsMediaTtlHours = numberEnv("BOT_T3AMS_MEDIA_TTL_HOURS", 48, { min: 1, max: 24 * 365 });
const t3amsMediaMaxTotalMb = numberEnv("BOT_T3AMS_MEDIA_MAX_TOTAL_MB", 512, { min: 1, max: 32 * 1024 });
const t3amsMediaConcurrentDownloads = numberEnv("BOT_T3AMS_MEDIA_MAX_CONCURRENT_DOWNLOADS", 2, { min: 1, max: 64 });
const t3amsMediaReserve = (bytes) => Math.max(1, bytes * 2 + 4 * 1024 * 1024);
const t3amsMediaMaxInflightBytes = numberEnv(
  "BOT_T3AMS_MEDIA_MAX_INFLIGHT_BYTES",
  Math.max(t3amsMediaReserve(attachmentMaxBytes), 64 * 1024 * 1024),
  { min: t3amsMediaReserve(attachmentMaxBytes), max: 4 * 1024 * 1024 * 1024 },
);
const t3amsMediaDownloadQueueCap = numberEnv("BOT_T3AMS_MEDIA_DOWNLOAD_QUEUE_CAP", 100, { min: 1, max: 10_000 });

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
// Bridge workers do not execute inside the direct-runtime dispatcher, so hold
// their trigger's thread root until the worker ACKs its lease. Per-chat bridge
// leasing below guarantees that this never races two active turns.
const bridgeReplyThreads = new Map();
const replyThreadFor = (chatId) => activeReplyThreads.has(chatId)
  ? activeReplyThreads.get(chatId)
  : bridgeReplyThreads.get(chatId) ?? null;
// The bridge may only request an edit of a message this process issued. The
// client independently enforces author matching, but this local guard avoids
// signing pointless or surprising operations for arbitrary message IDs.
const botIssuedMessages = new Map(); // chatId -> Set<messageId>
const noteBotIssuedMessage = (chatId, messageId) => {
  const id = bareHex(messageId);
  if (!/^[0-9a-f]{64}$/.test(id)) return false;
  const ids = botIssuedMessages.get(chatId) ?? new Set();
  ids.delete(id);
  ids.add(id);
  while (ids.size > 256) ids.delete(ids.values().next().value);
  botIssuedMessages.delete(chatId);
  botIssuedMessages.set(chatId, ids);
  while (botIssuedMessages.size > knownChatCap) botIssuedMessages.delete(botIssuedMessages.keys().next().value);
  return true;
};
const isBotIssuedMessage = (chatId, messageId) => botIssuedMessages.get(chatId)?.has(bareHex(messageId)) === true;

// ---------- attachments and durable files ----------
// File-store namespaces must be 32-byte hex, while T3ams conversation IDs
// include a type and (for channels) two identities.  A domain-separated hash
// keeps the vault opaque and prevents a DM/channel collision.
const fileNamespaceForChat = (chatId) => {
  if (!isT3amsConversationKey(chatId)) throw new Error("invalid T3ams file namespace");
  return createHash("sha256").update("pca:t3ams-file-v1\0").update(chatId).digest("hex");
};
const fetchT3amsAttachments = async (attachments) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  // Never mutate an ingress entry's durable route with an ephemeral cache
  // path.  A restart can safely re-fetch from the encrypted capability.
  const prepared = attachments.map((attachment) => ({ ...attachment }));
  return t3amsMedia.fetchAttachments(prepared);
};
const sendT3amsAttachment = async (chatId, {
  filePath,
  mime,
  size,
  text = null,
  filename = null,
  threadRootId = undefined,
} = {}) => {
  if (!t3amsMedia.enabled) {
    throw new Error("T3ams file delivery is disabled; configure BOT_T3AMS_BULLETIN_RPC and a funded Bulletin allowance");
  }
  // A bridge vault can preserve a more specific MIME than T3ams has elected
  // to admit inbound. It is still safe to send the opaque bytes as the
  // standards-defined generic type, rather than making saved arbitrary files
  // impossible to retrieve through the chat.
  const requestedMime = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  const outgoingMime = attachmentOptions.allowedMimeTypes.includes(requestedMime)
    ? requestedMime
    : attachmentOptions.allowedMimeTypes.includes("application/octet-stream")
      ? "application/octet-stream"
      : null;
  if (outgoingMime == null) {
    throw new Error("file MIME is outside this bot's T3ams attachment policy");
  }
  const uploaded = await t3amsMedia.upload({ filePath, mime: outgoingMime, size, filename });
  const body = typeof text === "string" ? text : uploaded.attachment.filename;
  const root = threadRootId === undefined ? replyThreadFor(chatId) : threadRootId;
  const sent = await protocol.sendRichText(chatId, body, {
    ...(root == null ? {} : { threadRootId: root }),
    attachments: [uploaded.ref],
  });
  noteBotIssuedMessage(chatId, sent.messageId);
  log("T3AMS_SENT_FILE", { chatId, mime: uploaded.attachment.mime, bytes: uploaded.attachment.size });
  return { ...sent, attachment: uploaded.attachment };
};
const fileCommandChats = new Map();
// The durable file store is configured only after the authenticated protocol
// is restored below. Defer this binding so module initialization never reads
// `fileStore` while it is still in its temporal-dead-zone.
let fileCommandHandler = null;
const handleT3amsFileCommand = async (chatId, message) => {
  if (fileCommandHandler == null) throw new Error("T3ams file commands are not initialized");
  const namespace = fileNamespaceForChat(chatId);
  fileCommandChats.set(namespace, chatId);
  try {
    // A mentioned channel invocation carries a trimmed commandText, whereas
    // its raw text remains useful to a model. The vault command is transport
    // owned, so it must consume the explicit slash form.
    return await fileCommandHandler(namespace, {
      ...message,
      text: typeof message.commandText === "string" ? message.commandText : message.text,
    });
  } finally {
    fileCommandChats.delete(namespace);
  }
};

// ---------- live replies and typing ----------
// T3ams ops are independently retained and the SPA buffers an edit which
// arrives before its original message. Unlike the legacy session slot, an
// explicit peer ACK is not required before we may edit the placeholder.
const liveReplies = createLiveReplies({
  send: async ({ peerHex: chatId, text, editOf }) => {
    if (editOf != null) {
      const edited = await protocol.editText(chatId, editOf, text);
      return { messageId: edited.messageId, delivered: true };
    }
    const sent = await protocol.sendText(chatId, text, { threadRootId: replyThreadFor(chatId) });
    noteBotIssuedMessage(chatId, sent.messageId);
    return { messageId: sent.messageId, delivered: true };
  },
  awaitAck: async () => true,
  minIntervalMs: liveMinEditMs,
  maxIntervalMs: liveMaxEditMs,
  finalAckWaitMs: liveFinalAckWaitMs,
  log,
});
const thinkingTimers = new Map(); // chatId -> timeout
const livePlaceholders = new Map(); // chatId -> Promise<{handle, tracker, timer, ttl} | null>
// A framework can stream `edit_of` frames without labeling the final frame.
// Per-chat bridge leasing lets its eventual ACK safely promote this latest
// value into a terminal edit.
const bridgePendingEdits = new Map(); // chatId -> { messageId, text }
const disarmThinking = (chatId) => {
  const timer = thinkingTimers.get(chatId);
  if (timer != null) clearTimeout(timer);
  thinkingTimers.delete(chatId);
};
const takeLivePlaceholder = async (chatId) => {
  const pending = livePlaceholders.get(chatId);
  if (pending == null) return null;
  livePlaceholders.delete(chatId);
  const placeholder = await pending.catch(() => null);
  if (placeholder != null) {
    clearInterval(placeholder.timer);
    clearTimeout(placeholder.ttl);
  }
  return placeholder;
};
const peekLivePlaceholder = (chatId) => livePlaceholders.get(chatId) ?? null;
const bestEffortTyping = (chatId) => {
  void protocol.sendTyping(chatId).catch((error) => {
    log("T3AMS_TYPING_FAILED", { chatId, error: String(error?.message ?? error) });
  });
};
const armThinking = (chatId) => {
  if (!thinkingText || thinkingAfterMs <= 0 || thinkingTimers.has(chatId)) return;
  const timer = setTimeout(() => {
    thinkingTimers.delete(chatId);
    if (livePlaceholders.has(chatId)) return;
    livePlaceholders.set(chatId, (async () => {
      const handle = await liveReplies.begin(chatId, thinkingText);
      const tracker = createProgressTracker({ label: "working" });
      const heartbeat = setInterval(() => {
        bestEffortTyping(chatId);
        if (!handle.finalized) handle.update(tracker.render());
      }, liveHeartbeatMs);
      heartbeat.unref?.();
      const ttl = setTimeout(async () => {
        const placeholder = await takeLivePlaceholder(chatId);
        if (placeholder == null) return;
        log("T3AMS_LIVE_TTL_EXPIRED", { chatId, messageId: placeholder.handle.messageId });
        placeholder.handle.finalize(liveTimeoutText).catch((error) => {
          log("T3AMS_LIVE_FINALIZE_FAILED", { chatId, error: String(error?.message ?? error) });
        });
      }, liveTtlMs);
      ttl.unref?.();
      bestEffortTyping(chatId);
      log("T3AMS_LIVE_PLACEHOLDER", { chatId, messageId: handle.messageId });
      return { handle, tracker, timer: heartbeat, ttl };
    })().catch((error) => {
      log("T3AMS_THINKING_FAILED", { chatId, error: String(error?.message ?? error) });
      return null;
    }));
  }, thinkingAfterMs);
  timer.unref?.();
  thinkingTimers.set(chatId, timer);
};
const sendAgentReply = async (chatId, text) => {
  disarmThinking(chatId);
  const sent = await protocol.sendText(chatId, text, { threadRootId: replyThreadFor(chatId) });
  noteBotIssuedMessage(chatId, sent.messageId);
  return sent;
};
const deliverAgentReply = async (chatId, text) => {
  disarmThinking(chatId);
  const parts = splitMessageText(text, replyChunkBytes);
  if (parts.length > 1) log("T3AMS_REPLY_CHUNKED", { chatId, parts: parts.length, chars: text.length });
  const placeholder = await takeLivePlaceholder(chatId);
  let deliveredFirst = false;
  if (placeholder != null) {
    // Finalization is intentionally not best-effort: a final-answer delivery
    // failure is surfaced to the durable ingress journal for retry. Progress
    // edits and typing above remain non-fatal.
    await placeholder.handle.finalize(parts[0]);
    deliveredFirst = true;
  }
  for (const part of deliveredFirst ? parts.slice(1) : parts) await sendAgentReply(chatId, part);
};
const beginTurnProgress = (chatId) => {
  bestEffortTyping(chatId);
  armThinking(chatId);
  if (!liveProgress) return null;
  return (title) => {
    const pending = peekLivePlaceholder(chatId);
    pending?.then((placeholder) => {
      if (placeholder == null || placeholder.handle.finalized) return;
      placeholder.tracker.add(title);
      placeholder.handle.update(placeholder.tracker.render());
    }).catch(() => {});
  };
};

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
    attachments: event.attachments,
    attachmentError: event.attachmentError,
  }, { xid: selfXidHex, aliases: [username, displayName] });
  if (!routed.accepted || historyOnly) {
    // Unmentioned group traffic remains passive. If the operator enabled the
    // bounded local context buffer, retain only ordinary text from the live
    // primary statement (never carrier priors or attachment capabilities).
    if (!historyOnly && routed.reason === "unmentioned-channel-message"
        && event.conversation?.kind === "channel"
        && (!Array.isArray(event.attachments) || event.attachments.length === 0)
        && typeof event.text === "string" && event.text.trim() !== "") {
      const stored = channelContext.append(event.chatId, {
        messageId: event.messageId,
        senderXid: event.senderXid,
        senderName: event.senderName,
        text: event.text,
        threadRootId: event.threadRootId,
      });
      if (stored.accepted) log("T3AMS_CHANNEL_CONTEXT_APPENDED", { chatId: event.chatId, messageId: event.messageId });
    }
    await commitHistoryOnly(event);
    if (!historyOnly) {
      log("T3AMS_INBOUND_IGNORED", { reason: routed.reason, chatId: event.chatId });
    }
    return;
  }
  if (routed.message.conversationType === "channel") {
    const snapshot = channelContext.snapshot(routed.conversationKey, {
      threadRootId: routed.message.threadRootId,
    });
    if (snapshot.length > 0) routed.message.channelContext = snapshot;
  }
  // `/stop` must reach the direct runtime before this message waits behind a
  // same-chat model turn. Its own durable ingress entry later sends the user a
  // normal confirmation, preserving at-least-once acknowledgement semantics.
  const commandInput = typeof routed.message.commandText === "string"
    ? routed.message.commandText
    : routed.message.text;
  if (agentRuntime != null && /^\/stop\s*$/i.test(commandInput)) {
    const stopped = agentRuntime.stop(routed.conversationKey);
    log("T3AMS_STOP_REQUESTED", { chatId: routed.conversationKey, stopped });
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
  attachmentOptions,
  onStateChange: () => persist(),
  onTopologyChange: syncTopology,
  log,
});
let t3amsMedia;
try {
  t3amsMedia = createT3amsMedia({
    bcts,
    bulletinUrl: bulletinRpc,
    uploadSigner: wallet,
    dir: path.join(stateDir, "media"),
    attachmentOptions,
    ttlHours: t3amsMediaTtlHours,
    maxTotalMb: t3amsMediaMaxTotalMb,
    maxConcurrentDownloads: t3amsMediaConcurrentDownloads,
    maxInflightBytes: t3amsMediaMaxInflightBytes,
    downloadQueueCap: t3amsMediaDownloadQueueCap,
    timeoutMs: t3amsHopTimeoutMs,
    rpcFrameMaxBytes: t3amsHopRpcFrameMaxBytes,
    allowInsecure: t3amsHopAllowInsecure,
    log,
  });
  t3amsMedia.sweep();
} catch (error) {
  console.error(`T3ams media configuration is invalid: ${String(error?.message ?? error)}`);
  process.exit(2);
}
const mediaSweepTimer = setInterval(() => t3amsMedia.sweep(), 3_600_000);
mediaSweepTimer.unref?.();
// Durable files are deliberately distinct from the evictable media cache.
// They are scoped to a T3ams conversation, allowing a group to intentionally
// share a vault while preventing any cross-DM/channel lookup.
const fileMaxBytes = numberEnv("BOT_FILE_MAX_BYTES", attachmentMaxBytes, { min: 1, max: attachmentMaxBytes });
const fileMaxTotalMb = numberEnv(
  "BOT_FILE_MAX_TOTAL_MB",
  1024,
  { min: Math.ceil(fileMaxBytes / (1024 * 1024)), max: 32 * 1024 },
);
const fileMaxEntries = numberEnv("BOT_FILE_MAX_ENTRIES", 2000, { min: 1, max: 100_000 });
const fileMaxPeerMb = numberEnv(
  "BOT_FILE_MAX_PEER_MB",
  Math.max(Math.ceil(fileMaxBytes / (1024 * 1024)), Math.min(256, fileMaxTotalMb)),
  { min: Math.ceil(fileMaxBytes / (1024 * 1024)), max: fileMaxTotalMb },
);
const fileMaxPeerEntries = numberEnv("BOT_FILE_MAX_PEER_ENTRIES", Math.min(500, fileMaxEntries), { min: 1, max: fileMaxEntries });
const fileStore = createFileStore({
  dir: path.join(stateDir, "files"),
  maxFileBytes: fileMaxBytes,
  maxTotalMb: fileMaxTotalMb,
  maxEntries: fileMaxEntries,
  maxPeerMb: fileMaxPeerMb,
  maxPeerEntries: fileMaxPeerEntries,
  log,
});
fileCommandHandler = createFileCommandHandler({
  fileStore,
  sendAttachment: async (namespace, payload) => {
    const chatId = fileCommandChats.get(namespace);
    if (chatId == null) throw new Error("file command lost its T3ams conversation scope");
    return sendT3amsAttachment(chatId, payload);
  },
  log,
});
const bridgeFileMaxBytes = numberEnv("BOT_BRIDGE_FILE_MAX_BYTES", fileMaxBytes, { min: 1, max: fileMaxBytes });
const bridgeMediaRefCap = numberEnv(
  "BOT_T3AMS_BRIDGE_MEDIA_REF_CAP",
  Math.max(256, Math.min(100_000, ingressCap * Math.max(1, attachmentMaxCount))),
  { min: 16, max: 100_000 },
);
const bridgeMediaRefTtlMs = numberEnv("BOT_T3AMS_BRIDGE_MEDIA_REF_TTL_MS", 60 * 60_000, { min: 60_000, max: 24 * 3_600_000 });
const channelContextSetting = (env.BOT_T3AMS_CHANNEL_CONTEXT ?? "0").trim();
if (!new Set(["0", "1"]).has(channelContextSetting)) {
  console.error("BOT_T3AMS_CHANNEL_CONTEXT must be 0 or 1");
  process.exit(2);
}
// Passive group context is intentionally opt-in and memory-only.  Unmentioned
// channel traffic is never sent to a brain; it only becomes a small immutable
// snapshot when someone explicitly invokes the bot in that same channel.
const channelContext = createT3amsChannelContext({
  enabled: channelContextSetting === "1",
  ttlMs: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_TTL_MS", 30 * 60_000, { min: 0, max: 24 * 3_600_000 }),
  maxChats: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_CHATS", 128, { min: 1, max: 10_000 }),
  maxRecordsPerChat: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORDS", 16, { min: 1, max: 256 }),
  maxBytesPerChat: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_BYTES", 8 * 1024, { min: 256, max: 256 * 1024 }),
  maxRecordBytes: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORD_BYTES", 2 * 1024, { min: 128, max: 64 * 1024 }),
  maxRecordsPerSender: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORDS_PER_SENDER", 4, { min: 1, max: 64 }),
  maxBytesPerSender: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_BYTES_PER_SENDER", 2 * 1024, { min: 128, max: 128 * 1024 }),
  maxTotalBytes: numberEnv("BOT_T3AMS_CHANNEL_CONTEXT_MAX_TOTAL_BYTES", 256 * 1024, { min: 1024, max: 16 * 1024 * 1024 }),
  isValidChat: isT3amsConversationKey,
});
// A channel has one shared native model session. Let ordinary members invoke
// the bot, but do not let one member silently reset or reconfigure everyone
// else's session. `/stop` remains available to the group as a liveness lever.
const channelControlRole = (env.BOT_T3AMS_CHANNEL_CONTROL_ROLE ?? "admin").trim().toLowerCase();
if (!new Set(["all", "mod", "admin"]).has(channelControlRole)) {
  console.error("BOT_T3AMS_CHANNEL_CONTROL_ROLE must be all, mod, or admin");
  process.exit(2);
}
const stateChangingChannelCommand = (text) => /^\/(?:reset|model|reasoning|project)(?:\s|$)/i.test(text ?? "");
const canControlChannel = (message) => {
  if (message?.conversationType !== "channel" || channelControlRole === "all") return true;
  const role = protocol.workspaceRole(message.workspaceId, message.senderXid);
  return channelControlRole === "mod"
    ? role === "owner" || role === "admin" || role === "mod"
    : role === "owner" || role === "admin";
};
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
  const attachmentNotes = (message.attachments ?? []).map((attachment) => {
    const noun = attachment.kind === "image" ? "photo" : "document";
    const size = attachment.size >= 1024 * 1024
      ? `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(attachment.size / 1024))} KB`;
    return attachment.downloaded && attachment.path
      ? `[User attached a ${noun} saved at ${attachment.path} (${attachment.mime}, ${size})]`
      : `[User attached a ${noun} (${attachment.filename}; ${attachment.mime}, ${size}) — file bytes are unavailable: ${attachment.error ?? "download is not configured"}]`;
  });
  if (message.attachmentError) attachmentNotes.push(`[Attachment warning: ${message.attachmentError}]`);
  const contextNotes = (message.channelContext ?? []).map((record) => {
    const name = record.senderName || record.senderXid || "channel member";
    const thread = record.threadRootId ? `; thread ${record.threadRootId}` : "";
    return `[Earlier channel message from ${name}${thread}]: ${record.text}`;
  });
  // Channel sessions intentionally share memory. Include the authenticated
  // sender/scope so a direct brain can distinguish participants without
  // changing the transport-neutral message API.
  return [`[T3ams ${scope}; sender ${sender}${thread}]`, ...contextNotes, message.text, ...attachmentNotes].filter(Boolean).join("\n");
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
      deliver: deliverAgentReply,
      beginTurn: beginTurnProgress,
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
    kind: routed.message.kind,
    threadRootId: routed.message.threadRootId,
    conversationType: routed.message.conversationType,
    workspaceId: routed.message.workspaceId,
    channelId: routed.message.channelId,
    senderXid: routed.message.senderXid,
    senderName: routed.message.senderName,
    ...(Array.isArray(routed.message.attachments) ? { attachments: routed.message.attachments } : {}),
    ...(typeof routed.message.attachmentError === "string" ? { attachmentError: routed.message.attachmentError } : {}),
    ...(Array.isArray(routed.message.channelContext) ? { channelContext: routed.message.channelContext } : {}),
  };
  const hadPrevious = activeReplyThreads.has(routed.conversationKey);
  const previous = activeReplyThreads.get(routed.conversationKey);
  activeReplyThreads.set(routed.conversationKey, routed.replyTarget.threadRootId);
  try {
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      message.attachments = await fetchT3amsAttachments(message.attachments);
    }
    const fileResult = await handleT3amsFileCommand(routed.conversationKey, message);
    if (fileResult?.handled) {
      if (fileResult.reply) await sendAgentReply(routed.conversationKey, fileResult.reply);
      return;
    }
    if (brain === "echo") {
      await sendAgentReply(routed.conversationKey, `Echo: ${message.text}`);
      return;
    }
    if (agentRuntime == null) throw new Error("no direct T3ams agent runtime is configured");
    const commandInput = typeof message.commandText === "string" ? message.commandText : message.text;
    if (/^\/stop\s*$/i.test(commandInput)) {
      // The cancellation request was issued immediately when the authenticated
      // event arrived; this ordered, durable turn is just its confirmation.
      await sendAgentReply(routed.conversationKey, "⏹️ Stopped any active work for this chat.");
      return;
    }
    if (stateChangingChannelCommand(commandInput) && !canControlChannel(message)) {
      const label = channelControlRole === "mod" ? "a workspace moderator" : "a workspace owner or admin";
      await sendAgentReply(routed.conversationKey, `Only ${label} can change this channel bot's shared session settings.`);
      return;
    }
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
  // One framework turn per native chat at a time. Besides preserving ordered
  // model semantics, this prevents two workers from competing for one live
  // placeholder/thread-root map in a busy group channel.
  const occupiedChats = new Set(ingress
    .filter((entry) => entry.kind === "bridge" && Number(entry.leaseUntil) > current)
    .map((entry) => entry.routed.conversationKey));
  for (const entry of ingress) {
    if (leased.length >= limit) break;
    if (entry.kind !== "bridge" || Number(entry.leaseUntil) > current) continue;
    if (occupiedChats.has(entry.routed.conversationKey)) continue;
    entry.leaseId = randomUUID();
    entry.leaseUntil = current + leaseMs;
    leased.push(entry);
    occupiedChats.add(entry.routed.conversationKey);
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
  for (const entry of leased) {
    const chatId = entry.routed.conversationKey;
    bridgeReplyThreads.set(chatId, entry.routed.replyTarget.threadRootId ?? null);
    bestEffortTyping(chatId);
    armThinking(chatId);
  }
  return leased.map((entry) => ({
    ...bridgeInboundWithMedia(entry.routed),
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
    for (const entry of acknowledged) {
      const chatId = entry.routed.conversationKey;
      const stillLeased = ingress.some((candidate) => candidate.kind === "bridge"
        && candidate.routed.conversationKey === chatId
        && Number(candidate.leaseUntil) > Date.now());
      if (!stillLeased) {
        bridgeReplyThreads.delete(chatId);
        disarmThinking(chatId);
      }
    }
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
const finalizeBridgeEdits = async (claims) => {
  const chats = new Set();
  for (const claim of claims) {
    if (claim == null || typeof claim.delivery_id !== "string" || typeof claim.lease_id !== "string") continue;
    const entry = ingress.find((candidate) => candidate.kind === "bridge"
      && candidate.id === claim.delivery_id
      && candidate.leaseId === claim.lease_id);
    if (entry != null) chats.add(entry.routed.conversationKey);
  }
  for (const chatId of chats) {
    const edit = bridgePendingEdits.get(chatId);
    if (edit == null) continue;
    const placeholder = await takeLivePlaceholder(chatId);
    if (placeholder != null && bareHex(placeholder.handle.messageId) !== bareHex(edit.messageId)) {
      // The framework chose to stream an earlier bot message rather than the
      // current placeholder. Retire the placeholder so it never dangles.
      await placeholder.handle.finalize("✓");
    }
    await liveReplies.finalizeExisting(chatId, edit.messageId, edit.text);
    bridgePendingEdits.delete(chatId);
  }
};
// A bridge must never receive the encrypted HOP ticket. Give each capability
// a process-local opaque media ID instead; the ID binds every authenticated
// reference field, so a hostile reuse of a HOP metadata ID cannot poison a
// cached or later bridge download.
const bridgeMediaRefs = new Map(); // opaque media ID -> { attachment, expiresAt }
const bridgeMediaIdFor = (attachment) => createHash("sha256")
  .update("pca:t3ams-bridge-media-v1\0")
  .update(attachment.hopId)
  .update("\0")
  .update(attachment.claimTicketHex)
  .update("\0")
  .update(attachment.contentHashHex)
  .update("\0")
  .update(String(attachment.size))
  .digest("hex");
const pruneBridgeMediaRefs = () => {
  const current = Date.now();
  for (const [id, entry] of bridgeMediaRefs) {
    if (entry.expiresAt <= current) bridgeMediaRefs.delete(id);
  }
  while (bridgeMediaRefs.size > bridgeMediaRefCap) bridgeMediaRefs.delete(bridgeMediaRefs.keys().next().value);
};
const registerBridgeMediaRef = (attachment) => {
  pruneBridgeMediaRefs();
  const id = bridgeMediaIdFor(attachment);
  bridgeMediaRefs.delete(id);
  bridgeMediaRefs.set(id, { attachment: { ...attachment }, expiresAt: Date.now() + bridgeMediaRefTtlMs });
  pruneBridgeMediaRefs();
  return id;
};
const bridgeMediaRef = (id) => {
  if (!/^[0-9a-f]{64}$/i.test(String(id ?? ""))) return null;
  pruneBridgeMediaRefs();
  const entry = bridgeMediaRefs.get(String(id).toLowerCase());
  if (entry == null) return null;
  // LRU-like renewal helps a bridge fetch a few files from one long-running
  // leased turn without making media capabilities permanent.
  bridgeMediaRefs.delete(String(id).toLowerCase());
  entry.expiresAt = Date.now() + bridgeMediaRefTtlMs;
  bridgeMediaRefs.set(String(id).toLowerCase(), entry);
  return { ...entry.attachment };
};
const bridgeInboundWithMedia = (routed) => {
  const inbound = toT3amsBridgeInbound(routed);
  const source = routed?.message?.attachments ?? [];
  if (!inbound?.attachments?.length) return inbound;
  inbound.attachments = inbound.attachments.map((attachment, index) => {
    const raw = source[index];
    if (raw == null || !t3amsMedia.enabled) return { ...attachment, downloaded: false };
    const mediaId = registerBridgeMediaRef(raw);
    const cached = t3amsMedia.findCached(raw) != null;
    return {
      ...attachment,
      media_id: mediaId,
      downloaded: cached,
      url: `/media/${mediaId}`,
    };
  });
  // Start the same bounded/single-flight download that GET /media will use.
  // This does not block the lease or change its durable attachment metadata.
  if (t3amsMedia.enabled) {
    void fetchT3amsAttachments(source).catch((error) => {
      log("T3AMS_BRIDGE_MEDIA_PREWARM_FAILED", { error: String(error?.message ?? error) });
    });
  }
  return inbound;
};
const bridgeFileRoute = (pathname) => {
  if (!pathname.startsWith("/files/")) return null;
  const tail = pathname.slice("/files/".length);
  const separator = tail.indexOf("/");
  const encodedChat = separator < 0 ? tail : tail.slice(0, separator);
  const encodedPath = separator < 0 ? null : tail.slice(separator + 1);
  if (!encodedChat) return { invalid: true };
  try {
    const chatId = decodeURIComponent(encodedChat);
    if (!isT3amsConversationKey(chatId)) return { invalid: true };
    return {
      chatId,
      namespace: fileNamespaceForChat(chatId),
      filePath: encodedPath == null ? null : decodeURIComponent(encodedPath),
    };
  } catch {
    return { invalid: true };
  }
};
const fileBridgeStatus = (error) => {
  const code = error?.code;
  return code === "FILE_STORE_EXISTS" ? 409
    : code === "FILE_STORE_FILE_TOO_LARGE" ? 413
      : code === "FILE_STORE_FULL" || code === "FILE_STORE_ENTRY_LIMIT" || code === "FILE_STORE_PEER_FULL" || code === "FILE_STORE_PEER_ENTRY_LIMIT" ? 507
        : 400;
};
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
      return json(response, 200, {
        ok: isChainConnected(), transport: "t3ams", account: material.accountIdHex, identifierKey: null,
        xid: selfXidHex, username, subscriptions: subscriptions.size,
        bridge: { queued: bridgeQueued() },
        media: {
          enabled: t3amsMedia.enabled,
          cached: t3amsMedia.stats(),
          bulletin: t3amsMedia.enabled ? new URL(t3amsMedia.bulletinUrl).hostname : null,
          allowance: "operator-provisioned",
        },
        files: { ...fileStore.stats(), maxBridgeUploadBytes: bridgeFileMaxBytes },
        channel_context: channelContext.stats(),
        live: { supportsEdit: true, supportsTyping: true, supportsReaction: true, minEditMs: liveMinEditMs, placeholderAfterMs: thinkingAfterMs },
      });
    }
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const attachment = bridgeMediaRef(url.pathname.slice("/media/".length));
      if (attachment == null) return json(response, 404, { success: false, error: "not found" });
      if (!t3amsMedia.enabled) return json(response, 503, { success: false, error: "T3ams media retrieval is disabled" });
      let filePath = t3amsMedia.findCached(attachment);
      try {
        if (filePath == null) filePath = await t3amsMedia.download(attachment);
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile() || stat.size !== attachment.size) throw new Error("cached attachment is invalid");
        response.writeHead(200, {
          "content-type": attachment.mime,
          "content-length": stat.size,
          "cache-control": "private, max-age=300",
        });
        fs.createReadStream(filePath).pipe(response);
        return;
      } catch (error) {
        log("T3AMS_BRIDGE_MEDIA_FAILED", { id: attachment.id.slice(0, 16), error: String(error?.message ?? error) });
        return json(response, 502, { success: false, error: "attachment download failed" });
      }
    }
    const fileRoute = bridgeFileRoute(url.pathname);
    if (fileRoute != null) {
      if (fileRoute.invalid) return json(response, 400, { success: false, error: "invalid file route" });
      try {
        if (request.method === "GET" && fileRoute.filePath == null) {
          const prefix = url.searchParams.get("prefix") ?? "";
          const files = fileStore.list(fileRoute.namespace, prefix).map(({ peer, ...file }) => file);
          return json(response, 200, { success: true, files });
        }
        if (request.method === "GET") {
          if (!fileRoute.filePath) return json(response, 400, { success: false, error: "file path required" });
          const file = fileStore.get(fileRoute.namespace, fileRoute.filePath);
          if (file == null) return json(response, 404, { success: false, error: "not found" });
          response.writeHead(200, { "content-type": file.mime, "content-length": file.size, "cache-control": "private, no-store" });
          fs.createReadStream(file.filePath).pipe(response);
          return;
        }
        if (request.method === "PUT") {
          if (!fileRoute.filePath) return json(response, 400, { success: false, error: "file path required" });
          const rawMime = Array.isArray(request.headers["content-type"])
            ? request.headers["content-type"][0]
            : request.headers["content-type"];
          const mime = String(rawMime ?? "application/octet-stream").split(";", 1)[0].trim();
          const bytes = await readBody(request, bridgeFileMaxBytes);
          const saved = fileStore.putBytes(fileRoute.namespace, fileRoute.filePath, bytes, {
            mime,
            overwrite: url.searchParams.get("overwrite") === "1",
          });
          return json(response, 201, { success: true, path: saved.path, mime: saved.mime, size: saved.size });
        }
        if (request.method === "DELETE") {
          if (!fileRoute.filePath) return json(response, 400, { success: false, error: "file path required" });
          if (!fileStore.remove(fileRoute.namespace, fileRoute.filePath)) return json(response, 404, { success: false, error: "not found" });
          return json(response, 200, { success: true });
        }
        return json(response, 405, { success: false, error: "method not allowed" });
      } catch (error) {
        return json(response, fileBridgeStatus(error), { success: false, error: String(error?.message ?? error).slice(0, 300) });
      }
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
      if (url.pathname.endsWith("/ack")) {
        // A streaming framework's ACK means its turn has completed. Flush the
        // latest coalesced edit before removing the durable lease, otherwise
        // a throttled progress timer could be the visible terminal state.
        await finalizeBridgeEdits(claims);
      }
      const result = await updateBridgeLeases(claims, url.pathname.endsWith("/ack"));
      if (!result.durable) return json(response, 503, { success: false, error: "state persistence pending; retry the claim" });
      return json(response, 200, { success: true, [url.pathname.endsWith("/ack") ? "acknowledged" : "renewed"]: result.changed });
    }
    if (request.method === "POST" && url.pathname === "/send") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const chatId = typeof body.chat_id === "string" ? body.chat_id : "";
      const text = typeof body.text === "string" ? body.text : "";
      const hasText = text.length > 0;
      const filePath = body.file_path == null ? null : body.file_path;
      if (!chatId || (!hasText && filePath == null)) return json(response, 400, { success: false, error: "chat_id and text or file_path are required" });
      if (!isT3amsConversationKey(chatId)) return json(response, 400, { success: false, error: "invalid chat_id" });
      if (Buffer.byteLength(text, "utf8") > MAX_T3AMS_TEXT_BYTES) return json(response, 413, { success: false, error: "text too large" });
      if (filePath != null && (typeof filePath !== "string" || !filePath)) {
        return json(response, 400, { success: false, error: "file_path must be a saved file path" });
      }
      if (body.thread_root_id != null && typeof body.thread_root_id !== "string") {
        return json(response, 400, { success: false, error: "thread_root_id must be a string" });
      }
      const editOf = body.edit_of == null ? null : bareHex(body.edit_of);
      if (editOf != null && !/^[0-9a-f]{64}$/.test(editOf)) {
        return json(response, 400, { success: false, error: "edit_of must be a 32-byte hexadecimal message ID" });
      }
      const replyTo = typeof body.reply_to === "string"
        ? body.reply_to
        : typeof body.reply_to_message_id === "string"
          ? body.reply_to_message_id
          : null;
      if (replyTo != null && editOf != null) return json(response, 400, { success: false, error: "reply_to and edit_of are mutually exclusive" });
      const replyToId = replyTo == null ? null : bareHex(replyTo);
      if (replyToId != null && !/^[0-9a-f]{64}$/.test(replyToId)) {
        return json(response, 400, { success: false, error: "reply_to must be a 32-byte hexadecimal message ID" });
      }
      if (editOf != null) {
        if (!hasText || filePath != null) return json(response, 400, { success: false, error: "edits require text and cannot include a file" });
        if (!isBotIssuedMessage(chatId, editOf)) {
          return json(response, 409, { success: false, error: "edit_of must name a message issued by this bot process" });
        }
        disarmThinking(chatId);
        bridgePendingEdits.set(chatId, { messageId: editOf, text });
        liveReplies.throttledEdit(chatId, editOf, text);
        return json(response, 200, { success: true, message_id: editOf, coalesced: true });
      }
      const root = body.thread_root_id == null
        ? protocol.replyThreadFor(chatId, replyToId)
        : bareHex(body.thread_root_id);
      if (root != null && !/^[0-9a-f]{64}$/.test(root)) return json(response, 400, { success: false, error: "thread_root_id must be a 32-byte hexadecimal message ID" });
      disarmThinking(chatId);
      bridgePendingEdits.delete(chatId);
      if (filePath != null) {
        let file;
        try { file = fileStore.get(fileNamespaceForChat(chatId), filePath); }
        catch (error) { return json(response, fileBridgeStatus(error), { success: false, error: String(error?.message ?? error).slice(0, 300) }); }
        if (file == null) return json(response, 404, { success: false, error: "file not found" });
        const placeholder = await takeLivePlaceholder(chatId);
        if (placeholder != null) {
          // Attachments cannot be added by an edit, so keep the live message
          // as a clear delivery status while the actual rich-file message is
          // submitted below. `reply_to` must not turn it into an unexplained
          // checkmark bubble.
          await placeholder.handle.finalize("📎 Sending file…");
        }
        try {
          const sent = await sendT3amsAttachment(chatId, {
            filePath: file.filePath,
            mime: file.mime,
            size: file.size,
            text: hasText ? text : file.path,
            threadRootId: root,
          });
          return json(response, 200, { success: true, message_id: sent.messageId, attachment: {
            id: sent.attachment.id,
            mime: sent.attachment.mime,
            size: sent.attachment.size,
            filename: sent.attachment.filename,
          } });
        } catch (error) {
          log("T3AMS_BRIDGE_FILE_SEND_FAILED", { chatId, path: file.path, error: String(error?.message ?? error) });
          return json(response, 502, { success: false, error: "file delivery failed" });
        }
      }
      const parts = splitMessageText(text, replyChunkBytes);
      if (parts.length > 1) log("T3AMS_REPLY_CHUNKED", { chatId, parts: parts.length, chars: text.length });
      let firstId = null;
      const placeholder = await takeLivePlaceholder(chatId);
      if (placeholder != null) {
        // A bridge lease records the triggering thread before the harness
        // begins work, so the placeholder is already in the correct T3ams
        // reply/thread. `reply_to` is normally supplied by both shipped
        // adapters and must not force a redundant \"✓\" plus a second bubble.
        firstId = (await placeholder.handle.finalize(parts[0])).messageId;
        noteBotIssuedMessage(chatId, firstId);
      }
      for (const [index, part] of parts.entries()) {
        if (index === 0 && firstId != null) continue;
        const sent = await protocol.sendText(chatId, part, { threadRootId: root });
        noteBotIssuedMessage(chatId, sent.messageId);
        if (index === 0) firstId = sent.messageId;
      }
      return json(response, 200, { success: true, message_id: firstId, ...(parts.length > 1 ? { parts: parts.length } : {}) });
    }
    if (request.method === "POST" && url.pathname === "/react") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const chatId = typeof body.chat_id === "string" ? body.chat_id : "";
      const messageId = typeof body.message_id === "string" ? body.message_id : "";
      const emoji = typeof body.emoji === "string" ? body.emoji : "";
      if (!isT3amsConversationKey(chatId) || !messageId || !emoji) {
        return json(response, 400, { success: false, error: "chat_id, message_id and emoji are required" });
      }
      await protocol.sendReaction(chatId, messageId, emoji, { removed: body.remove === true });
      return json(response, 200, { success: true });
    }
    if (request.method === "POST" && url.pathname === "/typing") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const chatId = typeof body.chat_id === "string" ? body.chat_id : "";
      if (!isT3amsConversationKey(chatId)) return json(response, 400, { success: false, error: "invalid chat_id" });
      try { await protocol.sendTyping(chatId); }
      catch (error) { log("T3AMS_BRIDGE_TYPING_FAILED", { chatId, error: String(error?.message ?? error) }); }
      return json(response, 200, { success: true });
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
  clearInterval(mediaSweepTimer);
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
