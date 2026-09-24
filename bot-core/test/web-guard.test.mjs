import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import {
  blockedAddressReason,
  CLAUDE_WEB_SEARCH_HOOK,
  createWebGuard,
  DEFAULT_WEB_DAILY_BUDGET,
  DEFAULT_WEB_TURN_BUDGET,
} from "../lib/web-guard.mjs";

// Public bots run a model that any stranger can steer. The guard is what
// stops "fetch http://169.254.169.254/" or "fetch the bot's own bridge" from
// working, and what stops one peer from spending the operator's web budget.

const PUBLIC_IP = "93.184.215.14";

// A fake upstream. Every request the guard lets through lands here, so a
// blocked request is proven by this server never seeing it.
const startTarget = async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.end("public-page-body");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { hits, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
};

// The guard under test sees a public DNS answer, and dials the fake target
// instead of the internet. Address checks run on the DNS answer, exactly as
// in production.
const makeGuard = async (options = {}) => {
  const target = await startTarget();
  const events = [];
  const guard = createWebGuard({
    lookup: async (host) => [{ address: options.dns?.[host] ?? PUBLIC_IP }],
    own: () => new Set(),
    dialTarget: () => ({ host: "127.0.0.1", port: target.port }),
    log: (event, extra) => events.push({ event, ...extra }),
    ...options,
  });
  return { guard, target, events };
};

// One plain-HTTP proxy request (absolute-form URL), like HTTP_PROXY clients send.
const proxyGet = (proxyUrl, url) => new Promise((resolve, reject) => {
  const proxy = new URL(proxyUrl);
  const req = http.request({ host: proxy.hostname, port: proxy.port, method: "GET", path: url, headers: { host: new URL(url).host } }, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, body }));
  });
  req.on("error", reject);
  req.end();
});

// One CONNECT tunnel, like HTTPS_PROXY clients open.
const proxyConnect = (proxyUrl, authority) => new Promise((resolve, reject) => {
  const proxy = new URL(proxyUrl);
  const req = http.request({ host: proxy.hostname, port: proxy.port, method: "CONNECT", path: authority });
  req.on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
  req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
  req.on("error", reject);
  req.end();
});

