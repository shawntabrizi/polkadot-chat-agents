#!/usr/bin/env node
// polkadot-bot-core — a standalone transport bridge between the Polkadot app's
// Statement Store chat and a local HTTP API, for AI agent harnesses (Hermes).
//
// It receives chat requests + session follow-ups addressed to the bot identity,
// ACKs them, and exposes:
//   GET  /health                     -> { ok, account, identifierKey, username }
//   GET  /inbound?wait=<secs>&limit=<n> -> long-poll; leased [{delivery_id,
//                                       lease_id, lease_ms, chat_id, text, message_id, ...}]
//                                       (&events=1 adds reactions/coinage/leftChat)
//   POST /inbound/renew {delivery_id, lease_id} -> extend an active lease
//   GET  /media/<id>                 -> bytes of a downloaded attachment
//   GET/PUT/DELETE /files/<chat_id>[/<path>] -> durable peer-scoped files
//   POST /send  {chat_id, text?, file_path?, reply_to?, edit_of?} -> publish a reply / file / quote / edit
//                                       ({group_id, text} fans a reply out to a spec 0009 group)
//   POST /react {chat_id, message_id, emoji, remove?} -> emoji reaction
//   POST /typing {chat_id}           -> no-op (best effort)
//
// Reuses ONLY the generic transport codec (vendor/) + a papi client for the
// on-chain identifier-key lookup. No faucet-specific code (coinage/stripe/etc.).
//
// Env: BOT_SEED_HEX (root mini-secret),
//   BOT_ENDPOINT (default Products Devnet), BOT_NETWORK_PROFILE (devnet|paseo|sandbox;
//   sandbox also needs BOT_SANDBOX_URL, the local sandbox's control API),
//   BOT_BRIDGE_PORT (8799), BOT_BRIDGE_HOST (127.0.0.1),
//   BOT_ACK_TEXT, BOT_ALLOWED_PEERS (comma-sep peer account hexes; empty = allow all),
//   BOT_REQUEST_LOOKBACK_DAYS (7), BOT_REQUEST_FUTURE_DAYS (2), BOT_POLL_MS (2000),
//   BOT_THINKING_TEXT + BOT_THINKING_AFTER_MS (5000) — ack sent if no reply by then,
//   BOT_GREET (0; 1 = message allowlisted owners on first start) + BOT_GREET_TEXT,
//   BOT_SUBSCRIBE (1; 0 = poll-only), BOT_SWEEP_MS (30000, sweep cadence while the
//   subscription is healthy), BOT_HEARTBEAT_MS (120000), BOT_PEER_IDENTIFIER_KEYS
//   ("peerhex=containerhex,..." — pin 65-byte on-chain identifier-key
//   containers in front of the directory lookup).
//   Attachments: BOT_MEDIA_MAX_BYTES (32MB), BOT_MEDIA_TTL_HOURS (48),
//   BOT_MEDIA_MAX_TOTAL_MB (512), BOT_HOP_TIMEOUT_MS (120000),
//   BOT_HOP_ALLOWED_NODES (comma-sep trusted host suffixes; required for
//   production attachment downloads), BOT_HOP_RPC_FRAME_MAX_BYTES (4.5MB),
//   BOT_HOP_ALLOW_INSECURE (tests only: permit ws:// and IP hosts).
//   Durable files: BOT_FILE_MAX_BYTES (50MB), BOT_FILE_MAX_TOTAL_MB (1024),
//   BOT_FILE_MAX_ENTRIES (2000), BOT_FILE_MAX_PEER_MB (256), and
//   BOT_FILE_MAX_PEER_ENTRIES (500). File delivery additionally needs
//   BOT_HOP_UPLOAD_NODE (operator-pinned HOP URL) and a provisioned Bulletin
//   allowance for the derived //allowance//bulletin//chat account.
//   Durable backlog: BOT_MAX_OWED_REPLIES (2000), BOT_MAX_OWED_BYTES (16MB).
//   Replies: BOT_REPLY_CHUNK_BYTES (4000) — long answers are split into parts
//   of at most this many UTF-8 bytes (paragraph/code-fence aware).
//   Live replies: BOT_LIVE_EDIT_MIN_MS (3000) / BOT_LIVE_EDIT_MAX_MS (15000)
//   edit throttle, BOT_LIVE_HEARTBEAT_MS (15000) elapsed-clock frames,
//   BOT_LIVE_ACK_TIMEOUT_MS (60000), BOT_LIVE_PROGRESS (1; 0 = placeholder and
//   status line only), BOT_LIVE_TTL_MS (600000) + BOT_LIVE_TIMEOUT_TEXT — placeholder
//   resolves to a timeout note if no answer finalized it in time.
//   Direct engines (BOT_BRAIN=claude|codex|opencode): BOT_AI_MODEL (opencode
//   takes a provider/model slug), BOT_AI_ALLOWED_MODELS (comma-sep /model
//   allowlist; unset/empty = locked), BOT_AI_MODEL_SWITCHING (locked|open;
//   open requires a non-public bot), BOT_AI_TOOL_CAPABILITIES (empty = no
//   tools), BOT_AI_TOOL_SCOPE (workspace|container), BOT_AI_IDLE_TIMEOUT_MS
//   (600000, kills a silent/wedged turn), BOT_AI_MAX_MS (3600000 default hard
//   cap), BOT_AI_MAX_CONCURRENT_TURNS / BOT_AI_MAX_QUEUED_TURNS, BOT_AI_WORKSPACE
//   (a non-secret agent workspace separate from BOT_STATE_DIR),
//   BOT_AI_AGENT_UID/BOT_AI_AGENT_GID (optional child process identity),
//   BOT_AI_CMD/BOT_AI_ARGS (custom stream-json CLI),
//   BOT_AI_PROJECTS (JSON {alias: dir} — /project <alias>[@branch] then picks
//   the turn's cwd; branches get isolated git worktrees under
//   BOT_AI_WORKSPACE/.worktrees), BOT_AI_REASONING (default reasoning effort,
//   engine-specific levels; /reasoning overrides per peer).

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";
import { createStateStore } from "./lib/session-store.mjs";
import { createAgentRuntime } from "./lib/agent-runtime.mjs";
import { buildOperatorContext, groupHint } from "./lib/agent-context.mjs";
import { createPeerClock } from "./lib/peer-clock.mjs";
import { commandCatalog, resolveModelPolicy } from "./lib/commands.mjs";
import { splitMessageText } from "./lib/chunk.mjs";
import { createOutboundLanes } from "./lib/outbound-lanes.mjs";
import { createDeletionLedger, createExtensionObserver, createMessageDeleter, parseProtocolExtensions } from "./lib/message-deletion.mjs";
import { TYPING_MIN_INTERVAL_MS, TYPING_PLACEHOLDER_AFTER_MS, TYPING_TTL_MS, createTypingAndSeen } from "./lib/typing-seen.mjs";
import { buttonsFallbackText, extractButtonsBlock } from "./lib/buttons-block.mjs";
import { buttonPressText, createSentButtons } from "./lib/button-presses.mjs";
import { createBotInfoSent, createPeerBotInfo, defaultBotInfo, loadBotInfo } from "./lib/bot-info.mjs";
import { createGroups, groupSessionKey } from "./lib/groups.mjs";
import { createGroupsV2 } from "./lib/groups-v2.mjs";
import { groupExpiryFactory, pairwiseSecret } from "./lib/group-keys.mjs";
import { createWorkspaces } from "./lib/workspaces.mjs";
import { downloadP2PFile, uploadP2PFile, validateHopUrl } from "./lib/hop-client.mjs";
import { createMediaStore } from "./lib/media-store.mjs";
import { createFileStore } from "./lib/file-store.mjs";
import { createFileCommandHandler } from "./lib/file-commands.mjs";
import { createDeferredProgressTracker, createLiveReplies, renderTurnStats } from "./lib/live-reply.mjs";
import { RUNNERS, resolveEngine, ENGINES, assertEngineToolPolicy, toolPolicyEnforcement } from "./lib/runners.mjs";
import { ToolPolicyError, hasToolCapability, toolPolicyFromEnvironment, toolPolicySummary } from "./lib/tool-policy.mjs";
import { createKeyedDispatcher } from "./lib/keyed-dispatcher.mjs";
import { createReviveChain } from "./lib/revive-chain.mjs";
import { createMeter, DEFAULT_METER_PRICE, METER_BATCH_MS, METER_BATCH_REPLIES, parsePlancks } from "./lib/meter.mjs";
import { createFaucet, DEFAULT_FAUCET_AMOUNT, faucetPairFromPath } from "./lib/faucet.mjs";
import { createFlip } from "./lib/flip.mjs";
import { createClient as createPapiClient } from "polkadot-api";
import { getWsProvider, WsEvent } from "polkadot-api/ws";
import { paseoPeopleNext, productsDevnetPeople } from "./lib/descriptors.mjs";
import {
  DEFAULT_NETWORK_PROFILE,
  NETWORK_PROFILE_IDS,
  PASEO,
  PRODUCTS_DEVNET,
  SANDBOX,
  configuredNetworkProfile,
  peopleEndpointsFor,
} from "./lib/network-config.mjs";
import { metadataCache } from "./lib/chain-client.mjs";
import { createChainDirectory, createSandboxDirectory } from "./lib/people-directory.mjs";
import { DEFAULT_IDENTIFIER_RETRY_MS, createIdentifierWait } from "./lib/identifier-wait.mjs";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { withTimeout, runWithConcurrency } from "./vendor/lib/async-utils.mjs";
import {
  makePeerSession,
  decodeAccountEcdhKey,
  deriveX25519PrivateKey,
  encodeAccountEcdhKey,
  generateX25519Keypair,
  x25519PublicKeyFromPrivateKey,
  chatRequestAllPeerStatementsTopic,
  chatRequestPaginationTopic,
  chatRequestDayFromUnixSeconds,
  decodeEncryptedChatRequestPayload,
  verifyChatRequestIdentityProof,
  decodeSessionStatementPayload,
  encodeNativeChatRequestV2,
  encodeOpaqueTextMessage,
  encodeOpaqueRichTextMessage,
  encodeOpaqueReactionMessage,
  encodeOpaqueReplyMessage,
  encodeOpaqueEditedMessage,
  encodeOpaqueDeletedMessage,
  encodeOpaqueBotInfoMessage,
  encodeOpaqueButtonsMessage,
  encodeOpaqueTransactionReferenceMessage,
  encodeOpaqueTypingMessage,
  encodeOpaqueSeenMessage,
  TYPING_KINDS,
  encodeOpaqueDataChannelClosedMessage,
  encodeOpaqueChatAcceptedMessage,
  encodeOpaqueDeviceChatAcceptedMessage,
  encodeOpaqueGroupControlMessage,
  encodeSessionRequestPayload,
  encodeSessionResponsePayload,
  submitAppStatement,
  scaleEncodeBytes,
  makeAppUuid,
} from "./vendor/app-chat-codec.mjs";

