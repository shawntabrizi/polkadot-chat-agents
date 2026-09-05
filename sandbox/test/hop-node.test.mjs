// The HOP node's rules, pinned to the chat spec (base-spec.md "HOP
// Protocol"): signed submits behind a Bulletin allowance, recipient-signed
// claims and acks, the one-shot removal after every recipient acked, the
// size caps, both parameter dialects, and every fault hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sign } from "@scure/sr25519";
import WebSocket from "ws";

import { bytesToHex } from "../lib/bytes.mjs";
import { HOP_ERRORS, HOP_MAX_ENTRY_BYTES, startHopNode } from "../lib/hop-node.mjs";
import { hash256, mintBulletinSigner, openHop, payloads, sr25519Multi, ticketKeys } from "../lib/hop.mjs";

const hex = bytesToHex;
const withNode = async (t, options = {}) => {
  const node = await startHopNode(options);
  t.after(() => node.close());
  const rpc = await openHop(node.url);
  t.after(() => rpc.close());
  return { node, rpc };
};
const code = async (promise) => {
  try { await promise; return null; } catch (e) { return e.code ?? e.message; }
};
// A submit as the spec writes it: positional, signed over the domain-separated payload.
const submitParams = (signer, blob, recipients, timestamp = Date.now()) => [
  hex(blob), recipients.map((r) => hex(sr25519Multi(r))), hex(sr25519Multi(signer.sign(payloads.submit(blob, timestamp)))), hex(sr25519Multi(signer.publicKey)), timestamp,
];
const claimParams = (keys, blob, payload = payloads.claim) => [hex(hash256(blob)), hex(sr25519Multi(sign(keys.secret, payload(hash256(blob)))))];

test("hop_submit: a signed entry from an allowed account is stored; the allowance, the proof and the caps are checked", async (t) => {
  const allowances = new Set();
  const { node, rpc } = await withNode(t, { allowances, maxPoolBytes: 3_000_000 });
  const alice = mintBulletinSigner();
  const mallory = mintBulletinSigner();
  const ticket = new Uint8Array(crypto.randomBytes(32));
  const keys = ticketKeys(ticket);
  const blob = new Uint8Array(crypto.randomBytes(1000));

  assert.equal(await code(rpc.call("hop_submit", submitParams(alice, blob, [keys.publicKey]))), HOP_ERRORS.NotAuthorized, "no Bulletin allowance yet");
  allowances.add(alice.account);
  const forged = submitParams(alice, blob, [keys.publicKey]);
  forged[2] = hex(sr25519Multi(mallory.sign(payloads.submit(blob, forged[4]))));
  assert.equal(await code(rpc.call("hop_submit", forged)), HOP_ERRORS.InvalidSignature, "a proof by another key");
  assert.equal(await code(rpc.call("hop_submit", submitParams(alice, blob, [keys.publicKey], Date.now() - 3_600_000))), HOP_ERRORS.InvalidSignature, "a stale timestamp");
  assert.equal(await code(rpc.call("hop_submit", submitParams(alice, new Uint8Array(crypto.randomBytes(HOP_MAX_ENTRY_BYTES + 1)), [keys.publicKey]))), HOP_ERRORS.DataTooLarge, "over the 2 MB chunk");
  const result = await rpc.call("hop_submit", submitParams(alice, blob, [keys.publicKey]));
  assert.deepEqual(result.poolStatus, { entryCount: 1, totalBytes: 1000, maxBytes: 3_000_000 });
  assert.equal(await code(rpc.call("hop_submit", submitParams(alice, new Uint8Array(crypto.randomBytes(2_000_000)), [keys.publicKey]))), null, "fits");
  assert.equal(await code(rpc.call("hop_submit", submitParams(alice, new Uint8Array(crypto.randomBytes(1_500_000)), [keys.publicKey]))), HOP_ERRORS.PoolFull, "the pool is bounded");
  const [entry] = node.list();
  assert.deepEqual([entry.hash, entry.bytes, entry.signer, entry.recipients, entry.claims, entry.acked, entry.available], [hex(hash256(blob)), 1000, alice.account, 1, 0, false, true]);
  assert.deepEqual(node.submissions.map((s) => s.signer), [alice.account, alice.account]);
});

test("hop_claim and hop_ack: recipient-signed, read-only until every recipient acked, then the entry is gone", async (t) => {
  const { node, rpc } = await withNode(t);
  const events = [];
  node.watch((e) => events.push(e));
  const signer = mintBulletinSigner();
  const keys = ticketKeys(new Uint8Array(crypto.randomBytes(32)));
  const other = ticketKeys(new Uint8Array(crypto.randomBytes(32)));
  const blob = new Uint8Array(crypto.randomBytes(500));
  await rpc.call("hop_submit", submitParams(signer, blob, [keys.publicKey]));

  assert.equal(await code(rpc.call("hop_claim", claimParams(other, blob))), HOP_ERRORS.NotRecipient, "the ticket's key is the only recipient");
  assert.equal(await code(rpc.call("hop_claim", claimParams(keys, blob, payloads.ack))), HOP_ERRORS.NotRecipient, "an ack signature is not a claim signature (domain separation)");
  assert.equal(await rpc.call("hop_claim", claimParams(keys, blob)), hex(blob));
  assert.equal(await rpc.call("hop_claim", claimParams(keys, blob)), hex(blob), "a claim is read-only: it can repeat");
  assert.equal(node.list()[0].claims, 2);
  assert.equal(await rpc.call("hop_ack", claimParams(keys, blob, payloads.ack)), null);
  assert.equal(await code(rpc.call("hop_claim", claimParams(keys, blob))), HOP_ERRORS.NotFound, "every recipient acked: the bytes are gone (one-shot for a single ticket)");
  assert.equal(await code(rpc.call("hop_ack", claimParams(keys, blob, payloads.ack))), HOP_ERRORS.NotFound, "an ack after removal is NotFound, benign for clients");
  assert.deepEqual([node.list()[0].acked, node.list()[0].available, node.list()[0].reason], [true, false, "acked"]);
  assert.equal(node.acked.has(hex(hash256(blob))), true);
  assert.deepEqual(events.map((e) => e.event), ["submitted", "refused", "refused", "claimed", "claimed", "acked", "removed", "refused", "refused"]);
  assert.equal((await rpc.call("hop_poolStatus", [])).entryCount, 0);
});

