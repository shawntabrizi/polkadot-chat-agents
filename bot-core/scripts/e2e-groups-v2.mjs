#!/usr/bin/env node
// Spec 0011 live proof on a People chain (M16, pca half). Two registered test
// identities play the people: A (the owner, drives the group from here) and
// B (a member); a locally running bot is the third member. Steps and markers:
//   CHAT_OK             A opens a DM with the bot (the bot accepts)
//   V2_CREATED          A posts state v1 on ChState_1 (1 statement) and
//                       sends the bot a `welcome` (kind 249) over the DM;
//                       B takes its welcome and reads the state from the topic
//   ONE_SUBMISSION      A's group message costs exactly 1 statement
//   BOT_REPLY_OK        the bot answers with ONE statement, signed by the bot,
//                       on Topic_1 / ChMsgs_1, and A and B both open it
//   REMOVED             A removes B: rekey on Topic_1 + state on Topic_2 (2 statements)
//   REMOVED_LOCKED_OUT  B finds no rekey entry and cannot open A's next message
//   BOT_EPOCH2_OK       the bot switched epoch: its reply is on Topic_2
//   GROUP2_LIVE_OK
// B's welcome is handed over in-process (the same encoded kind-249 bytes);
// the bot's travels over the real DM session.
//
// Usage (seeds are read from the identities' secret.json, never printed):
//   node scripts/e2e-groups-v2.mjs --a <pca bot dir of A> --b <dir of B> --bot <dir of the running bot>
//     [--endpoint wss://…] [--timeout 120]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic, chatRequestDayFromUnixSeconds, chatRequestPaginationTopic,
  decodeAccountEcdhKey, decodeOpaqueMessageAt, decodeSessionStatementPayload, deriveX25519PrivateKey,
  encodeNativeChatRequestV2, encodeOpaqueGroupControlMessage, encodeOpaqueTextMessage, encodeSessionRequestPayload, encodeSessionResponsePayload,
  makeAppUuid, makePeerSession, scaleEncodeBytes, submitAppStatement, x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { PRODUCTS_DEVNET } from "../lib/network-config.mjs";