// ---------- config / helpers ----------
const env = process.env;
const numberEnv = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = {}) => {
  const raw = env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    console.error(`${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
    process.exit(2);
  }
  return value;
};
const explicitNetworkProfile = (env.BOT_NETWORK_PROFILE ?? "").trim();
const networkProfile = explicitNetworkProfile
  ? configuredNetworkProfile(explicitNetworkProfile)
  : env.BOT_ENDPOINT?.trim() ? null : configuredNetworkProfile(DEFAULT_NETWORK_PROFILE);
if (explicitNetworkProfile && !networkProfile) {
  console.error(`BOT_NETWORK_PROFILE must be ${NETWORK_PROFILE_IDS.join(", ")}, or empty for a compatible custom endpoint`);
  process.exit(2);
}
// The sandbox has no fixed endpoints: its store node and directory live only
// in the running daemon, so both must be handed in explicitly.
const sandbox = networkProfile?.id === SANDBOX.id;
const sandboxUrl = (env.BOT_SANDBOX_URL ?? "").trim();
if (sandbox && (!env.BOT_ENDPOINT?.trim() || !sandboxUrl)) {
  console.error("BOT_NETWORK_PROFILE=sandbox requires BOT_ENDPOINT (the sandbox store node) and BOT_SANDBOX_URL (its control API)");
  process.exit(2);
}
const endpoint = env.BOT_ENDPOINT?.trim() || networkProfile?.peopleEndpoints[0] || PRODUCTS_DEVNET.peopleEndpoints[0];
const endpoints = peopleEndpointsFor(endpoint, networkProfile?.id);
const peopleDescriptor = networkProfile?.id === PASEO.id ? paseoPeopleNext : productsDevnetPeople;
const seedHex = (env.BOT_SEED_HEX ?? "").trim();
const bridgePort = numberEnv("BOT_BRIDGE_PORT", 8799, { min: 0, max: 65_535 });
// The bridge exposes decrypted inbound messages and can publish as the bot.
// Require an explicit shared secret even on loopback so a local co-tenant cannot
// silently take control of it.
const bridgeHost = env.BOT_BRIDGE_HOST ?? "127.0.0.1";
const bridgeToken = (env.BOT_BRIDGE_TOKEN ?? "").trim();
if (bridgeToken.length < 32) {
  console.error("BOT_BRIDGE_TOKEN must be set to a 32+ character random secret");
  process.exit(2);
}
const brain = (env.BOT_BRAIN ?? "bridge").trim().toLowerCase(); // bridge | echo | claude | codex | opencode | kimi
if (!new Set(["echo", "claude", "codex", "opencode", "kimi", "bridge"]).has(brain)) {
  console.error("BOT_BRAIN must be echo, claude, codex, opencode, kimi, or bridge");
  process.exit(2);
}
const ackText = env.BOT_ACK_TEXT ?? (brain === "bridge" ? "Connecting you to the agent…" : "");
// If a reply hasn't gone out within BOT_THINKING_AFTER_MS of receiving a message,
// send a "thinking" ack so a slow answer (AI call, Hermes round-trip) doesn't feel
// like the message was lost. Fast replies cancel it. Empty text disables it.
const thinkingText = env.BOT_THINKING_TEXT ?? "🤔 One moment — thinking…";
const thinkingAfterMs = numberEnv("BOT_THINKING_AFTER_MS", 5000, { min: 0, max: 86_400_000 });
// Live replies: the thinking placeholder is edited through progress and then
// collapses to a short status receipt of what the turn cost; the answer
// follows as a new message, which is what raises a phone notification.
// Edit cadence guardrails live in lib/live-reply.mjs.
const liveMinEditMs = numberEnv("BOT_LIVE_EDIT_MIN_MS", 3000, { min: 100, max: 86_400_000 });
const liveMaxEditMs = numberEnv("BOT_LIVE_EDIT_MAX_MS", 15_000, { min: liveMinEditMs, max: 86_400_000 });
const liveHeartbeatMs = numberEnv("BOT_LIVE_HEARTBEAT_MS", 15_000, { min: 100, max: 86_400_000 });
const liveAckTimeoutMs = numberEnv("BOT_LIVE_ACK_TIMEOUT_MS", 60_000, { min: 100, max: 86_400_000 });
const liveProgress = env.BOT_LIVE_PROGRESS !== "0";
// A placeholder must never tick forever: if no answer finalized it within the
// TTL (harness died, message dropped), it resolves to a visible timeout note.
const liveTtlMs = numberEnv("BOT_LIVE_TTL_MS", 600_000, { min: 1000, max: 7 * 86_400_000 });
const liveTimeoutText = env.BOT_LIVE_TIMEOUT_TEXT
  ?? "⚠️ I lost track of this one — something went wrong on my end. Please send it again.";
// Long answers are split into parts of at most this many UTF-8 bytes — each
// part is one chat bubble. Well under the statement allowance (a lite person
// gets 500 KiB), sized for mobile readability (Telegram-proven ~4k).
const replyChunkBytes = numberEnv("BOT_REPLY_CHUNK_BYTES", 4000, { min: 128, max: 480 * 1024 });
// Greet mode: on startup the bot opens the chat with each allowlisted owner it
// has never talked to (once ever, persisted) — a liveness signal, so the owner
// doesn't have to find and message the bot first. Only allowlisted peers are
// ever greeted; an open bot has no owner to greet.
const greet = env.BOT_GREET === "1" || env.BOT_GREET === "true";
const greetText = env.BOT_GREET_TEXT ?? `👋 ${env.BOT_USERNAME || "Your bot"} here — I'm alive! Say hi, or /help for what I can do.`;

// Direct engine "brains": bot-core runs a headless coding-agent CLI (claude /
// codex / opencode / kimi) as an autonomous agent — verbatim prompt and native
// session resume. Tools require an explicit operator choice. The engine table
// (lib/runners.mjs) turns a
// (prompt, model, resume) into argv and normalizes each CLI's JSONL stream;
// the runtime around it (spawn/stream/idle-backstop, per-peer state, in-chat
// commands) is lib/agent-runtime.mjs, driven through the `chat` surface
// defined below. See docs/explanation/protocol.md. BOT_AI_MODEL pins a model (for opencode
// this is a provider/model slug); per-peer /model overrides it.
const aiModel = (env.BOT_AI_MODEL ?? "").trim();
const aiContextEnabled = env.BOT_AI_CONTEXT !== "0";
// aiAllowedModels (the /model switching policy) is derived below, once the
// peer allowlist is known. It is locked by default; open switching requires an
// explicit non-public operator opt-in. See resolveModelPolicy.
// Tool authority is an explicit PCA policy, not an engine-native allowlist.
// The default is no tools. A deployer can opt into portable capabilities and
// choose whether they are restricted to the current workspace or the whole
// non-root container account.
let aiToolPolicy;
try { aiToolPolicy = toolPolicyFromEnvironment(env); }
catch (error) {
  console.error(error instanceof ToolPolicyError ? error.message : `Invalid tool policy: ${String(error?.message ?? error)}`);
  process.exit(2);
}
// No wall-clock timeout: a long agent turn (a big build/test) is legitimate.
// Instead an idle-silence backstop kills a process that has emitted nothing for
// this long — a wedge — and unblocks the peer's queue. /stop is the user lever.
const aiIdleMs = numberEnv("BOT_AI_IDLE_TIMEOUT_MS", 600_000, { min: 1000, max: 7 * 86_400_000 });
const aiMaxMs = numberEnv("BOT_AI_MAX_MS", 3_600_000, { min: 1000, max: 7 * 86_400_000 });
const aiMaxConcurrentTurns = numberEnv("BOT_AI_MAX_CONCURRENT_TURNS", 4, { min: 1, max: 128 });
const aiMaxQueuedTurns = numberEnv("BOT_AI_MAX_QUEUED_TURNS", 100, { min: 0, max: 10_000 });
const aiMaxOutputBytes = numberEnv("BOT_AI_MAX_OUTPUT_BYTES", 1_000_000, { min: 1024, max: 64 * 1024 * 1024 });
const optionalPosixId = (name) => {
  if (env[name] == null || env[name] === "") return null;
  return numberEnv(name, 0, { min: 0, max: 2_147_483_647 });
};
const aiAgentUid = optionalPosixId("BOT_AI_AGENT_UID");
const aiAgentGid = optionalPosixId("BOT_AI_AGENT_GID");
// The workspace is a dedicated tool root, never BOT_STATE_DIR itself. Managed
// deployments set it to the separately-mounted /workspace; local/manual runs
// default to BOT_STATE_DIR/workspace and native file policies open only that
// child, not the sibling signing/session files.
const defaultWorkspace = env.BOT_STATE_DIR
  ? path.join(path.resolve(env.BOT_STATE_DIR), "workspace")
  : fs.mkdtempSync(path.join(os.tmpdir(), "bot-ws-"));
const aiWorkspace = env.BOT_AI_WORKSPACE ?? defaultWorkspace;
// Multi-project workspaces: BOT_AI_PROJECTS maps aliases to project dirs; a
// peer picks one with /project <alias>[@branch] (branch = isolated worktree)
// and their turns then run there instead of the shared workspace.
let aiProjects = {};
if (env.BOT_AI_PROJECTS) {
  try { aiProjects = JSON.parse(env.BOT_AI_PROJECTS); } catch { console.error("BOT_AI_PROJECTS must be a JSON object {alias: path}"); process.exit(2); }
  if (aiProjects == null || typeof aiProjects !== "object" || Array.isArray(aiProjects)) { console.error("BOT_AI_PROJECTS must be a JSON object {alias: path}"); process.exit(2); }
}

// Escape hatch: BOT_AI_CMD=<bin> [+ BOT_AI_ARGS=<JSON array> with "__PROMPT__"]
// runs a custom CLI that speaks claude-shaped stream-json (also how the offline
// e2e drives the loop with a mock `sh` script). Otherwise the engine is the
// named brain (claude/codex/opencode/kimi); null for echo/bridge.
const customCmd = (env.BOT_AI_CMD ?? "").trim();
let customArgsTmpl = null;
if (customCmd && env.BOT_AI_ARGS) {
  try { customArgsTmpl = JSON.parse(env.BOT_AI_ARGS); } catch { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
  if (!Array.isArray(customArgsTmpl)) { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
}
const engine = customCmd ? RUNNERS.custom : resolveEngine(brain); // null unless a direct engine
const engineCommand = customCmd || engine?.command;
if (customCmd && (aiToolPolicy.capabilities.length || aiToolPolicy.scope !== "workspace")) {
  console.error("BOT_AI_CMD owns its own tool boundary; BOT_AI_TOOL_CAPABILITIES and BOT_AI_TOOL_SCOPE are only supported by the built-in claude, codex, opencode, and kimi brains.");
  process.exit(2);
}
if (engine && !customCmd) {
  try { aiToolPolicy = assertEngineToolPolicy(brain, aiToolPolicy); }
  catch (error) {
    console.error(error instanceof ToolPolicyError ? error.message : `Invalid tool policy: ${String(error?.message ?? error)}`);
    process.exit(2);
  }
}
if (engine) fs.mkdirSync(aiWorkspace, { recursive: true, mode: 0o700 });
// Default reasoning effort (engine-specific flag; see lib/runners.mjs).
// Validated here so a typo fails at startup, not silently per turn.
const aiReasoning = (env.BOT_AI_REASONING ?? "").trim();
if (engine && aiReasoning && !engine.effortLevels?.includes(aiReasoning)) {
  console.error(`BOT_AI_REASONING=${aiReasoning} is not valid for this engine${engine.effortLevels ? ` (levels: ${engine.effortLevels.join(", ")})` : " (it has no reasoning control)"}`);
  process.exit(2);
}
const buildEngineArgs = ({ prompt, operatorContext, model, resume, effort, attachmentDir, outputDir, workingDirectory }) => {
  if (customCmd) return customArgsTmpl ? customArgsTmpl.map((a) => (a === "__PROMPT__" ? prompt : a)) : [prompt];
  return engine.buildArgs({
    prompt,
    operatorContext,
    model,
    resume,
    effort,
    policy: aiToolPolicy,
    attachmentDir,
    outputDir,
    workingDirectory,
    protectedPaths: [env.BOT_STATE_DIR, env.HOME, "/app"],
  });
};
const buildEngineTurnEnvironment = ({ attachmentDir, outputDir, workingDirectory }) =>
  customCmd ? null : engine.buildEnvironment?.({
    policy: aiToolPolicy,
    attachmentDir,
    outputDir,
    workingDirectory,
    // Runners that stage files for the CLI (kimi's overlay home) must hand
    // anything the agent writes to the identity the CLI actually runs as.
    agentUid: aiAgentUid,
    agentGid: aiAgentGid,
  }) ?? null;
const lookbackDays = numberEnv("BOT_REQUEST_LOOKBACK_DAYS", 7, { min: 0, max: 365 });
const futureDays = numberEnv("BOT_REQUEST_FUTURE_DAYS", 2, { min: 0, max: 30 });
const pollMs = numberEnv("BOT_POLL_MS", 2000, { min: 100, max: 86_400_000 });
// Deadline for every chain call (queries AND submits): papi requests never
// reject on a dead socket — they're buffered and re-sent on reconnect — so an
// unbounded await anywhere in the poll path wedges the bot forever.
const queryTimeoutMs = numberEnv("BOT_QUERY_TIMEOUT_MS", 15_000, { min: 100, max: 86_400_000 });
const MAX_SESSIONS = numberEnv("BOT_MAX_SESSIONS", 1000, { min: 1, max: 100_000 });
const MAX_PEER_DEVICES = numberEnv("BOT_MAX_PEER_DEVICES", 32, { min: 1, max: 1024 });
const SESSION_IDLE_MS = numberEnv("BOT_SESSION_IDLE_MS", 30 * 86_400_000, { min: 60_000, max: 365 * 86_400_000 });
const MAX_OWED = numberEnv("BOT_MAX_OWED_REPLIES", 2000, { min: 1, max: 100_000 });
const MAX_OWED_BYTES = numberEnv("BOT_MAX_OWED_BYTES", 16 * 1024 * 1024, { min: 64 * 1024, max: 1024 * 1024 * 1024 });
// State is mandatory: it holds the pre-ACK journal and transport keys. Keep
// the directory private too; 0600 files alone do not protect media/tickets if
// another local account can enumerate the parent.
if (!env.BOT_STATE_DIR) {
  console.error("BOT_STATE_DIR is required so inbound work can be durably journaled before acknowledgement");
  process.exit(2);
}
try {
  fs.mkdirSync(env.BOT_STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(env.BOT_STATE_DIR, 0o700);
} catch (error) {
  console.error(`BOT_STATE_DIR must be a writable private directory: ${String(error?.message ?? error)}`);
  process.exit(2);
}
const stateStore = createStateStore(path.join(env.BOT_STATE_DIR, "session-state.json"));
const rawStoredState = stateStore.load();
const SEEN_CAP = 5000; // bound the persisted dedup set
const allowedPeers = new Set(
  String(env.BOT_ALLOWED_PEERS ?? "").split(",").map((s) => s.trim().replace(/^0x/i, "").toLowerCase()).filter(Boolean),
);
// /model switching policy: explicit BOT_AI_ALLOWED_MODELS always wins (empty
// string = a deliberate lock). Unconfigured bots are locked. An operator may
// set BOT_AI_MODEL_SWITCHING=open only for a bot with an explicit peer
// allowlist. null=open, []=locked.
const modelSwitching = String(env.BOT_AI_MODEL_SWITCHING ?? "locked").trim().toLowerCase();
if (!new Set(["locked", "open"]).has(modelSwitching)) {
  console.error("BOT_AI_MODEL_SWITCHING must be locked or open");
  process.exit(2);
}
if (modelSwitching === "open" && allowedPeers.size === 0 && env.BOT_AI_ALLOWED_MODELS == null) {
  console.error("BOT_AI_MODEL_SWITCHING=open requires BOT_ALLOWED_PEERS; public bots must use BOT_AI_ALLOWED_MODELS");
  process.exit(2);
}
const aiAllowedModels = resolveModelPolicy({
  configured: env.BOT_AI_ALLOWED_MODELS ?? null,
  isPublic: allowedPeers.size === 0,
  allowOpen: modelSwitching === "open",
});
if (!seedHex) { console.error("BOT_SEED_HEX is required"); process.exit(2); }

const hexToBytes = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  // Don't echo the value in the error: this path handles seeds and key material.
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex value (${clean.length} chars)`);
  return Uint8Array.from(clean.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
};
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();
const norm = (hex) => String(hex).trim().replace(/^0x/i, "").toLowerCase();
const log = (event, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...extra }));

// ---------- attachment media (downloaded blobs) ----------
// Attachments arrive as HOP references (identifier + claimTicket + node URL);
// the bytes are fetched into the media store so brains can read them and the
// bridge can serve them via GET /media/:id. Stateless runs get a temp dir.
const mediaMaxBytes = numberEnv("BOT_MEDIA_MAX_BYTES", 32 * 1024 * 1024, { min: 1, max: 512 * 1024 * 1024 });
const hopTimeoutMs = numberEnv("BOT_HOP_TIMEOUT_MS", 120_000, { min: 1000, max: 86_400_000 });
const hopRpcFrameMaxBytes = numberEnv("BOT_HOP_RPC_FRAME_MAX_BYTES", 4_500_000, { min: 1024, max: 32 * 1024 * 1024 });
const mediaMaxConcurrentDownloads = numberEnv("BOT_MEDIA_MAX_CONCURRENT_DOWNLOADS", 2, { min: 1, max: 64 });
// HOP keeps the decrypted chunks and then allocates the final contiguous
// Uint8Array, with one encrypted chunk transiently present too. Reserve that
// shape up front so the global byte budget reflects peak heap, not file size.
const mediaMemoryReservation = (bytes) => Math.max(1, bytes * 2 + 4 * 1024 * 1024);
const mediaMaxInflightBytes = numberEnv(
  "BOT_MEDIA_MAX_INFLIGHT_BYTES",
  Math.max(mediaMemoryReservation(mediaMaxBytes), 64 * 1024 * 1024),
  { min: mediaMemoryReservation(mediaMaxBytes), max: 4 * 1024 * 1024 * 1024 },
);
const mediaDownloadQueueCap = numberEnv("BOT_MEDIA_DOWNLOAD_QUEUE_CAP", 100, { min: 1, max: 10_000 });
// Plain ws:// and IP-literal HOP hosts are permitted on the network profile
// that already permits them for the statement store (the local sandbox, whose
// HOP node is on loopback) and for tests via BOT_HOP_ALLOW_INSECURE.
const hopAllowInsecure = env.BOT_HOP_ALLOW_INSECURE === "1" || Boolean(networkProfile?.insecureEndpoints);
const hopAllowedNodes = String(env.BOT_HOP_ALLOWED_NODES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const mediaStore = createMediaStore({
  dir: env.BOT_STATE_DIR ? path.join(env.BOT_STATE_DIR, "media") : fs.mkdtempSync(path.join(os.tmpdir(), "bot-media-")),
  ttlHours: numberEnv("BOT_MEDIA_TTL_HOURS", 48, { min: 1, max: 24 * 365 }),
  maxTotalMb: numberEnv("BOT_MEDIA_MAX_TOTAL_MB", 512, { min: 1, max: 32 * 1024 }),
  log,
});
mediaStore.sweep();
setInterval(() => mediaStore.sweep(), 3_600_000).unref();

// Saved files are a separate explicit capability from the evictable media
// cache. They are peer-scoped and never carry an inbound claim ticket.
const fileMaxBytes = numberEnv("BOT_FILE_MAX_BYTES", 50 * 1024 * 1024, { min: 1, max: 512 * 1024 * 1024 });
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
const fileMaxPeerEntries = numberEnv(
  "BOT_FILE_MAX_PEER_ENTRIES",
  Math.min(500, fileMaxEntries),
  { min: 1, max: fileMaxEntries },
);
const fileStore = createFileStore({
  dir: path.join(env.BOT_STATE_DIR, "files"),
  maxFileBytes: fileMaxBytes,
  maxTotalMb: fileMaxTotalMb,
  maxEntries: fileMaxEntries,
  maxPeerMb: fileMaxPeerMb,
  maxPeerEntries: fileMaxPeerEntries,
  log,
});
const hopUploadNode = (env.BOT_HOP_UPLOAD_NODE ?? "").trim();
const hopUploadTimeoutMs = numberEnv("BOT_HOP_UPLOAD_TIMEOUT_MS", 120_000, { min: 1000, max: 86_400_000 });
if (hopUploadNode) {
  try {
    validateHopUrl(hopUploadNode, {
      allowInsecure: hopAllowInsecure,
      allowedNodes: hopAllowedNodes.length ? hopAllowedNodes : null,
    });
  } catch (error) {
    console.error(`BOT_HOP_UPLOAD_NODE is invalid: ${String(error?.message ?? error)}`);
    process.exit(2);
  }
}

const humanSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const attachmentNoun = (a) => (a.fileKind === "image" ? "photo" : a.fileKind === "video" ? "video" : "file");
// Decoded codec attachment -> journal-able metadata: hex strings only, so it
// survives JSON round-trips in the owed journal. ticketHex is key material —
// never logged, never handed across the bridge.
const toAttachmentMeta = (a) => ({
  id: a.identifierHex,
  ticketHex: norm(bytesToHex(a.claimTicket)),
  wssUrl: a.wssUrl,
  mime: a.mimeType,
  size: a.fileSize,
  fileKind: a.fileKind,
  ...(a.width != null ? { width: a.width, height: a.height } : {}),
  ...(a.duration != null ? { duration: a.duration } : {}),
});
// Every consumer of a message expects non-empty text, so caption-less
// attachments get a synthesized placeholder.
const synthesizeText = (caption, attachments) =>
  caption || (attachments ?? []).map((a) => `[${attachmentNoun(a)}, ${a.mime}, ${humanSize(a.size)}]`).join(" ");

// HOP decrypts a file into memory, so a per-file maximum alone is insufficient
// when several peers arrive at once. Reserve a declared-size budget before
// opening the socket, then share the same download for duplicate identifiers.
let activeMediaDownloads = 0;
let reservedMediaBytes = 0;
const queuedMediaDownloads = [];
const inflightMediaDownloads = new Map(); // id -> Promise<path>
const drainMediaDownloads = () => {
  while (activeMediaDownloads < mediaMaxConcurrentDownloads && queuedMediaDownloads.length > 0) {
    const index = queuedMediaDownloads.findIndex((job) => reservedMediaBytes + job.bytes <= mediaMaxInflightBytes);
    if (index < 0) return;
    const [job] = queuedMediaDownloads.splice(index, 1);
    activeMediaDownloads += 1;
    reservedMediaBytes += job.bytes;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeMediaDownloads -= 1;
        reservedMediaBytes -= job.bytes;
        drainMediaDownloads();
      });
  }
};
const queueMediaDownload = (bytes, task) => new Promise((resolve, reject) => {
  if (queuedMediaDownloads.length >= mediaDownloadQueueCap) {
    reject(new Error("attachment download queue is full"));
    return;
  }
  queuedMediaDownloads.push({ bytes, task, resolve, reject });
  drainMediaDownloads();
});
const attachmentDeclaredSize = (attachment) => {
  const size = Number(attachment.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid attachment size");
  if (size > mediaMaxBytes) throw new Error(`larger than BOT_MEDIA_MAX_BYTES (${size} bytes)`);
  return size;
};
const validateCachedAttachmentPath = (filePath, declaredSize) => {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) throw new Error("cached attachment is not a regular file");
  if (stat.size !== declaredSize) throw new Error("cached attachment size does not match metadata");
  return filePath;
};
const cachedAttachmentPath = (id, declaredSize) => {
  const cached = mediaStore.find(id);
  if (!cached) return null;
  try { return validateCachedAttachmentPath(cached.path, declaredSize); }
  catch (error) {
    // Cache maintenance can remove an entry between find() and lstat(); that
    // is a miss, while malformed or size-mismatched entries are rejected.
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};
const downloadAttachment = (attachment) => {
  let declaredSize;
  try { declaredSize = attachmentDeclaredSize(attachment); }
  catch (error) { return Promise.reject(error); }
  try {
    const cached = cachedAttachmentPath(attachment.id, declaredSize);
    if (cached) return Promise.resolve(cached);
  } catch (error) { return Promise.reject(error); }
  const existing = inflightMediaDownloads.get(attachment.id);
  if (existing) return existing.then((filePath) => validateCachedAttachmentPath(filePath, declaredSize));
  const promise = queueMediaDownload(mediaMemoryReservation(declaredSize), async () => {
    // A previous identical job may have populated the cache while this job was
    // waiting for capacity.
    const present = cachedAttachmentPath(attachment.id, declaredSize);
    if (present) return present;
    const bytes = await downloadP2PFile({
      wssUrl: attachment.wssUrl,
      identifier: hexToBytes(attachment.id),
      claimTicket: hexToBytes(attachment.ticketHex),
      // The sender-provided file metadata is a strict cap, not merely a
      // scheduler hint. Otherwise tiny advertised files can reserve one byte
      // then make every worker buffer the global per-file maximum.
      maxBytes: declaredSize,
      deadlineMs: hopTimeoutMs,
      maxRpcFrameBytes: hopRpcFrameMaxBytes,
      allowInsecure: hopAllowInsecure,
      allowedNodes: hopAllowedNodes.length ? hopAllowedNodes : null,
      log,
    });
    if (bytes.length !== declaredSize) throw new Error("attachment size does not match metadata");
    const saved = mediaStore.save(attachment.id, bytes, attachment.mime);
    log("BOT_MEDIA_DOWNLOADED", { id: attachment.id.slice(0, 16), mime: attachment.mime, bytes: bytes.length });
    return saved;
  });
  inflightMediaDownloads.set(attachment.id, promise);
  // Keep failures observable to callers, while cleaning the single-flight map
  // without creating an unhandled rejected promise from `finally`.
  promise.finally(() => {
    if (inflightMediaDownloads.get(attachment.id) === promise) inflightMediaDownloads.delete(attachment.id);
  }).catch(() => {});
  return promise;
};

// Fetch each attachment into the media store, annotating the metadata in
// place ({downloaded, path} or {downloaded:false, error}). Failures are notes
// for the brain, never fatal — the message is already ACKed. Runs inside the
// per-peer work queue, after the ACK, so a slow node can't cause resend storms.
const fetchAttachments = async (attachments) => {
  for (const a of attachments ?? []) {
    try {
      a.downloaded = true;
      a.path = await downloadAttachment(a);
    } catch (e) {
      a.downloaded = false;
      a.error = String(e?.message ?? e);
      log("BOT_MEDIA_DOWNLOAD_FAILED", { id: a.id.slice(0, 16), error: a.error });
    }
  }
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- identity ----------
const seed = hexToBytes(seedHex);
const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
const hopUploadPair = deriveSr25519PairFromSeed(seed, "//allowance//bulletin//chat");
const identityPrivateKey = deriveX25519PrivateKey(seed);
const identityPublicKey = x25519PublicKeyFromPrivateKey(identityPrivateKey);
const identifierKey = encodeAccountEcdhKey(identityPublicKey);
const storedDevicePrivateKey = (() => {
  try {
    if (rawStoredState?.v !== 3 || typeof rawStoredState.devicePrivateKeyHex !== "string") return null;
    const value = hexToBytes(rawStoredState.devicePrivateKeyHex);
    return value.length === 32 ? value : null;
  } catch {
    return null;
  }
})();
const deviceKeypair = storedDevicePrivateKey == null
  ? generateX25519Keypair()
  : {
      privateKey: storedDevicePrivateKey,
      publicKey: x25519PublicKeyFromPrivateKey(storedDevicePrivateKey),
    };
const stateProtocolKeysReset = rawStoredState?.v === 2
  || (rawStoredState?.v === 3 && storedDevicePrivateKey == null);
if (stateProtocolKeysReset) {
  log("BOT_STATE_KEYS_RESET", { version: rawStoredState?.v ?? null, peers: rawStoredState?.peers?.length ?? 0 });
}
const accountId = wallet.publicKey;
const accountIdHex = norm(bytesToHex(accountId));
const hopUploadAccountIdHex = norm(bytesToHex(hopUploadPair.publicKey));
const username = env.BOT_USERNAME ?? "";
if (hopUploadNode) {
  log("BOT_HOP_UPLOAD_CONFIGURED", {
    account: `0x${hopUploadAccountIdHex}`,
    host: new URL(hopUploadNode).hostname,
    maxBytes: fileMaxBytes,
  });
}

// ---------- chain clients ----------
// Keep handles on BOTH providers so /health can read real socket state: the
// statement-store socket carries polling/submits, the papi socket carries
// identifier-key lookups (a bot with only the papi socket down is deaf to new
// peers). Note a disconnected socket does NOT fail requests — they're buffered
// and re-sent on reconnect — so socket state and per-call timeouts are the two
// outage signals; query success alone can't distinguish "empty" from "down".
const wsProvider = getWsProvider(endpoints);
const lazyClient = createLazyClient(wsProvider);
const statementStore = createPapiStatementStoreAdapter(lazyClient);
const papiProvider = getWsProvider(endpoints);
const socketConnected = (p) => p.getStatus?.().type === WsEvent.CONNECTED;
const chainConnected = () => socketConnected(wsProvider) && socketConnected(papiProvider);
const requestRpc = lazyClient.getRequestFn();
const papiClient = createPapiClient(papiProvider, metadataCache());
// The People-chain state the bot reads (identifier keys) comes through one
// seam, lib/people-directory.mjs: the chain via papi, or the sandbox's
// control API when the bot runs against the local sandbox. Nothing below
// issues a storage query directly.
const directory = sandbox
  ? createSandboxDirectory(sandboxUrl, { timeoutMs: queryTimeoutMs })
  : createChainDirectory(papiClient.getTypedApi(peopleDescriptor), { timeoutMs: queryTimeoutMs });
// Every chain submit shares the query deadline: submitAppStatement retries
// rejections, but a hung socket never rejects — it would await forever.
const submitBounded = (args) => withTimeout(submitAppStatement(requestRpc, args), queryTimeoutMs, "statement submit");

// Insertion-order eviction for the per-peer maps below: on a public bot peers
// accumulate for the life of the process, so unbounded maps are a slow leak.
const trimMap = (map, cap) => { while (map.size > cap) map.delete(map.keys().next().value); };

const IDENTIFIER_CACHE_CAP = 5000;
const identifierKeyCache = new Map(); // peerHex -> raw X25519 public key hex
const decodePeerIdentifierKey = (peerHex, encoded) => {
  try {
    const container = hexToBytes(encoded);
    const decoded = decodeAccountEcdhKey(container);
    if (decoded.kind !== "x25519") {
      log("BOT_PEER_KEY_UNSUPPORTED", { peer: norm(peerHex), reason: "unsupported_type", type: container[0] });
      return null;
    }
    return norm(bytesToHex(decoded.publicKey));
  } catch (error) {
    log("BOT_PEER_KEY_UNSUPPORTED", {
      peer: norm(peerHex),
      reason: "invalid_container",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
// Static peer->identifier-key pins: "peerhex=keyhex,..." — a pin cache in
// front of the directory for those peers (fixed-fleet setups, and the test
// that checks how an unsupported container is rejected).
for (const pair of String(env.BOT_PEER_IDENTIFIER_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const [peer, key] = pair.split("=");
  if (peer && key) {
    const decoded = decodePeerIdentifierKey(peer, key);
    if (decoded) identifierKeyCache.set(norm(peer), decoded);
  }
}
const resolveIdentifierKey = async (peerHex) => {
  const key = norm(peerHex);
  if (identifierKeyCache.has(key)) return identifierKeyCache.get(key);
  let value = null;
  try {
    const container = await directory.identifierKeyFor(key);
    value = container == null ? null : decodePeerIdentifierKey(key, container);
  } catch (error) {
    log("BOT_IDENTIFIER_LOOKUP_FAILED", { peer: key, error: error instanceof Error ? error.message : String(error) });
  }
  if (value) { identifierKeyCache.set(key, value); trimMap(identifierKeyCache, IDENTIFIER_CACHE_CAP); }
  return value;
};
// A chat request whose sender has no identifier key yet (a fresh signup, its
// registration not visible to this node yet) is held and the lookup retried
// with backoff until BOT_IDENTIFIER_RETRY_MS (lib/identifier-wait.mjs).
const identifierRetryMs = numberEnv("BOT_IDENTIFIER_RETRY_MS", DEFAULT_IDENTIFIER_RETRY_MS, { min: 1000, max: 86_400_000 });
const identifierWait = createIdentifierWait({
  lookup: resolveIdentifierKey,
  maxMs: identifierRetryMs,
  onFound: ({ sender, data, attempts, since }) => {
    log("BOT_OPENER_IDENTIFIER_FOUND", { from: sender, attempts, waitedMs: Date.now() - since });
    // Process the request again on the openers lane; the key is cached now.
    // A full dispatcher leaves it to the next sweep.
    const task = statementDispatcher.run("openers", () => dispatchStatement({ data }, null, { kind: "opener" }));
    task?.catch((error) => log("BOT_DISPATCH_FAILED", { error: String(error?.message ?? error) }));
  },
  onExpired: ({ sender, attempts }) => log("BOT_OPENER_NO_IDENTIFIER", { from: sender, attempts, windowMs: identifierRetryMs }),
});

// ---------- statement priority (monotonic, timestamp-based) ----------
const PRIORITY_OFFSET = 1_763_164_800n;
const PRIORITY_HIGH = 0xffff_ffff_0000_0000n;
let lastPriority = 0n;
const expiryFactory = (attempt = 0) => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const base = now > PRIORITY_OFFSET ? now - PRIORITY_OFFSET : 0n;
  let p = PRIORITY_HIGH | (base + BigInt(attempt));
  if (p <= lastPriority) p = lastPriority + 1n;
  lastPriority = p;
  return p;
};

// ---------- session state (peerDevices preserved across rebuilds) ----------
const sessions = new Map(); // peerHex -> { session, identifierKeyHex, lastActiveAt }
const touchSession = (peerHex) => {
  const entry = sessions.get(norm(peerHex));
  if (entry) entry.lastActiveAt = Date.now();
  return entry;
};
// Outbound timestamps never sort before the peer's newest message (see
// lib/peer-clock.mjs); every encoder below takes its timestamp from here.
const peerClock = createPeerClock();
const stamp = (peerHex) => peerClock.next(norm(peerHex));

const buildSession = (peerHex, identifierKeyHex, extraDevices = [], { replace = false } = {}) => {
  // `replace`: extraDevices IS the roster (a device was removed); otherwise
  // they are folded into the established one.
  const existing = replace ? [] : sessions.get(norm(peerHex))?.session?.peerDevices ?? [];
  // Device session topics are part of every sweep/subscription watch. Keep a
  // per-peer ceiling so one chat cannot turn device rotation into unbounded
  // memory and RPC fan-out. Preserve the established devices when full; the
  // identity session remains available for a later legitimate rotation.
  const peerDevices = existing.slice(0, MAX_PEER_DEVICES);
  // A device is the (statement account, encryption key) PAIR: the app reuses the
  // identity account as statement account, so keying on the account alone would
  // drop any additional/rotated device key for the same account.
  const deviceKey = (d) => `${bytesToHex(d.statementAccountId)}:${bytesToHex(d.encryptionPublicKey)}`;
  for (const d of extraDevices) {
    if (!peerDevices.some((e) => deviceKey(e) === deviceKey(d)) && peerDevices.length < MAX_PEER_DEVICES) peerDevices.push(d);
  }
  const session = makePeerSession({
    ownAccountId: accountId,
    peerAccountId: hexToBytes(peerHex),
    peerIdentifierKey: hexToBytes(identifierKeyHex),
    ownX25519PrivateKey: identityPrivateKey,
    ownDeviceX25519PrivateKey: deviceKeypair.privateKey,
    peerDevices,
  });
  sessions.set(norm(peerHex), { session, identifierKeyHex: norm(identifierKeyHex), lastActiveAt: Date.now() });
  return session;
};

// ---------- bridge inbound queue ----------
const INBOUND_CAP = numberEnv("BOT_INBOUND_CAP", 1000, { min: 1, max: 100_000 });
const BRIDGE_LEASE_MS = numberEnv("BOT_BRIDGE_LEASE_MS", 300_000, { min: 1000, max: 86_400_000 });
const BRIDGE_WAITER_CAP = numberEnv("BOT_BRIDGE_WAITER_CAP", 100, { min: 1, max: 10_000 });
const BRIDGE_DELIVERY_BATCH_CAP = numberEnv("BOT_BRIDGE_DELIVERY_BATCH_CAP", 32, { min: 1, max: 1000 });
// True when handleInbound hands messages to the HTTP bridge queue (no direct
// brain): backpressure must then watch inboundQueue, not the per-peer queues.
const usesBridgeQueue = brain !== "echo" && !engine;
const inboundQueue = [];
const waiters = new Set();
let leaseWakeTimer = null;
let bridgeAckTail = Promise.resolve();
const releaseExpiredInbound = () => {
  const now = Date.now();
  let released = 0;
  for (const entry of inboundQueue) {
    if (!entry.acknowledging && entry.leaseUntil != null && entry.leaseUntil <= now) {
      entry.leaseUntil = null;
      entry.leaseId = null;
      released += 1;
      log("BOT_BRIDGE_LEASE_EXPIRED", { deliveryId: entry.deliveryId });
    }
  }
  return released;
};
const bridgePayload = (entry) => {
  const { owedId, deliveryId, leaseId, leaseUntil, acknowledging, ...item } = entry;
  return { ...item, delivery_id: deliveryId, lease_id: leaseId, lease_ms: BRIDGE_LEASE_MS };
};
// A bridge consumer receives a lease, not ownership. It must acknowledge the
// delivery after the framework has durably accepted it; otherwise it becomes
// eligible for redelivery when the lease expires or the bot restarts.
const drainInbound = (includeEvents = false, limit = BRIDGE_DELIVERY_BATCH_CAP) => {
  releaseExpiredInbound();
  const now = Date.now();
  const items = [];
  for (const entry of inboundQueue) {
    if (items.length >= limit) break;
    if (entry.acknowledging || entry.leaseUntil != null) continue;
    entry.leaseId = makeAppUuid();
    entry.leaseUntil = now + BRIDGE_LEASE_MS;
    items.push(bridgePayload(entry));
  }
  scheduleLeaseWake();
  return includeEvents ? [...items, ...eventQueue.splice(0)] : items;
};
const finishWaiter = (waiter, value = null) => {
  if (!waiters.delete(waiter)) return;
  clearTimeout(waiter.timer);
  waiter.req?.off("aborted", waiter.abort);
  waiter.res?.off("close", waiter.close);
  waiter.resolve(value);
};
const wakeWaiters = () => {
  for (const waiter of waiters) {
    const items = drainInbound(waiter.events, waiter.limit);
    if (items.length > 0) { finishWaiter(waiter, items); break; }
  }
};
const scheduleLeaseWake = () => {
  if (leaseWakeTimer) { clearTimeout(leaseWakeTimer); leaseWakeTimer = null; }
  let next = null;
  for (const entry of inboundQueue) {
    if (!entry.acknowledging && entry.leaseUntil != null && (next == null || entry.leaseUntil < next)) next = entry.leaseUntil;
  }
  if (next == null) return;
  leaseWakeTimer = setTimeout(() => {
    leaseWakeTimer = null;
    if (releaseExpiredInbound() > 0) wakeWaiters();
    scheduleLeaseWake();
  }, Math.max(1, next - Date.now()));
  leaseWakeTimer.unref?.();
};
const enqueueInbound = (item) => {
  if (inboundQueue.length >= INBOUND_CAP) throw new Error("bridge inbound queue is full");
  inboundQueue.push({ ...item, deliveryId: makeAppUuid(), leaseId: null, leaseUntil: null, acknowledging: false });
  wakeWaiters();
};
// Non-message signals (reactions, coinage, leftChat, …) ride a separate,
// smaller queue delivered only to /inbound?events=1 pollers: a harness that
// doesn't opt in would run its agent on a reaction and chat-reply to it.
// Events are informational — never journaled, loss on crash is acceptable.
const EVENT_CAP = 200;
const eventQueue = [];
const enqueueEvent = (item) => {
  if (!usesBridgeQueue) return;
  eventQueue.push(item);
  if (eventQueue.length > EVENT_CAP) eventQueue.splice(0, eventQueue.length - EVENT_CAP);
  wakeWaiters();
};
const normalizeDeliveryClaims = (claims) => (Array.isArray(claims) ? claims : [claims])
  .map((claim) => {
    if (!claim || typeof claim !== "object") return null;
    const deliveryId = typeof claim.delivery_id === "string" ? claim.delivery_id : null;
    const leaseId = typeof claim.lease_id === "string" ? claim.lease_id : null;
    return deliveryId && leaseId ? { deliveryId, leaseId } : null;
  })
  .filter(Boolean);
// Acknowledge a lease only after the snapshot without its owed record has been
// durably committed. Serializing ACKs keeps overlapping poll workers from
// racing snapshots and makes a failed disk write leave the item re-deliverable.
const acknowledgeInbound = (claims) => {
  const run = async () => {
    // A claim belongs to its lease, not merely its delivery. Expire stale
    // leases before matching so a slow former consumer cannot ACK work that
    // is now available to another worker.
    if (releaseExpiredInbound() > 0) wakeWaiters();
    const wanted = new Map(normalizeDeliveryClaims(claims).map((claim) => [claim.deliveryId, claim.leaseId]));
    if (wanted.size === 0) return { acknowledged: 0, invalid: true, persisted: true };
    const accepted = inboundQueue.filter((entry) =>
      !entry.acknowledging && wanted.get(entry.deliveryId) === entry.leaseId && entry.leaseId != null);
    if (accepted.length === 0) return { acknowledged: 0, invalid: false, persisted: true };
    for (const entry of accepted) entry.acknowledging = true;
    const removedOwed = [];
    for (const entry of accepted) {
      if (!entry.owedId) continue;
      const owed = removeOwed(entry.owedId);
      if (owed) {
        removedOwed.push([entry.owedId, owed]);
      }
    }
    let persisted = false;
    try { persisted = await persistCritical(); }
    catch (error) { log("BOT_BRIDGE_ACK_PERSIST_FAILED", { error: String(error?.message ?? error) }); }
    if (!persisted) {
      for (const [owedId, owed] of removedOwed) restoreOwed(owedId, owed);
      for (const entry of accepted) entry.acknowledging = false;
      // Queue the restored snapshot so a later background flush cannot commit
      // the temporary deletion after this request reports failure.
      persist();
      if (releaseExpiredInbound() > 0) wakeWaiters();
      scheduleLeaseWake();
      return { acknowledged: 0, invalid: false, persisted: false };
    }
    const acceptedSet = new Set(accepted);
    for (let i = inboundQueue.length - 1; i >= 0; i -= 1) {
      if (acceptedSet.has(inboundQueue[i])) inboundQueue.splice(i, 1);
    }
    for (const entry of accepted) if (entry.owedId) queuedOwed.delete(entry.owedId);
    scheduleLeaseWake();
    pumpOwed();
    return { acknowledged: accepted.length, invalid: false, persisted: true };
  };
  const result = bridgeAckTail.catch(() => {}).then(run);
  bridgeAckTail = result.catch(() => {});
  return result;
};
// Renew an active lease while a framework is running an agent turn. This is
// deliberately separate from ACK: a slow, healthy turn must keep ownership,
// but a failed worker still becomes re-deliverable when renewals stop.
const renewInbound = (claims) => {
  if (releaseExpiredInbound() > 0) wakeWaiters();
  const wanted = new Map(normalizeDeliveryClaims(claims).map((claim) => [claim.deliveryId, claim.leaseId]));
  if (wanted.size === 0) return { renewed: 0, invalid: true };
  const now = Date.now();
  let renewed = 0;
  for (const entry of inboundQueue) {
    if (entry.acknowledging || entry.leaseId == null || wanted.get(entry.deliveryId) !== entry.leaseId) continue;
    entry.leaseUntil = now + BRIDGE_LEASE_MS;
    renewed += 1;
  }
  scheduleLeaseWake();
  return { renewed, invalid: false };
};

const isAllowed = (peerHex) => allowedPeers.size === 0 || allowedPeers.has(norm(peerHex));

// ---------- "thinking" ack for slow replies ----------
// Armed when a message arrives; fires only if nothing has been sent to that peer
// within thinkingAfterMs. Any outgoing text (sendText) disarms it, so fast
// replies — echo, a quick model, Hermes on a good day — produce no extra noise.
const thinkingTimers = new Map(); // peerHex -> timeout
const disarmThinking = (peerHex) => {
  const k = norm(peerHex);
  const t = thinkingTimers.get(k);
  if (t) { clearTimeout(t); thinkingTimers.delete(k); }
  // A fast reply (or a bridge file answer) can beat the placeholder entirely.
  // The tracker was created eagerly at turn start, so drop it here or this
  // peer's next slow turn would inherit this turn's start time and report an
  // inflated elapsed. A live placeholder owns its tracker and disposes it in
  // takeLivePlaceholder instead.
  if (!livePlaceholders.has(k)) disposeProgressTracker(k);
};
// Spec 0005 (revision 2026-09-23): a client that knows the bot (botInfo, spec
// 0008) shows its own local "working" state from its send until the reply,
// with no wire signal; with typing on, the typing indicator does the same. The
// placeholder then appears only for a turn longer than
// TYPING_PLACEHOLDER_AFTER_MS, and its first frame is the progress status, not
// the "thinking" text. With neither, it follows BOT_THINKING_AFTER_MS.
const clientShowsWorking = () => extensionOn("botinfo") || extensionOn("typing");
const placeholderAfterMs = () => (clientShowsWorking() ? Math.max(thinkingAfterMs, TYPING_PLACEHOLDER_AFTER_MS) : thinkingAfterMs);
const armThinking = (peerHex) => {
  const k = norm(peerHex);
  if (!thinkingText || !(thinkingAfterMs > 0) || thinkingTimers.has(k)) return;
  // Anchor the tracker here, not inside the timeout: the placeholder appears
  // thinkingAfterMs later, and everything before that — elapsed time and any
  // tool steps — belongs to this turn.
  progressTrackerFor(k);
  thinkingTimers.set(k, setTimeout(() => {
    thinkingTimers.delete(k);
    if (livePlaceholders.has(k)) return; // a previous turn's placeholder is still open
    // The placeholder is a LIVE message: it is edited through progress frames
    // and finally collapses to a short status receipt for the turn.
    livePlaceholders.set(k, (async () => {
      const handle = await liveReplies.begin(k, clientShowsWorking() ? progressTrackerFor(k).render() : thinkingText);
      // Already counting since turn start; attaching lets any pre-placeholder
      // work show up in the first visible frame.
      const tracker = progressTrackerFor(k);
      tracker.attach(handle);
      // Heartbeat: even with no tool events, the elapsed clock ticks so the
      // chat never looks stalled. Frames are throttled/coalesced downstream.
      const timer = setInterval(() => { if (!handle.finalized) handle.update(tracker.render()); }, liveHeartbeatMs);
      timer.unref?.();
      // TTL: a turn whose answer never arrives (dropped harness dispatch,
      // crashed brain) must not tick forever — resolve to a timeout note.
      // takeLivePlaceholder consumes exactly once, so this races safely with
      // the real delivery: whoever takes it first wins.
      const ttl = setTimeout(async () => {
        const lp = await takeLivePlaceholder(k);
        if (!lp) return;
        log("BOT_LIVE_TTL_EXPIRED", { to: k, messageId: lp.handle.messageId });
        lp.handle.finalize(liveTimeoutText).catch((e) => log("BOT_LIVE_FINALIZE_FAILED", { to: k, error: String(e?.message ?? e) }));
      }, liveTtlMs);
      ttl.unref?.();
      log("BOT_LIVE_PLACEHOLDER", { to: k, messageId: handle.messageId });
      return { handle, tracker, timer, ttl };
    })().catch((e) => {
      log("BOT_THINKING_FAILED", { error: String(e?.message ?? e) });
      return null;
    }));
  }, placeholderAfterMs()));
};

// ---------- outbound lanes (one statement per peer channel slot) ----------
// The statement store keeps ONE statement per (account, channel), so every
// message published on a peer's session request channel flows through that
// peer's outbound lane: at most one un-ACKed statement is current, later
// messages extend it (lossless slot replacement) or queue until the peer's
// session-response ACK frees the slot. Mirrors the mobile app's own
// OutgoingRequestQueue; see lib/outbound-lanes.mjs.
const outbound = createOutboundLanes({
  encodeBatch: (peerHex, requestId, opaques, { forceIdentity }) => {
    const entry = sessions.get(norm(peerHex));
    if (entry == null) throw new Error("no active session for peer");
    return encodeSessionRequestPayload(entry.session, requestId, opaques, forceIdentity ? { forceIdentity: true } : {});
  },
  submitPayload: async (peerHex, payload, { forceIdentity }) => {
    const entry = sessions.get(norm(peerHex));
    if (entry == null) throw new Error("no active session for peer");
    const transport = forceIdentity || (entry.session.peerDevices?.length ?? 0) === 0
      ? entry.session.identitySession
      : entry.session;
    await submitBounded({
      walletPair: wallet,
      channel: transport.requestChannel,
      topics: [transport.ownSessionId],
      scaleEncodedPayload: payload,
      expiryFactory,
    });
  },
  makeRequestId: makeAppUuid,
  // Liveness backstop: with messages queued behind an un-ACKed statement,
  // take the slot over after this long (a conformant app ACKs in seconds).
  ackGraceMs: numberEnv("BOT_OUTBOUND_ACK_GRACE_MS", 60_000, { min: 1000, max: 86_400_000 }),
  log,
});

// ---------- protocol extensions (RFC-0003, specs 0005, 0006 and 0008) ----------
// Receiving every extension kind is always on. SENDING follows the desktop
// spec set's development-mode rule: every client is in development, so the
// bot sends each enabled extension to every peer, with no per-peer evidence.
// BOT_PROTOCOL_EXTENSIONS: unset = all but typing (deleted, buttons, seen, botinfo, txref, groups),
// "none" = none, or a comma list (only a list can add typing). See docs/explanation/protocol.md.
const protocolExtensions = parseProtocolExtensions(env.BOT_PROTOCOL_EXTENSIONS);
const extensionOn = (name) => protocolExtensions.enabled.has(name);
if (protocolExtensions.unknown.length) log("BOT_PROTOCOL_EXTENSIONS_UNKNOWN", { names: protocolExtensions.unknown });
log("BOT_PROTOCOL_EXTENSIONS", { enabled: [...protocolExtensions.enabled] });
// Which peers sent an extension kind: logged once per peer, gates nothing.
const extensionObserver = createExtensionObserver();
const observeExtension = (peerHex, kind) => {
  if (extensionObserver.observe(norm(peerHex), kind)) log("BOT_PROTOCOL_EXTENSION_OBSERVED", { peer: norm(peerHex), kind });
};
// Only receive-side debug events use this: a composing peer sends a typing
// every few seconds, too noisy for the default log.
const logDebug = env.BOT_LOG_LEVEL === "debug" ? (event, extra = {}) => log(event, { level: "debug", ...extra }) : () => {};

// ---------- spec 0005 typing and seen (sender side) ----------
// Ephemeral: straight into the outbound lane, never journaled as an answer
// (see lib/typing-seen.mjs). Typing is off unless the operator lists it. A
// pending seen rides the next real message (submitMessage calls
// replyGoingOut just before its enqueue), so a reply costs one submission,
// however long the brain turn takes: handleInbound and a running turn hold it.
const typingAndSeen = createTypingAndSeen({
  typing: extensionOn("typing"),
  seen: extensionOn("seen"),
  enqueue: (peerHex, opaque, options) => outbound.enqueue(norm(peerHex), opaque, options),
  encodeTyping: encodeOpaqueTypingMessage,
  encodeSeen: encodeOpaqueSeenMessage,
  makeId: makeAppUuid,
  stamp,
  maxTurnMs: liveTtlMs,
  log,
});

// ---------- RFC-0003 message deletion ----------
// Receiving a deletion is always on; sending one needs the `deleted` extension.
const deletions = createDeletionLedger();
const retractOwn = createMessageDeleter({
  outbound,
  enabled: extensionOn("deleted"),
  encode: encodeOpaqueDeletedMessage,
  makeId: makeAppUuid,
  stamp,
  log,
});
// Retract one of the bot's own messages. A journaled owed answer holding it
// is trimmed first, so a restart cannot re-send what the bot retracted.
const deleteMessage = async (peerHex, messageId) => {
  const k = norm(peerHex);
  if (sessions.get(k) == null) throw new Error("no active session for peer");
  for (const owed of owedReplies.values()) {
    if (norm(owed.peerHex) !== k || !owed.answer?.some((a) => a.messageId === messageId)) continue;
    owed.answer = owed.answer.filter((a) => a.messageId !== messageId);
    persist();
  }
  return retractOwn(k, messageId);
};

// ---------- spec 0006 buttons ----------
// A brain puts a buttons block in its reply (lib/buttons-block.mjs,
// extractButtonsBlock: lenient fence tag, shape and place). A
// peer with the extension gets ONE kind-242 message; any other peer gets the
// spec's fallback (the text, then the labels as a numbered list). Kind 242
// goes out whenever the `buttons` extension is on (the default).
// sentButtons remembers the bot's own buttons messages, so a buttonPress is
// accepted only for one of them, from the peer it went to.
const sentButtons = createSentButtons();
const prepareReply = (peerHex, text, { allowButtons = true } = {}) => {
  const parsed = extractButtonsBlock(text);
  if (!parsed) return { text, buttons: null };
  if (parsed.invalid.length > 0) log("BOT_BUTTONS_INVALID", { to: peerHex, reason: parsed.invalid.join("; ") });
  if (!parsed.rows) return { text: parsed.text, buttons: null };
  if (allowButtons && extensionOn("buttons")) {
    return { text: parsed.text, buttons: { rows: parsed.rows, oneShot: parsed.oneShot } };
  }
  log("BOT_BUTTONS_FALLBACK", { to: peerHex, buttons: parsed.rows.flat().length });
  return { text: buttonsFallbackText(parsed.text, parsed.rows), buttons: null };
};

// ---------- spec 0008 bot info ----------
// The bot's own document comes from the operator-owned botinfo.json in the
// workspace (lib/bot-info.mjs), re-read for each send so an edit applies to
// the next accept or /start. It goes out on request accept, on /start, and
// (catch-up) with the next reply to a peer that has not received the current
// version. A peer's botInfo (another bot) is stored per peer and never answered.
const botInfoDefaults = defaultBotInfo({ name: username, brain });
const peerBotInfo = createPeerBotInfo();
// The version of our botInfo last sent to each peer (`bs` in session state).
const botInfoSent = createBotInfoSent();
// null when the extension is off or the file is invalid (logged, not sent).
const currentBotInfo = () => {
  if (!extensionOn("botinfo")) return null;
  try {
    const info = loadBotInfo({ dir: aiWorkspace, defaults: botInfoDefaults });
    if (info.changed) log("BOT_BOTINFO_VERSION", { version: info.version, ...(info.stateError ? { stateError: info.stateError } : {}) });
    return info;
  } catch (error) {
    log("BOT_BOTINFO_INVALID", { error: String(error?.message ?? error) });
    return null;
  }
};
// Spec 0008 v3: a meter bot's hint carries the user's pending debit (what
// the client subtracts from the chain balance); `pending` overrides it.
const encodeBotInfo = (peerHex, info, pending = meter?.pendingHint(norm(peerHex)) ?? null) => encodeOpaqueBotInfoMessage({
  timestamp: stamp(peerHex),
  kind: info.kind,
  name: info.name,
  description: info.description,
  greeting: info.greeting,
  commands: info.commands,
  version: info.version,
  balance: info.balance ? { ...info.balance, pending } : null,
});
// Spec 0008 catch-up: called in the same tick as a reply's enqueue, so the
// botInfo rides the reply's statement, ahead of it. Marked before the send,
// so two concurrent replies never both carry it; a failed send reverts.
// Spec 0008 v3: with `pending` (a metered reply or a charge's reference) a
// hint-carrying botInfo goes out even at the same version, with that pending.
const catchUpBotInfo = (peerHex, pending = null) => {
  const k = norm(peerHex);
  const info = currentBotInfo();
  const withPending = pending != null && info?.balance != null;
  if (!info || (!withPending && !botInfoSent.needs(k, info.version))) return;
  const previous = botInfoSent.mark(k, info.version);
  outbound.enqueue(k, withPending ? encodeBotInfo(k, info, pending) : encodeBotInfo(k, info)).submitted.then(() => {
    log("BOT_SENT_BOTINFO", { to: peerHex, version: info.version, on: withPending ? "pending" : "catch-up", ...(withPending ? { pending: String(pending) } : {}) });
    persist();
  }, (error) => {
    botInfoSent.revert(k, info.version, previous);
    log("BOT_BOTINFO_SEND_FAILED", { to: peerHex, error: String(error?.message ?? error) });
  });
};
const START_RE = /^\s*\/start\s*$/i;
{
  // Surface an invalid botinfo.json at startup, not at the first chat.
  const info = currentBotInfo();
  if (info) log("BOT_BOTINFO", { kind: info.kind, version: info.version, commands: info.commands.length, ...(info.balance ? { balance: `${info.balance.contract}.${info.balance.selector}` } : {}) });
}

// ---------- send a reply to a peer ----------
// Returns the outgoing envelope messageId (an app UUID) so callers — notably
// POST /send — hand the brain an id it can later edit or that the peer can
// react to, plus a `delivered` promise that resolves true once the peer ACKed
// the statement carrying the message. replyTo quotes a peer message; editOf
// rewrites one of our own; supersedes drops never-fetched messages from the
// slot (live-reply fallback). Sent during an owed turn, the message is that
// inbound's answer and is journaled before the lane takes it (see
// journalAnswer); `ephemeral` opts a placeholder/progress frame out.
const submitMessage = async (peerHex, { text, replyTo = null, editOf = null, supersedes = [], ephemeral = false, buttons = null }) => {
  const k = norm(peerHex);
  if (sessions.get(k) == null) throw new Error("no active session for peer");
  const messageId = makeAppUuid();
  const timestamp = stamp(k);
  const opaque = buttons
    ? encodeOpaqueButtonsMessage({ messageId, timestamp, text, rows: buttons.rows, oneShot: buttons.oneShot })
    : replyTo
      ? encodeOpaqueReplyMessage({ messageId, timestamp, replyToMessageId: replyTo, text })
      : editOf
        ? encodeOpaqueEditedMessage({ messageId, timestamp, targetMessageId: editOf, text })
        : encodeOpaqueTextMessage({ messageId, timestamp, text });
  // Recorded before the journal write, so the persisted state that holds
  // this answer also holds the record a later press is checked against.
  if (buttons) sentButtons.record(k, messageId, buttons.rows);
  if (!ephemeral) await journalAnswer(k, { messageId, opaque, supersedes });
  // Spec 0005: a pending seen joins this message's statement; a real message
  // ends the turn's typing and drops any typing the peer has not fetched yet
  // from the slot. Not journaled: after a restart those entries are gone anyway.
  const typingIds = ephemeral ? [] : typingAndSeen.replyGoingOut(k);
  // Spec 0008: an edit follows a message that already carried the catch-up.
  // v3: the first real message of a metered turn (an edit too: the final
  // answer of a live placeholder) carries the pending debit with this reply.
  const meteredPending = !ephemeral && meteredReplyDue.delete(k) ? meter?.pendingHint(k, 1) ?? null : null;
  if (!editOf || meteredPending != null) catchUpBotInfo(k, meteredPending);
  const { submitted, delivered } = outbound.enqueue(k, opaque, { messageId, supersedes: [...supersedes, ...typingIds] });
  await submitted;
  log(buttons ? "BOT_SENT_BUTTONS" : "BOT_SENT_TEXT", {
    to: peerHex,
    chars: text.length,
    ...(buttons ? { messageId, buttons: buttons.rows.flat().length, oneShot: buttons.oneShot } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(editOf ? { editOf } : {}),
  });
  return { messageId, delivered };
};
const sendMessage = async (peerHex, opts) => {
  disarmThinking(peerHex); // a real reply is going out — no placeholder needed
  return (await submitMessage(peerHex, opts)).messageId;
};
const sendText = (peerHex, text) => sendMessage(peerHex, { text });

// ---------- spec 0009 fan-out groups ----------
// The bot is one member of a group room (lib/groups.mjs holds the rules). It
// learns a group from the admin's groupInfo, answers a member's
// groupMessage with one brain turn under a per-group session key, and fans
// the answer out as groupMessage copies (one envelope id) over the pairwise
// sessions. A member without a session gets a chat request first; its text
// is the fallback form of the bot's botInfo.
// Open a chat request to `peerHex` (the bot is the initiator). The session is
// built first, so messages enqueued after this ride it once the peer accepts.
const openChatRequest = async (peerHex, text) => {
  const identifierKeyHex = await resolveIdentifierKey(peerHex);
  if (!identifierKeyHex) throw new Error("peer has no identifier key");
  const peerAccount = hexToBytes(peerHex);
  const session = buildSession(peerHex, identifierKeyHex);
  addSessionWatch(peerHex);
  ingress?.resubscribe();
  const { payload } = encodeNativeChatRequestV2({
    walletPair: wallet,
    botAccountId: peerAccount,           // the codec's "bot" is simply the recipient
    botIdentifierKey: hexToBytes(identifierKeyHex),
    ownX25519PrivateKey: identityPrivateKey,
    ownDeviceX25519PublicKey: deviceKeypair.publicKey,
    text,
  });
  const today = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
  const topics = [chatRequestAllPeerStatementsTopic(peerAccount)];
  if (today != null) topics.push(chatRequestPaginationTopic(peerAccount, today));
  await submitBounded({
    walletPair: wallet,
    channel: session.identitySession.outgoingRequestChannel,
    topics,
    scaleEncodedPayload: payload,
    expiryFactory,
  });
};
const botInfoOpenerText = () => {
  const info = currentBotInfo() ?? botInfoDefaults;
  return [info.name, info.description].filter(Boolean).join(" — ");
};
const groupRequests = new Map(); // peerHex -> in-flight request, one per member
const ensureGroupSession = async (peerHex) => {
  const k = norm(peerHex);
  if (sessions.has(k)) return;
  let pending = groupRequests.get(k);
  if (!pending) {
    pending = openChatRequest(k, botInfoOpenerText()).then(
      () => { persist(); log("BOT_GROUP_REQUEST_OPENED", { to: k }); },
      (error) => { sessions.delete(k); throw error; },
    ).finally(() => groupRequests.delete(k));
    groupRequests.set(k, pending);
  }
  await pending;
};
// The last group typing sent to each member: the next typing or message
// supersedes it, so a member that never fetches cannot fill its lane with
// typing and block the answer (as lib/typing-seen.mjs does in 1:1 chats).
const groupTypingIds = new Map(); // peerHex -> envelope id
const groups = createGroups({
  selfHex: accountIdHex,
  deliver: async (peerHex, opaque, { messageId, ephemeral }) => {
    const k = norm(peerHex);
    // Typing never opens a chat.
    if (ephemeral && !sessions.has(k)) return;
    await ensureGroupSession(k);
    const previous = groupTypingIds.get(k);
    if (ephemeral) {
      groupTypingIds.set(k, messageId);
      trimMap(groupTypingIds, SEEN_CAP);
    } else groupTypingIds.delete(k);
    await outbound.enqueue(k, opaque, { messageId, supersedes: previous ? [previous] : [] }).submitted;
  },
  makeId: makeAppUuid,
  log,
});
// An allowlisted bot also serves the members of a group whose admin it
// allows, for group kinds only.
const groupAdmitted = (peerHex) => extensionOn("groups") && !isAllowed(peerHex)
  && (groups.admits(norm(peerHex), isAllowed) || groupsV2.admits(norm(peerHex), isAllowed));

// ---------- spec 0011 private groups v2 ----------
// The bot is a member of a group whose epoch key reached it in a `welcome`
// (kind 249) over the DM session; lib/groups-v2.mjs holds every rule. The
// wire here: group statements go straight to the store on the group topic
// (they are not session messages, so no outbound lane: each member owns one
// carrier slot per group and replaces it), with the base spec's Expiry at
// now + 14 days; kind-249 controls ride the peer's outbound lane.
const groupExpiry = groupExpiryFactory();
const sendGroupControl = async (peerHex, control) => {
  const k = norm(peerHex);
  await ensureGroupSession(k);
  const messageId = makeAppUuid();
  await outbound.enqueue(k, encodeOpaqueGroupControlMessage({ messageId, timestamp: stamp(k), control }), { messageId }).submitted;
};
const groupsV2 = createGroupsV2({
  selfHex: accountIdHex,
  isAllowed: (peerHex) => isAllowed(peerHex),
  // K(bot, peer): the raw X25519 agreement of the two identity chat keys.
  pairwiseKey: async (peerHex) => {
    const key = await resolveIdentifierKey(peerHex);
    return key ? pairwiseSecret(identityPrivateKey, hexToBytes(key)) : null;
  },
  submit: ({ topic, channel, data }) => submitBounded({
    walletPair: wallet, channel, topics: [topic], scaleEncodedPayload: scaleEncodeBytes(data), expiryFactory: groupExpiry,
  }),
  sendControl: sendGroupControl,
  log,
});
// The session key a group turn runs under: v1 and v2 share the scheme.
const groupV2ByKey = (groupIdOrKey) => {
  const key = String(groupIdOrKey ?? "").toLowerCase();
  return groupsV2.list().find((g) => g.groupId === groupIdOrKey || groupSessionKey(g.groupId) === key) ?? null;
};
const groupContextFor = (groupIdOrKey) => {
  const v2 = groupV2ByKey(groupIdOrKey);
  return v2 ? groupsV2.contextFor(v2.groupId) : groups.contextFor(groupIdOrKey);
};
// Outgoing v2 messages merge per group: a send the group refuses for now
// (one statement per second; slow mode for a role-0 bot) waits and goes
// out with whatever else queued meanwhile, as ONE statement.
const v2Outbox = new Map(); // groupId -> { opaques, waiters, timer }
const flushGroupV2 = async (groupId) => {
  const box = v2Outbox.get(groupId);
  if (!box) return;
  box.timer = null;
  let opaques = box.opaques.splice(0);
  let waiters = box.waiters.splice(0);
  try {
    let result = await groupsV2.send(groupId, opaques);
    // Several parts that do not fit one 4 KB carrier: the first half now,
    // the rest in the next statement.
    if (!result.ok && result.reason === "too-large" && opaques.length > 1) {
      const half = Math.ceil(opaques.length / 2);
      box.opaques.unshift(...opaques.slice(half));
      box.waiters.unshift(...waiters);
      waiters = [];
      opaques = opaques.slice(0, half);
      result = await groupsV2.send(groupId, opaques);
      if (!box.timer) box.timer = setTimeout(() => flushGroupV2(groupId), 1000);
    }
    if (!result.ok && result.retryInMs != null) {
      box.opaques.unshift(...opaques);
      box.waiters.unshift(...waiters);
      log("BOT_GROUP2_SEND_WAIT", { group: groupId, reason: result.reason, retryInMs: result.retryInMs });
      if (!box.timer) box.timer = setTimeout(() => flushGroupV2(groupId), result.retryInMs);
      return;
    }
    if (!result.ok) throw new Error(`group send refused: ${result.reason}`);
    persist();
    for (const w of waiters) w.resolve(result);
  } catch (error) {
    log("BOT_GROUP2_SEND_FAILED", { group: groupId, error: String(error?.message ?? error) });
    for (const w of waiters) w.reject(error);
  }
};
const sendToGroupV2 = (groupId, opaques) => new Promise((resolve, reject) => {
  let box = v2Outbox.get(groupId);
  if (!box) { box = { opaques: [], waiters: [], timer: null }; v2Outbox.set(groupId, box); }
  box.opaques.push(...opaques);
  box.waiters.push({ resolve, reject });
  if (!box.timer) box.timer = setTimeout(() => flushGroupV2(groupId), 0);
});
// A carrier holds 4096 bytes of plaintext; parts stay well under it.
const GROUP_V2_PART_BYTES = 3000;
const deliverToGroupV2 = async (groupId, reply) => {
  const key = groupSessionKey(groupId);
  const { text, buttons } = prepareReply(key, reply);
  const parts = splitMessageText(text, Math.min(replyChunkBytes, GROUP_V2_PART_BYTES));
  const opaques = parts.map((part, i) => {
    const withButtons = buttons && i === parts.length - 1;
    const messageId = makeAppUuid();
    const timestamp = Date.now() + i; // one statement, in order
    if (withButtons) sentButtons.record(key, messageId, buttons.rows);
    return {
      messageId,
      opaque: withButtons
        ? encodeOpaqueButtonsMessage({ messageId, timestamp, text: part, rows: buttons.rows, oneShot: buttons.oneShot })
        : encodeOpaqueTextMessage({ messageId, timestamp, text: part }),
    };
  });
  await sendToGroupV2(groupId, opaques.map((o) => o.opaque));
  return opaques[0]?.messageId ?? null;
};
// A statement on a group topic (subscription or sweep).
const handleGroupStatement = async (st) => {
  if (!extensionOn("groups")) return;
  const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
  const topic = (st.topics ?? []).map(topicHex).find((t) => groupsV2.hasTopic(t));
  if (!topic) return;
  const res = await groupsV2.receive({
    topicHex: topic,
    channelHex: st.channel == null ? "" : topicHex(st.channel),
    signerHex: st.proof?.value?.signer == null ? "" : topicHex(st.proof.value.signer),
    data,
  });
  await actOnGroupResults([res, ...(res.drained ?? [])]);
};
const actOnGroupResults = async (results) => {
  let changed = false;
  for (const r of results) {
    if (r.outcome === "own" || r.outcome === "unknown-topic") continue;
    const quiet = r.outcome === "held" || r.outcome === "duplicate" || r.outcome === "stale";
    (quiet ? logDebug : log)("BOT_GROUP2_STATEMENT", { group: r.groupId, epoch: r.epoch, outcome: r.outcome, ...(r.from ? { from: r.from, messages: r.messages?.length ?? 0 } : {}), ...(r.error ? { error: r.error } : {}) });
    if (r.gap) log("BOT_GROUP2_GAP", { group: r.groupId, from: r.from });
    if (r.outcome === "applied" || r.outcome === "rekeyed" || r.outcome === "fork" || r.outcome === "accepted") changed = true;
    if (r.outcome !== "accepted") continue;
    for (const f of r.messages) {
      if (!f.answerable) continue;
      const turn = groupTurnFrom(r.groupId, f.from, f.from.slice(0, 8), f.message);
      if (!turn) continue;
      const id = `g2:${r.groupId}:${f.from}:${f.message.messageId}`;
      if (seenRequests.has(id)) continue;
      if (!reserveAdmission(f.from)) { log("BOT_GROUP2_TURN_DROPPED", { group: r.groupId, from: f.from, reason: "busy" }); continue; }
      if (!oweReply(id, f.from, turn, null)) { releaseBridgeReservation(); log("BOT_GROUP2_TURN_DROPPED", { group: r.groupId, from: f.from, reason: "owed-full" }); continue; }
      seenRequests.add(id);
      trimSet(seenRequests, SEEN_CAP);
      await persistCritical();
      log("BOT_GROUP2_RECEIVED", { group: r.groupId, from: f.from, messageId: f.message.messageId, kind: f.message.kind });
      enqueueOwed(f.from, id, turn, null, { reservedBridge: usesBridgeQueue });
    }
  }
  if (changed) { ingress?.resubscribe(); persist(); }
};
// Read the group topics now (after a welcome or a rekey), not at the next sweep.
const fetchGroupTopics = async () => {
  const topics = groupsV2.topics();
  for (let i = 0; i < topics.length; i += TOPIC_BATCH) {
    const statements = await queryTopics(topics.slice(i, i + TOPIC_BATCH));
    for (const st of statements ?? []) {
      const key = fp(typeof st.data === "string" ? hexToBytes(st.data) : st.data);
      if (seenStatements.has(key)) continue;
      await handleGroupStatement(st);
      noteSeenStatement(key);
    }
  }
};
// One kind-249 control from `peerHex` over its DM session.
const handleGroupControl = async (peerHex, m) => {
  const from = norm(peerHex);
  const [variant] = Object.keys(m.control);
  const c = m.control[variant];
  try {
    if (variant === "welcome") {
      const outcome = groupsV2.welcome(from, c);
      log("BOT_GROUP2_WELCOME_RECEIVED", { from, group: c.groupId, epoch: c.epoch, outcome });
      if (outcome === "welcomed" || outcome === "rekeyed") {
        persist();
        ingress?.resubscribe();
        await fetchGroupTopics();
      }
    } else if (variant === "keyRequest") {
      log("BOT_GROUP2_KEY_REQUEST", { from, group: c.groupId, haveEpoch: c.haveEpoch, outcome: await groupsV2.keyRequest(from, c) });
    } else if (variant === "historyRequest") {
      const pages = groupsV2.historyPages(from, c);
      for (const page of pages) await sendGroupControl(from, page);
      log("BOT_GROUP2_HISTORY_SENT", { from, group: c.groupId, pages: pages.length, items: pages.reduce((n, p) => n + p.history.items.length, 0) });
    } else if (variant === "joinRequest") {
      log("BOT_GROUP2_JOIN_REQUEST", { from, group: c.groupId, outcome: await groupsV2.joinRequest(from, c) });
      persist();
    } else {
      log("BOT_GROUP2_CONTROL_IGNORED", { from, group: c.groupId, variant });
    }
  } catch (error) {
    log("BOT_GROUP2_CONTROL_FAILED", { from, group: c?.groupId, variant, error: String(error?.message ?? error) });
  }
};
// Fan one inner content out. One timestamp for every copy, never below what
// any member last sent (lib/peer-clock.mjs).
const sendToGroup = async (groupId, inner, { kind, ephemeral = false, messageId } = {}) => {
  const timestamp = groups.targets(groupId).reduce((max, peerHex) => {
    const t = stamp(peerHex);
    return t > max ? t : max;
  }, BigInt(Date.now()));
  const sent = await groups.send(groupId, inner, { ephemeral, timestamp, ...(messageId ? { messageId } : {}) });
  if (sent.messageId) {
    (ephemeral ? logDebug : log)("BOT_GROUP_SENT", { group: groupId, kind, messageId: sent.messageId, seq: sent.seq, to: sent.to, ...(sent.failed.length ? { failed: sent.failed } : {}) });
  }
  return sent;
};
// A brain answer to the group: chunked, with a trailing ```buttons block on
// the last part (spec 0006), as in deliverToChat. Resolves the first id.
const deliverToGroup = async (groupId, reply) => {
  if (groupsV2.get(groupId)) return deliverToGroupV2(groupId, reply);
  const key = groupSessionKey(groupId);
  const { text, buttons } = prepareReply(key, reply);
  const parts = splitMessageText(text, replyChunkBytes);
  let firstId = null;
  for (const [i, part] of parts.entries()) {
    const withButtons = buttons && i === parts.length - 1;
    const messageId = makeAppUuid();
    // Inner ids and timestamps are dropped by the wrapper (the envelope's count).
    const inner = withButtons
      ? encodeOpaqueButtonsMessage({ messageId, timestamp: 0, text: part, rows: buttons.rows, oneShot: buttons.oneShot })
      : encodeOpaqueTextMessage({ messageId, timestamp: 0, text: part });
    if (withButtons) sentButtons.record(key, messageId, buttons.rows);
    const sent = await sendToGroup(groupId, inner, { kind: withButtons ? "buttons" : "text", messageId });
    firstId ??= sent.messageId;
  }
  return firstId;
};
// Typing fans out (spec 0009); seen does not. Refreshed while the turn runs.
const groupTyping = new Map(); // groupId -> interval
const sendGroupTyping = (groupId, kind) => {
  const inner = encodeOpaqueTypingMessage({ messageId: "typing", timestamp: 0, until: Date.now() + TYPING_TTL_MS, kind });
  sendToGroup(groupId, inner, { kind: "typing", ephemeral: true }).catch((e) => log("BOT_GROUP_TYPING_FAILED", { group: groupId, error: String(e?.message ?? e) }));
};
const beginGroupTurn = (groupId) => {
  // 0011: typing is not sent in v2 groups.
  if (!extensionOn("typing") || groupTyping.has(groupId) || groupsV2.get(groupId)) return () => {};
  sendGroupTyping(groupId, TYPING_KINDS.working);
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > liveTtlMs) { clearInterval(timer); groupTyping.delete(groupId); return; }
    sendGroupTyping(groupId, TYPING_KINDS.working);
  }, TYPING_MIN_INTERVAL_MS);
  timer.unref?.();
  groupTyping.set(groupId, timer);
  return () => {};
};
const endGroupTurn = (groupId) => {
  const timer = groupTyping.get(groupId);
  if (timer) { clearInterval(timer); groupTyping.delete(groupId); }
};
// On join: the bot's botInfo, wrapped, so every member learns its commands.
const announceToGroup = (groupId) => {
  const info = currentBotInfo();
  if (!info) return;
  const inner = encodeOpaqueBotInfoMessage({
    messageId: "botinfo", timestamp: 0, kind: info.kind, name: info.name, description: info.description,
    greeting: info.greeting, commands: info.commands, version: info.version, balance: info.balance ?? null,
  });
  sendToGroup(groupId, inner, { kind: "botInfo" }).catch((e) => log("BOT_GROUP_SEND_FAILED", { group: groupId, error: String(e?.message ?? e) }));
};
// One decoded group kind from `peerHex`. Returns the brain message for a
// groupMessage that runs a turn, else null.
const receiveGroupContent = (peerHex, m) => {
  const from = norm(peerHex);
  if (m.kind === "groupInfo") {
    const outcome = groups.applyInfo(from, m);
    const event = { joined: "BOT_GROUP_JOINED", updated: "BOT_GROUP_UPDATED", removed: "BOT_GROUP_REMOVED" }[outcome] ?? "BOT_GROUP_INFO_IGNORED";
    log(event, { from, group: m.groupId, name: m.name, version: m.version, members: m.members.length, ...(event === "BOT_GROUP_INFO_IGNORED" ? { reason: outcome } : {}) });
    if (outcome === "removed") endGroupTurn(m.groupId);
    if (outcome === "joined") announceToGroup(m.groupId);
    return null;
  }
  if (m.kind === "groupLeave") {
    const outcome = groups.applyLeave(from, m.groupId);
    log(outcome === "left" ? "BOT_GROUP_MEMBER_LEFT" : "BOT_GROUP_LEAVE_IGNORED", { from, group: m.groupId, ...(outcome !== "left" ? { reason: outcome } : {}) });
    return null;
  }
  const accepted = groups.acceptMessage(from, m);
  if (!accepted.ok) {
    log("BOT_GROUP_MESSAGE_REJECTED", { from, group: m.groupId, messageId: m.messageId, reason: accepted.reason });
    return null;
  }
  if (accepted.gap) log("BOT_GROUP_SEQ_GAP", { from, group: m.groupId, seq: m.seq });
  const c = m.content;
  if (c.kind === "typing" || c.kind === "seen") {
    logDebug("BOT_GROUP_RECEIVED", { from, group: m.groupId, kind: c.kind });
    return null;
  }
  log("BOT_GROUP_RECEIVED", { from, group: m.groupId, messageId: m.messageId, seq: m.seq, kind: c.kind });
  return groupTurnFrom(m.groupId, from, accepted.sender.username || from.slice(0, 8), { ...c, messageId: m.messageId });
};
// The brain message for one group content (v1 unwrapped, or a v2 carrier
// item), or null for contents that are never answered.
const groupTurnFrom = (groupId, from, sender, c) => {
  const base = { messageId: c.messageId, kind: "text", group: { id: groupId, sender } };
  if (c.kind === "buttonPress") {
    const label = sentButtons.label(groupSessionKey(groupId), c.targetMessageId, c.row, c.index);
    if (label == null) {
      log("BOT_BUTTON_PRESS_IGNORED", { from, group: groupId, messageId: c.targetMessageId, reason: "not a button this bot sent to this group" });
      return null;
    }
    return { ...base, text: buttonPressText(label, c.payload) };
  }
  const inner = c.kind === "buttons" ? { ...c, kind: "text", text: buttonsFallbackText(c.text, c.rows) } : c;
  const attachments = (inner.richText?.attachments ?? []).filter((a) => a.kind === "p2pMixnetFile").map(toAttachmentMeta);
  const isBrainKind = ["text", "richText", "reply", "edited"].includes(inner.kind)
    && typeof inner.text === "string" && (inner.text.length > 0 || attachments.length > 0);
  // Reactions, deletions, botInfo, tx references: logged above, never answered.
  if (!isBrainKind) return null;
  return { ...base, text: inner.text, ...(attachments.length ? { attachments } : {}) };
};
// A group turn: the brain sees "[group <name>] <sender>: <text>" under the
// group's own session key, and every reply goes to the whole group.
const handleGroupInbound = async (peerHex, msg, owedId, { reservedBridge = false } = {}) => {
  const groupId = msg.group.id;
  const v2 = groupsV2.get(groupId);
  const group = v2 ? (v2.status === "member" ? { name: v2.state.name } : null) : groups.get(groupId);
  if (!group || (!v2 && groups.targets(groupId).length === 0)) {
    log("BOT_GROUP_TURN_SKIPPED", { from: norm(peerHex), group: groupId, reason: group ? "not sending to this group" : "unknown-group" });
    if (reservedBridge) releaseBridgeReservation();
    if (usesBridgeQueue && owedId) settleOwed(owedId);
    return;
  }
  await fetchAttachments(msg.attachments);
  const text = `[group ${group.name}] ${msg.group.sender}: ${msg.text}`;
  if (brain === "echo") {
    await deliverToGroup(groupId, `Echo: ${synthesizeText(msg.text, msg.attachments)}`)
      .catch((e) => log("BOT_REPLY_FAILED", { group: groupId, error: String(e?.message ?? e) }));
    return;
  }
  if (agentRuntime) {
    try {
      return await agentRuntime.handleMessage(peerHex, {
        ...msg,
        text,
        // Chat commands (/help, /model …) apply to the group's session.
        commandText: msg.text,
        sessionKey: groupSessionKey(groupId),
        deliveryContext: { groupId },
      });
    } finally { endGroupTurn(groupId); }
  }
  // bridge: the harness answers with POST /send { group_id, text }.
  try {
    const hint = groupContextFor(groupId);
    enqueueInbound({
      chat_id: peerHex,
      group_id: groupId,
      group_name: group.name,
      sender: msg.group.sender,
      text: synthesizeText(text, msg.attachments),
      message_id: msg.messageId,
      owedId,
      context: [bridgeOperatorContext, hint ? groupHint(hint) : ""].filter(Boolean).join("\n"),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map(publicAttachment) } : {}),
    });
  } finally {
    if (reservedBridge) releaseBridgeReservation();
  }
};

