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
import { createDeferredProgressTracker, createLiveReplies } from "./lib/live-reply.mjs";
import { createWorkspaces } from "./lib/workspaces.mjs";
import { createKeyedDispatcher } from "./lib/keyed-dispatcher.mjs";
import { createFileStore } from "./lib/file-store.mjs";
import { createFileCommandHandler } from "./lib/file-commands.mjs";
import { RUNNERS, resolveEngine } from "./lib/runners.mjs";
import { deriveT3amsIdentity } from "./lib/t3ams-identity.mjs";
import { createT3amsProtocol, hexToBytes, bareHex } from "./lib/t3ams-protocol.mjs";
import { createT3amsMedia } from "./lib/t3ams-media.mjs";
import { createT3amsMediaAnalyzer, mediaAnalyzerKind, renderUntrustedAttachmentAnalysis } from "./lib/t3ams-media-analyzer.mjs";
import { createT3amsMediaAnalysisBudget } from "./lib/t3ams-media-budget.mjs";
import {
  DEFAULT_T3AMS_ATTACHMENT_MIME_TYPES,
  isT3amsAttachmentMimeAllowed,
  normalizeT3amsAttachmentRefs,
} from "./lib/t3ams-attachments.mjs";
import { createT3amsChannelContext } from "./lib/t3ams-channel-context.mjs";
import { createT3amsMessageLifecycle } from "./lib/t3ams-message-lifecycle.mjs";
import { t3amsDirectCapacityDefaults } from "./lib/t3ams-direct-capacity.mjs";
import {
  MAX_T3AMS_TEXT_BYTES,
  normalizeT3amsInbound,
  restoreT3amsIngressRoute,
  toT3amsBridgeInbound,
} from "./lib/t3ams-routing.mjs";
import { createSerializedSubmitter, createT3amsPriorityClock } from "./lib/t3ams-submission.mjs";
import { createT3amsKnownChats } from "./lib/t3ams-known-chats.mjs";
import { deliverAgentReplyBeforeArtifacts } from "./lib/t3ams-agent-turn.mjs";
import {
  agentSessionKeyForT3ams,
  bridgeReplyThreadRootForT3ams,
  conversationForAgentSessionKey,
  ingressLaneKeyForT3ams,
  isT3amsConversationKey,
} from "./lib/t3ams-agent-session.mjs";
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
// Generated direct-agent files are copied here before any network upload.
// This is deliberately inside the transport's private state directory rather
// than the agent-writable PCA_OUTPUT_DIR, so a retried handoff has immutable
// bytes even after the child process and its staging directory have gone.
const agentArtifactOutboxRoot = path.join(stateDir, "agent-outbox");
try {
  fs.mkdirSync(agentArtifactOutboxRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(agentArtifactOutboxRoot, 0o700);
  const stat = fs.lstatSync(agentArtifactOutboxRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("not a private directory");
} catch (error) {
  console.error(`BOT_STATE_DIR cannot hold a private generated-artifact outbox: ${String(error?.message ?? error)}`);
  process.exit(2);
}

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
// A framework normally earns the right to publish by holding a leased inbound
// delivery. Some framework facilities (for example OpenClaw attached results
// from a scheduled task) have no inbound delivery to bind. Keep that
// exceptional outbound authority separate from the all-purpose bridge token,
// optional, and deliberately scoped to /send, /react, and /typing below.
const bridgeProactiveToken = (env.BOT_BRIDGE_PROACTIVE_TOKEN ?? "").trim();
if (bridgeProactiveToken && bridgeProactiveToken.length < 32) {
  console.error("BOT_BRIDGE_PROACTIVE_TOKEN must be empty or a 32+ character random secret");
  process.exit(2);
}
if (bridgeProactiveToken && bridgeProactiveToken === bridgeToken) {
  console.error("BOT_BRIDGE_PROACTIVE_TOKEN must differ from BOT_BRIDGE_TOKEN");
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
// The SPA expires a typing indicator after six seconds. Refresh a little
// sooner (the protocol itself rate-limits to four seconds) so a slow turn
// never flickers between "typing" and silence.
const liveHeartbeatMs = numberEnv("BOT_LIVE_HEARTBEAT_MS", 5_000, { min: 100, max: 86_400_000 });
const liveFinalAckWaitMs = numberEnv("BOT_LIVE_FINAL_ACK_WAIT_MS", 10_000, { min: 100, max: 86_400_000 });
const liveProgress = env.BOT_LIVE_PROGRESS !== "0";
const liveTtlMs = numberEnv("BOT_LIVE_TTL_MS", 600_000, { min: 1000, max: 7 * 86_400_000 });
const liveTimeoutText = env.BOT_LIVE_TIMEOUT_TEXT
  ?? "⚠️ I lost track of this one — something went wrong on my end. Please send it again.";
const configuredReplyChunkBytes = numberEnv("BOT_REPLY_CHUNK_BYTES", 4_000, { min: 128, max: MAX_T3AMS_TEXT_BYTES });
// splitMessageText has a 256-byte UTF-8 safety floor. Normalize the transport
// setting to that same effective value so a valid 128–255 configuration never
// stages chunks that its own durable validator later rejects.
const replyChunkBytes = Math.max(256, configuredReplyChunkBytes);
// Live drafts are transient edits, not the durable final reply. Keep them
// deliberately smaller than one normal reply chunk so a long stream cannot
// make an edit invalid or cause unbounded presentation memory.
const liveDraftMaxBytes = numberEnv(
  "BOT_LIVE_DRAFT_MAX_BYTES",
  Math.min(8 * 1024, Math.max(256, replyChunkBytes - 128)),
  { min: 256, max: Math.max(256, MAX_T3AMS_TEXT_BYTES - 128) },
);
const truncateUtf8 = (value, maxBytes) => {
  const text = String(value ?? "");
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const suffix = "…";
  const limit = Math.max(0, maxBytes - Buffer.byteLength(suffix));
  let used = 0;
  let out = "";
  // `for…of` yields full Unicode code points, so a truncation cannot split a
  // surrogate pair or UTF-8 sequence inside an editable rich-text frame.
  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (used + bytes > limit) break;
    out += char;
    used += bytes;
  }
  return `${out}${suffix}`;
};
// Keep the durable final-turn journal bounded by the same response cap the
// runner enforces. A small allowance covers the persisted one-time help hint.
const aiMaxOutputBytes = numberEnv("BOT_AI_MAX_OUTPUT_BYTES", 1_000_000, { min: 1024, max: 64 * 1024 * 1024 });
const agentReplyOutboxMaxBytes = Math.min(64 * 1024 * 1024 + 8 * 1024, aiMaxOutputBytes + 8 * 1024);
const agentReplyOutboxMaxParts = Math.ceil(agentReplyOutboxMaxBytes / 256);

// T3ams puts a small encrypted HOP capability inside each BCTS attachment
// reference.  Keep the accepted surface explicit: bot-core treats the bytes
// as inert files and never executes them, while an operator may narrow the
// MIME list for a public deployment.  These caps are shared by protocol
// decoding, the private media cache, and outbound file delivery.
const attachmentMaxBytes = numberEnv("BOT_T3AMS_ATTACHMENT_MAX_BYTES", 25 * 1024 * 1024, { min: 1, max: 25 * 1024 * 1024 });
const attachmentMaxCount = numberEnv("BOT_T3AMS_ATTACHMENT_MAX_COUNT", 8, { min: 0, max: 16 });
const attachmentMaxDurationMs = numberEnv(
  "BOT_T3AMS_ATTACHMENT_MAX_DURATION_MS",
  7 * 24 * 60 * 60 * 1000,
  { min: 0, max: 31 * 24 * 60 * 60 * 1000 },
);
const attachmentMimeRaw = env.BOT_T3AMS_ATTACHMENT_MIME_TYPES;
const attachmentMimeTypes = attachmentMimeRaw == null || attachmentMimeRaw.trim() === ""
  ? [...DEFAULT_T3AMS_ATTACHMENT_MIME_TYPES]
  : attachmentMimeRaw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const attachmentMimePattern = /^(?:\*\/\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}))$/;
if (attachmentMimeTypes.length === 0 || attachmentMimeTypes.some((mime) => !attachmentMimePattern.test(mime))) {
  console.error("BOT_T3AMS_ATTACHMENT_MIME_TYPES must be comma-separated exact MIME types, type/* patterns, or */*");
  process.exit(2);
}
const attachmentOptions = {
  maxBytes: attachmentMaxBytes,
  maxCount: attachmentMaxCount,
  maxDurationMs: attachmentMaxDurationMs,
  allowedMimeTypes: [...new Set(attachmentMimeTypes)],
};
// Direct Claude/Codex/OpenCode sessions may hand back files by writing them
// to their per-turn PCA_OUTPUT_DIR. Keep this independently configurable so a
// public bot can accept inbound media while declining generated artifacts.
const agentOutputArtifactMaxCount = numberEnv(
  "BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS",
  attachmentMaxCount,
  { min: 0, max: 16 },
);
const agentOutputArtifactMaxTotalBytes = numberEnv(
  "BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES",
  Math.max(
    attachmentMaxBytes,
    Math.min(64 * 1024 * 1024, attachmentMaxBytes * Math.max(1, agentOutputArtifactMaxCount)),
  ),
  { min: 1, max: 512 * 1024 * 1024 },
);
// A per-turn artifact cap alone is not enough: many retained ingress rows
// can otherwise fill BOT_STATE_DIR after an outage. These limits apply only
// to immutable, not-yet-delivered generated files; the regular media/file
// stores keep their own independent quotas.
const agentArtifactOutboxMaxEntries = numberEnv(
  "BOT_T3AMS_AGENT_OUTBOX_MAX_ENTRIES",
  Math.min(1_024, Math.max(16, 128 * Math.max(1, agentOutputArtifactMaxCount))),
  { min: 1, max: 100_000 },
);
const agentArtifactOutboxMaxBytes = numberEnv(
  "BOT_T3AMS_AGENT_OUTBOX_MAX_BYTES",
  Math.max(agentOutputArtifactMaxTotalBytes, Math.min(512 * 1024 * 1024, agentOutputArtifactMaxTotalBytes * 8)),
  { min: agentOutputArtifactMaxTotalBytes, max: 4 * 1024 * 1024 * 1024 },
);
const agentReplyOutboxMaxEntries = numberEnv(
  "BOT_T3AMS_REPLY_OUTBOX_MAX_ENTRIES",
  128,
  { min: 1, max: 100_000 },
);
const agentReplyOutboxMaxTotalBytes = numberEnv(
  "BOT_T3AMS_REPLY_OUTBOX_MAX_BYTES",
  Math.max(agentReplyOutboxMaxBytes, Math.min(128 * 1024 * 1024, agentReplyOutboxMaxBytes * 32)),
  { min: agentReplyOutboxMaxBytes, max: 4 * 1024 * 1024 * 1024 },
);
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
// Semantic attachment understanding is deliberately opt-in. The regular bot
// process only receives a worker URL/token; an isolated companion container
// owns the provider key and never mounts transport state or the Claude OAuth
// home. Leaving both variables empty retains metadata-only attachment behavior.
const t3amsMediaAnalyzerUrl = (env.BOT_T3AMS_MEDIA_ANALYZER_URL ?? "").trim();
const t3amsMediaAnalyzerToken = (env.BOT_T3AMS_MEDIA_ANALYZER_TOKEN ?? "").trim();
const t3amsMediaAnalyzerHttpHosts = (env.BOT_T3AMS_MEDIA_ANALYZER_HTTP_HOSTS ?? "media-analyzer")
  .split(",").map((value) => value.trim()).filter(Boolean);
const t3amsMediaAnalyzerMaxFiles = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_FILES", 4, { min: 1, max: 8 });
const t3amsMediaAnalyzerMaxFileBytes = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_FILE_BYTES", 7 * 1024 * 1024, { min: 1, max: 12 * 1024 * 1024 });
const t3amsMediaAnalyzerMaxTotalBytes = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_TOTAL_BYTES", 12 * 1024 * 1024, { min: 1, max: 16 * 1024 * 1024 });
const t3amsMediaAnalyzerTimeoutMs = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_TIMEOUT_MS", 90_000, { min: 1_000, max: 10 * 60_000 });
const t3amsMediaAnalyzerMaxPromptBytes = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_PROMPT_BYTES", 12 * 1024, { min: 256, max: 64 * 1024 });
const t3amsMediaAnalyzerMaxSummaryBytes = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_SUMMARY_BYTES", 6 * 1024, { min: 256, max: 16 * 1024 });
const t3amsMediaAnalyzerMaxConcurrent = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_CONCURRENT", 1, { min: 1, max: 8 });
const t3amsMediaAnalyzerMaxQueued = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_MAX_QUEUED", 20, { min: 0, max: 1_000 });
// External analysis is billable work. Keep a durable sender/global budget in
// addition to the in-process queue so a public sender cannot sustain provider
// calls by spacing uploads over time or forcing process restarts.
const t3amsMediaAnalyzerSenderCapacity = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_SENDER_CAP", 4, { min: 1, max: 10_000 });
const t3amsMediaAnalyzerSenderWindowMs = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_SENDER_WINDOW_MS", 60 * 60_000, { min: 1_000, max: 31 * 24 * 60 * 60_000 });
const t3amsMediaAnalyzerGlobalCapacity = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_GLOBAL_CAP", 30, { min: 1, max: 100_000 });
const t3amsMediaAnalyzerGlobalWindowMs = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_GLOBAL_WINDOW_MS", 60 * 60_000, { min: 1_000, max: 31 * 24 * 60 * 60_000 });
const t3amsMediaAnalyzerSenderBucketCap = numberEnv("BOT_T3AMS_MEDIA_ANALYZER_SENDER_BUCKET_CAP", 1_000, { min: 1, max: 100_000 });

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
let messageLifecycle = null;
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
const knownChats = createT3amsKnownChats({
  cap: knownChatCap,
  isProtected: (chatId) => ingress.some((entry) => entry.routed.conversationKey === chatId),
  isValid: isT3amsConversationKey,
});
const mediaAnalysisBudget = createT3amsMediaAnalysisBudget({
  senderCapacity: t3amsMediaAnalyzerSenderCapacity,
  senderWindowMs: t3amsMediaAnalyzerSenderWindowMs,
  globalCapacity: t3amsMediaAnalyzerGlobalCapacity,
  globalWindowMs: t3amsMediaAnalyzerGlobalWindowMs,
  senderCap: t3amsMediaAnalyzerSenderBucketCap,
  initial: restored?.mediaAnalysisBudget ?? null,
});
const deadLetters = [];
// A deleted queued turn is removed before its next model dispatch. If the
// durable journal write is temporarily unavailable, keep its route pinned
// until the retry succeeds rather than evicting reply metadata too early.
const deferredIngressUnpins = [];
// Outbox directories are only removed after the matching journal mutation is
// durable. That way a power loss cannot leave state claiming a retryable
// artifact while this process has already discarded its immutable bytes.
const deferredAgentArtifactOutboxCleanup = [];
const ARTIFACT_OUTBOX_STORED_NAME_RE = /^artifact-[0-9]{1,2}-[a-f0-9]{16}$/;
const ARTIFACT_FILENAME_CONTROL_RE = /[\u0000-\u001f\u007f\\/]/;
const ARTIFACT_MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const fsyncDirectory = (directory) => {
  // Some platforms/filesystems do not permit syncing a directory. The data
  // file itself is always fsynced; this is the best available extra barrier
  // before a manifest starts referring to a newly-created dirent.
  try {
    const fd = fs.openSync(directory, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* unavailable on this filesystem */ }
};
const artifactOutboxDirectory = (id) => {
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(id)) return null;
  return path.join(agentArtifactOutboxRoot, id);
};
const validAgentArtifactFilename = (value) => typeof value === "string"
  && value === value.trim()
  && value !== "."
  && value !== ".."
  && Buffer.byteLength(value, "utf8") > 0
  && Buffer.byteLength(value, "utf8") <= 255
  && !ARTIFACT_FILENAME_CONTROL_RE.test(value);
