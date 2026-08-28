#!/usr/bin/env node
// Headless test client that reproduces the mobile app's DEVICE-channel
// behaviour, which test-client.mjs cannot (it follows up on the identity
// channel). Mirrors what a phone does:
//  - opener v2 advertising a SEPARATE device X25519 key (statement acct = identity acct)
//  - follow-ups sent on the DEVICE session topic as a multi-device envelope,
//    preceded by an undecodable richText+attachment message (like a photo) to
//    exercise batch resilience
// Usage:
//   node test-client-device.mjs --seed-hex 0x.. --bot-account 0x.. \
//     --bot-identifier-key 0x.. [--bot-device-key 0x..] [--no-opener 1] [--wait-secs 30] \
//     [--settle-ms N] [--poll-ms 2000] "opener" ["follow-up" ...]
// --settle-ms N ends a wait window early once at least one statement arrived
// in it AND nothing new has arrived for N ms (0 = always sit out the full
// window). --wait-secs stays the hard ceiling either way.
// Feature flags (all optional, run after the follow-ups):
//   --attach '{"identifier":"0x..","ticket":"0x..","url":"ws://..","mime":"image/jpeg","size":N}'
//       send a REAL richText attachment (pre-uploaded to a HOP node, e.g. the
//       tests' mock node) [--attach-caption "text"]
//   --reply 1        send follow-ups as kind-7 replies quoting the bot's last message
//   --react "🔥"     react to the bot's last message (expect ACK, no reply)
//   --offer-call 1   send a WebRTC offer and require a dataChannelClosed decline
import { blake2b } from "@noble/hashes/blake2.js";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic,
  chatRequestDayFromUnixSeconds,
  chatRequestPaginationTopic,
  decodeAccountEcdhKey,
  decodeSessionStatementPayload,
  deriveX25519PrivateKey,
  encodeNativeChatRequestV2,
  encodeOpaqueTextMessage,
  encodeOpaqueReactionMessage,
  encodeOpaqueReplyMessage,
  encodeSessionRequestPayload,
  encodeSessionResponsePayload,
  makeAppUuid,
  makePeerSession,
  scaleEncodeBytes,
  submitAppStatement,
  x25519PublicKeyFromPrivateKey,
} from "./vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "./vendor/lib/wallet-keys.mjs";
import { withTimeout } from "./vendor/lib/async-utils.mjs";

const hexToBytes = (h) => Uint8Array.from(String(h).replace(/^0x/i, "").match(/../g).map((b) => parseInt(b, 16)));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const concat = (...ps) => { const out = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of ps) { out.set(p, o); o += p.length; } return out; };

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const texts = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const seed = hexToBytes(opt("seed-hex"));
const botAccountId = hexToBytes(opt("bot-account"));
const botIdentifier = decodeAccountEcdhKey(hexToBytes(opt("bot-identifier-key")));
if (botIdentifier.kind !== "x25519") throw new Error("bot uses an unsupported chat encryption key type");
const botIdentifierKey = botIdentifier.publicKey;
const waitSecs = Number(opt("wait-secs") ?? 30);
const settleMs = Number(opt("settle-ms") ?? 0);
const pollMs = Number(opt("poll-ms") ?? 2000);

const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
const identityPriv = deriveX25519PrivateKey(seed);
// A real app persists a random device key. This headless test client derives a
// stable, separate fixture key so independent --no-opener invocations still
// represent the same device without writing another state file.
const devicePriv = blake2b(seed, { key: new TextEncoder().encode("pca-test-device"), dkLen: 32 });
const devicePub = x25519PublicKeyFromPrivateKey(devicePriv);

let lastPriority = 0n;
const expiryFactory = (attempt = 0) => {
  let p = (0xffff_ffff_0000_0000n) | (BigInt(Math.floor(Date.now() / 1000)) - 1_763_164_800n + BigInt(attempt));
  if (p <= lastPriority) p = lastPriority + 1n;
  lastPriority = p;
  return p;
};

const lazy = createLazyClient(getWsProvider(opt("endpoint") ?? "wss://people-paseo.rotko.net"));
const store = createPapiStatementStoreAdapter(lazy);
const requestRpc = lazy.getRequestFn();

// Identity view decrypts the force-identity acceptance. Once that acceptance
// advertises the bot's device key, deviceSession becomes the phone's normal
// multi-device sender and receiver view.
const identitySession = makePeerSession({
  ownAccountId: wallet.publicKey, peerAccountId: botAccountId,
  peerIdentifierKey: botIdentifierKey, ownX25519PrivateKey: identityPriv,
  ownDeviceX25519PrivateKey: devicePriv,
});
let deviceSession = null;
let receiveSessions = [identitySession.identitySession];
let receiveTopics = [identitySession.identitySession.peerSessionId];
const configureBotDevice = (publicKey) => {
  deviceSession = makePeerSession({
    ownAccountId: wallet.publicKey,
    peerAccountId: botAccountId,
    peerIdentifierKey: botIdentifierKey,
    ownX25519PrivateKey: identityPriv,
    ownDeviceX25519PrivateKey: devicePriv,
    peerDevices: [{ statementAccountId: botAccountId, encryptionPublicKey: publicKey }],
  });
  const incoming = deviceSession.incomingDeviceSessions[0];
  receiveSessions = [incoming, identitySession.identitySession];
  receiveTopics = [incoming.peerSessionId, identitySession.identitySession.peerSessionId];
};
const pinnedBotDevice = opt("bot-device-key");
if (pinnedBotDevice) configureBotDevice(hexToBytes(pinnedBotDevice));

