#!/usr/bin/env node
// polkadot-bot-core — a standalone transport bridge between the Polkadot app's
// Statement Store chat and a local HTTP API, for AI agent harnesses (Hermes).
//
// It receives chat requests + session follow-ups addressed to the bot identity,
// ACKs them, and exposes:
//   GET  /health                     -> { ok, account, identifierKey, username }
//   GET  /inbound?wait=<secs>        -> long-poll; [{chat_id, text, message_id}, ...]
//   POST /send  {chat_id, text}      -> publish a reply to that peer
//   POST /typing {chat_id}           -> no-op (best effort)
//
// Reuses ONLY the generic transport codec (vendor/) + a papi client for the
// on-chain identifier-key lookup. No faucet-specific code (coinage/stripe/etc.).
//
// Env: BOT_SEED_HEX (root mini-secret; or FAUCET_CHAT_SERVICE_SECRET),
//   BOT_ENDPOINT (default Paseo), BOT_BRIDGE_PORT (8799), BOT_BRIDGE_HOST (0.0.0.0),
//   BOT_ACK_TEXT, BOT_ALLOWED_PEERS (comma-sep peer account hexes; empty = allow all),
//   BOT_REQUEST_LOOKBACK_DAYS (7), BOT_REQUEST_FUTURE_DAYS (2), BOT_POLL_MS (2000).

import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createStateStore } from "./lib/session-store.mjs";
import { createClient as createPapiClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { paseoPeopleNext } from "@polkadot-api/descriptors";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
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
  encodeOpaqueTextMessage,
  encodeOpaqueChatAcceptedMessage,
  encodeOpaqueMultiChatAcceptedMessage,
  encodeSessionRequestPayload,
  encodeSessionResponsePayload,
  submitAppStatement,
  makeAppUuid,
} from "./vendor/app-chat-codec.mjs";

// ---------- config / helpers ----------
const env = process.env;
const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
const endpoint = env.BOT_ENDPOINT ?? DEFAULT_ENDPOINT;
const seedHex = (env.BOT_SEED_HEX ?? env.FAUCET_CHAT_SERVICE_SECRET ?? "").trim();
const bridgePort = Number(env.BOT_BRIDGE_PORT ?? 8799);
const bridgeHost = env.BOT_BRIDGE_HOST ?? "0.0.0.0";
const brain = (env.BOT_BRAIN ?? "bridge").trim().toLowerCase(); // bridge | hermes | echo | codex | claude | gemini | grok
const ackText = env.BOT_ACK_TEXT ?? (brain === "bridge" || brain === "hermes" ? "Connecting you to the agent…" : "");
// Sent immediately on each message a slow AI brain will answer, so the user sees
// the bot is working instead of a silent ~10-30s gap. Set empty to disable.
const thinkingText = env.BOT_THINKING_TEXT ?? "🤔 One moment — thinking…";