const serializeUploadedAttachmentRef = (ref) => {
  if (ref == null || !(ref.id instanceof Uint8Array) || !(ref.hash instanceof Uint8Array)
      || typeof ref.storageUrl !== "string" || typeof ref.mimeType !== "string"
      || !Number.isSafeInteger(ref.fileSize) || typeof ref.filename !== "string") return null;
  return {
    id: Buffer.from(ref.id).toString("hex"),
    hash: Buffer.from(ref.hash).toString("hex"),
    storageUrl: ref.storageUrl,
    mimeType: ref.mimeType,
    fileSize: ref.fileSize,
    filename: ref.filename,
    ...(Number.isSafeInteger(ref.width) ? { width: ref.width } : {}),
    ...(Number.isSafeInteger(ref.height) ? { height: ref.height } : {}),
    ...(Number.isSafeInteger(ref.durationMs) ? { durationMs: ref.durationMs } : {}),
  };
};
const restoreUploadedAttachmentRef = (raw, file) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)
      || typeof raw.id !== "string" || !/^[0-9a-f]{64}$/i.test(raw.id)
      || typeof raw.hash !== "string" || !/^[0-9a-f]{64}$/i.test(raw.hash)
      || typeof raw.storageUrl !== "string" || typeof raw.mimeType !== "string"
      || !Number.isSafeInteger(raw.fileSize) || typeof raw.filename !== "string") return null;
  const ref = {
    id: hexToBytes(raw.id),
    hash: hexToBytes(raw.hash),
    storageUrl: raw.storageUrl,
    mimeType: raw.mimeType,
    fileSize: raw.fileSize,
    filename: raw.filename,
    ...(raw.width == null ? {} : { width: raw.width }),
    ...(raw.height == null ? {} : { height: raw.height }),
    ...(raw.durationMs == null ? {} : { durationMs: raw.durationMs }),
  };
  try {
    const [attachment] = normalizeT3amsAttachmentRefs([ref], attachmentOptions);
    if (attachment.filename !== file.filename || attachment.mime !== file.mime || attachment.size !== file.size) return null;
    return { ref, attachment };
  } catch {
    return null;
  }
};
const restoreAgentArtifactOutbox = (raw, revision) => {
  if (raw == null) return { outbox: null, invalid: false };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)
      || !Number.isSafeInteger(raw.revision) || raw.revision !== revision
      || !Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > 16) {
    return { outbox: null, invalid: true };
  }
  const files = [];
  const storedNames = new Set();
  let totalBytes = 0;
  for (const item of raw.files) {
    const filename = item?.filename;
    const storedName = item?.storedName;
    const size = Number(item?.size);
    const mime = typeof item?.mime === "string" ? item.mime.toLowerCase() : "";
    const sent = item?.sent === true;
    const messageId = item?.messageId == null ? null : bareHex(item.messageId);
    if (!validAgentArtifactFilename(filename) || !ARTIFACT_OUTBOX_STORED_NAME_RE.test(storedName)
        || storedNames.has(storedName) || !Number.isSafeInteger(size) || size < 0 || size > attachmentMaxBytes
        || !ARTIFACT_MIME_RE.test(mime) || (messageId != null && !/^[0-9a-f]{64}$/.test(messageId))) {
      return { outbox: null, invalid: true };
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > agentOutputArtifactMaxTotalBytes) {
      return { outbox: null, invalid: true };
    }
    const file = { filename, storedName, size, mime, sent, ...(messageId == null ? {} : { messageId }) };
    const uploaded = item?.uploaded == null ? null : restoreUploadedAttachmentRef(item.uploaded, file);
    if (item?.uploaded != null && uploaded == null) return { outbox: null, invalid: true };
    storedNames.add(storedName);
    files.push({ ...file, ...(uploaded == null ? {} : { uploaded }) });
  }
  return { outbox: { revision, files }, invalid: false };
};
const restoreAgentReplyOutbox = (raw, revision) => {
  if (raw == null) return { outbox: null, invalid: false };
  if (typeof raw !== "object" || Array.isArray(raw) || raw.revision !== revision
      || typeof raw.text !== "string" || Buffer.byteLength(raw.text, "utf8") > agentReplyOutboxMaxBytes
      || !Array.isArray(raw.parts) || raw.parts.length < 1 || raw.parts.length > agentReplyOutboxMaxParts
      || !Number.isSafeInteger(raw.nextPart) || raw.nextPart < 0 || raw.nextPart > raw.parts.length
      || raw.parts.some((part) => typeof part !== "string" || Buffer.byteLength(part, "utf8") > MAX_T3AMS_TEXT_BYTES)) {
    return { outbox: null, invalid: true };
  }
  // Chunking intentionally trims paragraph separators and may add/reopen a
  // fenced-code marker, so concatenating parts is not a valid integrity
  // check. Keep the exact already-planned chunks across a config change.
  return { outbox: { revision, text: raw.text, parts: [...raw.parts], nextPart: raw.nextPart }, invalid: false };
};
const snapshotAgentArtifactOutbox = (outbox) => ({
  revision: outbox.revision,
  files: outbox.files.map((file) => {
    const uploaded = file.uploaded?.ref == null ? null : serializeUploadedAttachmentRef(file.uploaded.ref);
    return {
      filename: file.filename,
      storedName: file.storedName,
      size: file.size,
      mime: file.mime,
      sent: file.sent === true,
      ...(file.messageId == null ? {} : { messageId: file.messageId }),
      ...(uploaded == null ? {} : { uploaded }),
    };
  }),
});
const removeAgentArtifactOutbox = (id) => {
  const directory = artifactOutboxDirectory(id);
  if (directory == null) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2 });
    fsyncDirectory(agentArtifactOutboxRoot);
  }
  catch (error) { log("T3AMS_AGENT_ARTIFACT_OUTBOX_CLEANUP_FAILED", { id, error: String(error?.message ?? error) }); }
};
const cleanupDeferredAgentArtifactOutboxes = () => {
  while (deferredAgentArtifactOutboxCleanup.length > 0) {
    removeAgentArtifactOutbox(deferredAgentArtifactOutbox.shift());
  }
};
const bridgeWaiters = new Set();
const wakeBridge = () => {
  for (const resolve of [...bridgeWaiters]) {
    bridgeWaiters.delete(resolve);
    resolve();
  }
};
// `submitted` is the durable at-most-once boundary. It is written before the
// worker receives any attachment bytes. If this process dies before a result
// can be saved, a retry deliberately falls back to attachment metadata rather
// than sending the same private file to the external provider a second time.
const MEDIA_ANALYSIS_STATES = new Set(["complete", "unavailable", "budget", "submitted"]);
const MEDIA_ANALYSIS_RESULT_STATES = new Set(["analyzed", "unsupported", "unavailable"]);
// Persist just the bounded model-facing projection, never a local cache path,
// HOP capability, raw bytes, provider request id, or worker error. A durable
// completion is reused; a durable `submitted` boundary is intentionally
// metadata-only after a crash, preserving at-most-once external processing.
const compactMediaAnalysis = (raw, state = "complete") => {
  const normalizedState = MEDIA_ANALYSIS_STATES.has(state) ? state : "unavailable";
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.results) ? raw.results : []) {
    if (!Number.isSafeInteger(item?.index) || item.index < 0 || item.index >= attachmentMaxCount || seen.has(item.index)
        || !MEDIA_ANALYSIS_RESULT_STATES.has(item.status)) continue;
    if (item.status === "analyzed") {
      const summary = truncateUtf8(String(item.summary ?? "").replace(/\u0000/g, "").trim(), t3amsMediaAnalyzerMaxSummaryBytes);
      if (!summary) continue;
      results.push({ index: item.index, status: "analyzed", summary });
    } else {
      results.push({ index: item.index, status: item.status });
    }
    seen.add(item.index);
  }
  return { v: 1, state: normalizedState, results: results.sort((left, right) => left.index - right.index) };
};
const restoreMediaAnalysis = (raw) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 1 || !MEDIA_ANALYSIS_STATES.has(raw.state)
      || !Array.isArray(raw.results) || raw.results.length > attachmentMaxCount) return null;
  const normalized = compactMediaAnalysis(raw, raw.state);
  if (normalized.results.length !== raw.results.length) return null;
  return normalized;
};
const restoredIngressIds = new Set();
for (const raw of Array.isArray(restored?.ingress) ? restored.ingress.slice(-ingressCap) : []) {
  const routed = restoreT3amsIngressRoute(raw?.routed);
  const id = typeof raw?.id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(raw.id) && !restoredIngressIds.has(raw.id)
    ? raw.id
    : null;
  const kind = raw?.kind === "bridge" || raw?.kind === "turn" ? raw.kind : null;
  if (routed == null || id == null || kind == null) continue;
  const revision = Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0;
  const restoredOutbox = kind === "turn"
    ? restoreAgentArtifactOutbox(raw.agentArtifactOutbox, revision)
    : { outbox: null, invalid: false };
  const restoredReplyOutbox = kind === "turn"
    ? restoreAgentReplyOutbox(raw.agentReplyOutbox, revision)
    : { outbox: null, invalid: false };
  const restoredMediaAnalysis = kind === "turn" && raw.mediaAnalysisRevision === revision
    ? restoreMediaAnalysis(raw.mediaAnalysis)
    : null;
  restoredIngressIds.add(id);
  ingress.push({
    id,
    kind,
    routed,
    createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt : Date.now(),
    attempts: Number.isSafeInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
    retryAt: Number.isSafeInteger(raw.retryAt) && raw.retryAt > Date.now() ? raw.retryAt : 0,
    completedAt: Number.isSafeInteger(raw.completedAt) && raw.completedAt > 0 ? raw.completedAt : 0,
    revision,
    artifactOutbox: restoredOutbox.outbox,
    artifactOutboxInvalid: restoredOutbox.invalid,
    replyOutbox: restoredReplyOutbox.outbox,
    replyOutboxInvalid: restoredReplyOutbox.invalid,
    mediaAnalysis: restoredMediaAnalysis,
    mediaAnalysisRevision: restoredMediaAnalysis == null ? null : revision,
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
  messageLifecycle: messageLifecycle?.snapshot?.() ?? restored?.messageLifecycle ?? null,
  agent: agentRuntime?.snapshotAgent?.() ?? restored?.agent ?? null,
  agentIntroduced: agentRuntime?.introducedList?.() ?? restored?.agentIntroduced ?? [],
  mediaAnalysisBudget: mediaAnalysisBudget.snapshot(),
  // A threaded turn has its own native session key but still belongs to one
  // valid delivery conversation. Persist the base chat separately so restore
  // can retain normal conversation validation and known-chat bounds.
  agentPeers: agentRuntime == null ? [] : agentRuntime.stateKeys().flatMap((sessionKey) => {
    const chatId = conversationForAgentSessionKey(sessionKey);
    if (chatId == null) return [];
    const peer = agentRuntime.peerSnapshot(sessionKey);
    return Object.keys(peer).length > 0
      ? [{ chatId, ...(sessionKey === chatId ? {} : { sessionKey }), ...peer }]
      : [];
  }),
  ingress: ingress.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    routed: entry.routed,
    createdAt: entry.createdAt,
    attempts: entry.attempts ?? 0,
    retryAt: entry.retryAt ?? 0,
    completedAt: entry.completedAt ?? 0,
    revision: entry.revision ?? 0,
    ...(entry.artifactOutbox == null ? {} : { agentArtifactOutbox: snapshotAgentArtifactOutbox(entry.artifactOutbox) }),
    ...(entry.replyOutbox == null ? {} : { agentReplyOutbox: entry.replyOutbox }),
    ...(entry.mediaAnalysis == null || entry.mediaAnalysisRevision !== entry.revision
      ? {}
      : { mediaAnalysisRevision: entry.revision, mediaAnalysis: entry.mediaAnalysis }),
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
      while (deferredIngressUnpins.length > 0) protocol.unpinConversation(deferredIngressUnpins.shift());
      cleanupDeferredAgentArtifactOutboxes();
      ingressDurable = true;
      wakeBridge();
      pumpIngress();
      return true;
    });
  }, 1000);
  ingressDurabilityRetryTimer.unref?.();
};
// Atomically reserve a public-analysis token and write the at-most-once
// `submitted` boundary before any attachment bytes leave the transport. If
// persistence itself fails, roll the in-memory token bucket back too: a
// durability outage must pause work, not silently burn a sender's allowance.
const beginMediaAnalysisForIngress = async (entryId, revision, senderXid) => mutateIngress(async () => {
  const current = ingress.find((candidate) => candidate.id === entryId);
  if (current == null || (Number.isSafeInteger(current.revision) ? current.revision : 0) !== revision) {
    return { status: "superseded", allowed: false, durable: true };
  }
  const budgetBefore = mediaAnalysisBudget.snapshot();
  const priorAnalysis = current.mediaAnalysis;
  const priorAnalysisRevision = current.mediaAnalysisRevision;
  const reservation = mediaAnalysisBudget.reserve(senderXid);
  current.mediaAnalysis = compactMediaAnalysis(null, reservation.allowed ? "submitted" : "budget");
  current.mediaAnalysisRevision = revision;
  const saved = await persistCritical();
  if (!saved) {
    mediaAnalysisBudget.restore(budgetBefore);
    current.mediaAnalysis = priorAnalysis;
    current.mediaAnalysisRevision = priorAnalysisRevision;
    // `persistCritical()` may already have staged its failed snapshot. Replace
    // it with the rolled-back state before the normal retry timer flushes it.
    persist();
    ingressDurable = false;
    scheduleIngressDurabilityRetry();
    return { status: "persistence", allowed: false, durable: false, reason: "persistence", retryAfterMs: 0 };
  }
  ingressDurable = true;
  return {
    status: reservation.allowed ? "started" : "budget",
    ...reservation,
    durable: true,
  };
});

const subscriptions = new Map();
const subscriptionRetryTimers = new Map();
const subscriptionRetryAttempts = new Map();
// A known DM needs both its carrier and ops route so user redactions/edits
// reconcile before dispatch. Leave room for the default known-chat roster as
// well as workspace control/channel routes.
const subscriptionCap = numberEnv("BOT_T3AMS_SUBSCRIPTION_CAP", 1_024, { min: 4, max: 4_096 });
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
// A channel's top-level lane and every thread lane deliberately share the
// same canonical form as the direct agent's native session key. This keeps
// turn ordering aligned with model memory: one thread stays serial, while two
// unrelated threads are free to use the bounded global worker pool together.
const ingressLaneFor = (chatId, threadRootId = null) =>
  ingressLaneKeyForT3ams(chatId, threadRootId) ?? chatId;
const ingressLaneForRouted = (routed) => ingressLaneFor(
  routed?.conversationKey,
  routed?.message?.threadRootId ?? routed?.replyTarget?.threadRootId ?? null,
);
const ingressLaneForEntry = (entry) => ingressLaneForRouted(entry?.routed);
const createTurnContext = (chatId, threadRootId = null) => {
  const laneKey = ingressLaneKeyForT3ams(chatId, threadRootId);
  return Object.freeze({
    chatId,
    laneKey: laneKey ?? chatId,
    threadRootId: laneKey == null ? null : threadRootId ?? null,
  });
};
const turnContextForRouted = (routed) => createTurnContext(
  routed?.conversationKey,
  routed?.message?.threadRootId ?? routed?.replyTarget?.threadRootId ?? null,
);
// The direct runtime receives an opaque, immutable context with each turn.
// Keep callbacks backwards compatible (a transport that does not pass one
// simply uses the top-level lane), but never let a malformed caller select a
// different thread's live reply or durable artifact handoff.
const turnContextFor = (chatId, supplied = null) => {
  if (supplied?.chatId === chatId) {
    const laneKey = ingressLaneKeyForT3ams(chatId, supplied.threadRootId);
    if (laneKey != null && supplied.laneKey === laneKey) return supplied;
  }
  return createTurnContext(chatId);
};
// Agent callbacks retain the delivery chat ID for transport submission, but
// their presentation and outbox state are lane-scoped. That is what makes it
// safe for two direct-agent threads in one channel to overlap.
const activeReplyThreads = new Map(); // laneKey -> threadRootId|null
// Bridge workers do not execute inside the direct runtime. Hold their trigger
// root by leased lane, so another thread's worker cannot steal its placeholder.
const bridgeReplyThreads = new Map(); // laneKey -> threadRootId|null
const replyThreadFor = (chatId, supplied = null) => {
  const context = turnContextFor(chatId, supplied);
  if (activeReplyThreads.has(context.laneKey)) return activeReplyThreads.get(context.laneKey);
  if (bridgeReplyThreads.has(context.laneKey)) return bridgeReplyThreads.get(context.laneKey);
  return context.threadRootId;
};
// The bridge may only request an edit of a message this process issued. The
// client independently enforces author matching, but this local guard avoids
// signing pointless or surprising operations for arbitrary message IDs. Keep
// its delivery lane too: a worker holding a claimed thread lease must not
// mutate a bot bubble from a different thread in the same chat.
const botIssuedMessages = new Map(); // chatId -> Map<messageId, laneKey>
const noteBotIssuedMessage = (chatId, messageId, suppliedTurnContext = null) => {
  const id = bareHex(messageId);
  if (!/^[0-9a-f]{64}$/.test(id)) return false;
  const context = turnContextFor(chatId, suppliedTurnContext);
  const ids = botIssuedMessages.get(chatId) ?? new Map();
  ids.delete(id);
  ids.set(id, context.laneKey);
  while (ids.size > 256) ids.delete(ids.keys().next().value);
  botIssuedMessages.delete(chatId);
  botIssuedMessages.set(chatId, ids);
  while (botIssuedMessages.size > knownChatCap) botIssuedMessages.delete(botIssuedMessages.keys().next().value);
  return true;
};
const isBotIssuedMessage = (chatId, messageId, suppliedTurnContext = undefined) => {
  const laneKey = botIssuedMessages.get(chatId)?.get(bareHex(messageId));
  if (laneKey == null) return false;
  return suppliedTurnContext === undefined || laneKey === turnContextFor(chatId, suppliedTurnContext).laneKey;
};

