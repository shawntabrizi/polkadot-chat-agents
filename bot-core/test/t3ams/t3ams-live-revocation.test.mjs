import test from "node:test";
import assert from "node:assert/strict";
import { createT3amsLiveRevocation } from "../../transports/t3ams/t3ams-live-revocation.mjs";

const turn = (laneKey = "t3ams:dm:alice") => ({ chatId: "t3ams:dm:alice", laneKey, threadRootId: null });

test("a durable live revocation disarms and finalizes only the latest queued lane status", async () => {
  const disarmed = [];
  const taken = [];
  const finalized = [];
  const revocation = createT3amsLiveRevocation({
    disarm: (context) => disarmed.push(context.laneKey),
    take: async (context) => {
      taken.push(context.laneKey);
      return {
        handle: {
          finalize: async (status, options) => finalized.push({ lane: context.laneKey, status, options }),
        },
      };
    },
  });
  revocation.queue([
    { turnContext: turn(), status: "✎ Message updated — restarting." },
    { turnContext: turn(), status: "🗑️ Message deleted." },
  ]);
  assert.equal(revocation.pending.size, 1);
  assert.deepEqual(disarmed, []);

  revocation.flush();
  assert.deepEqual(disarmed, ["t3ams:dm:alice"]);
  assert.deepEqual(taken, ["t3ams:dm:alice"], "the old lane must be taken before a revised turn can arm a replacement");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(finalized, [{
    lane: "t3ams:dm:alice",
    status: "🗑️ Message deleted.",
    options: { guard: null },
  }]);
  assert.equal(revocation.pending.size, 0);
});

test("a failed old placeholder cleanup is logged without blocking another lane", async () => {
  const finalized = [];
  const logs = [];
  const revocation = createT3amsLiveRevocation({
    disarm: () => {},
    take: async (context) => {
      if (context.laneKey === "bad") throw new Error("stale handle");
      return { handle: { finalize: async (status) => finalized.push(status) } };
    },
    log: (event, fields) => logs.push({ event, fields }),
  });
  revocation.queue([
    { turnContext: turn("bad"), status: "updated", event: "T3AMS_DIRECT_REVOKE_FINALIZE_FAILED" },
    { turnContext: turn("good"), status: "deleted" },
  ]);
  revocation.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(finalized, ["deleted"]);
  assert.deepEqual(logs, [{
    event: "T3AMS_DIRECT_REVOKE_FINALIZE_FAILED",
    fields: { chatId: "t3ams:dm:alice", lane: "bad", error: "stale handle" },
  }]);
});
