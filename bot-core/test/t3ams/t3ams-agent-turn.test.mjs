import test from "node:test";
import assert from "node:assert/strict";
import { deliverAgentReplyBeforeArtifacts } from "../../transports/t3ams/t3ams-agent-turn.mjs";

test("a retryable artifact failure cannot hold back a durable final reply", async () => {
  const reply = { parts: ["final answer"], nextPart: 0 };
  const sent = [];
  let artifactAttempts = 0;
  let artifactAvailable = false;
  const deliverReply = async () => {
    while (reply.nextPart < reply.parts.length) {
      sent.push(reply.parts[reply.nextPart]);
      reply.nextPart += 1;
    }
  };
  const deliverArtifacts = async () => {
    artifactAttempts += 1;
    if (!artifactAvailable) throw new Error("HOP upload unavailable");
    sent.push("report.pdf");
  };

  await assert.rejects(
    deliverAgentReplyBeforeArtifacts({ deliverReply, deliverArtifacts }),
    /HOP upload unavailable/,
  );
  assert.deepEqual(sent, ["final answer"]);
  assert.equal(reply.nextPart, 1, "the final reply is durably complete before an artifact retry");

  artifactAvailable = true;
  await deliverAgentReplyBeforeArtifacts({ deliverReply, deliverArtifacts });
  assert.deepEqual(sent, ["final answer", "report.pdf"]);
  assert.equal(artifactAttempts, 2, "only the pending artifact is retried");
});

test("a failed final reply leaves artifact delivery untouched", async () => {
  let artifactAttempts = 0;
  await assert.rejects(
    deliverAgentReplyBeforeArtifacts({
      deliverReply: async () => { throw new Error("statement unavailable"); },
      deliverArtifacts: async () => { artifactAttempts += 1; },
    }),
    /statement unavailable/,
  );
  assert.equal(artifactAttempts, 0);
});