// ---------- attachments and durable files ----------
// File-store namespaces must be 32-byte hex, while T3ams conversation IDs
// include a type and (for channels) two identities.  A domain-separated hash
// keeps the vault opaque and prevents a DM/channel collision.
const fileNamespaceForChat = (chatId) => {
  if (!isT3amsConversationKey(chatId)) throw new Error("invalid T3ams file namespace");
  return createHash("sha256").update("pca:t3ams-file-v1\0").update(chatId).digest("hex");
};
const attachmentProgressTitle = (attachment, action) => {
  const filename = typeof attachment?.filename === "string" && attachment.filename
    ? attachment.filename
    : attachment?.kind === "image"
      ? "photo"
      : attachment?.kind === "video"
        ? "video"
        : attachment?.kind === "audio"
          ? "audio file"
          : "attachment";
  return `${action} ${filename}`;
};
const fetchT3amsAttachments = async (attachments, { onProgress = null } = {}) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  // Never mutate an ingress entry's durable route with an ephemeral cache
  // path.  A restart can safely re-fetch from the encrypted capability.
  const prepared = attachments.map((attachment) => ({ ...attachment }));
  return t3amsMedia.fetchAttachments(prepared, {
    onStart: (attachment) => onProgress?.(attachmentProgressTitle(attachment, "downloading")),
    onSuccess: (attachment) => onProgress?.(attachmentProgressTitle(attachment, "downloaded")),
    onError: (attachment) => onProgress?.(attachmentProgressTitle(attachment, "couldn't download")),
  });
};
const sendT3amsAttachment = async (chatId, {
  filePath,
  mime,
  size,
  text = null,
  filename = null,
  threadRootId = undefined,
  turnContext = null,
  // Durable direct-agent delivery can resume after Bulletin upload without
  // buying/uploading the same encrypted blob again. The ref stays private in
  // BOT_STATE_DIR and is never returned by the bridge API.
  uploaded: persistedUpload = null,
  onUploaded = null,
  beforeSend = null,
  guard = null,
} = {}) => {
  if (!t3amsMedia.enabled && persistedUpload == null) {
    throw new Error("T3ams file delivery is disabled; configure BOT_T3AMS_BULLETIN_RPC and a funded Bulletin allowance");
  }
  // A bridge vault can preserve a more specific MIME than T3ams has elected
  // to admit inbound. It is still safe to send the opaque bytes as the
  // standards-defined generic type, rather than making saved arbitrary files
  // impossible to retrieve through the chat.
  const requestedMime = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  const outgoingMime = requestedMime && isT3amsAttachmentMimeAllowed(attachmentOptions.allowedMimeTypes, requestedMime)
    ? requestedMime
    : isT3amsAttachmentMimeAllowed(attachmentOptions.allowedMimeTypes, "application/octet-stream")
      ? "application/octet-stream"
      : null;
  if (outgoingMime == null) {
    throw new Error("file MIME is outside this bot's T3ams attachment policy");
  }
  let uploaded = persistedUpload;
  if (uploaded == null) {
    uploaded = await t3amsMedia.upload({ filePath, mime: outgoingMime, size, filename });
    if (typeof onUploaded === "function") await onUploaded(uploaded);
  }
  if (uploaded?.ref == null || uploaded?.attachment == null
      || uploaded.attachment.mime !== outgoingMime || uploaded.attachment.size !== size) {
    throw new Error("persisted T3ams attachment upload is invalid");
  }
  if (typeof beforeSend === "function") await beforeSend(uploaded);
  const body = typeof text === "string" ? text : uploaded.attachment.filename;
  const root = threadRootId === undefined ? replyThreadFor(chatId, turnContext) : threadRootId;
  const sent = await protocol.sendRichText(chatId, body, {
    ...(root == null ? {} : { threadRootId: root }),
    attachments: [uploaded.ref],
    guard,
  });
  noteBotIssuedMessage(chatId, sent.messageId, createTurnContext(chatId, root));
  log("T3AMS_SENT_FILE", { chatId, mime: uploaded.attachment.mime, bytes: uploaded.attachment.size });
  return { ...sent, attachment: uploaded.attachment };
};
// Node does not depend on a heavyweight media-sniffing library merely to
// label a direct agent's generated artifact. Prefer a conservative extension
// mapping for client rendering; unknown output remains a safe opaque file.
const mimeForT3amsFilename = (filename) => {
  const extension = path.extname(String(filename ?? "")).toLowerCase();
  return {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".avif": "image/avif", ".heic": "image/heic", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac",
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".xml": "application/xml", ".rtf": "application/rtf",
    ".doc": "application/msword", ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip", ".gz": "application/gzip", ".tar": "application/x-tar",
    ".7z": "application/x-7z-compressed", ".rar": "application/vnd.rar",
  }[extension] ?? "application/octet-stream";
};
// Direct-agent final turns are staged as one durable handoff: immutable files
// plus every final-text chunk. The journal is committed before the first chat
// statement or HOP upload, so a retry drains this exact output and never asks
// the model/tools to produce a second answer. The textual answer drains first:
// an unavailable optional attachment must not hide the useful final response.
const activeAgentArtifactDeliveries = new Map(); // laneKey -> { id, revision, turnContext }
// Snapshot copies happen outside the journal mutex so a large PDF does not
// block ingress bookkeeping. Reserve their global capacity first, otherwise
// several concurrent turns could all pass the quota check before any one
// manifest is visible in `ingress`.
const pendingAgentArtifactReservations = new Map(); // entryId -> { revision, entries, bytes }
const pendingAgentReplyReservations = new Map(); // entryId -> { revision, bytes }
const artifactOutboxPath = (entryId, storedName) => {
  const directory = artifactOutboxDirectory(entryId);
  if (directory == null || !ARTIFACT_OUTBOX_STORED_NAME_RE.test(storedName)) return null;
  return path.join(directory, storedName);
};
const ensureAgentArtifactOutboxDirectory = (entryId) => {
  const directory = artifactOutboxDirectory(entryId);
  if (directory == null) throw new Error("invalid generated-artifact outbox ID");
  let created = false;
  try { fs.mkdirSync(directory, { mode: 0o700 }); created = true; }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("generated-artifact outbox directory is unsafe");
  try { fs.chmodSync(directory, 0o700); } catch { /* state-dir permissions were verified at startup */ }
  if (created) fsyncDirectory(agentArtifactOutboxRoot);
  return directory;
};
const artifactOutboxError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  error.t3amsTerminal = true;
  return error;
};
const artifactHandoffSuperseded = () => {
  const error = new Error("generated-artifact handoff was superseded by an edit or delete");
  error.code = "T3AMS_INGRESS_SUPERSEDED";
  error.t3amsSuperseded = true;
  return error;
};
const copyAgentArtifactToOutbox = (entryId, artifact, index) => {
  if (artifact == null || typeof artifact.filePath !== "string" || !validAgentArtifactFilename(artifact.filename)
      || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || artifact.size > attachmentMaxBytes) {
    throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "agent artifact metadata is invalid");
  }
  const directory = ensureAgentArtifactOutboxDirectory(entryId);
  const storedName = `artifact-${index}-${createHash("sha256")
    .update(randomUUID())
    .update("\\0")
    .update(artifact.filename)
    .update("\\0")
    .update(String(artifact.size))
    .digest("hex")
    .slice(0, 16)}`;
  const destination = artifactOutboxPath(entryId, storedName);
  if (destination == null || path.dirname(destination) !== directory) {
    throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "agent artifact outbox path is invalid");
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let sourceFd = null;
  let destinationFd = null;
  let copied = false;
  try {
    sourceFd = fs.openSync(artifact.filePath, fs.constants.O_RDONLY | noFollow);
    const source = fs.fstatSync(sourceFd);
    if (!source.isFile() || source.nlink !== 1 || !Number.isSafeInteger(source.size) || source.size !== artifact.size) {
      throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "agent artifact snapshot is unsafe or changed");
    }
    destinationFd = fs.openSync(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, source.size)));
    let copiedBytes = 0;
    while (copiedBytes < source.size) {
      const read = fs.readSync(sourceFd, buffer, 0, Math.min(buffer.length, source.size - copiedBytes), null);
      if (read <= 0) throw new Error("agent artifact snapshot ended before its recorded size");
      let written = 0;
      while (written < read) {
        const count = fs.writeSync(destinationFd, buffer, written, read - written);
        if (count <= 0) throw new Error("generated-artifact outbox write failed");
        written += count;
      }
      copiedBytes += read;
    }
    const after = fs.fstatSync(sourceFd);
    if (after.dev !== source.dev || after.ino !== source.ino || after.size !== source.size || after.nlink !== 1) {
      throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "agent artifact snapshot changed during copy");
    }
    fs.fsyncSync(destinationFd);
    fsyncDirectory(directory);
    copied = true;
    return {
      filename: artifact.filename,
      storedName,
      size: source.size,
      mime: mimeForT3amsFilename(artifact.filename),
      sent: false,
    };
  } finally {
    try { if (sourceFd != null) fs.closeSync(sourceFd); } catch { /* best effort */ }
    try { if (destinationFd != null) fs.closeSync(destinationFd); } catch { /* best effort */ }
    if (!copied) {
      try { fs.rmSync(destination, { force: true, maxRetries: 2 }); } catch { /* best effort */ }
    }
  }
};
const assertOutboxFile = (entryId, file) => {
  const filePath = artifactOutboxPath(entryId, file.storedName);
  if (filePath == null) throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_CORRUPT", "generated-artifact outbox path is invalid");
  let stat;
  try { stat = fs.lstatSync(filePath); }
  catch { throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_CORRUPT", "generated-artifact outbox file is missing"); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size !== file.size) {
    throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_CORRUPT", "generated-artifact outbox file is invalid");
  }
  return filePath;
};
const artifactOutboxUsage = ({ exceptId = null } = {}) => {
  let entries = 0;
  let bytes = 0;
  for (const entry of ingress) {
    if (entry.id === exceptId || entry.artifactOutbox == null) continue;
    for (const file of entry.artifactOutbox.files) {
      // An upload reference is enough to resume the statement submission; the
      // private source bytes can be reclaimed as soon as that reference is
      // durable. Sent files are similarly no longer needed.
      if (file.sent || file.uploaded != null) continue;
      entries += 1;
      bytes += file.size;
    }
  }
  return { entries, bytes };
};
const replyOutboxByteCost = (reply) => Buffer.byteLength(reply.text, "utf8")
  + reply.parts.reduce((total, part) => total + Buffer.byteLength(part, "utf8"), 0)
  + 256;