import { createGroupsV2 } from "../lib/groups-v2.mjs";
import { decodeGroupData } from "../lib/group-codec.mjs";
import { groupExpiryFactory, open, pairwiseSecret } from "../lib/group-keys.mjs";

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const endpoint = arg("endpoint", PRODUCTS_DEVNET.peopleEndpoints[0]);
const timeoutMs = Number(arg("timeout", "120")) * 1000;
// Statement fields arrive as 0x-hex strings or as bytes, depending on the path.
const hexToBytes = (h) => (h instanceof Uint8Array ? h : Uint8Array.from(Buffer.from(String(h).replace(/^0x/i, ""), "hex")));
const hex = (b) => (typeof b === "string" ? b.replace(/^0x/i, "").toLowerCase() : Buffer.from(b).toString("hex"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (marker, extra = "") => console.log(`${marker}${extra ? ` ${extra}` : ""}`);
const fail = (stage, why) => { console.log(`E2E_FAIL ${stage} ${why}`); process.exit(13); };

const loadIdentity = (dir) => {
  const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const secretFile = path.join(dir, "secret.json");
  const seed = fs.existsSync(secretFile) ? hexToBytes(JSON.parse(fs.readFileSync(secretFile, "utf8")).seedHex) : null;
  const identifierKey = decodeAccountEcdhKey(hexToBytes(config.identifierKey)).publicKey;
  if (!seed) return { name: config.username, account: hex(config.account), identifierKey };
  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const chatPrivate = deriveX25519PrivateKey(seed);
  return { name: config.username, account: hex(wallet.publicKey), wallet, chatPrivate, identifierKey: x25519PublicKeyFromPrivateKey(chatPrivate) };
};
const A = loadIdentity(arg("a") ?? fail("args", "--a"));
const B = loadIdentity(arg("b") ?? fail("args", "--b"));
const BOT = loadIdentity(arg("bot") ?? fail("args", "--bot"));
const chatKeys = new Map([[A.account, A.identifierKey], [B.account, B.identifierKey], [BOT.account, BOT.identifierKey]]);
console.log(`A=${A.name} B=${B.name} BOT=${BOT.name}`);

const lazy = createLazyClient(getWsProvider([endpoint]));
const store = createPapiStatementStoreAdapter(lazy);
const rpc = lazy.getRequestFn();
const query = async (topics) => store.queryStatements({ matchAny: topics }).match((x) => x, (e) => { throw e; });

// ---------- A's DM session with the bot (the path a welcome travels) ----------
const PRIORITY_OFFSET = 1_763_164_800n;
let lastDmExpiry = 0n;
const dmExpiry = (attempt = 0) => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  let p = 0xffff_ffff_0000_0000n | ((now > PRIORITY_OFFSET ? now - PRIORITY_OFFSET : 0n) + BigInt(attempt));
  if (p <= lastDmExpiry) p = lastDmExpiry + 1n;
  return (lastDmExpiry = p);
};
const dm = makePeerSession({ ownAccountId: A.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: A.chatPrivate });
let dmTopics = [dm.peerSessionId];
let dmSessions = [dm];
const dmSeen = new Set();
const dmAcked = new Set();
const readDm = async () => {
  const out = [];
  const got = await query(dmTopics);
  if (process.env.E2E_DEBUG) console.log("DM_QUERY", got.length);
  for (const st of got) {
    const data = hexToBytes(st.data);
    const key = hex(data).slice(0, 96);
    if (dmSeen.has(key)) continue;
    dmSeen.add(key);
    for (const s of dmSessions) {
      try {
        const d = decodeSessionStatementPayload(data, s, hexToBytes(BOT.account));
        if (d.kind === "response") dmAcked.add(d.requestId);
        // ACK the bot's requests as a client does, or its lane waits for us.
        if (d.kind === "request") {
          await submitAppStatement(rpc, { walletPair: A.wallet, channel: dm.responseChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionResponsePayload(dm, d.requestId), expiryFactory: dmExpiry });
        }
        for (const m of d.messages ?? []) {
          if (m.kind === "deviceChatAccepted" && m.encryptionPublicKey) {
            const view = makePeerSession({ ownAccountId: A.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: A.chatPrivate, peerDevices: [{ statementAccountId: hexToBytes(BOT.account), encryptionPublicKey: m.encryptionPublicKey }] }).incomingDeviceSessions[0];
            dmSessions = [view, dm]; dmTopics = [view.peerSessionId, dm.peerSessionId];
          }
          out.push(m);
        }
        break;
      } catch (e) { if (process.env.E2E_DEBUG) console.log("DM_DECODE", e.message); }
    }
  }
  return out;
};
const waitFor = async (stage, fn, ms = timeoutMs) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await readDm(); // keep ACKing the bot's DM statements
    const v = await fn();
    if (v) return v;
    await delay(2500);
  }
  return fail(stage, "timeout");
};

