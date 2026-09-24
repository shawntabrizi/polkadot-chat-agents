#!/usr/bin/env node
// BOT_COLOR_SWATCH live proof on Products Devnet (the pcdcolor feature). A
// registered test identity (T) talks to a locally running echo bot started
// with BOT_COLOR_SWATCH=1 and a Bulletin authorizer:
//   1. T sends the text "#ff8800": the bot answers with a kind-250 swatch
//      (no brain turn), which T fetches from Bulletin, hash-checks and
//      decrypts (lib/bulletin.mjs download: bitswap, then mirror, then
//      gateway, the desktop's order for a chunk under 512 KB) and reads
//      the pixels of.
//   2. T sends a generated two-colour PNG (70 % blue, 30 % white) as a
//      kind-250 attachment: the bot answers with a swatch of the dominant
//      colour, caption "Dominant #RRGGBB · average #RRGGBB".
// Markers:
//   CHAT_OK          T opens a DM with the bot (the bot accepts)
//   SWATCH_OK        the reply to "#ff8800": caption "#FF8800", a 512x512 PNG
//                    <= 20 KB whose centre pixel is FF8800
//   COLOR_OK
//   AUTH_OK / STORED T's Bulletin account stores the test image
//   COLOR_IMAGE_OK   the reply names dominant #3366CC and its swatch is 3366CC
// Exit 13 on a failed step or a timeout.
//
// Usage (seeds are read from the identities' secret.json, never printed):
//   node scripts/e2e-color.mjs --sender <pca dir of T> --bot <pca dir of the running bot>
//     [--endpoint wss://…] [--authorizer //Eve] [--timeout 180]
import fs from "node:fs";
import path from "node:path";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic, chatRequestDayFromUnixSeconds, chatRequestPaginationTopic,
  decodeAccountEcdhKey, decodeSessionStatementPayload, deriveX25519PrivateKey,
  encodeNativeChatRequestV2, encodeOpaqueAttachmentMessage, encodeOpaqueTextMessage, encodeSessionRequestPayload, encodeSessionResponsePayload,
  makeAppUuid, makePeerSession, submitAppStatement, x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { PRODUCTS_DEVNET } from "../lib/network-config.mjs";
