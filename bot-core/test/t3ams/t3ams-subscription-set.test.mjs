import test from "node:test";
import assert from "node:assert/strict";
import { installT3amsSubscriptionRouteSet } from "../../transports/t3ams/t3ams-subscription-set.mjs";

test("a failed route-set replacement preserves its active predecessor through cleanup", () => {
  const desired = new Set();
  const active = new Set(["dm:alice"]);
  let commits = 0;
  let discards = 0;
  let reconciliations = 0;

  const result = installT3amsSubscriptionRouteSet({
    routes: [
      { id: "dm:alice", callback: () => {} },
      { id: "dmops:alice", callback: () => {} },
    ],
    desired,
    cap: 4,
    install: (route) => {
      if (route.id === "dmops:alice") return { ok: false, changed: false };
      return {
        ok: true,
        changed: true,
        commit: () => { commits += 1; },
        discard: () => { discards += 1; },
      };
    },
    isActive: (id) => active.has(id),
    reconcile: () => { reconciliations += 1; },
    flush: () => assert.fail("a failed route set must not flush buffered callbacks"),
  });

  assert.deepEqual(result, { ok: false, omitted: 0 });
  assert.deepEqual([...desired], ["dm:alice"]);
  assert.equal(commits, 0, "the old route must not be replaced before the set commits");
  assert.equal(discards, 1, "the uncommitted replacement must be torn down");
  assert.equal(reconciliations, 1);
});

test("route-set callbacks wait until every sibling has committed", () => {
  const desired = new Set();
  const active = new Set();
  const events = [];

  const result = installT3amsSubscriptionRouteSet({
    routes: [
      { id: "ws-plane:one", callback: () => events.push("callback:plane") },
      { id: "ws-notify:one", callback: () => events.push("callback:notify") },
    ],
    desired,
    cap: 4,
    install: (route, callback) => {
      callback(); // retained replay during subscription setup
      return {
        ok: true,
        changed: true,
        commit: () => {
          active.add(route.id);
          events.push(`commit:${route.id}`);
        },
        discard: () => assert.fail("a successful route set must not discard a route"),
      };
    },
    isActive: (id) => active.has(id),
    reconcile: () => assert.fail("a successful route set must not reconcile"),
    flush: (stagedRoute, args) => stagedRoute.callback(...args),
  });

  assert.deepEqual(result, { ok: true, omitted: 0 });
  assert.deepEqual([...desired], ["ws-plane:one", "ws-notify:one"]);
  assert.deepEqual(events, [
    "commit:ws-plane:one",
    "commit:ws-notify:one",
    "callback:plane",
    "callback:notify",
  ]);
});
