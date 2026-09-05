// The chain directory against a fake papi client: what it asks the chain,
// how it reads the answers (papi's unsafe api hands fixed-size values back
// as hex and bounded vecs as bytes), how the backend's search is checked
// against the chain, and what it remembers for the wire's labels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountId } from "polkadot-api";
import { createChainDirectory } from "../lib/chain-directory.mjs";
import { wrapIdentifierKey } from "../lib/directory.mjs";

const hex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const acct = (fill) => new Uint8Array(32).fill(fill);
const ss58 = AccountId(42);
const address = (bytes) => ss58.dec(bytes);
const text = (s) => new TextEncoder().encode(s);

/** A papi client whose unsafe api answers from two maps, recording every query. */
function fakeClient({ consumers = new Map(), owners = new Map() } = {}) {
  const queries = [];
  return {
    queries,
    getUnsafeApi: () => ({
      query: {
        Resources: {
          Consumers: { getValue: async (addr) => { queries.push(["Consumers", addr]); return consumers.get(addr); } },
          // papi's Binary.fromText is a Uint8Array; the chain sees the bytes of the name.
          UsernameOwnerOf: { getValue: async (name) => { const text = new TextDecoder().decode(name); queries.push(["UsernameOwnerOf", text]); return owners.get(text); } },
        },
      },
    }),
  };
}

test("consumer, identityOf and usernameOwner read Resources through papi and remember what they saw", async () => {
  const bob = acct(0xb0);
  const key = new Uint8Array(32).fill(0xb1);
  const container = hex(wrapIdentifierKey(key));
  const client = fakeClient({
    consumers: new Map([[address(bob), { identifier_key: container, full_username: undefined, lite_username: text("bobbot.07"), credibility: { type: "Lite" } }]]),
    owners: new Map([["bobbot.07", address(bob)]]),
  });
  const directory = createChainDirectory({ client, backendUrl: "https://backend.example.test" });
  assert.equal(directory.kind, "chain");
  assert.deepEqual(await directory.consumer(hex(bob)), { account: hex(bob), username: "bobbot.07", identifierKey: container });
  assert.deepEqual(client.queries[0], ["Consumers", address(bob)], "the account is asked for as SS58, as papi wants it");
  assert.equal(await directory.identifierKeyFor(hex(bob)), container, "bot-core's read contract");
  const identity = await directory.identityOf(hex(bob));
  assert.deepEqual([identity.account, identity.username, identity.chatPublicKey], [hex(bob), "bobbot.07", key]);
  assert.equal(await directory.usernameOwner("bobbot.07"), hex(bob));
  assert.equal(await directory.usernameOwner("nobody.99"), null);
  assert.equal(await directory.consumer(hex(acct(0x11))), null, "an account the chain does not hold");
  assert.equal(await directory.identityOf(hex(acct(0x11))), null);
  assert.deepEqual(directory.list().map((e) => [e.account, e.username, e.identifierKey]), [[hex(bob), "bobbot.07", container]], "one remembered entry for the labels");
  // A legacy P-256 key is on the chain but not usable for X25519 chat.
  const legacy = acct(0x22);
  client.getUnsafeApi = () => ({ query: { Resources: { Consumers: { getValue: async () => ({ identifier_key: `0x04${"33".repeat(64)}`, lite_username: text("oldbot.01") }) }, UsernameOwnerOf: { getValue: async () => undefined } } } });
  const withLegacy = createChainDirectory({ client, backendUrl: "https://backend.example.test" });
  assert.equal((await withLegacy.consumer(hex(legacy)))?.identifierKey, `0x04${"33".repeat(64)}`);
  assert.equal(await withLegacy.identityOf(hex(legacy)), null, "no X25519 key: not messageable");
});

test("search asks the identity backend and checks every hit against the chain", async () => {
  const live = acct(0xa1);
  const gone = acct(0xa2);
  const client = fakeClient({ owners: new Map([["macbot.19", address(live)]]) });
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify([
      { candidateAccountId: address(live), username: "macbot.19", status: "ASSIGNED", onchainData: null },
      { candidateAccountId: address(gone), username: "macbot.78", status: "ASSIGNED", onchainData: { blockNumber: 659047 } },
      { candidateAccountId: address(acct(0xa3)), username: "macbot.91", status: "RESERVED", onchainData: null },
      { bogus: true },
    ]), { status: 200 });
  };
  const directory = createChainDirectory({ client, backendUrl: "https://backend.example.test", fetchImpl });
  const hits = await directory.search("macbot");
  assert.deepEqual(requests, ["https://backend.example.test/api/v1/usernames?prefix=macbot"]);
  assert.deepEqual(hits, [
    { username: "macbot.19", account: hex(live), status: "ASSIGNED", onChain: true },
    { username: "macbot.78", account: hex(gone), status: "ASSIGNED", onChain: false },
    { username: "macbot.91", account: hex(acct(0xa3)), status: "RESERVED", onChain: false },
  ], "a record the backend kept across a reset is not on chain; a reserved one is not yet");
  assert.deepEqual(directory.list().map((e) => e.username), ["macbot.19"], "only the live hit is remembered");
  const failing = createChainDirectory({ client, backendUrl: "https://backend.example.test", fetchImpl: async () => new Response("nope", { status: 503 }) });
  await assert.rejects(failing.search("x"), /search failed \(503\)/);
});

test("remember keeps the public half of a persona or an attached bot for the labels", () => {
  const directory = createChainDirectory({ client: fakeClient(), backendUrl: "https://backend.example.test" });
  directory.remember({ account: hex(acct(1)), username: "sandboxalice.03", identifierKey: hex(wrapIdentifierKey(acct(2))), bulletinAccount: hex(acct(3)) });
  directory.remember({ account: hex(acct(1)), username: "sandboxalice.03" });
  assert.deepEqual(directory.list(), [{ account: hex(acct(1)), username: "sandboxalice.03", identifierKey: hex(wrapIdentifierKey(acct(2))), bulletinAccount: hex(acct(3)), allowance: true, hopAllowance: true }]);
  assert.throws(() => createChainDirectory({ client: {}, backendUrl: "x" }), /needs a papi client/);
});
