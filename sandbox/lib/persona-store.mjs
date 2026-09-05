// What the sandbox keeps on disk for a real network. On the mock network a
// persona is minted per daemon run and the mock directory forgets with it;
// on a testnet a persona's identity is registered on a chain that outlives the
// daemon, so its keys, its username and where its registration stands are
// persisted under the state dir (0700), one 0600 file per persona holding
// the mnemonic. Attached bots and the chain identity are recorded beside
// them. Nothing here logs a secret.

import fs from "node:fs";
import path from "node:path";

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};
const NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export function createPersonaStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const personaFile = (name) => {
    if (!NAME.test(name)) throw new Error(`invalid persona name: ${name}`);
    return path.join(dir, "personas", name, "identity.json");
  };
  const botsFile = path.join(dir, "bots.json");
  const networkFile = path.join(dir, "network.json");
  return {
    dir,
    /** Every persisted persona record, by name. */
    loadPersonas() {
      const root = path.join(dir, "personas");
      if (!fs.existsSync(root)) return new Map();
      const out = new Map();
      for (const name of fs.readdirSync(root).sort()) {
        const record = readJson(path.join(root, name, "identity.json"));
        if (record?.name === name && typeof record.mnemonic === "string") out.set(name, record);
      }
      return out;
    },
    savePersona: (record) => writeJson(personaFile(record.name), record),
    loadBots: () => readJson(botsFile) ?? [],
    saveBots: (bots) => writeJson(botsFile, bots),
    /** The chain identity of the last run: `{ network, genesis, seenAt }`, or null. */
    loadNetwork: () => readJson(networkFile),
    saveNetwork: (info) => writeJson(networkFile, info),
  };
}

/**
 * Mark what a chain reset invalidated: a registration made on another
 * genesis is gone from this chain. Returns the names it marked.
 */
export function markChainReset(records, genesis) {
  const marked = [];
  for (const record of records) {
    const registered = record.registration?.genesis ?? record.genesis ?? null;
    if (registered == null || registered === genesis) continue;
    if (record.registration) record.registration.needsReregistration = true;
    else record.needsReregistration = true;
    marked.push(record.name);
  }
  return marked;
}
