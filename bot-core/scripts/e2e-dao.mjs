#!/usr/bin/env node
// M14 live proof (pca half): DAO chat on the devnet People chain and devnet
// Asset Hub, with the Dao contract (docs/spec/contracts/dao.md in the desktop
// repo). Throwaway identities A (the group owner), B and C and a scratch
// pcddao bot are made with `pca create` in a scratch PCA_BOTS_DIR, funded
// from the public dev account //Alice, and deleted at the end (the bot is
// stopped first). Markers:
//   IDENTITIES_OK   A, B, C and the bot are registered
//   FUNDED          //Alice sent A, B, C 1 PAS each and the bot 2 PAS
//   BOT_STARTED     `pca run` of the bot with BOT_DAO_CONTRACT, 90 s voting
//   CHAT_OK         A opened a DM with the bot
//   V2_CREATED      A created the group (A owner, B and C members, the bot an
//                   admin with every flag) and sent the bot a welcome; B and C
//                   read the state with the same welcome
//   TREASURY_OK     //Alice funded the group's treasury on the contract
//   PROPOSED        A sent "/propose ... | 0.2 PAS to <B>" in the group; the bot
//                   posted the proposal with the vote and Subscan buttons and
//                   pinned it
//   VOTED           A and B pressed "Vote yes", C "Vote no": each signs the
//                   button's intent (dry-run first, the intent's limits) and
//                   the bot posts one tally line per vote
//   CLOSED          after the deadline the bot posts "passed" with Execute and
//                   Withdraw stake
//   EXECUTED        A pressed Execute; B received 0.2 PAS; the bot announced it
//   WITHDRAWN       B pressed Withdraw stake; the bot saw the Withdrawn event
//   DAO_LIVE_OK
//
// Usage: node scripts/e2e-dao.mjs [--contract 0x…] [--voting 90] [--timeout 240] [--keep]
// --keep leaves the scratch folder (identities and bot log) in place.
// Prints no secret: seeds stay in the scratch secret.json files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import {
  chatRequestAllPeerStatementsTopic, chatRequestDayFromUnixSeconds, chatRequestPaginationTopic,
  decodeAccountEcdhKey, decodeSessionStatementPayload, decodeTxIntent, deriveX25519PrivateKey,
  encodeNativeChatRequestV2, encodeOpaqueGroupControlMessage, encodeOpaqueTextMessage,
  encodeSessionRequestPayload, encodeSessionResponsePayload,
  makeAppUuid, makePeerSession, scaleEncodeBytes, submitAppStatement, x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromMnemonic, deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { PRODUCTS_DEVNET } from "../lib/network-config.mjs";
