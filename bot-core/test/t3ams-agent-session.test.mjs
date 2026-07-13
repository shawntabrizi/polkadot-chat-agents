import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentSessionKeyForT3ams,
  bridgeReplyThreadRootForT3ams,
  conversationForAgentSessionKey,
  ingressLaneKeyForT3ams,
  isT3amsConversationKey,
} from "../lib/t3ams-agent-session.mjs";
import { createKeyedDispatcher } from "../lib/keyed-dispatcher.mjs";

const dm = `t3ams:dm:${"a1".repeat(32)}`;
const channel = `t3ams:channel:${"b2".repeat(32)}:${"c3".repeat(32)}`;

test("T3ams agent sessions preserve a base conversation and isolate threads", () => {
  assert.equal(isT3amsConversationKey(dm), true);
  assert.equal(isT3amsConversationKey(channel), true);
  assert.equal(agentSessionKeyForT3ams(dm, null), dm);

  const thread = agentSessionKeyForT3ams(channel, "thread/root:1");
  assert.equal(thread, `${channel}:thread:thread%2Froot%3A1`);
  assert.equal(conversationForAgentSessionKey(thread), channel);
  assert.notEqual(agentSessionKeyForT3ams(channel, "thread-a"), agentSessionKeyForT3ams(channel, "thread-b"));
});

test("T3ams agent sessions reject malformed or noncanonical persisted keys", () => {
  assert.equal(agentSessionKeyForT3ams("t3ams:dm:not-a-key", "thread"), null);
  assert.equal(agentSessionKeyForT3ams(dm, " bad"), null);
  assert.equal(agentSessionKeyForT3ams(dm, "bad\nroot"), null);
  assert.equal(conversationForAgentSessionKey(`${dm}:thread:%74hread`), null, "percent escapes must be canonical");
  assert.equal(conversationForAgentSessionKey(`${dm}:thread:`), null);
  assert.equal(conversationForAgentSessionKey(`${dm}:thread:one:thread:two`), null);
  assert.equal(conversationForAgentSessionKey("t3ams:channel:bad"), null);
});

test("T3ams ingress lanes serialize one thread while different threads run in parallel", async () => {
  const dispatcher = createKeyedDispatcher({ concurrency: 2, maxQueued: 8 });
  const threadA = ingressLaneKeyForT3ams(channel, "thread-a");
  const threadB = ingressLaneKeyForT3ams(channel, "thread-b");
  assert.ok(threadA);
  assert.ok(threadB);
  assert.notEqual(threadA, threadB);
  assert.equal(ingressLaneKeyForT3ams(channel, "thread-a"), threadA);

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const started = [];
  const first = dispatcher.run(threadA, async () => {
    started.push("thread-a-first");
    await firstGate;
    started.push("thread-a-first-finished");
  });
  const second = dispatcher.run(threadA, async () => { started.push("thread-a-second"); });
  const other = dispatcher.run(threadB, async () => { started.push("thread-b-first"); });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["thread-a-first", "thread-b-first"]);
  releaseFirst();
  await Promise.all([first, second, other]);
  assert.deepEqual(started, ["thread-a-first", "thread-b-first", "thread-a-first-finished", "thread-a-second"]);
});

test("a claimed bridge lane cannot override its delivery thread", () => {
  const lease = Object.freeze({ chatId: channel, laneKey: ingressLaneKeyForT3ams(channel, "thread-a"), threadRootId: "thread-a" });
  assert.equal(bridgeReplyThreadRootForT3ams(lease, "thread-b"), "thread-a");
  assert.equal(bridgeReplyThreadRootForT3ams(Object.freeze({ ...lease, threadRootId: null }), "thread-b"), null);
  assert.equal(bridgeReplyThreadRootForT3ams(null, "thread-b"), "thread-b");
});
