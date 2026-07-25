const finiteTimestamp = (value) => Number.isFinite(value) && value >= 0 ? value : null;

const ageAt = (timestamp, now) => {
  const valid = finiteTimestamp(timestamp);
  return valid == null ? null : Math.max(0, now - valid);
};

export const computeT3amsHealth = ({
  now = Date.now(),
  chainConnected,
  subscriptionCount,
  freshnessWindowMs,
  processStartedAt,
  lastStatementAt = null,
  lastIngressPageAt = null,
  lastSubscriptionRefreshAt = null,
  deadLetterCount = 0,
  ingress = [],
} = {}) => {
  const currentTime = finiteTimestamp(now) ?? Date.now();
  const subscriptions = Number.isSafeInteger(subscriptionCount) && subscriptionCount > 0
    ? subscriptionCount
    : 0;
  const freshnessWindow = Number.isSafeInteger(freshnessWindowMs) && freshnessWindowMs > 0
    ? freshnessWindowMs
    : 0;
  const heartbeatAt = Math.max(
    ...[processStartedAt, lastStatementAt, lastIngressPageAt, lastSubscriptionRefreshAt]
      .map(finiteTimestamp)
      .filter((value) => value != null),
  );
  const heartbeatAgeMs = Number.isFinite(heartbeatAt) ? ageAt(heartbeatAt, currentTime) : null;
  const ingressFresh = subscriptions > 0
    && freshnessWindow > 0
    && heartbeatAgeMs != null
    && heartbeatAgeMs <= freshnessWindow;
  const pendingCreatedAt = Array.isArray(ingress)
    ? ingress.map((entry) => finiteTimestamp(entry?.createdAt)).filter((value) => value != null)
    : [];
  const oldestPendingIngressAgeMs = pendingCreatedAt.length === 0
    ? null
    : ageAt(Math.min(...pendingCreatedAt), currentTime);

  return {
    healthy: Boolean(chainConnected) && subscriptions > 0 && ingressFresh,
    ingressFresh,
    heartbeatAgeMs,
    lastStatementAgeMs: ageAt(lastStatementAt, currentTime),
    lastIngressPageAgeMs: ageAt(lastIngressPageAt, currentTime),
    lastSubscriptionRefreshAgeMs: ageAt(lastSubscriptionRefreshAt, currentTime),
    oldestPendingIngressAgeMs,
    deadLetterCount: Number.isSafeInteger(deadLetterCount) && deadLetterCount >= 0 ? deadLetterCount : 0,
  };
};
