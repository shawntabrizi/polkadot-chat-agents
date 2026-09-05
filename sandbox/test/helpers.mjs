// Test helpers: throwaway identities and devices with real keys, so the
// session provers and the identity proof verify for real, and a directory-
// backed lookup like the daemon's.

import { createInMemoryStatementStore } from "@novasamatech/statement-store";

import { createDirectory } from "../lib/directory.mjs";
import { mintDeviceKeys } from "../lib/device.mjs";
import { createPersonaState, mintIdentityKeys } from "../lib/persona.mjs";
import { createChatEngine } from "../lib/chat.mjs";
import { bytesToHex } from "../lib/bytes.mjs";

/**
 * The SDK's in-memory store, with one real-node behaviour added: a fresh
 * subscription first dumps what already matches. The SDK's sessions rely on
 * that dump when a roster change re-opens their subscription (a statement
 * published before the peer learned our device must still arrive), and the
 * store node does it; the bare in-memory adapter only pushes.
 */
export const makeStore = () => {
  const store = createInMemoryStatementStore();
  return {
    ...store,
    subscribeStatements(filter, callback) {
      const unsubscribe = store.subscribeStatements(filter, callback);
      let live = true;
      queueMicrotask(() => {
        const dump = store.currentStatements().filter((s) => {
          const topics = s.topics ?? [];
          return "matchAll" in filter ? filter.matchAll.every((t) => topics.includes(bytesToHex(t))) : filter.matchAny.some((t) => topics.includes(bytesToHex(t)));
        });
        if (live && dump.length > 0) callback({ statements: dump, isComplete: true });
      });
      return () => { live = false; unsubscribe(); };
    },
  };
};

/** A user with one device, as both sides of every test see them. */
export const makePeer = () => ({ identity: mintIdentityKeys(), device: mintDeviceKeys() });

/** A lookup that knows the given peers, the way the daemon's directory does. */
export const lookupOf = (...peers) => {
  const directory = createDirectory({ allowances: new Set() });
  for (const [i, peer] of peers.entries()) {
    directory.register(peer.identity.identityAccountId, { username: `user-${i}`, identifierKey: peer.identity.identityChatPublicKey });
  }
  return {
    getPeerIdentity: async (accountId) => {
      const found = directory.identityOf(accountId);
      return found ? { accountId, username: found.username, chatPublicKey: found.chatPublicKey } : null;
    },
  };
};

/** A one-device engine over a fresh persona state; what the web client's manager is. */
export const openEngine = (peer, statementStore, lookup, extra = {}) => {
  const state = createPersonaState();
  const engine = createChatEngine({
    identity: peer.identity,
    deviceKeys: peer.device,
    deviceIndex: 1,
    state,
    statementStore,
    lookup,
    ownDevices: () => [{ statementAccountId: peer.device.statementAccountId, encryptionPublicKey: peer.device.encryptionPublicKey }],
    ...extra,
  });
  return { engine, state };
};

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Poll until `probe` returns a truthy value; sessions settle over several macrotask turns. */
export const waitFor = async (probe, { attempts = 400, everyMs = 5 } = {}) => {
  for (let i = 0; i < attempts; i++) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  throw new Error("waitFor: condition not met");
};