// ---------- spec 0007 transactions: references, meter, faucet ----------
// The bot never signs for a user: a `tx` button goes out as an intent the
// client dry-runs and signs. What the bot signs itself (a meter charge, a
// faucet drip) is reported with a transactionReference (kind 245), sent when
// the `txref` extension is on. A peer's references are stored per peer and
// never answered; they are claims, never trusted for anything of value.
const DEFAULT_ASSET_HUB_ENDPOINTS = ["wss://asset-hub-paseo-rpc.n.dwellir.com", "wss://sys.turboflakes.io/asset-hub-paseo"];
const endpointList = (raw) => String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const PEER_TX_REFS_CAP = 20;
const peerTxRefs = new Map(); // peerHex -> the peer's last references, oldest first (in memory)
// `pending` (the meter, spec 0008 v3): a botInfo with that pending rides the
// reference's statement.
const sendTransactionReference = async (peerHex, ref, { pending = null } = {}) => {
  const k = norm(peerHex);
  if (!extensionOn("txref")) {
    log("BOT_TX_REFERENCE_SKIPPED", { to: k, reason: "txref extension off", hash: ref.hash });
    return null;
  }
  if (sessions.get(k) == null) throw new Error("no active session for peer");
  const messageId = makeAppUuid();
  // A reference can be the whole answer (a /drip): a pending seen rides with it.
  const supersedes = typingAndSeen.replyGoingOut(k);
  const sent = outbound.enqueue(k, encodeOpaqueTransactionReferenceMessage({ messageId, timestamp: stamp(k), ...ref }), { messageId, supersedes }).submitted;
  if (pending != null) catchUpBotInfo(k, pending);
  await sent;
  log("BOT_SENT_TX_REFERENCE", { to: k, messageId, status: ref.status, block: ref.block ?? null, hash: ref.hash, note: ref.note });
  return messageId;
};
// A buttons message the bot builds itself (not a brain's fenced block);
// without the `buttons` extension it goes out as the spec 0006 fallback text.
const sendOwnButtons = (peerHex, text, rows) => (extensionOn("buttons")
  ? sendMessage(peerHex, { text, buttons: { rows, oneShot: false } })
  : sendMessage(peerHex, { text: buttonsFallbackText(text, rows) }));
