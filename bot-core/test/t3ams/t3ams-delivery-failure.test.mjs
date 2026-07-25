import assert from "node:assert/strict";
import test from "node:test";
import { nextT3amsDeliveryFailure } from "../../transports/t3ams/t3ams-delivery-failure.mjs";

test("identical T3ams delivery failures escalate once at the tenth attempt", () => {
  let state = {};
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const next = nextT3amsDeliveryFailure(state, new Error("statement submit failed"));
    assert.equal(next.consecutiveFailures, attempt);
    assert.equal(next.escalate, attempt === 10);
    state = next;
  }
  assert.equal(state.stuckReported, true);
});

test("a different T3ams delivery error resets the consecutive count", () => {
  const first = nextT3amsDeliveryFailure({}, Object.assign(new Error("offline"), { code: "RPC" }));
  const repeated = nextT3amsDeliveryFailure(first, Object.assign(new Error("offline"), { code: "RPC" }));
  const changed = nextT3amsDeliveryFailure(repeated, Object.assign(new Error("offline"), { code: "CHAIN" }));
  assert.equal(repeated.consecutiveFailures, 2);
  assert.equal(changed.consecutiveFailures, 1);
  assert.equal(changed.escalate, false);
});
