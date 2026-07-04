import { statementCodec } from "@novasamatech/sdk-statement";

function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function topicFilterToRpc(filter) {
  if (filter === "any") {
    return "any";
  }
  if (Array.isArray(filter?.matchAll)) {
    return { matchAll: filter.matchAll.map(bytesToHex) };
  }
  if (Array.isArray(filter?.matchAny)) {
    return { matchAny: filter.matchAny.map(bytesToHex) };
  }
  throw new Error("Unsupported statement topic filter");
}

function unwrapSubscriptionEvent(event) {
  return event?.params?.result ?? event?.result ?? event;
}

export function decodeStatementSubscriptionPage(event, decodeStatement = statementCodec.dec) {
  const update = unwrapSubscriptionEvent(event);
  if (update?.event !== "newStatements") {
    return {
      statements: [],
      rawStatementCount: 0,
      decodeErrorCount: 0,
      remaining: null,
      isComplete: false,
      ignored: true,
    };
  }

  const rawStatements = Array.isArray(update.data?.statements)
    ? update.data.statements
    : [];
  const statements = [];
  let decodeErrorCount = 0;
  for (const encoded of rawStatements) {
    try {
      statements.push(decodeStatement(encoded));
    } catch {
      decodeErrorCount += 1;
    }
  }

  const remaining = Number.isFinite(Number(update.data?.remaining))
    ? Number(update.data.remaining)
    : null;
  return {
    statements,
    rawStatementCount: rawStatements.length,
    decodeErrorCount,
    remaining,
    isComplete: remaining == null || remaining === 0,
    ignored: false,
  };
}