const txSend = { text: (peerHex, text) => sendText(peerHex, text), buttons: sendOwnButtons, reference: sendTransactionReference };
const featureConfigError = (name, error) => {
  console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
};

// Meter (lib/meter.mjs): BOT_METER_CONTRACT + BOT_METER_CHAIN turn it on.
let meter = null;
// Peers whose metered turn has not sent its first real message yet (spec 0008 v3).
const meteredReplyDue = new Set();
const meterBatchReplies = numberEnv("BOT_METER_BATCH_REPLIES", METER_BATCH_REPLIES, { min: 1, max: 1000 });
const meterBatchMs = numberEnv("BOT_METER_BATCH_MS", METER_BATCH_MS, { min: 1000, max: 86_400_000 });
if (env.BOT_METER_CONTRACT || env.BOT_METER_CHAIN) {
  if (!env.BOT_METER_CONTRACT || !env.BOT_METER_CHAIN) featureConfigError("BOT_METER_*", "set both BOT_METER_CONTRACT and BOT_METER_CHAIN");
  if (usesBridgeQueue) featureConfigError("BOT_METER_*", "the meter needs a direct brain (echo, claude, codex, ...): a bridge harness answers outside the turn it would charge");
  try {
    meter = createMeter({
      chain: createReviveChain({ endpoints: endpointList(env.BOT_METER_CHAIN) }),
      contract: env.BOT_METER_CONTRACT.trim(),
      operator: wallet,
      price: parsePlancks(env.BOT_METER_PRICE, DEFAULT_METER_PRICE),
      // One charge extrinsic per this many metered replies, or this long after
      // the first pending one (efficiency.md), whichever comes first.
      batchReplies: meterBatchReplies,
      batchMs: meterBatchMs,
      name: username || "this bot",
      send: txSend,
      log,
      // The pending replies are session state (a crash must not lose them).
      onChange: () => persist(),
    });
  } catch (error) { featureConfigError("BOT_METER_*", error); }
  log("BOT_METER_ENABLED", { contract: env.BOT_METER_CONTRACT.trim(), chain: endpointList(env.BOT_METER_CHAIN)[0], pricePlancks: String(parsePlancks(env.BOT_METER_PRICE, DEFAULT_METER_PRICE)), batchReplies: meterBatchReplies, batchMs: meterBatchMs, operator: meter.userAddress(accountIdHex) });
}

// Faucet (lib/faucet.mjs): BOT_FAUCET_KEY (a dev-phrase derivation path) turns it on.
let faucet = null;
if (env.BOT_FAUCET_KEY) {
  try {
    const faucetPair = faucetPairFromPath(env.BOT_FAUCET_KEY);
    const endpoints = endpointList(env.BOT_FAUCET_CHAIN);
    faucet = createFaucet({
      chain: createReviveChain({ endpoints: endpoints.length ? endpoints : DEFAULT_ASSET_HUB_ENDPOINTS }),
      pair: faucetPair,
      amount: parsePlancks(env.BOT_FAUCET_AMOUNT, DEFAULT_FAUCET_AMOUNT),
      cooldownMs: Number(env.BOT_FAUCET_COOLDOWN_MS ?? 0) || 0,
      send: txSend,
      log,
    });
    log("BOT_FAUCET_ENABLED", { key: env.BOT_FAUCET_KEY.trim(), account: `0x${bytesToHex(faucetPair.publicKey)}`, amountPlancks: String(parsePlancks(env.BOT_FAUCET_AMOUNT, DEFAULT_FAUCET_AMOUNT)), chain: (endpoints.length ? endpoints : DEFAULT_ASSET_HUB_ENDPOINTS)[0] });
  } catch (error) { featureConfigError("BOT_FAUCET_*", error); }
}

// Coin flip (lib/flip.mjs): BOT_FLIP_CONTRACT turns it on. Every message
// is answered with the stake button (no brain turn); settlements seen at the
// best block go to both players as references. The watcher starts with the
// ingress (below), after the session state restored the known peers.
let flip = null;
if (env.BOT_FLIP_CONTRACT) {
  try {
    const endpoints = endpointList(env.BOT_FLIP_CHAIN);
    flip = createFlip({
      chain: createReviveChain({ endpoints: endpoints.length ? endpoints : DEFAULT_ASSET_HUB_ENDPOINTS }),
      contract: env.BOT_FLIP_CONTRACT.trim(),
      send: txSend,
      usernameOf: async (peerHex) => (await directory.consumerOf(peerHex))?.username ?? null,
      log,
    });
    log("BOT_FLIP_ENABLED", { contract: env.BOT_FLIP_CONTRACT.trim(), chain: (endpoints.length ? endpoints : DEFAULT_ASSET_HUB_ENDPOINTS)[0] });
  } catch (error) { featureConfigError("BOT_FLIP_*", error); }
}

// HOP accepts the dedicated Bulletin allowance signer, not the bot's chat
// wallet. The uploaded ticket is only embedded into the encrypted RichText
// envelope; it is never logged or written to the durable vault.
const sendAttachment = async (peerHex, { filePath, mime, size, text = null }) => {
  const k = norm(peerHex);
  if (sessions.get(k) == null) throw new Error("no active session for peer");
  if (!hopUploadNode) {
    throw new Error("file delivery is not configured; the operator must set BOT_HOP_UPLOAD_NODE and provision the bot's Bulletin allowance");
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size !== size) throw new Error("saved file changed before delivery");
  const uploaded = await uploadP2PFile({
    filePath,
    wssUrl: hopUploadNode,
    sender: hopUploadPair,
    maxBytes: fileMaxBytes,
    deadlineMs: hopUploadTimeoutMs,
    maxRpcFrameBytes: hopRpcFrameMaxBytes,
    allowInsecure: hopAllowInsecure,
    allowedNodes: hopAllowedNodes.length ? hopAllowedNodes : null,
    log,
  });
  const messageId = makeAppUuid();
  const opaque = encodeOpaqueRichTextMessage({
    messageId,
    timestamp: stamp(k),
    text,
    attachments: [{
      identifier: uploaded.identifier,
      claimTicket: uploaded.claimTicket,
      wssUrl: uploaded.wssUrl,
      mime,
      size,
      fileKind: "general",
    }],
  });
  // The envelope holds the claim ticket; journaled, it lands in the 0600
  // state file like an inbound attachment's ticket does (see snapshotState).
  await journalAnswer(k, { messageId, opaque, supersedes: [] });
  catchUpBotInfo(k);
  const { submitted, delivered } = outbound.enqueue(k, opaque, { messageId, supersedes: typingAndSeen.replyGoingOut(k) });
  await submitted;
  disarmThinking(peerHex);
  log("BOT_SENT_FILE", { to: peerHex, mime, bytes: size });
  return { messageId, delivered };
};

// ---------- live replies (one evolving message per slow turn) ----------
const liveReplies = createLiveReplies({
  send: ({ peerHex, text, editOf, supersedes, ephemeral }) => submitMessage(peerHex, { text, editOf, supersedes, ephemeral }),
  retract: (peerHex, messageId) => deleteMessage(peerHex, messageId),
  // The lane's delivered promise, bounded: a peer that never fetches the
  // placeholder must not gate the final answer forever.
  awaitAck: (delivered) => Promise.race([
    delivered,
    new Promise((resolve) => { const t = setTimeout(() => resolve(false), liveAckTimeoutMs); t.unref?.(); }),
  ]),
  minIntervalMs: liveMinEditMs,
  maxIntervalMs: liveMaxEditMs,
  finalAckWaitMs: numberEnv("BOT_LIVE_FINAL_ACK_WAIT_MS", 10_000, { min: 100, max: 86_400_000 }),
  log,
});
// peerHex -> Promise<{handle, tracker, timer} | null> for the current turn's
// placeholder. Consumed (take) exactly once, by whoever delivers the answer.
const livePlaceholders = new Map();
// peerHex -> deferred progress tracker, created at TURN START and attached to
// the placeholder once it exists. A turn does real work before its placeholder
// appears (thinkingAfterMs), so a tracker built alongside the placeholder would
// lose that elapsed time and every tool step taken during it. Mirrors the T3ams
// transport, which has always worked this way.
const pendingProgressTrackers = new Map();
const progressTrackerFor = (peerHex) => {
  const k = norm(peerHex);
  let tracker = pendingProgressTrackers.get(k);
  if (tracker == null) {
    // maxActions 0 with progress disabled keeps steps counted for the terminal
    // status line while no "▸ action" line enters a rendered frame.
    tracker = createDeferredProgressTracker({
      label: "working",
      maxActions: liveProgress ? 3 : 0,
      renderFrames: liveProgress,
    });
    pendingProgressTrackers.set(k, tracker);
    if (pendingProgressTrackers.size > 500) {
      const oldest = pendingProgressTrackers.keys().next().value;
      pendingProgressTrackers.get(oldest)?.dispose();
      pendingProgressTrackers.delete(oldest);
    }
  }
  return tracker;
};
const disposeProgressTracker = (peerHex) => {
  const k = norm(peerHex);
  pendingProgressTrackers.get(k)?.dispose();
  pendingProgressTrackers.delete(k);
};
const takeLivePlaceholder = async (peerHex) => {
  const k = norm(peerHex);
  const p = livePlaceholders.get(k);
  if (!p) { disposeProgressTracker(k); return null; }
  livePlaceholders.delete(k);
  const lp = await p.catch(() => null);
  if (lp) { clearInterval(lp.timer); clearTimeout(lp.ttl); lp.tracker.detach(); }
  disposeProgressTracker(k);
  return lp;
};

// Reactions ride the same session channel but are not "replies": they never
// disarm the thinking ack and carry no text of their own.
const sendReaction = async (peerHex, targetMessageId, emoji, removed = false) => {
  const k = norm(peerHex);
  if (sessions.get(k) == null) throw new Error("no active session for peer");
  const { submitted } = outbound.enqueue(k, encodeOpaqueReactionMessage({ timestamp: stamp(k), targetMessageId, emoji, removed }));
  await submitted;
  log("BOT_SENT_REACTION", { to: peerHex, removed, target: targetMessageId });
};

// ---------- direct engine: the agent runtime behind the chat surface ----------
// The engine brain lives in lib/agent-runtime.mjs; the transport hands it
// three capabilities and stays otherwise unaware of resume tokens, projects
// or commands. This `chat` surface is the in-process twin of the HTTP bridge.

