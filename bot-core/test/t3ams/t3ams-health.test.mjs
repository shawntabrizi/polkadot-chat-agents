import assert from "node:assert/strict";
import test from "node:test";
import { computeT3amsHealth } from "../../transports/t3ams/t3ams-health.mjs";

const NOW = 1_000_000;

test("T3ams health requires chain, subscriptions, and a fresh ingress heartbeat", () => {
  const healthy = computeT3amsHealth({
    now: NOW,
    chainConnected: true,
    subscriptionCount: 2,
    freshnessWindowMs: 250_000,
    processStartedAt: NOW - 300_000,
    lastIngressPageAt: NOW - 20_000,
  });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.ingressFresh, true);
  assert.equal(healthy.heartbeatAgeMs, 20_000);

  assert.equal(computeT3amsHealth({
    now: NOW,
    chainConnected: false,
    subscriptionCount: 2,
    freshnessWindowMs: 250_000,
    lastStatementAt: NOW,
  }).healthy, false);
  assert.equal(computeT3amsHealth({
    now: NOW,
    chainConnected: true,
    subscriptionCount: 0,
    freshnessWindowMs: 250_000,
    lastStatementAt: NOW,
  }).healthy, false);
  assert.equal(computeT3amsHealth({
    now: NOW,
    chainConnected: true,
    subscriptionCount: 2,
    freshnessWindowMs: 250_000,
    processStartedAt: NOW - 500_000,
    lastStatementAt: NOW - 300_000,
  }).healthy, false);
});

test("a successful subscription refresh keeps an idle T3ams ingress fresh", () => {
  const health = computeT3amsHealth({
    now: NOW,
    chainConnected: true,
    subscriptionCount: 1,
    freshnessWindowMs: 250_000,
    processStartedAt: NOW - 900_000,
    lastSubscriptionRefreshAt: NOW - 5_000,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.lastStatementAgeMs, null);
  assert.equal(health.lastSubscriptionRefreshAgeMs, 5_000);
});

test("T3ams health reports dead letters and the oldest pending ingress age", () => {
  const health = computeT3amsHealth({
    now: NOW,
    chainConnected: true,
    subscriptionCount: 1,
    freshnessWindowMs: 250_000,
    processStartedAt: NOW,
    deadLetterCount: 3,
    ingress: [
      { createdAt: NOW - 3_000 },
      { createdAt: NOW - 40_000 },
      { createdAt: "invalid" },
    ],
  });
  assert.equal(health.deadLetterCount, 3);
  assert.equal(health.oldestPendingIngressAgeMs, 40_000);
});