console.log(`sender=0x${bytesToHex(wallet.publicKey)} deviceKey=0x${bytesToHex(devicePub).slice(0, 16)}…`);
console.log(`device ownSessionId (bot must poll this): 0x${bytesToHex((deviceSession ?? identitySession).ownSessionId)}`);

const seen = new Set();
let statementsSeen = 0;
let lastStatementAt = 0;
let replies = 0;
let acked = [];
let lastBotMessageId = null;
const declinedOffers = [];
const drain = async () => {
  for (const topic of receiveTopics) {
    let stmts = [];
    // Bound every RPC: papi buffers requests forever on a stalled socket
    // instead of rejecting, which would freeze the poll loop (same reason
    // bot-core wraps all chain calls in withTimeout).
    try { stmts = await withTimeout(Promise.resolve(store.queryStatements({ matchAll: [topic] }).match((v) => v, (e) => { throw e; })), 8000, "query"); } catch { continue; }
    for (const st of stmts) {
      const data = typeof st.data === "string" ? hexToBytes(st.data) : st.data;
      const k = bytesToHex(data).slice(0, 48);
      if (seen.has(k)) continue;
      seen.add(k);
      statementsSeen += 1;
      lastStatementAt = Date.now();
      let d = null;
      for (const sess of receiveSessions) {
        try { d = decodeSessionStatementPayload(data, sess, botAccountId); break; } catch (e) { d = { err: e.message }; }
      }
      if (d?.err) { console.log(`  [recv-decode-fail] ${d.err}`); continue; }
      if (d?.kind === "request") {
        for (const m of d.messages ?? []) {
          if (m.kind === "deviceChatAccepted" && m.encryptionPublicKey) {
            configureBotDevice(m.encryptionPublicKey);
            console.log(`  [BOT DEVICE] 0x${bytesToHex(m.encryptionPublicKey).slice(0, 16)}…`);
            continue;
          }
          if (m.kind === "edited") { console.log(`  [BOT EDIT ${m.targetMessageId}] ${m.text}`); continue; }
          if (m.text) { replies += 1; lastBotMessageId = m.messageId ?? lastBotMessageId; console.log(`  [BOT ${m.messageId}] ${m.text}`); }
          if (m.kind === "dataChannelClosed") { declinedOffers.push(m.offerId); console.log(`  [CALL CLOSED] offerId=${m.offerId}`); }
        }
        // Mirror the app: ACK every bot request with a session response (the
        // bot's live-reply edits are gated on this). Disable with --no-ack to
        // exercise the never-fetched-placeholder fallback.
        if (!opt("no-ack")) {
          try {
            const ackSession = deviceSession ?? identitySession.identitySession;
            await withTimeout(submitAppStatement(requestRpc, {
              walletPair: wallet,
              channel: ackSession.responseChannel,
              topics: [ackSession.ownSessionId],
              scaleEncodedPayload: encodeSessionResponsePayload(ackSession, d.requestId),
              expiryFactory,
            }), 8000, "ack submit");
          } catch (e) { console.log(`  [ack-send-fail] ${e?.message ?? e}`); }
        }
      }
      if (d?.kind === "response") { acked.push(d.requestId); console.log(`  [ACK] requestId=${d.requestId} code=${d.responseCode}`); }
    }
  }
};
const pollFor = async (secs) => {
  const seenAtStart = statementsSeen;
  const until = Date.now() + secs * 1000;
  while (Date.now() < until) {
    await drain();
    // Early exit needs activity IN THIS window: a topic pre-populated by an
    // earlier window (or an earlier run) must not count as "the bot answered".
    if (settleMs > 0 && statementsSeen > seenAtStart && Date.now() - lastStatementAt >= settleMs) return;
    await delay(pollMs);
  }
};

// 1) opener advertising the device key (skip with --no-opener 1 to test an existing thread)
let followUps = texts;
if (!opt("no-opener")) {
  const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
  const topics = [chatRequestAllPeerStatementsTopic(botAccountId)];
  if (day != null) topics.push(chatRequestPaginationTopic(botAccountId, day));
  const { payload } = encodeNativeChatRequestV2({
    walletPair: wallet, botAccountId, botIdentifierKey,
    ownX25519PrivateKey: identityPriv, ownDeviceX25519PublicKey: devicePub, text: texts[0],
  });
  await submitAppStatement(requestRpc, {
    walletPair: wallet,
    channel: identitySession.identitySession.outgoingRequestChannel,
    topics,
    scaleEncodedPayload: payload,
    expiryFactory,
  });
  console.log(`[ME opener] ${texts[0]}`);
  await pollFor(waitSecs);
  followUps = texts.slice(1);
}