export function createRawStatementPageSubscriber({
  getClient,
  decodeStatement = statementCodec.dec,
} = {}) {
  if (typeof getClient !== "function") {
    throw new Error("getClient is required");
  }

  return (filter, onPage, onError = () => {}) => {
    const client = getClient();
    let active = true;
    const fail = (error) => {
      if (!active) {
        return;
      }
      active = false;
      onError(error);
    };
    const subscription = client
      ._subscribe(
        "statement_subscribeStatement",
        "statement_unsubscribeStatement",
        [topicFilterToRpc(filter)],
      )
      .subscribe({
        next: (event) => {
          if (!active) {
            return;
          }
          try {
            const page = decodeStatementSubscriptionPage(event, decodeStatement);
            if (!page.ignored) {
              onPage(page);
            }
          } catch (error) {
            fail(error);
          }
        },
        error: fail,
        complete: () => fail(new Error("statement subscription completed")),
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  };
}

function setUnrefTimeout(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(1, Math.trunc(delayMs)));
  timer.unref?.();
  return timer;
}

function setUnrefInterval(callback, delayMs) {
  const timer = setInterval(callback, Math.max(1, Math.trunc(delayMs)));
  timer.unref?.();
  return timer;
}

export function createStatementIngressSupervisor({
  subscribePages,
  handleStatements,
  submitHeartbeat,
  healthFilter = null,
  healthLabel = "statement-ingress-health",
  isHealthStatement = () => false,
  isCurrentHeartbeatStatement = () => false,
  recover,
  emit = () => {},
  now = () => Date.now(),
  readinessTimeoutMs = 10_000,
  heartbeatIntervalMs = 20_000,
  heartbeatTimeoutMs = 10_000,
  enabled = true,
} = {}) {
  if (typeof subscribePages !== "function") {
    throw new Error("subscribePages is required");
  }
  if (typeof handleStatements !== "function") {
    throw new Error("handleStatements is required");
  }
  if (typeof recover !== "function") {
    throw new Error("recover is required");
  }

  const groups = new Map();
  const healthGroupId = "__statement_ingress_health__";
  const startedAt = now();
  let heartbeatTimer = null;
  let heartbeatDeadlineTimer = null;
  let heartbeatSequence = 0;
  let currentHeartbeat = null;
  let healthSubscription = null;
  let healthReady = false;
  let healthReadyAt = null;
  let healthReadyTimer = null;
  let healthLastPageAt = null;
  let recoveryInFlight = false;
  let consecutiveRecoveries = 0;
  let lastPageAt = null;
  let lastStatementAt = null;
  let lastHeartbeatSubmittedAt = null;
  let lastHeartbeatObservedAt = null;
  let lastRecoveryReason = null;

  const clearReadinessTimer = (group) => {
    if (group.readyTimer != null) {
      clearTimeout(group.readyTimer);
      group.readyTimer = null;
    }
  };

  const clearHeartbeatDeadline = () => {
    if (heartbeatDeadlineTimer != null) {
      clearTimeout(heartbeatDeadlineTimer);
      heartbeatDeadlineTimer = null;
    }
  };

  const clearHealthReadinessTimer = () => {
    if (healthReadyTimer != null) {
      clearTimeout(healthReadyTimer);
      healthReadyTimer = null;
    }
  };

  const requestRecovery = (reason) => {
    if (recoveryInFlight) {
      return;
    }
    recoveryInFlight = true;
    consecutiveRecoveries += 1;
    lastRecoveryReason = reason;
    clearHeartbeatDeadline();
    currentHeartbeat = null;
    emit({
      event: "BOT_STATEMENT_INGRESS_RECOVERY_REQUESTED",
      reason,
      activeGroupCount: groups.size + (healthSubscription == null ? 0 : 1),
      consecutiveRecoveries,
    });
    void Promise.resolve(recover(reason)).finally(() => {
      recoveryInFlight = false;
    });
  };

  const markGroupReady = (group) => {
    if (group.ready) {
      return;
    }
    group.ready = true;
    group.readyAt = now();
    clearReadinessTimer(group);
  };

  const markOk = () => {
    if (consecutiveRecoveries > 0) {
      emit({ event: "BOT_STATEMENT_INGRESS_HEALTHY" });
    }
    consecutiveRecoveries = 0;
  };

  const finishHeartbeatIfComplete = () => {
    if (currentHeartbeat == null) {
      return;
    }
    const missing = [...currentHeartbeat.expectedGroupIds].filter((id) => (
      (id === healthGroupId ? healthSubscription != null : groups.has(id)) &&
        !currentHeartbeat.observedGroupIds.has(id)
    ));
    if (missing.length > 0) {
      return;
    }
    clearHeartbeatDeadline();
    currentHeartbeat = null;
    markOk();
  };

  const markHealthReady = () => {
    if (healthReady) {
      return;
    }
    healthReady = true;
    healthReadyAt = now();
    clearHealthReadinessTimer();
  };

  const handleHealthPage = (page) => {
    const observedAt = now();
    healthLastPageAt = observedAt;
    lastPageAt = observedAt;
    markHealthReady();

    if (page.decodeErrorCount > 0) {
      emit({
        event: "BOT_STATEMENT_PAGE_DECODE_FAILED",
        groupId: healthGroupId,
        label: healthLabel,
        decodeErrorCount: page.decodeErrorCount,
        rawStatementCount: page.rawStatementCount,
      });
    }

    for (const statement of page.statements ?? []) {
      if (
        currentHeartbeat != null &&
        isHealthStatement(statement) &&
        isCurrentHeartbeatStatement(statement, currentHeartbeat)
      ) {
        currentHeartbeat.observedGroupIds.add(healthGroupId);
        lastHeartbeatObservedAt = observedAt;
      }
    }

    finishHeartbeatIfComplete();
  };

  const handlePage = (group, page) => {
    const observedAt = now();
    group.lastPageAt = observedAt;
    group.pageCount += 1;
    lastPageAt = observedAt;
    markGroupReady(group);

    if (page.decodeErrorCount > 0) {
      emit({
        event: "BOT_STATEMENT_PAGE_DECODE_FAILED",
        groupId: group.id,
        label: group.label,
        decodeErrorCount: page.decodeErrorCount,
        rawStatementCount: page.rawStatementCount,
      });
    }

    const statements = [];
    for (const statement of page.statements ?? []) {
      if (isHealthStatement(statement)) {
        if (
          currentHeartbeat != null &&
          currentHeartbeat.expectedGroupIds.has(group.id) &&
          isCurrentHeartbeatStatement(statement, currentHeartbeat)
        ) {
          currentHeartbeat.observedGroupIds.add(group.id);
          group.lastHeartbeatObservedAt = observedAt;
          lastHeartbeatObservedAt = observedAt;
        }
        continue;
      }
      statements.push(statement);
    }

    if (statements.length > 0) {
      lastStatementAt = observedAt;
      group.lastStatementAt = observedAt;
      void Promise.resolve(handleStatements(statements, {
        groupId: group.id,
        label: group.label,
        topicCount: group.topicCount,
      })).catch((error) => {
        emit({
          event: "BOT_STATEMENT_HANDLE_FAILED",
          label: group.label,
          groupId: group.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    finishHeartbeatIfComplete();
  };

  const unsubscribeGroup = (id) => {
    const group = groups.get(id);
    if (group == null) {
      return;
    }
    groups.delete(id);
    clearReadinessTimer(group);
    try {
      group.unsubscribe?.();
    } catch {
      // dead clients can throw during teardown; the caller is replacing them
    }
    finishHeartbeatIfComplete();
  };

  const unsubscribeHealth = () => {
    clearHealthReadinessTimer();
    healthReady = false;
    healthReadyAt = null;
    if (healthSubscription == null) {
      finishHeartbeatIfComplete();
      return;
    }
    const unsubscribe = healthSubscription;
    healthSubscription = null;
    try {
      unsubscribe();
    } catch {
      // dead clients can throw during teardown; the caller is replacing them
    }
    finishHeartbeatIfComplete();
  };

  const subscribeHealth = () => {
    if (!enabled || healthFilter == null || typeof submitHeartbeat !== "function") {
      return;
    }
    unsubscribeHealth();
    healthReadyTimer = setUnrefTimeout(() => {
      requestRecovery(`statement-health-subscription-ready-timeout:${healthLabel}`);
    }, readinessTimeoutMs);
    try {
      healthSubscription = subscribePages(
        healthFilter,
        handleHealthPage,
        (error) => {
          emit({
            event: "BOT_STATEMENT_SUBSCRIPTION_FAILED",
            groupId: healthGroupId,
            label: healthLabel,
            error: error instanceof Error ? error.message : String(error),
          });
          requestRecovery(`statement-health-subscription-failed:${healthLabel}`);
        },
      );
    } catch (error) {
      unsubscribeHealth();
      requestRecovery(`statement-health-subscription-start-failed:${healthLabel}`);
      throw error;
    }
  };

  const subscribeGroup = ({ id, filter, label, topicCount }) => {
    unsubscribeGroup(id);
    const group = {
      id,
      filter,
      label,
      topicCount,
      ready: false,
      readyAt: null,
      lastPageAt: null,
      lastStatementAt: null,
      lastHeartbeatObservedAt: null,
      pageCount: 0,
      unsubscribe: null,
      readyTimer: null,
    };
    groups.set(id, group);
    group.readyTimer = setUnrefTimeout(() => {
      requestRecovery(`statement-subscription-ready-timeout:${label ?? id}`);
    }, readinessTimeoutMs);

    try {
      group.unsubscribe = subscribePages(
        filter,
        (page) => handlePage(group, page),
        (error) => {
          emit({
            event: "BOT_STATEMENT_SUBSCRIPTION_FAILED",
            groupId: id,
            label,
            error: error instanceof Error ? error.message : String(error),
          });
          requestRecovery(`statement-subscription-failed:${label ?? id}`);
        },
      );
    } catch (error) {
      unsubscribeGroup(id);
      requestRecovery(`statement-subscription-start-failed:${label ?? id}`);
      throw error;
    }

    return () => unsubscribeGroup(id);
  };

  const submitHeartbeatNow = async (reason = "interval") => {
    if (
      !enabled ||
      typeof submitHeartbeat !== "function" ||
      healthSubscription == null ||
      recoveryInFlight
    ) {
      return;
    }
    if (currentHeartbeat != null) {
      return;
    }

    const expectedGroupIds = new Set([healthGroupId]);
    heartbeatSequence += 1;
    const heartbeat = {
      id: `${now()}-${heartbeatSequence}`,
      sequence: heartbeatSequence,
      submittedAt: now(),
      expectedGroupIds,
      observedGroupIds: new Set(),
      reason,
    };
    currentHeartbeat = heartbeat;
    lastHeartbeatSubmittedAt = heartbeat.submittedAt;

    try {
      await submitHeartbeat({
        id: heartbeat.id,
        sequence: heartbeat.sequence,
        expectedGroupCount: expectedGroupIds.size,
        reason,
      });
    } catch (error) {
      emit({
        event: "BOT_STATEMENT_INGRESS_HEARTBEAT_SUBMIT_FAILED",
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      requestRecovery("statement-heartbeat-submit-failed");
      return;
    }

    heartbeatDeadlineTimer = setUnrefTimeout(() => {
      if (currentHeartbeat !== heartbeat) {
        return;
      }
      const missingGroupIds = [...expectedGroupIds].filter((id) => (
        (id === healthGroupId ? healthSubscription != null : groups.has(id)) &&
          !heartbeat.observedGroupIds.has(id)
      ));
      if (missingGroupIds.length === 0) {
        currentHeartbeat = null;
        markOk();
        return;
      }
      emit({
        event: "BOT_STATEMENT_INGRESS_HEARTBEAT_MISSED",
        heartbeatId: heartbeat.id,
        expectedGroupCount: expectedGroupIds.size,
        observedGroupCount: heartbeat.observedGroupIds.size,
        missingGroupIds,
      });
      requestRecovery("statement-heartbeat-missed");
    }, heartbeatTimeoutMs);
  };

  const start = () => {
    if (!enabled || heartbeatTimer != null || typeof submitHeartbeat !== "function") {
      return;
    }
    subscribeHealth();
    heartbeatTimer = setUnrefInterval(() => {
      void submitHeartbeatNow("interval");
    }, heartbeatIntervalMs);
    void submitHeartbeatNow("startup");
  };

  const reconnect = () => {
    if (!enabled || typeof submitHeartbeat !== "function") {
      return;
    }
    subscribeHealth();
  };

  const stop = () => {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    clearHeartbeatDeadline();
    currentHeartbeat = null;
    unsubscribeHealth();
    for (const id of [...groups.keys()]) {
      unsubscribeGroup(id);
    }
  };

  const snapshot = () => {
    const timestamp = now();
    const activeGroups = [...groups.values()];
    return {
      sinceOkMs: timestamp - (lastHeartbeatObservedAt ?? lastPageAt ?? startedAt),
      staleMs: heartbeatIntervalMs + heartbeatTimeoutMs,
      consecutiveRecoveries,
      activeGroupCount: activeGroups.length,
      readyGroupCount: activeGroups.filter((group) => group.ready).length,
      healthEnabled: Boolean(enabled && healthFilter != null && typeof submitHeartbeat === "function"),
      healthReady,
      healthReadyAt,
      healthLastPageAt,
      lastPageAt,
      lastStatementAt,
      lastHeartbeatSubmittedAt,
      lastHeartbeatObservedAt,
      pendingHeartbeatId: currentHeartbeat?.id ?? null,
      pendingHeartbeatObservedGroupCount: currentHeartbeat?.observedGroupIds.size ?? 0,
      pendingHeartbeatExpectedGroupCount: currentHeartbeat?.expectedGroupIds.size ?? 0,
      lastRecoveryReason,
    };
  };

  return {
    subscribeGroup,
    unsubscribeGroup,
    submitHeartbeatNow,
    reconnect,
    start,
    stop,
    snapshot,
  };
}