// ---------- the group members held here: A and B ----------
const counts = { A: 0 };
const makeMember = (who, submitAs) => createGroupsV2({
  selfHex: who.account,
  pairwiseKey: async (peer) => (chatKeys.has(peer) ? pairwiseSecret(who.chatPrivate, chatKeys.get(peer)) : null),
  submit: async ({ topic, channel, data }) => {
    if (!submitAs) throw new Error(`${who.name} does not submit in this script`);
    counts.A += 1;
    await submitAppStatement(rpc, { walletPair: submitAs, channel, topics: [topic], scaleEncodedPayload: scaleEncodeBytes(data), expiryFactory: expiryA });
  },
  sendControl: async (peer, control) => { controlsOut.push({ from: who.account, to: peer, control }); },
});
const expiryA = groupExpiryFactory();
const controlsOut = [];
const groupsA = makeMember(A, A.wallet);
const groupsB = makeMember(B, null);
const seenBy = new Map([[groupsA, new Set()], [groupsB, new Set()]]);
const sync = async (groups) => {
  const results = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const topics = groups.topics();
    if (!topics.length) break;
    let fresh = 0;
    for (const st of await query(topics)) {
      const key = `${hex(st.proof?.value?.signer ?? "")}:${hex(st.data).slice(0, 96)}`;
      if (seenBy.get(groups).has(key)) continue;
      seenBy.get(groups).add(key); fresh += 1;
      const topic = (st.topics ?? []).map(hex).find((t) => groups.hasTopic(t));
      results.push({ st, r: await groups.receive({ topicHex: topic, channelHex: hex(st.channel), signerHex: hex(st.proof?.value?.signer ?? ""), data: hexToBytes(st.data) }) });
    }
    if (!fresh) break;
  }
  return results;
};

// 1. A opens the chat with the bot.
const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
const openerTopics = [chatRequestAllPeerStatementsTopic(hexToBytes(BOT.account)), ...(day != null ? [chatRequestPaginationTopic(hexToBytes(BOT.account), day)] : [])];
const { payload: opener } = encodeNativeChatRequestV2({
  walletPair: A.wallet, botAccountId: hexToBytes(BOT.account), botIdentifierKey: BOT.identifierKey,
  ownX25519PrivateKey: A.chatPrivate, ownDeviceX25519PublicKey: A.identifierKey, text: "hello from the M16 group test",
});
await submitAppStatement(rpc, { walletPair: A.wallet, channel: dm.outgoingRequestChannel, topics: openerTopics, scaleEncodedPayload: opener, expiryFactory: dmExpiry });
await waitFor("CHAT_OK", async () => (await readDm()).some((m) => m.kind === "chatAccepted" || m.kind === "deviceChatAccepted"));
say("CHAT_OK");

// 2. A creates the group; the bot's welcome goes over the DM.
const groupId = crypto.randomUUID();
const welcome = await groupsA.create({ groupId, name: "M16 live", members: [{ account: B.account }, { account: BOT.account }] });
if (counts.A !== 1) fail("V2_CREATED", `create cost ${counts.A} statements`);
const welcomeMsg = encodeOpaqueGroupControlMessage({ messageId: makeAppUuid(), timestamp: Date.now(), control: welcome });
const requestId = makeAppUuid();
await submitAppStatement(rpc, { walletPair: A.wallet, channel: dm.requestChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionRequestPayload(dm, requestId, [welcomeMsg]), expiryFactory: dmExpiry });
await waitFor("V2_CREATED(bot ack)", async () => { await readDm(); return dmAcked.has(requestId); });
const bWelcome = decodeOpaqueMessageAt(encodeOpaqueGroupControlMessage({ messageId: "W-B", timestamp: Date.now(), control: welcome }), 0).value.control.welcome;
if (groupsB.welcome(A.account, bWelcome) !== "welcomed") fail("V2_CREATED", "B refused the welcome");
await waitFor("V2_CREATED(B state)", async () => { await sync(groupsB); return groupsB.get(groupId).status === "member"; });
const ep1 = groupsA.get(groupId).epochs.get(1);
say("V2_CREATED", `group=${groupId} topic1=${hex(ep1.topic).slice(0, 16)}… bot acked the welcome; B holds epoch 1`);
await delay(8000); // the bot reads the state from the topic

// 3. One group message = one statement.
const before = counts.A;
await sync(groupsA);
const sent = await groupsA.send(groupId, [encodeOpaqueTextMessage({ messageId: makeAppUuid(), timestamp: Date.now(), text: "hello bot" })]);
if (!sent.ok || counts.A - before !== 1) fail("ONE_SUBMISSION", JSON.stringify(sent));
say("ONE_SUBMISSION", `statements=${counts.A - before}`);