// 2) DEVICE-channel follow-up: poison richText-with-attachment + real text, one batch
const encodeU64 = (v) => { const b = new Uint8Array(8); let r = BigInt(v); for (let i = 0; i < 8; i++) { b[i] = Number(r & 0xffn); r >>= 8n; } return b; };
const enc = new TextEncoder();
const poison = scaleEncodeBytes(concat(
  scaleEncodeBytes(enc.encode(makeAppUuid())), // messageId
  encodeU64(Date.now()),                        // timestamp
  Uint8Array.of(0),                             // version
  Uint8Array.of(15),                            // contentKind richText
  Uint8Array.of(0),                             // text: None
  Uint8Array.of(1), Uint8Array.of(4),           // attachments: Some, len 1
  Uint8Array.of(0, 0, 0, 0),                    // junk attachment body
));
const submitDeviceBatch = async (opaqueMessages, label) => {
  if (deviceSession == null) throw new Error("bot device key is unknown; send an opener or pass --bot-device-key");
  const payload = encodeSessionRequestPayload(deviceSession, makeAppUuid(), opaqueMessages);
  await submitAppStatement(requestRpc, {
    walletPair: wallet,
    channel: deviceSession.requestChannel,
    topics: [deviceSession.ownSessionId],
    scaleEncodedPayload: payload,
    expiryFactory,
  });
  console.log(`[ME device-channel] ${label}`);
};
for (const text of followUps) {
  const content = opt("reply") && lastBotMessageId
    ? encodeOpaqueReplyMessage({ replyToMessageId: lastBotMessageId, text })
    : encodeOpaqueTextMessage({ text });
  await submitDeviceBatch([poison, content], `(poison image msg) + ${opt("reply") && lastBotMessageId ? "(reply) " : ""}"${text}"`);
  await pollFor(waitSecs);
}

// 3) Optional feature exercises (real attachment, reaction, call offer).
const strB = (s) => scaleEncodeBytes(enc.encode(s));
const u32 = (n) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
const attachSpec = opt("attach") ? JSON.parse(opt("attach")) : null;
if (attachSpec) {
  // A real richText+P2PMixnetFile message, byte-identical to what the app
  // sends after uploading a photo (image meta, thumbnail None).
  const caption = opt("attach-caption") ?? "";
  const fileVariant = concat(
    Uint8Array.of(0),
    scaleEncodeBytes(hexToBytes(attachSpec.identifier)),
    scaleEncodeBytes(hexToBytes(attachSpec.ticket)),
    Uint8Array.of(0), strB(attachSpec.url),
    Uint8Array.of(1), strB(attachSpec.mime ?? "image/jpeg"), u32(attachSpec.size),
    u32(attachSpec.width ?? 640), u32(attachSpec.height ?? 480), Uint8Array.of(0),
  );
  const attachmentMsg = scaleEncodeBytes(concat(
    strB(makeAppUuid()), encodeU64(Date.now()), Uint8Array.of(0), Uint8Array.of(15),
    caption ? concat(Uint8Array.of(1), strB(caption)) : Uint8Array.of(0),
    Uint8Array.of(1), Uint8Array.of(4), fileVariant,
  ));
  await submitDeviceBatch([poison, attachmentMsg], `(photo attachment${caption ? ` + "${caption}"` : ""})`);
  await pollFor(waitSecs);
}
if (opt("react")) {
  if (!lastBotMessageId) { console.log("[SKIP react] no bot message id seen"); }
  else {
    await submitDeviceBatch(
      [encodeOpaqueReactionMessage({ targetMessageId: lastBotMessageId, emoji: opt("react") })],
      `(reaction ${opt("react")} -> ${lastBotMessageId})`,
    );
    await pollFor(Math.min(waitSecs, 12)); // expect an ACK and nothing else
  }
}
let offerDeclined = true;
if (opt("offer-call")) {
  const offerId = makeAppUuid();
  const offerMsg = scaleEncodeBytes(concat(
    strB(offerId), encodeU64(Date.now()), Uint8Array.of(0), Uint8Array.of(8),
    scaleEncodeBytes(enc.encode("v=0 test-offer")), Uint8Array.of(0),
  ));
  await submitDeviceBatch([offerMsg], `(call offer ${offerId})`);
  await pollFor(waitSecs);
  offerDeclined = declinedOffers.includes(offerId);
  console.log(offerDeclined ? `[CALL DECLINED] ${offerId}` : `[CALL NOT DECLINED] ${offerId}`);
}
console.log(`\n=== replies=${replies} acks=${acked.length} ===`);
process.exit(replies > 0 && acked.length > 0 && offerDeclined ? 0 : 1);
