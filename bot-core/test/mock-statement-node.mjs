// In-memory statement-store node for offline transport tests.
//
// Speaks just enough of the statement JSON-RPC surface for bot-core and the
// test clients: statement_submit, statement_subscribeStatement (initial dump +
// live pushes, remaining=0 pages), statement_unsubscribeStatement. Statements
// on the same (signer, channel) replace each other, mirroring the real store's
// channel semantics. Everything else answers "method not found", which the
// unused papi internals tolerate.
//
// Usable as a module (start/stop from tests) or standalone:
//   node test/mock-statement-node.mjs --port 9944

import { WebSocketServer } from "ws";
import { statementCodec } from "@novasamatech/sdk-statement";

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const stripHex = (h) => String(h).replace(/^0x/i, "").toLowerCase();

// A stored statement: { hex, topics: [bareHex], signer: bareHex|null, channel: bareHex|null }
function decodeStored(hexWithPrefix) {
  const decoded = statementCodec.dec(hexWithPrefix);
  const topics = (decoded.topics ?? []).map((t) => stripHex(typeof t === "string" ? t : toHex(t)));
  const channel = decoded.channel == null ? null
    : stripHex(typeof decoded.channel === "string" ? decoded.channel : toHex(decoded.channel));
  const signerBytes = decoded.proof?.value?.signer ?? null;
  const signer = signerBytes == null ? null
    : stripHex(typeof signerBytes === "string" ? signerBytes : toHex(signerBytes));
  return { hex: hexWithPrefix, topics, signer, channel };
}

function matchesFilter(stored, filter) {
  if (filter === "any" || filter == null) return true;
  if (Array.isArray(filter.matchAll)) {
    return filter.matchAll.every((t) => stored.topics.includes(stripHex(t)));
  }
  if (Array.isArray(filter.matchAny)) {
    return filter.matchAny.some((t) => stored.topics.includes(stripHex(t)));
  }
  return false;
}

export function startMockStatementNode({ port = 0, host = "127.0.0.1" } = {}) {
  const statements = []; // insertion order
  const subs = new Map(); // subId -> { ws, filter }
  let nextSub = 1;

  const wss = new WebSocketServer({ port, host });

  const notify = (ws, subId, page) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      method: "statement_subscribeStatement",
      params: { subscription: subId, result: page },
    }));
  };

  wss.on("connection", (ws) => {
    ws.on("close", () => {
      for (const [id, sub] of subs) if (sub.ws === ws) subs.delete(id);
    });
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (process.env.MOCK_DEBUG) console.error("[mock] <-", msg.method, msg.id ?? "");
      const reply = (result) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      const replyError = (code, message) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code, message } }));

      // papi probes rpc_methods on connect and treats an error reply as a dead
      // endpoint (reconnect loop). Advertise the modern method names so its
      // translator passes requests through untouched.
      if (msg.method === "rpc_methods") {
        return reply({
          methods: [
            "statement_submit", "statement_subscribeStatement", "statement_unsubscribeStatement",
            "chainHead_v1_follow", "chainHead_v1_unfollow", "chainHead_v1_body", "chainHead_v1_call",
            "chainHead_v1_header", "chainHead_v1_storage", "chainHead_v1_stopOperation",
            "chainHead_v1_continue", "chainHead_v1_unpin",
            "chainSpec_v1_chainName", "chainSpec_v1_genesisHash", "chainSpec_v1_properties",
          ],
        });
      }
      if (msg.method === "chainSpec_v1_chainName") return reply("mock-statement-node");
      if (msg.method === "chainSpec_v1_genesisHash") return reply(`0x${"00".repeat(32)}`);
      if (msg.method === "chainSpec_v1_properties") return reply({});
      // papi eagerly opens a chainHead follow and treats an error reply as a
      // dead endpoint. Hand it a subscription id and stay silent — the
      // statement paths under test never consume chainHead events.
      if (msg.method === "chainHead_v1_follow") return reply(`mock-follow-${nextSub++}`);
      if (msg.method === "chainHead_v1_unfollow") return reply(null);

      if (msg.method === "statement_submit") {
        let stored;
        try { stored = decodeStored(msg.params[0]); }
        catch (e) { return reply({ status: "invalid", reason: String(e?.message ?? e) }); }
        // Channel semantics: a statement replaces the previous one from the
        // same signer on the same channel (that's what channels are for).
        if (stored.signer && stored.channel) {
          const i = statements.findIndex((s) => s.signer === stored.signer && s.channel === stored.channel);
          if (i >= 0) statements.splice(i, 1);
        }
        statements.push(stored);
        for (const [id, sub] of subs) {
          if (matchesFilter(stored, sub.filter)) {
            notify(sub.ws, id, { event: "newStatements", data: { statements: [stored.hex], remaining: 0 } });
          }
        }
        return reply({ status: "new" });
      }

      if (msg.method === "statement_subscribeStatement") {
        const filter = msg.params?.[0] ?? "any";
        const subId = `mock-sub-${nextSub++}`;
        subs.set(subId, { ws, filter });
        reply(subId);
        // Initial dump: everything currently matching, as one complete page.
        const dump = statements.filter((s) => matchesFilter(s, filter)).map((s) => s.hex);
        notify(ws, subId, { event: "newStatements", data: { statements: dump, remaining: 0 } });
        return;
      }

      if (msg.method === "statement_unsubscribeStatement") {
        const subId = msg.params?.[0];
        reply(subs.delete(subId));
        return;
      }

      return replyError(-32601, `Method not found: ${msg.method}`);
    });
  });

  return new Promise((resolve, reject) => {
    wss.on("error", reject);
    wss.on("listening", () => {
      const boundPort = wss.address().port;
      resolve({
        port: boundPort,
        url: `ws://${host}:${boundPort}`,
        statements, // live reference, for assertions
        close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }),
      });
    });
  });
}

// Standalone: node test/mock-statement-node.mjs --port 9944
if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 9944;
  const node = await startMockStatementNode({ port });
  console.log(`mock statement node listening on ${node.url}`);
}
