#!/usr/bin/env node
// Intentionally tiny companion process for T3ams photo/document summaries.
// It is meant to run in a separate, no-tools container with only this code,
// a shared request token, and an Anthropic API key. Do not run it in the bot
// container: that container has transport signing state and (for Claude) an
// OAuth home which must never be exposed to media parsing or provider calls.

import http from "node:http";
import { createMediaAnalyzerHttpHandler } from "./lib/t3ams-media-analyzer.mjs";

const env = process.env;
const numberEnv = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};
const log = (event, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), event, ...extra }));

const host = (env.MEDIA_ANALYZER_HOST ?? "0.0.0.0").trim();
if (!new Set(["0.0.0.0", "127.0.0.1", "::", "::1"]).has(host)) {
  console.error("MEDIA_ANALYZER_HOST must be a loopback or wildcard bind address");
  process.exit(2);
}
const port = (() => {
  try { return numberEnv("MEDIA_ANALYZER_PORT", 8798, { min: 1, max: 65_535 }); }
  catch (error) { console.error(String(error.message)); process.exit(2); }
})();

let handler;
try {
  handler = createMediaAnalyzerHttpHandler({
    token: env.MEDIA_ANALYZER_TOKEN,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.MEDIA_ANALYZER_MODEL,
    maxFiles: numberEnv("MEDIA_ANALYZER_MAX_FILES", 4, { min: 1, max: 8 }),
    maxFileBytes: numberEnv("MEDIA_ANALYZER_MAX_FILE_BYTES", 7 * 1024 * 1024, { min: 1, max: 12 * 1024 * 1024 }),
    maxTotalBytes: numberEnv("MEDIA_ANALYZER_MAX_TOTAL_BYTES", 12 * 1024 * 1024, { min: 1, max: 16 * 1024 * 1024 }),
    maxPromptBytes: numberEnv("MEDIA_ANALYZER_MAX_PROMPT_BYTES", 12 * 1024, { min: 256, max: 64 * 1024 }),
    maxSummaryBytes: numberEnv("MEDIA_ANALYZER_MAX_SUMMARY_BYTES", 6 * 1024, { min: 256, max: 16 * 1024 }),
    maxTokens: numberEnv("MEDIA_ANALYZER_MAX_TOKENS", 1_200, { min: 128, max: 4_096 }),
    timeoutMs: numberEnv("MEDIA_ANALYZER_TIMEOUT_MS", 90_000, { min: 1_000, max: 10 * 60_000 }),
    log,
  });
} catch (error) {
  console.error(`Invalid media analyzer configuration: ${String(error?.message ?? error)}`);
  process.exit(2);
}

const server = http.createServer(handler);
// Bound slowloris/request lifetime independently from the provider deadline.
server.headersTimeout = 15_000;
server.requestTimeout = numberEnv("MEDIA_ANALYZER_REQUEST_TIMEOUT_MS", 105_000, { min: 5_000, max: 10 * 60_000 });
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.on("clientError", (_error, socket) => socket.destroy());
server.on("error", (error) => {
  console.error(`MEDIA_ANALYZER_SERVER_FAILED: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
});
server.listen(port, host, () => log("MEDIA_ANALYZER_LISTENING", { host, port }));

const stop = (signal) => {
  log("MEDIA_ANALYZER_STOPPING", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