import { createGroupsV2 } from "../lib/groups-v2.mjs";
import { groupExpiryFactory, pairwiseSecret } from "../lib/group-keys.mjs";
import { createReviveChain, daoCalldata, daoGroupKey, PLANCKS_PER_PAS, reviveAddress } from "../lib/revive-chain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "cli.mjs");
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const CONTRACT = arg("contract", "0x073f0e29750b26286befd15619d24ee77e014d87");
const VOTING_SECS = Number(arg("voting", "90"));
const timeoutMs = Number(arg("timeout", "240")) * 1000;
const keep = process.argv.includes("--keep");
const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk"; // public dev phrase
const ASSET_HUB = ["wss://asset-hub-paseo-rpc.n.dwellir.com", "wss://sys.turboflakes.io/asset-hub-paseo"];
const endpoint = PRODUCTS_DEVNET.peopleEndpoints[0];
const hexToBytes = (h) => (h instanceof Uint8Array ? h : Uint8Array.from(Buffer.from(String(h).replace(/^0x/i, ""), "hex")));
const hex = (b) => (typeof b === "string" ? b.replace(/^0x/i, "").toLowerCase() : Buffer.from(b).toString("hex"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const say = (marker, extra = "") => console.log(`${marker}${extra ? ` ${extra}` : ""} at=${at()}`);
const pasText = (plancks) => `${Number(plancks) / Number(PLANCKS_PER_PAS)} PAS`;

// ---------- scratch folder, cleanup ----------
const botsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pca-e2e-dao-"));
const pcaEnv = { ...process.env, PCA_BOTS_DIR: botsDir, PCA_NO_UPDATE_CHECK: "1" };
let botProc = null;
const botLines = [];
const botWaiters = [];
let chain = null;
let lazy = null;
const cleanup = () => {
  if (botProc && botProc.exitCode === null) {
    try { process.kill(-botProc.pid, "SIGTERM"); } catch { botProc.kill("SIGTERM"); }
  }
  try { chain?.destroy(); } catch { /* closing */ }
  try { lazy?.disconnect?.(); } catch { /* closing */ }
  if (!keep) fs.rmSync(botsDir, { recursive: true, force: true });
  else console.log(`KEPT ${botsDir}`);
};
const fail = (stage, why) => {
  console.log(`E2E_FAIL ${stage} ${why} at=${at()}`);
  for (const line of botLines.slice(-15)) console.log(`[bot] ${line.slice(0, 300)}`);
  cleanup();
  process.exit(13);
};
process.on("SIGINT", () => fail("interrupted", "SIGINT"));

// ---------- 1. identities ----------
const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(97 + crypto.randomInt(26))).join("");
const run = (args, { capture = true } = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { env: pcaEnv, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.stderr.on("data", (d) => { out += d; });
  p.on("close", (status) => resolve({ status, out: capture ? out : "" }));
});
const tag = letters(4);
const names = { a: `pcdaoa${tag}`, b: `pcdaob${tag}`, c: `pcdaoc${tag}`, bot: `pcddaox${tag}` };
const created = await Promise.all(Object.values(names).map((name) => run(["create", name, "--brain", "echo", "--public", "--network", "devnet", "--wait", "180"])));
const loadIdentity = (name) => {
  const dir = path.join(botsDir, name);
  const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  if (!config.registered) return null;
  const seed = hexToBytes(JSON.parse(fs.readFileSync(path.join(dir, "secret.json"), "utf8")).seedHex);
  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const chatPrivate = deriveX25519PrivateKey(seed);
  if (hex(wallet.publicKey) !== hex(config.account)) throw new Error(`${name}: the wallet key is not the config account`);
  decodeAccountEcdhKey(hexToBytes(config.identifierKey)); // a registered identifier key
  return { name: config.username, bot: name, account: hex(wallet.publicKey), wallet, chatPrivate, identifierKey: x25519PublicKeyFromPrivateKey(chatPrivate) };
};
const who = {};
for (const [i, [k, name]] of Object.entries(names).entries()) {
  let id = null;
  try { id = loadIdentity(name); } catch (e) { console.log(`LOAD ${name}: ${e.message}`); }
  if (!id) {
    console.log(`CREATE_FAILED ${name} status=${created[i].status}`);
    for (const line of created[i].out.trim().split("\n").slice(-6)) console.log(`[pca] ${line}`);
    fail("IDENTITIES_OK", name);
  }
  who[k] = id;
}
const { a: A, b: B, c: C, bot: BOT } = who;
say("IDENTITIES_OK", `A=${A.name} B=${B.name} C=${C.name} BOT=${BOT.name}`);

// ---------- 2. funds from //Alice ----------
chain = createReviveChain({ endpoints: ASSET_HUB });
const genesis = await chain.genesisHash();
const ratio = await chain.nativeToEthRatio();
const alice = deriveSr25519PairFromMnemonic(DEV_PHRASE, "//Alice");
const fundings = [];
for (const [p, amount] of [[A, PLANCKS_PER_PAS], [B, PLANCKS_PER_PAS], [C, PLANCKS_PER_PAS], [BOT, 2n * PLANCKS_PER_PAS]]) {
  const res = await chain.transfer(alice, { to: `0x${p.account}`, amount });
  if (!res.ok) fail("FUNDED", `${p.name}: ${res.error}`);
  fundings.push(`${p.name}@${res.block}`);
}
say("FUNDED", fundings.join(" "));

// ---------- 3. the bot ----------
botProc = spawn(process.execPath, [CLI, "run", BOT.bot], {
  env: { ...pcaEnv, BOT_DAO_CONTRACT: CONTRACT, BOT_DAO_VOTING_SECS: String(VOTING_SECS) },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true, // its own process group: `pca run` starts the bot as a child
});
const onBotLine = (line) => {
  botLines.push(line);
  if (/BOT_DAO_|_FAILED|ERROR/.test(line)) console.log(`[bot] ${line.slice(0, 260)}`);
  for (const w of [...botWaiters]) w();
};
createInterface({ input: botProc.stdout }).on("line", onBotLine);
createInterface({ input: botProc.stderr }).on("line", onBotLine);
const botEvent = (event, pred = () => true, ms = timeoutMs) => new Promise((resolve) => {
  const find = () => {
    for (const line of botLines) {
      if (!line.includes(`"${event}"`)) continue;
      try { const j = JSON.parse(line.slice(line.indexOf("{"))); if (j.event === event && pred(j)) return j; } catch { /* not JSON */ }
    }
    return null;
  };
  const check = () => { const hit = find(); if (!hit) return false; botWaiters.splice(botWaiters.indexOf(check), 1); clearTimeout(timer); resolve(hit); return true; };
  const timer = setTimeout(() => { botWaiters.splice(botWaiters.indexOf(check), 1); resolve(null); }, ms);
  if (!check()) botWaiters.push(check);
});
if (!(await botEvent("BOT_DAO_WATCHING", () => true, 120_000))) fail("BOT_STARTED", "no BOT_DAO_WATCHING");
if (!(await botEvent("BOT_SUBSCRIBED", () => true, 120_000))) fail("BOT_STARTED", "no BOT_SUBSCRIBED");
say("BOT_STARTED", `${BOT.name} contract=${CONTRACT} voting=${VOTING_SECS}s`);

// ---------- the People chain: A's DM with the bot, and the group ----------
lazy = createLazyClient(getWsProvider([endpoint]));
const store = createPapiStatementStoreAdapter(lazy);
const rpc = lazy.getRequestFn();
const query = async (topics) => store.queryStatements({ matchAny: topics }).match((x) => x, (e) => { throw e; });
const chatKeys = new Map([[A.account, A.identifierKey], [B.account, B.identifierKey], [C.account, C.identifierKey], [BOT.account, BOT.identifierKey]]);

const PRIORITY_OFFSET = 1_763_164_800n;
const makeDm = (me) => {
  let lastExpiry = 0n;
  const expiry = (attempt = 0) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    let p = 0xffff_ffff_0000_0000n | ((now > PRIORITY_OFFSET ? now - PRIORITY_OFFSET : 0n) + BigInt(attempt));
    if (p <= lastExpiry) p = lastExpiry + 1n;
    return (lastExpiry = p);
  };
  const dm = makePeerSession({ ownAccountId: me.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: me.chatPrivate });
  let topics = [dm.peerSessionId];
  let sessions = [dm];
  const seen = new Set();
  const acked = new Set();
  const inbox = [];
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
            await submitAppStatement(rpc, { walletPair: me.wallet, channel: dm.responseChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionResponsePayload(dm, d.requestId), expiryFactory: expiry });
          }
          for (const m of d.messages ?? []) {
            if (m.kind === "deviceChatAccepted" && m.encryptionPublicKey) {
              const view = makePeerSession({ ownAccountId: me.wallet.publicKey, peerAccountId: hexToBytes(BOT.account), peerIdentifierKey: BOT.identifierKey, ownX25519PrivateKey: me.chatPrivate, peerDevices: [{ statementAccountId: hexToBytes(BOT.account), encryptionPublicKey: m.encryptionPublicKey }] }).incomingDeviceSessions[0];
              sessions = [view, dm]; topics = [view.peerSessionId, dm.peerSessionId];
            }
            inbox.push(m);
          }
          break;
        } catch { /* another session's statement */ }
      }
    }
  };
  const openChat = async (text) => {
    const day = chatRequestDayFromUnixSeconds(Math.floor(Date.now() / 1000));
    const openerTopics = [chatRequestAllPeerStatementsTopic(hexToBytes(BOT.account)), ...(day != null ? [chatRequestPaginationTopic(hexToBytes(BOT.account), day)] : [])];
    const { payload } = encodeNativeChatRequestV2({
      walletPair: me.wallet, botAccountId: hexToBytes(BOT.account), botIdentifierKey: BOT.identifierKey,
      ownX25519PrivateKey: me.chatPrivate, ownDeviceX25519PublicKey: me.identifierKey, text,
    });
    await submitAppStatement(rpc, { walletPair: me.wallet, channel: dm.outgoingRequestChannel, topics: openerTopics, scaleEncodedPayload: payload, expiryFactory: expiry });
  };
  const send = async (stage, opaque) => {
    const requestId = makeAppUuid();
    await submitAppStatement(rpc, { walletPair: me.wallet, channel: dm.requestChannel, topics: [dm.ownSessionId], scaleEncodedPayload: encodeSessionRequestPayload(dm, requestId, [opaque]), expiryFactory: expiry });
    await waitFor(`${stage}(ack)`, async () => acked.has(requestId));
  };
  return { read, openChat, send, inbox };
};
const dmA = makeDm(A);
const waitFor = async (stage, fn, ms = timeoutMs) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await dmA.read();
    const v = await fn();
    if (v) return v;
    await delay(2500);
  }
  return fail(stage, "timeout");
};

