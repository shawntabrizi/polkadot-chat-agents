#!/usr/bin/env node
// Headless test client for a Polkadot chat bot — sends an opener (+ optional
// follow-ups) from an existing attested identity's root seed and prints the
// bot's replies. Lets you test a bot end-to-end without a phone.
//
// Usage:
//   node test-client.mjs --seed-hex 0x<root-seed> \
//     --bot-account 0x<bot-account-hex> --bot-identifier-key 0x<bot-p256-hex> \
//     [--endpoint wss://...] [--wait-secs 25] "message" ["follow up" ...]
//
// NOTE: follow-ups are sent on the identity session channel; the app itself
// uses the device channel — use test-client-device.mjs to exercise that path.

import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic,
  chatRequestDayFromUnixSeconds,
  chatRequestPaginationTopic,
  decodeSessionStatementPayload,
  deriveP256PrivateKey,
  encodeNativeChatRequestV2,
  encodeOpaqueTextMessage,
  encodeSessionRequestPayload,
  makeAppUuid,
  makePeerSession,
  p256PublicKeyFromPrivateKey,
  submitAppStatement,
} from "./vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";

const DEFAULT_ENDPOINT = "wss://paseo-people-next-system-rpc.polkadot.io";
const FLAGS = new Set(["seed-hex", "bot-account", "bot-identifier-key", "endpoint", "wait-secs"]);

function parseArgs(argv) {
  const opts = {};
  const messages = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); if (FLAGS.has(k)) opts[k] = argv[++i]; else opts[k] = true; }
    else messages.push(a);
  }
  return { opts, messages };
}
const hexToBytes = (hex) => {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error(`bad hex: ${hex}`);
  return Uint8Array.from(clean.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
};
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// monotonic timestamp-based statement priority
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

async function main() {
  const { opts, messages } = parseArgs(process.argv.slice(2));
  if (!opts["seed-hex"] || !opts["bot-account"] || !opts["bot-identifier-key"] || messages.length === 0) {
    console.error('Usage: test-client.mjs --seed-hex 0x.. --bot-account 0x.. --bot-identifier-key 0x.. "msg" [...]');
    process.exit(2);
  }
  const endpoint = opts["endpoint"] ?? DEFAULT_ENDPOINT;
  const waitSecs = Number(opts["wait-secs"] ?? 25);
  const seed = hexToBytes(opts["seed-hex"]);
  const botAccountId = hexToBytes(opts["bot-account"]);
  const botIdentifierKey = hexToBytes(opts["bot-identifier-key"]);

  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const p256PrivateKey = deriveP256PrivateKey(deriveSr25519PairFromSeed(seed, "//wallet//chat"));
  const p256PublicKey = p256PublicKeyFromPrivateKey(p256PrivateKey);

  const lazyClient = createLazyClient(getWsProvider(endpoint));
  const statementStore = createPapiStatementStoreAdapter(lazyClient);
  const requestRpc = lazyClient.getRequestFn();
  const session = makePeerSession({
    ownAccountId: wallet.publicKey, peerAccountId: botAccountId,
    peerIdentifierKey: botIdentifierKey, ownP256PrivateKey: p256PrivateKey,
  });
  console.log(`sender=0x${bytesToHex(wallet.publicKey)}  bot=0x${bytesToHex(botAccountId)}\n`);

  const seen = new Set();
  let replyCount = 0;
  const drain = async () => {
    let statements = [];
    try {
      statements = await Promise.resolve(statementStore.queryStatements({ matchAll: [session.peerSessionId] }).match((v) => v, (e) => { throw new Error(String(e?.message ?? e)); }));
    } catch { statements = []; }
    for (const st of statements) {
      const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
      const fp = bytesToHex(data).slice(0, 48);
      if (seen.has(fp)) continue;
      seen.add(fp);
      let decoded = null;
      try { decoded = decodeSessionStatementPayload(data, session, botAccountId); } catch { continue; }
      if (decoded?.kind === "request") for (const m of decoded.messages ?? []) if (m.text) { replyCount += 1; console.log(`  [BOT] ${m.text}`); }
    }
  };
  const pollFor = async (secs) => { const until = Date.now() + secs * 1000; while (Date.now() < until) { await drain(); await delay(2000); } await drain(); };

  const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
  const topics = [chatRequestAllPeerStatementsTopic(botAccountId)];
  if (day != null) topics.push(chatRequestPaginationTopic(botAccountId, day));
  const { payload: openerPayload } = encodeNativeChatRequestV2({
    walletPair: wallet, botAccountId, botIdentifierKey,
    ownP256PrivateKey: p256PrivateKey, ownP256PublicKey: p256PublicKey, text: messages[0],
  });
  await submitAppStatement(requestRpc, { walletPair: wallet, channel: session.outgoingRequestChannel, topics, scaleEncodedPayload: openerPayload, expiryFactory });
  console.log(`[ME] ${messages[0]}`);
  await pollFor(waitSecs);

  for (const text of messages.slice(1)) {
    const payload = encodeSessionRequestPayload(session, makeAppUuid(), [encodeOpaqueTextMessage({ text })]);
    await submitAppStatement(requestRpc, { walletPair: wallet, channel: session.requestChannel, topics: [session.ownSessionId], scaleEncodedPayload: payload, expiryFactory });
    console.log(`[ME] ${text}`);
    await pollFor(waitSecs);
  }
  console.log(`\n=== ${replyCount} bot repl${replyCount === 1 ? "y" : "ies"} received ===`);
  process.exit(replyCount > 0 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
