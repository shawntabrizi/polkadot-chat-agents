import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentSessionKeyForT3ams,
  conversationForAgentSessionKey,
  isT3amsConversationKey,
} from "../lib/t3ams-agent-session.mjs";

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
