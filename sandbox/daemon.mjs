#!/usr/bin/env node
// The sandbox daemon: the network, the personas and the control API in one
// process. `pcs up` runs this; tests start it in-process on random ports.
//
// Two networks (lib/network.mjs). `mock` (the default): a store node, a HOP
// node and a directory that plays the People chain and the identity
// backend, all on this machine. `paseo`: the real Paseo Next network — the
// People chain's statement store and Resources pallet, Parity's identity
// backend, the Bulletin HOP nodes — so personas chat with deployed bots and
// with a phone. Personas reach the store the way Polkadot Desktop does — a
// WebSocket per device through papi's provider and the SDK's adapter — so
// the node is exercised over the wire on both networks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLazyClient, createPapiStatementStoreAdapter } from "@novasamatech/statement-store";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";

import { createApi } from "./lib/api.mjs";
import { hexToBytes, log, normHex } from "./lib/bytes.mjs";
import { createChainDirectory } from "./lib/chain-directory.mjs";
import { createDirectory } from "./lib/directory.mjs";
import { startHopNode } from "./lib/hop-node.mjs";
import { DEFAULT_NETWORK, networkProfile } from "./lib/network.mjs";
import { createPersona } from "./lib/persona.mjs";
import { createPersonaStore, markChainReset } from "./lib/persona-store.mjs";
import { DEFAULT_WAIT_MS, keysOf, mintPersonaRecord, provisionBulletin, registerPersona, registrationView } from "./lib/registration.mjs";
import { createSeenStore, observeLazyClient } from "./lib/seen-store.mjs";
import { startStoreNode } from "./lib/store-node.mjs";

export const DEFAULT_PORT = 7788;
export const defaultDir = () => path.join(os.homedir(), ".pca", "sandbox", "default");
const UI_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui", "dist");
const EVENT_BUFFER = 5000;
const CHAIN_TIMEOUT_MS = 30_000;

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

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms).unref?.()),
]);

// ── The mock network: every part in this process ─────────────────────────

async function startMockNetwork({ host, storePort }) {
  const allowances = new Set();
  const node = await startStoreNode({ port: storePort, host, allowances });
  // The HOP node beside the store node: attachments' bytes live there, and
  // its allowance set is the Bulletin storage authorization the directory
  // grants at registration.
  const hopAllowances = new Set();
  const hop = await startHopNode({ host, allowances: hopAllowances });
  const directory = createDirectory({ allowances, hopAllowances });
  const clients = [];
  return {
    profile: networkProfile("mock"),
    genesis: null,
    node,
    hop,
    hopUrl: hop.url,
    storeUrl: node.url,
    directory,
    makeStatementStore: () => {
      const client = createLazyClient(getWsProvider(node.url));
      clients.push(client);
      return createPapiStatementStoreAdapter(client);
    },
    clients,
    async close() { await node.close(); await hop.close(); },
  };
}

// ── Paseo Next: the real network ─────────────────────────────────────────

async function startPaseoNetwork({ profile, fetchImpl }) {
  // One papi client for chain reads (the directory) and the genesis; the
  // personas' statement traffic rides their own lazy clients, mirrored into
  // the seen-store so `pcs wire` shows what their subscriptions saw.
  const chain = createClient(getWsProvider([...profile.peopleEndpoints]));
  let genesis;
  try {
    genesis = normHex((await withTimeout(chain.getChainSpecData(), CHAIN_TIMEOUT_MS, `${profile.name} connect`)).genesisHash);
  } catch (error) {
    chain.destroy();
    throw new Error(`cannot reach ${profile.name} at ${profile.peopleEndpoints[0]}: ${error.message}`);
  }
  const directory = createChainDirectory({ client: chain, backendUrl: profile.identityBackendUrl, fetchImpl });
  const seen = createSeenStore();
  const clients = [];
  return {
    profile,
    genesis,
    node: seen,
    hop: null,
    hopUrl: profile.hopUploadNode,
    storeUrl: profile.peopleEndpoints[0],
    directory,
    makeStatementStore: () => {
      const client = createLazyClient(getWsProvider([...profile.peopleEndpoints]));
      clients.push(client);
      return createPapiStatementStoreAdapter(observeLazyClient(client, seen));
    },
    clients,
    async close() { chain.destroy(); },
  };
}

