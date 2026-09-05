// Store-node rules, checked over the wire with real signed statements.
//
// Every expectation here is a protocol fact a client relies on (see the
// header of lib/store-node.mjs for where each rule comes from), so a change
// that breaks one of these breaks what bot-core and the personas assume.
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createExpiry, getStatementSigner, statementCodec } from "@novasamatech/sdk-statement";
import { getPublicKey, secretFromSeed, sign } from "@scure/sr25519";
import { startStoreNode } from "../lib/store-node.mjs";

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const hex32 = (fill) => `0x${fill.repeat(2).slice(0, 2).repeat(32)}`;
const nowSecs = () => Math.floor(Date.now() / 1000);
// Expiry = expiration seconds << 32 | sequence; default one hour ahead.
const expiryIn = (secs, seq = 0) => createExpiry(nowSecs() + secs, seq);

function makeSigner(seedByte) {
  const secret = secretFromSeed(Uint8Array.from({ length: 32 }, () => seedByte));
  const publicKey = getPublicKey(secret);
  const signer = getStatementSigner(publicKey, "sr25519", async (data) => sign(secret, data));
  return { account: toHex(publicKey), signer, secret };
}

// Signed statement hex, the way a real client submits it.
async function signed(who, { channel, topics, expiry, data = new TextEncoder().encode("hi") }) {
  const stmt = await who.signer.sign({ expiry, channel, topics, data });
  return `0x${toHex(statementCodec.enc(stmt))}`;
}

const unsigned = ({ channel, topics, expiry }) =>
  `0x${toHex(statementCodec.enc({ expiry, channel, topics, data: new Uint8Array([1]) }))}`;

// Minimal JSON-RPC client: request/response plus a queue of subscription pages.
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const pages = [];
  const waiters = [];
  let nextId = 1;
  let closed = false;
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      return msg.error ? reject(Object.assign(new Error(msg.error.message), { code: msg.error.code })) : resolve(msg.result);
    }
    if (msg.method === "statement_subscribeStatement") {
      pages.push(msg.params);
      waiters.splice(0).forEach((w) => w());
    }
  });
  ws.on("close", () => { closed = true; waiters.splice(0).forEach((w) => w()); });
  const client = {
    ws,
    pages,
    get closed() { return closed; },
    call: (method, params = []) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    }),
    submit: (hex) => client.call("statement_submit", [hex]),
    subscribe: (filter = "any") => client.call("statement_subscribeStatement", [filter]),
    // Resolve once `count` pages have arrived, or fail after `timeoutMs`.
    waitPages: (count, timeoutMs = 3000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`only ${pages.length}/${count} pages after ${timeoutMs}ms`)), timeoutMs);
      const check = () => { if (pages.length >= count) { clearTimeout(timer); resolve(pages); } else waiters.push(check); };
      check();
    }),
    waitClosed: (timeoutMs = 3000) => new Promise((resolve, reject) => {
      if (closed) return resolve();
      const timer = setTimeout(() => reject(new Error("socket still open")), timeoutMs);
      waiters.push(() => { if (closed) { clearTimeout(timer); resolve(); } });
    }),
    close: () => ws.close(),
  };
  return new Promise((resolve, reject) => { ws.once("open", () => resolve(client)); ws.once("error", reject); });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alice = makeSigner(0x11);
const bob = makeSigner(0x22);
const CHANNEL = hex32("aa");
const TOPIC = hex32("0a");

async function withNode(options, fn) {
  const node = await startStoreNode(options);
  const clients = [];
  const open = async () => { const c = await connect(node.url); clients.push(c); return c; };
  try { await fn(node, open); }
  finally { clients.forEach((c) => c.close()); await node.close(); }
}

test("channel replacement: only a strictly greater expiry replaces; equal or lower is channelPriorityTooLow", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    const e = expiryIn(3600, 10);
    assert.deepEqual(await c.submit(await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: e })), { status: "new" });

    const lower = await c.submit(await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: e - 1n, data: new Uint8Array([2]) }));
    assert.deepEqual(lower, { status: "rejected", reason: "channelPriorityTooLow", submitted_expiry: Number(e - 1n), min_expiry: Number(e) });

    const equal = await c.submit(await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: e, data: new Uint8Array([3]) }));
    assert.equal(equal.reason, "channelPriorityTooLow", "an equal expiry must not replace (real node checks <=)");
    assert.equal(node.statements.length, 1);

    const higher = await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: e + 1n, data: new Uint8Array([4]) });
    assert.deepEqual(await c.submit(higher), { status: "new" });
    assert.equal(node.statements.length, 1, "one statement per (signer, channel)");
    assert.equal(node.list({ channel: CHANNEL })[0].replacedCount, 1);
    assert.equal(node.list({ channel: CHANNEL })[0].expiry, e + 1n);

    assert.deepEqual(await c.submit(higher), { status: "known" }, "resubmitting the stored statement is known, not a rejection");

    // Another signer on the same channel value is a different slot.
    assert.deepEqual(await c.submit(await signed(bob, { channel: CHANNEL, topics: [TOPIC], expiry: e })), { status: "new" });
    assert.equal(node.statements.length, 2);
  }));

