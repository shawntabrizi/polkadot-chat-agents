// The People-chain read seam against a fake typed api: the `Consumers`
// value shape of the 2026-09 runtimes (identifier_key, lite_username,
// credibility) in every form papi hands it back, the sandbox directory's
// HTTP form, and the registration check both `pca info` and `pca status`
// make — the chain, not the genesis, says whether a bot is registered.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Binary } from "polkadot-api";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { createChainDirectory, createSandboxDirectory, decodeConsumer, registrationOnChain } from "../lib/people-directory.mjs";

const ACCOUNT = `0x${"ab".repeat(32)}`;
const CONTAINER = `0x00${"cd".repeat(32)}${"00".repeat(32)}`;
const address = ss58Address(Uint8Array.from(Buffer.from(ACCOUNT.slice(2), "hex")), 42);
const fakeApi = (consumers, owners = new Map()) => ({
  query: {
    Resources: {
      Consumers: { getValue: async (addr) => consumers.get(addr) },
      UsernameOwnerOf: { getValue: async (name) => owners.get(typeof name.asText === "function" ? name.asText() : new TextDecoder().decode(name)) },
    },
  },
});

test("decodeConsumer reads the 2026-09 Consumers shape in every form papi returns it", () => {
  // The typed api: hex for a fixed-size key, Binary for a bounded Vec<u8>, an enum object.
  assert.deepEqual(decodeConsumer(ACCOUNT, { identifier_key: CONTAINER, full_username: undefined, lite_username: Binary.fromText("macbot.19"), credibility: { type: "Lite", value: undefined } }),
    { account: ACCOUNT, username: "macbot.19", identifierKey: CONTAINER, credibility: "Lite" });
  // The unsafe api / older descriptors: Binary for the key, bytes for the name; a full username wins.
  assert.deepEqual(decodeConsumer(ACCOUNT.toUpperCase(), { identifier_key: Binary.fromHex(CONTAINER), full_username: new TextEncoder().encode("gav"), lite_username: new TextEncoder().encode("gav.01"), credibility: { type: "Person", value: { demoted: false } } }),
    { account: ACCOUNT, username: "gav", identifierKey: CONTAINER, credibility: "Person" });
  // A value without credibility (a chain before the field) still yields the key.
  assert.deepEqual(decodeConsumer(ACCOUNT, { identifier_key: CONTAINER, lite_username: Binary.fromText("old.02") }).credibility, null);
  assert.equal(decodeConsumer(ACCOUNT, undefined), null);
});

test("the chain directory answers consumerOf, identifierKeyFor and usernameOwner from Resources", async () => {
  const directory = createChainDirectory(fakeApi(new Map([[address, { identifier_key: CONTAINER, lite_username: Binary.fromText("macbot.19"), credibility: { type: "Lite" } }]]), new Map([["macbot.19", address]])));
  assert.deepEqual(await directory.consumerOf(ACCOUNT), { account: ACCOUNT, username: "macbot.19", identifierKey: CONTAINER, credibility: "Lite" });
  assert.equal(await directory.identifierKeyFor(ACCOUNT), CONTAINER);
  assert.equal(await directory.identifierKeyFor(`0x${"11".repeat(32)}`), null);
  assert.equal(await directory.usernameOwner("macbot.19"), ACCOUNT);
  assert.equal(await directory.usernameOwner("nobody.99"), null);
  assert.throws(() => createChainDirectory({}), /needs a People typed api/);
});

test("the sandbox directory reads the same contract over HTTP, credibility included", async (t) => {
  const server = http.createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === `/api/consumers/${ACCOUNT}`) return reply(200, { account: ACCOUNT, username: "sandboxbot", identifierKey: CONTAINER, credibility: "Lite" });
    if (req.url === "/api/usernames/sandboxbot") return reply(200, { username: "sandboxbot", account: ACCOUNT });
    return reply(404, { error: "no" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const directory = createSandboxDirectory(`http://127.0.0.1:${server.address().port}`);
  assert.deepEqual(await directory.consumerOf(ACCOUNT), { account: ACCOUNT, username: "sandboxbot", identifierKey: CONTAINER, credibility: "Lite" });
  assert.equal(await directory.identifierKeyFor(ACCOUNT), CONTAINER);
  assert.equal(await directory.consumerOf(`0x${"11".repeat(32)}`), null);
  assert.equal(await directory.usernameOwner("sandboxbot"), ACCOUNT);
  assert.equal(await directory.usernameOwner("other"), null);
});

test("registrationOnChain: on the chain, gone, renamed elsewhere, and unreachable", async () => {
  const holding = (consumer) => ({ consumerOf: async () => consumer });
  assert.deepEqual(await registrationOnChain(holding(null), { account: ACCOUNT, username: "macbot.19" }), { onChain: false }, "a wiped registration: the genesis says nothing, the chain does");
  const live = await registrationOnChain(holding({ account: ACCOUNT, username: "macbot.19", identifierKey: CONTAINER, credibility: "Lite" }), { account: ACCOUNT, username: "macbot.19" });
  assert.deepEqual([live.onChain, live.username, live.renamed, live.credibility], [true, "macbot.19", false, "Lite"]);
  const renamed = await registrationOnChain(holding({ account: ACCOUNT, username: "macbot.42", identifierKey: CONTAINER, credibility: "Lite" }), { account: ACCOUNT, username: "macbot.19" });
  assert.deepEqual([renamed.onChain, renamed.username, renamed.renamed], [true, "macbot.42", true]);
  assert.equal((await registrationOnChain(holding({ account: ACCOUNT, username: "macbot.19", identifierKey: CONTAINER, credibility: null }), { account: ACCOUNT })).renamed, false, "no local username: nothing to compare");
  await assert.rejects(registrationOnChain({ consumerOf: async () => { throw new Error("socket closed"); } }, { account: ACCOUNT }), /socket closed/, "a transport failure is not 'gone'");
});
