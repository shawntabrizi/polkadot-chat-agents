import { createHash } from "node:crypto";

const boundedErrorText = (error) => String(error?.message ?? error).slice(0, 1024);

const failureSignature = (error) => createHash("sha256")
  .update(String(error?.code ?? ""))
  .update("\0")
  .update(String(error?.name ?? ""))
  .update("\0")
  .update(String(error?.message ?? error))
  .digest("hex");

export const nextT3amsDeliveryFailure = (previous, error, threshold = 10) => {
  const signature = failureSignature(error);
  const priorCount = Number.isSafeInteger(previous?.consecutiveFailures)
    ? previous.consecutiveFailures
    : 0;
  const consecutiveFailures = previous?.failureSignature === signature
    ? Math.min(100, priorCount + 1)
    : 1;
  const alreadyReported = previous?.stuckReported === true;
  const escalate = !alreadyReported && consecutiveFailures >= threshold;
  return {
    failureSignature: signature,
    consecutiveFailures,
    stuckReported: alreadyReported || escalate,
    escalate,
    error: boundedErrorText(error),
  };
};