test("noAllowance: a signer outside the allowance set is rejected; null allows everyone", () =>
  withNode({ allowances: new Set([alice.account]) }, async (node, open) => {
    const c = await open();
    assert.deepEqual(await c.submit(await signed(bob, { channel: hex32("bb"), topics: [TOPIC], expiry: expiryIn(60) })), { status: "rejected", reason: "noAllowance" });
    assert.deepEqual(await c.submit(await signed(alice, { channel: hex32("bb"), topics: [TOPIC], expiry: expiryIn(60) })), { status: "new" });
    node.allowances.add(`0x${bob.account}`); // 0x-prefixed entries count too
    assert.deepEqual(await c.submit(await signed(bob, { channel: hex32("bc"), topics: [TOPIC], expiry: expiryIn(60) })), { status: "new" });
    node.allowances = null;
    const carol = makeSigner(0x33);
    assert.deepEqual(await c.submit(await signed(carol, { channel: hex32("bd"), topics: [TOPIC], expiry: expiryIn(60) })), { status: "new" });
  }));

test("accountFull: a full account evicts its lowest expiry only for a higher newcomer", () =>
  withNode({ maxCountPerAccount: 2 }, async (node, open) => {
    const c = await open();
    const [e1, e2] = [expiryIn(3600, 1), expiryIn(3600, 2)];
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: e1 }));
    await c.submit(await signed(alice, { channel: hex32("02"), topics: [TOPIC], expiry: e2 }));

    const tooLow = await c.submit(await signed(alice, { channel: hex32("03"), topics: [TOPIC], expiry: e1 }));
    assert.deepEqual(tooLow, { status: "rejected", reason: "accountFull", submitted_expiry: Number(e1), min_expiry: Number(e1) });
    assert.equal(node.list({ signer: alice.account }).length, 2);

    const e3 = expiryIn(3600, 3);
    assert.deepEqual(await c.submit(await signed(alice, { channel: hex32("03"), topics: [TOPIC], expiry: e3 })), { status: "new" });
    const kept = node.list({ signer: alice.account }).map((s) => s.expiry).sort();
    assert.deepEqual(kept, [e2, e3].sort(), "the lowest expiry was evicted to make room");

    // Replacing on a channel does not need extra room: the slot is reused.
    assert.deepEqual(await c.submit(await signed(alice, { channel: hex32("03"), topics: [TOPIC], expiry: e3 + 1n })), { status: "new" });
    assert.equal(node.list({ signer: alice.account }).length, 2);

    // Other accounts are not affected by alice being full.
    assert.deepEqual(await c.submit(await signed(bob, { channel: hex32("04"), topics: [TOPIC], expiry: e1 })), { status: "new" });
  }));

test("initial dumps are paged with a correct remaining count; live pushes carry none", () =>
  withNode({ pageSize: 2 }, async (node, open) => {
    const writer = await open();
    for (let i = 0; i < 5; i += 1) {
      await writer.submit(await signed(alice, { channel: hex32(`0${i}`), topics: [TOPIC], expiry: expiryIn(3600, i) }));
    }
    const reader = await open();
    const subId = await reader.subscribe({ matchAny: [TOPIC] });
    const pages = await reader.waitPages(3);
    assert.deepEqual(pages.map((p) => [p.subscription, p.result.data.statements.length, p.result.data.remaining]),
      [[subId, 2, 3], [subId, 2, 1], [subId, 1, 0]]);
    const dumped = pages.flatMap((p) => p.result.data.statements);
    assert.deepEqual(dumped, node.statements.map((s) => s.hex), "every stored statement is dumped exactly once, in store order");

    await writer.submit(await signed(bob, { channel: hex32("09"), topics: [TOPIC], expiry: expiryIn(3600) }));
    const [push] = (await reader.waitPages(4)).slice(3);
    assert.equal(push.result.data.statements.length, 1);
    assert.equal("remaining" in push.result.data, false, "live pushes have no remaining, like the real node");

    // Nothing matching: still one empty page, so pollers waiting on a page complete.
    const other = await open();
    await other.subscribe({ matchAll: [hex32("ff")] });
    const [empty] = await other.waitPages(1);
    assert.deepEqual(empty.result.data, { statements: [], remaining: 0 });
  }));