// Deliver a final answer. The live placeholder retires to a short status
// summary (elapsed, steps, tokens) and the answer goes out as NEW messages —
// an edit raises no phone notification, so finalizing the answer onto the
// placeholder left a locked-phone user unaware their answer had landed.
// If the peer never fetched the placeholder it is superseded by the answer
// instead: a status line for progress nobody saw is pure noise.
const deliverToChat = async (peerHex, reply, _deliveryContext = null, turnStats = null) => {
  // A trailing ```buttons block becomes spec 0006 buttons on the LAST part.
  const { text, buttons } = prepareReply(peerHex, reply);
  const parts = splitMessageText(text, replyChunkBytes);
  if (parts.length > 1) log("BOT_REPLY_CHUNKED", { to: peerHex, parts: parts.length, chars: text.length });
  const lp = await takeLivePlaceholder(peerHex);
  // Only the unfetched-placeholder path consumes parts[0]; a finalize failure
  // delivered nothing, so every part still has to go out. A placeholder slot
  // carries text only, so with buttons it never takes the only part.
  let firstPartSent = false;
  if (lp) {
    const status = renderTurnStats({ elapsed: lp.tracker.elapsed(), steps: lp.tracker.step, usage: turnStats });
    try {
      const { edited } = await lp.handle.finalize(status, buttons && parts.length === 1 ? {} : { ifUnfetched: parts[0] });
      firstPartSent = !edited && !(buttons && parts.length === 1);
      log("BOT_LIVE_STATUS", { to: peerHex, messageId: lp.handle.messageId, status, edited });
    } catch (e) { log("BOT_LIVE_FINALIZE_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
  }
  const rest = firstPartSent ? parts.slice(1) : parts;
  for (const [i, part] of rest.entries()) {
    await sendMessage(peerHex, { text: part, ...(buttons && i === rest.length - 1 ? { buttons } : {}) });
  }
};

// A turn is starting: anchor its progress tracker, arm the "thinking"
// placeholder, and hand back the progress hook (tool events become "▸ action"
// lines on it). The tracker retains actions emitted before the placeholder
// exists and publishes nothing until one is attached.
// BOT_LIVE_PROGRESS=0 suppresses the per-tool FRAMES, not the counting: the
// terminal status line still reports how many steps the turn took.
const beginTurnProgress = (peerHex) => {
  const tracker = progressTrackerFor(peerHex);
  typingAndSeen.turnStarted(norm(peerHex));
  armThinking(peerHex);
  return (title) => tracker.add(title);
};

// Project registry (BOT_AI_PROJECTS): validated aliases -> dirs, plus lazy
// per-branch git worktrees. Only meaningful for direct engines.
const workspaces = engine ? createWorkspaces({
  projects: aiProjects,
  // Worktrees contain model-directed code changes, not transport state.
  worktreesDir: env.BOT_AI_WORKTREES_DIR ?? path.join(aiWorkspace, ".worktrees"),
  agentUid: aiAgentUid,
  agentGid: aiAgentGid,
  log,
}) : null;
if (workspaces?.size) log("BOT_PROJECTS", { aliases: workspaces.aliases() });
if (engine) log("BOT_MODEL_POLICY", {
  switching: aiAllowedModels == null ? "open" : aiAllowedModels.length ? "restricted" : "locked",
  ...(Array.isArray(aiAllowedModels) && aiAllowedModels.length ? { allowed: aiAllowedModels } : {}),
});
if (engine && !customCmd) log("BOT_TOOL_POLICY", {
  ...toolPolicySummary(aiToolPolicy),
  enforcement: toolPolicyEnforcement(brain, aiToolPolicy),
});
const agentRuntime = engine ? createAgentRuntime({
  engine,
  engineName: customCmd ? "custom" : brain,
  engineCommand,
  buildArgs: buildEngineArgs,
  buildTurnEnvironment: buildEngineTurnEnvironment,
  workspace: aiWorkspace,
  workspaces,
  model: aiModel,
  allowedModels: aiAllowedModels,
  reasoning: aiReasoning,
  idleMs: aiIdleMs,
  maxMs: aiMaxMs,
  maxConcurrentTurns: aiMaxConcurrentTurns,
  maxQueuedTurns: aiMaxQueuedTurns,
  maxOutputBytes: aiMaxOutputBytes,
  agentUid: aiAgentUid,
  agentGid: aiAgentGid,
  renderMessage: (msg) => renderForBrain(msg),
  operatorContext: {
    enabled: aiContextEnabled,
    username,
    transport: "polkadot-app",
    policy: aiToolPolicy,
    personaPath: path.join(aiWorkspace, "PERSONA.md"),
    // Spec 0006: the ```buttons hint only when buttons go out as kind 242.
    buttons: () => extensionOn("buttons"),
    // Spec 0009: the one-line hint for a turn from a group.
    group: (sessionKey) => groupContextFor(sessionKey),
  },
  // A group turn carries deliveryContext { groupId }: its replies fan out.
  chat: {
    sendText: (peerHex, text, context) => (context?.groupId ? deliverToGroup(context.groupId, text) : sendText(peerHex, text)),
    deliver: (peerHex, reply, context, turnStats) => (context?.groupId ? deliverToGroup(context.groupId, reply) : deliverToChat(peerHex, reply, context, turnStats)),
    beginTurn: (peerHex, context) => (context?.groupId ? beginGroupTurn(context.groupId) : beginTurnProgress(peerHex)),
  },
  username,
  chainConnected,
  log,
  persist: () => persist(),
}) : null;
const bridgeOperatorContext = brain === "bridge" && aiContextEnabled
  ? buildOperatorContext({
    username,
    transport: "polkadot-app",
    policy: aiToolPolicy,
    model: aiModel,
    modelPolicy: aiAllowedModels,
    commands: commandCatalog({ allowedModels: aiAllowedModels }),
    // One context for every peer: the hint only when the operator forces
    // buttons on; peers without the extension still get the fallback text.
    buttons: protocolExtensions.enabled.has("buttons"),
  })
  : "";

// File commands are transport commands, not model prompts. That makes the
// same peer-scoped vault work for direct engines and bridge-backed bots.
const handleFileCommand = createFileCommandHandler({
  fileStore,
  sendAttachment,
  log,
});

// Bridge-facing attachment shape: no claimTicket (key material stays inside
// bot-core); the harness fetches bytes via GET /media/:id.
const publicAttachment = (a) => ({
  id: a.id,
  kind: a.fileKind,
  mime: a.mime,
  size: a.size,
  ...(a.width != null ? { width: a.width, height: a.height } : {}),
  ...(a.duration != null ? { duration: a.duration } : {}),
  downloaded: Boolean(a.downloaded),
  ...(a.downloaded ? { url: `/media/${a.id}` } : {}),
  ...(a.error ? { error: a.error } : {}),
});

// Direct-brain prompt rendering: attachments become bracketed notes with the
// downloaded file path (the CLI can read it), replies/edits become context
// prefixes. msg.text is the raw caption and may be empty.
const renderForBrain = (msg) => {
  const parts = [];
  const canReadAttachments = customCmd || !engine || hasToolCapability(aiToolPolicy, "read");
  if (msg.editOf) parts.push("[edited their earlier message]");
  else if (msg.replyTo) parts.push("[replying to your earlier message]");
  if (msg.text) parts.push(msg.text);
  for (const a of msg.attachments ?? []) {
    parts.push(a.downloaded && canReadAttachments
      ? `[User sent a ${attachmentNoun(a)} saved at ${a.path} (${a.mime}, ${humanSize(a.size)})]`
      : a.downloaded
        ? `[User sent a ${attachmentNoun(a)} (${a.mime}, ${humanSize(a.size)}) — bytes are staged but unavailable to this no-tools agent.]`
      : `[User sent a ${attachmentNoun(a)} (${a.mime}, ${humanSize(a.size)}) — download failed: ${a.error ?? "unknown error"}]`);
  }
  return parts.join(" ") || synthesizeText("", msg.attachments);
};

// msg: { text, messageId, kind, attachments?, replyTo?, editOf? }
const handleInbound = async (peerHex, msg, owedId = null, options = {}) => {
  // Spec 0009: a group message is a group turn (no seen, no 1:1 features).
  if (msg.group) return handleGroupInbound(peerHex, msg, owedId, options);
  // Spec 0005: the bot consumes this message now. Its seen rides the reply;
  // it goes alone only if handling ends with no reply and no running turn.
  const releaseSeen = typingAndSeen.consumed(norm(peerHex), msg.messageId);
  try { return await handleDirectInbound(peerHex, msg, owedId, options); }
  finally { releaseSeen(); }
};

const handleDirectInbound = async (peerHex, msg, owedId, { reservedBridge = false }) => {
  await fetchAttachments(msg.attachments);
  const fileResult = await handleFileCommand(peerHex, msg);
  if (fileResult?.handled) {
    if (fileResult.reply) {
      await sendText(peerHex, fileResult.reply).catch((error) => log("BOT_FILE_REPLY_FAILED", { to: peerHex, error: String(error?.message ?? error) }));
    }
    if (reservedBridge) releaseBridgeReservation();
    return;
  }
  // Spec 0008: /start gets the botInfo document, then the greeting as a
  // normal message, for every brain (a harness never sees it). With the
  // extension off or an invalid botinfo.json, /start is ordinary input.
  const startInfo = msg.kind === "text" && START_RE.test(msg.text ?? "") ? currentBotInfo() : null;
  if (startInfo) {
    try {
      await outbound.enqueue(norm(peerHex), encodeBotInfo(peerHex, startInfo)).submitted;
      botInfoSent.mark(norm(peerHex), startInfo.version);
      log("BOT_SENT_BOTINFO", { to: peerHex, version: startInfo.version, on: "start" });
    } catch (error) { log("BOT_BOTINFO_SEND_FAILED", { to: peerHex, error: String(error?.message ?? error) }); }
    if (startInfo.greeting) {
      await sendText(peerHex, startInfo.greeting).catch((error) => log("BOT_REPLY_FAILED", { to: peerHex, error: String(error?.message ?? error) }));
    }
    if (reservedBridge) releaseBridgeReservation();
    // A bridge owed entry is settled by the harness's ACK; this one never
    // reaches a harness, so settle it here.
    if (usesBridgeQueue && owedId) settleOwed(owedId);
    return;
  }
  // Spec 0007 faucet: /drip is answered here, never by the brain.
  if (faucet && await faucet.handle(peerHex, msg).catch((e) => { log("BOT_FAUCET_FAILED", { peer: peerHex, error: String(e?.message ?? e) }); return true; })) {
    // As for /start: no harness sees it, so a bridge owed entry is settled here.
    if (reservedBridge) releaseBridgeReservation();
    if (usesBridgeQueue && owedId) settleOwed(owedId);
    return;
  }
  // Coin flip: every message gets the stake button, never a brain turn.
  if (flip && await flip.handle(peerHex, msg)) {
    if (reservedBridge) releaseBridgeReservation();
    if (usesBridgeQueue && owedId) settleOwed(owedId);
    return;
  }
  // A chat request with no opener text (the desktop can send one) gets the
  // bot's greeting. It is not a question, so the meter never gates or
  // charges it; a brain writes the greeting in its persona (agent-runtime).
  const emptyOpener = msg.opener === true && !String(msg.text ?? "").trim() && !msg.attachments?.length;
  const openerGreeting = emptyOpener ? (currentBotInfo()?.greeting || greetText) : null;
  // Spec 0007 meter: the balance (minus the pending debit) gates the turn; a
  // turn that ran joins the pending debit, charged in batches (lib/meter.mjs).
  let meterGate = null;
  if (meter && !emptyOpener) {
    try { meterGate = await meter.beforeTurn(peerHex, msg); }
    catch (e) { log("BOT_METER_FAILED", { peer: peerHex, error: String(e?.message ?? e) }); return; }
    if (!meterGate.run) return;
  }
  // Spec 0008 v3: the brain's answer carries botInfo with the pending debit
  // this reply adds (submitMessage takes the mark). The mark is set only when
  // the brain answers, so an error fallback never claims a debit.
  const markAnswer = () => { if (meterGate?.charge) meteredReplyDue.add(norm(peerHex)); };
  const chargeTurn = async () => {
    meteredReplyDue.delete(norm(peerHex));
    if (meterGate?.charge) await meter.afterTurn(peerHex);
  };
  if (brain === "echo" && emptyOpener) {
    await deliverToChat(peerHex, openerGreeting).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
    return;
  }
  if (brain === "echo") {
    markAnswer();
    // Through deliverToChat, so an echoed ```buttons block exercises spec 0006.
    const delivered = await deliverToChat(peerHex, `Echo: ${synthesizeText(msg.text, msg.attachments)}`).then(() => true, (e) => { log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }); return false; });
    if (delivered) await chargeTurn();
    return;
  }
  if (agentRuntime) {
    // A turn that ends with no reply (a failed delivery, /stop) closes its
    // typing hint with typing{stopped}; after a reply this is a no-op.
    // A metered turn is charged only when the brain answered (onAnswer). An
    // error fallback ("couldn't reach my agent"), a busy notice, a command,
    // /stop, or a shutdown interruption (retried later) costs nothing.
    let result;
    let answered = false;
    try {
      result = await agentRuntime.handleMessage(peerHex, msg, { onAnswer: () => { answered = true; markAnswer(); }, greeting: openerGreeting });
    } finally {
      typingAndSeen.turnEnded(norm(peerHex));
      meteredReplyDue.delete(norm(peerHex));
    }
    if (answered) await chargeTurn();
    return result;
  }
  // bridge: hand off to an external agent via the HTTP bridge.
  // The agent replies via POST /send -> sendMessage, which disarms the ack
  // and ends the typing hint. A harness that never answers stops the hint
  // after BOT_LIVE_TTL_MS.
  typingAndSeen.turnStarted(norm(peerHex));
  armThinking(peerHex);
  try {
    enqueueInbound({
      chat_id: peerHex,
      text: synthesizeText(msg.text, msg.attachments),
      message_id: msg.messageId,
      owedId,
      ...(bridgeOperatorContext ? { context: bridgeOperatorContext } : {}),
      ...(msg.kind && msg.kind !== "text" ? { kind: msg.kind } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.editOf ? { edit_of: msg.editOf } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map(publicAttachment) } : {}),
    });
  } finally {
    if (reservedBridge) releaseBridgeReservation();
  }
};

// Queue one owed message for the brain. Bridge deliveries remain journaled
// until the authenticated harness explicitly acknowledges their lease.
const enqueueOwed = (peerHex, owedId, msg, requestId, { reservedBridge = false } = {}) => {
  if (queuedOwed.has(owedId)) return false;
  queuedOwed.add(owedId);
  const k = norm(peerHex);
  enqueueWork(peerHex, async () => {
    // The peer deleted it (RFC-0003) while it waited: drop it unanswered.
    if (msg.messageId && deletions.isDeleted(k, msg.messageId) && !owedReplies.get(owedId)?.answer?.length) {
      if (reservedBridge) releaseBridgeReservation();
      settleOwed(owedId);
      log("BOT_DELETED_MESSAGE_DROPPED", { from: k, messageId: msg.messageId, stage: "queued" });
      return;
    }
    const answer = owedReplies.get(owedId)?.answer;
    if (answer?.length) {
      // An earlier life already answered; at most the statement is missing.
      // Re-send the journaled answer as-is and never run the brain again.
      if (reservedBridge) releaseBridgeReservation();
      if (await resendAnswer(k, answer)) settleOwed(owedId);
      else queuedOwed.delete(owedId);
      return;
    }
    let handedOff = false;
    // Everything a direct turn sends is this inbound's answer (journalAnswer).
    // A bridge turn only hands the message to the harness, whose POST /send
    // answers later under its own lease contract — never journaled here.
    if (!usesBridgeQueue) owedTurns.set(k, owedId);
    try {
      // Direct runtimes return false only when global shutdown interrupted a
      // turn. Keep that durable owed entry for restart; user /stop and every
      // completed/error reply return a settled result and are safe to remove.
      handedOff = (await handleInbound(peerHex, msg, owedId, { reservedBridge })) !== false;
    } finally {
      if (owedTurns.get(k) === owedId) owedTurns.delete(k);
      if (!usesBridgeQueue && handedOff) settleOwed(owedId);
      else if (!handedOff) queuedOwed.delete(owedId);
    }
  });
  return true;
};

// ---------- receive: dedup + handlers ----------
// Both sets are bounded (insertion-ordered, evict oldest) so a long-lived bot
// doesn't grow them without limit. seenStatements holds statement fingerprints;
// seenRequests holds message ids (never plaintext — see handleSessionStatement).
const seenStatements = new Set();
const seenRequests = new Set();
// An opener's semantic work is journaled before its acceptance statement is
// submitted. Keep only failed acceptance retries here; ordinary duplicate
// openers must not occupy the outbound lane again after a restart.
const pendingOpenerAcks = new Set();
const STMT_CAP = 20_000;
const trimSet = (set, cap) => { while (set.size > cap) set.delete(set.values().next().value); };
const noteSeenStatement = (key) => { seenStatements.add(key); trimSet(seenStatements, STMT_CAP); };
// Stable dedup id for a session message: prefer the app's message id; fall back
// to a hash of requestId:text so we never hold or persist conversation plaintext.
const messageDedupId = (peerHex, requestId, text, messageId) =>
  `${norm(peerHex)}:${messageId || `h:${bytesToHex(blake2b(enc.encode(`${requestId}:${text}`), { dkLen: 16 }))}`}`;
// "<peer>:<messageId>" -> attachment ids, so a deletion can discard the
// downloaded bytes (RFC-0003). In memory only; the media cache TTL covers
// a restart.
const receivedAttachments = new Map();

// RFC-0003: drop every copy the bot still holds of a message the peer
// deleted. An owed entry that is queued is skipped by its work item; one not
// yet queued is removed here; an unleased bridge delivery is withdrawn. Text
// already handed to an engine or leased to a harness cannot be recalled: the
// engine's native session owns it, and the harness gets a `deleted` event.
const scrubDeleted = (peerHex, targetId) => {
  const k = norm(peerHex);
  const key = `${k}:${targetId}`;
  const index = inboundQueue.findIndex((e) => e.owedId === key && e.leaseId == null && !e.acknowledging);
  if (index >= 0) {
    inboundQueue.splice(index, 1);
    queuedOwed.delete(key);
  }
  if (!queuedOwed.has(key) && owedTurns.get(k) !== key && !owedReplies.get(key)?.answer?.length) removeOwed(key);
  for (const id of receivedAttachments.get(key) ?? []) mediaStore.remove(id);
  receivedAttachments.delete(key);
};

// ---------- owed replies (crash-durable at-least-once) ----------
// A message is deduped and ACKed as soon as it is durably journaled. The record
// stays until a direct brain has answered, or a bridge consumer explicitly ACKs
// its leased delivery. This is intentionally bounded: full queues defer the
// protocol statement before its session ACK, allowing the peer to retry later.
//
// The journal holds the ANSWER too, once it exists: every message a direct
// turn sends is recorded (id + exact bytes) and made durable before the lane
// submits it. The store pushes a statement to subscribers before it answers
// the submitter, so a crash there leaves the peer holding an answer the
// journal would otherwise not know about — the restart would run the brain
// again and send a second answer under a new id (with an LLM, a different
// one). With the answer journaled, a restart re-sends those exact bytes under
// the same ids instead (peers dedup by id) and runs the brain only for
// entries that have no answer yet.
const owedReplies = new Map(); // owedId -> { peerHex, requestId, msg, answer: [{ messageId, opaque, supersedes }], byteSize }
const queuedOwed = new Set();
// peerHex -> owedId of the direct turn running on that peer. Work is
// serialized per peer, so there is at most one; submitMessage/sendAttachment
// journal into it.
const owedTurns = new Map();
// Owed ids a receive path has journaled but not yet enqueued: it awaits the
// critical persist in between, and a turn settling on that peer meanwhile
// pumps every un-queued owed entry. Without this set the pump ran the brain
// on the fresh message and the receive path ran it again (two answers with
// different ids — a phone shows the bot answering twice). Found by the
// sandbox's persona, which sends its follow-up as the previous turn ends.
const owedInAdmission = new Set();
let pumpOwed = () => {};
let owedReplyBytes = 0;
const answerByteSize = (a) => Buffer.byteLength(JSON.stringify({ id: a.messageId, o: bytesToHex(a.opaque), s: a.supersedes }));
const owedByteSize = (owedId, peerHex, requestId, msg, answer = []) =>
  Buffer.byteLength(JSON.stringify({ id: owedId, p: peerHex, r: requestId, m: msg }))
  + answer.reduce((sum, a) => sum + answerByteSize(a), 0);
const removeOwed = (owedId) => {
  const owed = owedReplies.get(owedId);
  if (!owed) return null;
  owedReplies.delete(owedId);
  owedReplyBytes = Math.max(0, owedReplyBytes - (owed.byteSize ?? owedByteSize(owedId, owed.peerHex, owed.requestId, owed.msg, owed.answer)));
  return owed;
};
const restoreOwed = (owedId, owed) => {
  if (!owed || owedReplies.has(owedId)) return false;
  const byteSize = owed.byteSize ?? owedByteSize(owedId, owed.peerHex, owed.requestId, owed.msg, owed.answer);
  if (owedReplyBytes + byteSize > MAX_OWED_BYTES) return false;
  owedReplies.set(owedId, { ...owed, byteSize });
  owedReplyBytes += byteSize;
  return true;
};
const oweReply = (owedId, peerHex, msg, requestId, answer = []) => {
  if (owedReplies.has(owedId)) return true;
  if (owedReplies.size >= MAX_OWED) return false;
  const byteSize = owedByteSize(owedId, peerHex, requestId, msg, answer);
  if (byteSize > MAX_OWED_BYTES || owedReplyBytes + byteSize > MAX_OWED_BYTES) return false;
  owedReplies.set(owedId, { peerHex, requestId, msg, answer, byteSize });
  owedReplyBytes += byteSize;
  return true;
};
// Record one outgoing message as (part of) the answer to the owed turn
// running on this peer, durably, BEFORE the lane submits it: a crash after
// the submit must never lose the fact that this answer exists. Outside an
// owed turn (bridge sends, reactions, declines) there is nothing to journal.
// Answers never push the entry past the byte cap: the cap throttles new
// inbounds (oweReply), and an answer already composed must reach the peer.
// A failed persist is logged and the message still goes out — a dead disk
// must not silence the bot; the crash-duplicate risk it reopens is the old one.
const journalAnswer = async (k, { messageId, opaque, supersedes }) => {
  const owedId = owedTurns.get(k);
  const owed = owedId ? owedReplies.get(owedId) : null;
  if (!owed) return;
  const entry = { messageId, opaque, supersedes: supersedes?.length ? [...supersedes] : [] };
  owed.answer = [...(owed.answer ?? []), entry];
  const bytes = answerByteSize(entry);
  owed.byteSize = (owed.byteSize ?? 0) + bytes;
  owedReplyBytes += bytes;
  if (!(await persistCritical())) log("BOT_OWED_ANSWER_PERSIST_FAILED", { to: k, messageId });
};
// Re-publish a journaled answer under its original ids and bytes (same
// timestamps, same supersedes). Enqueued in one tick, the parts ride one
// statement. A peer that already fetched them dedups by id; one that never
// did finally gets them.
const resendAnswer = async (k, answer) => {
  try {
    catchUpBotInfo(k);
    const sends = answer.map((a) => outbound.enqueue(k, a.opaque, { messageId: a.messageId, supersedes: a.supersedes }));
    await Promise.all(sends.map((send) => send.submitted));
    log("BOT_OWED_ANSWER_RESENT", { to: k, messages: answer.length });
    return true;
  } catch (e) {
    log("BOT_OWED_ANSWER_RESEND_FAILED", { to: k, error: String(e?.message ?? e) });
    return false;
  }
};
const settleOwed = (owedId) => {
  queuedOwed.delete(owedId);
  if (removeOwed(owedId)) {
    persist();
    // A direct turn freeing one bounded work slot may unblock a durable owed
    // item that was deferred earlier; do not wait for a fresh chain statement.
    pumpOwed();
  }
};

// Persist only what can't be re-derived: our random device private key plus
// each peer's identity/device public keys. makePeerSession is deterministic,
// so channels rebuild exactly from those + the seed. Also persist the dedup
// set so a restart doesn't re-answer old messages. (seenStatements stays
// in-memory — it only avoids redundant decode work; seenRequests is the
// semantic "already replied" guard.)
const snapshotState = () => ({
  v: 3,
  devicePrivateKeyHex: norm(bytesToHex(deviceKeypair.privateKey)),
  // Which engine, base model, and workspace these resume tokens belong to. A
  // token resumes a session tied to those settings, so a change invalidates it
  // on restart (resuming against the wrong tree or model corrupts context).
  agent: agentRuntime?.snapshotAgent(),
  peers: [...sessions.entries()].map(([peerHex, { session, identifierKeyHex, lastActiveAt }]) => ({
    peerHex,
    identifierKeyHex,
    devices: (session.peerDevices ?? []).map((d) => ({
      s: norm(bytesToHex(d.statementAccountId)),
      e: norm(bytesToHex(d.encryptionPublicKey)),
    })),
    // Engine per-peer state (resume token rs, model override mo, and active
    // project pj/br) — the runtime owns what these fields mean; see
    // lib/agent-runtime.mjs.
    ...(agentRuntime ? agentRuntime.peerSnapshot(norm(peerHex)) : {}),
    ...(lastActiveAt ? { la: lastActiveAt } : {}),
    // RFC-0003: tombstones + pending deletions (dl).
    ...(deletions.snapshot(norm(peerHex)) ? { dl: deletions.snapshot(norm(peerHex)) } : {}),
    // Spec 0006: the bot's own recent buttons messages (bp), for press checks.
    ...(sentButtons.snapshot(norm(peerHex)) ? { bp: sentButtons.snapshot(norm(peerHex)) } : {}),
    // Spec 0008: the peer's own botInfo (bi), when the peer is a bot.
    ...(peerBotInfo.snapshot(norm(peerHex)) ? { bi: peerBotInfo.snapshot(norm(peerHex)) } : {}),
    // Spec 0008: the version of our own botInfo last sent to this peer (bs).
    ...(botInfoSent.snapshot(norm(peerHex)) ? { bs: botInfoSent.snapshot(norm(peerHex)) } : {}),
    // Spec 0007 meter: the replies not yet charged (md).
    ...(meter?.snapshot(norm(peerHex)) ? { md: meter.snapshot(norm(peerHex)) } : {}),
  })),
  seen: [...seenRequests].slice(-SEEN_CAP),
  // An unresolved acceptance marker is paired with an owed entry, so its
  // natural ceiling is the durable owed-work budget rather than the semantic
  // dedup window.
  pendingOpenerAcks: [...pendingOpenerAcks].slice(-MAX_OWED),
  // Additive optional fields (k/q/e/a/ans) keep the snapshot readable by
  // older binaries, which fall back to answering from t (caption or
  // synthesized text). The attachment claim ticket ("ct", and inside a
  // journaled file answer's bytes) is key material — acceptable here because
  // this file is 0600 and already holds session keys, and owed entries are
  // transient (settled when the reply pipeline takes custody). "ans" is the
  // answer so far: message id, exact envelope bytes, superseded ids.
  owed: [...owedReplies.entries()].map(([id, o]) => ({
    id,
    p: o.peerHex,
    t: synthesizeText(o.msg.text, o.msg.attachments),
    r: o.requestId,
    ...(o.msg.kind && o.msg.kind !== "text" ? { k: o.msg.kind } : {}),
    ...(o.msg.replyTo ? { q: o.msg.replyTo } : {}),
    ...(o.msg.editOf ? { e: o.msg.editOf } : {}),
    ...(o.msg.opener ? { op: 1 } : {}),
    // Spec 0009: a group turn (g.i group id, g.s sender username).
    ...(o.msg.group ? { g: { i: o.msg.group.id, s: o.msg.group.sender } } : {}),
    ...(o.msg.attachments?.length ? {
      c: o.msg.text, // raw caption; t above is synthesized for older binaries
      a: o.msg.attachments.map((x) => ({
        i: x.id, ct: x.ticketHex, u: x.wssUrl, m: x.mime, s: x.size, kd: x.fileKind,
        ...(x.width != null ? { w: x.width, h: x.height } : {}),
        ...(x.duration != null ? { d: x.duration } : {}),
      })),
    } : {}),
    ...(o.answer?.length ? {
      ans: o.answer.map((a) => ({ id: a.messageId, o: bytesToHex(a.opaque), ...(a.supersedes.length ? { s: a.supersedes } : {}) })),
    } : {}),
  })),
  greeted: [...greetedPeers],
  intro: agentRuntime?.introducedList() ?? [],
  // Spec 0009: the rosters, own seq and recent envelope ids per group.
  groups: groups.snapshot(),
  groups2: groupsV2.snapshot(),
});
const greetedPeers = new Set(); // peers we've sent a first-contact greeting (once ever)
const persist = () => { if (stateStore) stateStore.save(snapshotState()); };
const persistCritical = async () => {
  if (!stateStore) return false;
  try {
    stateStore.save(snapshotState());
    return await stateStore.flush();
  } catch (error) {
    log("BOT_STATE_CRITICAL_SAVE_FAILED", { error: String(error?.message ?? error) });
    return false;
  }
};
const fp = (data) => bytesToHex(data.subarray(0, 32)); // dedup key: first 32 bytes, no full-payload encode