import { bulletinConfig, createBulletin } from "../lib/bulletin.mjs";
import { cidOf } from "../lib/attachment-crypto.mjs";
import { decodePng, makePng } from "../lib/png.mjs";

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const endpoint = arg("endpoint", PRODUCTS_DEVNET.peopleEndpoints[0]);
const timeoutMs = Number(arg("timeout", "180")) * 1000;
const hexToBytes = (h) => (h instanceof Uint8Array ? h : Uint8Array.from(Buffer.from(String(h).replace(/^0x/i, ""), "hex")));
const hex = (b) => (typeof b === "string" ? b.replace(/^0x/i, "").toLowerCase() : Buffer.from(b).toString("hex"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const say = (marker, extra = "") => console.log(`${marker}${extra ? ` ${extra}` : ""} (+${secs()})`);
const fail = (stage, why) => { console.log(`E2E_FAIL ${stage} ${why}`); process.exit(13); };

const loadIdentity = (dir) => {
  const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const secretFile = path.join(dir, "secret.json");
  const seed = fs.existsSync(secretFile) ? hexToBytes(JSON.parse(fs.readFileSync(secretFile, "utf8")).seedHex) : null;
  if (!seed) return { name: config.username, account: hex(config.account), identifierKey: decodeAccountEcdhKey(hexToBytes(config.identifierKey)).publicKey };
  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const chatPrivate = deriveX25519PrivateKey(seed);
  return {
    name: config.username, account: hex(wallet.publicKey), wallet, chatPrivate,
    identifierKey: x25519PublicKeyFromPrivateKey(chatPrivate),
    bulletinPair: deriveSr25519PairFromSeed(seed, "//allowance//bulletin//chat"),
  };
};
const T = loadIdentity(arg("sender") ?? fail("args", "--sender"));
const BOT = loadIdentity(arg("bot") ?? fail("args", "--bot"));
if (!T.wallet) fail("args", "--sender needs a secret.json");
console.log(`T=${T.name} BOT=${BOT.name}`);

const lazy = createLazyClient(getWsProvider([endpoint]));
const store = createPapiStatementStoreAdapter(lazy);
const rpc = lazy.getRequestFn();
const query = async (topics) => store.queryStatements({ matchAny: topics }).match((x) => x, (e) => { throw e; });

// ---------- T's DM session with the bot ----------
const PRIORITY_OFFSET = 1_763_164_800n;
let lastExpiry = 0n;
const expiry = (attempt = 0) => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  let p = 0xffff_ffff_0000_0000n | ((now > PRIORITY_OFFSET ? now - PRIORITY_OFFSET : 0n) + BigInt(attempt));
  if (p <= lastExpiry) p = lastExpiry + 1n;
  return (lastExpiry = p);
};
const submitted = { requests: 0, acks: 0 };
const dm = makePeerSession({ ownAccountId: T.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: T.chatPrivate });
let dmTopics = [dm.peerSessionId];
let dmSessions = [dm];
const dmSeen = new Set();
const dmAcked = new Set();
const inbox = [];
const readDm = async () => {
  for (const st of await query(dmTopics)) {
    const data = hexToBytes(st.data);
    const key = hex(data).slice(0, 96);
    if (dmSeen.has(key)) continue;
    dmSeen.add(key);
    for (const s of dmSessions) {
      try {
        const d = decodeSessionStatementPayload(data, s, hexToBytes(BOT.account));
        if (d.kind === "response") dmAcked.add(d.requestId);
        if (d.kind === "request") {
          submitted.acks += 1;
          await submitAppStatement(rpc, { walletPair: T.wallet, channel: dm.responseChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionResponsePayload(dm, d.requestId), expiryFactory: expiry });
        }
        for (const m of d.messages ?? []) {
          if (m.kind === "deviceChatAccepted" && m.encryptionPublicKey) {
            const view = makePeerSession({ ownAccountId: T.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: T.chatPrivate, peerDevices: [{ statementAccountId: hexToBytes(BOT.account), encryptionPublicKey: m.encryptionPublicKey }] }).incomingDeviceSessions[0];
            dmSessions = [view, dm]; dmTopics = [view.peerSessionId, dm.peerSessionId];
          }
          inbox.push(m);
        }
        break;
      } catch (e) { if (process.env.E2E_DEBUG) console.log("DM_DECODE", e.message); }
    }
  }
};
const waitFor = async (stage, fn, ms = timeoutMs) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await readDm();
    const v = await fn();
    if (v) return v;
    await delay(2500);
  }
  return fail(stage, "timeout");
};

