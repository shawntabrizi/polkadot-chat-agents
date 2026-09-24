// Coin flip (M11b): a Flip contract (contracts/flip) on a pallet-revive
// chain. Two players each stake 0.5 PAS with a `tx` button (the client
// dry-runs and signs; the bot never signs here). The second stake settles in
// the same call. The bot watches the contract's events at the best block and
// posts a transactionReference for the settlement to both players' chats.
//
// Enabled by BOT_FLIP_CONTRACT (index.mjs). Everything chain-shaped goes
// through `chain` (lib/revive-chain.mjs or a test fake).
//
// Mapping a player's contract address (H160) to a chat: the account that
// signs a `tx` intent is the chat identity's own wallet account (spec 0007
// client rule 3), so its H160 is reviveAddress(peer account). The bot records
// that address for every peer it talks to (each message, each received
// transactionReference, and every peer restored from the session state) and
// looks the event's addresses up in that map. An address the bot has never
// talked to (a stake from outside the chat) is logged and not notified.

import { decodeUint256, eventTopic, flipCalldata, PLANCKS_PER_PAS, reviveAddress, reviveIntentLimits } from "./revive-chain.mjs";
import { formatPas } from "./meter.mjs";

export const FLIP_STAKE_PLANCKS = PLANCKS_PER_PAS / 2n; // 0.5 PAS; must equal Flip.STAKE / NativeToEthRatio
export const FLIP_INTENT_TTL_MS = 10 * 60_000;
/**
 * The stake's worst case over its two paths (ReviveApi_call on devnet Asset
 * Hub, 2026-09-24): the first stake stores player1 and openedAt and charges
 * 52 800 000 plancks; the settling stake clears them (a refund) and uses the
 * most weight. The intent's limits come from these (reviveIntentLimits), so
 * a stake signed from a dry-run of one path still lands on the other.
 */
export const FLIP_STAKE_WORST = Object.freeze({ deposit: 52_800_000n, refTime: 1_515_302_851n, proofSize: 104_574n });
export const FLIP_OFFER_TEXT = "Stake 0.5 PAS to flip. The second staker triggers the flip; the winner takes 1 PAS.";
export const FLIP_TOPICS = Object.freeze({
  staked: eventTopic("Staked(uint256,address)"),
  matched: eventTopic("Matched(uint256,address,address)"),
  settled: eventTopic("Settled(uint256,address,uint256)"),
  refunded: eventTopic("Refunded(uint256,address,uint256)"),
});

const topicAddress = (topic) => `0x${String(topic).slice(-40)}`.toLowerCase();
const wordAt = (data, index) => data.subarray(index * 32, index * 32 + 32);
const wordAddress = (data, index) => `0x${Buffer.from(wordAt(data, index)).toString("hex").slice(-40)}`;

/**
 * chain:      { genesisHash(), nativeToEthRatio(), watchContractEvents(contract, onBlock, {onError}) }
 * send:       { buttons(peerHex, text, rows), reference(peerHex, ref) }
 * usernameOf: async peerHex -> username or null (the People chain)
 */