// Spec 0009: an allowlisted bot accepts a chat request from a member of an
// allowed admin's group, for group traffic only: the welcome is not a turn.
const acceptGroupMember = async (decoded, senderHex, identifierKeyHex) => {
  const openerId = messageDedupId(senderHex, decoded.messageId, "opener", decoded.messageId);
  if (seenRequests.has(openerId)) return "handled";
  const devices = decoded.deviceEncPubKeyHex
    ? [{ statementAccountId: hexToBytes(decoded.peerStatementAccountIdHex ?? senderHex), encryptionPublicKey: hexToBytes(decoded.deviceEncPubKeyHex) }]
    : [];
  buildSession(senderHex, identifierKeyHex, devices);
  addSessionWatch(senderHex);
  ingress?.resubscribe();
  peerClock.observe(senderHex, decoded.timestamp);
  const accept = decoded.deviceEncPubKeyHex
    ? encodeOpaqueDeviceChatAcceptedMessage({ timestamp: stamp(senderHex), acceptedRequestId: decoded.messageId, statementAccountId: accountId, encryptionPublicKey: deviceKeypair.publicKey })
    : encodeOpaqueChatAcceptedMessage({ timestamp: stamp(senderHex), acceptedRequestId: decoded.messageId });
  try { await outbound.enqueue(senderHex, accept, { forceIdentity: true }).submitted; }
  catch (error) {
    log("BOT_ACK_FAILED", { to: senderHex, error: String(error?.message ?? error) });
    return "deferred";
  }
  seenRequests.add(openerId);
  trimSet(seenRequests, SEEN_CAP);
  persist();
  log("BOT_GROUP_MEMBER_ACCEPTED", { from: senderHex, requestId: decoded.messageId });
  return "handled";
};

const handleOpener = async (data) => {
  let decoded;
  // Unlike session batches, an opener has no per-message isolation: a welcome
  // message we can't decode drops the whole request (and the app resends it
  // forever, since no session ever ACKs) — make that visible.
  try { decoded = decodeEncryptedChatRequestPayload(data, identityPrivateKey, accountId); }
  catch (e) { log("BOT_OPENER_DECODE_FAILED", { error: String(e?.message ?? e) }); return; }
  const senderHex = norm(decoded.peerAccountIdHex);
  const groupOnly = !isAllowed(senderHex);
  // 0011: "Join request: <name> [grp:<inviteId>:<proof>]" to an admin bot is
  // accepted silently when the proof matches one of its groups' invites; the
  // joinRequest follows on the session.
  const joinOpener = extensionOn("groups") && groupsV2.acceptsJoinOpener(senderHex, decoded.text);
  if (groupOnly && !joinOpener && !groupAdmitted(senderHex)) { log("BOT_REJECTED_UNLISTED", { from: senderHex }); return; }
  // A held request waits for its retry; one whose window closed is dropped.
  const waitKey = fp(data);
  const held = identifierWait.status(waitKey);
  if (held === "waiting") return "waiting";
  if (held === "expired") return;
  const identifierKeyHex = await resolveIdentifierKey(senderHex);
  if (!identifierKeyHex) {
    if (!identifierWait.hold(waitKey, senderHex, data)) return "deferred";
    log("BOT_OPENER_WAITING_IDENTIFIER", { from: senderHex, windowMs: identifierRetryMs });
    return "waiting";
  }
  if (!verifyChatRequestIdentityProof(decoded, identityPrivateKey, hexToBytes(identifierKeyHex))) {
    log("BOT_OPENER_BAD_PROOF", { from: senderHex }); return;
  }
  if (groupOnly || joinOpener) return acceptGroupMember(decoded, senderHex, identifierKeyHex);
  // App UUIDs are normally globally unique, but they are peer-controlled
  // input. Namespace opener dedup/owed records so one malicious peer cannot
  // suppress another peer's welcome by reusing its message id.
  const openerId = messageDedupId(senderHex, decoded.messageId, "opener", decoded.messageId);
  const retryProtocolAck = pendingOpenerAcks.has(openerId);
  // A failed acceptance is already journaled work. Its semantic dedup entry
  // may have aged out of the normal seen window, but retrying the protocol ACK
  // must not create a second owed reply.
  const isNew = !retryProtocolAck && !seenRequests.has(openerId) && !seenRequests.has(decoded.messageId);
  // A completed opener is semantically deduped. Re-sending its acceptance on
  // every historical sweep would create an un-ACKed identity lane and block a
  // crash-recovered answer. Only retry a protocol ACK that actually failed.
  if (!isNew && !retryProtocolAck) return "handled";
  if (isNew && !reserveAdmission(senderHex)) return "deferred";
  if (!sessions.has(senderHex) && sessions.size >= MAX_SESSIONS) {
    pruneSessions({ forceCap: true });
  }
  if (!sessions.has(senderHex) && sessions.size >= MAX_SESSIONS) {
    if (isNew) releaseBridgeReservation();
    log("BOT_SESSION_CAP_REACHED", { cap: MAX_SESSIONS });
    return "deferred";
  }
  const devices = decoded.deviceEncPubKeyHex
    ? [{ statementAccountId: hexToBytes(decoded.peerStatementAccountIdHex ?? senderHex), encryptionPublicKey: hexToBytes(decoded.deviceEncPubKeyHex) }]
    : [];
  buildSession(senderHex, identifierKeyHex, devices);
  addSessionWatch(senderHex);
  ingress?.resubscribe(); // watch this peer's session topics by push, not just sweep
  // The opener's welcome message is a RichText and can carry attachments
  // (e.g. a photo as the very first message) — route them like session ones.
  const openerAttachments = (decoded.welcomeMessage?.attachments ?? [])
    .filter((a) => a.kind === "p2pMixnetFile").map(toAttachmentMeta);
  const openerMsg = {
    text: decoded.text ?? "",
    messageId: decoded.messageId,
    kind: openerAttachments.length ? "richText" : "text",
    opener: true, // an empty opener is greeted (handleInbound)
    ...(openerAttachments.length ? { attachments: openerAttachments } : {}),
  };
  if (isNew) {
    if (!oweReply(openerId, senderHex, openerMsg, decoded.messageId)) {
      releaseBridgeReservation();
      return "deferred";
    }
    seenRequests.add(openerId);
    trimSet(seenRequests, SEEN_CAP);
    // Both the semantic dedup and owed reply must survive before an ACK can
    // suppress app retries. If disk persistence fails, retry the opener later.
    if (!(await persistCritical())) {
      seenRequests.delete(openerId);
      removeOwed(openerId);
      // Replace the failed speculative snapshot so a later background retry
      // cannot persist a dedup marker for work we deliberately deferred.
      persist();
      releaseBridgeReservation();
      return "deferred";
    }
  }
  // ACK / accept so the peer establishes the session (advertise our device).
  peerClock.observe(norm(senderHex), decoded.timestamp); // accept+welcome sort after the request
  const accept = decoded.deviceEncPubKeyHex
    ? encodeOpaqueDeviceChatAcceptedMessage({
        timestamp: stamp(senderHex),
        acceptedRequestId: decoded.messageId,
        statementAccountId: accountId,
        encryptionPublicKey: deviceKeypair.publicKey,
      })
    : encodeOpaqueChatAcceptedMessage({ timestamp: stamp(senderHex), acceptedRequestId: decoded.messageId });
  const botInfo = currentBotInfo();
  try {
    // Same-tick enqueues ride one statement: [accept, welcome] on first
    // contact. An empty BOT_ACK_TEXT sends the accept alone — an empty text
    // message is an empty bubble on the phone, not "no welcome".
    const a = outbound.enqueue(senderHex, accept, { forceIdentity: true });
    const w = ackText ? outbound.enqueue(senderHex, encodeOpaqueTextMessage({ timestamp: stamp(senderHex), text: ackText }), { forceIdentity: true }) : null;
    // Spec 0008: botInfo right after the accept, in the same statement.
    const b = botInfo ? outbound.enqueue(senderHex, encodeBotInfo(senderHex, botInfo), { forceIdentity: true }) : null;
    await Promise.all([a.submitted, w?.submitted, b?.submitted]);
  } catch (error) {
    pendingOpenerAcks.add(openerId);
    // Every pending acceptance still owns an owed entry, so MAX_OWED bounds
    // this set naturally. Do not evict a retry marker independently: that
    // would strand its opener after a transient submission failure.
    // The owed record and semantic dedup are already durable. Persist the
    // narrow "ACK still required" marker so a crash does not strand the chat.
    if (!(await persistCritical())) log("BOT_OPENER_ACK_RETRY_PERSIST_FAILED", { to: senderHex });
    if (isNew) releaseBridgeReservation();
    log("BOT_ACK_FAILED", { to: senderHex, error: error instanceof Error ? error.message : String(error) });
    return "deferred";
  }
  if (pendingOpenerAcks.delete(openerId)) persist();
  if (botInfo) {
    botInfoSent.mark(norm(senderHex), botInfo.version);
    log("BOT_SENT_BOTINFO", { to: senderHex, version: botInfo.version, on: "accept" });
  }
  log("BOT_RECEIVED_OPENER", { from: senderHex, requestId: decoded.messageId, chars: String(decoded.text ?? "").length, ...(openerAttachments.length ? { attachments: openerAttachments.length } : {}) });
  // A transient acceptance failure leaves the durable owed record behind but
  // deliberately does not start its brain work until the peer has a session.
  // On the retry, admit and enqueue that existing record exactly once.
  const needsEnqueue = owedReplies.has(openerId) && !queuedOwed.has(openerId);
  if (needsEnqueue) {
    const admitted = isNew || reserveAdmission(senderHex, 1, { alreadyOwed: true });
    if (!admitted) return "handled"; // settleOwed() will re-pump when capacity frees
    if (!enqueueOwed(senderHex, openerId, openerMsg, decoded.messageId, { reservedBridge: usesBridgeQueue })) {
      releaseBridgeReservation();
      return "deferred";
    }
  }
  return "handled";
};

// ACK a session request (mirrors the app: response goes on our own session
// topic under the response channel). Without it the app treats every message
// as undelivered and resends its whole backlog forever.
const sendSessionAck = async (peerHex, requestId) => {
  const entry = sessions.get(norm(peerHex));
  if (entry == null) return;
  const payload = encodeSessionResponsePayload(entry.session, requestId);
  const transport = (entry.session.peerDevices?.length ?? 0) === 0
    ? entry.session.identitySession
    : entry.session;
  await submitBounded({
    walletPair: wallet,
    channel: transport.responseChannel,
    topics: [transport.ownSessionId],
    scaleEncodedPayload: payload,
    expiryFactory,
  });
};

// Per-peer work queues: brain calls (up to 90s) must never block the poll loop
// or delay ACKs — the app resends its whole backlog until it sees an ACK, so a
// slow model would directly cause resend storms and head-of-line blocking for
// every other peer. Work is serialized per peer (preserves reply order and
// aiHistory consistency) and concurrent across peers. Depth is capped: queued
// work is ACKed but held only in memory, so an unbounded queue would both leak
// (stuck brain × chatty peer) and widen the crash-loss window without limit —
// past the cap, new statements are deferred un-ACKed instead (see
// handleSessionStatement) and the app's resend acts as the retry.
const WORK_CAP = numberEnv("BOT_WORK_CAP", 20, { min: 1, max: 10_000 });
const peerWork = new Map(); // peerHex -> { tail, depth }
const workDepth = (peerHex) => peerWork.get(norm(peerHex))?.depth ?? 0;
let bridgeReservations = 0;
const canAdmit = (peerHex, count = 1, { alreadyOwed = false } = {}) =>
  count > 0
  && workDepth(peerHex) + count <= WORK_CAP
  && (alreadyOwed || owedReplies.size + count <= MAX_OWED)
  && (!usesBridgeQueue || inboundQueue.length + bridgeReservations + count <= INBOUND_CAP);
const reserveAdmission = (peerHex, count = 1, options = {}) => {
  if (!canAdmit(peerHex, count, options)) return false;
  if (usesBridgeQueue) bridgeReservations += count;
  return true;
};
const releaseBridgeReservation = (count = 1) => {
  if (usesBridgeQueue) bridgeReservations = Math.max(0, bridgeReservations - count);
};
const enqueueWork = (peerHex, fn) => {
  const k = norm(peerHex);
  const entry = peerWork.get(k) ?? { tail: Promise.resolve(), depth: 0 };
  entry.depth += 1;
  entry.tail = entry.tail.then(fn)
    .catch((e) => log("BOT_HANDLER_FAILED", { peer: k, error: String(e?.message ?? e) }))
    .finally(() => { entry.depth -= 1; if (entry.depth === 0 && peerWork.get(k) === entry) peerWork.delete(k); });
  peerWork.set(k, entry);
};
pumpOwed = () => {
  let pumped = 0;
  let deferred = 0;
  for (const [owedId, owed] of owedReplies) {
    if (queuedOwed.has(owedId) || owedInAdmission.has(owedId)) continue;
    if (!reserveAdmission(owed.peerHex, 1, { alreadyOwed: true })) { deferred += 1; continue; }
    if (!enqueueOwed(owed.peerHex, owedId, owed.msg, owed.requestId, { reservedBridge: usesBridgeQueue })) {
      releaseBridgeReservation();
    } else pumped += 1;
  }
  if (pumped > 0) log("BOT_OWED_PUMPED", { count: pumped, remaining: owedReplies.size });
  if (deferred > 0) log("BOT_OWED_BACKPRESSURE", { deferred, remaining: owedReplies.size });
};