const expiryA = groupExpiryFactory();
const makeMember = (me, canSubmit) => createGroupsV2({
  selfHex: me.account,
  pairwiseKey: async (peer) => (chatKeys.has(peer) ? pairwiseSecret(me.chatPrivate, chatKeys.get(peer)) : null),
  submit: async ({ topic, channel, data }) => {
    if (!canSubmit) throw new Error(`${me.name} does not submit in this script`);
    await submitAppStatement(rpc, { walletPair: me.wallet, channel, topics: [topic], scaleEncodedPayload: scaleEncodeBytes(data), expiryFactory: expiryA });
  },
  sendControl: async () => {},
});
const members = { A: makeMember(A, true), B: makeMember(B, false), C: makeMember(C, false) };
const seenBy = new Map(Object.values(members).map((g) => [g, new Set()]));
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
      results.push(await groups.receive({ topicHex: topic, channelHex: hex(st.channel), signerHex: hex(st.proof?.value?.signer ?? ""), data: hexToBytes(st.data) }));
    }
    if (!fresh) break;
  }
  return results;
};
// Every message the bot posted in the group, as A reads it, in order.
const botInGroup = [];
const readGroup = async () => {
  for (const r of await sync(members.A)) if (r.from === BOT.account) botInGroup.push(...r.messages.map((x) => x.message));
};
const nextFromBot = (stage, pred) => waitFor(stage, async () => {
  await readGroup();
  const i = botInGroup.findIndex(pred);
  return i < 0 ? null : botInGroup.splice(i, 1)[0];
});

