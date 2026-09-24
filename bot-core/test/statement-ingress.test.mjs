import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createStatementIngressSupervisor } from "../vendor/lib/statement-ingress-supervisor.mjs";

// A statement node reached over one socket. A reconnect (a laptop that
// sleeps, a Wi-Fi change, an endpoint switch) silently kills every old
// subscription: no error, no more pages. Only new subscriptions receive.
const fakeNode = () => {
  let epoch = 0;
  const subs = new Set();
  const matches = (filter, topics) =>
    filter.matchAll ? filter.matchAll.every((t) => topics.includes(t)) : filter.matchAny.some((t) => topics.includes(t));
  return {
    subscribePages(filter, onPage) {
      const sub = { filter, onPage, epoch };
      subs.add(sub);
      // The node answers a new subscription with a first (empty) page.
      queueMicrotask(() => { if (sub.epoch === epoch && subs.has(sub)) onPage({ statements: [], decodeErrorCount: 0 }); });
      return () => subs.delete(sub);
    },
    publish(statement) {
      for (const sub of subs) if (sub.epoch === epoch && matches(sub.filter, statement.topics)) sub.onPage({ statements: [statement], decodeErrorCount: 0 });
    },
    reconnect() { epoch += 1; },
  };
};

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

// index.mjs recovery: replace the health subscription AND the groups.
// The old recovery replaced only the groups: after one reconnect the bot
// still received chat messages but missed every heartbeat, and asked for a
// recovery every 30 s for as long as it ran (pcdflip local, 247 in a row).
const run = async ({ recoverHealth }) => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const node = fakeNode();
    const events = [];
    const received = [];
    let supervisor;
    const subscribeGroups = () => supervisor.subscribeGroup({ id: "sessions-0", filter: { matchAny: ["T"] }, label: "sessions-0", topicCount: 1 });
    supervisor = createStatementIngressSupervisor({
      subscribePages: node.subscribePages,
      handleStatements: (statements) => { received.push(...statements); },
      submitHeartbeat: async ({ id }) => { queueMicrotask(() => node.publish({ topics: ["H"], data: id })); },
      healthFilter: { matchAll: ["H"] },
      isHealthStatement: (st) => st.topics.includes("H"),
      isCurrentHeartbeatStatement: (st, hb) => st.data === hb.id,
      recover: () => { if (recoverHealth) supervisor.reconnect(); subscribeGroups(); },
      emit: (e) => events.push(e.event),
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 500,
      readinessTimeoutMs: 400,
    });
    supervisor.start();
    subscribeGroups();
    await flush();
    mock.timers.tick(600);
    await flush();
    assert.deepEqual(events, [], "the startup heartbeat comes back");

    node.reconnect();
    for (let i = 0; i < 8; i += 1) { mock.timers.tick(1000); await flush(); }
    node.publish({ topics: ["T"], data: "chat" });
    supervisor.stop();
    return { events, received };
  } finally {
    mock.timers.reset();
  }
};

test("after a socket reconnect, recovery replaces the health subscription and the heartbeat comes back", async () => {
  const { events, received } = await run({ recoverHealth: true });
  assert.equal(events.filter((e) => e === "BOT_STATEMENT_INGRESS_HEARTBEAT_MISSED").length, 1, "one miss detects the dead socket");
  assert.equal(events.filter((e) => e === "BOT_STATEMENT_INGRESS_RECOVERY_REQUESTED").length, 1);
  assert.equal(events.at(-1), "BOT_STATEMENT_INGRESS_HEALTHY", "the next heartbeat is observed");
  assert.equal(received.length, 1, "chat still arrives");
});

test("root cause: a recovery that replaces only the groups misses every later heartbeat", async () => {
  const { events, received } = await run({ recoverHealth: false });
  assert.ok(events.filter((e) => e === "BOT_STATEMENT_INGRESS_HEARTBEAT_MISSED").length >= 3, "one miss per heartbeat, forever");
  assert.ok(!events.includes("BOT_STATEMENT_INGRESS_HEALTHY"));
  assert.equal(received.length, 1, "while chat still arrives: the pcdflip symptom");
});