const handleSessionStatement = async (data, peerHex, session, senderAccountId = hexToBytes(peerHex)) => {
  // A session may survive a restart after the operator removes its peer from
  // BOT_ALLOWED_PEERS. Enforce the current policy before decrypting or doing
  // any acknowledgement work for that old channel.
  // Spec 0009: a peer outside the allowlist that is a member of an allowed
  // admin's group gets its group kinds through, nothing else.
  const groupOnly = !isAllowed(peerHex);
  if (groupOnly && !groupAdmitted(peerHex)) {
    log("BOT_REJECTED_UNLISTED_SESSION", { from: norm(peerHex) });
    return "handled";
  }
  let decoded;
  // A follow-up we can't decrypt used to vanish silently here — log it so a
  // broken/stale session is diagnosable instead of looking like "no message".
  try { decoded = decodeSessionStatementPayload(data, session, senderAccountId); }
  catch (e) { log("BOT_SESSION_DECODE_FAILED", { from: peerHex, error: String(e?.message ?? e) }); return; }
  if (decoded?.kind === "response") {
    // The peer ACKed one of OUR request statements — frees the peer's
    // outbound lane slot (and, through it, unlocks live-reply edits).
    outbound.onAck(norm(peerHex), decoded.requestId);
    touchSession(peerHex);
    return "handled";
  }
  if (decoded?.kind !== "request") return "handled";
  const fresh = [];   // messages that run the brain (journaled + owed)
  const declines = []; // call offers to auto-decline after the ACK
  const groupControls = []; // spec 0011 kind-249 controls, handled after the ACK
  const stops = [];
  const newlySeen = [];
  const batchSeen = new Set();
  const deletedNow = []; // RFC-0003 targets deleted by this batch
  let stateChanged = false;
  let undecodable = 0;
  for (let m of decoded.messages ?? []) {
    peerClock.observe(norm(peerHex), m.timestamp);
    // Initiator side of an outgoing greeting: the peer's accept can advertise
    // their device encryption key — fold it into the session (and subscribe to
    // its topics) or the peer's device-channel replies would go unseen.
    if ((m.kind === "deviceChatAccepted" || m.kind === "deviceAdded") && m.encryptionPublicKey) {
      const entry = sessions.get(norm(peerHex));
      if (entry) {
        buildSession(peerHex, entry.identifierKeyHex, [{ statementAccountId: m.statementAccountId, encryptionPublicKey: m.encryptionPublicKey }]);
        ingress?.resubscribe();
        stateChanged = true;
        log("BOT_PEER_DEVICE_ADDED", { from: peerHex, device: norm(bytesToHex(m.encryptionPublicKey)).slice(0, 16) });
      }
      continue;
    }
    // deviceRemoved (18): the peer unpaired a device (Android's fan-out sends
    // it from a remaining one). Drop it from the roster so envelopes stop
    // being wrapped for it and its session topic leaves the watch set.
    if (m.kind === "deviceRemoved") {
      const removed = m.statementAccountIdHex;
      const entry = sessions.get(norm(peerHex));
      if (removed && entry) {
        const kept = (entry.session.peerDevices ?? []).filter((d) => norm(bytesToHex(d.statementAccountId)) !== removed);
        if (kept.length !== (entry.session.peerDevices ?? []).length) {
          buildSession(peerHex, entry.identifierKeyHex, kept, { replace: true });
          ingress?.resubscribe();
          stateChanged = true;
          log("BOT_PEER_DEVICE_REMOVED", { from: peerHex, device: removed.slice(0, 16), remaining: kept.length });
        }
      }
      continue;
    }
    if (m.kind === "undecodable") {
      undecodable += 1;
      continue;
    }
    const groupKind = m.kind === "groupInfo" || m.kind === "groupMessage" || m.kind === "groupLeave" || m.kind === "groupControl";
    if (groupOnly && !groupKind) {
      if (m.kind !== "chatAccepted" && m.kind !== "typing" && m.kind !== "seen") log("BOT_GROUP_ONLY_DROPPED", { from: peerHex, kind: m.kind });
      continue;
    }
    // /stop: cancel the peer's in-flight turn. Handled synchronously HERE —
    // before the per-peer work queue — because a queued /stop would sit behind
    // the very turn it means to cancel. Direct engines only (bridge harnesses
    // own their own stop). Deduped like any message so resends don't re-fire.
    if (agentRuntime && m.kind === "text" && /^\s*\/stop\s*$/i.test(m.text ?? "")) {
      if (!m.messageId) continue;
      const id = messageDedupId(peerHex, decoded.requestId, "stop", m.messageId);
      if (seenRequests.has(id) || batchSeen.has(id)) continue;
      batchSeen.add(id); newlySeen.push(id); stops.push(id);
      continue;
    }
    // Which extension kinds this peer sends: a log, it gates nothing.
    if (m.kind === "buttons" || m.kind === "buttonPress" || m.kind === "typing" || m.kind === "seen" || m.kind === "botInfo" || m.kind === "transactionReference"
      || (m.kind === "unsupported" && m.contentKind >= 240 && m.contentKind <= 249)) {
      observeExtension(peerHex, m.kind === "unsupported" ? "extension" : m.kind);
    }
    // Spec 0005: typing and seen are ephemeral signals. Never answered, never
    // fed to the brain, never stored or deduped (a duplicate only logs twice).
    // The bot keeps no per-message delivery state, so a seen changes nothing.
    if (m.kind === "typing") {
      logDebug("BOT_RECEIVED_TYPING", { from: peerHex, kind: m.typingKind, until: m.until });
      continue;
    }
    if (m.kind === "seen") {
      logDebug("BOT_RECEIVED_SEEN", { from: peerHex, upTo: m.upTo, at: m.at });
      continue;
    }
    // Spec 0008: a peer's botInfo (another bot) is stored, latest version
    // wins, and never answered: two bots must not loop on each other.
    if (m.kind === "botInfo") {
      const outcome = peerBotInfo.record(norm(peerHex), m);
      if (outcome === "stored") stateChanged = true;
      log("BOT_RECEIVED_BOTINFO", { from: peerHex, kind: m.botKind, name: m.name, version: m.version, commands: m.commands.length, ...(outcome === "stale" ? { stale: true } : {}) });
      continue;
    }
    // Spec 0009: group kinds (lib/groups.mjs has the rules). A groupMessage
    // with text-like content runs a group turn; the rest changes the roster.
    // Deduped per peer like any message, and group-wide by envelope id.
    if (groupKind) {
      observeExtension(peerHex, m.kind);
      if (!m.messageId) continue;
      const groupRef = m.groupId ?? Object.values(m.control ?? {})[0]?.groupId;
      const id = messageDedupId(peerHex, decoded.requestId, `${m.kind}:${groupRef}`, m.messageId);
      if (seenRequests.has(id) || batchSeen.has(id)) continue;
      batchSeen.add(id); newlySeen.push(id);
      if (!extensionOn("groups")) {
        log("BOT_GROUP_IGNORED", { from: peerHex, kind: m.kind, reason: "the groups extension is off" });
        continue;
      }
      stateChanged = true;
      // Spec 0011 controls run after the ACK (a welcome reads the topic).
      if (m.kind === "groupControl") { groupControls.push(m); continue; }
      const turn = receiveGroupContent(peerHex, m);
      if (turn) fresh.push({ id, msg: turn });
      continue;
    }
    // A buttonPress runs a brain turn, but only for a buttons message this
    // bot sent to THIS peer; a foreign or unknown press is logged and dropped.
    if (m.kind === "buttonPress") {
      if (!m.messageId) continue;
      const id = messageDedupId(peerHex, decoded.requestId, `buttonPress:${m.targetMessageId}:${m.row}:${m.index}`, m.messageId);
      if (seenRequests.has(id) || batchSeen.has(id)) continue;
      batchSeen.add(id); newlySeen.push(id);
      const press = { from: peerHex, messageId: m.targetMessageId, row: m.row, index: m.index };
      const label = sentButtons.label(norm(peerHex), m.targetMessageId, m.row, m.index);
      if (label == null) {
        stateChanged = true;
        log("BOT_BUTTON_PRESS_IGNORED", { ...press, reason: "not a button this bot sent to this peer" });
        continue;
      }
      log("BOT_RECEIVED_BUTTON_PRESS", press);
      fresh.push({ id, msg: { text: buttonPressText(label, m.payload), messageId: m.messageId, kind: "text" } });
      continue;
    }
    // Brain-run kinds. Text must be non-empty unless attachments carry the
    // content (a caption-less photo). A buttons message from a peer reaches
    // the brain as its fallback text (the brain cannot press buttons).
    if (m.kind === "buttons") m = { ...m, kind: "text", text: buttonsFallbackText(m.text, m.rows) };
    const attachments = (m.richText?.attachments ?? []).filter((a) => a.kind === "p2pMixnetFile").map(toAttachmentMeta);
    const isBrainKind = (m.kind === "text" || m.kind === "richText" || m.kind === "reply" || m.kind === "edited")
      && typeof m.text === "string" && (m.text.length > 0 || attachments.length > 0);
    if (isBrainKind) {
      const id = messageDedupId(peerHex, decoded.requestId, `${m.kind}:${m.text}`, m.messageId);
      const alreadySeen = seenRequests.has(id) || batchSeen.has(id);
      if (alreadySeen) continue;
      batchSeen.add(id); newlySeen.push(id);
      // RFC-0003: never answer a message the peer already deleted (the
      // deletion can arrive first), and never let an edit revive one.
      const k = norm(peerHex);
      const editOfDeleted = m.kind === "edited" && deletions.isDeleted(k, m.targetMessageId);
      if ((m.messageId && deletions.arrived(k, m.messageId)) || editOfDeleted) {
        stateChanged = true;
        log("BOT_DELETED_MESSAGE_DROPPED", { from: k, messageId: m.messageId ?? null, stage: editOfDeleted ? "edit" : "arrival" });
        continue;
      }
      if (m.messageId && attachments.length) {
        receivedAttachments.set(`${k}:${m.messageId}`, attachments.map((a) => a.id));
        trimMap(receivedAttachments, SEEN_CAP);
      }
      fresh.push({
        id,
        msg: {
          text: m.text,
          messageId: m.messageId ?? id,
          kind: m.kind,
          ...(m.kind === "reply" ? { replyTo: m.replyToMessageId } : {}),
          ...(m.kind === "edited" ? { editOf: m.targetMessageId } : {}),
          ...(attachments.length ? { attachments } : {}),
        },
      });
      continue;
    }
    // Everything below is a signal, not a message: recorded/acted on, never
    // journaled (informational — loss on crash is acceptable). Same
    // messageId-first dedup so app resends don't double-fire.
    if (!m.messageId) continue;
    const id = messageDedupId(peerHex, decoded.requestId, m.kind, m.messageId);
    if (seenRequests.has(id) || batchSeen.has(id)) continue;
    batchSeen.add(id); newlySeen.push(id);
    if (m.kind === "reaction") {
      // Logged + bridged as an event, never answered (a chat reply to a
      // reaction is bizarre UX). Not fed into a direct engine's session:
      // injecting it would require running a turn, which would reply.
      log("BOT_RECEIVED_REACTION", { from: peerHex, emoji: m.emoji, target: m.targetMessageId, removed: m.removed });
      enqueueEvent({ chat_id: peerHex, kind: "reaction", message_id: m.messageId, target_message_id: m.targetMessageId, emoji: m.emoji, removed: m.removed, text: `[user ${m.removed ? "removed their reaction" : `reacted ${m.emoji}`}]` });
    } else if (m.kind === "coinageSend") {
      // Informational only: claiming the coins needs the full Coinage stack.
      log("BOT_COINAGE_RECEIVED", { from: peerHex, totalValue: m.totalValueString, coins: m.coinKeys.length });
      enqueueEvent({ chat_id: peerHex, kind: "coinageSend", message_id: m.messageId, total_value: m.totalValueString, text: `[user sent a Coinage payment (raw value ${m.totalValueString}) — the bot cannot claim it]` });
    } else if (m.kind === "contactAdded" || m.kind === "leftChat") {
      log(m.kind === "leftChat" ? "BOT_PEER_LEFT" : "BOT_CONTACT_ADDED", { from: peerHex });
      enqueueEvent({ chat_id: peerHex, kind: m.kind, message_id: m.messageId, text: m.kind === "leftChat" ? "[user left the chat]" : "[user added the bot as a contact]" });
    } else if (m.kind === "dataChannelOffer") {
      // A WebRTC call — the bot has no media stack, so decline instead of
      // ringing forever. Log the purpose byte to learn its values in the wild.
      log("BOT_CALL_OFFER", { from: peerHex, purpose: m.purpose, sdpLength: m.sdpLength });
      declines.push(m.messageId);
    } else if (m.kind === "deleted") {
      // RFC-0003: applied only to a message this peer sent us (the receive
      // record is keyed by peer). Never rendered, never answered.
      const k = norm(peerHex);
      observeExtension(k, "deleted");
      stateChanged = true;
      if (!m.targetMessageId) continue;
      const key = `${k}:${m.targetMessageId}`;
      const outcome = deletions.record(k, m.targetMessageId, { known: seenRequests.has(key) || batchSeen.has(key) });
      if (outcome === "applied") deletedNow.push(m.targetMessageId);
      log("BOT_RECEIVED_DELETED", {
        from: peerHex,
        messageId: m.targetMessageId,
        applied: outcome === "applied" ? true : outcome === "pending" ? "pending" : false,
        ...(outcome === "duplicate" ? { duplicate: true } : {}),
      });
      if (outcome === "applied") enqueueEvent({ chat_id: peerHex, kind: "deleted", message_id: m.messageId, target_message_id: m.targetMessageId, text: "[user deleted one of their messages]" });
    } else if (m.kind === "transactionReference") {
      // Spec 0007: stored per peer, never answered, never trusted. The meter
      // re-reads the chain (the reference may be a top-up) and only logs.
      const k = norm(peerHex);
      const ref = { messageId: m.messageId, chainId: m.chainId, hash: `0x${bytesToHex(m.hash)}`, status: m.status, block: m.block, note: m.note, intentMessageId: m.intentMessageId, at: Date.now() };
      const refs = peerTxRefs.get(k) ?? [];
      peerTxRefs.delete(k);
      peerTxRefs.set(k, [...refs, ref].slice(-PEER_TX_REFS_CAP));
      trimMap(peerTxRefs, SEEN_CAP);
      log("BOT_RECEIVED_TX_REFERENCE", { from: peerHex, status: m.status, block: m.block, hash: ref.hash, note: m.note, ...(m.intentMessageId ? { intentMessageId: m.intentMessageId } : {}) });
      if (meter) meter.onReference(k, ref);
      if (flip) flip.onReference(k, ref);
    } else if (m.kind === "unsupported") {
      log("BOT_UNSUPPORTED_CONTENT", { from: peerHex, contentKind: m.contentKind });
    }
    // chatAccepted / dataChannelClosed: nothing to do.
  }
  if (deletedNow.length) {
    const gone = new Set(deletedNow);
    for (let i = fresh.length - 1; i >= 0; i -= 1) if (gone.has(fresh[i].msg.messageId)) fresh.splice(i, 1);
    for (const target of deletedNow) scrubDeleted(peerHex, target);
  }
  if (fresh.length && !reserveAdmission(peerHex, fresh.length)) return "deferred";
  const addedOwed = [];
  const dropAdded = () => { for (const id of addedOwed) { removeOwed(id); owedInAdmission.delete(id); } };
  for (const f of fresh) {
    if (!oweReply(f.id, peerHex, f.msg, decoded.requestId)) {
      dropAdded();
      releaseBridgeReservation(fresh.length);
      return "deferred";
    }
    addedOwed.push(f.id);
    owedInAdmission.add(f.id); // this path enqueues it below; the pump must not
  }
  for (const id of newlySeen) seenRequests.add(id);
  trimSet(seenRequests, SEEN_CAP);
  if (fresh.length || newlySeen.length || stateChanged) {
    // Journal semantic dedup + owed work before ACK. If the write fails, leave
    // the app statement un-ACKed and let normal retransmission retry it.
    if (!(await persistCritical())) {
      for (const id of newlySeen) seenRequests.delete(id);
      dropAdded();
      // See opener rollback above: retain only the post-rollback state for a
      // later retry if storage recovers.
      persist();
      releaseBridgeReservation(fresh.length);
      return "deferred";
    }
  }
  // Queue the durable work before attempting the protocol ACK. A failed ACK is
  // retried when the peer resends; dedup suppresses a second model invocation.
  for (const f of fresh) {
    log("BOT_RECEIVED_TEXT", { from: peerHex, chars: f.msg.text.length, ...(f.msg.kind !== "text" ? { kind: f.msg.kind } : {}), ...(f.msg.attachments ? { attachments: f.msg.attachments.length } : {}) });
    owedInAdmission.delete(f.id);
    enqueueOwed(peerHex, f.id, f.msg, decoded.requestId, { reservedBridge: usesBridgeQueue });
  }
  // ACK means "delivered", not "answered" — send it before any brain work so
  // the app stops resending even when the model is slow.
  try { await sendSessionAck(peerHex, decoded.requestId); }
  catch (e) {
    log("BOT_SESSION_ACK_FAILED", { to: peerHex, error: String(e?.message ?? e) });
    return "deferred";
  }
  touchSession(peerHex);
  if (undecodable > 0) log("BOT_UNDECODABLE_MESSAGES", { from: peerHex, count: undecodable });
  for (const id of stops) {
    const stopped = agentRuntime.stop(peerHex);
    log("BOT_STOP", { from: peerHex, stopped });
    void (async () => {
      const lp = await takeLivePlaceholder(peerHex);
      if (lp) await lp.handle.finalize("⏹ Stopped.").catch((e) => log("BOT_LIVE_FINALIZE_FAILED", { to: peerHex, error: String(e?.message ?? e) }));
      else await sendText(peerHex, stopped ? "⏹ Stopped." : "Nothing to stop right now.").catch(() => {});
    })();
  }
  for (const m of groupControls) enqueueWork(peerHex, () => handleGroupControl(peerHex, m));
  for (const offerId of declines) {
    enqueueWork(peerHex, async () => {
      try {
        if (sessions.get(norm(peerHex)) == null) return;
        await outbound.enqueue(norm(peerHex), encodeOpaqueDataChannelClosedMessage({ timestamp: stamp(peerHex), offerId })).submitted;
        log("BOT_CALL_DECLINED", { to: peerHex, offerId });
      } catch (e) { log("BOT_CALL_DECLINE_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
    });
  }
  return "handled";
};

// ---------- polling ----------
const requestDayTopics = () => {
  const topics = [chatRequestAllPeerStatementsTopic(accountId)];
  const today = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
  if (today != null) {
    for (let d = today - lookbackDays; d <= today + futureDays; d += 1) topics.push(chatRequestPaginationTopic(accountId, d));
  }
  return topics;
};
const watchedSessionPeers = new Set();
const addSessionWatch = (peerHex) => { watchedSessionPeers.add(norm(peerHex)); };
let ingress = null; // set at startup when subscription ingress is enabled
const peerHasOwed = (peerHex) => {
  const key = norm(peerHex);
  for (const owed of owedReplies.values()) if (norm(owed.peerHex) === key) return true;
  return false;
};
const pruneSessions = ({ forceCap = false } = {}) => {
  const now = Date.now();
  const removable = [...sessions.entries()]
    .filter(([peerHex, entry]) =>
      workDepth(peerHex) === 0
      && !peerHasOwed(peerHex)
      && !livePlaceholders.has(peerHex)
      && (forceCap || now - (entry.lastActiveAt ?? 0) >= SESSION_IDLE_MS))
    .sort(([, a], [, b]) => (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0));
  let removed = 0;
  for (const [peerHex] of removable) {
    if (!forceCap && now - (sessions.get(peerHex)?.lastActiveAt ?? now) < SESSION_IDLE_MS) continue;
    // An inactive peer that never ACKed an old reply would otherwise keep an
    // outbound lane and its closures forever. Retire that lane only as part
    // of this explicit session-expiry policy; active/pumping lanes are left
    // intact and retried on the next sweep.
    if (outbound.hasPending(peerHex) && !outbound.expire(peerHex, "session retention expired")) continue;
    sessions.delete(peerHex);
    watchedSessionPeers.delete(peerHex);
    removed += 1;
    if (forceCap && sessions.size < MAX_SESSIONS) break;
  }
  if (removed > 0) {
    persist();
    log("BOT_SESSIONS_PRUNED", { removed, remaining: sessions.size });
  }
  return removed;
};

// Poll liveness: an RPC outage used to be swallowed here, so a dead bot polled
// into the void while /health still said ok. Track outcomes instead — a query
// error returns null (distinct from a successful empty []), and the tick result
// drives BOT_POLL_DEGRADED/RECOVERED logs, /health, and backoff.
let lastPollOkAt = Date.now();
let pollFailStreak = 0;
let lastPollError = null;
let tickErrored = 0, tickOk = 0, tickDeferred = 0;
// Topics are queried in matchAny batches so per-tick RPC count stays ~constant
// as peers accumulate (one query per TOPIC_BATCH topics, not one per topic),
// and batches run concurrently. Reads are independent — only per-session
// HANDLING order matters, and handling stays serial below.
const TOPIC_BATCH = numberEnv("BOT_TOPIC_BATCH", 16, { min: 1, max: 256 });
const QUERY_CONCURRENCY = 4;
const queryTopics = async (topics) => {
  try {
    const v = await withTimeout(
      statementStore.queryStatements({ matchAny: topics }).match((x) => x, (e) => { throw new Error(String(e?.message ?? e)); }),
      queryTimeoutMs, "statement query");
    tickOk += 1;
    return v;
  } catch (e) { tickErrored += 1; lastPollError = String(e?.message ?? e); return null; }
};
// A decoded statement's topics may be raw bytes or hex depending on the codec
// path; normalize to the bare-hex key used by the watch map.
const topicHex = (t) => norm(typeof t === "string" ? t : bytesToHex(t));

// Watch map: every topic we ingest -> how to dispatch a statement that
// carries it. Openers arrive on the request-day topics; follow-ups on the
// peer's identity session topic AND each per-device session topic (the app's
// devices publish on device topics, NOT the identity topic — identity-only
// ingestion silently misses app follow-ups).
const buildWatch = () => {
  pruneSessions();
  const watch = new Map(); // bare-hex topic -> {kind:"opener"} | {kind:"session", peerHex, session, sender}
  for (const topic of requestDayTopics()) watch.set(topicHex(topic), { kind: "opener", topic });
  for (const topic of groupsV2.topics()) watch.set(topicHex(topic), { kind: "group", topic });
  for (const peerHex of watchedSessionPeers) {
    const entry = sessions.get(peerHex);
    if (entry == null) continue;
    watch.set(topicHex(entry.session.peerSessionId), {
      kind: "session", topic: entry.session.peerSessionId, peerHex, session: entry.session, sender: hexToBytes(peerHex),
    });
    // The app answers a bot-initiated (greet) request on the IDENTITY session —
    // X25519(app identity key, our on-chain identifier key) — not on the
    // device-derived one, and we reply there too while the peer has no known
    // devices (see submitPayload). Watching only the device topic silently
    // missed every first reply (verified against the store, 2026-08-28).
    const identity = entry.session.identitySession;
    if (identity && !watch.has(topicHex(identity.peerSessionId))) {
      watch.set(topicHex(identity.peerSessionId), {
        kind: "session", topic: identity.peerSessionId, peerHex, session: identity, sender: hexToBytes(peerHex),
      });
    }
    for (const ds of entry.session.incomingDeviceSessions ?? []) {
      const th = topicHex(ds.peerSessionId);
      if (watch.has(th)) continue;
      watch.set(th, { kind: "session", topic: ds.peerSessionId, peerHex, session: ds, sender: ds.peerStatementAccountId });
    }
  }
  return watch;
};

// Route one statement, attributing it by the watched topic it carries
// (statements hold their topics; batched filters lose the per-query 1:1).
const statementTarget = (st, watch) =>
  (st.topics ?? []).map((topic) => watch.get(topicHex(topic))).find(Boolean) ?? null;
const dispatchStatement = async (st, watch, target = null) => {
  const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
  const key = fp(data);
  if (seenStatements.has(key)) return;
  const route = target ?? statementTarget(st, watch);
  if (!route) return;
  let outcome;
  if (route.kind === "opener") {
    outcome = await handleOpener(data);
  } else if (route.kind === "group") {
    outcome = await handleGroupStatement(st);
  } else {
    outcome = await handleSessionStatement(data, route.peerHex, route.session, route.sender);
  }
  if (outcome === "deferred") {
    // A deferred statement (pipeline full) must be re-examined on a later
    // sweep — the app's resend covers the subscription path too.
    tickDeferred += 1;
    return;
  }
  // An opener held for its sender's identifier key: not seen, not
  // backpressure. The identifier wait replays it (or a sweep drops it once
  // the window closed).
  if (outcome === "waiting") return;
  // Only dedup after a handler has either completed or deliberately rejected
  // the statement. Transport ACK failures return "deferred" above so retries
  // still reach the ACK path instead of being silently ignored.
  noteSeenStatement(key);
};

// Session statements retain ordering per peer, but a slow RPC/ACK for one
// chat must not stall every other chat. The dispatcher bounds subscription
// backlog as well; dropped statements remain un-ACKed and return on a normal
// resend or reconciliation sweep.
const dispatchConcurrency = numberEnv("BOT_DISPATCH_CONCURRENCY", 4, { min: 1, max: 128 });
const dispatchQueueCap = numberEnv("BOT_DISPATCH_QUEUE_CAP", 1000, { min: 1, max: 100_000 });
const dispatchInputCap = numberEnv("BOT_DISPATCH_INPUT_CAP", dispatchQueueCap, { min: 1, max: 100_000 });
const statementDispatcher = createKeyedDispatcher({ concurrency: dispatchConcurrency, maxQueued: dispatchQueueCap });
let lastDispatchBackpressureAt = 0;
let lastDispatchInputCapAt = 0;
const queueStatement = (st, watch) => {
  const target = statementTarget(st, watch);
  if (!target) return null;
  // New openers need a decrypt before their peer is known, so they share one
  // short ordered lane. Established sessions are keyed by peer and run in
  // parallel within the global cap.
  // Group statements share one ordered lane (a state before the carriers it admits).
  const routeKey = target.kind === "session" ? `session:${norm(target.peerHex)}` : target.kind === "group" ? "groups" : "openers";
  const task = statementDispatcher.run(routeKey, () => dispatchStatement(st, watch, target));
  if (task) return task.catch((error) => log("BOT_DISPATCH_FAILED", { error: String(error?.message ?? error) }));
  tickDeferred += 1;
  const now = Date.now();
  if (now - lastDispatchBackpressureAt >= 1000) {
    lastDispatchBackpressureAt = now;
    log("BOT_DISPATCH_BACKPRESSURE", statementDispatcher.stats());
  }
  return null;
};
// Bound raw input before creating task promises. The dispatcher caps its own
// backlog, but a node/subscription response can still contain an arbitrarily
// large array that would otherwise be flattened and mapped in one tick.
const queueStatementPages = (pages, watch) => {
  const tasks = [];
  let admitted = 0;
  let dropped = 0;
  for (const statements of pages ?? []) {
    if (!Array.isArray(statements) || statements.length === 0) continue;
    const remaining = Math.max(0, dispatchInputCap - admitted);
    const take = Math.min(remaining, statements.length);
    for (let index = 0; index < take; index += 1) {
      const task = queueStatement(statements[index], watch);
      if (task) tasks.push(task);
    }
    admitted += take;
    dropped += statements.length - take;
  }
  if (dropped > 0) {
    tickDeferred += dropped;
    const now = Date.now();
    if (now - lastDispatchInputCapAt >= 1000) {
      lastDispatchInputCapAt = now;
      log("BOT_DISPATCH_INPUT_CAPPED", { cap: dispatchInputCap, dropped });
    }
  }
  return Promise.all(tasks);
};
const queueStatements = (statements, watch) => queueStatementPages([statements], watch);

const pollOnce = async () => {
  tickErrored = 0; tickOk = 0; tickDeferred = 0;
  // During a total outage every query burns the full timeout — a few straight
  // failures with zero successes = give up this tick; backoff and the next
  // tick take it from there.
  const tickDead = () => tickOk === 0 && tickErrored >= 3;
  const watch = buildWatch();
  // Query all watched topics in bounded-concurrency matchAny batches.
  const allTopics = [...watch.values()].map((w) => w.topic);
  const batches = [];
  for (let i = 0; i < allTopics.length; i += TOPIC_BATCH) batches.push(allTopics.slice(i, i + TOPIC_BATCH));
  const results = new Array(batches.length);
  await runWithConcurrency(batches, QUERY_CONCURRENCY, async (batch, i) => {
    results[i] = tickDead() ? null : await queryTopics(batch);
  });
  await queueStatementPages(results, watch);
  if (tickDeferred > 0) log("BOT_BACKPRESSURE", { deferredStatements: tickDeferred });
  // Tick outcome: any successful query means the chain is reachable. All-errors
  // (and at least one attempt) means an outage — surface it, don't poll blindly.
  if (tickOk > 0) {
    if (pollFailStreak > 0) log("BOT_POLL_RECOVERED", { afterFailures: pollFailStreak });
    pollFailStreak = 0; lastPollOkAt = Date.now();
  } else if (tickErrored > 0) {
    pollFailStreak += 1;
    if (pollFailStreak === 1 || pollFailStreak % 10 === 0) log("BOT_POLL_DEGRADED", { failStreak: pollFailStreak, error: lastPollError });
  }
};

// ---------- HTTP bridge ----------
const BRIDGE_BODY_MAX_BYTES = numberEnv("BOT_BRIDGE_BODY_MAX_BYTES", 1_000_000, { min: 1024, max: 8 * 1024 * 1024 });
const BRIDGE_TEXT_MAX_BYTES = numberEnv("BOT_BRIDGE_TEXT_MAX_BYTES", 128 * 1024, { min: 1, max: 480 * 1024 });
const BRIDGE_FILE_MAX_BYTES = numberEnv("BOT_BRIDGE_FILE_MAX_BYTES", fileMaxBytes, { min: 1, max: fileMaxBytes });
const BRIDGE_MESSAGE_ID_MAX = 128;
const PEER_ID_RE = /^[0-9a-f]{64}$/i;
const bridgeAuthorized = (req) => {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const token = value?.replace(/^Bearer\s+/i, "") ?? String(req.headers["x-bridge-token"] ?? "");
  const expected = Buffer.from(bridgeToken);
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const readBody = (req, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let bytes = 0;
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      finish(reject, new Error("request body too large"));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (settled) return;
    finish(resolve, Buffer.concat(chunks));
  });
  req.on("aborted", () => finish(reject, new Error("request aborted")));
  req.on("error", (error) => finish(reject, error));
});
const readJson = async (req) => {
  const body = await readBody(req, BRIDGE_BODY_MAX_BYTES);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
};
const bridgeFileRoute = (pathname) => {
  const match = /^\/files\/([0-9a-f]{64})(?:\/(.*))?$/i.exec(pathname);
  if (!match) return null;
  let filePath = null;
  if (match[2] != null) {
    try { filePath = decodeURIComponent(match[2]); }
    catch { return { invalid: true }; }
  }
  return { peerHex: norm(match[1]), filePath };
};
const fileBridgeFailure = (json, error) => {
  const code = error?.code;
  const status = code === "FILE_STORE_EXISTS" ? 409
    : code === "FILE_STORE_FILE_TOO_LARGE" ? 413
      : code === "FILE_STORE_FULL" || code === "FILE_STORE_ENTRY_LIMIT" || code === "FILE_STORE_PEER_FULL" || code === "FILE_STORE_PEER_ENTRY_LIMIT" ? 507
        : 400;
  return json(status, { success: false, error: String(error?.message ?? error) });
};
const startBridge = () => {
  const server = http.createServer(async (req, res) => {
    let url;
    const json = (code, obj) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    try {
      url = new URL(req.url, "http://localhost");
      if (!bridgeAuthorized(req)) return json(401, { success: false, error: "unauthorized" });
      if (req.method === "GET" && url.pathname === "/health") {
        // ok reflects real reachability, not just "the process is up": both RPC
        // sockets must be connected. (A disconnected socket buffers requests
        // instead of failing them, so socket state — not query success — is the
        // reliable signal.)
        const connected = chainConnected();
        const ing = ingress?.supervisor.snapshot();
        return json(connected ? 200 : 503, {
          ok: connected, account: `0x${accountIdHex}`, identifierKey: `0x${norm(bytesToHex(identifierKey))}`, username,
          chain: wsProvider.getStatus?.().type ?? "unknown", peopleChain: papiProvider.getStatus?.().type ?? "unknown",
          pollFailStreak, lastPollAgoMs: Date.now() - lastPollOkAt,
          ingress: ing ? { healthy: ing.sinceOkMs < ing.staleMs, sinceOkMs: ing.sinceOkMs, recoveries: ing.consecutiveRecoveries } : null,
          dispatch: statementDispatcher.stats(),
          agent: agentRuntime?.queueStats() ?? null,
          owed: { count: owedReplies.size, bytes: owedReplyBytes, byteCap: MAX_OWED_BYTES },
          files: {
            ...fileStore.stats(),
            delivery: {
              configured: Boolean(hopUploadNode),
              allowanceAccount: `0x${hopUploadAccountIdHex}`,
              allowance: "operator-provisioned",
              ...(hopUploadNode ? { node: new URL(hopUploadNode).hostname } : {}),
            },
          },
          // Capability advertisement for harness adapters (OpenClaw-style
          // supportsEdit gating): edits exist and are throttled server-side.
          live: { supportsEdit: true, minEditMs: liveMinEditMs, placeholderAfterMs: thinkingText && thinkingAfterMs > 0 ? placeholderAfterMs() : null },
        });
      }
      if (req.method === "GET" && url.pathname === "/inbound") {
        const requestedWait = Number(url.searchParams.get("wait") ?? 25);
        const waitSecs = Number.isFinite(requestedWait) ? Math.min(60, Math.max(0, requestedWait)) : 25;
        const requestedLimit = Number(url.searchParams.get("limit") ?? BRIDGE_DELIVERY_BATCH_CAP);
        const limit = Number.isSafeInteger(requestedLimit)
          ? Math.min(BRIDGE_DELIVERY_BATCH_CAP, Math.max(1, requestedLimit))
          : BRIDGE_DELIVERY_BATCH_CAP;
        // events=1 opts in to non-message signals (reactions, coinage, …); a
        // harness that didn't ask would chat-reply to a reaction.
        const events = url.searchParams.get("events") === "1";
        const ready = drainInbound(events, limit);
        if (ready.length > 0) return json(200, ready);
        if (waiters.size >= BRIDGE_WAITER_CAP) return json(429, { success: false, error: "too many bridge pollers" });
        const drained = await new Promise((resolve) => {
          const waiter = { resolve, events, limit, req, res, timer: null, abort: null, close: null };
          waiter.abort = () => finishWaiter(waiter, null);
          waiter.close = () => {
            if (!res.writableEnded) finishWaiter(waiter, null);
          };
          waiter.timer = setTimeout(() => finishWaiter(waiter, []), waitSecs * 1000);
          waiter.timer.unref?.();
          req.once("aborted", waiter.abort);
          res.once("close", waiter.close);
          waiters.add(waiter);
        });
        if (drained == null || req.destroyed) return;
        return json(200, drained);
      }
      if (req.method === "GET" && url.pathname.startsWith("/media/")) {
        // The id regex inside mediaStore.find is the path-traversal guard.
        const found = mediaStore.find(url.pathname.slice("/media/".length));
        if (!found) return json(404, { error: "not found" });
        res.writeHead(200, { "content-type": found.mime });
        fs.createReadStream(found.path).pipe(res);
        return;
      }
      const fileRoute = bridgeFileRoute(url.pathname);
      if (fileRoute) {
        if (fileRoute.invalid) return json(400, { success: false, error: "invalid file path" });
        try {
          if (req.method === "GET" && fileRoute.filePath == null) {
            const prefix = url.searchParams.get("prefix") ?? "";
            const files = fileStore.list(fileRoute.peerHex, prefix).map(({ peer, ...entry }) => entry);
            return json(200, { success: true, files });
          }
          if (req.method === "GET") {
            if (!fileRoute.filePath) return json(400, { success: false, error: "file path required" });
            const file = fileStore.get(fileRoute.peerHex, fileRoute.filePath);
            if (!file) return json(404, { success: false, error: "not found" });
            res.writeHead(200, { "content-type": file.mime, "content-length": file.size });
            fs.createReadStream(file.filePath).pipe(res);
            return;
          }
          if (req.method === "PUT") {
            if (!fileRoute.filePath) return json(400, { success: false, error: "file path required" });
            const rawMime = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
            const mime = String(rawMime ?? "application/octet-stream").split(";", 1)[0].trim();
            const bytes = await readBody(req, BRIDGE_FILE_MAX_BYTES);
            const saved = fileStore.putBytes(fileRoute.peerHex, fileRoute.filePath, bytes, {
              mime,
              overwrite: url.searchParams.get("overwrite") === "1",
            });
            return json(201, { success: true, path: saved.path, mime: saved.mime, size: saved.size });
          }
          if (req.method === "DELETE") {
            if (!fileRoute.filePath) return json(400, { success: false, error: "file path required" });
            if (!fileStore.remove(fileRoute.peerHex, fileRoute.filePath)) return json(404, { success: false, error: "not found" });
            return json(200, { success: true });
          }
        } catch (error) {
          return fileBridgeFailure(json, error);
        }
      }
      if (req.method === "POST" && url.pathname === "/inbound/ack") {
        const body = await readJson(req);
        const claims = body.deliveries
          ?? body.delivery_ids
          ?? (body.delivery_id || body.lease_id ? [{ delivery_id: body.delivery_id, lease_id: body.lease_id }] : []);
        const result = await acknowledgeInbound(claims);
        if (result.invalid) return json(400, { success: false, error: "each acknowledgement requires delivery_id and lease_id" });
        if (!result.persisted) return json(503, { success: false, error: "could not persist acknowledgement; retry the lease" });
        return json(200, { success: true, acknowledged: result.acknowledged });
      }
      if (req.method === "POST" && url.pathname === "/inbound/renew") {
        const body = await readJson(req);
        const claims = body.deliveries
          ?? body.delivery_ids
          ?? (body.delivery_id || body.lease_id ? [{ delivery_id: body.delivery_id, lease_id: body.lease_id }] : []);
        const result = renewInbound(claims);
        if (result.invalid) return json(400, { success: false, error: "each renewal requires delivery_id and lease_id" });
        if (result.renewed === 0) return json(409, { success: false, error: "lease is no longer active" });
        return json(200, { success: true, renewed: result.renewed, lease_ms: BRIDGE_LEASE_MS });
      }
      if (req.method === "POST" && url.pathname === "/send") {
        const { chat_id: chatId, text, file_path: filePath, reply_to: replyTo, edit_of: editOf, group_id: groupId } = await readJson(req);
        const hasText = typeof text === "string" && text.length > 0;
        // Spec 0009: an answer to a group turn fans out to the group.
        if (groupId != null) {
          if (typeof groupId !== "string" || (!groups.get(groupId) && !groupsV2.get(groupId))) return json(404, { success: false, error: "unknown group_id" });
          if (!hasText) return json(400, { success: false, error: "text required for a group" });
          if (Buffer.byteLength(text) > BRIDGE_TEXT_MAX_BYTES) return json(413, { success: false, error: "text too large" });
          const messageId = await deliverToGroup(groupId, text);
          return messageId
            ? json(200, { success: true, message_id: messageId })
            : json(409, { success: false, error: "the bot is not sending to this group" });
        }
        if (!chatId || (!hasText && !filePath)) return json(400, { success: false, error: "chat_id and text or file_path required" });
        if (!PEER_ID_RE.test(String(chatId))) return json(400, { success: false, error: "invalid chat_id" });
        if (hasText && Buffer.byteLength(text) > BRIDGE_TEXT_MAX_BYTES) return json(413, { success: false, error: "text too large" });
        if (replyTo && editOf) return json(400, { success: false, error: "reply_to and edit_of are mutually exclusive" });
        if ((replyTo && String(replyTo).length > BRIDGE_MESSAGE_ID_MAX) || (editOf && String(editOf).length > BRIDGE_MESSAGE_ID_MAX)) {
          return json(400, { success: false, error: "message id too long" });
        }
        if (filePath) {
          if (typeof filePath !== "string") return json(400, { success: false, error: "file_path must be a string" });
          if (replyTo || editOf) return json(400, { success: false, error: "file replies and edits are not supported" });
          let file;
          try { file = fileStore.get(chatId, filePath); }
          catch (error) { return fileBridgeFailure(json, error); }
          if (!file) return json(404, { success: false, error: "file not found" });
          try {
            const sent = await sendAttachment(chatId, {
              filePath: file.filePath,
              mime: file.mime,
              size: file.size,
              text: hasText ? text : file.path,
            });
            return json(200, { success: true, message_id: sent.messageId });
          } catch (error) {
            log("BOT_BRIDGE_FILE_SEND_FAILED", { to: chatId, path: file.path, error: String(error?.message ?? error) });
            return json(502, { success: false, error: "file delivery failed" });
          }
        }
        // Harness-driven edits go through the live outbox: throttled,
        // latest-wins, so a streaming harness (Hermes edits every 0.8s) can't
        // exceed the protocol-safe cadence. Fire-and-forget by design. An
        // edit replaces ONE message, so it is never chunked.
        if (editOf) {
          // The answer went out as an edit, which cannot BE the placeholder —
          // retire the placeholder to a terminal glyph so it never dangles.
          const lpe = await takeLivePlaceholder(chatId);
          if (lpe) lpe.handle.finalize("✓").catch((e) => log("BOT_LIVE_FINALIZE_FAILED", { to: chatId, error: String(e?.message ?? e) }));
          disarmThinking(chatId);
          liveReplies.throttledEdit(norm(chatId), String(editOf), text);
          return json(200, { success: true, message_id: String(editOf), coalesced: true });
        }
        // Long harness answers are chunked like direct-engine ones; the
        // outbound lane keeps the parts ordered on the wire. A trailing
        // ```buttons block rides the last part (spec 0006, see deliverToChat);
        // a quoted answer is a reply, not a buttons message, so it gets the
        // fallback text.
        const { text: replyText, buttons } = prepareReply(chatId, text, { allowButtons: !replyTo });
        const parts = splitMessageText(replyText, replyChunkBytes);
        if (parts.length > 1) log("BOT_REPLY_CHUNKED", { to: chatId, parts: parts.length, chars: replyText.length });
        let firstId = null;
        const lp = await takeLivePlaceholder(chatId);
        if (lp) {
          // The placeholder retires to a short status receipt and the answer
          // goes out as new messages — see deliverToChat. A harness reports no
          // token usage, so the line carries elapsed time and step count only.
          // A quoted answer can never BE the placeholder anyway.
          const status = renderTurnStats({ elapsed: lp.tracker.elapsed(), steps: lp.tracker.step });
          if (replyTo) {
            lp.handle.finalize(status).catch((e) => log("BOT_LIVE_FINALIZE_FAILED", { to: chatId, error: String(e?.message ?? e) }));
          } else {
            try {
              const onlyPartHasButtons = buttons && parts.length === 1;
              const { edited, messageId } = await lp.handle.finalize(status, onlyPartHasButtons ? {} : { ifUnfetched: parts[0] });
              if (!edited && !onlyPartHasButtons) firstId = messageId; // the unfetched slot holds parts[0]
              log("BOT_LIVE_STATUS", { to: chatId, messageId: lp.handle.messageId, status, edited });
            } catch (e) { log("BOT_LIVE_FINALIZE_FAILED", { to: chatId, error: String(e?.message ?? e) }); }
          }
        }
        for (const [i, part] of parts.entries()) {
          if (i === 0 && firstId) continue;
          const id = await sendMessage(chatId, {
            text: part,
            replyTo: i === 0 && replyTo ? String(replyTo) : null,
            ...(buttons && i === parts.length - 1 ? { buttons } : {}),
          });
          if (i === 0) firstId = id;
        }
        return json(200, { success: true, message_id: firstId, ...(parts.length > 1 ? { parts: parts.length } : {}) });
      }
      if (req.method === "POST" && url.pathname === "/react") {
        const { chat_id: chatId, message_id: targetId, emoji, remove } = await readJson(req);
        if (!chatId || !targetId || !emoji) return json(400, { success: false, error: "chat_id, message_id and emoji required" });
        if (!PEER_ID_RE.test(String(chatId))) return json(400, { success: false, error: "invalid chat_id" });
        if (String(targetId).length > BRIDGE_MESSAGE_ID_MAX) return json(400, { success: false, error: "message id too long" });
        // The wire accepts any string; cap it so a confused harness can't push
        // paragraphs through the reaction field.
        if (String(emoji).length > 16) return json(400, { success: false, error: "emoji too long" });
        await sendReaction(chatId, String(targetId), String(emoji), Boolean(remove));
        return json(200, { success: true });
      }
      if (req.method === "POST" && url.pathname === "/typing") return json(200, { ok: true });
      return json(404, { error: "not found" });
    } catch (error) {
      log("BOT_BRIDGE_REQUEST_FAILED", { method: req.method, path: url?.pathname ?? "(invalid)", error: String(error?.message ?? error) });
      return json(500, { success: false, error: "bridge request failed" });
    }
  });
  server.on("error", (e) => {
    if (e?.code === "EADDRINUSE") {
      log("BOT_BRIDGE_PORT_IN_USE", { host: bridgeHost, port: bridgePort });
      console.error(`Bridge port ${bridgePort} is already in use — another bot is likely running. Set BOT_BRIDGE_PORT to a free port.`);
    } else {
      log("BOT_BRIDGE_ERROR", { error: String(e?.message ?? e) });
    }
    void gracefulShutdown(1);
  });
  // Report the BOUND port, not the requested one: BOT_BRIDGE_PORT=0 lets the
  // OS assign a free port, and this event is how the operator learns it.
  server.listen(bridgePort, bridgeHost, () => log("BOT_BRIDGE_LISTENING", { host: bridgeHost, port: server.address().port }));
  return server;
};

