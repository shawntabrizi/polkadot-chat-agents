// Public direct bots accept work from arbitrary people and spend the
// operator's model quota. Keep their default process/queue budget deliberately
// below the trusted private profile. Explicit environment values still win in
// t3ams.mjs, so this only changes the safe default.
export const t3amsDirectCapacityDefaults = ({ publicDirect = false } = {}) => (
  publicDirect
    ? { maxConcurrentTurns: 2, maxQueuedTurns: 20 }
    : { maxConcurrentTurns: 4, maxQueuedTurns: 100 }
);