// A client presses a `tx` button (spec 0007): decode the intent, refuse a
// wrong chain, an expired intent or one without a dry-run; map the account
// once; dry-run and sign with max(intent limits, estimate + margin).
const press = async (stage, me, button) => {
  const intent = decodeTxIntent(button.action.tx);
  if (intent.chainId !== genesis) fail(stage, `intent for chain ${intent.chainId}`);
  if (!intent.dryRunRequired || Number(intent.expiresAt) <= Date.now()) fail(stage, "intent expired or without dry-run");
  const [call] = intent.calls;
  await chain.ensureMapped(me.wallet);
  const res = await chain.callContract(me.wallet, {
    dest: `0x${hex(call.to)}`, calldata: `0x${hex(call.data)}`, value: call.value,
    limits: { gasRefTime: call.gasRefTime, gasProofSize: call.gasProofSize, storageDepositLimit: call.storageDepositLimit },
  });
  if (!res.ok) fail(stage, `${me.name} "${button.label}": ${res.dryRun ? "dry-run " : ""}${res.error}`);
  return res;
};

// ---------- 4. A opens the chat and creates the group ----------
await dmA.openChat("hello from the M14 DAO test");
await waitFor("CHAT_OK", async () => dmA.inbox.some((m) => m.kind === "chatAccepted" || m.kind === "deviceChatAccepted"));
say("CHAT_OK");
const groupId = crypto.randomUUID();
const GROUP_NAME = `M14 DAO ${groupId.slice(0, 4)}`;
const welcome = await members.A.create({
  groupId, name: GROUP_NAME,
  members: [{ account: B.account }, { account: C.account }, { account: BOT.account, role: 1, permissions: 0x00ff }],
});
await dmA.send("V2_CREATED", encodeOpaqueGroupControlMessage({ messageId: makeAppUuid(), timestamp: Date.now(), control: welcome }));
for (const [name, g] of [["B", members.B], ["C", members.C]]) {
  if (g.welcome(A.account, welcome.welcome) !== "welcomed") fail("V2_CREATED", `${name} refused the welcome`);
  await waitFor(`V2_CREATED(${name})`, async () => { await sync(g); return g.get(groupId).status === "member"; });
}
await botEvent("BOT_GROUP2_JOINED", (j) => j.group === groupId, 60_000) ?? fail("V2_CREATED", "the bot did not join");
say("V2_CREATED", `group=${groupId} members=4 bot=admin(0xff)`);