let bridgeServer = null;
let shuttingDown = false;
const gracefulShutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  identifierWait.stop(); // no held opener is replayed into a closing process
  try { bridgeServer?.close(); } catch { /* already closed */ }
  try {
    await Promise.race([
      agentRuntime?.shutdown() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (e) { log("BOT_SHUTDOWN_AGENT_FAILED", { error: String(e?.message ?? e) }); }
  // Meter: charge every pending debit before the process ends (the session
  // state also keeps it, for a crash). Bounded: a chain that does not include
  // it cannot hold the exit.
  if (meter) {
    await Promise.race([
      meter.flushAll("shutdown"),
      new Promise((resolve) => setTimeout(resolve, 60_000)),
    ]);
  }
  try { await stateStore?.flush(); }
  catch (e) { log("BOT_SHUTDOWN_STATE_FAILED", { error: String(e?.message ?? e) }); }
  process.exit(code);
};

// ---------- main ----------
log("BOT_STARTING", { endpoint, account: `0x${accountIdHex}`, username, brain, allowlist: allowedPeers.size });

// Single-instance guard: exactly one process may serve a bot identity, or replies
// double-send. An O_EXCL pidfile in the state dir enforces it (stale pidfiles from
// a crashed process are taken over). Only when BOT_STATE_DIR is set.
let pidfilePath = null;
if (env.BOT_STATE_DIR) {
  pidfilePath = path.join(env.BOT_STATE_DIR, "bot.pid");
  const refuse = (holder) => {
    console.error(`Another bot process (${holder}) already serves this identity (${pidfilePath}). Two would double-reply — stop it first (or delete the pidfile if you're sure nothing is running).`);
    process.exit(1);
  };
  try {
    fs.mkdirSync(env.BOT_STATE_DIR, { recursive: true });
    let fd;
    try { fd = fs.openSync(pidfilePath, "wx"); }
    catch (e) {
      if (e?.code !== "EEXIST") throw e;
      const content = fs.readFileSync(pidfilePath, "utf8").trim();
      // Only a positive integer counts as a holder. Empty/garbage content (a
      // crash between create and write) must read as stale: Number("") is 0,
      // and kill(0, 0) signals our own process group — it always succeeds, so
      // without this guard an empty pidfile bricks startup forever.
      const old = Number.parseInt(content, 10);
      let alive = false;
      if (Number.isInteger(old) && old > 0 && old !== process.pid) {
        try { process.kill(old, 0); alive = true; } catch { alive = false; }
      }
      if (alive) refuse(`pid ${old}`);
      // Stale — take it over via remove + exclusive re-create so concurrent
      // starters race for one wx winner instead of both opening with "w".
      // Re-read first: if the content changed since the staleness check,
      // another starter just claimed it. (A microsecond interleaving window
      // remains — nothing in node's fs gives an atomic stale-lock swap — but
      // it now takes two starts within the same few instructions to collide.)
      if (fs.readFileSync(pidfilePath, "utf8").trim() !== content) refuse("just started");
      fs.rmSync(pidfilePath, { force: true });
      try { fd = fs.openSync(pidfilePath, "wx"); }
      catch (e2) { if (e2?.code === "EEXIST") refuse("just started"); else throw e2; }
    }
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch (e) { log("BOT_PIDFILE_WARN", { error: String(e?.message ?? e) }); pidfilePath = null; }
}
// Remove the pidfile only if it still holds OUR pid — a dying process that lost
// the identity to a newer one must not disarm the winner's guard by deleting a
// pidfile it no longer owns.
const cleanupPidfile = () => {
  if (!pidfilePath) return;
  try {
    if (fs.readFileSync(pidfilePath, "utf8").trim() === String(process.pid)) fs.rmSync(pidfilePath, { force: true });
  } catch { /* ignore */ }
};
process.on("exit", cleanupPidfile);

bridgeServer = startBridge();
log("BOT_LISTENING", { account: `0x${accountIdHex}`, identifierKey: `0x${norm(bytesToHex(identifierKey))}` });

// Restore saved sessions so open conversations continue across a restart —
// rebuild each peer's (deterministic) session and resume watching its channel,
// and reload the dedup set so we don't re-answer already-handled messages.
// State is a security boundary: never let a syntactically-valid but incompatible
// file crash startup or allocate unbounded collections.
const normalizeRestoredState = (raw) => {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw) || (raw.v !== 2 && raw.v !== 3)) {
    log("BOT_STATE_INCOMPATIBLE", { version: raw?.v ?? null });
    return null;
  }
  const array = (value, cap) => Array.isArray(value) ? value.slice(-cap) : [];
  // v2 contains only P-256 identity/device keys. Keep key-independent dedup
  // and agent state, but discard every session-bearing record and let peers
  // establish fresh RFC004 sessions against the newly persisted device key.
  const keysValid = raw.v === 3 && storedDevicePrivateKey != null;
  return {
    ...raw,
    v: 3,
    devicePrivateKeyHex: norm(bytesToHex(deviceKeypair.privateKey)),
    peers: keysValid ? array(raw.peers, MAX_SESSIONS) : [],
    seen: array(raw.seen, SEEN_CAP),
    pendingOpenerAcks: keysValid ? array(raw.pendingOpenerAcks, MAX_OWED) : [],
    owed: keysValid ? array(raw.owed, MAX_OWED) : [],
    greeted: keysValid ? array(raw.greeted, MAX_SESSIONS) : [],
    intro: array(raw.intro, MAX_SESSIONS),
    groups: array(raw.groups, 200),
    groups2: array(raw.groups2, 200),
  };
};
const restored = normalizeRestoredState(rawStoredState);
// The runtime decides which persisted resume tokens are still valid (they're
// scoped to the engine + the cwd they were captured in; see agent-runtime).
agentRuntime?.noteRestoredAgent(restored?.agent ?? null);
// Groups first: an allowlisted bot admits a group member's session by them.
groups.restore(restored?.groups);
groupsV2.restore(restored?.groups2);
let restoredPeers = 0;
// Peers refused by the current allowlist: a session and its owed entries
// are one refused peer, not one refusal per record.
const restoredUnauthorized = new Set();
for (const p of restored?.peers ?? []) {
  // Per-peer guard: one malformed persisted entry must not crash startup and
  // trip a Docker restart loop — skip it and keep the rest of the sessions.
  try {
    if (!p || typeof p !== "object" || typeof p.peerHex !== "string" || typeof p.identifierKeyHex !== "string") continue;
    if (!isAllowed(p.peerHex) && !groupAdmitted(p.peerHex)) {
      restoredUnauthorized.add(norm(p.peerHex));
      log("BOT_STATE_PEER_UNAUTHORIZED", { peer: norm(p.peerHex) });
      continue;
    }
    const peerIdentifierKey = hexToBytes(p.identifierKeyHex);
    if (peerIdentifierKey.length !== 32) throw new Error("stored peer identifier key must be 32 bytes");
    const devices = (p.devices ?? []).map((d) => {
      const statementAccountId = hexToBytes(d.s);
      const encryptionPublicKey = hexToBytes(d.e);
      if (statementAccountId.length !== 32 || encryptionPublicKey.length !== 32) {
        throw new Error("stored peer device keys must be 32 bytes");
      }
      return { statementAccountId, encryptionPublicKey };
    });
    buildSession(p.peerHex, p.identifierKeyHex, devices);
    const entry = touchSession(p.peerHex);
    if (entry && Number.isSafeInteger(p.la) && p.la > 0) entry.lastActiveAt = p.la;
    addSessionWatch(p.peerHex);
    agentRuntime?.restorePeer(norm(p.peerHex), { rs: p.rs, mo: p.mo, pj: p.pj, br: p.br });
    deletions.restore(norm(p.peerHex), p.dl);
    sentButtons.restore(norm(p.peerHex), p.bp);
    peerBotInfo.restore(norm(p.peerHex), p.bi);
    botInfoSent.restore(norm(p.peerHex), p.bs);
    meter?.restore(norm(p.peerHex), p.md);
    flip?.remember(p.peerHex);
    restoredPeers += 1;
  } catch (e) { log("BOT_STATE_PEER_SKIPPED", { peer: p?.peerHex, error: String(e?.message ?? e) }); }
}
for (const id of restored?.seen ?? []) if (typeof id === "string") seenRequests.add(id);
for (const id of restored?.pendingOpenerAcks ?? []) if (typeof id === "string") pendingOpenerAcks.add(id);
for (const id of restored?.greeted ?? []) if (typeof id === "string") greetedPeers.add(id);
agentRuntime?.restoreIntroduced((restored?.intro ?? []).filter((peerHex) => typeof peerHex === "string" && isAllowed(peerHex)));
// Re-run anything that was ACKed but not yet answered when the last process
// died — the app will never resend these, the journal is their only way back.
// An entry whose answer is journaled is re-sent as-is, not re-run.
let restoredOwed = 0;
for (const o of restored?.owed ?? []) {
  try {
    if (!o?.id || !o?.p || typeof o?.t !== "string") continue;
    if (!isAllowed(o.p) && !(o.g && groupAdmitted(o.p))) {
      restoredUnauthorized.add(norm(o.p));
      log("BOT_STATE_OWED_UNAUTHORIZED", { peer: norm(o.p) });
      continue;
    }
    const msg = {
      text: typeof o.c === "string" ? o.c : o.t,
      messageId: o.id,
      kind: o.k ?? "text",
      ...(o.q ? { replyTo: o.q } : {}),
      ...(o.e ? { editOf: o.e } : {}),
      ...(o.op ? { opener: true } : {}),
      ...(typeof o.g?.i === "string" ? { group: { id: o.g.i, sender: String(o.g.s ?? "") } } : {}),
      ...(Array.isArray(o.a) && o.a.length ? {
        attachments: o.a.map((x) => ({
          id: x.i, ticketHex: x.ct, wssUrl: x.u, mime: x.m, size: x.s, fileKind: x.kd,
          ...(x.w != null ? { width: x.w, height: x.h } : {}),
          ...(x.d != null ? { duration: x.d } : {}),
        })),
      } : {}),
    };
    const answer = (Array.isArray(o.ans) ? o.ans : []).map((a) => {
      if (typeof a?.id !== "string" || typeof a?.o !== "string") throw new Error("journaled answer needs an id and bytes");
      return { messageId: a.id, opaque: hexToBytes(a.o), supersedes: Array.isArray(a.s) ? a.s.filter((x) => typeof x === "string") : [] };
    });
    if (oweReply(o.id, o.p, msg, o.r, answer)) restoredOwed += 1;
  } catch (e) { log("BOT_STATE_OWED_SKIPPED", { error: String(e?.message ?? e) }); }
}
pumpOwed();
// The device private key is random rather than seed-derived. Make its first
// snapshot durable before polling; losing it would orphan every device session
// learned during this process on the next restart.
if (!(await persistCritical())) {
  log("BOT_DEVICE_KEY_PERSIST_FAILED");
  await gracefulShutdown(1);
}
if (restored) log("BOT_STATE_RESTORED", {
  peers: restoredPeers,
  seen: restored.seen?.length ?? 0,
  owed: restoredOwed,
  ...(restoredUnauthorized.size ? { unauthorized: restoredUnauthorized.size } : {}),
});
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { void gracefulShutdown(0); });

// ---------- subscription ingress (push) ----------
// Statements arrive by subscription; the poll loop drops to a slow
// reconciliation sweep while the subscription is healthy. Liveness is proven
// end-to-end: the supervisor submits a heartbeat statement on a private
// health channel (channel replacement = one slot, ever) and expects to see it
// come back through its own subscription; a miss triggers resubscription and
// the sweep falls back to full poll cadence. BOT_SUBSCRIBE=0 disables.
if ((env.BOT_SUBSCRIBE ?? "1") !== "0") {
  const { createStatementIngressSupervisor, createRawStatementPageSubscriber } =
    await import("./vendor/lib/statement-ingress-supervisor.mjs");
  const healthTopic = blake2b(enc.encode(`pca-heartbeat:${accountIdHex}`), { dkLen: 32 });
  const healthChannel = blake2b(enc.encode(`pca-heartbeat-channel:${accountIdHex}`), { dkLen: 32 });
  const healthTopicHex = topicHex(healthTopic);
  const subscribePages = createRawStatementPageSubscriber({ getClient: () => lazyClient.getClient() });
  const groupKeys = new Map(); // groupId -> sorted topic key currently subscribed
  const supervisor = createStatementIngressSupervisor({
    subscribePages,
    handleStatements: (statements) => queueStatements(statements, buildWatch()),
    // The statement data field must arrive SCALE-framed (compact length +
    // bytes) — the node rejects a bare payload as undecodable.
    submitHeartbeat: ({ id }) => submitBounded({
      walletPair: wallet, channel: healthChannel, topics: [healthTopic],
      scaleEncodedPayload: scaleEncodeBytes(enc.encode(id)), expiryFactory,
    }),
    healthFilter: { matchAll: [healthTopic] },
    isHealthStatement: (st) => (st.topics ?? []).some((t) => topicHex(t) === healthTopicHex),
    isCurrentHeartbeatStatement: (st, hb) => {
      const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
      return bytesToHex(data).includes(bytesToHex(enc.encode(hb.id)));
    },
    // A socket reconnect leaves every old subscription silently dead (no
    // error, no pages). Recovery must replace the health subscription too, or
    // every later heartbeat is missed while the groups keep receiving.
    // recover must not throw: the supervisor would stay "in recovery" forever.
    recover: () => {
      try { supervisor.reconnect(); }
      catch (e) { log("BOT_SUBSCRIBE_HEALTH_FAILED", { error: String(e?.message ?? e) }); }
      resubscribe(true);
    },
    emit: ({ event, ...extra }) => log(event, extra),
    heartbeatIntervalMs: numberEnv("BOT_HEARTBEAT_MS", 120_000, { min: 1000, max: 86_400_000 }),
  });
  // Keep subscription groups aligned with the current watch set (day rollover,
  // new peers/devices): chunked matchAny groups, replaced only when their
  // topic membership actually changes.
  const resubscribe = (force = false) => {
    const desired = new Map(); // groupId -> topics
    const openerTopics = requestDayTopics();
    for (let i = 0; i < openerTopics.length; i += TOPIC_BATCH) {
      desired.set(`openers-${i / TOPIC_BATCH}`, openerTopics.slice(i, i + TOPIC_BATCH));
    }
    const watchNow = [...buildWatch().values()];
    const sessionTopics = watchNow.filter((w) => w.kind === "session").map((w) => w.topic);
    for (let i = 0; i < sessionTopics.length; i += TOPIC_BATCH) {
      desired.set(`sessions-${i / TOPIC_BATCH}`, sessionTopics.slice(i, i + TOPIC_BATCH));
    }
    const groupTopics = watchNow.filter((w) => w.kind === "group").map((w) => w.topic);
    for (let i = 0; i < groupTopics.length; i += TOPIC_BATCH) {
      desired.set(`groups2-${i / TOPIC_BATCH}`, groupTopics.slice(i, i + TOPIC_BATCH));
    }
    for (const id of [...groupKeys.keys()]) {
      if (!desired.has(id)) { supervisor.unsubscribeGroup(id); groupKeys.delete(id); }
    }
    for (const [id, topics] of desired) {
      const key = topics.map(topicHex).sort().join(",");
      if (!force && groupKeys.get(id) === key) continue;
      groupKeys.set(id, key);
      try { supervisor.subscribeGroup({ id, filter: { matchAny: topics }, label: id, topicCount: topics.length }); }
      catch (e) { log("BOT_SUBSCRIBE_GROUP_FAILED", { group: id, error: String(e?.message ?? e) }); }
    }
  };
  supervisor.start();
  resubscribe(true);
  ingress = { supervisor, resubscribe };
  flip?.start();
  log("BOT_SUBSCRIBED", { heartbeatMs: numberEnv("BOT_HEARTBEAT_MS", 120_000, { min: 1000, max: 86_400_000 }) });
}

// Greet mode: open the chat with each allowlisted owner we've never talked to.
// Runs after state restore (so greetedPeers/sessions are known) and after the
// ingress is up (so the new session topics get subscribed).
if (greet) {
  if (allowedPeers.size === 0) {
    log("BOT_GREET_SKIPPED", { note: "no allowlist — an open bot has no owner to greet" });
  } else {
    for (const peerHex of allowedPeers) {
      if (greetedPeers.has(peerHex) || sessions.has(peerHex)) continue; // once ever, never into an existing thread
      try {
        const identifierKeyHex = await resolveIdentifierKey(peerHex);
        if (!identifierKeyHex) { log("BOT_GREET_NO_IDENTIFIER", { to: peerHex }); continue; }
        const peerAccount = hexToBytes(peerHex);
        const session = buildSession(peerHex, identifierKeyHex);
        addSessionWatch(peerHex);
        ingress?.resubscribe();
        const { payload } = encodeNativeChatRequestV2({
          walletPair: wallet,
          botAccountId: peerAccount,           // the codec's "bot" is simply the recipient
          botIdentifierKey: hexToBytes(identifierKeyHex),
          ownX25519PrivateKey: identityPrivateKey,
          ownDeviceX25519PublicKey: deviceKeypair.publicKey,
          text: greetText,
        });
        const today = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
        const topics = [chatRequestAllPeerStatementsTopic(peerAccount)];
        if (today != null) topics.push(chatRequestPaginationTopic(peerAccount, today));
        await submitBounded({
          walletPair: wallet,
          channel: session.identitySession.outgoingRequestChannel,
          topics,
          scaleEncodedPayload: payload,
          expiryFactory,
        });
        greetedPeers.add(peerHex);
        persist();
        log("BOT_GREETED", { to: peerHex });
      } catch (e) { log("BOT_GREET_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
    }
  }
}

// While the subscription proves live, the poll loop is only a reconciliation
// sweep (it re-examines deferred statements and anything a page missed); when
// the subscription is down or disabled, it is the sole ingress at full cadence.
const sweepMs = numberEnv("BOT_SWEEP_MS", 30_000, { min: 1000, max: 86_400_000 });
const ingressHealthy = () => {
  if (!ingress) return false;
  const s = ingress.supervisor.snapshot();
  return s.sinceOkMs < s.staleMs;
};

for (;;) {
  try { await pollOnce(); } catch (error) { log("BOT_POLL_ERROR", { error: error instanceof Error ? error.message : String(error) }); }
  // 0011 timers: old keys erased after 14 days; an admin bot rotates at 7.
  try { await groupsV2.tick(); } catch (error) { log("BOT_GROUP2_TICK_FAILED", { error: String(error?.message ?? error) }); }
  ingress?.resubscribe(); // day rollover / watch-set changes
  // Back off on a sustained outage so we don't hammer a recovering node with the
  // full topic fan-out every tick; normal cadence resumes on the first success.
  const base = ingressHealthy() ? sweepMs : pollMs;
  const wait = pollFailStreak > 0 ? Math.min(30_000, pollMs * 2 ** Math.min(pollFailStreak, 5)) : base;
  await delay(wait);
}
