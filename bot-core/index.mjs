#!/usr/bin/env node
// polkadot-bot-core — a standalone transport bridge between the Polkadot app's
// Statement Store chat and a local HTTP API, for AI agent harnesses (Hermes).
//
// It receives chat requests + session follow-ups addressed to the bot identity,
// ACKs them, and exposes:
//   GET  /health                     -> { ok, account, identifierKey, username }
//   GET  /inbound?wait=<secs>        -> long-poll; [{chat_id, text, message_id,
//                                       kind?, reply_to?, edit_of?, attachments?}, ...]
//                                       (&events=1 adds reactions/coinage/leftChat)
//   GET  /media/<id>                 -> bytes of a downloaded attachment
//   POST /send  {chat_id, text, reply_to?, edit_of?} -> publish a reply / quote / edit
//   POST /react {chat_id, message_id, emoji, remove?} -> emoji reaction
//   POST /typing {chat_id}           -> no-op (best effort)
//
// Reuses ONLY the generic transport codec (vendor/) + a papi client for the
// on-chain identifier-key lookup. No faucet-specific code (coinage/stripe/etc.).
//
// Env: BOT_SEED_HEX (root mini-secret; or FAUCET_CHAT_SERVICE_SECRET),
//   BOT_ENDPOINT (default Paseo), BOT_BRIDGE_PORT (8799), BOT_BRIDGE_HOST (127.0.0.1),
//   BOT_ACK_TEXT, BOT_ALLOWED_PEERS (comma-sep peer account hexes; empty = allow all),
//   BOT_REQUEST_LOOKBACK_DAYS (7), BOT_REQUEST_FUTURE_DAYS (2), BOT_POLL_MS (2000),
//   BOT_THINKING_TEXT + BOT_THINKING_AFTER_MS (5000) — ack sent if no reply by then,
//   BOT_GREET (0; 1 = message allowlisted owners on first start) + BOT_GREET_TEXT,
//   BOT_SUBSCRIBE (1; 0 = poll-only), BOT_SWEEP_MS (30000, sweep cadence while the
//   subscription is healthy), BOT_HEARTBEAT_MS (30000), BOT_PEER_IDENTIFIER_KEYS
//   ("peerhex=keyhex,..." — pin identifier keys, skipping the on-chain lookup).
//   Attachments: BOT_MEDIA_MAX_BYTES (32MB), BOT_MEDIA_TTL_HOURS (48),
//   BOT_MEDIA_MAX_TOTAL_MB (512), BOT_HOP_TIMEOUT_MS (120000),
//   BOT_HOP_ALLOWED_NODES (comma-sep host suffixes; empty = allow any wss host),
//   BOT_HOP_ALLOW_INSECURE (tests only: permit ws:// and IP hosts).
//   Live replies: BOT_LIVE_EDIT_MIN_MS (3000) / BOT_LIVE_EDIT_MAX_MS (15000)
//   edit throttle, BOT_LIVE_HEARTBEAT_MS (15000) elapsed-clock frames,
//   BOT_LIVE_ACK_TIMEOUT_MS (60000), BOT_LIVE_PROGRESS (1; 0 = placeholder and
//   final only), BOT_LIVE_TTL_MS (600000) + BOT_LIVE_TIMEOUT_TEXT — placeholder
//   resolves to a timeout note if no answer finalized it in time.
//   Direct engines (BOT_BRAIN=claude|codex|opencode): BOT_AI_MODEL (opencode
//   takes a provider/model slug), BOT_AI_ALLOWED_TOOLS (Bash,Read,Edit,Write),
//   BOT_AI_SKIP_PERMISSIONS (1 = full autonomy), BOT_AI_API_BILLING (1 = keep
//   ANTHROPIC_API_KEY for claude), BOT_AI_IDLE_TIMEOUT_MS (600000, kills a
//   silent/wedged turn), BOT_AI_MAX_MS (0 = no hard cap), BOT_AI_WORKSPACE
//   (BOT_STATE_DIR/workspace), BOT_AI_CMD/BOT_AI_ARGS (custom stream-json CLI).

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { blake2b } from "@noble/hashes/blake2.js";
import { createStateStore } from "./lib/session-store.mjs";
import { createCommandHandler } from "./lib/commands.mjs";
import { downloadP2PFile } from "./lib/hop-client.mjs";
import { createMediaStore } from "./lib/media-store.mjs";
import { createLiveReplies, createProgressTracker } from "./lib/live-reply.mjs";
import { RUNNERS, resolveEngine, ENGINES } from "./lib/runners.mjs";
import { createClient as createPapiClient } from "polkadot-api";
import { getWsProvider, WsEvent } from "polkadot-api/ws";
import { paseoPeopleNext } from "./lib/descriptors.mjs";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { withTimeout, runWithConcurrency } from "./vendor/lib/async-utils.mjs";
import {
  makePeerSession,
  deriveP256PrivateKey,
  p256PublicKeyFromPrivateKey,
  chatRequestAllPeerStatementsTopic,
  chatRequestPaginationTopic,
  chatRequestDayFromUnixSeconds,
  decodeEncryptedChatRequestPayload,
  verifyChatRequestIdentityProof,
  decodeSessionStatementPayload,
  encodeNativeChatRequestV2,
  encodeOpaqueTextMessage,
  encodeOpaqueReactionMessage,
  encodeOpaqueReplyMessage,
  encodeOpaqueEditedMessage,
  encodeOpaqueDataChannelClosedMessage,
  encodeOpaqueChatAcceptedMessage,
  encodeOpaqueMultiChatAcceptedMessage,
  encodeSessionRequestPayload,
  encodeSessionResponsePayload,
  submitAppStatement,
  scaleEncodeBytes,
  makeAppUuid,
} from "./vendor/app-chat-codec.mjs";

// ---------- config / helpers ----------
const env = process.env;
const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
const endpoint = env.BOT_ENDPOINT ?? DEFAULT_ENDPOINT;
const seedHex = (env.BOT_SEED_HEX ?? env.FAUCET_CHAT_SERVICE_SECRET ?? "").trim();
const bridgePort = Number(env.BOT_BRIDGE_PORT ?? 8799);
// The bridge is unauthenticated (it can read decrypted inbound and publish as
// the bot), so default to loopback. Container deploys that need cross-container
// access set BOT_BRIDGE_HOST=0.0.0.0 explicitly (scoped to the compose network).
const bridgeHost = env.BOT_BRIDGE_HOST ?? "127.0.0.1";
const brain = (env.BOT_BRAIN ?? "bridge").trim().toLowerCase(); // bridge | hermes | echo | claude | codex | opencode
const ackText = env.BOT_ACK_TEXT ?? (brain === "bridge" || brain === "hermes" ? "Connecting you to the agent…" : "");
// If a reply hasn't gone out within BOT_THINKING_AFTER_MS of receiving a message,
// send a "thinking" ack so a slow answer (AI call, Hermes round-trip) doesn't feel
// like the message was lost. Fast replies cancel it. Empty text disables it.
const thinkingText = env.BOT_THINKING_TEXT ?? "🤔 One moment — thinking…";
const thinkingAfterMs = Number(env.BOT_THINKING_AFTER_MS ?? 5000);
// Live replies: the thinking placeholder becomes ONE evolving message (edited
// through progress into the final answer) instead of a throwaway bubble.
// Edit cadence/budget guardrails live in lib/live-reply.mjs; see
// docs/LIVE-REPLIES.md for the protocol constraints behind them.
const liveMinEditMs = Number(env.BOT_LIVE_EDIT_MIN_MS ?? 3000);
const liveMaxEditMs = Number(env.BOT_LIVE_EDIT_MAX_MS ?? 15_000);
const liveHeartbeatMs = Number(env.BOT_LIVE_HEARTBEAT_MS ?? 15_000);
const liveAckTimeoutMs = Number(env.BOT_LIVE_ACK_TIMEOUT_MS ?? 60_000);
const liveProgress = env.BOT_LIVE_PROGRESS !== "0";
// A placeholder must never tick forever: if no answer finalized it within the
// TTL (harness died, message dropped), it resolves to a visible timeout note.
const liveTtlMs = Number(env.BOT_LIVE_TTL_MS ?? 600_000);
const liveTimeoutText = env.BOT_LIVE_TIMEOUT_TEXT
  ?? "⚠️ I lost track of this one — something went wrong on my end. Please send it again.";