const replyOutboxUsage = ({ exceptId = null } = {}) => {
  let entries = 0;
  let bytes = 0;
  for (const entry of ingress) {
    if (entry.id === exceptId || entry.replyOutbox == null) continue;
    if (entry.replyOutbox.nextPart >= entry.replyOutbox.parts.length) continue;
    entries += 1;
    bytes += replyOutboxByteCost(entry.replyOutbox);
  }
  return { entries, bytes };
};
const pendingArtifactOutboxUsage = ({ exceptId = null } = {}) => {
  let entries = 0;
  let bytes = 0;
  for (const [id, reservation] of pendingAgentArtifactReservations) {
    if (id === exceptId) continue;
    entries += reservation.entries;
    bytes += reservation.bytes;
  }
  return { entries, bytes };
};
const reserveAgentArtifactOutboxCapacity = async (context, entries, bytes) => mutateIngress(async () => {
  const current = ingress.find((entry) => entry.id === context.id);
  if (current == null || ingressRevision(current) !== context.revision) return "superseded";
  const used = artifactOutboxUsage({ exceptId: context.id });
  const pending = pendingArtifactOutboxUsage({ exceptId: context.id });
  if (used.entries + pending.entries + entries > agentArtifactOutboxMaxEntries
      || used.bytes + pending.bytes + bytes > agentArtifactOutboxMaxBytes) {
    throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_FULL", "generated-artifact outbox capacity is exhausted");
  }
  pendingAgentArtifactReservations.set(context.id, { revision: context.revision, entries, bytes });
  return true;
});
const releaseAgentArtifactOutboxCapacity = (context) => {
  const pending = pendingAgentArtifactReservations.get(context.id);
  if (pending?.revision === context.revision) pendingAgentArtifactReservations.delete(context.id);
};
const pendingReplyOutboxUsage = ({ exceptId = null } = {}) => {
  let entries = 0;
  let bytes = 0;
  for (const [id, reservation] of pendingAgentReplyReservations) {
    if (id === exceptId) continue;
    entries += 1;
    bytes += reservation.bytes;
  }
  return { entries, bytes };
};
const reserveAgentReplyOutboxCapacity = async (context, bytes) => mutateIngress(async () => {
  const current = ingress.find((entry) => entry.id === context.id);
  if (current == null || ingressRevision(current) !== context.revision) return "superseded";
  const used = replyOutboxUsage({ exceptId: context.id });
  const pending = pendingReplyOutboxUsage({ exceptId: context.id });
  if (used.entries + pending.entries + 1 > agentReplyOutboxMaxEntries
      || used.bytes + pending.bytes + bytes > agentReplyOutboxMaxTotalBytes) {
    throw artifactOutboxError("T3AMS_REPLY_OUTBOX_FULL", "generated reply outbox capacity is exhausted");
  }
  pendingAgentReplyReservations.set(context.id, { revision: context.revision, bytes });
  return true;
});
const releaseAgentReplyOutboxCapacity = (context) => {
  const pending = pendingAgentReplyReservations.get(context.id);
  if (pending?.revision === context.revision) pendingAgentReplyReservations.delete(context.id);
};
const validateAgentArtifactBatch = (artifacts) => {
  if (!Array.isArray(artifacts) || artifacts.length > agentOutputArtifactMaxCount) {
    throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "generated-artifact batch is invalid");
  }
  let totalBytes = 0;
  for (const artifact of artifacts) {
    if (artifact == null || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || artifact.size > attachmentMaxBytes) {
      throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "agent artifact metadata is invalid");
    }
    totalBytes += artifact.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > agentOutputArtifactMaxTotalBytes) {
      throw artifactOutboxError("T3AMS_ARTIFACT_OUTBOX_INVALID", "generated-artifact batch exceeds its total byte limit");
    }
  }
  return totalBytes;
};
const mutateAgentTurnOutbox = async (context, operation) => mutateIngress(async () => {
  const entry = ingress.find((candidate) => candidate.id === context.id);
  if (entry == null || ingressRevision(entry) !== context.revision) return "superseded";
  const value = await operation(entry);
  const durable = await persistCritical();
  if (!durable) {
    ingressDurable = false;
    scheduleIngressDurabilityRetry();
    return false;
  }
  ingressDurable = true;
  return value;
});
const removeOutboxFile = (entryId, file) => {
  const filePath = artifactOutboxPath(entryId, file.storedName);
  if (filePath == null) return;
  try {
    fs.rmSync(filePath, { force: true, maxRetries: 2 });
    const directory = artifactOutboxDirectory(entryId);
    if (directory != null) fsyncDirectory(directory);
  } catch (error) {
    log("T3AMS_AGENT_ARTIFACT_OUTBOX_FILE_CLEANUP_FAILED", { id: entryId, file: file.storedName, error: String(error?.message ?? error) });
  }
};
const prepareAgentTurnOutbox = async (context, { text, artifacts }) => {
  const current = ingress.find((entry) => entry.id === context.id);
  if (current == null || ingressRevision(current) !== context.revision) throw artifactHandoffSuperseded();
  if (current.artifactOutboxInvalid || current.replyOutboxInvalid) {
    throw artifactOutboxError("T3AMS_AGENT_OUTBOX_CORRUPT", "generated-turn outbox metadata is invalid");
  }
  if (current.replyOutbox != null) {
    if (current.replyOutbox.revision !== context.revision) throw artifactHandoffSuperseded();
    return { artifacts: current.artifactOutbox, reply: current.replyOutbox };
  }
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > agentReplyOutboxMaxBytes) {
    throw artifactOutboxError("T3AMS_REPLY_OUTBOX_INVALID", "generated reply is invalid or too large");
  }
  const parts = splitMessageText(text, replyChunkBytes);
  if (parts.length === 0 || parts.length > agentReplyOutboxMaxParts
      || parts.some((part) => Buffer.byteLength(part, "utf8") > replyChunkBytes)) {
    throw artifactOutboxError("T3AMS_REPLY_OUTBOX_INVALID", "generated reply cannot be chunked safely");
  }
  const reply = { revision: context.revision, text, parts, nextPart: 0 };
  const replyReservation = await reserveAgentReplyOutboxCapacity(context, replyOutboxByteCost(reply));
  if (replyReservation === "superseded") throw artifactHandoffSuperseded();
  let outbox = current.artifactOutbox;
  let createdOutbox = false;
  let reservedCapacity = false;
  try {
    if (outbox != null) {
      if (outbox.revision !== context.revision) throw artifactHandoffSuperseded();
      // A legacy artifact-only manifest can be upgraded into a complete final
      // turn. Files already uploaded/sent intentionally do not need to exist.
      for (const file of outbox.files) if (!file.sent && file.uploaded == null) assertOutboxFile(context.id, file);
    } else {
      const totalBytes = validateAgentArtifactBatch(artifacts);
      if (artifacts.length > 0) {
        let reservation = null;
        try {
          reservation = await reserveAgentArtifactOutboxCapacity(context, artifacts.length, totalBytes);
        } catch (error) {
          if (error?.code !== "T3AMS_ARTIFACT_OUTBOX_FULL") throw error;
          // Preserve the text answer when storage pressure prevents optional
          // generated files. The agent has already completed; retrying its tools
          // cannot free capacity and would turn a full outbox into a loop.
          log("T3AMS_AGENT_ARTIFACTS_SKIPPED", { id: context.id, count: artifacts.length, bytes: totalBytes, reason: "outbox-full" });
        }
        if (reservation === "superseded") throw artifactHandoffSuperseded();
        if (reservation === true) {
          reservedCapacity = true;
          const files = [];
          try {
            for (const [index, artifact] of artifacts.entries()) files.push(copyAgentArtifactToOutbox(context.id, artifact, index));
            const directory = artifactOutboxDirectory(context.id);
            if (directory != null) fsyncDirectory(directory);
          } catch (error) {
            removeAgentArtifactOutbox(context.id);
            throw error;
          }
          outbox = { revision: context.revision, files };
          createdOutbox = true;
        }
      }
    }
    const saved = await mutateAgentTurnOutbox(context, async (entry) => {
      entry.artifactOutbox = outbox;
      entry.artifactOutboxInvalid = false;
      entry.replyOutbox = reply;
      entry.replyOutboxInvalid = false;
      return true;
    });
    if (saved === "superseded") {
      if (createdOutbox) removeAgentArtifactOutbox(context.id);
      throw artifactHandoffSuperseded();
    }
    if (saved !== true) {
      const error = new Error("generated turn outbox persistence is pending");
      error.code = "T3AMS_AGENT_OUTBOX_PERSIST_PENDING";
      throw error;
    }
    return { artifacts: outbox, reply };
  } finally {
    if (reservedCapacity) releaseAgentArtifactOutboxCapacity(context);
    releaseAgentReplyOutboxCapacity(context);
  }
};
const markAgentArtifactUploaded = async (context, outbox, file, uploaded) => {
  const marked = await mutateAgentTurnOutbox(context, async (entry) => {
    if (entry.artifactOutbox !== outbox) return "superseded";
    const current = entry.artifactOutbox?.files.find((candidate) => candidate.storedName === file.storedName);
    if (current == null) return "superseded";
    current.uploaded = uploaded;
    return true;
  });
  if (marked === "superseded") throw artifactHandoffSuperseded();
  if (marked !== true) {
    const error = new Error("generated-artifact upload state is pending");
    error.code = "T3AMS_AGENT_OUTBOX_PERSIST_PENDING";
    throw error;
  }
  removeOutboxFile(context.id, file);
};
const markAgentArtifactSent = async (context, outbox, file, messageId) => {
  const marked = await mutateAgentTurnOutbox(context, async (entry) => {
    if (entry.artifactOutbox !== outbox) return "superseded";
    const current = entry.artifactOutbox?.files.find((candidate) => candidate.storedName === file.storedName);
    if (current == null) return "superseded";
    current.sent = true;
    current.messageId = messageId;
    return true;
  });
  if (marked === "superseded") throw artifactHandoffSuperseded();
  if (marked !== true) {
    const error = new Error("generated-artifact delivery state is pending");
    error.code = "T3AMS_AGENT_OUTBOX_PERSIST_PENDING";
    throw error;
  }
  removeOutboxFile(context.id, file);
};
const deliverPersistedAgentArtifacts = async (chatId, context, outbox) => {
  if (outbox == null) return;
  const threadRootId = replyThreadFor(chatId, context.turnContext);
  for (const file of outbox.files) {
    if (!ingressEntryCurrent(context.id, context.revision)) throw artifactHandoffSuperseded();
    if (file.sent) continue;
    const filePath = file.uploaded == null ? assertOutboxFile(context.id, file) : null;
    const sent = await sendT3amsAttachment(chatId, {
      filePath,
      filename: file.filename,
      size: file.size,
      mime: file.mime,
      text: `Generated file: ${file.filename}`,
      threadRootId,
      turnContext: context.turnContext,
      uploaded: file.uploaded,
      onUploaded: async (uploaded) => markAgentArtifactUploaded(context, outbox, file, uploaded),
      beforeSend: async () => {
        if (!ingressEntryCurrent(context.id, context.revision)) throw artifactHandoffSuperseded();
      },
    });
    await markAgentArtifactSent(context, outbox, file, sent.messageId);
  }
};
const markAgentReplyPart = async (context, reply, nextPart) => {
  const marked = await mutateAgentTurnOutbox(context, async (entry) => {
    if (entry.replyOutbox !== reply) return "superseded";
    entry.replyOutbox.nextPart = nextPart;
    return true;
  });
  if (marked === "superseded") throw artifactHandoffSuperseded();
  if (marked !== true) {
    const error = new Error("generated reply delivery state is pending");
    error.code = "T3AMS_REPLY_OUTBOX_PERSIST_PENDING";
    throw error;
  }
};
const deliverPersistedAgentReply = async (chatId, context, reply) => {
  disarmThinking(chatId, context.turnContext);
  if (reply.parts.length > 1) log("T3AMS_REPLY_CHUNKED", { chatId, parts: reply.parts.length, chars: reply.text.length });
  while (reply.nextPart < reply.parts.length) {
    if (!ingressEntryCurrent(context.id, context.revision)) throw artifactHandoffSuperseded();
    const index = reply.nextPart;
    const part = reply.parts[index];
    if (index === 0) {
      const placeholder = await takeLivePlaceholder(chatId, context.turnContext);
      if (placeholder != null) await placeholder.handle.finalize(part);
      else await sendAgentReply(chatId, part, context.turnContext);
    } else {
      await sendAgentReply(chatId, part, context.turnContext);
    }
    await markAgentReplyPart(context, reply, index + 1);
  }
};
const deliverPersistedAgentTurn = async (chatId, context, { artifacts, reply }) => deliverAgentReplyBeforeArtifacts({
  deliverReply: () => deliverPersistedAgentReply(chatId, context, reply),
  deliverArtifacts: () => deliverPersistedAgentArtifacts(chatId, context, artifacts),
});
const deliverAgentTurn = async (chatId, { text, artifacts = [] } = {}, suppliedTurnContext = null) => {
  const turnContext = turnContextFor(chatId, suppliedTurnContext);
  const context = activeAgentArtifactDeliveries.get(turnContext.laneKey) ?? null;
  if (context == null) {
    // Keep the generic runtime surface usable outside the journal. T3ams's
    // deployed direct brains always take the durable branch below.
    for (const artifact of artifacts) {
      await sendT3amsAttachment(chatId, {
        filePath: artifact.filePath,
        filename: artifact.filename,
        size: artifact.size,
        mime: mimeForT3amsFilename(artifact.filename),
        text: `Generated file: ${artifact.filename}`,
        turnContext,
      });
    }
    await deliverAgentReply(chatId, text, turnContext);
    return;
  }
  const prepared = await prepareAgentTurnOutbox(context, { text, artifacts });
  await deliverPersistedAgentTurn(chatId, context, prepared);
};
const deliverAgentArtifacts = async (chatId, artifacts, suppliedTurnContext = null) => {
  // Legacy callback retained for an embedding that has not moved to
  // deliverTurn(). The T3ams runtime itself advertises deliverTurn, so this
  // path never participates in a durable direct-agent ingress turn.
  const turnContext = turnContextFor(chatId, suppliedTurnContext);
  if (activeAgentArtifactDeliveries.has(turnContext.laneKey)) {
    throw new Error("direct agent artifact delivery requires atomic deliverTurn");
  }
  for (const artifact of artifacts) {
    await sendT3amsAttachment(chatId, {
      filePath: artifact.filePath,
      filename: artifact.filename,
      size: artifact.size,
      mime: mimeForT3amsFilename(artifact.filename),
      text: `Generated file: ${artifact.filename}`,
      turnContext,
    });
  }
};
// A crash can happen after copying a file but before its journal row reaches
// disk. Reclaim those unreferenced directories on boot, and prune source bytes
// for persisted uploads/sends (their private HOP ref is sufficient to resume).
// This also makes the global outbox quota reflect actual recoverable work
// instead of a forever-growing collection of abandoned staging directories.
const sweepAgentArtifactOutboxes = () => {
  const expected = new Map();
  for (const entry of ingress) {
    if (entry.artifactOutbox == null) continue;
    expected.set(entry.id, entry);
  }
  let changed = false;
  try {
    for (const dirent of fs.readdirSync(agentArtifactOutboxRoot, { withFileTypes: true })) {
      const entry = expected.get(dirent.name) ?? null;
      const directory = path.join(agentArtifactOutboxRoot, dirent.name);
      if (entry == null || !dirent.isDirectory() || dirent.isSymbolicLink()) {
        try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2 }); changed = true; }
        catch (error) { log("T3AMS_AGENT_ARTIFACT_OUTBOX_SWEEP_FAILED", { id: dirent.name, error: String(error?.message ?? error) }); }
        continue;
      }
      const files = new Map(entry.artifactOutbox.files.map((file) => [file.storedName, file]));
      for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = files.get(child.name) ?? null;
        const childPath = path.join(directory, child.name);
        if (file == null || file.sent || file.uploaded != null) {
          try { fs.rmSync(childPath, { recursive: true, force: true, maxRetries: 2 }); changed = true; }
          catch (error) { log("T3AMS_AGENT_ARTIFACT_OUTBOX_SWEEP_FAILED", { id: entry.id, file: child.name, error: String(error?.message ?? error) }); }
          continue;
        }
        try {
          const stat = fs.lstatSync(childPath);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size !== file.size) {
            entry.artifactOutboxInvalid = true;
            changed = true;
          }
        } catch {
          entry.artifactOutboxInvalid = true;
          changed = true;
        }
      }
      // A missing expected unsent file is just as corrupt as an unexpected
      // replacement. Let normal ingress handling dead-letter it explicitly.
      for (const file of entry.artifactOutbox.files) {
        if (file.sent || file.uploaded != null) continue;
        const filePath = artifactOutboxPath(entry.id, file.storedName);
        if (filePath == null || !fs.existsSync(filePath)) {
          entry.artifactOutboxInvalid = true;
          changed = true;
        }
      }
      fsyncDirectory(directory);
    }
    if (changed) fsyncDirectory(agentArtifactOutboxRoot);
  } catch (error) {
    log("T3AMS_AGENT_ARTIFACT_OUTBOX_SWEEP_FAILED", { error: String(error?.message ?? error) });
  }
  const usage = artifactOutboxUsage();
  if (usage.entries > agentArtifactOutboxMaxEntries || usage.bytes > agentArtifactOutboxMaxBytes) {
    log("T3AMS_AGENT_ARTIFACT_OUTBOX_OVER_CAP", {
      entries: usage.entries,
      bytes: usage.bytes,
      maxEntries: agentArtifactOutboxMaxEntries,
      maxBytes: agentArtifactOutboxMaxBytes,
    });
  }
  const replies = replyOutboxUsage();
  if (replies.entries > agentReplyOutboxMaxEntries || replies.bytes > agentReplyOutboxMaxTotalBytes) {
    log("T3AMS_REPLY_OUTBOX_OVER_CAP", {
      entries: replies.entries,
      bytes: replies.bytes,
      maxEntries: agentReplyOutboxMaxEntries,
      maxBytes: agentReplyOutboxMaxTotalBytes,
    });
  }
  if (changed) persist();
};
sweepAgentArtifactOutboxes();
// The durable file store is configured only after the authenticated protocol
// is restored below. A handler is created per turn so concurrent threads in
// the same channel cannot overwrite a mutable channel -> reply-root mapping.
let fileCommandHandlerForTurn = null;
const handleT3amsFileCommand = async (chatId, message, suppliedTurnContext = null) => {
  if (fileCommandHandlerForTurn == null) throw new Error("T3ams file commands are not initialized");
  const turnContext = turnContextFor(chatId, suppliedTurnContext);
  const namespace = fileNamespaceForChat(chatId);
  const handler = fileCommandHandlerForTurn(turnContext);
  // A mentioned channel invocation carries a trimmed commandText, whereas
  // its raw text remains useful to a model. The vault command is transport
  // owned, so it must consume the explicit slash form.
  return handler(namespace, {
    ...message,
    text: typeof message.commandText === "string" ? message.commandText : message.text,
  });
};

// ---------- live replies and typing ----------
// T3ams ops are independently retained and the SPA buffers an edit which
// arrives before its original message. Unlike the legacy session slot, an
// explicit peer ACK is not required before we may edit the placeholder.
const liveReplyTargets = new Map(); // laneKey -> immutable { chatId, threadRootId }
const bindLiveReplyTarget = (supplied) => {
  const context = turnContextFor(supplied?.chatId, supplied);
  if (!isT3amsConversationKey(context.chatId)) return context;
  liveReplyTargets.delete(context.laneKey);
  liveReplyTargets.set(context.laneKey, context);
  while (liveReplyTargets.size > knownChatCap + ingressCap) {
    liveReplyTargets.delete(liveReplyTargets.keys().next().value);
  }
  return context;
};
const liveReplyTargetFor = (laneKey) => liveReplyTargets.get(laneKey) ?? null;
const liveReplies = createLiveReplies({
  send: async ({ peerHex: laneKey, text, editOf, guard = null }) => {
    const target = liveReplyTargetFor(laneKey);
    if (target == null) throw new Error("live reply target is no longer available");
    const { chatId } = target;
    const submitGuard = claimSubmissionGuard(guard);
    if (editOf != null) {
      const edited = await protocol.editText(chatId, editOf, text, { guard: submitGuard });
      return { messageId: edited.messageId, delivered: true };
    }
    const root = replyThreadFor(chatId, target);
    const sent = await protocol.sendText(chatId, text, {
      threadRootId: root,
      guard: submitGuard,
    });
    noteBotIssuedMessage(chatId, sent.messageId, createTurnContext(chatId, root));
    return { messageId: sent.messageId, delivered: true };
  },
  awaitAck: async () => true,
  minIntervalMs: liveMinEditMs,
  maxIntervalMs: liveMaxEditMs,
  finalAckWaitMs: liveFinalAckWaitMs,
  log,
});
const thinkingTimers = new Map(); // laneKey -> timeout
const livePlaceholders = new Map(); // laneKey -> Promise<{handle, tracker, timer, ttl} | null>
// Tool actions and media retrieval can start before the delayed visible
// placeholder exists. Keep their compact activity state per serialized lane
// so the first frame is useful instead of a blank generic spinner.
const pendingProgressTrackers = new Map(); // laneKey -> deferred progress tracker
const progressTrackerFor = (laneKey) => {
  let tracker = pendingProgressTrackers.get(laneKey);
  if (tracker == null) {
    tracker = createDeferredProgressTracker({ label: "working" });
    pendingProgressTrackers.set(laneKey, tracker);
  }
  return tracker;
};
const disposeProgressTracker = (laneKey) => {
  const tracker = pendingProgressTrackers.get(laneKey);
  if (tracker == null) return;
  pendingProgressTrackers.delete(laneKey);
  tracker.dispose();
};
// A framework can stream `edit_of` frames without labeling the final frame.
// Per-lane bridge leasing lets its eventual ACK safely promote this latest
// value into a terminal edit.
const bridgePendingEdits = new Map(); // laneKey -> { messageId, text, deliveryId, leaseId }
// Keep every bridge side effect bound to the exact lease that produced it.
// In particular, a live edit is often deliberately delayed by the throttle,
// so checking only when /send is received would let a revoked worker publish
// its stale progress after a user edit/delete or lease expiry.
const bridgeLeaseIsActive = (chatId, deliveryId, leaseId, current = Date.now()) => ingress.some((entry) => entry.kind === "bridge"
  && entry.id === deliveryId
  && entry.leaseId === leaseId
  && entry.routed.conversationKey === chatId
  && Number(entry.leaseUntil) > current);
const bridgePendingEditIsActive = (laneKey, edit) => bridgePendingEdits.get(laneKey) === edit
  && bridgeLeaseIsActive(edit.chatId, edit.deliveryId, edit.leaseId);