// Direct AI-CLI "brains": bot-core shells out to an agent CLI that owns its own
// auth/token. The transport core stays model-agnostic — these are just hooks that
// turn a (prompt, model) into argv. Each CLI must print its reply to stdout and exit 0.
// BOT_AI_MODEL optionally pins a specific (e.g. low-cost) model per brain via its
// own --model flag; leave unset to use the CLI's default model.
const aiModel = (env.BOT_AI_MODEL ?? "").trim();
const m = (flag, model) => (model ? [flag, model] : []);
const AI_BRAINS = {
  codex:  { cmd: "codex",  args: (p, mo) => ["exec", "--sandbox", "read-only", "--skip-git-repo-check", ...m("-m", mo), p] },
  claude: { cmd: "claude", args: (p, mo) => ["-p", ...m("--model", mo), p] },   // Claude Code print mode
  gemini: { cmd: "gemini", args: (p, mo) => [...m("-m", mo), "-p", p] },        // gemini-cli non-interactive
  grok:   { cmd: "grok",   args: (p, mo) => [...m("-m", mo), "-p", p] },        // grok CLI (may need the generic override below)
};
// Escape hatch for any other/custom CLI (incl. a grok CLI with a different flag):
// BOT_AI_CMD=<bin> and optional BOT_AI_ARGS=<JSON array> where the token
// "__PROMPT__" is replaced by the built prompt (if absent, prompt is the sole arg).
// Takes precedence over the presets so a preset can be overridden without code.
const aiSpec = (() => {
  const custom = (env.BOT_AI_CMD ?? "").trim();
  if (custom) {
    let tmpl = null;
    if (env.BOT_AI_ARGS) {
      try { tmpl = JSON.parse(env.BOT_AI_ARGS); } catch { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
      if (!Array.isArray(tmpl)) { console.error("BOT_AI_ARGS must be a JSON array"); process.exit(2); }
    }
    return { cmd: custom, args: (p) => (tmpl ? tmpl.map((a) => (a === "__PROMPT__" ? p : a)) : [p]) };
  }
  return AI_BRAINS[brain] ?? null;
})();
const lookbackDays = Number(env.BOT_REQUEST_LOOKBACK_DAYS ?? 7);
const futureDays = Number(env.BOT_REQUEST_FUTURE_DAYS ?? 2);
const pollMs = Number(env.BOT_POLL_MS ?? 2000);
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
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex: ${hex}`);
  return Uint8Array.from(clean.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
};
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const norm = (hex) => String(hex).trim().replace(/^0x/i, "").toLowerCase();
const log = (event, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...extra }));
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
const lazyClient = createLazyClient(getWsProvider(endpoint));
const statementStore = createPapiStatementStoreAdapter(lazyClient);
const requestRpc = lazyClient.getRequestFn();
const papiClient = createPapiClient(getWsProvider(endpoint));
const peopleApi = papiClient.getTypedApi(paseoPeopleNext);

const identifierKeyCache = new Map(); // peerHex -> identifierKeyHex
const resolveIdentifierKey = async (peerHex) => {
  const key = norm(peerHex);
  if (identifierKeyCache.has(key)) return identifierKeyCache.get(key);
  let value = null;
  try {
    const consumer = await peopleApi.query.Resources.Consumers.getValue(ss58Address(hexToBytes(key), 2));
    value = consumer?.identifier_key == null ? null : norm(String(consumer.identifier_key));
  } catch (error) {
    log("BOT_IDENTIFIER_LOOKUP_FAILED", { peer: key, error: error instanceof Error ? error.message : String(error) });
  }
  if (value) identifierKeyCache.set(key, value);
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
const inboundQueue = [];
const waiters = [];
const enqueueInbound = (item) => {
  inboundQueue.push(item);
  const w = waiters.shift();
  if (w) { clearTimeout(w.timer); w.resolve(inboundQueue.splice(0)); }
};

const isAllowed = (peerHex) => allowedPeers.size === 0 || allowedPeers.has(norm(peerHex));

// ---------- send a reply text to a peer ----------
const sendText = async (peerHex, text) => {
  const entry = sessions.get(norm(peerHex));
  if (entry == null) throw new Error("no active session for peer");
  const payload = encodeSessionRequestPayload(entry.session, makeAppUuid(), [encodeOpaqueTextMessage({ text })]);
  const result = await submitAppStatement(requestRpc, {
    walletPair: wallet,
    channel: entry.session.requestChannel,
    topics: [entry.session.ownSessionId],
    scaleEncodedPayload: payload,
    expiryFactory,
  });
  log("BOT_SENT_TEXT", { to: peerHex, chars: text.length });
  return result?.priority ?? String(Date.now());
};

// ---------- brain: decide what to do with an inbound message ----------
const aiHistory = new Map(); // peerHex -> [{role, text}]
const AI_TURNS = 8;
const runAgentCli = (peerHex, userText) => new Promise((resolve) => {
  const hist = (aiHistory.get(peerHex) ?? []).slice(-AI_TURNS * 2)
    .map((t) => `${t.role === "user" ? "User" : "You"}: ${t.text}`).join("\n");
  const prompt = [
    "You are a warm, concise assistant chatting inside the Polkadot app. Reply in 1-3 short sentences. Output only your reply.",
    hist ? `Conversation so far:\n${hist}` : "",
    `User: ${userText}`, "You:",
  ].filter(Boolean).join("\n\n");
  // stdin MUST be ignored: a piped stdin makes some CLIs (e.g. codex) block on "Reading additional input".
  const child = spawn(aiSpec.cmd, aiSpec.args(prompt, aiModel), { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  const timer = setTimeout(() => { child.kill("SIGKILL"); log("BOT_AI_TIMEOUT", { to: peerHex }); resolve(null); }, 90_000);
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("error", (e) => { clearTimeout(timer); log("BOT_AI_SPAWN_FAILED", { error: String(e?.message ?? e) }); resolve(null); });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0) return resolve(out.trim());
    // Classify the failure so the operator knows the remedy (re-auth vs. retry).
    // Token management belongs to the codex CLI; we only surface *which* failure it is.
    const authRevoked = /401|unauthorized|refresh token|could not be refreshed|log ?out and sign in/i.test(err);
    log(authRevoked ? "BOT_AI_AUTH_REVOKED" : "BOT_AI_FAILED", { to: peerHex, code, stderr: err.trim().slice(-500) });
    resolve(null);
  });
});

const handleInbound = async (peerHex, text, messageId) => {
  if (brain === "echo") {
    await sendText(peerHex, `Echo: ${text}`).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
    return;
  }
  if (aiSpec) {
    // Immediate "thinking" ack so the ~10-30s model delay doesn't feel timed out.
    if (thinkingText) { sendText(peerHex, thinkingText).catch((e) => log("BOT_THINKING_FAILED", { error: String(e?.message ?? e) })); }
    const reply = await runAgentCli(peerHex, text);  // logs its own classified failure reason
    if (!reply) {
      // Don't leave the user hanging after the "thinking" ack.
      await sendText(peerHex, "Sorry — I couldn't reach my AI just now. Please try again in a moment.").catch(() => {});
      return;
    }
    const h = aiHistory.get(peerHex) ?? [];
    h.push({ role: "user", text }, { role: "bot", text: reply });
    aiHistory.set(peerHex, h.slice(-AI_TURNS * 2));
    await sendText(peerHex, reply).catch((e) => log("BOT_REPLY_FAILED", { error: String(e?.message ?? e) }));
    return;
  }
  // bridge / hermes / unknown: hand off to an external agent via the HTTP bridge
  enqueueInbound({ chat_id: peerHex, text, message_id: messageId });
};

// ---------- receive: dedup + handlers ----------
const seenStatements = new Set();
const seenRequests = new Set();

// Persist only what can't be re-derived: per-peer identifierKey + peerDevices.
// makePeerSession is deterministic, so the channels/keys rebuild exactly from
// these + the seed. Also persist the dedup set so a restart doesn't re-answer
// old messages. (seenStatements stays in-memory — it only avoids redundant
// decode work; seenRequests is the semantic "already replied" guard.)
const snapshotState = () => ({
  v: 1,
  peers: [...sessions.entries()].map(([peerHex, { session, identifierKeyHex }]) => ({
    peerHex,
    identifierKeyHex,
    devices: (session.peerDevices ?? []).map((d) => ({
      s: norm(bytesToHex(d.statementAccountId)),
      e: norm(bytesToHex(d.encryptionPublicKey)),
    })),
  })),
  seen: [...seenRequests].slice(-SEEN_CAP),
});
const persist = () => { if (stateStore) stateStore.save(snapshotState()); };
const fp = (data) => bytesToHex(data).slice(0, 64);

const handleOpener = async (data) => {
  let decoded;
  try { decoded = decodeEncryptedChatRequestPayload(data, p256PrivateKey, accountId); } catch { return; }
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
  persist(); // remember this peer's session so it survives a restart
  // ACK / accept so the peer establishes the session (advertise our device).
  const accept = decoded.deviceEncPubKeyHex
    ? encodeOpaqueMultiChatAcceptedMessage({ acceptedRequestId: decoded.messageId, statementAccountId: accountId, encryptionPublicKey: identifierKey })
    : encodeOpaqueChatAcceptedMessage({ acceptedRequestId: decoded.messageId });
  try {
    const ackPayload = encodeSessionRequestPayload(session, makeAppUuid(), [accept, encodeOpaqueTextMessage({ text: ackText })], { forceIdentity: true });
    await submitAppStatement(requestRpc, { walletPair: wallet, channel: session.requestChannel, topics: [session.ownSessionId], scaleEncodedPayload: ackPayload, expiryFactory });
  } catch (error) { log("BOT_ACK_FAILED", { to: senderHex, error: error instanceof Error ? error.message : String(error) }); }
  log("BOT_RECEIVED_OPENER", { from: senderHex, requestId: decoded.messageId, text: decoded.text });
  await handleInbound(senderHex, decoded.text ?? "", decoded.messageId);
};

// ACK a session request (mirrors the app: response goes on our own session
// topic under the response channel). Without it the app treats every message
// as undelivered and resends its whole backlog forever.
const sendSessionAck = async (peerHex, requestId) => {
  const entry = sessions.get(norm(peerHex));
  if (entry == null) return;
  const payload = encodeSessionResponsePayload(entry.session, requestId);
  await submitAppStatement(requestRpc, {
    walletPair: wallet,
    channel: entry.session.responseChannel,
    topics: [entry.session.ownSessionId],
    scaleEncodedPayload: payload,
    expiryFactory,
  });
};

const handleSessionStatement = async (data, peerHex, session, senderAccountId = hexToBytes(peerHex)) => {
  let decoded;
  // A follow-up we can't decrypt used to vanish silently here — log it so a
  // broken/stale session is diagnosable instead of looking like "no message".
  try { decoded = decodeSessionStatementPayload(data, session, senderAccountId); }
  catch (e) { log("BOT_SESSION_DECODE_FAILED", { from: peerHex, error: String(e?.message ?? e) }); return; }
  if (decoded?.kind !== "request") return;
  for (const m of decoded.messages ?? []) {
    if (typeof m.text === "string" && m.text.length > 0) {
      // Dedup by the stable per-message id (the app resends its unacked backlog
      // under fresh request ids) plus the legacy requestId:text key so entries
      // persisted before this change still count as seen.
      const ids = [m.messageId, `${decoded.requestId}:${m.text}`].filter(Boolean);
      const alreadySeen = ids.some((id) => seenRequests.has(id));
      for (const id of ids) seenRequests.add(id);
      if (alreadySeen) continue;
      persist();
      log("BOT_RECEIVED_TEXT", { from: peerHex, text: m.text });
      await handleInbound(peerHex, m.text, decoded.requestId);
    }
  }
  try { await sendSessionAck(peerHex, decoded.requestId); }
  catch (e) { log("BOT_SESSION_ACK_FAILED", { to: peerHex, error: String(e?.message ?? e) }); }
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

const queryTopic = async (topic) => {
  try {
    return await Promise.resolve(statementStore.queryStatements({ matchAll: [topic] }).match((v) => v, (e) => { throw new Error(String(e?.message ?? e)); }));
  } catch { return []; }
};

const pollOnce = async () => {
  // request-day topics -> openers
  for (const topic of requestDayTopics()) {
    for (const st of await queryTopic(topic)) {
      const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
      const key = fp(data);
      if (seenStatements.has(key)) continue;
      seenStatements.add(key);
      await handleOpener(data);
    }
  }
  // session topics -> follow-ups (read peer's ownSessionId == our peerSessionId).
  // The app's devices publish on per-device session topics derived from their
  // own encryption keys, NOT the identity topic, so poll each incoming device
  // session too — identity-only polling silently misses app follow-ups.
  for (const peerHex of watchedSessionPeers) {
    const entry = sessions.get(peerHex);
    if (entry == null) continue;
    const identityTopicHex = bytesToHex(entry.session.peerSessionId);
    const inbound = [
      { topic: entry.session.peerSessionId, session: entry.session, sender: hexToBytes(peerHex) },
      ...(entry.session.incomingDeviceSessions ?? [])
        .filter((ds) => bytesToHex(ds.peerSessionId) !== identityTopicHex)
        .map((ds) => ({ topic: ds.peerSessionId, session: ds, sender: ds.peerStatementAccountId })),
    ];
    for (const { topic, session, sender } of inbound) {
      for (const st of await queryTopic(topic)) {
        const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
        const key = fp(data);
        if (seenStatements.has(key)) continue;
        seenStatements.add(key);
        await handleSessionStatement(data, peerHex, session, sender);
      }
    }
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
        return json(200, { ok: true, account: `0x${accountIdHex}`, identifierKey: `0x${norm(bytesToHex(identifierKey))}`, username });
      }
      if (req.method === "GET" && url.pathname === "/inbound") {
        const waitSecs = Math.min(60, Math.max(0, Number(url.searchParams.get("wait") ?? 25)));
        if (inboundQueue.length > 0) return json(200, inboundQueue.splice(0));
        const drained = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            const i = waiters.findIndex((w) => w.resolve === resolve);
            if (i >= 0) waiters.splice(i, 1);
            resolve([]);
          }, waitSecs * 1000);
          waiters.push({ resolve, timer });
        });
        return json(200, drained);
      }
      if (req.method === "POST" && url.pathname === "/send") {
        const { chat_id: chatId, text } = await readJson(req);
        if (!chatId || !text) return json(400, { success: false, error: "chat_id and text required" });
        const messageId = await sendText(chatId, String(text));
        return json(200, { success: true, message_id: String(messageId) });
      }
      if (req.method === "POST" && url.pathname === "/typing") return json(200, { ok: true });
      return json(404, { error: "not found" });
    } catch (error) {
      return json(500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.listen(bridgePort, bridgeHost, () => log("BOT_BRIDGE_LISTENING", { host: bridgeHost, port: bridgePort }));
};

// ---------- main ----------
log("BOT_STARTING", { endpoint, account: `0x${accountIdHex}`, username, brain, allowlist: allowedPeers.size });
startBridge();
log("BOT_LISTENING", { account: `0x${accountIdHex}`, identifierKey: `0x${norm(bytesToHex(identifierKey))}` });

// Restore saved sessions so open conversations continue across a restart —
// rebuild each peer's (deterministic) session and resume watching its channel,
// and reload the dedup set so we don't re-answer already-handled messages.
const restored = stateStore?.load();
if (restored?.peers?.length) {
  for (const p of restored.peers) {
    const devices = (p.devices ?? []).map((d) => ({ statementAccountId: hexToBytes(d.s), encryptionPublicKey: hexToBytes(d.e) }));
    buildSession(p.peerHex, p.identifierKeyHex, devices);
    addSessionWatch(p.peerHex);
  }
}
for (const id of restored?.seen ?? []) seenRequests.add(id);
if (restored) log("BOT_STATE_RESTORED", { peers: restored.peers?.length ?? 0, seen: restored.seen?.length ?? 0 });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stateStore?.flush(); process.exit(0); });

for (;;) {
  try { await pollOnce(); } catch (error) { log("BOT_POLL_ERROR", { error: error instanceof Error ? error.message : String(error) }); }
  await delay(pollMs);
}
