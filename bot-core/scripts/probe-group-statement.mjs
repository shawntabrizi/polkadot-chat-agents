#!/usr/bin/env node
// Spec 0011 adapter check (M16, "first check, before any code"): can bot-core's
// Statement Store path submit a statement with a CHOSEN topic1, channel and
// expiry, and subscribe with matchAny over extra topics, against a live People
// chain RPC? Uses only what index.mjs uses: the vendored submitAppStatement
// (statement_submit over the lazy client's request fn), the SDK adapter's
// queryStatements, and the vendored raw page subscriber
// (statement_subscribeStatement). Prints one line per check and PROBE_OK.
//
// Usage: BOT_SEED_HEX=0x… node scripts/probe-group-statement.mjs [--endpoint wss://…]
// The seed must belong to a registered identity (it needs a statement allowance).
import crypto from "node:crypto";
import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";
import { submitAppStatement, scaleEncodeBytes } from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { createRawStatementPageSubscriber } from "../vendor/lib/statement-ingress-supervisor.mjs";
import { PRODUCTS_DEVNET } from "../lib/network-config.mjs";
import { groupExpiryFactory } from "../lib/group-keys.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const endpoint = arg("endpoint") ?? PRODUCTS_DEVNET.peopleEndpoints[0];
const seedHex = (process.env.BOT_SEED_HEX ?? "").trim().replace(/^0x/i, "");
if (seedHex.length !== 64) { console.error("BOT_SEED_HEX (a registered identity's 32-byte seed) is required"); process.exit(2); }
// The decoded statement carries topics, channel and data as 0x-hex strings;
// the local values are bytes.
const hex = (b) => (typeof b === "string" ? b.replace(/^0x/i, "").toLowerCase() : Buffer.from(b).toString("hex"));
const wallet = deriveSr25519PairFromSeed(Uint8Array.from(Buffer.from(seedHex, "hex")), "//wallet");

const lazy = createLazyClient(getWsProvider([endpoint]));
const store = createPapiStatementStoreAdapter(lazy);
const topic = new Uint8Array(crypto.randomBytes(32));
const other = new Uint8Array(crypto.randomBytes(32)); // a second topic in the same matchAny
const channel = new Uint8Array(crypto.randomBytes(32));
const expiryFactory = groupExpiryFactory();
const data = new TextEncoder().encode(`m16-probe ${new Date().toISOString()}`);
let submittedExpiry = null;

const seen = new Promise((resolve, reject) => {
  const subscribe = createRawStatementPageSubscriber({ getClient: () => lazy.getClient() });
  const timer = setTimeout(() => reject(new Error("no statement by subscription within 60 s")), 60_000);
  const stop = subscribe({ matchAny: [other, topic] }, (page) => {
    if (process.env.PROBE_DEBUG) console.log("PAGE", page.rawStatementCount, page.decodeErrorCount, page.statements.map((x) => (x.topics ?? []).map(String)));
    for (const st of page.statements ?? []) {
      if (!(st.topics ?? []).some((t) => hex(t) === hex(topic))) continue;
      clearTimeout(timer); stop?.(); resolve(st);
    }
  }, reject);
});

const result = await submitAppStatement(lazy.getRequestFn(), {
  walletPair: wallet,
  channel,
  topics: [topic],
  scaleEncodedPayload: scaleEncodeBytes(data),
  expiryFactory: (attempt) => (submittedExpiry = expiryFactory(attempt)),
});
console.log(`SUBMIT_OK status=${result.result?.status ?? "ok"} bytes=${result.encodedBytes} expiry=0x${submittedExpiry.toString(16)} (expiration ${new Date(Number(submittedExpiry >> 32n) * 1000).toISOString()})`);

const st = await seen;
const expiry = BigInt(st.expiry);
const checks = {
  topic1: hex(st.topics[0]) === hex(topic),
  channel: hex(st.channel) === hex(channel),
  expiry: expiry === submittedExpiry,
  signer: hex(st.proof?.value?.signer ?? []) === hex(wallet.publicKey),
  data: hex(st.data) === hex(data),
};
console.log(`SUBSCRIBE_MATCHANY_OK ${Object.entries(checks).map(([k, v]) => `${k}=${v}`).join(" ")}`);

const queried = await store.queryStatements({ matchAny: [other, topic] }).match((x) => x, (e) => { throw e; });
const q = queried.find((s) => hex(s.topics?.[0] ?? []) === hex(topic));
console.log(`QUERY_MATCHANY_OK found=${Boolean(q)} channel=${q ? hex(q.channel) === hex(channel) : false}`);

// A replacement on the same channel with a higher expiry wins (one slot per
// account and channel): what a member's next carrier relies on.
await submitAppStatement(lazy.getRequestFn(), {
  walletPair: wallet, channel, topics: [topic],
  scaleEncodedPayload: scaleEncodeBytes(new TextEncoder().encode("m16-probe replacement")),
  expiryFactory,
});
const after = await store.queryStatements({ matchAll: [topic] }).match((x) => x, (e) => { throw e; });
console.log(`REPLACE_OK statementsOnChannel=${after.filter((s) => hex(s.channel) === hex(channel)).length} data="${Buffer.from(hex(after[0]?.data ?? ""), "hex").toString("utf8")}"`);

const ok = Object.values(checks).every(Boolean) && q && after.length === 1;
console.log(ok ? "PROBE_OK" : "PROBE_FAILED");
lazy.getClient().destroy?.();
process.exit(ok ? 0 : 1);
