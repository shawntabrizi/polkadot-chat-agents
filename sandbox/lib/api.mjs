// The control API: one HTTP server over the daemon's state. The CLI and the
// web UI are thin clients of it. JSON in, JSON out; bytes become 0x-hex and
// bigints strings on the way out. Events stream as SSE on GET /events.
//
// Routes follow PLAN.md's table. Faults, clock and scenarios are S2/S3; the
// router leaves room for them (one table, one handler per row).

import http from "node:http";

import { normHex } from "./bytes.mjs";
import { inspectWire } from "./wire.mjs";

const replacer = (_k, v) => (v instanceof Uint8Array ? normHex(v) : typeof v === "bigint" ? v.toString() : v);
export const toJson = (value) => JSON.stringify(value, replacer);

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const badRequest = (m) => new ApiError(400, m);
const notFound = (m) => new ApiError(404, m);

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (chunks.length === 0) return resolve({});
    try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch { reject(badRequest("body is not JSON")); }
  });
  req.on("error", reject);
});

const intParam = (value, fallback) => {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`not a device index: ${value}`);
  return n;
};

export function createApi({ node, directory, personas, events, addPersona, resolvePeer, storeUrl }) {
  const persona = (name) => {
    const found = personas.get(name);
    if (!found) throw notFound(`no persona ${name}`);
    return found;
  };
  const peerOf = (value) => {
    const account = resolvePeer(value);
    if (!account) throw notFound(`unknown peer ${value}`);
    return account;
  };
  const nameOf = (account) => directory.consumer(account)?.username ?? null;
  const roomView = (p, peer, { device = null, unread = false } = {}) => ({
    persona: p.name,
    peer,
    peerName: nameOf(peer),
    room: p.state.messages.rooms().find((r) => r.peer === peer) ?? null,
    contact: p.state.contacts.get(peer) ?? null,
    messages: p.state.messages.list(peer, { device, unread }),
  });

  // [method, pattern, handler(params, query, body)] — patterns use :name segments.
  const routes = [
    ["GET", "/node", () => ({
      url: storeUrl, statements: node.statements.length, allowances: node.allowances.size, limits: node.limits, clock: node.clock, faults: node.faults.list(),
    })],
    ["GET", "/wire", (_p, q) => ({
      statements: inspectWire({ node, personas: [...personas.values()], directory }, { topic: q.get("topic"), signer: q.get("signer"), peer: q.get("peer"), raw: q.get("raw") === "1" }),
    })],

    ["GET", "/accounts", () => directory.list()],
    ["POST", "/accounts", (_p, _q, body) => {
      if (!body.account) throw badRequest("account required");
      return directory.allow(body.account);
    }],
    ["POST", "/accounts/:id/register", (p, _q, body) => {
      if (!body.username || !body.identifierKey) throw badRequest("username and identifierKey required");
      try { return directory.register(p.id, { username: body.username, identifierKey: body.identifierKey }); }
      catch (e) { throw new ApiError(409, e.message); }
    }],
    ["GET", "/consumers/:account", (p) => directory.consumer(p.account) ?? (() => { throw notFound(`no consumer ${p.account}`); })()],
    ["GET", "/usernames/:name", (p) => {
      const account = directory.usernameOwner(p.name);
      if (!account) throw notFound(`no username ${p.name}`);
      return { username: p.name, ...directory.consumer(account) };
    }],

    ["GET", "/personas", () => [...personas.values()].map((p) => p.toJSON())],
    ["POST", "/personas", async (_p, _q, body) => {
      if (!body.name) throw badRequest("name required");
      if (personas.has(body.name)) throw new ApiError(409, `persona ${body.name} exists`);
      try { return (await addPersona(body.name, intParam(body.devices, 1))).toJSON(); }
      catch (e) { throw new ApiError(409, e.message); }
    }],
    ["GET", "/personas/:name", (p) => {
      const found = persona(p.name);
      return { ...found.toJSON(), contacts: found.state.contacts.list(), rooms: found.state.messages.rooms(), requests: found.state.requests.list() };
    }],
    ["POST", "/personas/:name/devices", (p) => {
      const found = persona(p.name);
      const device = found.addDevice();
      directory.allow(device.account);
      return device.toJSON();
    }],

    ["POST", "/personas/:name/requests", async (p, _q, body) => {
      const from = persona(p.name);
      const to = peerOf(body.to);
      const identity = directory.identityOf(to);
      if (!identity) throw badRequest(`${body.to} is not messageable (no identifier key)`);
      const { requestId, timestamp } = await from.request(
        { accountId: Uint8Array.from(Buffer.from(to.slice(2), "hex")), username: identity.username, chatPublicKey: identity.chatPublicKey },
        body.welcome ?? null,
        { device: intParam(body.device, 1) },
      );
      return { requestId, timestamp, to, toName: identity.username };
    }],
    ["GET", "/personas/:name/requests", (p, q) => persona(p.name).state.requests.list()
      .filter((r) => !q.get("direction") || r.direction === q.get("direction"))
      .filter((r) => !q.get("status") || r.status === q.get("status"))],
    ["POST", "/personas/:name/requests/:id/accept", async (p, _q, body) => {
      const found = persona(p.name);
      try { await found.accept(p.id, { device: intParam(body.device, 1) }); }
      catch (e) { throw new ApiError(409, e.message); }
      return found.state.requests.get(p.id);
    }],
    ["POST", "/personas/:name/requests/:id/decline", async (p, _q, body) => {
      const found = persona(p.name);
      try { await found.decline(p.id, { device: intParam(body.device, 1) }); }
      catch (e) { throw new ApiError(409, e.message); }
      return found.state.requests.get(p.id);
    }],

    ["GET", "/personas/:name/rooms", (p) => {
      const found = persona(p.name);
      return found.state.messages.rooms().map((r) => ({ ...r, peerName: nameOf(r.peer) }));
    }],
    ["GET", "/personas/:name/rooms/:peer", (p, q) => roomView(persona(p.name), peerOf(p.peer), { device: intParam(q.get("device"), null), unread: q.get("unread") === "1" })],
    ["POST", "/personas/:name/rooms/:peer/read", (p) => {
      const found = persona(p.name);
      found.markRead(peerOf(p.peer));
      return { ok: true };
    }],
    ["POST", "/personas/:name/rooms/:peer/messages", async (p, _q, body) => {
      const found = persona(p.name);
      const peer = peerOf(p.peer);
      const opts = { device: intParam(body.device, 1) };
      try {
        if (body.react) {
          await found.react(peer, body.react.messageId, body.react.emoji, body.react.add !== false, opts);
          return found.state.messages.get(body.react.messageId);
        }
        if (body.edit) {
          await found.edit(peer, body.edit.messageId, body.edit.text, opts);
          return found.state.messages.get(body.edit.messageId);
        }
        if (typeof body.text !== "string") throw badRequest("text, react or edit required");
        const content = body.replyTo ? { type: "reply", messageId: body.replyTo, text: body.text } : { type: "text", text: body.text };
        const { messageId } = await found.send(peer, content, opts);
        return found.state.messages.get(messageId);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(409, e.message);
      }
    }],
  ].map(([method, pattern, handler]) => ({
    method,
    handler,
    keys: pattern.split("/").filter((s) => s.startsWith(":")).map((s) => s.slice(1)),
    regex: new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, "([^/]+)")}$`),
  }));

  const serveEvents = (req, res, url) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const write = (e) => res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${toJson(e)}\n\n`);
    const since = Number(url.searchParams.get("since") ?? req.headers["last-event-id"] ?? 0);
    for (const e of events.since(since)) write(e);
    const stop = events.subscribe(write);
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => { clearInterval(keepAlive); stop(); });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(toJson(body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/events") return serveEvents(req, res, url);
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = url.pathname.match(route.regex);
        if (!match) continue;
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
        const body = req.method === "POST" ? await readBody(req) : {};
        return send(200, await route.handler(params, url.searchParams, body));
      }
      return send(404, { error: `no route ${req.method} ${url.pathname}` });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      return send(status, { error: error.message ?? String(error) });
    }
  });

  return {
    listen: (port, host) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve(server.address().port));
    }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
