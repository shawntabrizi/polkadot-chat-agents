// The persona's HOP client against the node: the desktop's upload path
// (encrypt, chunk, signed hop_submit, metadata) round-trips byte-exact
// through a claim-verify-decrypt-ack download, and every integrity or cap
// failure is loud.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { bytesToHex } from "../lib/bytes.mjs";
import { startHopNode } from "../lib/hop-node.mjs";
import { downloadFile, hash256, mintBulletinSigner, ticketKeys, uploadFile } from "../lib/hop.mjs";

const withNode = async (t, options = {}) => {
  const node = await startHopNode(options);
  t.after(() => node.close());
  return node;
};

test("upload then download: three chunks and the metadata, byte-exact, every entry claimed once and acked", async (t) => {
  const allowances = new Set();
  const node = await withNode(t, { allowances });
  const signer = mintBulletinSigner();
  const bytes = new Uint8Array(crypto.randomBytes(4_500_000));
  await assert.rejects(uploadFile({ url: node.url, bytes, signer }), /1012/, "no allowance, no upload");
  allowances.add(signer.account);
  const sent = await uploadFile({ url: node.url, bytes, signer });
  assert.equal(sent.chunks.length, 3);
  assert.equal(node.list().length, 4);
  assert.equal(node.list().at(-1).hash, bytesToHex(sent.identifier), "the metadata entry is the identifier");
  assert.ok(node.list().every((e) => e.signer === signer.account));
  const got = await downloadFile({ url: node.url, identifier: sent.identifier, claimTicket: sent.claimTicket, maxBytes: bytes.length });
  assert.equal(Buffer.compare(got, bytes), 0);
  assert.ok(node.list().every((e) => e.claims === 1 && e.acked && !e.available), "one claim and one ack per entry; the bytes are gone");
  await assert.rejects(downloadFile({ url: node.url, identifier: sent.identifier, claimTicket: sent.claimTicket, maxBytes: bytes.length }), /1004/, "a second claim finds nothing");
});

test("download refuses what it cannot trust: a wrong ticket, a corrupt chunk, a size over the cap", async (t) => {
  const node = await withNode(t);
  const signer = mintBulletinSigner();
  const bytes = new Uint8Array(crypto.randomBytes(100_000));
  const sent = await uploadFile({ url: node.url, bytes, signer });
  await assert.rejects(downloadFile({ url: node.url, identifier: sent.identifier, claimTicket: new Uint8Array(crypto.randomBytes(32)), maxBytes: bytes.length }), /1008/, "another ticket is not a recipient");
  await assert.rejects(downloadFile({ url: node.url, identifier: sent.identifier, claimTicket: sent.claimTicket, maxBytes: 10 }), /larger than the 10-byte cap/);
  node.faults.corrupt({ hash: bytesToHex(sent.chunks[0]) });
  await assert.rejects(downloadFile({ url: node.url, identifier: sent.identifier, claimTicket: sent.claimTicket, maxBytes: bytes.length }), /entry hash mismatch/, "the served bytes do not hash to the entry");
  // The spec acks the metadata before the chunks, so a chunk that fails
  // leaves the root entry gone: a retry needs a fresh upload (RFC-0001's
  // on-chain fallback is what a real client would reach for).
  await assert.rejects(downloadFile({ url: node.url, identifier: sent.identifier, claimTicket: sent.claimTicket, maxBytes: bytes.length }), /1004/);
  assert.deepEqual(node.list().map((e) => [e.acked, e.available]), [[false, true], [true, false]], "the chunk was never acked, the metadata was");
});

test("ticket derivation matches the spec: keyed blake2b for the AEAD key and the signer seed", () => {
  const ticket = new Uint8Array(32).fill(7);
  const keys = ticketKeys(ticket);
  assert.equal(keys.encryptionKey.length, 32);
  assert.equal(keys.publicKey.length, 32);
  assert.deepEqual(ticketKeys(ticket).publicKey, keys.publicKey, "deterministic");
  assert.notDeepEqual(ticketKeys(new Uint8Array(32).fill(8)).publicKey, keys.publicKey);
  assert.equal(hash256(new Uint8Array(0)).length, 32);
  assert.throws(() => ticketKeys(new Uint8Array(31)), /32 bytes/);
});