test("list() filters by topic, signer and channel and never needs a key", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    const before = Date.now();
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC, hex32("0b")], expiry: expiryIn(3600, 7) }));
    await c.submit(await signed(bob, { channel: hex32("02"), topics: [hex32("0b")], expiry: expiryIn(3600, 8) }));

    assert.equal(node.list().length, 2);
    assert.equal(node.list({ topic: TOPIC }).length, 1);
    assert.equal(node.list({ topic: hex32("0b") }).length, 2);
    assert.equal(node.list({ signer: `0x${bob.account}` }).length, 1);
    assert.equal(node.list({ channel: hex32("02") })[0].signer, bob.account);

    const [entry] = node.list({ signer: alice.account });
    assert.deepEqual(Object.keys(entry).sort(), ["channel", "expiry", "hex", "receivedAt", "replacedCount", "signer", "topics"]);
    assert.equal(entry.channel, "01".repeat(32));
    assert.deepEqual(entry.topics, ["0a".repeat(32), "0b".repeat(32)]);
    assert.equal(typeof entry.expiry, "bigint");
    assert.ok(entry.receivedAt >= before && entry.receivedAt <= Date.now());
    assert.equal(entry.replacedCount, 0);
    entry.topics.push("tamper");
    assert.equal(node.list({ signer: alice.account })[0].topics.length, 2, "list() hands out copies");
  }));

test("invalid submits: no proof, bad proof, already expired, undecodable", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    assert.deepEqual(await c.submit(unsigned({ channel: CHANNEL, topics: [TOPIC], expiry: expiryIn(60) })), { status: "invalid", reason: "noProof" });

    // Signed with alice's key but claiming bob's account: the signature does
    // not verify for the signer it names.
    const impostor = { signer: getStatementSigner(hexToBytes(bob.account), "sr25519", async (data) => sign(alice.secret, data)) };
    assert.deepEqual(await c.submit(await signed(impostor, { channel: CHANNEL, topics: [TOPIC], expiry: expiryIn(60) })), { status: "invalid", reason: "badProof" });
    // A valid signature over different bytes: the data was changed after signing.
    const tampered = statementCodec.dec(await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: expiryIn(60) }));
    tampered.data = new TextEncoder().encode("hj");
    assert.deepEqual(await c.submit(`0x${toHex(statementCodec.enc(tampered))}`), { status: "invalid", reason: "badProof" });
    // A signer the node cannot verify at all (not a ristretto point) is a bad proof, not a crash.
    const garbageSigner = { signer: getStatementSigner(new Uint8Array(32).fill(1), "sr25519", async (data) => sign(alice.secret, data)) };
    assert.deepEqual(await c.submit(await signed(garbageSigner, { channel: CHANNEL, topics: [TOPIC], expiry: expiryIn(60) })), { status: "invalid", reason: "badProof" });
    assert.deepEqual(await c.submit(await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: expiryIn(-1) })), { status: "invalid", reason: "alreadyExpired" });
    assert.deepEqual(await c.submit(await signed(alice, { channel: CHANNEL, topics: [TOPIC], expiry: createExpiry(nowSecs()) })), { status: "invalid", reason: "alreadyExpired" });
    await assert.rejects(c.submit("0xdeadbeef"), (e) => e.code === 7001 && /Statement store error/.test(e.message));
    assert.equal(node.statements.length, 0);
  }));

test("watch(): stored and refused events carry signer, channel and replacement", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    const events = [];
    const stop = node.watch((e) => events.push(e));
    const e = expiryIn(3600, 1);
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: e }));
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: e + 1n, data: new Uint8Array([2]) }));
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: e, data: new Uint8Array([3]) }));
    assert.deepEqual(events.map((x) => [x.event, x.replaced ?? x.reason]), [["stored", false], ["stored", true], ["refused", "channelPriorityTooLow"]]);
    assert.equal(events[0].signer, alice.account);
    assert.equal(events[0].channel, "01".repeat(32));
    stop();
    await c.submit(await signed(alice, { channel: hex32("02"), topics: [TOPIC], expiry: e }));
    assert.equal(events.length, 3, "a stopped watcher gets nothing more");
  }));

