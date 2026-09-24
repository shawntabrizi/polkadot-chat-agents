// DAO chat (M14): a spec 0011 v2 group whose admin bot runs proposals on a
// Dao contract (contracts/dao) on a pallet-revive chain. In the group:
//
//   /propose <title> | <amount> PAS to <username>
//       Members only. The bot registers the group's members on the contract
//       (setMembers, only when the roster changed), creates the proposal
//       (propose; the bot signs and pays), posts ONE buttons message with
//       "Vote yes (stake 0.1 PAS)" / "Vote no (stake 0.1 PAS)" `tx` buttons
//       and a "View on Subscan" url button, and pins it (one state statement).
//   /proposals
//       The group's proposals that are open or passed and not yet executed.
//
// The bot watches the contract's events at the best block. Each Voted event
// of one of its proposals becomes ONE tally line (a reply to the proposal
// message) in the bot's next group statement. When the deadline has passed,
// the bot posts the result with an "Execute" `tx` button (when yes > no) and
// a "Withdraw stake" `tx` button. An Executed event becomes one line. A
// Withdrawn event is only logged (no statement).
//
// The bot never signs for a member: votes, execution and withdrawals are
// spec 0007 intents the member's client dry-runs and signs. Every intent
// carries worst-case limits (0007 "Limits of a Revive call").
//
// Mapping members to the contract: a member's vote is signed by its chat
// identity's wallet account (0007 client rule 3), so its contract address is
// reviveAddress(member account). Registering members puts their H160s on a
// public chain next to keccak256(group id): the group's roster becomes
// linkable on chain. M14 asks for it; see docs/spec/contracts/dao.md.
//
// Pure logic over injected I/O (chain, group, directory), so every path runs
// in memory in the tests.
import { encodeOpaqueButtonsMessage, encodeOpaqueReplyMessage, encodeOpaqueTextMessage, makeAppUuid } from "../vendor/app-chat-codec.mjs";
import { formatPas } from "./meter.mjs";
import { daoCalldata, daoGroupKey, decodeUint256, eventTopic, PLANCKS_PER_PAS, reviveAddress, reviveIntentLimits, serialQueue } from "./revive-chain.mjs";

/** The vote stake the buttons offer: the contract's MIN_STAKE (0.1 PAS). */
export const DAO_STAKE_PLANCKS = PLANCKS_PER_PAS / 10n;
export const DEFAULT_DAO_VOTING_SECS = 86_400;
/** The result is posted this long after the deadline, so a best block with timestamp >= deadline exists. */
export const DAO_CLOSE_GRACE_MS = 12_000;
/** Execute and Withdraw intents stay pressable this long after the result is posted. */
export const DAO_AFTER_TTL_MS = 7 * 86_400_000;
export const DAO_SUBSCAN = "https://assethub-paseo.subscan.io";
export const DAO_MAX_TITLE_BYTES = 80;
/**
 * The worst case of each path a member signs (ReviveApi_call on devnet Asset
 * Hub, 2026-09-24, contract 0x073f…4d87):
 *   vote     the first vote on a side stores the voter's slot and the side's
 *            total (52 800 000 plancks); later votes store one slot; the
 *            weight is the same within 0.01 %;
 *   execute  a transfer to an address with no account charges 100 000 000
 *            (0.01 PAS, the new account); to an existing account 0;
 *   withdraw clears the stake: a refund, no charge.
 * The intents' limits come from these (reviveIntentLimits: ×1.5, deposit at
 * least + 0.1 PAS), so a call signed from a dry-run of one path still lands
 * on the other (a second voter landing first, or a reorg).
 */
export const DAO_WORST = Object.freeze({
  vote: Object.freeze({ deposit: 52_800_000n, refTime: 1_809_647_480n, proofSize: 208_505n }),
  execute: Object.freeze({ deposit: 100_000_000n, refTime: 2_017_284_286n, proofSize: 223_543n }),
  withdraw: Object.freeze({ deposit: 0n, refTime: 1_083_174_774n, proofSize: 99_723n }),
});
export const DAO_TOPICS = Object.freeze({
  proposed: eventTopic("Proposed(uint256,bytes32,address,address,uint256,uint64,string)"),
  voted: eventTopic("Voted(uint256,address,bool,uint256,uint256,uint256)"),
  executed: eventTopic("Executed(uint256,address,uint256)"),
  withdrawn: eventTopic("Withdrawn(uint256,address,uint256)"),
});

