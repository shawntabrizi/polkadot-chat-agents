// The control API on a real network: what is refused (faults, the clock,
// node restarts, the pool, local registration, a second device) with a 409
// that names the network, what still answers (the node info with the
// genesis, the seen wire, bots), and that the mock keeps every route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../lib/api.mjs";
import { createSeenStore } from "../lib/seen-store.mjs";

const GENESIS = `0x${"4a".repeat(32)}`;

async function serve(overrides = {}) {
  const seen = createSeenStore();
  const bots = new Map();
  const api = createApi({
    node: seen, hop: null, directory: { list: () => [], consumer: async () => null, identityOf: async () => null, usernameOwner: async () => null, search: async (prefix) => [{ username: `${prefix}.01`, account: `0x${"aa".repeat(32)}`, status: "ASSIGNED", onChain: true }] },
    personas: new Map(), bots, events: { since: () => [], subscribe: () => () => {} },
    addPersona: async () => { throw new Error("not in this test"); },
    attachBot: async (entry) => { bots.set(entry.name, { ...entry, onChain: false, needsReregistration: true }); return bots.get(entry.name); },
    resolvePeer: async () => null, storeUrl: "wss://people.example.test", hopUrl: "wss://hop.example.test",
    setClock: () => { throw new Error("must not be reached"); }, restartNode: () => { throw new Error("must not be reached"); }, resetNode: () => { throw new Error("must not be reached"); },
    networkInfo: () => ({ network: "paseo", name: "Paseo Next v2", mock: false, genesis: GENESIS, identityBackendUrl: "https://backend.example.test", chainReset: null }),
    ...overrides,
  });
  const port = await api.listen(0, "127.0.0.1");
  const call = async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { api, call, seen, bots };
}

test("on paseo: faults, clock, node restart/reset, the pool and local registration answer 409 naming the network", async (t) => {
  const { api, call } = await serve();
  t.after(() => api.close());
  const refused = [
    ["POST", "/faults", { kind: "drop" }], ["DELETE", "/faults/all"], ["POST", "/clock", { offsetMs: 1000 }], ["POST", "/node/restart"], ["POST", "/node/reset"],
    ["GET", "/hop"], ["POST", "/hop/faults", { kind: "refuse" }], ["DELETE", "/hop/faults/all"],
    ["POST", "/accounts", { account: `0x${"11".repeat(32)}` }], ["POST", "/accounts/register", { account: `0x${"11".repeat(32)}`, username: "x", identifierKey: "0x00" }], ["POST", `/accounts/0x${"11".repeat(32)}/bulletin`],
  ];
  for (const [method, route, body] of refused) {
    const r = await call(method, route, body);
    assert.equal(r.status, 409, `${method} ${route}`);
    assert.match(r.body.error, /mock network only; this sandbox runs on Paseo Next v2 \(paseo\)/, `${method} ${route}: ${r.body.error}`);
  }
  assert.deepEqual(await call("GET", "/faults"), { status: 200, body: [] }, "listing faults is harmless: there are none");
});

test("on paseo: the node info carries the network and genesis; the wire is what the personas saw; bots attach with their chain state", async (t) => {
  const { api, call, seen, bots } = await serve();
  t.after(() => api.close());
  const node = await call("GET", "/node");
  assert.equal(node.status, 200);
  assert.deepEqual([node.body.network, node.body.mock, node.body.genesis, node.body.url, node.body.hopUrl, node.body.statements, node.body.faults, node.body.clock], ["paseo", false, GENESIS, "wss://people.example.test", "wss://hop.example.test", 0, [], null]);
  assert.deepEqual((await call("GET", "/wire")).body, { statements: [] });
  assert.equal(seen.statements.length, 0);
  const attached = await call("POST", "/bots/attach", { name: "echobot", account: `0x${"77".repeat(32)}`, identifierKey: `0x00${"78".repeat(32)}${"00".repeat(32)}`, username: "echobot.19" });
  assert.equal(attached.status, 200);
  assert.deepEqual([attached.body.onChain, attached.body.needsReregistration], [false, true]);
  assert.equal((await call("GET", "/bots")).body.length, 1);
  assert.equal(bots.get("echobot").username, "echobot.19");
  assert.equal((await call("POST", "/bots/attach", { name: "x" })).status, 400);
  assert.deepEqual((await call("GET", "/usernames?prefix=mac")).body, [{ username: "mac.01", account: `0x${"aa".repeat(32)}`, status: "ASSIGNED", onChain: true }]);
});

test("on the mock, the same routes stay open (the refusal is the network's, not the route's)", async (t) => {
  const faults = [];
  const { api, call } = await serve({
    node: { statements: [], allowances: new Set(), limits: {}, clock: { offsetMs: 0 }, faults: { list: () => faults, clear: () => { const n = faults.length; faults.length = 0; return n; }, drop: () => { faults.push({ id: 1, kind: "drop", held: [], hits: 0 }); return { id: 1 }; } }, list: () => [], history: () => [], watch: () => () => {} },
    setClock: (offsetMs) => ({ offsetMs }),
    networkInfo: () => ({ network: "mock", name: "Local mock network", mock: true, genesis: null, identityBackendUrl: null, chainReset: null }),
  });
  t.after(() => api.close());
  assert.equal((await call("POST", "/clock", { offsetMs: 5 })).status, 200);
  assert.equal((await call("POST", "/faults", { kind: "drop" })).status, 200);
  assert.deepEqual((await call("DELETE", "/faults/all")).body, { cleared: 1 });
  const node = await call("GET", "/node");
  assert.deepEqual([node.body.network, node.body.mock, node.body.genesis], ["mock", true, null]);
});
