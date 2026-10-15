// SPDX-License-Identifier: GPL-3.0-or-later

// An in-memory Statement Store node speaking the two JSON-RPC methods T3ams
// uses: `statement_submit` and the `statement_subscribeStatement`
// subscription (with replay of what is stored, like a real node). It keeps
// every statement and never checks proofs or allowances: it exists so two
// headless T3ams clients can talk without a chain.

import { WebSocketServer } from "ws";
import { statementCodec } from "@novasamatech/sdk-statement";

const matches = (filter, statement) => {
  if (filter === "any") return true;
  const topics = statement.topics ?? [];
  if (Array.isArray(filter?.matchAny)) return topics.some((t) => filter.matchAny.includes(t));
  if (Array.isArray(filter?.matchAll)) return filter.matchAll.every((t) => topics.includes(t));
  return false;
};

export async function startStatementNode() {
  const stored = []; // { encoded, decoded }
  const subscriptions = new Map(); // id -> { socket, filter }
  let nextId = 1;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));

  const push = (id, sub, encodedList) => {
    sub.socket.send(JSON.stringify({
      jsonrpc: "2.0",
      method: "statement_statement",
      params: { subscription: id, result: { event: "newStatements", data: { statements: encodedList, remaining: 0 } } },
    }));
  };

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(String(raw));
      const reply = (result) => socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      switch (request.method) {
        case "rpc_methods":
          reply({ methods: ["rpc_methods", "statement_submit", "statement_subscribeStatement", "statement_unsubscribeStatement"] });
          break;
        case "statement_submit": {
          const encoded = request.params[0];
          const decoded = statementCodec.dec(encoded);
          // One statement per (signer, channel), like the real store.
          const signer = decoded.proof?.value?.signer;
          if (decoded.channel != null) {
            const index = stored.findIndex((s) => s.decoded.channel === decoded.channel && s.decoded.proof?.value?.signer === signer);
            if (index !== -1) stored.splice(index, 1);
          }
          stored.push({ encoded, decoded });
          reply({ status: "new" });
          for (const [id, sub] of subscriptions) if (matches(sub.filter, decoded)) push(id, sub, [encoded]);
          break;
        }
        case "statement_subscribeStatement": {
          const id = `sub-${nextId++}`;
          const sub = { socket, filter: request.params[0] };
          subscriptions.set(id, sub);
          reply(id);
          const replay = stored.filter((s) => matches(sub.filter, s.decoded)).map((s) => s.encoded);
          setTimeout(() => push(id, sub, replay), 0);
          break;
        }
        case "statement_unsubscribeStatement":
          subscriptions.delete(request.params[0]);
          reply(true);
          break;
        default:
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `unsupported: ${request.method}` } }));
      }
    });
    socket.on("close", () => {
      for (const [id, sub] of subscriptions) if (sub.socket === socket) subscriptions.delete(id);
    });
  });

  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    statements: () => stored.map((s) => s.decoded),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
