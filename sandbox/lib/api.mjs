// The control API: one HTTP server over the daemon's state. The CLI and the
// web UI are thin clients of it. JSON in, JSON out; bytes become 0x-hex and
// bigints strings on the way out. Events stream as SSE on GET /events.
//
// Routes follow PLAN.md's table: one table, one handler per row.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { normHex } from "./bytes.mjs";
import { inspectHistory, inspectWire, resolveHex } from "./wire.mjs";

const replacer = (_k, v) => (v instanceof Uint8Array ? normHex(v) : typeof v === "bigint" ? v.toString() : v);
export const toJson = (value) => JSON.stringify(value, replacer);

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
/** A handler result that is a page, not JSON. */
class Html {
  constructor(body) { this.body = body; }
}
/** A handler result that is a file on disk (a persona's media), streamed with its type. */
class FileBody {
  constructor(file, type) { this.file = file; this.type = type; }
}

// The built web UI (`sandbox/ui/dist`), served at `/` next to the API. Only
// files that exist under the directory are served; the API's own paths win.
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".map": "application/json" };
const staticFile = (dir, pathname) => {
  if (!dir) return null;
  const file = path.resolve(dir, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(path.resolve(dir) + path.sep)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return { file, type: MIME[path.extname(file)] ?? "application/octet-stream" };
};
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

const conflict = (m) => new ApiError(409, m);

export function createApi({ node, hop, directory, personas, bots = new Map(), events, addPersona, attachBot, resolvePeer, storeUrl, hopUrl, setClock, networkInfo, restartNode, resetNode, staticDir = null }) {
  // Faults, the clock, node restarts and the pool view exist in the mock
  // network only; on a real network the sandbox holds no node to break.
  const mockOnly = (what) => {
    const info = networkInfo();
    if (!info.mock) throw conflict(`${what} is available on the mock network only; this sandbox runs on ${info.name} (${info.network})`);
  };
  // The room page shares the UI's markdown pipeline (lib/markdown.mjs); one
  // jsdom window for DOMPurify. Loaded on first use: jsdom is heavy, and the
  // CLI imports this module on every `pcs` call.
  let roomRenderer = null;
  const renderRoom = async (view) => {
    roomRenderer ??= (await import("./room-html.mjs")).createRoomRenderer();
    return roomRenderer.renderRoom(view);
  };
  const persona = (name) => {
    const found = personas.get(name);
    if (!found) throw notFound(`no persona ${name}`);
    return found;
  };
  const peerOf = async (value) => {
    const account = await resolvePeer(value);
    if (!account) throw notFound(`unknown peer ${value}`);
    return account;
  };
  // The directory reads are async on a real network (chain queries); on the
  // mock they resolve at once. An attached bot's pca name labels its account.
  const nameOf = async (account) => {
    const bot = [...bots.values()].find((b) => b.account === normHex(account));
    if (bot) return bot.username ?? bot.name;
    return (await directory.consumer(account))?.username ?? null;
  };
  const wireDeps = () => ({ node, personas: [...personas.values()], directory });
  // A fault's `from`: a persona name (its identity and every device account),
  // a directory username (a bot's account) or an account hex.
  const signersOf = async (value) => {
    if (value == null) return null;
    const p = personas.get(value);
    if (p) return [p.account, ...p.devices.map((d) => d.account)];
    const account = await resolvePeer(value);
    if (!account) throw notFound(`unknown signer ${value}`);
    return [account];
  };
  // A channel or topic: hex, or a label as `pcs wire` prints it.
  const hexOf = (value, what) => {
    if (value == null) return null;
    const hex = resolveHex(wireDeps(), value);
    if (!hex) throw badRequest(`unknown ${what} ${value}`);
    return hex;
  };
  const faultOf = (id) => {
    const found = node.faults.list().find((f) => f.id === Number(id));
    if (!found) throw notFound(`no fault ${id}`);
    return found;
  };
  const hopFaultOf = (id) => {
    const found = hop.faults.list().find((f) => f.id === Number(id));
    if (!found) throw notFound(`no HOP fault ${id}`);
    return found;
  };
  // Who signed a pool entry: a registered identity's Bulletin account, or a persona's.
  const hopSignerLabel = (signer) => {
    if (!signer) return null;
    const p = [...personas.values()].find((x) => x.bulletinAccount === signer);
    if (p) return p.name;
    return directory.list().find((e) => e.bulletinAccount === signer)?.username ?? null;
  };
  // What a persona knows about an entry it uploaded or claimed: its role
  // (metadata or chunk i/n) and the conversation it belongs to.
  const hopRole = async (hash) => {
    for (const p of personas.values()) {
      const known = p.hopEntry(hash);
      if (known) return { role: known.role, owner: `${p.name} ⇄ ${(await nameOf(known.peer)) ?? known.peer}`, messageId: known.messageId };
    }
    return {};
  };
  const hopView = async () => ({
    url: hop.url,
    limits: hop.limits,
    status: hop.status(),
    entries: await Promise.all(hop.list().map(async (e) => ({ ...e, signerLabel: hopSignerLabel(e.signer), ...(await hopRole(e.hash)) }))),
    faults: hop.faults.list(),
  });
  const roomView = async (p, peer, { device = null, unread = false } = {}) => ({
    persona: p.name,
    device,
    peer,
    peerName: await nameOf(peer),
    room: p.state.messages.rooms().find((r) => r.peer === peer) ?? null,
    contact: p.state.contacts.get(peer) ?? null,
    messages: p.state.messages.list(peer, { device, unread }),
  });
  const botEntry = (body) => {
    if (!body.name || !body.account || !body.identifierKey) throw badRequest("name, account and identifierKey required");
    if (!/^(0x)?[0-9a-f]{64}$/i.test(body.account)) throw badRequest("account must be 32 bytes of hex");
    return { name: String(body.name), account: body.account, username: body.username ?? String(body.name), identifierKey: body.identifierKey, bulletinAccount: body.bulletinAccount ?? null, networkProfile: body.networkProfile ?? null };
  };

  // [method, pattern, handler(params, query, body)] — patterns use :name segments.
  const routes = [
    // The network: which one, its genesis on a real chain, and the node's
    // counters (the seen-store's on a real network: what the personas saw).
    ["GET", "/node", () => ({
      ...networkInfo(),
      url: storeUrl, hopUrl, statements: node.statements.length, allowances: node.allowances?.size ?? null, limits: node.limits ?? {}, clock: node.clock ?? null, faults: node.faults?.list() ?? [],
    })],
    // The HOP pool: every entry it held (bytes never leave the node), who
    // signed it, whether it was claimed and acked, and the faults set on it.
    ["GET", "/hop", () => { mockOnly("the HOP pool view"); return hopView(); }],
    ["POST", "/hop/faults", (_p, _q, body) => {
      mockOnly("a HOP fault");
      const kinds = { refuse: "refuse", cut: "cut", delay: "delay", drop: "drop", corrupt: "corrupt", bloat: "bloat" };
      const kind = kinds[body.kind];
      if (!kind) throw badRequest(`kind must be one of ${Object.keys(kinds).join(", ")}`);
      const opts = {
        ...(body.hash ? { hash: normHex(body.hash) } : {}),
        ...(body.method ? { method: body.method } : {}),
        ...(body.count === undefined ? {} : { count: body.count === null ? null : intParam(body.count, null) }),
        ...(body.ms != null ? { ms: Number(body.ms) } : {}),
        ...(body.bytes != null ? { bytes: Number(body.bytes) } : {}),
      };
      let created;
      try { created = hop.faults[kind](opts); }
      catch (e) { throw badRequest(e.message); }
      return hopFaultOf(created.id);
    }],
    ["DELETE", "/hop/faults/:id", (p) => {
      mockOnly("a HOP fault");
      if (p.id === "all") return { cleared: hop.faults.clear() };
      hopFaultOf(p.id);
      return { cleared: hop.faults.clear(Number(p.id)) };
    }],
    ["GET", "/wire", async (_p, q) => ({
      statements: inspectWire(wireDeps(), {
        topic: hexOf(q.get("topic"), "topic"), signer: q.get("signer") ? (await signersOf(q.get("signer")))[0] : null,
        channel: hexOf(q.get("channel"), "channel"), peer: q.get("peer"), raw: q.get("raw") === "1",
      }),
    })],
    ["GET", "/wire/history", async (_p, q) => {
      if (!q.get("channel")) throw badRequest("channel required");
      return { history: inspectHistory(wireDeps(), { channel: hexOf(q.get("channel"), "channel"), signer: q.get("signer") ? (await signersOf(q.get("signer")))[0] : null, raw: q.get("raw") === "1" }) };
    }],

    // Faults live in the store node; names are resolved here so a scenario
    // can say "drop echobot's next statement on this channel".
    ["GET", "/faults", () => node.faults?.list() ?? []],
    ["POST", "/faults", async (_p, _q, body) => {
      mockOnly("a fault");
      const match = { signer: await signersOf(body.from ?? body.signer), channel: hexOf(body.channel, "channel"), topic: hexOf(body.topic, "topic") };
      const count = body.count === undefined ? undefined : body.count === null ? null : intParam(body.count, null);
      let created;
      try {
        if (body.kind === "drop") created = node.faults.drop({ ...match, ...(count !== undefined ? { count } : {}) });
        else if (body.kind === "delay") created = node.faults.delay({ ...match, ms: Number(body.ms), ...(count !== undefined ? { count } : {}) });
        else if (body.kind === "delaySubmitReply") created = node.faults.delaySubmitReply({ ...match, ms: Number(body.ms), ...(count !== undefined ? { count } : {}) });
        else if (body.kind === "holdDump") created = node.faults.holdDump({ topic: match.topic });
        else throw badRequest("kind must be drop, delay, delaySubmitReply or holdDump");
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw badRequest(e.message);
      }
      return faultOf(created.id);
    }],
    ["DELETE", "/faults/:id", (p) => {
      mockOnly("a fault");
      if (p.id === "all") return { cleared: node.faults.clear() };
      faultOf(p.id);
      return { cleared: node.faults.clear(Number(p.id)) };
    }],
    ["POST", "/clock", (_p, _q, body) => {
      mockOnly("the clock");
      const offset = body.reset ? 0 : Number(body.offsetMs);
      if (!Number.isFinite(offset)) throw badRequest("offsetMs (milliseconds) or reset required");
      return setClock(offset);
    }],
    ["POST", "/node/restart", async () => { mockOnly("a node restart"); await restartNode(); return { ok: true, statements: node.statements.length }; }],
    ["POST", "/node/reset", async () => { mockOnly("a node reset"); await resetNode(); return { ok: true, statements: node.statements.length }; }],

    ["GET", "/accounts", () => directory.list()],
    ["POST", "/accounts", (_p, _q, body) => {
      mockOnly("granting an allowance");
      if (!body.account) throw badRequest("account required");
      return directory.allow(body.account);
    }],
    // `register_lite_person` for an account the sandbox holds no keys for (a
    // bot-core bot): username, identifier-key container, statement allowance,
    // and the Bulletin authorization for its upload signer when named. On a
    // real network registration goes through the identity backend
    // (`pcs user add`, `pca create --network <id>`); see /bots/attach.
    ["POST", "/accounts/register", (_p, _q, body) => {
      mockOnly(`registering an account here (use pcs user add, or pca create --network ${networkInfo().network}, then pcs bot attach)`);
      if (!body.account || !body.username || !body.identifierKey) throw badRequest("account, username and identifierKey required");
      try { return directory.register(body.account, { username: body.username, identifierKey: body.identifierKey, bulletinAccount: body.bulletinAccount ?? null }); }
      catch (e) { throw new ApiError(409, e.message); }
    }],
    // `pca storage grant`'s stand-in: a Bulletin authorization for one account.
    ["POST", "/accounts/:account/bulletin", (p) => {
      mockOnly("a Bulletin allowance grant (use pca storage <bot> grant)");
      try { return directory.grantBulletin(p.account); }
      catch (e) { throw badRequest(e.message); }
    }],
    ["GET", "/consumers/:account", async (p) => (await directory.consumer(p.account)) ?? (() => { throw notFound(`no consumer ${p.account}`); })()],
    // A username search: the mock directory's names, or the identity
    // backend's records each checked against the chain (`onChain`).
    ["GET", "/usernames", async (_p, q) => {
      const prefix = q.get("prefix") ?? "";
      if (directory.search) return directory.search(prefix);
      return directory.list().filter((e) => e.username?.startsWith(prefix)).map((e) => ({ username: e.username, account: e.account, status: "ASSIGNED", onChain: true }));
    }],
    ["GET", "/usernames/:name", async (p) => {
      const account = await directory.usernameOwner(p.name);
      if (!account) throw notFound(`no username ${p.name}`);
      return { username: p.name, ...(await directory.consumer(account)) };
    }],
    // Attached pca bots: their public half, and on a real network whether
    // the chain still holds them (a reset forgets every registration).
    ["GET", "/bots", () => [...bots.values()]],
    ["POST", "/bots/attach", async (_p, _q, body) => {
      try { return await attachBot(botEntry(body)); }
      catch (e) { if (e instanceof ApiError) throw e; throw conflict(e.message); }
    }],

    ["GET", "/personas", () => [...personas.values()].map((p) => p.toJSON())],
    // On a real network an existing name resumes its registration (a
    // pending attestation, a claim after a chain reset) instead of minting
    // again; the daemon refuses a name that is attested and current.
    ["POST", "/personas", async (_p, _q, body) => {
      if (!body.name) throw badRequest("name required");
      if (personas.has(body.name) && networkInfo().mock) throw conflict(`persona ${body.name} exists`);
      const options = { username: body.username ?? null, wait: body.wait ?? null };
      try { return (await addPersona(body.name, intParam(body.devices, 1), options)).toJSON(); }
      catch (e) { throw conflict(e.message); }
    }],
    ["GET", "/personas/:name", (p) => {
      const found = persona(p.name);
      return { ...found.toJSON(), contacts: found.state.contacts.list(), rooms: found.state.messages.rooms(), requests: found.state.requests.list() };
    }],
    ["POST", "/personas/:name/devices", (p) => {
      mockOnly("adding a device (a persona on a real network is single-device)");
      const found = persona(p.name);
      const device = found.addDevice();
      directory.allow(device.account);
      return device.toJSON();
    }],
    ["DELETE", "/personas/:name/devices/:index", async (p) => {
      mockOnly("removing a device");
      const found = persona(p.name);
      try { return (await found.removeDevice(intParam(p.index, 1))).toJSON(); }
      catch (e) { throw new ApiError(409, e.message); }
    }],

    ["POST", "/personas/:name/requests", async (p, _q, body) => {
      const from = persona(p.name);
      const to = await peerOf(body.to);
      const identity = await directory.identityOf(to);
      if (!identity) throw badRequest(`${body.to} is not messageable (no identifier key on this chain)`);
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

    ["GET", "/personas/:name/rooms", async (p) => {
      const found = persona(p.name);
      return Promise.all(found.state.messages.rooms().map(async (r) => ({ ...r, peerName: await nameOf(r.peer) })));
    }],
    // `?format=html`: the room as a page rendered through the UI's markdown
    // pipeline, so an agent can assert on rendering without a browser.
    ["GET", "/personas/:name/rooms/:peer", async (p, q) => {
      const view = await roomView(persona(p.name), await peerOf(p.peer), { device: intParam(q.get("device"), null), unread: q.get("unread") === "1" });
      return q.get("format") === "html" ? new Html(await renderRoom(view)) : view;
    }],
    ["POST", "/personas/:name/rooms/:peer/read", async (p) => {
      const found = persona(p.name);
      found.markRead(await peerOf(p.peer));
      return { ok: true };
    }],
    // Bytes of an attachment this persona sent or claimed (its own media
    // dir only; the id regex in media.mjs is the path guard). The UI shows
    // images from here and nowhere else.
    ["GET", "/personas/:name/media/:id", (p) => {
      const found = persona(p.name).media(p.id);
      if (!found) throw notFound(`no media ${p.id} for ${p.name}`);
      return new FileBody(found.path, found.mime);
    }],
    ["POST", "/personas/:name/rooms/:peer/messages", async (p, _q, body) => {
      const found = persona(p.name);
      const peer = await peerOf(p.peer);
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
        if (body.call) {
          const { messageId } = await found.call(peer, opts);
          return found.state.messages.get(messageId);
        }
        // Raw bytes into the batch (no row): an undecodable message next to good ones.
        if (body.raw) {
          if (!/^0x([0-9a-f]{2})+$/i.test(body.raw)) throw badRequest("raw must be 0x hex");
          const token = await found.sendRaw(peer, Uint8Array.from(Buffer.from(body.raw.slice(2), "hex")), opts);
          return { raw: true, bytes: (body.raw.length - 2) / 2, token };
        }
        // A file from the daemon's host, uploaded through HOP, sent as a rich text with an optional caption.
        if (body.file) {
          if (typeof body.file !== "string" || !path.isAbsolute(body.file)) throw badRequest("file must be an absolute path on the daemon's host");
          if (body.text != null && typeof body.text !== "string") throw badRequest("text must be a string");
          const { messageId } = await found.sendFile(peer, { path: body.file, text: body.text ?? null }, opts);
          return found.state.messages.get(messageId);
        }
        if (typeof body.text !== "string") throw badRequest("text, react, edit, call or raw required");
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
    // WebKit fires EventSource `open` only once body bytes arrive; Chromium
    // fires it on the headers. Send a comment at once so both report "Live"
    // instead of "Connecting…" until the first event or the 15 s ping.
    res.write(": connected\n\n");
    const write = (e) => res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${toJson(e)}\n\n`);
    const since = Number(url.searchParams.get("since") ?? req.headers["last-event-id"] ?? 0);
    for (const e of events.since(since)) write(e);
    const stop = events.subscribe(write);
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => { clearInterval(keepAlive); stop(); });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    // Every route lives under `/api` — the UI, the CLI, the tests and bot-core
    // all use that one prefix (decisions.md D4). Anything else is the built UI.
    const pathname = url.pathname.startsWith("/api/") ? url.pathname.slice(4) : null;
    const send = (status, body) => {
      if (body instanceof Html) {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        return res.end(body.body);
      }
      if (body instanceof FileBody) {
        res.writeHead(status, { "content-type": body.type, "content-length": fs.statSync(body.file).size });
        return fs.createReadStream(body.file).pipe(res);
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(toJson(body));
    };
    try {
      if (req.method === "GET" && pathname === "/events") return serveEvents(req, res, url);
      for (const route of pathname ? routes : []) {
        if (route.method !== req.method) continue;
        const match = pathname.match(route.regex);
        if (!match) continue;
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
        const body = req.method === "POST" || req.method === "DELETE" ? await readBody(req) : {};
        return send(200, await route.handler(params, url.searchParams, body));
      }
      const asset = req.method === "GET" && !pathname ? staticFile(staticDir, url.pathname) : null;
      if (asset) {
        res.writeHead(200, { "content-type": asset.type });
        return fs.createReadStream(asset.file).pipe(res);
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
