// Bounded keyed work dispatcher. Tasks for one key run in order; independent
// keys share a fixed worker budget. It is intentionally tiny so transport code
// can use it for untrusted ingress without retaining an unbounded promise tail.

export function createKeyedDispatcher({ concurrency = 4, maxQueued = 1000 } = {}) {
  const workerLimit = Math.max(1, Math.trunc(concurrency) || 1);
  const queueLimit = Math.max(1, Math.trunc(maxQueued) || 1);
  const queues = new Map(); // key -> { tasks, running, ready }
  const readyKeys = [];
  let active = 0;
  let queued = 0;

  const makeReady = (key, entry) => {
    if (entry.running || entry.ready || entry.tasks.length === 0) return;
    entry.ready = true;
    readyKeys.push(key);
  };
  const drain = () => {
    while (active < workerLimit && readyKeys.length > 0) {
      const key = readyKeys.shift();
      const entry = queues.get(key);
      if (!entry) continue;
      entry.ready = false;
      if (entry.running || entry.tasks.length === 0) continue;
      const job = entry.tasks.shift();
      queued -= 1;
      entry.running = true;
      active += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          entry.running = false;
          if (entry.tasks.length > 0) makeReady(key, entry);
          else if (!entry.ready) queues.delete(key);
          drain();
        });
    }
  };

  return {
    // Returns null when the bounded backlog is full. The caller should leave
    // the source item unacknowledged so its normal retry/reconciliation path
    // can try again after capacity is available.
    run(key, task) {
      if (queued >= queueLimit) return null;
      let entry = queues.get(key);
      if (!entry) {
        entry = { tasks: [], running: false, ready: false };
        queues.set(key, entry);
      }
      const result = new Promise((resolve, reject) => {
        entry.tasks.push({ task, resolve, reject });
        queued += 1;
      });
      makeReady(key, entry);
      drain();
      return result;
    },
    stats: () => ({ active, queued, activeCap: workerLimit, queuedCap: queueLimit, keys: queues.size }),
  };
}
