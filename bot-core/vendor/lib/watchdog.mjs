// Connection watchdog for chain planes.

export function createConnectionWatchdog({
  planes,
  intervalMs = 30_000,
  maxConsecutiveRecoveries = 3,
  onFatal = () => {},
  now = () => Date.now(),
  emit = () => {},
} = {}) {
  const states = new Map();
  for (const [name, plane] of Object.entries(planes)) {
    states.set(name, {
      name,
      probe: plane.probe,
      recover: plane.recover,
      staleMs: plane.staleMs ?? 180_000,
      lastOkAt: now(),
      consecutiveRecoveries: 0,
      busy: false,
    });
  }
  let timer = null;

  const recordOk = (name) => {
    const state = states.get(name);
    if (state == null) {
      return;
    }
    state.lastOkAt = now();
    if (state.consecutiveRecoveries > 0) {
      emit({ event: "BOT_CONNECTION_PLANE_HEALTHY", plane: name });
      state.consecutiveRecoveries = 0;
    }
  };

  const checkPlane = async (state) => {
    if (state.busy) {
      return;
    }
    const sinceOkMs = now() - state.lastOkAt;
    if (sinceOkMs <= state.staleMs) {
      return;
    }
    state.busy = true;
    try {
      let probeSucceeded = false;
      let probeUnhealthy = null;
      try {
        const result = await state.probe();
        if (result?.ok === false) {
          probeUnhealthy = result;
        } else {
          probeSucceeded = true;
        }
      } catch (error) {
        emit({
          event: "BOT_CONNECTION_PROBE_FAILED",
          plane: state.name,
          sinceOkMs,
          consecutiveRecoveries: state.consecutiveRecoveries,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!probeSucceeded) {
        emit({
          event: "BOT_CONNECTION_PROBE_UNHEALTHY",
          plane: state.name,
          sinceOkMs,
          consecutiveRecoveries: state.consecutiveRecoveries,
          reason: probeUnhealthy?.reason ?? null,
        });
      }
      if (probeSucceeded) {
        recordOk(state.name);
        return;
      }
      state.consecutiveRecoveries += 1;
      if (state.consecutiveRecoveries > maxConsecutiveRecoveries) {
        emit({
          event: "BOT_CONNECTION_PLANE_FATAL",
          plane: state.name,
          consecutiveRecoveries: state.consecutiveRecoveries,
        });
        await onFatal(state.name);
        return;
      }
      emit({
        event: "BOT_CONNECTION_RECOVERY_STARTED",
        plane: state.name,
        attempt: state.consecutiveRecoveries,
      });
      try {
        await state.recover(state.consecutiveRecoveries);
        // Grace period for the fresh connection; only real traffic or a
        // successful probe resets the recovery counter.
        state.lastOkAt = now();
        emit({
          event: "BOT_CONNECTION_RECOVERY_COMPLETE",
          plane: state.name,
          attempt: state.consecutiveRecoveries,
        });
      } catch (error) {
        emit({
          event: "BOT_CONNECTION_RECOVERY_FAILED",
          plane: state.name,
          attempt: state.consecutiveRecoveries,
          error: error instanceof Error ? error.message : String(error),
        });
        state.lastOkAt = now(); // back off one staleness window before retrying
      }
    } finally {
      state.busy = false;
    }
  };

  const tick = async () => {
    for (const state of states.values()) {
      await checkPlane(state);
    }
  };

  const start = () => {
    if (timer != null) {
      return;
    }
    timer = setInterval(() => {
      void tick();
    }, Math.max(1_000, Math.trunc(intervalMs)));
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  };

  const stop = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const snapshot = () => Object.fromEntries(
    [...states.values()].map((state) => [state.name, {
      sinceOkMs: now() - state.lastOkAt,
      consecutiveRecoveries: state.consecutiveRecoveries,
      staleMs: state.staleMs,
    }]),
  );

  return { recordOk, tick, start, stop, snapshot };
}

// Round-robin endpoint rotation helper.
export function createEndpointRotation(primary, fallbacksRaw) {
  const fallbacks = String(fallbacksRaw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const endpoints = [primary, ...fallbacks];
  let index = 0;
  return {
    endpoints,
    get current() {
      return endpoints[index % endpoints.length];
    },
    next() {
      index += 1;
      return endpoints[index % endpoints.length];
    },
  };
}
