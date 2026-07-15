import { test } from "node:test";
import assert from "node:assert/strict";
import { isContainerRuntime, withoutContainerRuntime } from "../lib/runtime-topology.mjs";

test("Docker-only runtime topology cannot leak into a local run", () => {
  const source = { BOT_AI_RUNTIME_CONTAINER: "1", KEEP: "yes" };
  assert.equal(isContainerRuntime(source), true);
  const local = withoutContainerRuntime(source);
  assert.equal(isContainerRuntime(local), false);
  assert.deepEqual(local, { KEEP: "yes" });
  assert.deepEqual(source, { BOT_AI_RUNTIME_CONTAINER: "1", KEEP: "yes" });
});