// ---------- 5. the treasury ----------
const groupKey = daoGroupKey(groupId);
const funded = await chain.callContract(alice, { dest: CONTRACT, calldata: daoCalldata.fund(groupKey), value: PLANCKS_PER_PAS / 2n });
if (!funded.ok) fail("TREASURY_OK", funded.error);
say("TREASURY_OK", `0.5 PAS block=${funded.block}`);

// ---------- 6. /propose ----------
const AMOUNT = PLANCKS_PER_PAS / 5n;
const sent = await members.A.send(groupId, [encodeOpaqueTextMessage({ messageId: makeAppUuid(), timestamp: Date.now(), text: `/propose M14 live test | 0.2 PAS to ${B.name}` })]);
if (!sent.ok) fail("PROPOSED", JSON.stringify(sent));
const proposal = await nextFromBot("PROPOSED", (m) => m.kind === "buttons" && /^Proposal #\d+: M14 live test/.test(m.text));
const id = /^Proposal #(\d+)/.exec(proposal.text)[1];
const proposed = await botEvent("BOT_DAO_PROPOSED", (j) => j.id === id, 10_000);
const labels = proposal.rows.map((r) => r.map((b) => b.label));
if (JSON.stringify(labels) !== JSON.stringify([["Vote yes (stake 0.1 PAS)", "Vote no (stake 0.1 PAS)"], ["View on Subscan"]])) fail("PROPOSED", JSON.stringify(labels));
await waitFor("PROPOSED(pin)", async () => { await readGroup(); return members.A.get(groupId).state.pinned.includes(proposal.messageId); });
say("PROPOSED", `#${id} block=${proposed?.block} hash=${proposed?.hash} buttons=${labels.flat().join("/")} pinned=true url=${proposal.rows[1][0].action.url}`);

// ---------- 7. votes ----------
const [yes, no] = proposal.rows[0];
for (const [voter, button] of [[A, yes], [B, yes], [C, no]]) {
  const res = await press(`VOTED(${voter.name})`, voter, button);
  const tally = await nextFromBot(`VOTED(${voter.name} tally)`, (m) => m.kind === "reply" && m.replyToMessageId === proposal.messageId && m.text.includes(`${voter.name} voted`));
  say("VOTED", `${voter.name} ${button === yes ? "yes" : "no"} block=${res.block} hash=${res.hash} line="${tally.text}"`);
}

// ---------- 8. the deadline ----------
const closed = await nextFromBot("CLOSED", (m) => m.kind === "buttons" && m.text.startsWith(`Voting on #${id} `), (VOTING_SECS + 90) * 1000);
if (!/closed: passed\./.test(closed.text)) fail("CLOSED", closed.text);
const [execute, withdraw] = closed.rows[0];
if (execute?.label !== "Execute" || withdraw?.label !== "Withdraw stake") fail("CLOSED", JSON.stringify(closed.rows.map((r) => r.map((b) => b.label))));
say("CLOSED", `"${closed.text.split("\n")[0]}" buttons=Execute/Withdraw stake`);

// ---------- 9. execute: B is paid ----------
const before = await chain.freeBalance(`0x${B.account}`);
const executed = await press("EXECUTED", A, execute);
const after = await chain.freeBalance(`0x${B.account}`);
if (after - before !== AMOUNT) fail("EXECUTED", `B's balance changed by ${after - before}, not ${AMOUNT}`);
const doneLine = await nextFromBot("EXECUTED(line)", (m) => m.kind === "reply" && m.text.startsWith(`Proposal #${id} executed`));
say("EXECUTED", `by ${A.name} block=${executed.block} hash=${executed.hash} B +${pasText(after - before)} line="${doneLine.text}"`);

// ---------- 10. B withdraws its stake ----------
const withdrawn = await press("WITHDRAWN", B, withdraw);
const seen = await botEvent("BOT_DAO_WITHDRAWN", (j) => j.id === id && j.voter === reviveAddress(`0x${B.account}`), 90_000);
if (!seen) fail("WITHDRAWN", "the bot did not see the Withdrawn event");
say("WITHDRAWN", `${B.name} block=${withdrawn.block} hash=${withdrawn.hash} amount=${pasText(BigInt(seen.amount))} bot-block=${seen.block}`);
if (ratio !== 100_000_000n) console.log(`NOTE ratio=${ratio}`);
say("DAO_LIVE_OK");
cleanup();
process.exit(0);