const cancelBridgePendingEdit = (laneKey, expected = null) => {
  const edit = bridgePendingEdits.get(laneKey);
  if (edit == null || (expected != null && edit !== expected)) return false;
  bridgePendingEdits.delete(laneKey);
  liveReplies.cancelExisting(laneKey, edit.messageId);
  return true;
};
const disarmThinking = (chatId, supplied = null) => {
  const context = turnContextFor(chatId, supplied);
  const timer = thinkingTimers.get(context.laneKey);
  if (timer != null) clearTimeout(timer);
  thinkingTimers.delete(context.laneKey);
  disposeProgressTracker(context.laneKey);
};
const takeLivePlaceholder = async (chatId, supplied = null) => {
  const context = turnContextFor(chatId, supplied);
  const pending = livePlaceholders.get(context.laneKey);
  if (pending == null) return null;
  livePlaceholders.delete(context.laneKey);
  const placeholder = await pending.catch(() => null);
  if (placeholder != null) {
    clearInterval(placeholder.timer);
    clearTimeout(placeholder.ttl);
  }
  disposeProgressTracker(context.laneKey);
  return placeholder;
};
const peekLivePlaceholder = (chatId, supplied = null) => livePlaceholders.get(turnContextFor(chatId, supplied).laneKey) ?? null;
const bestEffortTyping = (chatId, { guard = null } = {}) => {
  if (guard != null && !guard()) return;
  void protocol.sendTyping(chatId, { guard: claimSubmissionGuard(guard) }).catch((error) => {
    if (error?.bridgeClaimStale === true) return;
    log("T3AMS_TYPING_FAILED", { chatId, error: String(error?.message ?? error) });
  });
};
const armThinking = (chatId, { guard = null, turnContext = null } = {}) => {
  const context = bindLiveReplyTarget(turnContextFor(chatId, turnContext));
  const laneKey = context.laneKey;
  if (!thinkingText || thinkingAfterMs <= 0 || thinkingTimers.has(laneKey) || livePlaceholders.has(laneKey)) return;
  const timer = setTimeout(() => {
    thinkingTimers.delete(laneKey);
    if (guard != null && !guard()) return;
    if (livePlaceholders.has(laneKey)) return;
    livePlaceholders.set(laneKey, (async () => {
      const handle = await liveReplies.begin(laneKey, thinkingText, { guard });
      const tracker = progressTrackerFor(laneKey);
      tracker.attach(handle);
      const heartbeat = setInterval(() => {
        bestEffortTyping(chatId, { guard });
        if (!handle.finalized) handle.update(tracker.render());
      }, liveHeartbeatMs);
      heartbeat.unref?.();
      const ttl = setTimeout(async () => {
        const placeholder = await takeLivePlaceholder(chatId, context);
        if (placeholder == null) return;
        log("T3AMS_LIVE_TTL_EXPIRED", { chatId, lane: laneKey, messageId: placeholder.handle.messageId });
        // TTL expiry is transport-owned cleanup, not an action by the worker
        // which created the placeholder.  Its lease can legitimately have
        // expired or been reissued by now, so bypass that old worker fence
        // rather than leaving a permanently spinning message behind.
        placeholder.handle.finalize(liveTimeoutText, { guard: null }).catch((error) => {
          log("T3AMS_LIVE_FINALIZE_FAILED", { chatId, lane: laneKey, error: String(error?.message ?? error) });
        });
      }, liveTtlMs);
      ttl.unref?.();
      bestEffortTyping(chatId, { guard });
      log("T3AMS_LIVE_PLACEHOLDER", { chatId, lane: laneKey, messageId: handle.messageId });
      return { handle, tracker, timer: heartbeat, ttl };
    })().catch((error) => {
      log("T3AMS_THINKING_FAILED", { chatId, lane: laneKey, error: String(error?.message ?? error) });
      disposeProgressTracker(laneKey);
      return null;
    }));
  }, thinkingAfterMs);
  timer.unref?.();
  thinkingTimers.set(laneKey, timer);
};
const sendAgentReply = async (chatId, text, suppliedTurnContext = null) => {
  const turnContext = turnContextFor(chatId, suppliedTurnContext);
  disarmThinking(chatId, turnContext);
  const root = replyThreadFor(chatId, turnContext);
  const sent = await protocol.sendText(chatId, text, { threadRootId: root });
  noteBotIssuedMessage(chatId, sent.messageId, createTurnContext(chatId, root));
  return sent;
};
const deliverAgentReply = async (chatId, text, suppliedTurnContext = null) => {
  const turnContext = turnContextFor(chatId, suppliedTurnContext);
  disarmThinking(chatId, turnContext);
  const parts = splitMessageText(text, replyChunkBytes);
  if (parts.length > 1) log("T3AMS_REPLY_CHUNKED", { chatId, parts: parts.length, chars: text.length });
  const placeholder = await takeLivePlaceholder(chatId, turnContext);
  let deliveredFirst = false;
  if (placeholder != null) {
    // Finalization is intentionally not best-effort: a final-answer delivery
    // failure is surfaced to the durable ingress journal for retry. Progress
    // edits and typing above remain non-fatal.
    await placeholder.handle.finalize(parts[0]);
    deliveredFirst = true;
  }
  for (const part of deliveredFirst ? parts.slice(1) : parts) await sendAgentReply(chatId, part, turnContext);
};
const beginTurnProgress = (chatId, suppliedTurnContext = null) => {
  const turnContext = bindLiveReplyTarget(turnContextFor(chatId, suppliedTurnContext));
  bestEffortTyping(chatId);
  const tracker = progressTrackerFor(turnContext.laneKey);
  armThinking(chatId, { turnContext });
  if (!liveProgress) return null;
  const onAction = (title) => tracker.add(title);
  // Claude's stream-json deltas contain user-visible final prose, not hidden
  // chain-of-thought. Render that prose into the same ACK-gated editable
  // placeholder, while retaining a bounded prefix until the terminal answer
  // atomically replaces it. This gives T3ams a real streaming answer without
  // leaking reasoning or making an interrupted draft durable.
  let draft = "";
  let draftTruncated = false;
  onAction.onPartial = (delta) => {
    if (draftTruncated || typeof delta !== "string" || !delta) return;
    const next = `${draft}${delta}`;
    draftTruncated = Buffer.byteLength(next) > liveDraftMaxBytes;
    draft = truncateUtf8(next, liveDraftMaxBytes);
    tracker.setLiveText(`✍️ Writing a reply…\n${draft}`);
  };
  return onAction;
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
    revision: 0,
    artifactOutbox: null,
    artifactOutboxInvalid: false,
    replyOutbox: null,
    replyOutboxInvalid: false,
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
  const lifecycle = messageLifecycle.applyMessage({
    chatId: event.chatId,
    messageId: event.messageId,
    senderXid: event.senderXid,
    text: event.text,
    timestamp: event.timestamp,
  });
  if (!lifecycle.accepted) {
    protocol.releaseInbound(event);
    return;
  }
  // A delete can arrive on its independent op slot before the retained
  // message carrier. Deduplicate the carrier without ever exposing its body
  // to a model, bridge, or passive channel-context buffer.
  if (lifecycle.deleted) {
    await commitHistoryOnly(event);
    log("T3AMS_INBOUND_REDACTED", { chatId: event.chatId, messageId: event.messageId });
    return;
  }
  const effectiveText = lifecycle.text;
  const routed = normalizeT3amsInbound({
    conversationType: event.conversation.kind,
    senderXid: event.senderXid,
    senderName: event.senderName,
    workspaceId: event.conversation.wsId,
    channelId: event.conversation.channelIdHex,
    messageId: event.messageId,
    text: effectiveText,
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
        && typeof effectiveText === "string" && effectiveText.trim() !== "") {
      const stored = channelContext.append(event.chatId, {
        messageId: event.messageId,
        senderXid: event.senderXid,
        senderName: event.senderName,
        text: effectiveText,
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
    const sessionKey = agentSessionKeyForT3ams(routed.conversationKey, routed.message.threadRootId);
    const effectiveSessionKey = sessionKey ?? routed.conversationKey;
    // Abort the live process/HTTP work synchronously. The following durable
    // journal mutation may need disk I/O, and must not delay a user's stop.
    const mediaStopped = abortMediaAnalysesForSession(routed.conversationKey, effectiveSessionKey, "stopped by user");
    const ingressStopped = abortIngressTurnsForSession(routed.conversationKey, effectiveSessionKey, "stopped by user");
    const stopped = agentRuntime.stop(routed.conversationKey, effectiveSessionKey);
    const cancelled = await cancelUnfinishedIngressForSession(routed.conversationKey, effectiveSessionKey, "stopped by user");
    log("T3AMS_STOP_REQUESTED", {
      chatId: routed.conversationKey,
      stopped,
      mediaStopped,
      ingressStopped,
      cancelled: cancelled.cancelled,
      durable: cancelled.durable,
    });
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

const rerouteEditedIngress = (routed, text) => {
  const legacyMentionGate = routed.message.legacyMentionGate === true;
  const rerouted = normalizeT3amsInbound({
    conversationType: routed.message.conversationType,
    senderXid: routed.message.senderXid,
    senderName: routed.message.senderName,
    workspaceId: routed.message.workspaceId,
    channelId: routed.message.channelId,
    messageId: routed.message.messageId,
    text,
    threadRootId: routed.message.threadRootId,
    mentions: routed.message.mentions ?? [],
    attachments: routed.message.attachments ?? [],
    attachmentError: routed.message.attachmentError,
    channelContext: routed.message.channelContext ?? [],
  }, { xid: selfXidHex, aliases: [username, displayName] }, {
    // Old durable channel rows predate persisted structured mentions. They
    // reached the queue only after an earlier process accepted them, so keep
    // their existing routing eligibility through an edit rather than turning a
    // rolling upgrade into a silent cancellation. New entries retain mentions
    // and are still mention-gated normally.
    requireMentionInChannels: !legacyMentionGate,
  });
  if (rerouted.accepted && legacyMentionGate) rerouted.message.legacyMentionGate = true;
  return rerouted;
};

// Reconcile a retained edit/delete into work that has not finished yet. This
// runs under the same journal mutation queue as admission/ACKs, so an edited
// prompt cannot race a later bridge lease or direct-agent dispatch.
const reconcileQueuedIngressOperation = async (operation, lifecycle) => mutateIngress(async () => {
  if (!lifecycle.changed) return { changed: false, stopped: false, stoppedSessionKeys: [] };
  let changed = false;
  let stopped = false;
  // Agent runtime work is keyed by the native model session, rather than the
  // transport delivery chat.  A T3ams thread has a child session key, so an
  // edit/delete must cancel that exact process rather than leaving it running
  // (and potentially using private tools) behind an otherwise fenced reply.
  const stoppedSessionKeys = new Set();
  const noteStoppedTurn = (entry) => {
    abortMediaAnalysis(entry.id, lifecycle.deleted ? "message deleted" : "message updated");
    if (!runningIngress.has(entry.id)) return;
    stopped = true;
    if (entry.kind !== "turn") return;
    const sessionKey = agentSessionKeyForT3ams(
      entry.routed.conversationKey,
      entry.routed.message?.threadRootId,
    ) ?? entry.routed.conversationKey;
    stoppedSessionKeys.add(sessionKey);
    // Kill an already-started CLI process before waiting for the journal write
    // below. The outer reconciliation call repeats this harmlessly after a
    // successful persistence boundary for compatibility with older embeds.
    agentRuntime?.stop(entry.routed.conversationKey, sessionKey);
  };
  const removed = [];
  const invalidatedOutboxes = [];
  const revokedBridgeLanes = new Map();
  for (let index = ingress.length - 1; index >= 0; index -= 1) {
    const entry = ingress[index];
    const message = entry?.routed?.message;
    if (entry?.routed?.conversationKey !== operation.chatId || message?.messageId !== operation.messageId
        || message?.senderXid !== operation.senderXid || Number(entry.completedAt) > 0) continue;
    if (lifecycle.deleted) {
      noteStoppedTurn(entry);
      ingress.splice(index, 1);
      removed.push(entry);
      changed = true;
      continue;
    }
    const rerouted = rerouteEditedIngress(entry.routed, lifecycle.text ?? "");
    if (!rerouted.accepted) {
      noteStoppedTurn(entry);
      ingress.splice(index, 1);
      removed.push(entry);
      changed = true;
      continue;
    }
    entry.routed = rerouted;
    // The analysis is derived from the prior prompt/attachments. A new
    // revision must never reuse it, and the active request is aborted below.
    entry.mediaAnalysis = null;
    entry.mediaAnalysisRevision = null;
    if (entry.artifactOutbox != null || entry.artifactOutboxInvalid || entry.replyOutbox != null || entry.replyOutboxInvalid) {
      entry.artifactOutbox = null;
      entry.artifactOutboxInvalid = false;
      entry.replyOutbox = null;
      entry.replyOutboxInvalid = false;
      invalidatedOutboxes.push(entry.id);
    }
    // A task may already have snapshotted the prior route or be waiting for
    // media retrieval. Bump its generation so every phase checks out before
    // handing old text/files to a command, engine, or echo response.
    entry.revision = (Number(entry.revision) || 0) + 1;
    entry.retryAt = 0;
    // A bridge worker only owns a specific leased version of an inbound row.
    // Releasing the old lease forces a new poll of the edited prompt and, in
    // combination with claim-bound /send below, prevents an old worker from
    // replying after an edit or mention removal.
    if (entry.kind === "bridge" && entry.leaseId != null) {
      const turnContext = turnContextForRouted(entry.routed);
      revokedBridgeLanes.set(turnContext.laneKey, { turnContext, status: "✎ Message updated — restarting." });
      entry.leaseId = null;
      entry.leaseUntil = 0;
    }
    changed = true;
    noteStoppedTurn(entry);
  }
  if (!changed) return { changed: false, stopped: false, stoppedSessionKeys: [] };
  const saved = await persistCritical();
  if (saved) {
    for (const entry of removed) protocol.unpinConversation(entry.routed.conversationKey);
    for (const entry of removed) removeAgentArtifactOutbox(entry.id);
    for (const id of invalidatedOutboxes) removeAgentArtifactOutbox(id);
    for (const entry of removed) {
      if (entry.kind === "bridge" && entry.leaseId != null) {
        const turnContext = turnContextForRouted(entry.routed);
        revokedBridgeLanes.set(turnContext.laneKey, { turnContext, status: "🗑️ Message deleted." });
      }
    }
    for (const { turnContext, status } of revokedBridgeLanes.values()) {
      const { chatId } = turnContext;
      bridgeReplyThreads.delete(turnContext.laneKey);
      cancelBridgePendingEdit(turnContext.laneKey);
      disarmThinking(chatId, turnContext);
      void takeLivePlaceholder(chatId, turnContext).then((placeholder) => {
        if (placeholder == null) return;
        // This status belongs to the transport after it durably revoked the
        // worker's claim, not to that old worker. Explicitly bypass the
        // placeholder's lease guard so the stale turn cannot leave a forever
        // spinning message behind.
        return placeholder.handle.finalize(status, { guard: null });
      }).catch((error) => log("T3AMS_BRIDGE_REVOKE_FINALIZE_FAILED", { chatId, lane: turnContext.laneKey, error: String(error?.message ?? error) }));
    }
    knownChats.trim();
    ingressDurable = true;
    wakeBridge();
    pumpIngress();
  } else {
    // Freeze dispatch until this changed queue is durable. The retained op
    // will also replay after restart, but we must not run stale prompt bytes
    // in the current process while the local journal is uncertain.
    deferredIngressUnpins.push(...removed.map((entry) => entry.routed.conversationKey));
    deferredAgentArtifactOutboxCleanup.push(
      ...removed.map((entry) => entry.id),
      ...invalidatedOutboxes,
    );
    ingressDurable = false;
    scheduleIngressDurabilityRetry();
  }
  return { changed: true, stopped, stoppedSessionKeys: [...stoppedSessionKeys] };
});

const routeInboundOperation = async (operation) => {
  if (operation == null || !isAllowed(operation.senderXid)) return;
  const lifecycle = messageLifecycle.applyOperation(operation);
  if (!lifecycle.accepted || !lifecycle.changed) return;
  if (operation.conversation?.kind === "channel") {
    if (lifecycle.deleted || lifecycle.text === "") {
      channelContext.remove(operation.chatId, operation.messageId, { senderXid: operation.senderXid });
    } else if (lifecycle.text != null) {
      channelContext.replace(operation.chatId, operation.messageId, {
        senderXid: operation.senderXid,
        text: lifecycle.text,
      });
    }
  }
  const reconciled = await reconcileQueuedIngressOperation(operation, lifecycle);
  // A retained operation can precede its carrier, in which case it has no
  // journal row to mutate yet. Persist that bounded tombstone/edit explicitly
  // so a restart between the two retained subscriptions cannot resurrect the
  // old prompt or lose the user's newer text.
  if (!reconciled.changed) {
    const saved = await mutateIngress(async () => {
      const durable = await persistCritical();
      if (!durable) {
        ingressDurable = false;
        scheduleIngressDurabilityRetry();
        return false;
      }
      ingressDurable = true;
      return true;
    });
    if (!saved) log("T3AMS_MESSAGE_LIFECYCLE_PERSIST_PENDING", { chatId: operation.chatId, messageId: operation.messageId });
  }
  if (reconciled.stopped && agentRuntime != null) {
    // Older snapshots/embedders may not supply the newer session-key list;
    // retain the base-chat fallback for that compatibility edge.
    const sessionKeys = reconciled.stoppedSessionKeys?.length
      ? reconciled.stoppedSessionKeys
      : [operation.chatId];
    for (const sessionKey of sessionKeys) agentRuntime.stop(operation.chatId, sessionKey);
  }
  log("T3AMS_INBOUND_OPERATION_APPLIED", {
    kind: operation.kind,
    chatId: operation.chatId,
    messageId: operation.messageId,
    queued: reconciled.changed,
    ...(lifecycle.deleted ? { deleted: true } : { edited: true }),
  });
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
  // Some protocol features are only safe when their retained routes arrive as
  // a set. In particular a DM carrier without its edit/delete slot makes a
  // redaction race permanent, and a workspace discovery plane without its
  // notification route can strand membership/key updates. Admit a whole
  // group or none of it instead of consuming the final slot mid-pair.
  const subscribeGroup = (routes) => {
    const unique = [];
    const seen = new Set();
    for (const route of routes) {
      if (route == null || typeof route.id !== "string" || seen.has(route.id)) continue;
      seen.add(route.id);
      if (!desired.has(route.id)) unique.push(route);
    }
    if (desired.size + unique.length > subscriptionCap) {
      omitted += unique.length;
      return false;
    }
    for (const route of routes) {
      if (route == null || typeof route.id !== "string") continue;
      subscribe(route.id, route.topic, route.callback, route.accepts);
    }
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
    subscribeGroup([
      {
        id: planeId,
        topic: planeTopic,
        callback: (data) => {
          if (protocol.receiveWorkspacePlane(wsId, data)) syncSubscriptions();
        },
        accepts: planeChannelMatches,
      },
      {
        id: notificationId,
        topic: notificationTopic,
        callback: (data) => {
          if (protocol.receiveWorkspaceNotification(wsId, data)) syncSubscriptions();
        },
        accepts: (statement) => bytesEqual(asBytes(statement.channel), notificationTopic),
      },
    ]);
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
      const opsChannel = channel.isPrivate
        ? bcts.derivePrivateChannelOpsChannel(channelId)
        : bcts.derivePublicChannelOpsChannel(channelId);
      // Channel message/ops slots share the message topic family. Route an
      // authenticated operation separately so a late edit/delete can update
      // passive context or cancel a queued bot turn without becoming a model
      // prompt by itself.
      subscribe(id, topic, (data, statement) => {
        const actual = asBytes(statement.channel);
        if (bytesEqual(actual, messageChannel)) return routeInbound(protocol.receiveChannel(wsId, channel.idHex, data));
        if (bytesEqual(actual, opsChannel)) return routeInboundOperation(protocol.receiveChannelOperation(wsId, channel.idHex, data));
        return undefined;
      }, (statement) => {
        const actual = asBytes(statement.channel);
        return bytesEqual(actual, messageChannel) || bytesEqual(actual, opsChannel);
      });
    }
  }
  for (const peerXidHex of protocol.peerIds()) {
    const peer = hexToBytes(peerXidHex);
    const dmChannel = bcts.derivePersonalDMChannel(identity.xid, peer);
    // The pairwise topic is keyed by the remote peer. Using our own XID here
    // would subscribe to the wrong half of the DM channel and miss replies.
    const dmRoutes = [
      { id: `dm:${peerXidHex}`, channel: dmChannel, message: true },
      { id: `dmops:${peerXidHex}`, channel: bcts.derivePersonalDMOpsChannel(identity.xid, peer), message: false },
    ];
    subscribeGroup(dmRoutes.map((route) => ({
      id: route.id,
      topic: bcts.createDMTopics(route.channel, peer, true)[0],
      callback: (data) => route.message
        ? routeInbound(protocol.receiveDm(peerXidHex, data))
        : routeInboundOperation(protocol.receiveDmOperation(peerXidHex, data)),
      accepts: (statement) => bytesEqual(asBytes(statement.channel), route.channel),
    })));
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
let t3amsMediaAnalyzer;
try {
  t3amsMediaAnalyzer = createT3amsMediaAnalyzer({
    endpoint: t3amsMediaAnalyzerUrl,
    token: t3amsMediaAnalyzerToken,
    allowedHttpHosts: t3amsMediaAnalyzerHttpHosts,
    maxFiles: t3amsMediaAnalyzerMaxFiles,
    maxFileBytes: t3amsMediaAnalyzerMaxFileBytes,
    maxTotalBytes: t3amsMediaAnalyzerMaxTotalBytes,
    timeoutMs: t3amsMediaAnalyzerTimeoutMs,
    maxPromptBytes: t3amsMediaAnalyzerMaxPromptBytes,
    maxSummaryBytes: t3amsMediaAnalyzerMaxSummaryBytes,
    maxConcurrent: t3amsMediaAnalyzerMaxConcurrent,
    maxQueued: t3amsMediaAnalyzerMaxQueued,
    log,
  });
} catch (error) {
  console.error(`T3ams media analyzer configuration is invalid: ${String(error?.message ?? error)}`);
  process.exit(2);
}
if (t3amsMediaAnalyzer.enabled) {
  log("T3AMS_MEDIA_ANALYZER_ENABLED", {
    maxFiles: t3amsMediaAnalyzer.limits.maxFiles,
    maxFileBytes: t3amsMediaAnalyzer.limits.maxFileBytes,
    maxTotalBytes: t3amsMediaAnalyzer.limits.maxTotalBytes,
    maxConcurrent: t3amsMediaAnalyzer.limits.maxConcurrent,
    maxQueued: t3amsMediaAnalyzer.limits.maxQueued,
  });
}
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
fileCommandHandlerForTurn = (turnContext) => createFileCommandHandler({
  fileStore,
  sendAttachment: async (_namespace, payload) => sendT3amsAttachment(turnContext.chatId, {
    ...payload,
    turnContext,
  }),
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
// Message carriers and their edit/delete operations are retained on separate
// slots and can replay in either order. Keep a bounded local lifecycle index
// so a redacted or edited prompt/context row is reconciled before dispatch.
messageLifecycle = createT3amsMessageLifecycle({
  maxRecords: numberEnv("BOT_T3AMS_MESSAGE_LIFECYCLE_MAX_RECORDS", Math.max(1_024, ingressCap * 4), { min: 128, max: 100_000 }),
  ttlMs: numberEnv("BOT_T3AMS_MESSAGE_LIFECYCLE_TTL_MS", 6 * 60 * 60_000, { min: 0, max: 31 * 24 * 3_600_000 }),
  maxTextBytes: MAX_T3AMS_TEXT_BYTES,
  maxStateBytes: numberEnv("BOT_T3AMS_MESSAGE_LIFECYCLE_MAX_BYTES", 8 * 1024 * 1024, { min: 1024, max: 64 * 1024 * 1024 }),
  initialSnapshot: restored?.messageLifecycle ?? null,
});
// Top-level channel prompts share the channel's native session; each thread
// has its own derived session. Let ordinary members invoke the bot, but do not
// let one member silently reset or reconfigure a group-visible channel/thread
// session. `/stop` remains available to the group as a liveness lever.
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

// Direct-engine setup mirrors the existing transport. Every DM/channel has an
// isolated native session, and a threaded turn receives a further stable
// session key so unrelated threads cannot share model memory. Delivery stays
// on the base conversation key and therefore still replies in the right UI
// thread.
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
// A public direct bot receives hostile prompts and attachments. Claude's OAuth
// login lives in its home directory, so an agent process with filesystem or
// shell tools could read/exfiltrate its own credentials. Keep the public
// built-in profile text-only until an operator supplies a separately isolated
// tool runtime. A custom command is an explicit operator-managed boundary and
// is deliberately left to that command's own sandbox policy.
const aiAllowedTools = String(env.BOT_AI_ALLOWED_TOOLS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const aiSkipPermissions = env.BOT_AI_SKIP_PERMISSIONS === "1";
// All public direct engines consume an operator-funded resource, including an
// explicitly sandboxed custom command. Keep their default turn budget small;
// a private allowlist retains the historical defaults below.
const publicDirectAgent = engine != null && publicTofuEnrollment;
const publicBuiltInDirectAgent = publicDirectAgent && !customCmd;
if (publicBuiltInDirectAgent && brain !== "claude") {
  console.error("Public direct bots currently support only Claude's hardened no-tools profile; use a private allowlist or an externally isolated bridge runtime for other engines");
  process.exit(2);
}
if (publicBuiltInDirectAgent && aiSkipPermissions) {
  console.error("BOT_AI_SKIP_PERMISSIONS=1 is not allowed for a public direct bot; use the default no-tools profile or an externally isolated runtime");
  process.exit(2);
}
if (publicBuiltInDirectAgent && aiAllowedTools.length > 0) {
  console.error("BOT_AI_ALLOWED_TOOLS must be empty for a public direct bot; attachment/tool analysis requires an externally isolated runtime");
  process.exit(2);
}
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
// Do not hand an agent a writable output directory unless every generated
// file can actually be delivered. Without this gate, a disabled Bulletin
// endpoint or a MIME policy that rejects generic files would create a durable
// retry loop that blocks the conversation forever.
const agentArtifactDeliveryEnabled = agentOutputArtifactMaxCount > 0
  && attachmentMaxCount > 0
  && t3amsMedia.enabled
  && isT3amsAttachmentMimeAllowed(attachmentOptions.allowedMimeTypes, "application/octet-stream");
const effectiveAgentOutputArtifactMaxCount = agentArtifactDeliveryEnabled ? agentOutputArtifactMaxCount : 0;
if (engine != null && !agentArtifactDeliveryEnabled && agentOutputArtifactMaxCount > 0) {
  log("T3AMS_AGENT_ARTIFACTS_DISABLED", {
    mediaEnabled: t3amsMedia.enabled,
    attachmentMaxCount,
    genericMimeAllowed: isT3amsAttachmentMimeAllowed(attachmentOptions.allowedMimeTypes, "application/octet-stream"),
  });
}
const renderT3amsForBrain = (message) => {
  const sender = message.senderName || message.senderXid || "unknown sender";
  const scope = message.conversationType === "channel"
    ? `channel ${message.workspaceId}/${message.channelId}`
    : "direct message";
  const thread = message.threadRootId ? `; thread ${message.threadRootId}` : "";
  const claudeCanInspectStagedFiles = brain !== "claude"
    || customCmd
    || aiSkipPermissions
    || aiAllowedTools.some((tool) => /^(?:read|bash)(?:\(|$)/i.test(tool));
  const analyzedAttachments = new Map((message.mediaAnalysis?.results ?? [])
    .filter((result) => result?.status === "analyzed" && Number.isSafeInteger(result.index) && typeof result.summary === "string" && result.summary)
    .map((result) => [result.index, result]));
  const attachmentNotes = (message.attachments ?? []).map((attachment, index) => {
    const noun = attachment.kind === "image"
      ? "photo"
      : attachment.kind === "video"
        ? "video"
        : attachment.kind === "audio"
          ? "audio file"
          : "document";
    const size = attachment.size >= 1024 * 1024
      ? `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(attachment.size / 1024))} KB`;
    const duration = attachment.durationMs == null ? "" : `; ${(attachment.durationMs / 1000).toFixed(1)}s`;
    // The private cache path is deliberately content-addressed, so it does
    // not preserve the sender-visible filename. Keep that validated filename
    // beside the usable path: it is often the only clue for an otherwise
    // opaque document (for example, an unknown browser File.type).
    const analysis = analyzedAttachments.get(index);
    if (analysis != null) {
      // The worker's output is a bounded visual/text summary, not a trusted
      // instruction. Delimit it separately from the user prompt so even a
      // tool-capable private engine does not mistake document text for a task.
      return renderUntrustedAttachmentAnalysis({
        index,
        filename: attachment.filename,
        mime: attachment.mime,
        summary: analysis.summary,
      });
    }
    return attachment.downloaded && attachment.path && claudeCanInspectStagedFiles
      ? `[User attached a ${noun} saved at ${attachment.path} (${attachment.filename}; ${attachment.mime}, ${size}${duration})]`
      : attachment.downloaded && attachment.path
        ? `[User attached a ${noun} (${attachment.filename}; ${attachment.mime}, ${size}${duration}) — bytes are staged but deliberately unavailable to this no-tools agent. Do not claim to have inspected them.]`
      : `[User attached a ${noun} (${attachment.filename}; ${attachment.mime}, ${size}${duration}) — file bytes are unavailable: ${attachment.error ?? "download is not configured"}]`;
  });
  if (message.attachmentError) attachmentNotes.push(`[Attachment warning: ${message.attachmentError}]`);
  const contextNotes = (message.channelContext ?? []).map((record) => {
    const name = record.senderName || record.senderXid || "channel member";
    const thread = record.threadRootId ? `; thread ${record.threadRootId}` : "";
    return `[Earlier channel message from ${name}${thread}]: ${record.text}`;
  });
  const claudeCanWriteArtifacts = brain !== "claude"
    || customCmd
    || aiSkipPermissions
    || aiAllowedTools.some((tool) => /^(?:bash|edit|write)(?:\(|$)/i.test(tool));
  const outputInstruction = message.outputDir == null || !claudeCanWriteArtifacts
    ? null
    : `[To return a generated file to the user, write up to ${effectiveAgentOutputArtifactMaxCount} regular files directly inside ${message.outputDir}. Do not create subdirectories or symlinks; only those top-level files will be attached to your reply.]`;
  // The runtime owns the conversation/thread session key. Include the
  // authenticated sender and scope so a direct brain can distinguish
  // participants without changing the transport-neutral message API.
  return [`[T3ams ${scope}; sender ${sender}${thread}]`, ...contextNotes, message.text, ...attachmentNotes, outputInstruction].filter(Boolean).join("\n");
};
if (engine != null) {
  const directCapacityDefaults = t3amsDirectCapacityDefaults({ publicDirect: publicDirectAgent });
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
        allowedTools: aiAllowedTools,
        skipPermissions: aiSkipPermissions,
        // With no configured tools (always the public profile), do not load
        // user/project plugins, MCP servers, hooks, or slash commands that
        // could reintroduce a capability outside the explicit CLI boundary.
        safeMode: brain === "claude" && (publicBuiltInDirectAgent || aiAllowedTools.length === 0),
      }),
    workspace: aiWorkspace,
    workspaces,
    model: aiModel,
    allowedModels: aiAllowedModels,
    reasoning: aiReasoning,
    idleMs: numberEnv("BOT_AI_IDLE_TIMEOUT_MS", 600_000, { min: 1000, max: 7 * 86_400_000 }),
    maxMs: numberEnv("BOT_AI_MAX_MS", 3_600_000, { min: 1000, max: 7 * 86_400_000 }),
    maxConcurrentTurns: numberEnv("BOT_AI_MAX_CONCURRENT_TURNS", directCapacityDefaults.maxConcurrentTurns, { min: 1, max: 128 }),
    maxQueuedTurns: numberEnv("BOT_AI_MAX_QUEUED_TURNS", directCapacityDefaults.maxQueuedTurns, { min: 0, max: 10_000 }),
    maxOutputBytes: aiMaxOutputBytes,
    maxOutputArtifacts: effectiveAgentOutputArtifactMaxCount,
    maxOutputArtifactBytes: attachmentMaxBytes,
    maxOutputArtifactTotalBytes: agentOutputArtifactMaxTotalBytes,
    peerCap: knownChatCap,
    agentUid: aiAgentUid,
    agentGid: aiAgentGid,
    renderMessage: renderT3amsForBrain,
    chat: {
      sendText: sendAgentReply,
      deliver: deliverAgentReply,
      deliverArtifacts: deliverAgentArtifacts,
      deliverTurn: deliverAgentTurn,
      beginTurn: beginTurnProgress,
    },
    throwOnReplyFailure: true,
    username,
    chainConnected: isChainConnected,
    log,
    persist,
  });
  agentRuntime.noteRestoredAgent(restored?.agent ?? null);
  if (publicDirectAgent) {
    log("T3AMS_PUBLIC_DIRECT_CAPACITY", agentRuntime.queueStats());
  }
  agentRuntime.restoreIntroduced(Array.isArray(restored?.agentIntroduced)
    ? restored.agentIntroduced.slice(-(knownChatCap + ingressCap))
    : []);
  // A current snapshot contains at most the bounded known-chat index plus
  // its bounded durable ingress overflow. Cap legacy/corrupt state too.
  const restoredAgentPeers = Array.isArray(restored?.agentPeers)
    ? restored.agentPeers.slice(-(knownChatCap + ingressCap))
    : [];
  for (const entry of restoredAgentPeers) {
    if (typeof entry?.chatId !== "string") continue;
    const sessionKey = typeof entry.sessionKey === "string" ? entry.sessionKey : entry.chatId;
    const chatId = conversationForAgentSessionKey(sessionKey);
    if (chatId == null || chatId !== entry.chatId || !knownChats.note(chatId)) continue;
    agentRuntime.restorePeer(sessionKey, entry);
  }
}

// Direct brains consume journal entries through the normal keyed dispatcher.
// The entry stays durable until the turn completes, yielding at-least-once
// processing after a crash rather than a prompt silently disappearing.
const runningIngress = new Set();
// One controller spans every pre-agent phase of a direct turn. The worker
// request is only one cancellation point: /stop or an authenticated
// edit/delete must also fence the tiny gap between a completed media request
// and a later CLI dispatch.
const activeIngressTurns = new Map(); // ingress id -> { controller, chatId, sessionKey }
const abortIngressTurn = (entryId, reason = "ingress turn cancelled") => {
  const active = activeIngressTurns.get(entryId);
  if (active == null) return false;
  if (!active.controller.signal.aborted) active.controller.abort(new Error(reason));
  return true;
};
const ingressSessionKey = (entry) => agentSessionKeyForT3ams(
  entry?.routed?.conversationKey,
  entry?.routed?.message?.threadRootId,
) ?? entry?.routed?.conversationKey;
const abortIngressTurnsForSession = (chatId, sessionKey, reason = "ingress turn cancelled") => {
  let count = 0;
  for (const [entryId, active] of activeIngressTurns) {
    if (active.chatId !== chatId || active.sessionKey !== sessionKey) continue;
    if (abortIngressTurn(entryId, reason)) count += 1;
  }
  return count;
};
// Sidecar analysis is outside agent-runtime's child-process queue, so retain
// an explicit cancellation handle for /stop and authenticated edit/delete
// reconciliation. It is memory-only because a process exit ends the HTTP
// request; the durable ingress revision/cache handles the restart boundary.
const activeMediaAnalyses = new Map(); // ingress id -> { controller, chatId, sessionKey }
const abortMediaAnalysis = (entryId, reason = "media analysis cancelled") => {
  const active = activeMediaAnalyses.get(entryId);
  if (active != null) activeMediaAnalyses.delete(entryId);
  // The media controller is intentionally the same full-turn controller, so
  // this also prevents the old prompt reaching the brain after the HTTP call
  // has resolved but before the next revision check.
  const stopped = abortIngressTurn(entryId, reason);
  if (active != null && !active.controller.signal.aborted) active.controller.abort(new Error(reason));
  return active != null || stopped;
};
const abortMediaAnalysesForSession = (chatId, sessionKey, reason = "media analysis cancelled") => {
  let count = 0;
  for (const [entryId, active] of activeMediaAnalyses) {
    if (active.chatId !== chatId || active.sessionKey !== sessionKey) continue;
    if (abortMediaAnalysis(entryId, reason)) count += 1;
  }
  return count;
};
// /stop is intercepted ahead of the per-chat queue. Make that cancellation
// durable too: merely killing an in-memory HTTP request leaves the old journal
// row eligible to run again as soon as its worker slot is released. Completed
// reply outboxes are deliberately retained; their model work is already done
// and this command should not erase an answer that is only awaiting delivery.
const cancelUnfinishedIngressForSession = async (chatId, sessionKey, reason = "stopped by user") => mutateIngress(async () => {
  const removed = [];
  for (let index = ingress.length - 1; index >= 0; index -= 1) {
    const entry = ingress[index];
    if (entry?.kind !== "turn" || entry.routed?.conversationKey !== chatId
        || ingressSessionKey(entry) !== sessionKey || Number(entry.completedAt) > 0 || entry.replyOutbox != null) continue;
    abortMediaAnalysis(entry.id, reason);
    abortIngressTurn(entry.id, reason);
    removed.push(entry);
    ingress.splice(index, 1);
  }
  if (removed.length === 0) return { cancelled: 0, durable: true };
  const saved = await persistCritical();
  if (saved) {
    for (const entry of removed) {
      protocol.unpinConversation(entry.routed.conversationKey);
      removeAgentArtifactOutbox(entry.id);
    }
    knownChats.trim();
    ingressDurable = true;
    return { cancelled: removed.length, durable: true };
  }
  // Match edit/delete reconciliation: keep the in-memory removal so the
  // stopped prompt cannot execute in this process, and let the durable retry
  // commit it when storage recovers. A crash before then is the unavoidable
  // at-least-once boundary, but never a reason to keep working right now.
  deferredIngressUnpins.push(...removed.map((entry) => entry.routed.conversationKey));
  deferredAgentArtifactOutboxCleanup.push(...removed.map((entry) => entry.id));
  ingressDurable = false;
  scheduleIngressDurabilityRetry();
  return { cancelled: removed.length, durable: false };
});
const persistMediaAnalysisForIngress = async (entryId, revision, analysis) => mutateIngress(async () => {
  const current = ingress.find((candidate) => candidate.id === entryId);
  if (current == null || ingressRevision(current) !== revision) return "superseded";
  current.mediaAnalysis = analysis;
  current.mediaAnalysisRevision = revision;
  const saved = await persistCritical();
  if (!saved) {
    ingressDurable = false;
    scheduleIngressDurabilityRetry();
    return false;
  }
  ingressDurable = true;
  return true;
});
const ingressRevision = (entry) => Number.isSafeInteger(entry?.revision) && entry.revision >= 0 ? entry.revision : 0;
const ingressEntryCurrent = (id, revision) => ingress.some((candidate) => candidate.id === id && ingressRevision(candidate) === revision);
const completeIngressTurn = async (entry, expectedRevision) => mutateIngress(async () => {
  const index = ingress.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0 || ingressRevision(ingress[index]) !== expectedRevision) return "superseded";
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
    removeAgentArtifactOutbox(removed.id);
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
const deadLetterIngressTurn = async (entry, error, expectedRevision) => mutateIngress(async () => {
  const index = ingress.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0 || ingressRevision(ingress[index]) !== expectedRevision) return "superseded";
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
    removeAgentArtifactOutbox(removed.id);
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
const deferIngressTurn = async (entry, error, expectedRevision) => {
  const delay = await mutateIngress(async () => {
    const current = ingress.find((candidate) => candidate.id === entry.id);
    if (current == null || ingressRevision(current) !== expectedRevision) return null;
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
const executeIngressTurn = async (entry, expectedRevision) => {
  if (!ingressEntryCurrent(entry.id, expectedRevision)) return null;
  if (entry.artifactOutboxInvalid || entry.replyOutboxInvalid) {
    throw artifactOutboxError("T3AMS_AGENT_OUTBOX_CORRUPT", "generated-turn outbox metadata is invalid");
  }
  const routed = entry.routed;
  const turnContext = turnContextForRouted(routed);
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
    // This affects only native model/session state. The delivery target stays
    // `routed.conversationKey`, so replies and typing remain in the same
    // T3ams thread/channel lane.
    sessionKey: turnContext.laneKey,
    // This opaque route is never included in the model prompt. It travels
    // only through the direct runtime's optional callback context, fencing
    // progress, replies, and generated artifacts to this exact thread lane.
    deliveryContext: turnContext,
    ...(Array.isArray(routed.message.attachments) ? { attachments: routed.message.attachments } : {}),
    ...(typeof routed.message.attachmentError === "string" ? { attachmentError: routed.message.attachmentError } : {}),
    ...(Array.isArray(routed.message.channelContext) ? { channelContext: routed.message.channelContext } : {}),
  };
  const turnController = new AbortController();
  activeIngressTurns.set(entry.id, {
    controller: turnController,
    chatId: routed.conversationKey,
    sessionKey: message.sessionKey,
  });
  const turnCurrent = () => !turnController.signal.aborted && ingressEntryCurrent(entry.id, expectedRevision);
  const hadPrevious = activeReplyThreads.has(turnContext.laneKey);
  const previous = activeReplyThreads.get(turnContext.laneKey);
  activeReplyThreads.set(turnContext.laneKey, turnContext.threadRootId);
  try {
    const commandInput = typeof message.commandText === "string" ? message.commandText : message.text;
    if (agentRuntime != null && /^\/stop\s*$/i.test(commandInput)) {
      // The cancellation was durably applied as soon as this authenticated
      // inbound command arrived. Do not download its attachments or wait for
      // a sidecar queue merely to deliver the ordered confirmation.
      if (!turnCurrent()) return null;
      await sendAgentReply(routed.conversationKey, "⏹️ Stopped any active work for this conversation.", turnContext);
      return turnCurrent() ? expectedRevision : null;
    }
    // A complete persisted handoff means the model already ran. Drain the
    // exact files/text/chunks only; this is the key recovery boundary that
    // prevents a failed final delivery from rerunning tools or Claude.
    if (entry.replyOutbox != null) {
      const priorArtifactContext = activeAgentArtifactDeliveries.get(turnContext.laneKey);
      const artifactContext = { id: entry.id, revision: expectedRevision, turnContext };
      activeAgentArtifactDeliveries.set(turnContext.laneKey, artifactContext);
      try {
        await deliverPersistedAgentTurn(routed.conversationKey, artifactContext, {
          artifacts: entry.artifactOutbox,
          reply: entry.replyOutbox,
        });
      } finally {
        if (priorArtifactContext == null) activeAgentArtifactDeliveries.delete(turnContext.laneKey);
        else activeAgentArtifactDeliveries.set(turnContext.laneKey, priorArtifactContext);
      }
      return turnCurrent() ? expectedRevision : null;
    }
    let attachmentProgress = null;
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      // Attachment retrieval precedes the agent process. Start the same live
      // turn before it begins so a photo/PDF never looks ignored while its
      // encrypted bytes are claimed and verified; later CLI tool actions join
      // this one deferred tracker rather than replacing its history.
      attachmentProgress = agentRuntime == null
        ? null
        : beginTurnProgress(routed.conversationKey, turnContext);
      message.attachments = await fetchT3amsAttachments(message.attachments, {
        onProgress: attachmentProgress,
      });
    }
    if (!turnCurrent()) return null;
    const fileResult = await handleT3amsFileCommand(routed.conversationKey, message, turnContext);
    if (fileResult?.handled) {
      if (!turnCurrent()) return null;
      if (fileResult.reply) await sendAgentReply(routed.conversationKey, fileResult.reply, turnContext);
      return expectedRevision;
    }
    if (brain === "echo") {
      if (!turnCurrent()) return null;
      await sendAgentReply(routed.conversationKey, `Echo: ${message.text}`, turnContext);
      return expectedRevision;
    }
    if (agentRuntime == null) throw new Error("no direct T3ams agent runtime is configured");
    if (stateChangingChannelCommand(commandInput) && !canControlChannel(message)) {
      const label = channelControlRole === "mod" ? "a workspace moderator" : "a workspace owner or admin";
      if (!turnCurrent()) return null;
      await sendAgentReply(routed.conversationKey, `Only ${label} can change this channel bot's session settings.`, turnContext);
      return expectedRevision;
    }
    const cachedMediaAnalysis = entry.mediaAnalysisRevision === expectedRevision
      ? restoreMediaAnalysis(entry.mediaAnalysis)
      : null;
    if (cachedMediaAnalysis != null) {
      // A complete result is reused after retry/restart. A recovered
      // `submitted` marker intentionally remains metadata-only: the prior
      // process may have reached the external provider just before it died.
      message.mediaAnalysis = cachedMediaAnalysis;
    } else if (t3amsMediaAnalyzer.enabled && Array.isArray(message.attachments)
        // Agent-runtime resolves command-shaped text locally (including
        // unknown slash commands), so do not spend an external-analysis token
        // on an attachment that cannot reach the model in the first place.
        && !/^\/[a-z][a-z0-9_-]*(?:\s+\S+)?\s*$/i.test(commandInput)) {
      const hasAnalyzableAttachment = message.attachments.some((attachment) => {
        if (!attachment?.downloaded || typeof attachment.path !== "string") return false;
        const size = Number(attachment.size);
        if (!Number.isSafeInteger(size) || size < 0 || size > t3amsMediaAnalyzer.limits.maxFileBytes) return false;
        try { return mediaAnalyzerKind(attachment.mime) != null; }
        catch { return false; }
      });
      if (hasAnalyzableAttachment) {
        // Run only after native file commands and session-control commands
        // have short-circuited. Reserve one durable global+sender token before
        // making an external request. `begin…` writes either a durable budget
        // result or the at-most-once `submitted` state first.
        const reservation = await beginMediaAnalysisForIngress(entry.id, expectedRevision, message.senderXid);
        if (!turnCurrent() || reservation.status === "superseded") return null;
        if (!reservation.durable) throw new Error("media analysis budget could not be persisted");
        if (!reservation.allowed) {
          log("T3AMS_MEDIA_ANALYZER_BUDGET", { reason: reservation.reason, retryAfterMs: reservation.retryAfterMs });
          message.mediaAnalysis = restoreMediaAnalysis(entry.mediaAnalysis) ?? compactMediaAnalysis(null, "budget");
        } else {
          const analysisProgress = attachmentProgress ?? beginTurnProgress(routed.conversationKey, turnContext);
          activeMediaAnalyses.set(entry.id, {
            controller: turnController,
            chatId: routed.conversationKey,
            sessionKey: message.sessionKey,
          });
          let analysis;
          try {
            const result = await t3amsMediaAnalyzer.analyze({
              attachments: message.attachments,
              prompt: message.text,
              onProgress: analysisProgress,
              // Stable only within this ingress revision. It is useful for
              // sidecar correlation without persisting a provider request id
              // or relying on a provider-specific idempotency contract.
              requestId: `${entry.id}-${expectedRevision.toString(16)}`,
              signal: turnController.signal,
            });
            analysis = compactMediaAnalysis(result, "complete");
          } catch (error) {
            if (!turnCurrent()) return null;
            log("T3AMS_MEDIA_ANALYZER_FAILED", { error: String(error?.message ?? error).slice(0, 180) });
            analysis = compactMediaAnalysis(null, "unavailable");
          } finally {
            const active = activeMediaAnalyses.get(entry.id);
            if (active?.controller === turnController) activeMediaAnalyses.delete(entry.id);
          }
          if (!turnCurrent()) return null;
          const persisted = await persistMediaAnalysisForIngress(entry.id, expectedRevision, analysis);
          if (persisted === "superseded" || !turnCurrent()) return null;
          if (persisted !== true) throw new Error("media analysis result could not be persisted");
          message.mediaAnalysis = analysis;
        }
      }
    }
    if (!turnCurrent()) return null;
    const priorArtifactContext = activeAgentArtifactDeliveries.get(turnContext.laneKey);
    const artifactContext = { id: entry.id, revision: expectedRevision, turnContext };
    activeAgentArtifactDeliveries.set(turnContext.laneKey, artifactContext);
    let handled;
    try {
      handled = await agentRuntime.handleMessage(routed.conversationKey, message);
    } finally {
      if (priorArtifactContext == null) activeAgentArtifactDeliveries.delete(turnContext.laneKey);
      else activeAgentArtifactDeliveries.set(turnContext.laneKey, priorArtifactContext);
    }
    if (!turnCurrent()) return null;
    if (handled !== true) throw new Error("agent turn was interrupted before completion");
    return expectedRevision;
  } finally {
    const activeTurn = activeIngressTurns.get(entry.id);
    if (activeTurn?.controller === turnController) activeIngressTurns.delete(entry.id);
    if (hadPrevious) activeReplyThreads.set(turnContext.laneKey, previous);
    else activeReplyThreads.delete(turnContext.laneKey);
  }
};
pumpIngress = () => {
  if (!ingressDurable) return;
  const current = Date.now();
  const blockedLanes = new Set();
  let nextRetryAt = null;
  for (const entry of ingress) {
    if (entry.kind !== "turn") continue;
    const laneKey = ingressLaneForEntry(entry);
    if (blockedLanes.has(laneKey)) continue;
    if (runningIngress.has(entry.id)) {
      blockedLanes.add(laneKey);
      continue;
    }
    if (Number(entry.retryAt) > current) {
      blockedLanes.add(laneKey);
      nextRetryAt = nextRetryAt == null ? entry.retryAt : Math.min(nextRetryAt, entry.retryAt);
      continue;
    }
    const scheduledRevision = ingressRevision(entry);
    const task = dispatcher.run(laneKey, async () => {
      try {
        let completedRevision = scheduledRevision;
        if (!Number.isSafeInteger(entry.completedAt) || entry.completedAt <= 0) {
          completedRevision = await executeIngressTurn(entry, scheduledRevision);
        }
        if (completedRevision == null) return;
        const completion = await completeIngressTurn(entry, completedRevision);
        if (completion === "superseded") return;
        if (completion !== true) throw new Error("ingress completion is not durable yet");
      } catch (error) {
        // A concurrent authenticated edit/delete supersedes the old task. It
        // must not turn an aborted old prompt into a retry delay or a dead
        // letter for the revised durable entry.
        if (!ingressEntryCurrent(entry.id, scheduledRevision)) return;
        if (isTerminalIngressError(error) && await deadLetterIngressTurn(entry, error, scheduledRevision) === true) return;
        await deferIngressTurn(entry, error, scheduledRevision);
        throw error;
      }
    });
    if (task == null) {
      log("T3AMS_DISPATCH_BACKPRESSURE", dispatcher.stats());
      scheduleIngressPump(100);
      break;
    }
    runningIngress.add(entry.id);
    blockedLanes.add(laneKey);
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
  // One framework turn per native thread/session lane at a time. The live
  // placeholder and reply-root state use that same key, so workers in two
  // channel threads can safely overlap without cross-finalizing a bubble.
  const occupiedLanes = new Set(ingress
    .filter((entry) => entry.kind === "bridge" && Number(entry.leaseUntil) > current)
    .map((entry) => ingressLaneForEntry(entry)));
  for (const entry of ingress) {
    if (leased.length >= limit) break;
    if (entry.kind !== "bridge" || Number(entry.leaseUntil) > current) continue;
    const laneKey = ingressLaneForEntry(entry);
    if (occupiedLanes.has(laneKey)) continue;
    entry.leaseId = randomUUID();
    entry.leaseUntil = current + leaseMs;
    const pending = bridgePendingEdits.get(laneKey);
    if (pending != null && (pending.deliveryId !== entry.id || pending.leaseId !== entry.leaseId)) {
      cancelBridgePendingEdit(laneKey, pending);
    }
    leased.push(entry);
    occupiedLanes.add(laneKey);
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
    const turnContext = bindLiveReplyTarget(turnContextForRouted(entry.routed));
    const guard = () => bridgeLeaseIsActive(chatId, entry.id, entry.leaseId);
    bridgeReplyThreads.set(turnContext.laneKey, turnContext.threadRootId);
    bestEffortTyping(chatId, { guard });
    armThinking(chatId, { guard, turnContext });
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
  const current = Date.now();
  let changed = 0;
  for (const claim of claims) {
    if (claim == null || typeof claim.delivery_id !== "string" || typeof claim.lease_id !== "string") continue;
    // ACK and renewal are themselves privileged lease operations. An expired
    // worker must not be able to resurrect or consume a turn before a newer
    // worker gets to poll it.
    const index = ingress.findIndex((entry) => entry.id === claim.delivery_id
      && entry.leaseId === claim.lease_id
      && Number(entry.leaseUntil) > current);
    if (index < 0) continue;
    if (acknowledge) acknowledged.push(...ingress.splice(index, 1));
    else ingress[index].leaseUntil = current + leaseMs;
    changed += 1;
  }
  if (changed === 0) return { changed: 0, durable: true };
  const saved = await persistCritical();
  if (saved) {
    for (const entry of acknowledged) protocol.unpinConversation(entry.routed.conversationKey);
    for (const entry of acknowledged) {
      const chatId = entry.routed.conversationKey;
      const turnContext = turnContextForRouted(entry.routed);
      const stillLeased = ingress.some((candidate) => candidate.kind === "bridge"
        && ingressLaneForEntry(candidate) === turnContext.laneKey
        && Number(candidate.leaseUntil) > Date.now());
      if (!stillLeased) {
        bridgeReplyThreads.delete(turnContext.laneKey);
        disarmThinking(chatId, turnContext);
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
  const pendingClaims = [];
  const current = Date.now();
  for (const claim of claims) {
    if (claim == null || typeof claim.delivery_id !== "string" || typeof claim.lease_id !== "string") continue;
    const entry = ingress.find((candidate) => candidate.kind === "bridge"
      && candidate.id === claim.delivery_id
      && candidate.leaseId === claim.lease_id
      && Number(candidate.leaseUntil) > current);
    if (entry != null) pendingClaims.push(entry);
  }
  for (const entry of pendingClaims) {
    const chatId = entry.routed.conversationKey;
    const turnContext = turnContextForRouted(entry.routed);
    const edit = bridgePendingEdits.get(turnContext.laneKey);
    // A lane may be re-leased after a worker expires. Never let the old
    // worker's ACK promote a frame belonging to a different claim.
    if (edit == null || edit.deliveryId !== entry.id || edit.leaseId !== entry.leaseId
        || !bridgePendingEditIsActive(turnContext.laneKey, edit)) continue;
    const placeholder = await takeLivePlaceholder(chatId, turnContext);
    // `takeLivePlaceholder` can await its delayed creation; the lease may
    // have changed while it did so. Do not even retire a placeholder on
    // behalf of an old worker.
    if (!bridgePendingEditIsActive(turnContext.laneKey, edit)) continue;
    if (placeholder != null && bareHex(placeholder.handle.messageId) !== bareHex(edit.messageId)) {
      // The framework chose to stream an earlier bot message rather than the
      // current placeholder. Retire the placeholder so it never dangles.
      // This is transport cleanup for a mismatched older placeholder, not a
      // frame authored by the current/old bridge worker. Its original lease
      // may already be stale after a re-lease, so it must not retain that
      // default guard and leave the bubble dangling.
      await placeholder.handle.finalize("✓", { guard: null });
    }
    await liveReplies.finalizeExisting(turnContext.laneKey, edit.messageId, edit.text, {
      guard: () => bridgePendingEditIsActive(turnContext.laneKey, edit),
    });
    cancelBridgePendingEdit(turnContext.laneKey, edit);
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
const requestHeader = (request, name) => {
  const raw = request.headers[name];
  return Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
};
const tokenMatches = (supplied, expected) => {
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const authorized = (request) => {
  const supplied = (requestHeader(request, "authorization") || requestHeader(request, "x-bridge-token")).replace(/^Bearer\s+/i, "");
  return tokenMatches(supplied, bridgeToken);
};
// This is intentionally *not* an alternative Authorization header: an
// operator must grant both normal bridge access and this narrowly-scoped
// proactive-send capability. It is only consulted when a bridge/hermes
// request has no delivery lease at all.
const proactiveAuthorized = (request) => bridgeProactiveToken.length > 0
  && tokenMatches(requestHeader(request, "x-bridge-proactive-token"), bridgeProactiveToken);
// A framework adapter receives a lease for one specific incoming turn. Do
// not let it publish by bare chat ID: after a user edits or deletes the prompt
// an old worker may still be running, but its claim has been revoked. Native
// direct brains do not use this HTTP handoff and retain their normal transport
// reply path.
const validateBridgeOutboundClaim = (body, chatId, request) => {
  const deliveryId = body?.delivery_id;
  const leaseId = body?.lease_id;
  const hasDelivery = deliveryId != null;
  const hasLease = leaseId != null;
  if (hasDelivery !== hasLease || (hasDelivery && (typeof deliveryId !== "string" || typeof leaseId !== "string"))) {
    return { valid: false, status: 400, error: "delivery_id and lease_id must be provided together" };
  }
  const claimRequired = brain === "bridge" || brain === "hermes";
  if (!claimRequired && !hasDelivery) return { valid: true };
  // A proactive capability only authorizes a request which did not claim a
  // delivery. A stale/malformed claim must never silently downgrade to this
  // broader mode: workers always retain the stronger lease fence.
  if (!hasDelivery && proactiveAuthorized(request)) return { valid: true, proactive: true };
  if (!hasDelivery) return { valid: false, status: 409, error: "an active delivery lease or proactive capability is required for this bridge operation" };
  const entry = ingress.find((candidate) => candidate.kind === "bridge"
    && candidate.id === deliveryId
    && candidate.leaseId === leaseId
    && candidate.routed.conversationKey === chatId
    && Number(candidate.leaseUntil) > Date.now());
  if (entry == null) return { valid: false, status: 409, error: "delivery lease is stale or has been revoked" };
  return { valid: true, entry };
};
const bridgeClaimGuard = (claim, chatId) => claim?.entry == null
  ? null
  : () => bridgeLeaseIsActive(chatId, claim.entry.id, claim.entry.leaseId);
const bridgeTurnContextForClaim = (claim, chatId, threadRootId = null) => claim?.entry == null
  ? createTurnContext(chatId, threadRootId)
  : turnContextForRouted(claim.entry.routed);
const staleBridgeClaimError = () => {
  const error = new Error("delivery lease is stale or has been revoked");
  error.code = "T3AMS_BRIDGE_LEASE_STALE";
  error.bridgeClaimStale = true;
  return error;
};
const assertBridgeClaimCurrent = (guard) => {
  if (guard != null && !guard()) throw staleBridgeClaimError();
};
// The protocol checks this synchronously immediately before it queues a
// signed statement. Keep the bridge-specific error shape so an expired or
// revoked worker receives a deterministic conflict rather than a generic
// transport failure.
const claimSubmissionGuard = (guard) => guard == null
  ? null
  : () => assertBridgeClaimCurrent(guard);
const bridge = http.createServer(async (request, response) => {
  try {
    if (!authorized(request)) return json(response, 401, { success: false, error: "unauthorized" });
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: isChainConnected(), transport: "t3ams", account: material.accountIdHex, identifierKey: null,
        xid: selfXidHex, username, subscriptions: subscriptions.size,
        ...(publicDirectAgent && agentRuntime != null ? {
          direct: { public: true, queue: agentRuntime.queueStats() },
        } : {}),
        bridge: {
          queued: bridgeQueued(),
          claimBoundSends: brain === "bridge" || brain === "hermes",
          proactiveOutbound: bridgeProactiveToken.length > 0,
        },
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
      const claim = validateBridgeOutboundClaim(body, chatId, request);
      if (!claim.valid) return json(response, claim.status, { success: false, error: claim.error });
      const claimGuard = bridgeClaimGuard(claim, chatId);
      if (Buffer.byteLength(text, "utf8") > MAX_T3AMS_TEXT_BYTES) return json(response, 413, { success: false, error: "text too large" });
      if (filePath != null && (typeof filePath !== "string" || !filePath)) {
        return json(response, 400, { success: false, error: "file_path must be a saved file path" });
      }
      if (body.thread_root_id != null && typeof body.thread_root_id !== "string") {
        return json(response, 400, { success: false, error: "thread_root_id must be a string" });
      }
      const requestedRoot = body.thread_root_id == null ? null : bareHex(body.thread_root_id);
      if (requestedRoot != null && !/^[0-9a-f]{64}$/.test(requestedRoot)) {
        return json(response, 400, { success: false, error: "thread_root_id must be a 32-byte hexadecimal message ID" });
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
        const turnContext = bindLiveReplyTarget(bridgeTurnContextForClaim(claim, chatId, requestedRoot));
        // Manual/proactive bridge calls retain their historical ability to
        // edit any bot-issued message in the chat. A delivery lease is
        // narrower: its worker may only edit a bubble issued in that lane.
        if (!isBotIssuedMessage(chatId, editOf, claim.entry == null ? undefined : turnContext)) {
          return json(response, 409, { success: false, error: "edit_of must name a message issued by this bot process" });
        }
        disarmThinking(chatId, turnContext);
        const pending = {
          messageId: editOf,
          text,
          chatId,
          deliveryId: claim.entry?.id ?? null,
          leaseId: claim.entry?.leaseId ?? null,
        };
        bridgePendingEdits.set(turnContext.laneKey, pending);
        liveReplies.throttledEdit(turnContext.laneKey, editOf, text, {
          // Native/manual bridge calls retain their historical no-lease
          // behavior; harness brains always have the claim captured above.
          guard: claim.entry == null ? null : () => bridgePendingEditIsActive(turnContext.laneKey, pending),
        });
        return json(response, 200, { success: true, message_id: editOf, coalesced: true });
      }
      const requestedReplyRoot = requestedRoot == null
        ? protocol.replyThreadFor(chatId, replyToId)
        : requestedRoot;
      // A claimed worker owns one durable ingress lane.  Its optional
      // `reply_to`/`thread_root_id` fields are useful for proactive/manual
      // bridge calls, but must not let a worker holding a thread-A lease
      // publish into thread B.  Keep the route from the immutable claim and
      // use the request only when no lease is involved.
      const turnContext = bindLiveReplyTarget(bridgeTurnContextForClaim(claim, chatId, requestedReplyRoot));
      const root = bridgeReplyThreadRootForT3ams(
        claim.entry == null ? null : turnContext,
        requestedReplyRoot,
      );
      disarmThinking(chatId, turnContext);
      cancelBridgePendingEdit(turnContext.laneKey);
      if (filePath != null) {
        let file;
        try { file = fileStore.get(fileNamespaceForChat(chatId), filePath); }
        catch (error) { return json(response, fileBridgeStatus(error), { success: false, error: String(error?.message ?? error).slice(0, 300) }); }
        if (file == null) return json(response, 404, { success: false, error: "file not found" });
        assertBridgeClaimCurrent(claimGuard);
        const placeholder = await takeLivePlaceholder(chatId, turnContext);
        if (placeholder != null) {
          // Attachments cannot be added by an edit, so keep the live message
          // as a clear delivery status while the actual rich-file message is
          // submitted below. `reply_to` must not turn it into an unexplained
          // checkmark bubble.
          await placeholder.handle.finalize("📎 Sending file…", { guard: claimGuard });
        }
        try {
          const sent = await sendT3amsAttachment(chatId, {
            filePath: file.filePath,
            mime: file.mime,
            size: file.size,
            text: hasText ? text : file.path,
            threadRootId: root,
            turnContext,
            beforeSend: async () => assertBridgeClaimCurrent(claimGuard),
            guard: claimSubmissionGuard(claimGuard),
          });
          return json(response, 200, { success: true, message_id: sent.messageId, attachment: {
            id: sent.attachment.id,
            mime: sent.attachment.mime,
            size: sent.attachment.size,
            filename: sent.attachment.filename,
          } });
        } catch (error) {
          log("T3AMS_BRIDGE_FILE_SEND_FAILED", { chatId, path: file.path, error: String(error?.message ?? error) });
          return json(response, error?.bridgeClaimStale === true ? 409 : 502, {
            success: false,
            error: error?.bridgeClaimStale === true ? "delivery lease is stale or has been revoked" : "file delivery failed",
          });
        }
      }
      const parts = splitMessageText(text, replyChunkBytes);
      if (parts.length > 1) log("T3AMS_REPLY_CHUNKED", { chatId, parts: parts.length, chars: text.length });
      let firstId = null;
      assertBridgeClaimCurrent(claimGuard);
      const placeholder = await takeLivePlaceholder(chatId, turnContext);
      if (placeholder != null) {
        // A bridge lease records the triggering thread before the harness
        // begins work, so the placeholder is already in the correct T3ams
        // reply/thread. `reply_to` is normally supplied by both shipped
        // adapters and must not force a redundant \"✓\" plus a second bubble.
        firstId = (await placeholder.handle.finalize(parts[0], { guard: claimGuard })).messageId;
        noteBotIssuedMessage(chatId, firstId, turnContext);
      }
      for (const [index, part] of parts.entries()) {
        if (index === 0 && firstId != null) continue;
        assertBridgeClaimCurrent(claimGuard);
        const sent = await protocol.sendText(chatId, part, {
          threadRootId: root,
          guard: claimSubmissionGuard(claimGuard),
        });
        noteBotIssuedMessage(chatId, sent.messageId, createTurnContext(chatId, root));
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
      const claim = validateBridgeOutboundClaim(body, chatId, request);
      if (!claim.valid) return json(response, claim.status, { success: false, error: claim.error });
      const claimGuard = bridgeClaimGuard(claim, chatId);
      assertBridgeClaimCurrent(claimGuard);
      await protocol.sendReaction(chatId, messageId, emoji, {
        removed: body.remove === true,
        guard: claimSubmissionGuard(claimGuard),
      });
      return json(response, 200, { success: true });
    }
    if (request.method === "POST" && url.pathname === "/typing") {
      const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      const chatId = typeof body.chat_id === "string" ? body.chat_id : "";
      if (!isT3amsConversationKey(chatId)) return json(response, 400, { success: false, error: "invalid chat_id" });
      const claim = validateBridgeOutboundClaim(body, chatId, request);
      if (!claim.valid) return json(response, claim.status, { success: false, error: claim.error });
      const claimGuard = bridgeClaimGuard(claim, chatId);
      assertBridgeClaimCurrent(claimGuard);
      try { await protocol.sendTyping(chatId, { guard: claimSubmissionGuard(claimGuard) }); }
      catch (error) {
        if (error?.bridgeClaimStale === true) throw error;
        log("T3AMS_BRIDGE_TYPING_FAILED", { chatId, error: String(error?.message ?? error) });
      }
      return json(response, 200, { success: true });
    }
    return json(response, 404, { success: false, error: "not found" });
  } catch (error) {
    if (error?.bridgeClaimStale === true || error?.code === "LIVE_EDIT_FENCED") {
      return json(response, 409, { success: false, error: "delivery lease is stale or has been revoked" });
    }
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
