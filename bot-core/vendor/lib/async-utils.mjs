// Shared async primitives for the faucet bot.
// Extracted from scripts/faucet-chat-listener.mjs; behavior is unchanged.

export function withTimeout(promise, timeoutMs, label) {
  const observed = Promise.resolve(promise);
  // Promise.race can time out while the original async operation is still
  // pending. Observe that original promise so a late rejection from teardown
  // does not become an unhandled rejection.
  observed.catch(() => {});
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return observed;
  }

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([observed, timeout]).finally(() => {
    if (timer != null) {
      clearTimeout(timer);
    }
  });
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export async function runWithConcurrency(items, limit, worker) {
  const concurrency = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const itemIndex = nextIndex;
        const item = items[itemIndex];
        nextIndex += 1;
        await worker(item, itemIndex);
      }
    },
  );
  await Promise.all(workers);
}

export function createAsyncLimiter(limit) {
  const concurrency = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  const queue = [];
  let active = 0;

  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const next = queue.shift();
      active += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  const run = (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
  run.stats = () => ({ active, queued: queue.length });
  return run;
}

// Serialized task chain: callers await an exclusive turn. Used for short
// critical sections (selection + reservation); never hold across chain IO.
export function createMutex() {
  let tail = Promise.resolve();
  const lock = async (fn) => {
    const previous = tail;
    let release = () => {};
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return lock;
}