test("fault drop: matching submits are answered new but never stored, for count hits", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    const fault = node.faults.drop({ signer: alice.account, count: 1 });
    assert.deepEqual(node.faults.list(), [{ id: fault.id, kind: "drop", signer: alice.account, channel: null, count: 1, hits: 0, held: 0 }]);

    assert.deepEqual(await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(60) })), { status: "new" });
    assert.equal(node.statements.length, 0, "dropped");
    assert.deepEqual(node.faults.list(), [], "a spent fault disappears");

    assert.deepEqual(await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(60) })), { status: "new" });
    assert.equal(node.statements.length, 1);

    // Rules still apply before the drop: a rejected statement is rejected, not "dropped".
    node.faults.drop({ channel: hex32("01"), count: 5 });
    const rejected = await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(30) }));
    assert.equal(rejected.reason, "channelPriorityTooLow");
    assert.equal(node.faults.list()[0].hits, 0);
    node.faults.clear();
    assert.deepEqual(node.faults.list(), []);
  }));

test("fault delay: the submit is stored and answered only after ms", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    const fault = node.faults.delay({ channel: hex32("01"), ms: 300 });
    const started = Date.now();
    const done = c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(60) }));
    await sleep(100);
    assert.equal(node.statements.length, 0, "not stored yet");
    assert.deepEqual(await done, { status: "new" });
    assert.ok(Date.now() - started >= 290, `answered after ${Date.now() - started}ms`);
    assert.equal(node.statements.length, 1);

    // Non-matching channel is not delayed.
    const quick = Date.now();
    await c.submit(await signed(alice, { channel: hex32("02"), topics: [TOPIC], expiry: expiryIn(60) }));
    assert.ok(Date.now() - quick < 200);
    assert.equal(node.faults.list()[0].hits, 1);
    fault.clear();
    assert.deepEqual(node.faults.list(), []);
  }));

test("fault holdDump: a matching subscription gets nothing until released", () =>
  withNode({}, async (node, open) => {
    const writer = await open();
    await writer.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(60) }));
    const hold = node.faults.holdDump({ topic: TOPIC });

    const held = await open();
    const subId = await held.subscribe({ matchAny: [TOPIC] });
    assert.equal(typeof subId, "string", "subscribing itself succeeds");
    await writer.submit(await signed(bob, { channel: hex32("02"), topics: [TOPIC], expiry: expiryIn(60) }));
    await sleep(200);
    assert.equal(held.pages.length, 0, "no dump and no push while held");
    assert.equal(node.faults.list()[0].held, 1);

    const unrelated = await open();
    await unrelated.subscribe({ matchAny: [hex32("0c")] });
    await unrelated.waitPages(1);

    hold.release();
    const pages = await held.waitPages(1);
    assert.equal(pages[0].result.data.statements.length, 2, "the dump reflects the store at release time");
    await writer.submit(await signed(alice, { channel: hex32("03"), topics: [TOPIC], expiry: expiryIn(60) }));
    await held.waitPages(2);
    assert.deepEqual(node.faults.list(), []);
  }));

test("clock offset: expiry checks follow the node clock, stored statements expire", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(3600) }));
    assert.equal(node.list().length, 1);

    node.clock.offsetMs = 2 * 3600 * 1000;
    assert.equal(node.list().length, 0, "expired under the moved clock");
    const late = await c.submit(await signed(alice, { channel: hex32("02"), topics: [TOPIC], expiry: expiryIn(3600) }));
    assert.deepEqual(late, { status: "invalid", reason: "alreadyExpired" });
    assert.deepEqual(await c.submit(await signed(alice, { channel: hex32("02"), topics: [TOPIC], expiry: expiryIn(3 * 3600) })), { status: "new" });

    const reader = await open();
    await reader.subscribe("any");
    const [page] = await reader.waitPages(1);
    assert.equal(page.result.data.statements.length, 1, "dumps skip expired statements");
    node.clock.offsetMs = 0;
  }));

test("restart drops every connection and keeps the store; reset wipes it", () =>
  withNode({}, async (node, open) => {
    const c = await open();
    await c.submit(await signed(alice, { channel: hex32("01"), topics: [TOPIC], expiry: expiryIn(60) }));
    node.restart();
    await c.waitClosed();
    assert.equal(node.statements.length, 1, "a restart is not a wipe");

    const again = await open();
    await again.subscribe("any");
    const [page] = await again.waitPages(1);
    assert.equal(page.result.data.statements.length, 1);
    assert.equal(again.closed, false);

    node.reset();
    await again.waitClosed();
    assert.equal(node.statements.length, 0);
    const fresh = await open();
    await fresh.subscribe("any");
    const [empty] = await fresh.waitPages(1);
    assert.deepEqual(empty.result.data, { statements: [], remaining: 0 });
  }));