// Greet mode: on startup the bot opens the chat with each allowlisted owner it
// has never talked to (once ever, persisted) — a liveness signal, so the owner
// doesn't have to find and message the bot first. Only allowlisted peers are
// ever greeted; an open bot has no owner to greet.
const greet = env.BOT_GREET === "1" || env.BOT_GREET === "true";
const greetText = env.BOT_GREET_TEXT ?? `👋 ${env.BOT_USERNAME || env.FAUCET_CHAT_SERVICE_USERNAME || "Your bot"} here — I'm alive! Say hi, or /help for what I can do.`;

// Direct engine "brains": bot-core runs a headless coding-agent CLI (claude /
// codex / opencode) as an autonomous agent — verbatim prompt, native session
// resume, tools on. The engine table (lib/runners.mjs) turns a
// (prompt, model, resume) into argv and normalizes each CLI's JSONL stream; the
// generic spawn/stream/idle-backstop loop lives here (runEngine). See
// docs/DESIGN.md. BOT_AI_MODEL pins a model (for opencode this is a
// provider/model slug — the many-providers path); per-peer /model overrides it.
const aiModel = (env.BOT_AI_MODEL ?? "").trim();
// Tools are on by default (the container is the sandbox). The allowlist is the
// safe default; BOT_AI_SKIP_PERMISSIONS=1 grants full autonomy (all tools).
const allowedTools = (env.BOT_AI_ALLOWED_TOOLS ?? "Bash,Read,Edit,Write").split(",").map((s) => s.trim()).filter(Boolean);
const skipPermissions = env.BOT_AI_SKIP_PERMISSIONS === "1";
const apiBilling = env.BOT_AI_API_BILLING === "1"; // keep ANTHROPIC_API_KEY for claude
// No wall-clock timeout: a long agent turn (a big build/test) is legitimate.
// Instead an idle-silence backstop kills a process that has emitted nothing for
// this long — a wedge — and unblocks the peer's queue. /stop is the user lever.
const aiIdleMs = Number(env.BOT_AI_IDLE_TIMEOUT_MS ?? 600_000);
const aiMaxMs = Number(env.BOT_AI_MAX_MS ?? 0); // 0 = no hard cap
// Where the agent works: one workspace shared by all peers, persisted so files
// (and each peer's resume session) survive restarts.
const aiWorkspace = env.BOT_AI_WORKSPACE ?? (env.BOT_STATE_DIR ? path.join(env.BOT_STATE_DIR, "workspace") : fs.mkdtempSync(path.join(os.tmpdir(), "bot-ws-")));

