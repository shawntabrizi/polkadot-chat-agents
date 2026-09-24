// The in-memory world of test/groups-v2.test.mjs and test/group-admin.test.mjs:
// people with their own lib/groups-v2.mjs state and X25519 identity keys, a
// fake Statement Store that keeps ONE statement per (signer, channel) as the
// real store does, and each person's inbox of kind-249 controls, decoded
// through the real codec.
import assert from "node:assert/strict";
import { createGroupsV2 } from "../../lib/groups-v2.mjs";
import { pairwiseSecret } from "../../lib/group-keys.mjs";
import { decodeOpaqueMessageAt, encodeOpaqueGroupControlMessage, encodeOpaqueTextMessage, x25519PublicKeyFromPrivateKey } from "../../vendor/app-chat-codec.mjs";

export const hex = (b) => Buffer.from(b).toString("hex");
export const fill = (x, n) => new Uint8Array(n).fill(x);
export const GROUP = "0b7e2c1a-0000-4000-8000-00000000c0de";
// Account order matters for the tie rules (lower signer wins): alice < bot.
export const ACCOUNTS = { alice: "a1".repeat(32), bob: "b0".repeat(32), bot: "b7".repeat(32), carol: "c4".repeat(32), dave: "d5".repeat(32) };

export const makeWorld = ({ start = 1_790_000_000_000 } = {}) => {
  const clock = { t: start };
  const slots = new Map(); // `${signer}:${channel}` -> statement (one per account and channel)
  const submissions = [];  // every submit, in order
  const inbox = new Map(); // account -> [{ from, m }] decoded kind-249 messages
  const keys = new Map();  // account -> { priv, pub }
  const people = {};
  let n = 0;
  const person = (name, { allowed = () => true, botInfo } = {}) => {
    const account = ACCOUNTS[name];
    const priv = fill(0x10 + Object.keys(ACCOUNTS).indexOf(name), 32);
    keys.set(account, { priv, pub: x25519PublicKeyFromPrivateKey(priv) });
    const seen = new Set();
    const groups = createGroupsV2({
      selfHex: account,
      now: () => clock.t,
      isAllowed: allowed,
      ...(botInfo ? { botInfo } : {}),
      pairwiseKey: async (peer) => (keys.has(peer) ? pairwiseSecret(priv, keys.get(peer).pub) : null),
      submit: async ({ topic, channel, data }) => {
        const st = { topicHex: hex(topic), channelHex: hex(channel), signerHex: account, data, seq: ++n };
        slots.set(`${account}:${st.channelHex}`, st);
        submissions.push({ who: name, ...st });
      },
      sendControl: async (peer, control) => {
        // Through the real kind-249 codec, as the DM session would carry it.
        const opaque = encodeOpaqueGroupControlMessage({ messageId: `C-${++n}`, timestamp: clock.t, control });
        const m = decodeOpaqueMessageAt(opaque, 0).value;
        assert.equal(m.kind, "groupControl");
        if (!inbox.has(peer)) inbox.set(peer, []);
        inbox.get(peer).push({ from: account, m, bytes: opaque.length });
      },
    });
    // Read every statement on the topics this member watches, once each.
    const sync = async () => {
      const out = [];
      for (let pass = 0; pass < 3; pass += 1) { // a rekey opens a new topic: read it too
        const before = out.length;
        const watch = new Set(groups.topics().map(hex));
        for (const st of [...slots.values()].sort((a, b) => a.seq - b.seq)) {
          const key = `${st.signerHex}:${st.channelHex}:${st.seq}`;
          if (!watch.has(st.topicHex) || seen.has(key)) continue;
          seen.add(key);
          out.push(await groups.receive(st));
        }
        if (out.length === before) break;
      }
      return out;
    };
    const controls = () => { const list = inbox.get(account) ?? []; inbox.set(account, []); return list; };
    people[name] = { name, account, groups, sync, controls, priv };
    return people[name];
  };
  return { clock, slots, submissions, person, people, keys };
};

export const text = (id, t, body) => encodeOpaqueTextMessage({ messageId: id, timestamp: t, text: body });
export const texts = (res) => res.flatMap((r) => r.messages ?? []).map((x) => x.message.text);

// alice creates the group with bob and the bot; both accept the welcome and
// read the state from the topic.
export const setup = async ({ bot = {}, state = {}, botInfo } = {}) => {
  const w = makeWorld();
  const alice = w.person("alice");
  const bob = w.person("bob");
  const b = w.person("bot", { botInfo });
  const welcome = await alice.groups.create({
    groupId: GROUP, name: "Test group", createdAt: w.clock.t,
    members: [{ account: bob.account }, { account: b.account, ...bot }], ...state,
  });
  for (const p of [bob, b]) {
    assert.equal(p.groups.welcome(alice.account, welcome.welcome), "welcomed");
    const res = await p.sync();
    assert.equal(res.find((r) => r.outcome === "applied")?.outcome, "applied", `${p.name} applies the state named by the welcome`);
    assert.equal(p.groups.get(GROUP).status, "member");
  }
  return { w, alice, bob, bot: b };
};
