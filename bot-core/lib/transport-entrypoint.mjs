// Keep transport-to-runtime selection in one place so local runs and every
// generated deployment use exactly the same entrypoint.

const ENTRYPOINTS = Object.freeze({
  "polkadot-app": "index.mjs",
  t3ams: "t3ams.mjs",
});

export function entrypointForTransport(transport) {
  const entrypoint = ENTRYPOINTS[transport];
  if (!entrypoint) throw new Error(`Unsupported transport entrypoint: ${String(transport)}`);
  return entrypoint;
}
