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
const ackText = env.BOT_ACK_TEXT ?? "Connecting you to the agent…";
const lookbackDays = Number(env.BOT_REQUEST_LOOKBACK_DAYS ?? 7);
const futureDays = Number(env.BOT_REQUEST_FUTURE_DAYS ?? 2);
const pollMs = Number(env.BOT_POLL_MS ?? 2000);
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
  for (const d of extraDevices) {
    if (!peerDevices.some((e) => bytesToHex(e.statementAccountId ?? e.encryptionPublicKey) === bytesToHex(d.statementAccountId ?? d.encryptionPublicKey))) {
      peerDevices.push(d);
    }
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

// ---------- receive: dedup + handlers ----------
const seenStatements = new Set();
const seenRequests = new Set();
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
  // ACK / accept so the peer establishes the session (advertise our device).
  const accept = decoded.deviceEncPubKeyHex
    ? encodeOpaqueMultiChatAcceptedMessage({ acceptedRequestId: decoded.messageId, statementAccountId: accountId, encryptionPublicKey: identifierKey })
    : encodeOpaqueChatAcceptedMessage({ acceptedRequestId: decoded.messageId });
  try {
    const ackPayload = encodeSessionRequestPayload(session, makeAppUuid(), [accept, encodeOpaqueTextMessage({ text: ackText })], { forceIdentity: true });
    await submitAppStatement(requestRpc, { walletPair: wallet, channel: session.requestChannel, topics: [session.ownSessionId], scaleEncodedPayload: ackPayload, expiryFactory });
  } catch (error) { log("BOT_ACK_FAILED", { to: senderHex, error: error instanceof Error ? error.message : String(error) }); }
  log("BOT_RECEIVED_OPENER", { from: senderHex, requestId: decoded.messageId, text: decoded.text });
  enqueueInbound({ chat_id: senderHex, text: decoded.text ?? "", message_id: decoded.messageId });
};

const handleSessionStatement = (data, peerHex, session) => {
  let decoded;
  try { decoded = decodeSessionStatementPayload(data, session, hexToBytes(peerHex)); } catch { return; }
  if (decoded?.kind !== "request") return;
  for (const m of decoded.messages ?? []) {
    if (typeof m.text === "string" && m.text.length > 0) {
      const id = `${decoded.requestId}:${m.text}`;
      if (seenRequests.has(id)) continue;
      seenRequests.add(id);
      log("BOT_RECEIVED_TEXT", { from: peerHex, text: m.text });
      enqueueInbound({ chat_id: peerHex, text: m.text, message_id: decoded.requestId });
    }
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
  // session topics -> follow-ups (read peer's ownSessionId == our peerSessionId)
  for (const peerHex of watchedSessionPeers) {
    const entry = sessions.get(peerHex);
    if (entry == null) continue;
    for (const st of await queryTopic(entry.session.peerSessionId)) {
      const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
      const key = fp(data);
      if (seenStatements.has(key)) continue;
      seenStatements.add(key);
      handleSessionStatement(data, peerHex, entry.session);
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
log("BOT_STARTING", { endpoint, account: `0x${accountIdHex}`, username, allowlist: allowedPeers.size });
startBridge();
log("BOT_LISTENING", { account: `0x${accountIdHex}`, identifierKey: `0x${norm(bytesToHex(identifierKey))}` });
for (;;) {
  try { await pollOnce(); } catch (error) { log("BOT_POLL_ERROR", { error: error instanceof Error ? error.message : String(error) }); }
  await delay(pollMs);
}
