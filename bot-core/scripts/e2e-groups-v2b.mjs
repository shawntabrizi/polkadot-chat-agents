#!/usr/bin/env node
// Spec 0011 rulings 6 and 7 live on a People chain (M16b, pca half): a
// locally running bot is the admin that people drive over DM. Two registered
// test identities play the people: A (the owner) and B (the joiner). Steps
// and markers:
//   CHAT_OK            A opens a DM with the bot (the bot accepts)
//   V2_CREATED         A posts state v1 (policy 1: link with approval; the bot
//                      an admin with every flag) and sends the bot a welcome
//   INVITE_OK          A sends /invite over DM; the bot answers a link that
//                      names the bot first, and the state holds the invite
//   JOIN_PENDING       B opens a chat with the bot with the link's capability
//                      in the opener, then sends joinRequest; B hears pending
//   APPROVE_BUTTON     A gets "B wants to join" with Approve / Reject over DM
//   JOIN_APPROVED      A presses Approve; B gets a welcome and reads the state
//                      the bot posted, with B in it
//   REMOVED_LOCKED_OUT A sends "/remove <B>"; the bot rekeys (2 statements);
//                      B finds no entry and cannot open A's next message
//   SLOWMODE_OK        A sends /slowmode 10; A reads slowModeSecs = 10 in the
//                      bot's state
//   PIN_OK             A posts a message, then "/pin <messageId>"; A reads the pin
//   GROUP2B_LIVE_OK
//
// Usage (seeds are read from the identities' secret.json, never printed):
//   node scripts/e2e-groups-v2b.mjs --a <pca bot dir of A> --b <dir of B> --bot <dir of the running bot>
//     [--endpoint wss://…] [--timeout 180]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic, chatRequestDayFromUnixSeconds, chatRequestPaginationTopic,
  decodeAccountEcdhKey, decodeSessionStatementPayload, deriveX25519PrivateKey,
  encodeNativeChatRequestV2, encodeOpaqueButtonPressMessage, encodeOpaqueGroupControlMessage, encodeOpaqueTextMessage,
  encodeSessionRequestPayload, encodeSessionResponsePayload,
  makeAppUuid, makePeerSession, scaleEncodeBytes, submitAppStatement, x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { PRODUCTS_DEVNET } from "../lib/network-config.mjs";
import { createGroupsV2 } from "../lib/groups-v2.mjs";
import { decodeGroupData, decodeInviteLink, inviteLinkFromBase64Url } from "../lib/group-codec.mjs";
import { groupExpiryFactory, joinProof, open, pairwiseSecret } from "../lib/group-keys.mjs";

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const endpoint = arg("endpoint", PRODUCTS_DEVNET.peopleEndpoints[0]);
const timeoutMs = Number(arg("timeout", "180")) * 1000;
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

