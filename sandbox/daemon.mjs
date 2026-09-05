#!/usr/bin/env node
// The sandbox daemon: store node, directory, personas and the control API in
// one process. `pcs up` runs this; tests start it in-process on random ports.
//
// Personas reach the store node the way Polkadot Desktop does — a WebSocket
// per device through papi's provider and the SDK's adapter — so the node is
// exercised over the wire, not through an in-memory shortcut.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws";

import { createApi } from "./lib/api.mjs";
import { hexToBytes, log, normHex } from "./lib/bytes.mjs";
import { createDirectory } from "./lib/directory.mjs";
import { startHopNode } from "./lib/hop-node.mjs";
import { createPersona } from "./lib/persona.mjs";
import { startStoreNode } from "./lib/store-node.mjs";

export const DEFAULT_PORT = 7788;
export const defaultDir = () => path.join(os.homedir(), ".pca", "sandbox", "default");
const UI_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui", "dist");
const EVENT_BUFFER = 5000;

/** Ordered event log with a bounded replay buffer, for SSE `since` catch-up. */
function createEvents() {
  const buffer = [];
  const listeners = new Set();
  let seq = 0;
  return {
    emit(type, data) {
      const event = { seq: ++seq, ts: new Date().toISOString(), type, ...data };
      buffer.push(event);
      if (buffer.length > EVENT_BUFFER) buffer.shift();
      for (const fn of listeners) fn(event);
    },
    since: (n) => buffer.filter((e) => e.seq > n),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export async function startDaemon({ dir = defaultDir(), port = DEFAULT_PORT, host = "127.0.0.1", storePort = 0 } = {}) {
  // The state dir will hold persona seeds once persistence lands; private from day one.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);

  const allowances = new Set();
  const node = await startStoreNode({ port: storePort, host, allowances });
  // The HOP node beside the store node: attachments' bytes live there, and
  // its allowance set is the Bulletin storage authorization the directory
  // grants at registration.
  const hopAllowances = new Set();
  const hop = await startHopNode({ host, allowances: hopAllowances });
  const directory = createDirectory({ allowances, hopAllowances });
  const personas = new Map();
  const events = createEvents();
  const clients = [];

  // Store events are "wire"; faults and node restarts get their own types so
  // `pcs events` readers can tell a broken network from a chatty one. The
  // pool's events are "hop".
  node.watch((e) => events.emit(e.event === "fault" ? "fault" : e.event === "node" ? "node" : "wire", e));
  hop.watch((e) => events.emit("hop", e));

  const lookup = {
    getPeerIdentity: async (accountId) => {
      const found = directory.identityOf(accountId);
      return found ? { accountId, username: found.username, chatPublicKey: found.chatPublicKey } : null;
    },
  };
  const makeStatementStore = () => {
    const client = createLazyClient(getWsProvider(node.url));
    clients.push(client);
    return createPapiStatementStoreAdapter(client);
  };
  const transport = { makeStatementStore, lookup, onEvent: (e) => events.emit("engine", e) };

  const addPersona = async (name, devices) => {
    // Attachments a persona sends or claims live under its own media dir.
    const persona = createPersona({ name, devices, hopUrl: hop.url, mediaDir: path.join(dir, "personas", name, "media") });
    persona.register(directory);
    personas.set(name, persona);
    persona.state.onChange((change) => events.emit(change.type, { persona: name, ...change }));
    persona.start(transport);
    events.emit("persona", { persona: name, devices });
    log("SANDBOX_PERSONA_UP", { name, account: persona.account, devices });
    return persona;
  };

  // Disposed sessions send their unsubscribes over the socket; destroying the
  // papi client first rejects those in flight (DestroyedError) inside the SDK
  // where nothing catches them. Let them round-trip.
  const dropClients = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const c of clients.splice(0)) c.disconnect();
  };
  // After the node drops its sockets a raw statement subscription is gone and
  // papi's reconnect does not re-open it — the web client rebuilds its
  // sessions after a drop, and so does every persona here: fresh clients,
  // fresh engines, the same state (contacts, rooms, un-acked rows), the way
  // an app restores after the network came back.
  const rewire = async (restartNode) => {
    for (const p of personas.values()) p.stop();
    await dropClients();
    restartNode();
    for (const p of personas.values()) p.start(transport);
  };

  /** A persona name, a directory username or an account hex → account hex. */
  const resolvePeer = (value) => {
    if (value == null) return null;
    if (/^(0x)?[0-9a-f]{64}$/i.test(value)) return normHex(value);
    return personas.get(value)?.account ?? directory.usernameOwner(value) ?? null;
  };

  const setClock = (offsetMs) => {
    node.clock.offsetMs = offsetMs;
    events.emit("clock", { offsetMs });
    log("SANDBOX_CLOCK", { offsetMs });
    return { ...node.clock };
  };

  // The built web UI, when `npm run build` in sandbox/ui has produced it.
  const staticDir = fs.existsSync(path.join(UI_DIST, "index.html")) ? UI_DIST : null;
  const api = createApi({
    node, hop, directory, personas, events, addPersona, resolvePeer, storeUrl: node.url, setClock,
    restartNode: () => rewire(() => node.restart()),
    resetNode: () => rewire(() => node.reset()),
    staticDir,
  });
  const apiPort = await api.listen(port, host);
  const url = `http://${host}:${apiPort}`;
  fs.writeFileSync(path.join(dir, "daemon.json"), JSON.stringify({ url, storeUrl: node.url, hopUrl: hop.url, pid: process.pid, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  log("SANDBOX_UP", { url, storeUrl: node.url, hopUrl: hop.url, dir, ui: staticDir != null });

  return {
    url,
    storeUrl: node.url,
    hopUrl: hop.url,
    dir,
    node,
    hop,
    directory,
    personas,
    events,
    addPersona,
    resolvePeer,
    async stop() {
      for (const p of personas.values()) p.stop();
      await dropClients();
      await api.close();
      await node.close();
      await hop.close();
      try { fs.rmSync(path.join(dir, "daemon.json")); } catch { /* already gone */ }
      log("SANDBOX_DOWN");
    },
  };
}

export { hexToBytes };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, fallback) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : fallback; };
  const daemon = await startDaemon({ dir: opt("dir", defaultDir()), port: Number(opt("port", DEFAULT_PORT)), storePort: Number(opt("store-port", 0)) });
  const shutdown = () => daemon.stop().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