export async function startDaemon({ dir = defaultDir(), port = DEFAULT_PORT, host = "127.0.0.1", storePort = 0, network = DEFAULT_NETWORK, fetchImpl = fetch, waitMs = DEFAULT_WAIT_MS } = {}) {
  const profile = networkProfile(network);
  // The state dir holds persona seeds on a real network; private from day one.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);

  const net = profile.mock ? await startMockNetwork({ host, storePort }) : await startPaseoNetwork({ profile, fetchImpl });
  const { node, hop, directory, genesis } = net;
  const personas = new Map();
  const records = new Map(); // name -> persisted record (paseo only)
  const bots = new Map(); // name -> attached bot { name, account, username, identifierKey, bulletinAccount, genesis, onChain, needsReregistration }
  const events = createEvents();
  const store = profile.mock ? null : createPersonaStore(dir);

  // Store events are "wire"; faults and node restarts get their own types so
  // `pcs events` readers can tell a broken network from a chatty one. The
  // pool's events are "hop".
  node.watch((e) => events.emit(e.event === "fault" ? "fault" : e.event === "node" ? "node" : "wire", e));
  hop?.watch((e) => events.emit("hop", e));

  const lookup = {
    getPeerIdentity: async (accountId) => {
      const found = await directory.identityOf(accountId);
      return found ? { accountId, username: found.username, chatPublicKey: found.chatPublicKey } : null;
    },
  };
  const transport = { makeStatementStore: net.makeStatementStore, lookup, onEvent: (e) => events.emit("engine", e) };

  const wirePersona = (persona) => {
    personas.set(persona.name, persona);
    persona.state.onChange((change) => events.emit(change.type, { persona: persona.name, ...change }));
    persona.start(transport);
  };
  const mediaDirOf = (name) => path.join(dir, "personas", name, "media");

  // ── Personas on the mock network: minted, registered in the directory, gone with the daemon ──
  const addMockPersona = async (name, devices) => {
    const persona = createPersona({ name, devices, hopUrl: net.hopUrl, mediaDir: mediaDirOf(name) });
    persona.register(directory);
    wirePersona(persona);
    events.emit("persona", { persona: name, devices });
    log("SANDBOX_PERSONA_UP", { name, account: persona.account, devices });
    return persona;
  };

  // ── Personas on paseo: persisted, registered through the identity backend ──
  const save = async (record) => {
    store.savePersona(record);
    const persona = personas.get(record.name);
    if (persona) { persona.username = record.username ?? persona.username; persona.registration = registrationView(record); }
    events.emit("persona", { persona: record.name, registration: registrationView(record) });
  };
  const restorePersona = (record) => {
    const keys = keysOf(record);
    const persona = createPersona({ name: record.name, identity: keys.identity, deviceKeys: keys.deviceKeys, bulletin: keys.bulletin, hopUrl: net.hopUrl, mediaDir: mediaDirOf(record.name) });
    persona.username = record.username ?? record.name;
    persona.registration = registrationView(record);
    directory.remember({ account: keys.account, username: record.username ?? null, identifierKey: keys.identifierKey, bulletinAccount: keys.bulletin.account });
    records.set(record.name, record);
    wirePersona(persona);
    return persona;
  };
  const registrationDeps = { backendUrl: profile.identityBackendUrl, directory, genesis, save, waitMs, fetchImpl, onProgress: (text) => events.emit("persona", { persona: null, progress: text }) };
  const registerOrResume = async (record) => {
    const view = await registerPersona(record, { ...registrationDeps, waitMs });
    if (record.username) directory.remember({ account: keysOf(record).account, username: record.username });
    return view;
  };
  const addPaseoPersona = async (name, devices, { username = null, wait = null } = {}) => {
    if (devices !== 1) throw new Error(`a persona on ${profile.name} is single-device (the identity account is its device; only the phone can mint a second one)`);
    const waitFor = wait == null ? waitMs : Number(wait) * 1000;
    const existing = records.get(name);
    if (existing) {
      // Resume: keep waiting for a pending attestation, or claim again after a reset. Never re-mint.
      const view = registrationView(existing);
      if (view.status === "attested") throw new Error(`persona ${name} exists (registered as ${existing.username})`);
      log("SANDBOX_PERSONA_RESUME", { name, status: view.status, bulletin: view.bulletin });
      // A pending or failed allowance is re-read (and granted only if still missing) alongside the wait.
      await Promise.all([
        registerPersona(existing, { ...registrationDeps, waitMs: waitFor }),
        existing.bulletin?.status === "authorized" ? null : provisionBulletin(existing, { botProfile: profile.botProfile, save }),
      ]);
      if (existing.username) directory.remember({ account: keysOf(existing).account, username: existing.username });
      return personas.get(name);
    }
    const record = mintPersonaRecord(name, { username, genesis });
    store.savePersona(record);
    const persona = restorePersona(record);
    log("SANDBOX_PERSONA_UP", { name, account: persona.account, devices: 1, username: record.usernameBase });
    // The Bulletin allowance is independent of the People registration; both take a minute, so they run together.
    const [view] = await Promise.all([
      registerPersona(record, { ...registrationDeps, waitMs: waitFor }),
      provisionBulletin(record, { botProfile: profile.botProfile, save }),
    ]);
    if (record.username) directory.remember({ account: persona.account, username: record.username });
    events.emit("persona", { persona: name, devices: 1, registration: view });
    return persona;
  };
  const addPersona = (name, devices, options) => (profile.mock ? addMockPersona(name, devices) : addPaseoPersona(name, devices, options));

  // ── Attached bots (`pcs bot attach`): a pca bot's public half ──
  const persistBots = () => store?.saveBots([...bots.values()]);
  const attachBot = async ({ name, account, username, identifierKey, bulletinAccount = null, networkProfile: botNetwork = null }) => {
    const acct = normHex(account);
    if (profile.mock) {
      // The mock's `register_lite_person`: username, key, allowances.
      const entry = directory.register(acct, { username, identifierKey, bulletinAccount });
      bots.set(name, { name, ...entry, onChain: true, needsReregistration: false, networkProfile: botNetwork });
      return bots.get(name);
    }
    // On a real network the bot registered itself through the backend; the
    // sandbox only checks that the chain holds it (a reset forgets it).
    const consumer = await directory.consumer(acct);
    const onChain = consumer != null;
    const entry = { name, account: acct, username: consumer?.username ?? username, identifierKey: consumer?.identifierKey ?? normHex(identifierKey), bulletinAccount: bulletinAccount ? normHex(bulletinAccount) : null, genesis: onChain ? genesis : null, onChain, needsReregistration: !onChain, networkProfile: botNetwork, attachedAt: new Date().toISOString() };
    directory.remember(entry);
    bots.set(name, entry);
    persistBots();
    return entry;
  };

  /** A persona name, an attached bot's name, a directory username or an account hex → account hex. */
  const resolvePeer = async (value) => {
    if (value == null) return null;
    if (/^(0x)?[0-9a-f]{64}$/i.test(value)) return normHex(value);
    const local = personas.get(value)?.account ?? bots.get(value)?.account ?? [...personas.values()].find((p) => p.username === value)?.account ?? null;
    if (local) return local;
    const owner = await directory.usernameOwner(value);
    if (owner || profile.mock || /\.\d{2}$/.test(value)) return owner;
    // A base name without its number: the backend's search, one live hit only.
    const hits = (await directory.search(value)).filter((h) => h.onChain);
    if (hits.length === 1) return hits[0].account;
    if (hits.length > 1) throw new Error(`${value} is ambiguous: ${hits.map((h) => h.username).join(", ")}`);
    return null;
  };

  // ── Restore (paseo): persisted personas and bots, and the chain reset check ──
  let chainReset = null;
  if (store) {
    const previous = store.loadNetwork();
    const loaded = [...store.loadPersonas().values()];
    const attached = store.loadBots();
    const markedPersonas = markChainReset(loaded, genesis);
    const markedBots = markChainReset(attached, genesis);
    if (previous?.genesis && previous.genesis !== genesis) {
      chainReset = { previous: previous.genesis, current: genesis, since: previous.seenAt ?? null, personas: markedPersonas, bots: markedBots };
      log("SANDBOX_CHAIN_RESET", chainReset);
    }
    for (const record of loaded) { if (markedPersonas.includes(record.name)) store.savePersona(record); }
    for (const bot of attached) { bots.set(bot.name, { ...bot, onChain: !bot.needsReregistration && bot.onChain }); directory.remember(bot); }
    if (markedBots.length) persistBots();
    for (const record of loaded) restorePersona(record);
    store.saveNetwork({ network: profile.id, genesis, seenAt: new Date().toISOString() });
    // A claim made before the last stop may have been attested meanwhile: one check, off the start path.
    for (const record of loaded) {
      if (record.registration.status !== "claimed" || record.registration.needsReregistration) continue;
      void directory.identifierKeyFor(keysOf(record).account).then((key) => {
        if (key == null) return;
        record.registration.status = "attested";
        record.registration.attestedAt = new Date().toISOString();
        return save(record);
      }).catch(() => undefined);
    }
  }

  // Disposed sessions send their unsubscribes over the socket; destroying the
  // papi client first rejects those in flight (DestroyedError) inside the SDK
  // where nothing catches them. Let them round-trip.
  const dropClients = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const c of net.clients.splice(0)) c.disconnect();
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

  const setClock = (offsetMs) => {
    node.clock.offsetMs = offsetMs;
    events.emit("clock", { offsetMs });
    log("SANDBOX_CLOCK", { offsetMs });
    return { ...node.clock };
  };

  // The built web UI, when `npm run build` in sandbox/ui has produced it.
  const staticDir = fs.existsSync(path.join(UI_DIST, "index.html")) ? UI_DIST : null;
  const networkInfo = () => ({ network: profile.id, name: profile.name, mock: profile.mock, genesis, identityBackendUrl: profile.identityBackendUrl, chainReset });
  const api = createApi({
    node, hop, directory, personas, bots, events, addPersona, attachBot, resolvePeer, storeUrl: net.storeUrl, hopUrl: net.hopUrl, setClock, networkInfo,
    restartNode: () => rewire(() => node.restart()),
    resetNode: () => rewire(() => node.reset()),
    staticDir,
  });
  const apiPort = await api.listen(port, host);
  const url = `http://${host}:${apiPort}`;
  fs.writeFileSync(path.join(dir, "daemon.json"), JSON.stringify({ url, network: profile.id, genesis, storeUrl: net.storeUrl, hopUrl: net.hopUrl, pid: process.pid, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  log("SANDBOX_UP", { url, network: profile.id, genesis, storeUrl: net.storeUrl, hopUrl: net.hopUrl, dir, ui: staticDir != null, personas: [...personas.keys()] });

  return {
    url,
    network: profile.id,
    genesis,
    chainReset,
    storeUrl: net.storeUrl,
    hopUrl: net.hopUrl,
    dir,
    node,
    hop,
    directory,
    personas,
    bots,
    events,
    addPersona,
    attachBot,
    resolvePeer,
    /** Resume a pending or reset registration (paseo). */
    register: (name) => registerOrResume(records.get(name) ?? (() => { throw new Error(`no persona ${name}`); })()),
    async stop() {
      for (const p of personas.values()) p.stop();
      await dropClients();
      await api.close();
      await net.close();
      try { fs.rmSync(path.join(dir, "daemon.json")); } catch { /* already gone */ }
      log("SANDBOX_DOWN");
    },
  };
}

export { hexToBytes };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, fallback) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : fallback; };
  const daemon = await startDaemon({ dir: opt("dir", defaultDir()), port: Number(opt("port", DEFAULT_PORT)), storePort: Number(opt("store-port", 0)), network: opt("network", DEFAULT_NETWORK) });
  const shutdown = () => daemon.stop().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
