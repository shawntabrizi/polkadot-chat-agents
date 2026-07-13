// Statement Store sequencing for the T3ams transport.
//
// T3ams retains statements for roughly a day and packs an expiry timestamp
// with a monotonic low-word sequence. All writes share one serial queue so a
// later priority cannot overtake an earlier write on the network.

export const T3AMS_STATEMENT_TTL_SECONDS = 86_400;

export function restoreT3amsPriority(value) {
  try {
    const priority = BigInt(value ?? 0);
    return priority >= 0n ? priority : 0n;
  } catch {
    return 0n;
  }
}

export function createT3amsPriorityClock({
  initialPriority = 0n,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  onAdvance = () => {},
} = {}) {
  let priority = restoreT3amsPriority(initialPriority);

  const notify = () => onAdvance(priority);
  const nextPriority = () => {
    const currentSeconds = Number(nowSeconds());
    if (!Number.isSafeInteger(currentSeconds) || currentSeconds < 0) {
      throw new Error("T3ams statement clock returned an invalid UNIX timestamp");
    }
    let next = BigInt(currentSeconds + T3AMS_STATEMENT_TTL_SECONDS) << 32n;
    if (next <= priority) next = priority + 1n;
    priority = next;
    notify();
    return priority;
  };

  const noteRejectedPriority = (minimum) => {
    const candidate = restoreT3amsPriority(minimum);
    if (candidate <= priority) return false;
    priority = candidate;
    notify();
    return true;
  };

  return {
    nextPriority,
    noteRejectedPriority,
    priority: () => priority,
  };
}

export function createSerializedSubmitter(send) {
  if (typeof send !== "function") throw new Error("send is required");
  let tail = Promise.resolve();
  return (statement) => {
    const next = tail.then(() => send(statement), () => send(statement));
    // Keep the queue live after a rejected RPC submission. The caller still
    // receives that rejection through `next`.
    tail = next.catch(() => {});
    return next;
  };
}