const centreHex = (png) => {
  const img = decodePng(png);
  const i = ((img.height >> 1) * img.width + (img.width >> 1)) * img.channels;
  return `#${[...img.data.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};
const sendToBot = async (opaque) => {
  const requestId = makeAppUuid();

  await submitAppStatement(rpc, { walletPair: T.wallet, channel: dm.requestChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionRequestPayload(dm, requestId, [opaque]), expiryFactory: expiry });
  await waitFor("bot ack", async () => dmAcked.has(requestId));
};
const attachmentsSeen = () => inbox.filter((m) => m.kind === "attachment");

// 1. T opens the chat.
const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
const openerTopics = [chatRequestAllPeerStatementsTopic(hexToBytes(BOT.account)), ...(day != null ? [chatRequestPaginationTopic(hexToBytes(BOT.account), day)] : [])];
const { payload: opener } = encodeNativeChatRequestV2({
  walletPair: T.wallet, botAccountId: hexToBytes(BOT.account), botIdentifierKey: BOT.identifierKey,
  ownX25519PrivateKey: T.chatPrivate, ownDeviceX25519PublicKey: T.identifierKey, text: "hello from the colour swatch test",
});
await submitAppStatement(rpc, { walletPair: T.wallet, channel: dm.outgoingRequestChannel, topics: openerTopics, scaleEncodedPayload: opener, expiryFactory: expiry });
await waitFor("CHAT_OK", async () => inbox.some((m) => m.kind === "chatAccepted" || m.kind === "deviceChatAccepted"));
say("CHAT_OK");

// The Bulletin client T fetches with (and later stores with).
const cfg = bulletinConfig({ BOT_BULLETIN_AUTHORIZER: arg("authorizer", "//Eve") }, PRODUCTS_DEVNET);
const bulletin = createBulletin({
  ...cfg,
  signerPair: T.bulletinPair,
  log: (event, extra) => { if (event === "BOT_BULLETIN_STORED") say("STORED", `${extra.cid} bytes=${extra.bytes} block=${extra.block}`); },
});
const fetchReply = async (stage, reply) => {
  const got = await bulletin.download(reply.items[0]).catch((e) => fail(stage, e.message));
  if (got.plaintext.length !== reply.items[0].size) fail(stage, "size differs from the message");
  return got;
};

// 2. A hex code in plain text: a swatch comes back.
const before1 = attachmentsSeen().length;
await sendToBot(encodeOpaqueTextMessage({ messageId: makeAppUuid(), timestamp: Date.now(), text: "#ff8800" }));
const swatch = await waitFor("SWATCH_OK", async () => attachmentsSeen()[before1]);
if (swatch.caption !== "#FF8800") fail("SWATCH_OK", `caption=${JSON.stringify(swatch.caption)}`);
const got1 = await fetchReply("SWATCH_OK", swatch);
const img1 = decodePng(got1.plaintext);
if (img1.width !== 512 || img1.height !== 512 || got1.plaintext.length > 20 * 1024 || centreHex(got1.plaintext) !== "#FF8800") {
  fail("SWATCH_OK", `png=${img1.width}x${img1.height} bytes=${got1.plaintext.length} centre=${centreHex(got1.plaintext)}`);
}
say("SWATCH_OK", `caption="${swatch.caption}" cid=${cidOf(swatch.items[0].chunks[0])} bytes=${got1.plaintext.length} png=512x512 centre=${centreHex(got1.plaintext)} source=${got1.sources.join(",")} ms=${got1.ms}`);
say("COLOR_OK");

// 3. An image: the dominant colour comes back.
const auth = await bulletin.ensureAuthorized({ transactions: 1, bytes: 100_000 }).catch((e) => fail("AUTH_OK", e.message));
say("AUTH_OK", `account=${bulletin.address} action=${auth.action}`);
const png = makePng(200, 120, (x) => (x < 140 ? [0x33, 0x66, 0xcc] : [255, 255, 255]));
const up = await bulletin.upload(png, { mime: "image/png", media: { kind: "image", width: 200, height: 120 } });
const before2 = attachmentsSeen().length;
await sendToBot(encodeOpaqueAttachmentMessage({ messageId: makeAppUuid(), timestamp: Date.now(), items: [up.item], caption: null }));
say("SENT", `image bytes=${png.length} transactions=${up.transactions}`);
const dominant = await waitFor("COLOR_IMAGE_OK", async () => attachmentsSeen()[before2]);
if (!/^Dominant #3366CC · average #[0-9A-F]{6}$/.test(dominant.caption ?? "")) fail("COLOR_IMAGE_OK", `caption=${JSON.stringify(dominant.caption)}`);
const got2 = await fetchReply("COLOR_IMAGE_OK", dominant);
if (centreHex(got2.plaintext) !== "#3366CC") fail("COLOR_IMAGE_OK", `centre=${centreHex(got2.plaintext)}`);
say("COLOR_IMAGE_OK", `caption="${dominant.caption}" cid=${cidOf(dominant.items[0].chunks[0])} bytes=${got2.plaintext.length} centre=${centreHex(got2.plaintext)} source=${got2.sources.join(",")}`);
bulletin.destroy();
process.exit(0);