test("bot-core's by-name params run the same checks as the spec's positional ones", async (t) => {
  const allowances = new Set();
  const { node, rpc } = await withNode(t, { allowances });
  const signer = mintBulletinSigner();
  allowances.add(signer.account);
  const keys = ticketKeys(new Uint8Array(crypto.randomBytes(32)));
  const blob = new Uint8Array(crypto.randomBytes(64));
  const timestamp = Date.now();
  const named = { data: hex(blob), recipients: [hex(sr25519Multi(keys.publicKey))], signature: hex(sr25519Multi(signer.sign(payloads.submit(blob, timestamp)))), signer: hex(sr25519Multi(signer.publicKey)), submit_timestamp: timestamp };
  assert.equal(await code(rpc.call("hop_submit", { ...named, signer: hex(sr25519Multi(mintBulletinSigner().publicKey)) })), HOP_ERRORS.InvalidSignature);
  assert.equal(await code(rpc.call("hop_submit", named)), null);
  const [rawHash, signature] = claimParams(keys, blob);
  assert.equal(await rpc.call("hop_claim", { raw_hash: rawHash, signature }), hex(blob));
  assert.deepEqual(node.rpcCalls.map((c) => c.positional), [false, false, false]);
});

test("faults: refuse, drop, corrupt, delay and cut hit a claim once each and are events", async (t) => {
  const { node, rpc } = await withNode(t);
  const signer = mintBulletinSigner();
  const keys = ticketKeys(new Uint8Array(crypto.randomBytes(32)));
  const blob = new Uint8Array(crypto.randomBytes(300));
  await rpc.call("hop_submit", submitParams(signer, blob, [keys.publicKey]));
  const hash = hex(hash256(blob));
  const events = [];
  node.watch((e) => { if (e.event === "fault") events.push(`${e.action}:${e.kind}`); });

  node.faults.refuse({ hash });
  assert.equal(await code(rpc.call("hop_claim", claimParams(keys, blob))), HOP_ERRORS.RateLimited, "refused once");
  assert.equal(await rpc.call("hop_claim", claimParams(keys, blob)), hex(blob), "then served");
  node.faults.drop({ hash });
  assert.equal(await code(rpc.call("hop_claim", claimParams(keys, blob))), HOP_ERRORS.NotFound, "told the entry is gone");
  assert.equal(node.list()[0].available, true, "but it is not");
  node.faults.corrupt({ hash });
  const served = await rpc.call("hop_claim", claimParams(keys, blob));
  assert.notEqual(served, hex(blob), "one byte flipped");
  assert.equal(served.length, hex(blob).length);
  node.faults.delay({ ms: 300, hash });
  const started = Date.now();
  assert.equal(await rpc.call("hop_claim", claimParams(keys, blob)), hex(blob));
  assert.ok(Date.now() - started >= 280, "answered after the delay");
  const forever = node.faults.refuse({ method: "ack", count: null });
  assert.equal(await code(rpc.call("hop_ack", claimParams(keys, blob, payloads.ack))), HOP_ERRORS.RateLimited);
  assert.equal(await code(rpc.call("hop_ack", claimParams(keys, blob, payloads.ack))), HOP_ERRORS.RateLimited, "count null: until cleared");
  assert.equal(node.faults.list().length, 1);
  forever.clear();
  assert.equal(node.faults.list().length, 0);
  node.faults.cut({ count: 1 });
  assert.match(await code(rpc.call("hop_claim", claimParams(keys, blob))), /connection closed/, "the socket was terminated");
  assert.deepEqual(events, ["set:refuse", "hit:refuse", "set:drop", "hit:drop", "set:corrupt", "hit:corrupt", "set:delay", "hit:delay", "set:refuse", "hit:refuse", "hit:refuse", "cleared:refuse", "set:cut", "hit:cut"]);
});

test("a frame over the cap closes the socket; putFile stores a fixture without a signer", async (t) => {
  const node = await startHopNode({ maxFrameBytes: 2048 });
  t.after(() => node.close());
  const ws = new WebSocket(node.url);
  await new Promise((r) => ws.once("open", r));
  const closed = new Promise((r) => ws.once("close", (c) => r(c)));
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hop_claim", params: ["0x" + "ab".repeat(2000), "0x00"] }));
  assert.equal(await closed, 1009, "message too big");
  const file = node.putFile(new Uint8Array(crypto.randomBytes(3_000_000)));
  assert.equal(file.identifier.length, 32);
  assert.equal(node.list().length, 3, "two chunks and the metadata");
  assert.equal(node.list().every((e) => e.signer === null), true);
});