// ---------- a person's DM session with the bot ----------
const PRIORITY_OFFSET = 1_763_164_800n;
const makeDm = (who) => {
  let lastExpiry = 0n;
  const expiry = (attempt = 0) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    let p = 0xffff_ffff_0000_0000n | ((now > PRIORITY_OFFSET ? now - PRIORITY_OFFSET : 0n) + BigInt(attempt));
    if (p <= lastExpiry) p = lastExpiry + 1n;
    return (lastExpiry = p);
  };
  const dm = makePeerSession({ ownAccountId: who.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: who.chatPrivate });
  let topics = [dm.peerSessionId];
  let sessions = [dm];
  const seen = new Set();
  const acked = new Set();
  const inbox = []; // every message the bot sent, in arrival order
  const read = async () => {
    for (const st of await query(topics)) {
      const data = hexToBytes(st.data);
      const key = hex(data).slice(0, 96);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const s of sessions) {
        try {
          const d = decodeSessionStatementPayload(data, s, hexToBytes(BOT.account));
          if (d.kind === "response") acked.add(d.requestId);
          if (d.kind === "request") {
            await submitAppStatement(rpc, { walletPair: who.wallet, channel: dm.responseChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionResponsePayload(dm, d.requestId), expiryFactory: expiry });
          }
          for (const m of d.messages ?? []) {
            if (m.kind === "deviceChatAccepted" && m.encryptionPublicKey) {
              const view = makePeerSession({ ownAccountId: who.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: who.chatPrivate, peerDevices: [{ statementAccountId: hexToBytes(BOT.account), encryptionPublicKey: m.encryptionPublicKey }] }).incomingDeviceSessions[0];
              sessions = [view, dm]; topics = [view.peerSessionId, dm.peerSessionId];
            }
            inbox.push(m);
          }
          break;
        } catch (e) { if (process.env.E2E_DEBUG) console.log("DM_DECODE", who.name, e.message); }
      }
    }
  };
  const openChat = async (text) => {
    const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
    const openerTopics = [chatRequestAllPeerStatementsTopic(hexToBytes(BOT.account)), ...(day != null ? [chatRequestPaginationTopic(hexToBytes(BOT.account), day)] : [])];
    const { payload } = encodeNativeChatRequestV2({
      walletPair: who.wallet, botAccountId: hexToBytes(BOT.account), botIdentifierKey: BOT.identifierKey,
      ownX25519PrivateKey: who.chatPrivate, ownDeviceX25519PublicKey: who.identifierKey, text,
    });
    await submitAppStatement(rpc, { walletPair: who.wallet, channel: dm.outgoingRequestChannel, topics: openerTopics, scaleEncodedPayload: payload, expiryFactory: expiry });
  };
  // One message on the session; resolves once the bot ACKed it (one slot per channel).
  const send = async (stage, opaque) => {
    const requestId = makeAppUuid();
    await submitAppStatement(rpc, { walletPair: who.wallet, channel: dm.requestChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionRequestPayload(dm, requestId, [opaque]), expiryFactory: expiry });
    await waitFor(`${stage}(ack)`, async () => acked.has(requestId));
  };
  return { read, openChat, send, inbox };
};
const dmA = makeDm(A);
const dmB = makeDm(B);
const waitFor = async (stage, fn, ms = timeoutMs) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await dmA.read(); await dmB.read(); // keep ACKing the bot's DM statements
    const v = await fn();
    if (v) return v;
    await delay(2500);
  }
  return fail(stage, "timeout");
};
// The first new message in a DM inbox that matches.
const nextIn = (dm, pred) => { const i = dm.inbox.findIndex(pred); return i < 0 ? null : dm.inbox.splice(i, 1)[0]; };
const botText = (dm, re) => nextIn(dm, (m) => (m.kind === "text" || m.kind === "buttons") && re.test(m.text ?? ""));
// Every command names the group: A may share groups with the bot from earlier runs.
const command = async (stage, text, re) => {
  await dmA.send(stage, encodeOpaqueTextMessage({ messageId: makeAppUuid(), timestamp: Date.now(), text: `${text} in ${GROUP_NAME}` }));
  return waitFor(`${stage}(reply)`, async () => botText(dmA, re));
};

// ---------- the group members held here: A and B ----------
const counts = { A: 0 };
const expiryA = groupExpiryFactory();
const makeMember = (who, submitAs) => createGroupsV2({
  selfHex: who.account,
  pairwiseKey: async (peer) => (chatKeys.has(peer) ? pairwiseSecret(who.chatPrivate, chatKeys.get(peer)) : null),
  submit: async ({ topic, channel, data }) => {
    if (!submitAs) throw new Error(`${who.name} does not submit in this script`);
    counts.A += 1;
    await submitAppStatement(rpc, { walletPair: submitAs, channel, topics: [topic], scaleEncodedPayload: scaleEncodeBytes(data), expiryFactory: expiryA });
  },
  sendControl: async () => {}, // B's keyRequest after its removal stays here
});
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
const stateA = () => groupsA.get(groupId).state;

