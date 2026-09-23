import { test } from "node:test";
import assert from "node:assert/strict";
import { createFaucet, faucetPairFromPath } from "../lib/faucet.mjs";

const PAS = 10_000_000_000n;
const GENESIS = `0x${"d6".repeat(32)}`;
const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ALICE_HEX = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const BOB_HEX = "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48";
const PEER = "ab".repeat(32);

const setup = ({ fail = null } = {}) => {
  let clock = 1_000_000;
  const transfers = [];
  const sent = [];
  const logs = [];
  const pair = { publicKey: new Uint8Array(32).fill(1) };
  const chain = {
    genesisHash: async () => GENESIS,
    async transfer(p, { to, amount }) {
      transfers.push({ pair: p, to: `0x${Buffer.from(to).toString("hex")}`, amount });
      if (fail === "throw") throw new Error("socket down");
      if (fail === "dispatch") return { ok: false, hash: `0x${"ee".repeat(32)}`, block: 5, error: "Balances.InsufficientBalance" };
      return { ok: true, hash: `0x${"cd".repeat(32)}`, block: 77 };
    },
  };
  const faucet = createFaucet({
    chain, pair, now: () => clock, cooldownMs: 10 * 60_000, // the test keeps the optional cooldown on
    send: {
      text: async (peer, text) => { sent.push({ type: "text", text }); },
      reference: async (peer, ref) => { sent.push({ type: "reference", ref }); },
    },
    log: (event, extra) => logs.push({ event, ...extra }),
  });
  const drip = (arg) => faucet.handle(PEER, { kind: "text", text: `/drip ${arg}` });
  return { faucet, drip, transfers, sent, logs, pair, tick: (ms) => { clock += ms; } };
};

test("/drip sends 1 PAS from the faucet key and posts a reference", async () => {
  const { drip, transfers, sent, pair } = setup();
  assert.equal(await drip(ALICE_SS58), true);
  assert.deepEqual(transfers, [{ pair, to: ALICE_HEX, amount: PAS }]);
  assert.deepEqual(sent, [{ type: "reference", ref: { chainId: GENESIS, hash: `0x${"cd".repeat(32)}`, status: 1, block: 77, note: "Dripped 1 PAS" } }]);
});

// The faucet is public: without a limit one user drains it in a loop.
test("one drip per account per 10 minutes, whatever form the address takes", async () => {
  const { drip, transfers, sent, tick } = setup();
  await drip(ALICE_SS58);
  await drip(ALICE_HEX);
  assert.equal(transfers.length, 1, "the 0x form of the same account is the same account");
  assert.match(sent[1].text, /Try again in 10 min/);
  await drip(BOB_HEX);
  assert.equal(transfers.length, 2, "another account is not limited");
  tick(10 * 60_000);
  await drip(ALICE_SS58);
  assert.equal(transfers.length, 3, "the limit ends after 10 minutes");
});

test("a failed transfer does not use up the account's drip", async () => {
  for (const fail of ["throw", "dispatch"]) {
    const { drip, transfers, sent } = setup({ fail });
    await drip(ALICE_SS58);
    await drip(ALICE_SS58);
    assert.equal(transfers.length, 2, `${fail}: the retry is allowed`);
    if (fail === "dispatch") assert.equal(sent[0].ref.status, 3);
    else assert.equal(sent[0].type, "text");
  }
});

test("usage, bad addresses and other messages", async () => {
  const { faucet, drip, transfers, sent } = setup();
  assert.equal(await faucet.handle(PEER, { kind: "text", text: "/drip" }), true);
  assert.match(sent[0].text, /\/drip <your address>/);
  assert.equal(await drip("not-an-address"), true);
  assert.equal(await drip("0x1234"), true);
  assert.equal(transfers.length, 0);
  assert.equal(await faucet.handle(PEER, { kind: "text", text: "hello" }), false, "not a command: the brain answers");
  assert.equal(await faucet.handle(PEER, { kind: "text", text: "/dripping" }), false);
});

// Only the public dev phrase can back the faucet: a phrase or seed in
// BOT_FAUCET_KEY would put a real key behind a public command.
test("BOT_FAUCET_KEY is a derivation path of the public dev phrase only", () => {
  assert.equal(`0x${Buffer.from(faucetPairFromPath("//Alice").publicKey).toString("hex")}`, ALICE_HEX);
  assert.throws(() => faucetPairFromPath("bottom drive obey lake curtain smoke basket hold race lonely fit walk"), /derivation path/);
  assert.throws(() => faucetPairFromPath(`0x${"11".repeat(32)}`), /derivation path/);
  assert.throws(() => faucetPairFromPath(""), /derivation path/);
});