const COMMAND_RE = /^\s*\/(propose|proposals)(?:\s+([\s\S]*?))?\s*$/i;
const PROPOSE_RE = /^(.+?)\s*\|\s*(\d+(?:\.\d{1,10})?)\s*PAS\s+to\s+@?(\S+)$/is;
export const isDaoCommand = (text) => COMMAND_RE.test(String(text ?? ""));

const norm = (hex) => String(hex ?? "").trim().replace(/^0x/i, "").toLowerCase();
const topicAddress = (topic) => `0x${String(topic).slice(-40)}`.toLowerCase();
const wordAt = (data, index) => data.subarray(index * 32, index * 32 + 32);
const asHex = (v) => (typeof v === "string" ? v : v instanceof Uint8Array ? `0x${Buffer.from(v).toString("hex")}` : typeof v?.asHex === "function" ? v.asHex() : String(v));
const asBytes = (v) => (v instanceof Uint8Array ? v : typeof v?.asBytes === "function" ? v.asBytes() : Uint8Array.from(Buffer.from(String(v).replace(/^0x/i, ""), "hex")));
const pas = (plancks) => formatPas(plancks);
const pasAmount = (plancks) => formatPas(plancks).replace(/ PAS$/, "");
/** "0.25" -> plancks, or null. */
export const parsePasAmount = (text) => {
  const m = /^(\d+)(?:\.(\d{1,10}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  return BigInt(m[1]) * PLANCKS_PER_PAS + BigInt((m[2] ?? "").padEnd(10, "0") || "0");
};
const duration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} days`;
};
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** The Revive.ContractEmitted events of `contract` in a papi event list: [{ topics, data }]. */
export const emittedBy = (events, contract) => (events ?? []).flatMap((e) => {
  const ev = e?.event ?? e;
  if (ev?.type !== "Revive" || ev.value?.type !== "ContractEmitted") return [];
  const emitted = ev.value.value;
  if (asHex(emitted.contract).toLowerCase() !== contract) return [];
  return [{ topics: emitted.topics.map((t) => asHex(t).toLowerCase()), data: asBytes(emitted.data) }];
});

/**
 * chain:     { genesisHash(), nativeToEthRatio(), ensureMapped(pair), read({origin,dest,calldata}),
 *              callContract(pair, {dest,calldata,value}), watchContractEvents(contract, onBlock, {onError}) }
 * groupsV2:  lib/groups-v2.mjs (get, member, changeState)
 * sendGroup: async (groupId, opaques) -> void; ONE group statement for the opaques given
 * accountOf: async (username) -> account hex | null;  usernameOf: async (account hex) -> username | null
 */
export function createDao({
  chain, contract, pair, selfHex, groupsV2, sendGroup,
  accountOf = async () => null, usernameOf = async () => null,
  votingSecs = DEFAULT_DAO_VOTING_SECS, now = Date.now, makeId = makeAppUuid,
  log = () => {}, onChange = () => {},
}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(contract))) throw new Error("BOT_DAO_CONTRACT must be a 20-byte 0x address");
  if (!Number.isSafeInteger(votingSecs) || votingSecs < 30) throw new Error("the voting period must be at least 30 s");
  const address = String(contract).toLowerCase();
  const self = norm(selfHex);
  const own = reviveAddress(`0x${self}`);
  const botTx = serialQueue(); // one nonce at a time for the bot's own calls
  const proposals = new Map(); // id (decimal string) -> proposal
  const registered = new Map(); // groupId -> Set<h160> the contract lists as members
  const seenEvents = new Set(); // dedupe across reorgs and overlapping best blocks
  let ratio = null;
  let mapped = false;
  let stop = null;
  let timer = null;

  const groupName = (g) => g?.state?.name || "the group";
  const nameOf = async (accountHex) => (await usernameOf(norm(accountHex)).catch(() => null)) ?? `${norm(accountHex).slice(0, 8)}…`;
  const contractValue = async (plancks) => BigInt(plancks) * (ratio ??= await chain.nativeToEthRatio());
  const toPlancks = async (units) => BigInt(units) / (ratio ??= await chain.nativeToEthRatio());
  const seen = (key) => {
    if (seenEvents.has(key)) return true;
    seenEvents.add(key);
    while (seenEvents.size > 4096) seenEvents.delete(seenEvents.values().next().value);
    return false;
  };

  // ---------- group output: every call is ONE statement ----------
  const say = async (groupId, text) => {
    const messageId = makeId();
    await sendGroup(groupId, [encodeOpaqueTextMessage({ messageId, timestamp: now(), text })]);
    return messageId;
  };
  const sayButtons = async (groupId, text, rows) => {
    const messageId = makeId();
    await sendGroup(groupId, [encodeOpaqueButtonsMessage({ messageId, timestamp: now(), text, rows, oneShot: false })]);
    return messageId;
  };
  const sayReply = async (groupId, replyTo, text) => {
    const messageId = makeId();
    await sendGroup(groupId, [replyTo
      ? encodeOpaqueReplyMessage({ messageId, timestamp: now(), replyToMessageId: replyTo, text })
      : encodeOpaqueTextMessage({ messageId, timestamp: now(), text })]);
    return messageId;
  };

  // ---------- intents ----------
  const intent = async ({ calldata, value = 0n, worst, title, description, amount = null, expiresAt }) => ({
    tx: {
      version: 1,
      chainId: await chain.genesisHash(),
      calls: [{ kind: 1, to: address, data: calldata, value, ...reviveIntentLimits(worst) }],
      display: { title, description, ...(amount != null ? { amount, asset: "PAS" } : {}) },
      dryRunRequired: true,
      expiresAt,
    },
  });
  const voteRows = async (p) => {
    const stake = pasAmount(DAO_STAKE_PLANCKS);
    const vote = async (support) => ({
      label: `Vote ${support ? "yes" : "no"} (stake ${stake} PAS)`,
      action: await intent({
        calldata: daoCalldata.vote(BigInt(p.id), support),
        value: DAO_STAKE_PLANCKS,
        worst: DAO_WORST.vote,
        title: `Vote ${support ? "yes" : "no"} on proposal #${p.id}`,
        description: `Stakes ${stake} PAS on "${p.title}". The stake is your vote's weight; you get it back after the vote closes.`.slice(0, 280),
        amount: stake,
        expiresAt: p.deadline * 1000,
      }),
    });
    const rows = [[await vote(true), await vote(false)]];
    if (p.hash) rows.push([{ label: "View on Subscan", action: { url: `${DAO_SUBSCAN}/extrinsic/${p.hash}` } }]);
    return rows;
  };
  const executeButton = async (p) => ({
    label: "Execute",
    action: await intent({
      calldata: daoCalldata.execute(BigInt(p.id)),
      worst: DAO_WORST.execute,
      title: `Execute proposal #${p.id}`,
      description: `Pays ${pas(p.amount)} to ${p.to.name} from the group treasury, as the vote decided.`,
      expiresAt: now() + DAO_AFTER_TTL_MS,
    }),
  });
  const withdrawButton = async (p) => ({
    label: "Withdraw stake",
    action: await intent({
      calldata: daoCalldata.withdraw(BigInt(p.id)),
      worst: DAO_WORST.withdraw,
      title: `Withdraw stake from #${p.id}`,
      description: `Returns the stake of your vote on proposal #${p.id}.`,
      expiresAt: now() + DAO_AFTER_TTL_MS,
    }),
  });

  // ---------- the contract's member list for a group ----------
  const syncMembers = async (g) => {
    const key = daoGroupKey(g.groupId);
    const want = new Set(g.state.members.filter((m) => m.account !== self).map((m) => reviveAddress(`0x${m.account}`)));
    let have = registered.get(g.groupId);
    if (!have) {
      const admin = topicAddress(asHex(await chain.read({ origin: pair.publicKey, dest: address, calldata: daoCalldata.groupAdmin(key) })));
      have = new Set();
      if (admin === own) {
        // Claimed before (a restart without state): read who is listed.
        for (const h160 of want) {
          const listed = decodeUint256(await chain.read({ origin: pair.publicKey, dest: address, calldata: daoCalldata.isMember(key, h160) })) === 1n;
          if (listed) have.add(h160);
        }
      } else if (admin !== `0x${"0".repeat(40)}`) {
        return { ok: false, error: "another account manages this group on the Dao contract" };
      }
    }
    const add = [...want].filter((a) => !have.has(a));
    const remove = [...have].filter((a) => !want.has(a));
    if (add.length || remove.length) {
      const res = await botTx(() => chain.callContract(pair, { dest: address, calldata: daoCalldata.setMembers(key, add, remove) }));
      log("BOT_DAO_MEMBERS_SET", { group: g.groupId, add: add.length, remove: remove.length, ok: res.ok, block: res.block, hash: res.hash, ...(res.ok ? {} : { error: res.error }) });
      if (!res.ok) return { ok: false, error: res.error };
    }
    registered.set(g.groupId, want);
    onChange();
    return { ok: true };
  };

  // A username, an @username, a 0x account, or a member's bare name -> account hex.
  const resolveRecipient = async (g, who) => {
    const name = String(who ?? "").trim().replace(/^@/, "");
    if (/^(0x)?[0-9a-f]{64}$/i.test(name)) return norm(name);
    const found = norm(await accountOf(name).catch(() => null));
    if (/^[0-9a-f]{64}$/.test(found)) return found;
    for (const m of g.state.members) {
      const u = String((await usernameOf(m.account).catch(() => null)) ?? "").toLowerCase();
      if (u && (u === name.toLowerCase() || u.split(".")[0] === name.toLowerCase())) return m.account;
    }
    return null;
  };

  // Pin the proposal message; with 10 pins, drop the oldest pin of a closed proposal first.
  const pin = async (g, messageId) => {
    const closedPins = new Set([...proposals.values()].filter((p) => p.closed && p.messageId).map((p) => p.messageId));
    const res = await groupsV2.changeState(g.groupId, self, (s) => {
      let pinned = s.pinned.filter((id) => id !== messageId);
      if (pinned.length >= 10) {
        const drop = pinned.find((id) => closedPins.has(id));
        if (drop) pinned = pinned.filter((id) => id !== drop);
      }
      return { ...s, pinned: pinned.length >= 10 ? pinned : [...pinned, messageId] };
    });
    log("BOT_DAO_PINNED", { group: g.groupId, messageId, ok: res.ok, ...(res.ok ? { version: res.version } : { reason: res.reason }) });
  };

  const propose = async (g, from, args) => {
    const m = PROPOSE_RE.exec(args);
    if (!m) return say(g.groupId, "Usage: /propose <title> | <amount> PAS to <username>\nExample: /propose Pay the designer | 0.5 PAS to bob.02");
    const title = m[1].trim();
    if (!title || Buffer.byteLength(title) > DAO_MAX_TITLE_BYTES) return say(g.groupId, `The title must be 1 to ${DAO_MAX_TITLE_BYTES} bytes.`);
    const amount = parsePasAmount(m[2]);
    if (!amount) return say(g.groupId, "The amount must be more than 0 PAS.");
    const recipient = await resolveRecipient(g, m[3]);
    if (!recipient) return say(g.groupId, `I cannot find the user ${m[3]}.`);
    if (!mapped) { await botTx(() => chain.ensureMapped(pair)); mapped = true; }
    const synced = await syncMembers(g);
    if (!synced.ok) return say(g.groupId, `The proposal did not go through: ${synced.error}.`);
    const deadline = Math.floor(now() / 1000) + votingSecs;
    const target = reviveAddress(`0x${recipient}`);
    const res = await botTx(async () => chain.callContract(pair, {
      dest: address,
      calldata: daoCalldata.propose({ groupKey: daoGroupKey(g.groupId), title, target, value: await contractValue(amount), deadline }),
    }));
    if (!res.ok) {
      log("BOT_DAO_PROPOSE_FAILED", { group: g.groupId, by: from, error: res.error, dryRun: !!res.dryRun });
      return say(g.groupId, `The proposal did not go through: ${res.error}.`);
    }
    const event = emittedBy(res.events, address).find((e) => e.topics[0] === DAO_TOPICS.proposed);
    if (!event) {
      log("BOT_DAO_PROPOSE_FAILED", { group: g.groupId, by: from, error: "no Proposed event", hash: res.hash });
      return say(g.groupId, "The proposal went on chain, but I could not read its number. Try /proposals later.");
    }
    const p = {
      id: String(BigInt(event.topics[1])), groupId: g.groupId, title, amount, deadline, by: from, hash: res.hash, block: res.block,
      to: { account: recipient, h160: target, name: await nameOf(recipient) },
      yes: 0n, no: 0n, voters: {}, messageId: null, closed: false, executed: false,
    };
    proposals.set(p.id, p);
    log("BOT_DAO_PROPOSED", { group: g.groupId, id: p.id, by: from, to: recipient, amount: String(amount), deadline, block: res.block, hash: res.hash });
    const closesAt = deadline * 1000;
    const text = [
      `Proposal #${p.id}: ${title}`,
      `Pay ${pas(amount)} to ${p.to.name} from the group treasury.`,
      `Proposed by ${await nameOf(from)}. Voting closes in ${duration(closesAt - now())} (${utc(closesAt)}).`,
      `Stake ${pas(DAO_STAKE_PLANCKS)} to vote. The stake is your vote's weight, and you get it back after the vote.`,
    ].join("\n");
    p.messageId = await sayButtons(g.groupId, text, await voteRows(p));
    onChange();
    await pin(g, p.messageId);
    return p.messageId;
  };

  const list = async (g) => {
    const t = now();
    const open = [...proposals.values()].filter((p) => p.groupId === g.groupId && !p.executed && (t < p.deadline * 1000 || p.yes > p.no));
    if (!open.length) return say(g.groupId, `No open proposals in ${groupName(g)}.`);
    const lines = open.map((p) => {
      const state = t < p.deadline * 1000 ? `closes in ${duration(p.deadline * 1000 - t)}` : "passed, waiting for Execute";
      return `#${p.id} ${p.title}: ${pas(p.amount)} to ${p.to.name}. Yes ${pas(p.yes)}, no ${pas(p.no)}; ${state}.`;
    });
    return say(g.groupId, `Open proposals in ${groupName(g)}:\n${lines.join("\n")}`);
  };

  // ---------- events ----------
  const voterName = async (p, h160) => {
    const g = groupsV2.get(p.groupId);
    const member = g?.state?.members.find((m) => reviveAddress(`0x${m.account}`) === h160);
    return member ? nameOf(member.account) : h160;
  };
  const tallyText = (p) => {
    const count = (side) => Object.values(p.voters).filter((v) => v.support === side).length;
    const n = (k) => `${k} vote${k === 1 ? "" : "s"}`;
    return `Tally #${p.id}: yes ${pas(p.yes)} (${n(count(true))}), no ${pas(p.no)} (${n(count(false))}).`;
  };

  const onBlock = async ({ number, events }) => {
    for (const e of events) {
      const [topic0, ...indexed] = e.topics;
      if (topic0 === DAO_TOPICS.voted) {
        const id = String(BigInt(indexed[0]));
        const voter = topicAddress(indexed[1]);
        const p = proposals.get(id);
        if (!p || seen(`v:${id}:${voter}`)) continue;
        const support = decodeUint256(wordAt(e.data, 0)) === 1n;
        const stake = await toPlancks(decodeUint256(wordAt(e.data, 1)));
        p.yes = await toPlancks(decodeUint256(wordAt(e.data, 2)));
        p.no = await toPlancks(decodeUint256(wordAt(e.data, 3)));
        p.voters[voter] = { support, stake };
        onChange();
        log("BOT_DAO_VOTED", { group: p.groupId, id, voter, support, stake: String(stake), yes: String(p.yes), no: String(p.no), block: number, hash: e.extrinsicHash });
        const who = await voterName(p, voter);
        await sayReply(p.groupId, p.messageId, `${tallyText(p)} ${who} voted ${support ? "yes" : "no"} with ${pas(stake)}.`)
          .catch((error) => log("BOT_DAO_POST_FAILED", { id, error: String(error?.message ?? error) }));
      } else if (topic0 === DAO_TOPICS.executed) {
        const id = String(BigInt(indexed[0]));
        const p = proposals.get(id);
        if (!p || seen(`x:${id}`)) continue;
        p.executed = true;
        onChange();
        log("BOT_DAO_EXECUTED", { group: p.groupId, id, block: number, hash: e.extrinsicHash });
        await sayReply(p.groupId, p.messageId, `Proposal #${p.id} executed: ${pas(p.amount)} paid to ${p.to.name}.`)
          .catch((error) => log("BOT_DAO_POST_FAILED", { id, error: String(error?.message ?? error) }));
      } else if (topic0 === DAO_TOPICS.withdrawn) {
        const id = String(BigInt(indexed[0]));
        const voter = topicAddress(indexed[1]);
        const p = proposals.get(id);
        if (!p || seen(`w:${id}:${voter}`)) continue;
        if (p.voters[voter]) p.voters[voter].withdrawn = true;
        onChange();
        log("BOT_DAO_WITHDRAWN", { group: p.groupId, id, voter, amount: String(await toPlancks(decodeUint256(wordAt(e.data, 0)))), block: number, hash: e.extrinsicHash });
      }
    }
  };

  // The deadline passed: one result message with the buttons that apply.
  const close = async (p) => {
    p.closed = true;
    onChange();
    const voters = Object.keys(p.voters).length;
    const passed = p.yes > p.no;
    const result = passed ? "passed" : "rejected";
    log("BOT_DAO_CLOSED", { group: p.groupId, id: p.id, result, yes: String(p.yes), no: String(p.no), voters });
    const head = `Voting on #${p.id} "${p.title}" closed: ${result}. Yes ${pas(p.yes)}, no ${pas(p.no)}.`;
    if (!voters) return sayReply(p.groupId, p.messageId, `${head} Nobody voted.`);
    const rows = [[...(passed ? [await executeButton(p)] : []), await withdrawButton(p)]];
    const text = passed
      ? `${head}\nAnyone can press Execute to pay ${pas(p.amount)} to ${p.to.name}. Voters: withdraw your stake.`
      : `${head}\nNothing is paid. Voters: withdraw your stake.`;
    return sayButtons(p.groupId, text, rows);
  };

  const tick = async () => {
    const t = now();
    for (const p of proposals.values()) {
      if (p.closed || t < p.deadline * 1000 + DAO_CLOSE_GRACE_MS) continue;
      await close(p).catch((error) => log("BOT_DAO_POST_FAILED", { id: p.id, error: String(error?.message ?? error) }));
    }
  };

  return {
    isCommand: isDaoCommand,

    /** A /propose or /proposals from a group member. Resolves when the bot has answered. Never throws. */
    async command(groupId, fromHex, text) {
      const m = COMMAND_RE.exec(String(text ?? ""));
      if (!m) return null;
      const from = norm(fromHex);
      const g = groupsV2.get(groupId);
      if (!g?.state || g.status !== "member") return null;
      try {
        if (!groupsV2.member(groupId, from)) {
          log("BOT_DAO_REFUSED", { group: groupId, from, reason: "not-member" });
          return await say(groupId, `Refused: only members of ${groupName(g)} can make proposals.`);
        }
        if (m[1].toLowerCase() === "proposals") return await list(g);
        return await propose(g, from, (m[2] ?? "").trim());
      } catch (error) {
        log("BOT_DAO_COMMAND_FAILED", { group: groupId, from, command: m[1], error: String(error?.message ?? error) });
        return say(groupId, `That did not work: ${String(error?.message ?? error)}`).catch(() => null);
      }
    },

    /** Post the result of every proposal whose deadline passed. */
    tick,

    start({ tickMs = 5_000 } = {}) {
      stop ??= chain.watchContractEvents(address, onBlock, { onError: (error) => log("BOT_DAO_WATCH_FAILED", { error: String(error?.message ?? error) }) });
      timer ??= setInterval(() => { tick().catch(() => {}); }, tickMs);
      timer.unref?.();
      log("BOT_DAO_WATCHING", { contract: address, votingSecs });
    },
    stop() { stop?.(); stop = null; clearInterval(timer); timer = null; },

    proposals: () => [...proposals.values()],
    snapshot: () => ({
      p: [...proposals.values()].map((p) => ({
        ...p, amount: String(p.amount), yes: String(p.yes), no: String(p.no),
        voters: Object.fromEntries(Object.entries(p.voters).map(([k, v]) => [k, { ...v, stake: String(v.stake) }])),
      })),
      r: Object.fromEntries([...registered].map(([g, set]) => [g, [...set]])),
    }),
    restore(raw) {
      for (const p of Array.isArray(raw?.p) ? raw.p : []) {
        try {
          if (typeof p?.id !== "string" || typeof p.groupId !== "string" || !Number.isSafeInteger(p.deadline)) continue;
          proposals.set(p.id, {
            ...p, amount: BigInt(p.amount), yes: BigInt(p.yes), no: BigInt(p.no),
            voters: Object.fromEntries(Object.entries(p.voters ?? {}).map(([k, v]) => [k, { ...v, stake: BigInt(v.stake) }])),
          });
        } catch (error) { log("BOT_DAO_RESTORE_SKIPPED", { id: p?.id, error: String(error?.message ?? error) }); }
      }
      for (const [g, list] of Object.entries(raw?.r ?? {})) if (Array.isArray(list)) registered.set(g, new Set(list));
    },
    /** Test seam: feed one block as the watcher would. */
    onBlock,
  };
}