export function createFlip({ chain, contract, send, usernameOf = async () => null, log = () => {}, now = Date.now, maxPeers = 10_000 }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(contract))) throw new Error("BOT_FLIP_CONTRACT must be a 20-byte 0x address");
  const address = String(contract).toLowerCase();
  const peers = new Map(); // player H160 -> peer account hex (no 0x)
  const settledRounds = new Set(); // dedupe across reorgs
  let stop = null;

  const remember = (peerHex) => {
    const peer = String(peerHex).replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(peer)) return null;
    const h160 = reviveAddress(`0x${peer}`);
    peers.delete(h160);
    peers.set(h160, peer);
    while (peers.size > maxPeers) peers.delete(peers.keys().next().value);
    return h160;
  };

  const stakeRows = async () => [[{
    label: `Stake ${formatPas(FLIP_STAKE_PLANCKS)}`,
    action: {
      tx: {
        version: 1,
        chainId: await chain.genesisHash(),
        calls: [{ kind: 1, to: address, data: flipCalldata.stake(), value: FLIP_STAKE_PLANCKS, ...reviveIntentLimits(FLIP_STAKE_WORST) }],
        display: {
          title: "Coin flip stake",
          description: "Stakes 0.5 PAS in a coin flip. The second staker triggers the flip; the winner takes 1 PAS.",
          amount: formatPas(FLIP_STAKE_PLANCKS).replace(/ PAS$/, ""),
          asset: "PAS",
        },
        dryRunRequired: true,
        expiresAt: now() + FLIP_INTENT_TTL_MS,
      },
    },
  }]];

  const offer = async (peerHex, on) => {
    remember(peerHex);
    await send.buttons(peerHex, FLIP_OFFER_TEXT, await stakeRows());
    log("BOT_FLIP_OFFERED", { peer: peerHex, on });
  };

  const nameOf = async (h160) => {
    const peer = peers.get(h160);
    if (peer) {
      try {
        const username = await usernameOf(peer);
        if (username) return username;
      } catch (error) { log("BOT_FLIP_USERNAME_FAILED", { peer, error: String(error?.message ?? error) }); }
    }
    return h160;
  };

  const onBlock = async ({ number, events }) => {
    const matched = new Map(); // round -> [player1, player2]
    for (const e of events) {
      const [topic0, ...indexed] = e.topics;
      if (topic0 === FLIP_TOPICS.staked) {
        const round = BigInt(indexed[0]);
        const player = topicAddress(indexed[1]);
        log("BOT_FLIP_STAKED", { round: String(round), player, peer: peers.get(player) ?? null, block: number, hash: e.extrinsicHash });
      } else if (topic0 === FLIP_TOPICS.matched) {
        matched.set(BigInt(indexed[0]), [wordAddress(e.data, 0), wordAddress(e.data, 1)]);
      } else if (topic0 === FLIP_TOPICS.refunded) {
        log("BOT_FLIP_REFUNDED", { round: String(BigInt(indexed[0])), player: topicAddress(indexed[1]), block: number, hash: e.extrinsicHash });
      } else if (topic0 === FLIP_TOPICS.settled) {
        const round = BigInt(indexed[0]);
        const key = String(round);
        if (settledRounds.has(key)) continue;
        settledRounds.add(key);
        while (settledRounds.size > 1024) settledRounds.delete(settledRounds.values().next().value);
        const winner = topicAddress(indexed[1]);
        const pot = decodeUint256(wordAt(e.data, 0)) / (await chain.nativeToEthRatio());
        const players = matched.get(round) ?? [winner];
        const note = `Flip settled: ${await nameOf(winner)} won ${formatPas(pot)}`;
        log("BOT_FLIP_SETTLED", { round: key, winner, players, pot: String(pot), block: number, hash: e.extrinsicHash });
        if (!e.extrinsicHash) { log("BOT_FLIP_NOTIFY_FAILED", { round: key, error: "no extrinsic hash" }); continue; }
        const chainId = await chain.genesisHash();
        for (const player of new Set(players)) {
          const peer = peers.get(player);
          if (!peer) { log("BOT_FLIP_UNKNOWN_PLAYER", { round: key, player }); continue; }
          try {
            await send.reference(peer, { chainId, hash: e.extrinsicHash, status: 1, block: number, note });
            log("BOT_FLIP_NOTIFIED", { round: key, peer, winner: player === winner });
          } catch (error) {
            log("BOT_FLIP_NOTIFY_FAILED", { round: key, peer, error: String(error?.message ?? error) });
          }
        }
      }
    }
  };

  return {
    remember,
    /** Accept, /stake, and any other message: answer with the stake button. Never throws. */
    async handle(peerHex, msg) {
      const on = msg?.kind === "text" && /^\s*\/stake\s*$/i.test(msg.text ?? "") ? "command" : msg?.kind === "accept" ? "accept" : "message";
      try { await offer(peerHex, on); }
      catch (error) { log("BOT_FLIP_OFFER_FAILED", { peer: peerHex, error: String(error?.message ?? error) }); }
      return true;
    },
    /** A peer's transactionReference: never trusted; only maps the peer's address. */
    onReference(peerHex, ref) {
      const h160 = remember(peerHex);
      log("BOT_FLIP_REFERENCE", { peer: peerHex, player: h160, status: ref?.status, hash: ref?.hash });
    },
    start() {
      stop ??= chain.watchContractEvents(address, onBlock, { onError: (error) => log("BOT_FLIP_WATCH_FAILED", { error: String(error?.message ?? error) }) });
      log("BOT_FLIP_WATCHING", { contract: address });
    },
    stop() { stop?.(); stop = null; },
    /** Test seam: feed one block as the watcher would. */
    onBlock,
  };
}