test("every private, loopback, link-local and Tailscale range is refused; public addresses pass", () => {
  const own = new Set();
  for (const address of [
    "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "100.100.100.100", "100.127.255.255", "0.0.0.0",
    "::1", "fc00::1", "fd7a:115c:a1e0::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ]) {
    assert.equal(blockedAddressReason(address, { own }), "private-address", address);
  }
  for (const address of [PUBLIC_IP, "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"]) {
    assert.equal(blockedAddressReason(address, { own }), null, address);
  }
  // A container with a public interface must still not reach itself.
  assert.equal(blockedAddressReason("203.0.113.7", { own: new Set(["203.0.113.7"]) }), "own-address");
});

test("a private target is refused before any connection; a public host passes and is logged with its size", async () => {
  const { guard, target, events } = await makeGuard({ dns: { "internal.example": "10.0.0.5" } });
  const turn = await guard.openTurn("peer-a");
  try {
    const blockedLiteral = await proxyGet(turn.proxyUrl, `http://127.0.0.1:${target.port}/secret`);
    assert.equal(blockedLiteral.status, 403);
    // A public-looking name that resolves to a private address is refused too.
    assert.equal(await proxyConnect(turn.proxyUrl, "internal.example:443"), 403);
    assert.equal(await proxyConnect(turn.proxyUrl, "[::1]:443"), 403);
    assert.deepEqual(target.hits, [], "no blocked request may reach the target");

    const allowed = await proxyGet(turn.proxyUrl, "http://docs.example/page");
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body, "public-page-body");
    assert.deepEqual(target.hits, ["/page"]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const blocked = events.filter((e) => e.event === "BOT_WEB_BLOCKED");
    assert.deepEqual(blocked.map((e) => [e.host, e.reason]), [
      ["127.0.0.1", "private-address"],
      ["internal.example", "private-address"],
      ["::1", "private-address"],
    ]);
    const fetched = events.find((e) => e.event === "BOT_WEB_FETCH");
    assert.equal(fetched.host, "docs.example");
    assert.equal(fetched.bytes, "public-page-body".length);
    assert.equal(turn.used(), 1, "refused requests spend no budget");
  } finally {
    await turn.close();
    await target.close();
  }
});

test("the bot's own bridge port is refused on any address", async () => {
  const { guard, target, events } = await makeGuard({ bridgePort: 8799 });
  const turn = await guard.openTurn("peer-a");
  try {
    assert.equal(await proxyConnect(turn.proxyUrl, "docs.example:8799"), 403);
    assert.equal(events.at(-1).reason, "bridge-port");
    assert.deepEqual(target.hits, []);
  } finally {
    await turn.close();
    await target.close();
  }
});

test("the per-turn budget stops the 11th fetch", async () => {
  assert.equal(DEFAULT_WEB_TURN_BUDGET, 10);
  const { guard, target, events } = await makeGuard();
  const turn = await guard.openTurn("peer-a");
  try {
    for (let i = 1; i <= 10; i += 1) {
      assert.equal((await proxyGet(turn.proxyUrl, `http://docs.example/${i}`)).status, 200, `fetch ${i}`);
    }
    assert.equal((await proxyGet(turn.proxyUrl, "http://docs.example/11")).status, 403);
    assert.equal(target.hits.length, 10);
    assert.equal(events.at(-1).event, "BOT_WEB_BLOCKED");
    assert.equal(events.at(-1).reason, "turn-budget");
  } finally {
    await turn.close();
    await target.close();
  }
  // A new turn starts with a fresh per-turn budget.
  const next = await guard.openTurn("peer-a");
  try { assert.equal(next.take(), null); } finally { await next.close(); }
});

test("the per-day budget is per peer, spans turns, and resets the next UTC day", async () => {
  assert.equal(DEFAULT_WEB_DAILY_BUDGET, 50);
  let clock = Date.parse("2026-09-24T10:00:00Z");
  const guard = createWebGuard({ turnBudget: 10, dailyBudget: 25, now: () => clock });
  const spend = async (peer, count) => {
    const turn = await guard.openTurn(peer);
    const results = [];
    for (let i = 0; i < count; i += 1) results.push(turn.take());
    await turn.close();
    return results;
  };
  assert.deepEqual(await spend("peer-a", 10), Array(10).fill(null));
  assert.deepEqual(await spend("peer-a", 10), Array(10).fill(null));
  const third = await spend("peer-a", 10);
  assert.deepEqual(third.slice(0, 5), Array(5).fill(null));
  assert.deepEqual(third.slice(5), Array(5).fill("daily-budget"));
  // Another peer is not charged for peer-a's use.
  assert.deepEqual(await spend("peer-b", 1), [null]);
  clock += 24 * 3_600_000;
  assert.deepEqual(await spend("peer-a", 1), [null]);
});

// Runs the exact hook command Claude runs, the way Claude runs it (a shell).
const runHook = (env) => new Promise((resolve) => {
  const child = spawn("sh", ["-c", CLAUDE_WEB_SEARCH_HOOK], { env: { PATH: process.env.PATH, ...env }, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ tool_name: "WebSearch", tool_input: { query: "x" } }));
  child.on("close", (code) => resolve({ code, stderr }));
});

test("WebSearch spends the same budget through the hook, and a missing guard denies it", async () => {
  const events = [];
  const guard = createWebGuard({ turnBudget: 1, log: (event, extra) => events.push({ event, ...extra }) });
  const turn = await guard.openTurn("peer-a");
  try {
    assert.equal((await runHook(turn.env)).code, 0, "first search is inside the budget");
    const denied = await runHook(turn.env);
    assert.equal(denied.code, 2, "exit 2 makes Claude deny the tool");
    assert.match(denied.stderr, /web budget for this turn is spent/);
    assert.deepEqual(events.map((e) => [e.event, e.reason ?? null]), [["BOT_WEB_SEARCH", null], ["BOT_WEB_BLOCKED", "turn-budget"]]);
  } finally {
    await turn.close();
  }
  // Fail closed: no guard variable, or a guard that is gone.
  assert.equal((await runHook({})).code, 2);
  assert.equal((await runHook(turn.env)).code, 2);
});

test("the turn environment routes every proxy spelling to the guard with no bypass list", async () => {
  const guard = createWebGuard();
  const turn = await guard.openTurn("peer-a");
  try {
    for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) assert.equal(turn.env[name], turn.proxyUrl);
    assert.equal(turn.env.NO_PROXY, "");
    assert.equal(turn.env.no_proxy, "");
    assert.match(turn.proxyUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await turn.close();
  }
});
