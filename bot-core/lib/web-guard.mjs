// Web egress guard for direct-agent turns that hold the `web` capability.
//
// The Claude CLI's WebFetch runs INSIDE the CLI process: it opens its own
// connection to the URL the model chose. A filesystem scope cannot bound that,
// and Claude's permission rules can only name domains (no IP ranges, and a
// name can resolve to anything). So the boundary lives here, at the network:
// each turn gets its own forward proxy on loopback, and the CLI is pointed at
// it with HTTPS_PROXY/HTTP_PROXY. The proxy resolves every target itself,
// refuses private, loopback, link-local, CGNAT/Tailscale and the container's
// own addresses (and the bot's bridge port on any address), and then connects
// to the exact address it checked, so a DNS answer cannot change between the
// check and the connection.
//
// It also meters web use. Every allowed connection to a host that is not the
// model API counts as one fetch, against a per-turn budget and a per-day
// budget for the peer. WebSearch does not open a connection of its own (the
// search runs at the model provider), so the runtime counts it from the
// tool-use event through `take()` below, against the same budgets.
//
// This guards a CLI that honours the proxy variables. It is not a boundary
// for a `bash`-capable agent: a shell can clear the variables and connect
// directly. Public bots never get `bash` (docs/guide/deploy.md).

import { randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";

export const DEFAULT_WEB_TURN_BUDGET = 10;
export const DEFAULT_WEB_DAILY_BUDGET = 50;

// The CLI's own traffic to the model API goes through the same proxy. It is
// allowed without being counted as a fetch or logged.
export const DEFAULT_WEB_EXEMPT_HOSTS = Object.freeze(["api.anthropic.com:443"]);

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],        // "this network"; 0.0.0.0 reaches the local host
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],    // CGNAT, Tailscale
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],   // link-local, cloud metadata
  ["172.16.0.0", 12],    // includes the default Docker bridges
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, broadcast
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],            // IPv4-compatible (deprecated)
  ["64:ff9b::", 96],     // NAT64 can embed any IPv4 address
  ["fc00::", 7],         // unique local, includes Tailscale fd7a:115c:a1e0::/48
  ["fe80::", 10],
  ["ff00::", 8],
]) blocked.addSubnet(address, prefix, "ipv6");

const mappedIpv4 = (address) => {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return match ? match[1] : null;
};

const ownAddresses = () => {
  const addresses = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) addresses.add(String(entry.address).toLowerCase().replace(/%.*$/, ""));
  }
  return addresses;
};

// Claude PreToolUse hook for WebSearch. It runs as the agent, inherits
// PCA_WEB_GUARD from the CLI, and asks the turn's guard over loopback. Exit
// code 2 denies the tool and shows stderr to the model; every failure path
// ends in exit 2, so a missing or broken guard never allows a search. Inline
// (`node -e`) so the hook does not depend on the agent reading bot-core files.
export const CLAUDE_WEB_SEARCH_HOOK = `node -e '${[
  "process.stdin.resume()",
  "const no=(m)=>{process.stderr.write(\"pca web guard: \"+m);process.exit(2)}",
  "process.on(\"uncaughtException\",()=>no(\"unavailable\"))",
  "setTimeout(()=>no(\"timeout\"),10000)",
  "const u=process.env.PCA_WEB_GUARD",
  "if(!u)no(\"unavailable\")",
  "const q=require(\"node:http\").request(u+\"/search\",{method:\"POST\"},(r)=>{let b=\"\";r.on(\"data\",(d)=>b+=d);r.on(\"end\",()=>r.statusCode===204?process.exit(0):no(b||\"blocked\"))})",
  "q.on(\"error\",()=>no(\"unavailable\"))",
  "q.end()",
].join(";")}'`;

// Returns null when the address may be reached, else the reason it may not.
export const blockedAddressReason = (address, { own = ownAddresses() } = {}) => {
  let ip = String(address ?? "").toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = mappedIpv4(ip);
  if (v4) ip = v4;
  const family = net.isIP(ip);
  if (!family) return "invalid-address";
  if (blocked.check(ip, family === 4 ? "ipv4" : "ipv6")) return "private-address";
  if (own.has(ip)) return "own-address";
  return null;
};

const splitAuthority = (authority, defaultPort) => {
  const text = String(authority ?? "");
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  if (bracketed) return { host: bracketed[1], port: Number(bracketed[2] ?? defaultPort) };
  const colon = text.lastIndexOf(":");
  if (colon > 0 && text.indexOf(":") === colon) return { host: text.slice(0, colon), port: Number(text.slice(colon + 1)) };
  return { host: text, port: defaultPort };
};

const utcDay = (now) => new Date(now()).toISOString().slice(0, 10);

const boundedCount = (value, fallback) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};