// 1. A opens the chat with the bot.
await dmA.openChat("hello from the M16b group admin test");
await waitFor("CHAT_OK", async () => dmA.inbox.some((m) => m.kind === "chatAccepted" || m.kind === "deviceChatAccepted"));
say("CHAT_OK");

// 2. A creates the group (policy 1, the bot an admin with every flag).
const groupId = crypto.randomUUID();
const GROUP_NAME = `M16b live ${groupId.slice(0, 4)}`;
const welcome = await groupsA.create({ groupId, name: GROUP_NAME, joinPolicy: 1, members: [{ account: BOT.account, role: 1, permissions: 0x00ff }] });
await dmA.send("V2_CREATED", encodeOpaqueGroupControlMessage({ messageId: makeAppUuid(), timestamp: Date.now(), control: welcome }));
say("V2_CREATED", `group=${groupId} policy=1 bot=admin(0xff)`);
await delay(8000); // the bot reads the state from the topic

// 3. /invite: a link that names the bot, held in the state.
const inviteReply = await command("INVITE_OK", "/invite", /polkadot-chat:\/\/g#[A-Za-z0-9_-]+/);
const link = decodeInviteLink(inviteLinkFromBase64Url(/polkadot-chat:\/\/g#([A-Za-z0-9_-]+)/.exec(inviteReply.text)[1]));
if (link.groupId !== groupId || link.admins[0] !== BOT.account) fail("INVITE_OK", JSON.stringify(link.admins));
await waitFor("INVITE_OK(state)", async () => { await sync(groupsA); return stateA().invites.some((i) => i.inviteId === link.inviteId); });
say("INVITE_OK", `admins=${link.admins.length} bot-first=true state-version=${stateA().version}`);

// 4. B asks to join: the capability in the opener, then joinRequest.
const inviteId = Buffer.from(link.inviteId, "hex");
const proof = joinProof(link.secret, B.account);
await dmB.openChat(`Join request: ${link.name} [grp:${inviteId.toString("base64url")}:${Buffer.from(proof).toString("base64url")}]`);
await waitFor("JOIN_PENDING(accept)", async () => dmB.inbox.some((m) => m.kind === "chatAccepted" || m.kind === "deviceChatAccepted"));
await dmB.send("JOIN_PENDING", encodeOpaqueGroupControlMessage({ messageId: makeAppUuid(), timestamp: Date.now(), control: { joinRequest: { groupId, inviteId, proof, note: "M16b live test" } } }));
await waitFor("JOIN_PENDING", async () => nextIn(dmB, (m) => m.kind === "groupControl" && m.control.joinDecision?.status === 0));
say("JOIN_PENDING", `B=${B.name} decision=pending`);

// 5. A gets the Approve button over DM.
const ask = await waitFor("APPROVE_BUTTON", async () => nextIn(dmA, (m) => m.kind === "buttons" && /wants to join/.test(m.text)));
const approve = ask.rows[0].findIndex((b) => b.label === "Approve");
if (approve < 0 || !ask.rows[0][approve].action.callback) fail("APPROVE_BUTTON", JSON.stringify(ask.rows[0].map((b) => b.label)));
say("APPROVE_BUTTON", `text="${ask.text.split("\n")[0]}" buttons=${ask.rows[0].map((b) => b.label).join("/")} oneShot=${ask.oneShot}`);

// 6. A presses Approve: B is admitted (welcome + state).
await dmA.send("JOIN_APPROVED(press)", encodeOpaqueButtonPressMessage({ messageId: makeAppUuid(), timestamp: Date.now(), targetMessageId: ask.messageId, row: 0, index: approve, payload: ask.rows[0][approve].action.callback }));
const bWelcome = await waitFor("JOIN_APPROVED(welcome)", async () => nextIn(dmB, (m) => m.kind === "groupControl" && m.control.welcome?.groupId === groupId));
if (groupsB.welcome(BOT.account, bWelcome.control.welcome) !== "welcomed") fail("JOIN_APPROVED", "B refused the welcome");
await waitFor("JOIN_APPROVED(B state)", async () => { await sync(groupsB); return groupsB.get(groupId).status === "member"; });
const approvedReply = await waitFor("JOIN_APPROVED(reply)", async () => botText(dmA, /joined/));
await sync(groupsA);
if (!stateA().members.some((m) => m.account === B.account)) fail("JOIN_APPROVED", "A's state lacks B");
say("JOIN_APPROVED", `reply="${approvedReply.text}" B status=member members=${stateA().members.length} version=${stateA().version}`);

// 7. /remove B: rekey + state; B is locked out of epoch 2.
const removedReply = await command("REMOVED", `/remove ${B.name}`, /Removed|Refused|can't/);
if (!/^Removed/.test(removedReply.text)) fail("REMOVED", removedReply.text);
await waitFor("REMOVED(A epoch 2)", async () => { await sync(groupsA); return groupsA.get(groupId).epoch === 2; });
const bRes = await waitFor("REMOVED_LOCKED_OUT(rekey)", async () => (await sync(groupsB)).find(({ r }) => r.outcome === "no-entry"));
const ep2 = groupsA.get(groupId).epochs.get(2);
const botOnOld = (await query([groupsA.get(groupId).epochs.get(1).topic])).filter((st) => hex(st.proof?.value?.signer ?? "") === BOT.account && hex(st.channel) === hex(groupsA.get(groupId).epochs.get(1).channels.rekey)).length;
const botOnNew = (await query([ep2.topic])).filter((st) => hex(st.proof?.value?.signer ?? "") === BOT.account && hex(st.channel) === hex(ep2.channels.state)).length;
const pinId = makeAppUuid();
const sent = await groupsA.send(groupId, [encodeOpaqueTextMessage({ messageId: pinId, timestamp: Date.now(), text: "an agenda worth pinning" })]);
if (!sent.ok) fail("REMOVED_LOCKED_OUT", JSON.stringify(sent));
const next = (await query([ep2.topic])).find((st) => hex(st.proof?.value?.signer ?? "") === A.account && hex(st.channel) === hex(ep2.channels.msgs));
let opened = false;
for (const ep of groupsB.get(groupId).epochs.values()) {
  try { open(ep.msgKey, { signer: hexToBytes(A.account), epoch: 2, variant: 0, sealed: decodeGroupData(hexToBytes(next.data)).sealed }); opened = true; } catch { /* locked out */ }
}
if (opened) fail("REMOVED_LOCKED_OUT", "B opened epoch 2");
say("REMOVED_LOCKED_OUT", `reply="${removedReply.text.split(".")[0]}" bot rekey on Topic_1=${botOnOld} bot state on Topic_2=${botOnNew} B outcome=${bRes.r.outcome} B epoch=${groupsB.get(groupId).epoch} opened=false`);

// 8. /slowmode 10.
const slowReply = await command("SLOWMODE_OK", "/slowmode 10", /Slow mode|Refused|can't/);
await waitFor("SLOWMODE_OK(state)", async () => { await sync(groupsA); return stateA().slowModeSecs === 10; });
say("SLOWMODE_OK", `reply="${slowReply.text}" slowModeSecs=${stateA().slowModeSecs} version=${stateA().version}`);

// 9. /pin the message A sent in epoch 2, by its id.
const pinReply = await command("PIN_OK", `/pin ${pinId}`, /Pinned|found no message|Refused|can't/);
if (!/^Pinned/.test(pinReply.text)) fail("PIN_OK", pinReply.text);
await waitFor("PIN_OK(state)", async () => { await sync(groupsA); return stateA().pinned[0] === pinId; });
say("PIN_OK", `reply="${pinReply.text}" pinned=${stateA().pinned[0]} version=${stateA().version}`);
say("GROUP2B_LIVE_OK");
process.exit(0);