// 4. The bot's reply: ONE statement from the bot on Topic_1 / ChMsgs_1.
const replyOn = async (groups, epochNo, stage) => waitFor(stage, async () => {
  const res = await sync(groups);
  const hit = res.find(({ r }) => r.outcome === "accepted" && r.from === BOT.account && r.messages.some((m) => /Echo/.test(m.message.text ?? "")));
  return hit ? { ...hit, epochNo } : null;
});
const replyA = await replyOn(groupsA, 1, "BOT_REPLY_OK(A)");
const botStatements = (await query([ep1.topic])).filter((st) => hex(st.proof?.value?.signer ?? "") === BOT.account);
const onMsgs = botStatements.filter((st) => hex(st.channel) === hex(ep1.channels.msgs));
if (onMsgs.length !== 1) fail("BOT_REPLY_OK", `bot statements on ChMsgs_1: ${onMsgs.length}`);
const replyB = await replyOn(groupsB, 1, "BOT_REPLY_OK(B)");
say("BOT_REPLY_OK", `text="${replyA.r.messages.find((m) => /Echo/.test(m.message.text)).message.text}" botStatementsOnTopic1=${botStatements.length} channel=ChMsgs_1 B-read=${Boolean(replyB)}`);

// 5. A removes B: two statements.
const beforeRemove = counts.A;
const removed = await groupsA.remove(groupId, B.account);
if (!removed.ok || counts.A - beforeRemove !== 2) fail("REMOVED", JSON.stringify(removed));
const ep2 = groupsA.get(groupId).epochs.get(2);
say("REMOVED", `statements=${counts.A - beforeRemove} entries=${removed.entries} epoch=2 topic2=${hex(ep2.topic).slice(0, 16)}…`);

// 6. B sees the rekey, finds no entry; A's next message is closed to B.
const bRes = await waitFor("REMOVED_LOCKED_OUT(rekey)", async () => (await sync(groupsB)).find(({ r }) => r.outcome === "no-entry"));
await delay(6000); // the bot switches epoch
await sync(groupsA);
const beforeNext = counts.A;
await groupsA.send(groupId, [encodeOpaqueTextMessage({ messageId: makeAppUuid(), timestamp: Date.now(), text: "after B left" })]);
if (counts.A - beforeNext !== 1) fail("REMOVED_LOCKED_OUT", "send cost");
const next = (await query([ep2.topic])).find((st) => hex(st.proof?.value?.signer ?? "") === A.account && hex(st.channel) === hex(ep2.channels.msgs));
if (!next) fail("REMOVED_LOCKED_OUT", "A's epoch-2 carrier not found");
const unknown = await groupsB.receive({ topicHex: hex(ep2.topic), channelHex: hex(next.channel), signerHex: A.account, data: hexToBytes(next.data) });
let opened = false;
for (const ep of groupsB.get(groupId).epochs.values()) {
  try { open(ep.msgKey, { signer: hexToBytes(A.account), epoch: 2, variant: 0, sealed: decodeGroupData(hexToBytes(next.data)).sealed }); opened = true; } catch { /* locked out */ }
}
if (opened || unknown.outcome !== "unknown-topic") fail("REMOVED_LOCKED_OUT", `B opened=${opened} outcome=${unknown.outcome}`);
say("REMOVED_LOCKED_OUT", `B rekey outcome=${bRes.r.outcome} B epoch=${groupsB.get(groupId).epoch} next-message outcome=${unknown.outcome} opened=false`);

// 7. The bot answers on epoch 2.
const reply2 = await replyOn(groupsA, 2, "BOT_EPOCH2_OK");
if (hex(reply2.st.topics[0]) !== hex(ep2.topic)) fail("BOT_EPOCH2_OK", "reply not on Topic_2");
say("BOT_EPOCH2_OK", `text="${reply2.r.messages.at(-1).message.text}" on Topic_2`);
say("GROUP2_LIVE_OK");
process.exit(0);