export const createWebGuard = ({
  turnBudget = DEFAULT_WEB_TURN_BUDGET,
  dailyBudget = DEFAULT_WEB_DAILY_BUDGET,
  bridgePort = null,
  exemptHosts = DEFAULT_WEB_EXEMPT_HOSTS,
  lookup = (host) => dns.lookup(host, { all: true, verbatim: true }),
  own = ownAddresses,
  // Test seam: where a checked address is actually dialled.
  dialTarget = (address, port) => ({ host: address, port }),
  now = Date.now,
  idleMs = 60_000,
  log = () => {},
} = {}) => {
  const perTurn = boundedCount(turnBudget, DEFAULT_WEB_TURN_BUDGET);
  const perDay = boundedCount(dailyBudget, DEFAULT_WEB_DAILY_BUDGET);
  const exempt = new Set([...exemptHosts].map((entry) => String(entry).toLowerCase()));
  const daily = new Map(); // peer -> { day, used }

  const dayUsage = (peer) => {
    const day = utcDay(now);
    let usage = daily.get(peer);
    if (!usage || usage.day !== day) {
      usage = { day, used: 0 };
      daily.set(peer, usage);
      // One entry per peer that used the web today; drop older days.
      for (const [key, value] of daily) if (value.day !== day) daily.delete(key);
    }
    return usage;
  };

  // Spend one unit of the turn's and the peer's budget, or say why not.
  const take = (turn) => {
    if (turn.used >= perTurn) return "turn-budget";
    const usage = dayUsage(turn.peer);
    if (usage.used >= perDay) return "daily-budget";
    turn.used += 1;
    usage.used += 1;
    return null;
  };

  // Resolve and check every address; connect only to a checked one.
  const resolveTarget = async (host, port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return { reason: "invalid-port" };
    if (bridgePort != null && port === Number(bridgePort)) return { reason: "bridge-port" };
    const bare = host.replace(/^\[|\]$/g, "");
    let addresses;
    if (net.isIP(bare)) addresses = [bare];
    else {
      try { addresses = (await lookup(bare)).map((entry) => entry.address); }
      catch { return { reason: "dns-failed" }; }
    }
    if (!addresses.length) return { reason: "dns-failed" };
    const ownSet = own();
    for (const address of addresses) {
      const reason = blockedAddressReason(address, { own: ownSet });
      // One bad answer blocks the host: an attacker controls which answer a
      // later resolver would pick.
      if (reason) return { reason };
    }
    // Prefer IPv4: many containers have no IPv6 route.
    return { address: addresses.find((address) => net.isIPv4(address)) ?? addresses[0] };
  };

  const openTurn = async (peer) => {
    const turn = { peer: String(peer ?? ""), used: 0 };
    const sockets = new Set();
    const track = (socket) => {
      if (sockets.has(socket)) return socket; // a keep-alive client socket
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.setTimeout(idleMs, () => socket.destroy());
      socket.on("error", () => {});
      return socket;
    };

    // Common gate for CONNECT and plain-HTTP requests.
    const admit = async (host, port) => {
      const key = `${host.toLowerCase()}:${port}`;
      const isExempt = exempt.has(key);
      const target = await resolveTarget(host, port);
      if (target.reason) {
        log("BOT_WEB_BLOCKED", { peer: turn.peer, host, port, reason: target.reason });
        return null;
      }
      if (!isExempt) {
        const reason = take(turn);
        if (reason) {
          log("BOT_WEB_BLOCKED", { peer: turn.peer, host, port, reason });
          return null;
        }
      }
      return { ...target, counted: !isExempt };
    };

    const token = randomBytes(16).toString("hex");
    const server = http.createServer(async (req, res) => {
      track(req.socket);
      // The WebSearch hook's control request (origin-form, secret path).
      if (req.method === "POST" && req.url === `/${token}/search`) {
        const reason = take(turn);
        if (reason) log("BOT_WEB_BLOCKED", { peer: turn.peer, tool: "WebSearch", reason });
        else log("BOT_WEB_SEARCH", { peer: turn.peer });
        if (reason) res.writeHead(429, { connection: "close" }).end(`${reason === "turn-budget" ? "web budget for this turn is spent" : "daily web budget for this user is spent"}`);
        else res.writeHead(204, { connection: "close" }).end();
        return;
      }
      let url;
      try { url = new URL(req.url); } catch { url = null; }
      // A proxy request carries an absolute URL. Anything else is a direct
      // request to the proxy itself.
      if (!url || url.protocol !== "http:") {
        res.writeHead(400, { connection: "close" }).end("pca web guard: proxy requests only\n");
        return;
      }
      const port = Number(url.port || 80);
      const admitted = await admit(url.hostname, port);
      if (!admitted) {
        res.writeHead(403, { connection: "close" }).end("pca web guard: blocked\n");
        return;
      }
      const headers = { ...req.headers };
      for (const name of Object.keys(headers)) if (/^proxy-/i.test(name)) delete headers[name];
      let bytes = 0;
      const upstream = http.request({
        ...dialTarget(admitted.address, port),
        agent: false, // one upstream connection per admitted request
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
        setHost: false,
      }, (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.on("data", (chunk) => { bytes += chunk.length; });
        response.pipe(res);
        response.on("end", () => {
          if (admitted.counted) log("BOT_WEB_FETCH", { peer: turn.peer, host: url.hostname, port, bytes });
        });
      });
      upstream.on("socket", track);
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
      req.pipe(upstream);
    });

    server.on("connect", async (req, client, head) => {
      track(client);
      const { host, port } = splitAuthority(req.url, 443);
      const admitted = await admit(host, port);
      if (!admitted) {
        client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      let bytes = 0;
      const upstream = track(net.connect(dialTarget(admitted.address, port)));
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) upstream.write(head);
        upstream.on("data", (chunk) => { bytes += chunk.length; });
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => {
        client.destroy();
        if (admitted.counted) log("BOT_WEB_FETCH", { peer: turn.peer, host, port, bytes });
      });
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const proxyUrl = `http://127.0.0.1:${server.address().port}`;
    return {
      proxyUrl,
      // Point every common spelling at the proxy and clear any bypass list,
      // so no host (not even localhost) goes around it.
      env: {
        HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl,
        NO_PROXY: "", no_proxy: "",
        PCA_WEB_GUARD: `${proxyUrl}/${token}`,
        // Claude's telemetry would otherwise count against the fetch budget.
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      take: () => take(turn),
      used: () => turn.used,
      close: () => new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
    };
  };

  return { openTurn, turnBudget: perTurn, dailyBudget: perDay, dailyUsed: (peer) => dayUsage(String(peer ?? "")).used };
};
