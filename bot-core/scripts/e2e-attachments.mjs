#!/usr/bin/env node
// Spec 0012 live proof on Products Devnet (M15a, pca half). A registered test
// identity (T) sends a ~200 KB PNG to a locally running echo bot as a kind-250
// `attachment` through the Bulletin chain; the bot fetches, verifies and
// decrypts it, describes it (the PNG's dimensions, read from the plaintext)
// and answers with an attachment of its own, which T fetches and verifies.
// Markers:
//   CHAT_OK          T opens a DM with the bot (the bot accepts)
//   AUTH_OK          T's //allowance//bulletin//chat account holds a Bulletin
//                    authorization (granted by the dev key --authorizer if short)
//   STORED <cid>     one line per chunk, in a best block
//   SENT             the kind-250 message: statements=1 (no extra statement)
//   BOT_DESCRIBE_OK  the bot's reply is a kind-250 attachment whose caption
//                    names the dimensions it decrypted and "verified"
//   BOT_FETCH_OK     T fetches the bot's attachment by CID, checks the hash,
//                    decrypts it: a PNG
//   ATTACH_BOT_OK
// Exit 13 on a failed step or a timeout.
//
// Usage (seeds are read from the identities' secret.json, never printed):
//   node scripts/e2e-attachments.mjs --sender <pca dir of T> --bot <pca dir of the running bot>
//     [--endpoint wss://…] [--authorizer //Eve] [--timeout 180]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic, chatRequestDayFromUnixSeconds, chatRequestPaginationTopic,
  decodeAccountEcdhKey, decodeSessionStatementPayload, deriveX25519PrivateKey,
  encodeNativeChatRequestV2, encodeOpaqueAttachmentMessage, encodeSessionRequestPayload, encodeSessionResponsePayload,
  makeAppUuid, makePeerSession, submitAppStatement, x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { PRODUCTS_DEVNET } from "../lib/network-config.mjs";
import { bulletinConfig, createBulletin } from "../lib/bulletin.mjs";
import { cidOf } from "../lib/attachment-crypto.mjs";
import { makePng, pngDimensions } from "../lib/png.mjs";

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

// 1. T opens the chat.
const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
const openerTopics = [chatRequestAllPeerStatementsTopic(hexToBytes(BOT.account)), ...(day != null ? [chatRequestPaginationTopic(hexToBytes(BOT.account), day)] : [])];
const { payload: opener } = encodeNativeChatRequestV2({
  walletPair: T.wallet, botAccountId: hexToBytes(BOT.account), botIdentifierKey: BOT.identifierKey,
  ownX25519PrivateKey: T.chatPrivate, ownDeviceX25519PublicKey: T.identifierKey, text: "hello from the M15a attachment test",
});
await submitAppStatement(rpc, { walletPair: T.wallet, channel: dm.outgoingRequestChannel, topics: openerTopics, scaleEncodedPayload: opener, expiryFactory: expiry });
await waitFor("CHAT_OK", async () => inbox.some((m) => m.kind === "chatAccepted" || m.kind === "deviceChatAccepted"));
say("CHAT_OK");

// 2. T's Bulletin account, authorized (the dev key grants it when short).
const cfg = bulletinConfig({ BOT_BULLETIN_AUTHORIZER: arg("authorizer", "//Eve") }, PRODUCTS_DEVNET);
const bulletin = createBulletin({
  ...cfg,
  signerPair: T.bulletinPair,
  log: (event, extra) => { if (event === "BOT_BULLETIN_STORED") say("STORED", `${extra.cid} bytes=${extra.bytes} block=${extra.block} index=${extra.index}`); else console.log(event, JSON.stringify(extra)); },
});
const auth = await bulletin.ensureAuthorized({ transactions: 1, bytes: 300_000 }).catch((e) => fail("AUTH_OK", e.message));
say("AUTH_OK", `account=${bulletin.address} action=${auth.action} transactionsLeft=${auth.remainingTransactions} bytesLeft=${auth.remainingBytes}`);

// 3. Upload a ~200 KB PNG (random pixels: incompressible) and send ONE message.
const png = makePng(260, 260, () => crypto.randomBytes(3));
const pngSha = crypto.createHash("sha256").update(png).digest("hex");
const up = await bulletin.upload(png, { mime: "image/png", media: { kind: "image", width: 260, height: 260 } });
const messageId = makeAppUuid();
// A run tag in the caption: the echo repeats it, so an earlier run's reply never counts.
const tag = crypto.randomBytes(4).toString("hex");
const opaque = encodeOpaqueAttachmentMessage({ messageId, timestamp: Date.now(), items: [up.item], caption: `M15a test image ${tag}` });
const requestId = makeAppUuid();
const before = submitted.requests;
submitted.requests += 1;
await submitAppStatement(rpc, { walletPair: T.wallet, channel: dm.requestChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionRequestPayload(dm, requestId, [opaque]), expiryFactory: expiry });
say("SENT", `bytes=${png.length} sha256=${pngSha.slice(0, 16)}… transactions=${up.transactions} uploadMs=${up.ms} messageBytes=${opaque.length} statements=${submitted.requests - before}`);
await waitFor("SENT(bot ack)", async () => dmAcked.has(requestId));

// 4. The bot's reply: a kind-250 attachment that describes what it decrypted.
const reply = await waitFor("BOT_DESCRIBE_OK", async () => inbox.find((m) => m.kind === "attachment" && (m.caption ?? "").includes(tag)));
if (!/260x260/.test(reply.caption ?? "") || !/verified/.test(reply.caption ?? "")) fail("BOT_DESCRIBE_OK", `caption=${JSON.stringify(reply.caption)}`);
say("BOT_DESCRIBE_OK", `caption="${reply.caption}" items=${reply.items.length} cid=${cidOf(reply.items[0].chunks[0])}`);

// 5. T fetches the bot's attachment by CID, verifies, decrypts.
const got = await bulletin.download(reply.items[0]).catch((e) => fail("BOT_FETCH_OK", e.message));
const dims = pngDimensions(got.plaintext);
if (!dims || got.plaintext.length !== reply.items[0].size) fail("BOT_FETCH_OK", "not the PNG the message describes");
say("BOT_FETCH_OK", `bytes=${got.plaintext.length} png=${dims.width}x${dims.height} source=${got.sources.join(",")} ms=${got.ms}`);
say("ATTACH_BOT_OK");
bulletin.destroy();
process.exit(0);