// Escape hatch: BOT_AI_CMD=<bin> [+ BOT_AI_ARGS=<JSON array> with "__PROMPT__"]
// runs a custom CLI that speaks claude-shaped stream-json (also how the offline
// e2e drives the loop with a mock `sh` script). Otherwise the engine is the
// named brain (claude/codex/opencode); null for echo/bridge/hermes.
const customCmd = (env.BOT_AI_CMD ?? "").trim();
let customArgsTmpl = null;
if (customCmd && env.BOT_AI_ARGS) {
  try { customArgsTmpl = JSON.parse(env.BOT_AI_ARGS); } catch { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
  if (!Array.isArray(customArgsTmpl)) { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
}
const engine = customCmd ? RUNNERS.custom : resolveEngine(brain); // null unless a direct engine
const engineCommand = customCmd || engine?.command;
if (engine) fs.mkdirSync(aiWorkspace, { recursive: true, mode: 0o700 });
const buildEngineArgs = ({ prompt, model, resume }) => {
  if (customCmd) return customArgsTmpl ? customArgsTmpl.map((a) => (a === "__PROMPT__" ? prompt : a)) : [prompt];
  return engine.buildArgs({ prompt, model, resume, allowedTools, skipPermissions });
};
const lookbackDays = Number(env.BOT_REQUEST_LOOKBACK_DAYS ?? 7);
const futureDays = Number(env.BOT_REQUEST_FUTURE_DAYS ?? 2);
const pollMs = Number(env.BOT_POLL_MS ?? 2000);
// Deadline for every chain call (queries AND submits): papi requests never
// reject on a dead socket — they're buffered and re-sent on reconnect — so an
// unbounded await anywhere in the poll path wedges the bot forever.
const queryTimeoutMs = Number(env.BOT_QUERY_TIMEOUT_MS ?? 15_000);
// Session persistence: without it, a restart wipes every open conversation
// (the peer's session channels/keys live only in memory). Enabled when
// BOT_STATE_DIR is set — Docker/`pca` provide it; raw `node index.mjs` runs go
// stateless. The file holds key material, so session-store writes it mode 0600.
const stateStore = env.BOT_STATE_DIR ? createStateStore(path.join(env.BOT_STATE_DIR, "session-state.json")) : null;
const SEEN_CAP = 5000; // bound the persisted dedup set
const allowedPeers = new Set(
  String(env.BOT_ALLOWED_PEERS ?? "").split(",").map((s) => s.trim().replace(/^0x/i, "").toLowerCase()).filter(Boolean),
);
if (!seedHex) { console.error("BOT_SEED_HEX (or FAUCET_CHAT_SERVICE_SECRET) is required"); process.exit(2); }

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
const mediaMaxBytes = Number(env.BOT_MEDIA_MAX_BYTES ?? 32 * 1024 * 1024);
const hopTimeoutMs = Number(env.BOT_HOP_TIMEOUT_MS ?? 120_000);
const hopAllowInsecure = env.BOT_HOP_ALLOW_INSECURE === "1"; // tests only: mock node is plain ws
const hopAllowedNodes = String(env.BOT_HOP_ALLOWED_NODES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const mediaStore = createMediaStore({
  dir: env.BOT_STATE_DIR ? path.join(env.BOT_STATE_DIR, "media") : fs.mkdtempSync(path.join(os.tmpdir(), "bot-media-")),
  ttlHours: Number(env.BOT_MEDIA_TTL_HOURS ?? 48),
  maxTotalMb: Number(env.BOT_MEDIA_MAX_TOTAL_MB ?? 512),
  log,
});
mediaStore.sweep();
setInterval(() => mediaStore.sweep(), 3_600_000).unref();

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

// Fetch each attachment into the media store, annotating the metadata in
// place ({downloaded, path} or {downloaded:false, error}). Failures are notes
// for the brain, never fatal — the message is already ACKed. Runs inside the
// per-peer work queue, after the ACK, so a slow node can't cause resend storms.
const fetchAttachments = async (attachments) => {
  for (const a of attachments ?? []) {
    const existing = mediaStore.find(a.id);
    if (existing) { a.downloaded = true; a.path = existing.path; continue; }
    try {
      if (a.size > mediaMaxBytes) throw new Error(`larger than BOT_MEDIA_MAX_BYTES (${a.size} bytes)`);
      const bytes = await downloadP2PFile({
        wssUrl: a.wssUrl,
        identifier: hexToBytes(a.id),
        claimTicket: hexToBytes(a.ticketHex),
        maxBytes: mediaMaxBytes,
        deadlineMs: hopTimeoutMs,
        allowInsecure: hopAllowInsecure,
        allowedNodes: hopAllowedNodes.length ? hopAllowedNodes : null,
        log,
      });
      a.downloaded = true;
      a.path = mediaStore.save(a.id, bytes, a.mime);
      log("BOT_MEDIA_DOWNLOADED", { id: a.id.slice(0, 16), mime: a.mime, bytes: bytes.length });
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
const chatPair = deriveSr25519PairFromSeed(seed, "//wallet//chat");
const p256PrivateKey = deriveP256PrivateKey(chatPair);
const identifierKey = p256PublicKeyFromPrivateKey(p256PrivateKey);
const accountId = wallet.publicKey;
const accountIdHex = norm(bytesToHex(accountId));
const username = env.FAUCET_CHAT_SERVICE_USERNAME ?? env.BOT_USERNAME ?? "";

// ---------- chain clients ----------
// Keep handles on BOTH providers so /health can read real socket state: the
// statement-store socket carries polling/submits, the papi socket carries
// identifier-key lookups (a bot with only the papi socket down is deaf to new
// peers). Note a disconnected socket does NOT fail requests — they're buffered
// and re-sent on reconnect — so socket state and per-call timeouts are the two
// outage signals; query success alone can't distinguish "empty" from "down".
const wsProvider = getWsProvider(endpoint);
const lazyClient = createLazyClient(wsProvider);
const statementStore = createPapiStatementStoreAdapter(lazyClient);
const papiProvider = getWsProvider(endpoint);
const socketConnected = (p) => p.getStatus?.().type === WsEvent.CONNECTED;
const chainConnected = () => socketConnected(wsProvider) && socketConnected(papiProvider);
const requestRpc = lazyClient.getRequestFn();
const papiClient = createPapiClient(papiProvider);
const peopleApi = papiClient.getTypedApi(paseoPeopleNext);
// Every chain submit shares the query deadline: submitAppStatement retries
// rejections, but a hung socket never rejects — it would await forever.
const submitBounded = (args) => withTimeout(submitAppStatement(requestRpc, args), queryTimeoutMs, "statement submit");

// Insertion-order eviction for the per-peer maps below: on a public bot peers
// accumulate for the life of the process, so unbounded maps are a slow leak.
const trimMap = (map, cap) => { while (map.size > cap) map.delete(map.keys().next().value); };

const IDENTIFIER_CACHE_CAP = 5000;
const identifierKeyCache = new Map(); // peerHex -> identifierKeyHex
// Static peer->identifier-key pins: "peerhex=keyhex,..." — skips the on-chain
// lookup for those peers. Used by the offline transport tests (no people chain)
// and usable for fixed-fleet setups.
for (const pair of String(env.BOT_PEER_IDENTIFIER_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const [peer, key] = pair.split("=");
  if (peer && key) identifierKeyCache.set(norm(peer), norm(key));
}
const resolveIdentifierKey = async (peerHex) => {
  const key = norm(peerHex);
  if (identifierKeyCache.has(key)) return identifierKeyCache.get(key);
  let value = null;
  try {
    const consumer = await withTimeout(
      peopleApi.query.Resources.Consumers.getValue(ss58Address(hexToBytes(key), 2)),
      queryTimeoutMs, "identifier lookup");
    value = consumer?.identifier_key == null ? null : norm(String(consumer.identifier_key));
  } catch (error) {
    log("BOT_IDENTIFIER_LOOKUP_FAILED", { peer: key, error: error instanceof Error ? error.message : String(error) });
  }
  if (value) { identifierKeyCache.set(key, value); trimMap(identifierKeyCache, IDENTIFIER_CACHE_CAP); }
  return value;
};

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
const sessions = new Map(); // peerHex -> { session, identifierKeyHex }
const buildSession = (peerHex, identifierKeyHex, extraDevices = []) => {
  const existing = sessions.get(norm(peerHex))?.session?.peerDevices ?? [];
  const peerDevices = [...existing];
  // A device is the (statement account, encryption key) PAIR: the app reuses the
  // identity account as statement account, so keying on the account alone would
  // drop any additional/rotated device key for the same account.
  const deviceKey = (d) => `${bytesToHex(d.statementAccountId)}:${bytesToHex(d.encryptionPublicKey)}`;
  for (const d of extraDevices) {
    if (!peerDevices.some((e) => deviceKey(e) === deviceKey(d))) peerDevices.push(d);
  }
  const session = makePeerSession({
    ownAccountId: accountId,
    peerAccountId: hexToBytes(peerHex),
    peerIdentifierKey: hexToBytes(identifierKeyHex),
    ownP256PrivateKey: p256PrivateKey,
    ownDeviceP256PrivateKey: p256PrivateKey,
    peerDevices,
  });
  sessions.set(norm(peerHex), { session, identifierKeyHex: norm(identifierKeyHex) });
  return session;
};

// ---------- bridge inbound queue ----------
const INBOUND_CAP = 1000;
// True when handleInbound hands messages to the HTTP bridge queue (no direct
// brain): backpressure must then watch inboundQueue, not the per-peer queues.
const usesBridgeQueue = brain !== "echo" && !engine;
const inboundQueue = [];
const waiters = [];
const enqueueInbound = (item) => {
  inboundQueue.push(item);
  // Backstop only — session statements are deferred un-ACKed upstream when the
  // queue is at cap (see handleSessionStatement), so this should not trigger.
  // If an opener burst still overflows it, dropping oldest loses messages that
  // were already ACKed (the app won't resend them) — log the count loudly.
  if (inboundQueue.length > INBOUND_CAP) {
    const dropped = inboundQueue.length - INBOUND_CAP;
    // Not settled: trimmed items stay in the owed journal, so a restart
    // re-runs them instead of losing them outright.
    inboundQueue.splice(0, dropped);
    log("BOT_INBOUND_QUEUE_TRIMMED", { cap: INBOUND_CAP, dropped });
  }
  const w = waiters.shift();
  if (w) { clearTimeout(w.timer); w.resolve(drainInbound(w.events)); }
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
  const i = waiters.findIndex((w) => w.events);
  if (i >= 0) { const [w] = waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(drainInbound(true)); }
};
// Hand the queued items to the harness: custody transfers here, so settle each
// item's owed-journal entry and strip the internal owedId from the payload.
const drainInbound = (includeEvents = false) => {
  const items = inboundQueue.splice(0).map(({ owedId, ...item }) => {
    if (owedId) settleOwed(owedId);
    return item;
  });
  return includeEvents ? [...items, ...eventQueue.splice(0)] : items;
};

const isAllowed = (peerHex) => allowedPeers.size === 0 || allowedPeers.has(norm(peerHex));

// ---------- "thinking" ack for slow replies ----------
// Armed when a message arrives; fires only if nothing has been sent to that peer
// within thinkingAfterMs. Any outgoing text (sendText) disarms it, so fast
// replies — echo, a quick model, Hermes on a good day — produce no extra noise.
const thinkingTimers = new Map(); // peerHex -> timeout
const disarmThinking = (peerHex) => {
  const t = thinkingTimers.get(norm(peerHex));
  if (t) { clearTimeout(t); thinkingTimers.delete(norm(peerHex)); }
};
const armThinking = (peerHex) => {
  const k = norm(peerHex);
  if (!thinkingText || !(thinkingAfterMs > 0) || thinkingTimers.has(k)) return;
  thinkingTimers.set(k, setTimeout(() => {
    thinkingTimers.delete(k);
    if (livePlaceholders.has(k)) return; // a previous turn's placeholder is still open
    // The placeholder is a LIVE message: it will be edited through progress
    // frames and finally become the answer itself (docs/LIVE-REPLIES.md).
    livePlaceholders.set(k, (async () => {
      const handle = await liveReplies.begin(k, thinkingText);
      const tracker = createProgressTracker({ label: "working" });
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
  }, thinkingAfterMs));
};

// ---------- outbound ACK tracking ----------
// The peer's app sends a session-response ACK for every request statement it
// consumes (mirror of our sendSessionAck). We track our own outgoing
// requestIds so live replies can gate edits on "the placeholder was fetched"
// — an edit submitted earlier would replace the un-fetched placeholder in the
// channel slot and orphan every subsequent edit (docs/LIVE-REPLIES.md).
const pendingAcks = new Map(); // requestId -> { resolve, timer }
const PENDING_ACK_CAP = 500;
const awaitOutboundAck = (requestId, timeoutMs = liveAckTimeoutMs) => new Promise((resolve) => {
  const timer = setTimeout(() => { pendingAcks.delete(requestId); resolve(false); }, timeoutMs);
  timer.unref?.();
  pendingAcks.set(requestId, { resolve, timer });
  while (pendingAcks.size > PENDING_ACK_CAP) {
    const [oldId, old] = pendingAcks.entries().next().value;
    pendingAcks.delete(oldId);
    clearTimeout(old.timer);
    old.resolve(false);
  }
});
const resolveOutboundAck = (requestId) => {
  const p = pendingAcks.get(requestId);
  if (!p) return;
  pendingAcks.delete(requestId);
  clearTimeout(p.timer);
  p.resolve(true);
};

// ---------- send a reply to a peer ----------
// Returns the outgoing envelope messageId (an app UUID) so callers — notably
// POST /send — hand the brain an id it can later edit or that the peer can
// react to. replyTo quotes a peer message; editOf rewrites one of our own.
const submitMessage = async (peerHex, { text, replyTo = null, editOf = null }) => {
  const entry = sessions.get(norm(peerHex));
  if (entry == null) throw new Error("no active session for peer");
  const messageId = makeAppUuid();
  const requestId = makeAppUuid();
  const opaque = replyTo
    ? encodeOpaqueReplyMessage({ messageId, replyToMessageId: replyTo, text })
    : editOf
      ? encodeOpaqueEditedMessage({ messageId, targetMessageId: editOf, text })
      : encodeOpaqueTextMessage({ messageId, text });
  const payload = encodeSessionRequestPayload(entry.session, requestId, [opaque]);
  await submitBounded({
    walletPair: wallet,
    channel: entry.session.requestChannel,
    topics: [entry.session.ownSessionId],
    scaleEncodedPayload: payload,
    expiryFactory,
  });
  log("BOT_SENT_TEXT", { to: peerHex, chars: text.length, ...(replyTo ? { replyTo } : {}), ...(editOf ? { editOf } : {}) });
  return { messageId, requestId };
};
const sendMessage = async (peerHex, opts) => {
  disarmThinking(peerHex); // a real reply is going out — no placeholder needed
  return (await submitMessage(peerHex, opts)).messageId;
};
const sendText = (peerHex, text) => sendMessage(peerHex, { text });

// ---------- live replies (one evolving message per slow turn) ----------
const liveReplies = createLiveReplies({
  send: ({ peerHex, text, editOf }) => submitMessage(peerHex, { text, editOf }),
  awaitAck: (requestId) => awaitOutboundAck(requestId),
  minIntervalMs: liveMinEditMs,
  maxIntervalMs: liveMaxEditMs,
  finalAckWaitMs: Number(env.BOT_LIVE_FINAL_ACK_WAIT_MS ?? 10_000),
  log,
});
// peerHex -> Promise<{handle, tracker, timer} | null> for the current turn's
// placeholder. Consumed (take) exactly once, by whoever delivers the answer.
const livePlaceholders = new Map();
const takeLivePlaceholder = async (peerHex) => {
  const k = norm(peerHex);
  const p = livePlaceholders.get(k);
  if (!p) return null;
  livePlaceholders.delete(k);
  const lp = await p.catch(() => null);
  if (lp) { clearInterval(lp.timer); clearTimeout(lp.ttl); }
  return lp;
};
const peekLivePlaceholder = (peerHex) => livePlaceholders.get(norm(peerHex)) ?? null;

// Reactions ride the same session channel but are not "replies": they never
// disarm the thinking ack and carry no text of their own.
const sendReaction = async (peerHex, targetMessageId, emoji, removed = false) => {
  const entry = sessions.get(norm(peerHex));
  if (entry == null) throw new Error("no active session for peer");
  const payload = encodeSessionRequestPayload(entry.session, makeAppUuid(), [
    encodeOpaqueReactionMessage({ targetMessageId, emoji, removed }),
  ]);
  await submitBounded({
    walletPair: wallet,
    channel: entry.session.requestChannel,
    topics: [entry.session.ownSessionId],
    scaleEncodedPayload: payload,
    expiryFactory,
  });
  log("BOT_SENT_REACTION", { to: peerHex, removed, target: targetMessageId });
};

// ---------- direct engine: run the agent CLI as one turn ----------
const AI_PEER_CAP = 500; // bound the per-peer maps (idle peers age out)
const peerResume = new Map();          // peerHex -> engine session id (native --resume)
const peerModelOverrides = new Map();  // peerHex -> model chosen via /model
const runningChildren = new Map();     // peerHex -> live child process (for /stop + idle kill)
const stopRequested = new Set();       // peers whose turn /stop is cancelling

// Kill a child's whole process group (SIGTERM, then SIGKILL after a grace
// period) so agent-spawned subprocesses (bash, builds) are reaped too.
const killProcessGroup = (child) => {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } } }, 2000).unref?.();
};
// /stop lever: cancel a peer's in-flight turn. Returns true if one was running.
const stopRun = (peerHex) => {
  const k = norm(peerHex);
  const child = runningChildren.get(k);
  if (!child) return false;
  stopRequested.add(k);
  killProcessGroup(child);
  return true;
};

// Run one agent turn. Streams the engine's JSONL: tool actions feed live-reply
// progress frames, the session id is captured for --resume, the answer is
// accumulated. No wall-clock limit — an idle-silence backstop kills a wedged
// process (and unblocks the peer queue). Returns { answer }, { stopped:true }
// (user /stop), or null on failure.
const runEngine = (peerHex, userText, onAction = null) => new Promise((resolve) => {
  const k = norm(peerHex);
  const model = peerModelOverrides.get(k) ?? aiModel;
  const resume = peerResume.get(k) ?? null;
  const argv = buildEngineArgs({ prompt: userText, model, resume });
  const childEnv = { ...process.env };
  if (engine.stripApiKeyEnv && !apiBilling) delete childEnv.ANTHROPIC_API_KEY;
  // Detached: a new process group, so killProcessGroup reaps the CLI's children.
  // stdin ignored: some CLIs (codex) otherwise block on "Reading additional input".
  const child = spawn(engineCommand, argv, { stdio: ["ignore", "pipe", "pipe"], cwd: aiWorkspace, env: childEnv, detached: true });
  runningChildren.set(k, child);
  let err = "", lineBuf = "", answer = "", resultText = null, errored = null, gotSession = false, settled = false;
  let idle;
  const bumpIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { log("BOT_AI_IDLE_TIMEOUT", { to: peerHex, idleMs: aiIdleMs }); killProcessGroup(child); }, aiIdleMs);
    idle.unref?.();
  };
  const hardCap = aiMaxMs > 0 ? setTimeout(() => { log("BOT_AI_MAX_TIMEOUT", { to: peerHex, maxMs: aiMaxMs }); killProcessGroup(child); }, aiMaxMs) : null;
  hardCap?.unref?.();
  const finish = (value) => {
    if (settled) return; settled = true;
    clearTimeout(idle); if (hardCap) clearTimeout(hardCap);
    if (runningChildren.get(k) === child) runningChildren.delete(k);
    resolve(value);
  };
  bumpIdle();
  const onLine = (line) => {
    if (!line.trim()) return;
    let obj; try { obj = JSON.parse(line); } catch { return; }
    for (const ev of engine.parseEvent(obj)) {
      if (ev.kind === "started") {
        if (ev.sessionId && !gotSession) { gotSession = true; peerResume.set(k, ev.sessionId); trimMap(peerResume, AI_PEER_CAP); persist(); }
      } else if (ev.kind === "action") onAction?.(ev.title);
      else if (ev.kind === "text") answer += ev.text;
      else if (ev.kind === "result") resultText = ev.text || null;
      else if (ev.kind === "error") errored = ev.message;
    }
  };
  child.stdout.on("data", (d) => { bumpIdle(); lineBuf += d; let nl; while ((nl = lineBuf.indexOf("\n")) >= 0) { onLine(lineBuf.slice(0, nl)); lineBuf = lineBuf.slice(nl + 1); } });
  child.stderr.on("data", (d) => { err += d; bumpIdle(); });
  child.on("error", (e) => { log("BOT_AI_SPAWN_FAILED", { error: String(e?.message ?? e) }); finish(null); });
  child.on("close", (code) => {
    if (lineBuf) onLine(lineBuf);
    if (stopRequested.delete(k)) return finish({ stopped: true });
    const finalAnswer = (resultText ?? answer).trim();
    if (errored) { log("BOT_AI_FAILED", { to: peerHex, error: String(errored).slice(-300) }); return finish(null); }
    if (code === 0 || finalAnswer) return finish({ answer: finalAnswer });
    // Classify the failure so the operator knows the remedy (re-auth vs. retry).
    const authRevoked = /401|unauthorized|refresh token|could not be refreshed|log ?out and sign in/i.test(err);
    log(authRevoked ? "BOT_AI_AUTH_REVOKED" : "BOT_AI_FAILED", { to: peerHex, code, stderr: err.trim().slice(-500) });
    finish(null);
  });
});

// In-chat commands for the direct engines. State operations run where the state
// lives (here — bot-core owns the resume token + model choice), but NEVER in
// bridge mode: the harness owns that conversation and its own command system.
const handleCommandFor = createCommandHandler({
  clearResume: (peerKey) => { if (peerResume.delete(peerKey)) persist(); },
  peerModelOverrides,
  defaultModel: aiModel,
  username,
  chainConnected,
  trimOverrides: () => trimMap(peerModelOverrides, AI_PEER_CAP),
});
const handleCommand = (peerHex, text) => handleCommandFor(norm(peerHex), text);

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
  if (msg.editOf) parts.push("[edited their earlier message]");
  else if (msg.replyTo) parts.push("[replying to your earlier message]");
  if (msg.text) parts.push(msg.text);
  for (const a of msg.attachments ?? []) {
    parts.push(a.downloaded
      ? `[User sent a ${attachmentNoun(a)} saved at ${a.path} (${a.mime}, ${humanSize(a.size)})]`
      : `[User sent a ${attachmentNoun(a)} (${a.mime}, ${humanSize(a.size)}) — download failed: ${a.error ?? "unknown error"}]`);
  }
  return parts.join(" ") || synthesizeText("", msg.attachments);
};

// msg: { text, messageId, kind, attachments?, replyTo?, editOf? }
const handleInbound = async (peerHex, msg, owedId = null) => {
  await fetchAttachments(msg.attachments);
  if (brain === "echo") {
    await sendText(peerHex, `Echo: ${synthesizeText(msg.text, msg.attachments)}`).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
    return;
  }
  if (engine) {
    const commandReply = handleCommand(peerHex, msg.text);
    if (commandReply) {
      log("BOT_COMMAND", { from: peerHex, command: msg.text.split(/\s/)[0] });
      await sendText(peerHex, commandReply).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
      return;
    }
    // Deliver by finalizing the live placeholder when one was posted (the
    // "thinking…" bubble BECOMES the answer); plain send otherwise.
    const deliverReply = async (text) => {
      const lp = await takeLivePlaceholder(peerHex);
      if (lp) {
        try { await lp.handle.finalize(text); return; }
        catch (e) { log("BOT_LIVE_FINALIZE_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
      }
      await sendText(peerHex, text);
    };
    // Verbatim prompt — the engine keeps its own session; we only add the
    // attachment/reply/edit CONTEXT the message carries (real content, not a
    // persona wrapper).
    const userText = renderForBrain(msg);
    armThinking(peerHex); // live placeholder if the turn takes longer than thinkingAfterMs
    // Tool events become "▸ action" lines on the placeholder.
    const onAction = liveProgress ? (title) => {
      const p = peekLivePlaceholder(peerHex);
      p?.then((lp) => {
        if (!lp || lp.handle.finalized) return;
        lp.tracker.add(title);
        lp.handle.update(lp.tracker.render());
      }).catch(() => {});
    } : null;
    const result = await runEngine(peerHex, userText, onAction);  // logs its own classified failure reason
    if (result?.stopped) return; // /stop already finalized the placeholder
    if (!result) {
      // Don't leave the user hanging after the "thinking" placeholder.
      await deliverReply("Sorry — I couldn't reach my agent just now. Please try again in a moment.").catch(() => {});
      return;
    }
    // Discovery: the very first reply to a peer carries a one-time /help hint
    // (persisted, so a restart doesn't repeat it).
    let outgoing = result.answer || "(no output)";
    if (!introducedPeers.has(norm(peerHex))) {
      introducedPeers.add(norm(peerHex));
      persist();
      outgoing += "\n\n(Tip: send /help to see my commands.)";
    }
    await deliverReply(outgoing).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
    return;
  }
  // bridge / hermes / unknown: hand off to an external agent via the HTTP bridge.
  // The agent replies via POST /send -> sendMessage, which disarms the ack.
  armThinking(peerHex);
  enqueueInbound({
    chat_id: peerHex,
    text: synthesizeText(msg.text, msg.attachments),
    message_id: msg.messageId,
    owedId,
    ...(msg.kind && msg.kind !== "text" ? { kind: msg.kind } : {}),
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.editOf ? { edit_of: msg.editOf } : {}),
    ...(msg.attachments?.length ? { attachments: msg.attachments.map(publicAttachment) } : {}),
  });
};

// Queue one owed message for the brain, settling the journal entry when the
// pipeline takes custody (bridge items settle later, on /inbound drain).
const enqueueOwed = (peerHex, owedId, msg, requestId) => {
  enqueueWork(peerHex, async () => {
    try { await handleInbound(peerHex, msg, owedId); }
    finally { if (!usesBridgeQueue) settleOwed(owedId); }
  });
};

// ---------- receive: dedup + handlers ----------
// Both sets are bounded (insertion-ordered, evict oldest) so a long-lived bot
// doesn't grow them without limit. seenStatements holds statement fingerprints;
// seenRequests holds message ids (never plaintext — see handleSessionStatement).
const seenStatements = new Set();
const seenRequests = new Set();
const STMT_CAP = 20_000;
const trimSet = (set, cap) => { while (set.size > cap) set.delete(set.values().next().value); };
const noteSeenStatement = (key) => { seenStatements.add(key); trimSet(seenStatements, STMT_CAP); };
// Stable dedup id for a session message: prefer the app's message id; fall back
// to a hash of requestId:text so we never hold or persist conversation plaintext.
const messageDedupId = (requestId, text, messageId) =>
  messageId || `h:${bytesToHex(blake2b(enc.encode(`${requestId}:${text}`), { dkLen: 16 }))}`;

// ---------- owed replies (crash-durable at-least-once) ----------
// A message is deduped and ACKed as soon as it's queued (ACK = delivered), so
// the pending reply exists only in memory — a crash before the brain ran would
// silently never answer it. Journal owed replies in the state snapshot and
// flush BEFORE the ACK goes out; a restart re-runs the brain for anything
// still owed. Settled when the reply pipeline takes custody: direct brains
// when handleInbound returns (reply or apology sent), bridge brains when the
// harness drains the item from /inbound. Bounded by the same backpressure
// caps as the queues it mirrors. Holds message text until answered — transient
// by design, in a file that is 0600 and already holds key material.
const owedReplies = new Map(); // owedId -> { peerHex, requestId, msg }
const oweReply = (owedId, peerHex, msg, requestId) => owedReplies.set(owedId, { peerHex, requestId, msg });
const settleOwed = (owedId) => { if (owedReplies.delete(owedId)) persist(); };

// Persist only what can't be re-derived: per-peer identifierKey + peerDevices.
// makePeerSession is deterministic, so the channels/keys rebuild exactly from
// these + the seed. Also persist the dedup set so a restart doesn't re-answer
// old messages. (seenStatements stays in-memory — it only avoids redundant
// decode work; seenRequests is the semantic "already replied" guard.)
const snapshotState = () => ({
  v: 1,
  // Which engine + workspace these resume tokens belong to. A token resumes a
  // session tied to a specific cwd and CLI, so a change to either invalidates
  // them on restart (takopi's rule — resuming against the wrong tree corrupts).
  agent: engine ? { engine: customCmd ? "custom" : brain, workspace: aiWorkspace } : undefined,
  peers: [...sessions.entries()].map(([peerHex, { session, identifierKeyHex }]) => ({
    peerHex,
    identifierKeyHex,
    devices: (session.peerDevices ?? []).map((d) => ({
      s: norm(bytesToHex(d.statementAccountId)),
      e: norm(bytesToHex(d.encryptionPublicKey)),
    })),
    ...(peerResume.has(norm(peerHex)) ? { rs: peerResume.get(norm(peerHex)) } : {}),
  })),
  seen: [...seenRequests].slice(-SEEN_CAP),
  // Additive optional fields (k/q/e/a) keep the snapshot readable by older
  // binaries, which fall back to answering from t (caption or synthesized
  // text). The attachment claim ticket ("ct") is key material — acceptable
  // here because this file is 0600 and already holds session keys, and owed
  // entries are transient (settled when the reply pipeline takes custody).
  owed: [...owedReplies.entries()].map(([id, o]) => ({
    id,
    p: o.peerHex,
    t: synthesizeText(o.msg.text, o.msg.attachments),
    r: o.requestId,
    ...(o.msg.kind && o.msg.kind !== "text" ? { k: o.msg.kind } : {}),
    ...(o.msg.replyTo ? { q: o.msg.replyTo } : {}),
    ...(o.msg.editOf ? { e: o.msg.editOf } : {}),
    ...(o.msg.attachments?.length ? {
      c: o.msg.text, // raw caption; t above is synthesized for older binaries
      a: o.msg.attachments.map((x) => ({
        i: x.id, ct: x.ticketHex, u: x.wssUrl, m: x.mime, s: x.size, kd: x.fileKind,
        ...(x.width != null ? { w: x.width, h: x.height } : {}),
        ...(x.duration != null ? { d: x.duration } : {}),
      })),
    } : {}),
  })),
  greeted: [...greetedPeers],
  intro: [...introducedPeers],
});
const greetedPeers = new Set(); // peers we've sent a first-contact greeting (once ever)
const introducedPeers = new Set(); // peers whose first reply carried the /help hint
const persist = () => { if (stateStore) stateStore.save(snapshotState()); };
const fp = (data) => bytesToHex(data.subarray(0, 32)); // dedup key: first 32 bytes, no full-payload encode

const handleOpener = async (data) => {
  let decoded;
  // Unlike session batches, an opener has no per-message isolation: a welcome
  // message we can't decode drops the whole request (and the app resends it
  // forever, since no session ever ACKs) — make that visible.
  try { decoded = decodeEncryptedChatRequestPayload(data, p256PrivateKey, accountId); }
  catch (e) { log("BOT_OPENER_DECODE_FAILED", { error: String(e?.message ?? e) }); return; }
  const senderHex = norm(decoded.peerAccountIdHex);
  if (seenRequests.has(decoded.messageId)) return;
  if (!isAllowed(senderHex)) { log("BOT_REJECTED_UNLISTED", { from: senderHex }); return; }
  const identifierKeyHex = await resolveIdentifierKey(senderHex);
  if (!identifierKeyHex) { log("BOT_OPENER_NO_IDENTIFIER", { from: senderHex }); return; }
  if (!verifyChatRequestIdentityProof(decoded, p256PrivateKey, hexToBytes(identifierKeyHex))) {
    log("BOT_OPENER_BAD_PROOF", { from: senderHex }); return;
  }
  seenRequests.add(decoded.messageId);
  const devices = decoded.deviceEncPubKeyHex
    ? [{ statementAccountId: hexToBytes(decoded.peerStatementAccountIdHex ?? senderHex), encryptionPublicKey: hexToBytes(decoded.deviceEncPubKeyHex) }]
    : [];
  const session = buildSession(senderHex, identifierKeyHex, devices);
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
    ...(openerAttachments.length ? { attachments: openerAttachments } : {}),
  };
  oweReply(decoded.messageId, senderHex, openerMsg, decoded.messageId);
  persist(); // remember this peer's session (and the owed reply) across restarts
  stateStore?.flush(); // owed must be on disk before the ACK suppresses resends
  // ACK / accept so the peer establishes the session (advertise our device).
  const accept = decoded.deviceEncPubKeyHex
    ? encodeOpaqueMultiChatAcceptedMessage({ acceptedRequestId: decoded.messageId, statementAccountId: accountId, encryptionPublicKey: identifierKey })
    : encodeOpaqueChatAcceptedMessage({ acceptedRequestId: decoded.messageId });
  try {
    const ackPayload = encodeSessionRequestPayload(session, makeAppUuid(), [accept, encodeOpaqueTextMessage({ text: ackText })], { forceIdentity: true });
    await submitBounded({ walletPair: wallet, channel: session.requestChannel, topics: [session.ownSessionId], scaleEncodedPayload: ackPayload, expiryFactory });
  } catch (error) { log("BOT_ACK_FAILED", { to: senderHex, error: error instanceof Error ? error.message : String(error) }); }
  log("BOT_RECEIVED_OPENER", { from: senderHex, requestId: decoded.messageId, text: decoded.text, ...(openerAttachments.length ? { attachments: openerAttachments.length } : {}) });
  enqueueOwed(senderHex, decoded.messageId, openerMsg, decoded.messageId);
};

// ACK a session request (mirrors the app: response goes on our own session
// topic under the response channel). Without it the app treats every message
// as undelivered and resends its whole backlog forever.
const sendSessionAck = async (peerHex, requestId) => {
  const entry = sessions.get(norm(peerHex));
  if (entry == null) return;
  const payload = encodeSessionResponsePayload(entry.session, requestId);
  await submitBounded({
    walletPair: wallet,
    channel: entry.session.responseChannel,
    topics: [entry.session.ownSessionId],
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
const WORK_CAP = 20;
const peerWork = new Map(); // peerHex -> { tail, depth }
const workDepth = (peerHex) => peerWork.get(norm(peerHex))?.depth ?? 0;
const enqueueWork = (peerHex, fn) => {
  const k = norm(peerHex);
  const entry = peerWork.get(k) ?? { tail: Promise.resolve(), depth: 0 };
  entry.depth += 1;
  entry.tail = entry.tail.then(fn)
    .catch((e) => log("BOT_HANDLER_FAILED", { peer: k, error: String(e?.message ?? e) }))
    .finally(() => { entry.depth -= 1; if (entry.depth === 0 && peerWork.get(k) === entry) peerWork.delete(k); });
  peerWork.set(k, entry);
};

const handleSessionStatement = async (data, peerHex, session, senderAccountId = hexToBytes(peerHex)) => {
  // Backpressure: once a message is marked seen and its request ACKed, it lives
  // only in memory until answered — the app will never resend it. So when this
  // peer's pipeline is full, leave the statement un-ACKed and un-seen instead;
  // the app keeps resending until we have room. Nothing is ACKed then dropped.
  if (workDepth(peerHex) >= WORK_CAP || (usesBridgeQueue && inboundQueue.length >= INBOUND_CAP)) return "deferred";
  let decoded;
  // A follow-up we can't decrypt used to vanish silently here — log it so a
  // broken/stale session is diagnosable instead of looking like "no message".
  try { decoded = decodeSessionStatementPayload(data, session, senderAccountId); }
  catch (e) { log("BOT_SESSION_DECODE_FAILED", { from: peerHex, error: String(e?.message ?? e) }); return; }
  if (decoded?.kind === "response") {
    // The peer ACKed one of OUR request statements — unlocks live-reply edits.
    resolveOutboundAck(decoded.requestId);
    return;
  }
  if (decoded?.kind !== "request") return;
  const fresh = [];   // messages that run the brain (journaled + owed)
  const declines = []; // call offers to auto-decline after the ACK
  for (const m of decoded.messages ?? []) {
    // Initiator side of an outgoing greeting: the peer's accept can advertise
    // their device encryption key — fold it into the session (and subscribe to
    // its topics) or the peer's device-channel replies would go unseen.
    if (m.kind === "multiChatAccepted" && m.encryptionPublicKey) {
      const entry = sessions.get(norm(peerHex));
      if (entry) {
        buildSession(peerHex, entry.identifierKeyHex, [{ statementAccountId: m.statementAccountId, encryptionPublicKey: m.encryptionPublicKey }]);
        ingress?.resubscribe();
        persist();
        log("BOT_PEER_DEVICE_ADDED", { from: peerHex, device: norm(bytesToHex(m.encryptionPublicKey)).slice(0, 16) });
      }
      continue;
    }
    if (m.kind === "undecodable") {
      // Used to vanish silently; a message kind we can't parse should at least
      // be diagnosable.
      log("BOT_UNDECODABLE_MESSAGE", { from: peerHex, error: m.error });
      continue;
    }
    // /stop: cancel the peer's in-flight turn. Handled synchronously HERE —
    // before the per-peer work queue — because a queued /stop would sit behind
    // the very turn it means to cancel. Direct engines only (bridge harnesses
    // own their own stop). Deduped like any message so resends don't re-fire.
    if (engine && m.kind === "text" && /^\s*\/stop\s*$/i.test(m.text ?? "")) {
      if (!m.messageId) continue;
      const id = messageDedupId(decoded.requestId, "stop", m.messageId);
      if (seenRequests.has(id)) continue;
      seenRequests.add(id); trimSet(seenRequests, SEEN_CAP);
      const stopped = stopRun(peerHex);
      log("BOT_STOP", { from: peerHex, stopped });
      (async () => {
        // The stopped turn returns early without touching its placeholder, so
        // finalize it here; otherwise there may be none to take.
        const lp = await takeLivePlaceholder(peerHex);
        if (lp) await lp.handle.finalize("⏹ Stopped.").catch((e) => log("BOT_LIVE_FINALIZE_FAILED", { to: peerHex, error: String(e?.message ?? e) }));
        else await sendText(peerHex, stopped ? "⏹ Stopped." : "Nothing to stop right now.").catch(() => {});
      })();
      continue;
    }
    // Brain-run kinds. Text must be non-empty unless attachments carry the
    // content (a caption-less photo).
    const attachments = (m.richText?.attachments ?? []).filter((a) => a.kind === "p2pMixnetFile").map(toAttachmentMeta);
    const isBrainKind = (m.kind === "text" || m.kind === "richText" || m.kind === "reply" || m.kind === "edited")
      && typeof m.text === "string" && (m.text.length > 0 || attachments.length > 0);
    if (isBrainKind) {
      const id = messageDedupId(decoded.requestId, `${m.kind}:${m.text}`, m.messageId);
      // Also honor the legacy plaintext key so entries persisted before this
      // change still count as seen — but never add new plaintext keys.
      const legacyKey = `${decoded.requestId}:${m.text}`;
      const alreadySeen = seenRequests.has(id) || seenRequests.has(legacyKey);
      seenRequests.add(id);
      trimSet(seenRequests, SEEN_CAP);
      if (alreadySeen) continue;
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
    const id = messageDedupId(decoded.requestId, m.kind, m.messageId);
    if (seenRequests.has(id)) continue;
    seenRequests.add(id);
    trimSet(seenRequests, SEEN_CAP);
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
    } else if (m.kind === "unsupported") {
      log("BOT_UNSUPPORTED_CONTENT", { from: peerHex, contentKind: m.contentKind });
    }
    // chatAccepted / dataChannelClosed: nothing to do.
  }
  if (fresh.length) {
    // Journal before the ACK goes out: seen + owed land in one snapshot, so a
    // crash after the ACK can't leave a message deduped but never answered.
    for (const f of fresh) oweReply(f.id, peerHex, f.msg, decoded.requestId);
    persist();
    stateStore?.flush();
  }
  // ACK means "delivered", not "answered" — send it before any brain work so
  // the app stops resending even when the model is slow.
  try { await sendSessionAck(peerHex, decoded.requestId); }
  catch (e) { log("BOT_SESSION_ACK_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
  for (const f of fresh) {
    log("BOT_RECEIVED_TEXT", { from: peerHex, text: f.msg.text, ...(f.msg.kind !== "text" ? { kind: f.msg.kind } : {}), ...(f.msg.attachments ? { attachments: f.msg.attachments.length } : {}) });
    enqueueOwed(peerHex, f.id, f.msg, decoded.requestId);
  }
  for (const offerId of declines) {
    enqueueWork(peerHex, async () => {
      try {
        const entry = sessions.get(norm(peerHex));
        if (entry == null) return;
        const payload = encodeSessionRequestPayload(entry.session, makeAppUuid(), [encodeOpaqueDataChannelClosedMessage({ offerId })]);
        await submitBounded({ walletPair: wallet, channel: entry.session.requestChannel, topics: [entry.session.ownSessionId], scaleEncodedPayload: payload, expiryFactory });
        log("BOT_CALL_DECLINED", { to: peerHex, offerId });
      } catch (e) { log("BOT_CALL_DECLINE_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
    });
  }
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
const TOPIC_BATCH = Number(env.BOT_TOPIC_BATCH ?? 16);
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
  const watch = new Map(); // bare-hex topic -> {kind:"opener"} | {kind:"session", peerHex, session, sender}
  for (const topic of requestDayTopics()) watch.set(topicHex(topic), { kind: "opener", topic });
  for (const peerHex of watchedSessionPeers) {
    const entry = sessions.get(peerHex);
    if (entry == null) continue;
    watch.set(topicHex(entry.session.peerSessionId), {
      kind: "session", topic: entry.session.peerSessionId, peerHex, session: entry.session, sender: hexToBytes(peerHex),
    });
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
const dispatchStatement = async (st, watch) => {
  const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
  const key = fp(data);
  if (seenStatements.has(key)) return;
  const target = (st.topics ?? []).map((t) => watch.get(topicHex(t))).find(Boolean);
  if (!target) return;
  noteSeenStatement(key);
  if (target.kind === "opener") {
    await handleOpener(data);
  } else if ((await handleSessionStatement(data, target.peerHex, target.session, target.sender)) === "deferred") {
    // A deferred statement (pipeline full) must be re-examined on a later
    // sweep — the app's resend covers the subscription path too.
    seenStatements.delete(key);
    tickDeferred += 1;
  }
};

// All dispatch — sweep results and subscription pages — runs through one
// serial chain so per-session handling order can never interleave.
let dispatchTail = Promise.resolve();
const dispatchSerial = (fn) => {
  dispatchTail = dispatchTail.then(fn).catch((e) => log("BOT_DISPATCH_FAILED", { error: String(e?.message ?? e) }));
  return dispatchTail;
};

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
  await dispatchSerial(async () => {
    for (const sts of results) {
      for (const st of sts ?? []) await dispatchStatement(st, watch);
    }
  });
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
const readJson = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
  req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
  req.on("error", reject);
});
const startBridge = () => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
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
          // Capability advertisement for harness adapters (OpenClaw-style
          // supportsEdit gating): edits exist and are throttled server-side.
          live: { supportsEdit: true, minEditMs: liveMinEditMs, placeholderAfterMs: thinkingText ? thinkingAfterMs : null },
        });
      }
      if (req.method === "GET" && url.pathname === "/inbound") {
        const waitSecs = Math.min(60, Math.max(0, Number(url.searchParams.get("wait") ?? 25)));
        // events=1 opts in to non-message signals (reactions, coinage, …); a
        // harness that didn't ask would chat-reply to a reaction.
        const events = url.searchParams.get("events") === "1";
        if (inboundQueue.length > 0 || (events && eventQueue.length > 0)) return json(200, drainInbound(events));
        const drained = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            const i = waiters.findIndex((w) => w.resolve === resolve);
            if (i >= 0) waiters.splice(i, 1);
            resolve([]);
          }, waitSecs * 1000);
          waiters.push({ resolve, timer, events });
        });
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
      if (req.method === "POST" && url.pathname === "/send") {
        const { chat_id: chatId, text, reply_to: replyTo, edit_of: editOf } = await readJson(req);
        if (!chatId || !text) return json(400, { success: false, error: "chat_id and text required" });
        if (replyTo && editOf) return json(400, { success: false, error: "reply_to and edit_of are mutually exclusive" });
        // Auto-upgrade: the first plain send for a peer with an open live
        // placeholder becomes its final edit — every harness gets the
        // thinking->answer single-message flow without code changes.
        if (!replyTo && !editOf) {
          const lp = await takeLivePlaceholder(chatId);
          if (lp) {
            try {
              const { messageId } = await lp.handle.finalize(String(text));
              return json(200, { success: true, message_id: messageId });
            } catch (e) {
              log("BOT_LIVE_FINALIZE_FAILED", { to: chatId, error: String(e?.message ?? e) });
            }
          }
        } else {
          // The answer went out as a quote/edit, which cannot BE the
          // placeholder — retire the placeholder to a terminal glyph so it
          // never dangles (a later unrelated send must not "upgrade" it).
          const lp = await takeLivePlaceholder(chatId);
          if (lp) lp.handle.finalize("✓").catch((e) => log("BOT_LIVE_FINALIZE_FAILED", { to: chatId, error: String(e?.message ?? e) }));
        }
        // Harness-driven edits go through the live outbox: throttled,
        // latest-wins, so a streaming harness (Hermes edits every 0.8s) can't
        // exceed the protocol-safe cadence. Fire-and-forget by design.
        if (editOf) {
          disarmThinking(chatId);
          liveReplies.throttledEdit(norm(chatId), String(editOf), String(text));
          return json(200, { success: true, message_id: String(editOf), coalesced: true });
        }
        const messageId = await sendMessage(chatId, {
          text: String(text),
          replyTo: replyTo ? String(replyTo) : null,
        });
        return json(200, { success: true, message_id: messageId });
      }
      if (req.method === "POST" && url.pathname === "/react") {
        const { chat_id: chatId, message_id: targetId, emoji, remove } = await readJson(req);
        if (!chatId || !targetId || !emoji) return json(400, { success: false, error: "chat_id, message_id and emoji required" });
        // The wire accepts any string; cap it so a confused harness can't push
        // paragraphs through the reaction field.
        if (String(emoji).length > 16) return json(400, { success: false, error: "emoji too long" });
        await sendReaction(chatId, String(targetId), String(emoji), Boolean(remove));
        return json(200, { success: true });
      }
      if (req.method === "POST" && url.pathname === "/typing") return json(200, { ok: true });
      return json(404, { error: "not found" });
    } catch (error) {
      return json(500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.on("error", (e) => {
    if (e?.code === "EADDRINUSE") {
      log("BOT_BRIDGE_PORT_IN_USE", { host: bridgeHost, port: bridgePort });
      console.error(`Bridge port ${bridgePort} is already in use — another bot is likely running. Set BOT_BRIDGE_PORT to a free port.`);
    } else {
      log("BOT_BRIDGE_ERROR", { error: String(e?.message ?? e) });
    }
    stateStore?.flush();
    process.exit(1);
  });
  server.listen(bridgePort, bridgeHost, () => log("BOT_BRIDGE_LISTENING", { host: bridgeHost, port: bridgePort }));
};

// ---------- main ----------
log("BOT_STARTING", { endpoint, account: `0x${accountIdHex}`, username, brain, allowlist: allowedPeers.size });
if (!stateStore) log("BOT_STATE_DISABLED", { note: "BOT_STATE_DIR unset — open conversations won't survive a restart" });

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

startBridge();
log("BOT_LISTENING", { account: `0x${accountIdHex}`, identifierKey: `0x${norm(bytesToHex(identifierKey))}` });

// Restore saved sessions so open conversations continue across a restart —
// rebuild each peer's (deterministic) session and resume watching its channel,
// and reload the dedup set so we don't re-answer already-handled messages.
const restored = stateStore?.load();
// Resume tokens are only valid for the same engine + workspace they were
// captured under; a change to either invalidates every token (resuming a
// session against the wrong cwd/CLI corrupts it).
const resumeValid = engine && restored?.agent
  && restored.agent.engine === (customCmd ? "custom" : brain)
  && restored.agent.workspace === aiWorkspace;
if (engine && restored?.agent && !resumeValid) log("BOT_RESUME_INVALIDATED", { was: restored.agent, now: { engine: customCmd ? "custom" : brain, workspace: aiWorkspace } });
let restoredPeers = 0;
for (const p of restored?.peers ?? []) {
  // Per-peer guard: one malformed persisted entry must not crash startup and
  // trip a Docker restart loop — skip it and keep the rest of the sessions.
  try {
    const devices = (p.devices ?? []).map((d) => ({ statementAccountId: hexToBytes(d.s), encryptionPublicKey: hexToBytes(d.e) }));
    buildSession(p.peerHex, p.identifierKeyHex, devices);
    addSessionWatch(p.peerHex);
    if (resumeValid && p.rs) peerResume.set(norm(p.peerHex), p.rs);
    restoredPeers += 1;
  } catch (e) { log("BOT_STATE_PEER_SKIPPED", { peer: p?.peerHex, error: String(e?.message ?? e) }); }
}
for (const id of restored?.seen ?? []) seenRequests.add(id);
for (const id of restored?.greeted ?? []) greetedPeers.add(id);
for (const id of restored?.intro ?? []) introducedPeers.add(id);
// Re-run anything that was ACKed but not yet answered when the last process
// died — the app will never resend these, the journal is their only way back.
let restoredOwed = 0;
for (const o of restored?.owed ?? []) {
  try {
    if (!o?.id || !o?.p || typeof o?.t !== "string") continue;
    const msg = {
      text: typeof o.c === "string" ? o.c : o.t,
      messageId: o.id,
      kind: o.k ?? "text",
      ...(o.q ? { replyTo: o.q } : {}),
      ...(o.e ? { editOf: o.e } : {}),
      ...(Array.isArray(o.a) && o.a.length ? {
        attachments: o.a.map((x) => ({
          id: x.i, ticketHex: x.ct, wssUrl: x.u, mime: x.m, size: x.s, fileKind: x.kd,
          ...(x.w != null ? { width: x.w, height: x.h } : {}),
          ...(x.d != null ? { duration: x.d } : {}),
        })),
      } : {}),
    };
    oweReply(o.id, o.p, msg, o.r);
    enqueueOwed(o.p, o.id, msg, o.r);
    restoredOwed += 1;
  } catch (e) { log("BOT_STATE_OWED_SKIPPED", { error: String(e?.message ?? e) }); }
}
if (restored) log("BOT_STATE_RESTORED", { peers: restoredPeers, seen: restored.seen?.length ?? 0, owed: restoredOwed });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stateStore?.flush(); process.exit(0); });

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
    handleStatements: (statements) => dispatchSerial(async () => {
      const watch = buildWatch();
      for (const st of statements) await dispatchStatement(st, watch);
    }),
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
    recover: () => resubscribe(true),
    emit: ({ event, ...extra }) => log(event, extra),
    heartbeatIntervalMs: Number(env.BOT_HEARTBEAT_MS ?? 30_000),
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
    const sessionTopics = [...buildWatch().values()].filter((w) => w.kind === "session").map((w) => w.topic);
    for (let i = 0; i < sessionTopics.length; i += TOPIC_BATCH) {
      desired.set(`sessions-${i / TOPIC_BATCH}`, sessionTopics.slice(i, i + TOPIC_BATCH));
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
  log("BOT_SUBSCRIBED", { heartbeatMs: Number(env.BOT_HEARTBEAT_MS ?? 30_000) });
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
          ownP256PrivateKey: p256PrivateKey,
          ownP256PublicKey: identifierKey,
          text: greetText,
        });
        const today = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
        const topics = [chatRequestAllPeerStatementsTopic(peerAccount)];
        if (today != null) topics.push(chatRequestPaginationTopic(peerAccount, today));
        await submitBounded({ walletPair: wallet, channel: session.outgoingRequestChannel, topics, scaleEncodedPayload: payload, expiryFactory });
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
const sweepMs = Number(env.BOT_SWEEP_MS ?? 30_000);
const ingressHealthy = () => {
  if (!ingress) return false;
  const s = ingress.supervisor.snapshot();
  return s.sinceOkMs < s.staleMs;
};

for (;;) {
  try { await pollOnce(); } catch (error) { log("BOT_POLL_ERROR", { error: error instanceof Error ? error.message : String(error) }); }
  ingress?.resubscribe(); // day rollover / watch-set changes
  // Back off on a sustained outage so we don't hammer a recovering node with the
  // full topic fan-out every tick; normal cadence resumes on the first success.
  const base = ingressHealthy() ? sweepMs : pollMs;
  const wait = pollFailStreak > 0 ? Math.min(30_000, pollMs * 2 ** Math.min(pollFailStreak, 5)) : base;
  await delay(wait);
}
