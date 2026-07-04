// Buffered, rotating ndjson logger for the faucet bot.
//
// Events are buffered in memory and flushed asynchronously every
// `flushIntervalMs` or once `maxBufferBytes` accumulates. The log file is
// size-rotated.
//
// Crash safety: `flushSync()` drains the buffer synchronously and is wired
// to shutdown hooks; at most one flush window of events can be lost on a
// hard kill, and log events are observability data, never money state.

import fs from "node:fs";
import path from "node:path";

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_ROTATE_BYTES = 50 * 1024 * 1024;
const DEFAULT_KEEP_ROTATED_FILES = 5;
const MAX_PENDING_BUFFER_BYTES = 8 * 1024 * 1024;

export function createNdjsonLogger({
  filePath,
  stdout = false,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  rotateBytes = DEFAULT_ROTATE_BYTES,
  keepRotatedFiles = DEFAULT_KEEP_ROTATED_FILES,
  onError = null,
} = {}) {
  const fileEnabled = typeof filePath === "string" && filePath.trim().length > 0;
  let buffer = [];
  let bufferedBytes = 0;
  let writtenBytes = 0;
  let currentFileBytes = 0;
  let rotations = 0;
  let droppedLines = 0;
  let flushInFlight = null;
  let flushTimer = null;
  let closed = false;
  let directoryReady = false;

  const reportError = (error, context) => {
    try {
      if (typeof onError === "function") {
        onError(error, context);
      } else {
        process.stderr.write(`[logger:${context}] ${error instanceof Error ? error.message : String(error)}\n`);
      }
    } catch {
      // never throw from logging
    }
  };

  const ensureDirectory = () => {
    if (directoryReady || !fileEnabled) {
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    directoryReady = true;
  };

  if (fileEnabled) {
    try {
      ensureDirectory();
      currentFileBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    } catch (error) {
      reportError(error, "stat");
    }
  }

  const rotateIfNeededSync = (incomingBytes) => {
    if (!fileEnabled || !Number.isFinite(rotateBytes) || rotateBytes <= 0) {
      return;
    }
    if (currentFileBytes + incomingBytes <= rotateBytes || currentFileBytes === 0) {
      return;
    }
    try {
      const keep = Math.max(1, Math.trunc(keepRotatedFiles));
      fs.rmSync(`${filePath}.${keep}`, { force: true });
      for (let index = keep - 1; index >= 1; index -= 1) {
        const from = `${filePath}.${index}`;
        if (fs.existsSync(from)) {
          fs.renameSync(from, `${filePath}.${index + 1}`);
        }
      }
      fs.renameSync(filePath, `${filePath}.1`);
      currentFileBytes = 0;
      rotations += 1;
    } catch (error) {
      reportError(error, "rotate");
    }
  };

  const takeChunk = () => {
    if (buffer.length === 0) {
      return null;
    }
    const chunk = buffer.join("");
    buffer = [];
    bufferedBytes = 0;
    return chunk;
  };

  const writeChunk = async (chunk) => {
    ensureDirectory();
    rotateIfNeededSync(chunk.length);
    await fs.promises.appendFile(filePath, chunk, "utf8");
    currentFileBytes += chunk.length;
    writtenBytes += chunk.length;
  };

  const flush = () => {
    if (!fileEnabled) {
      buffer = [];
      bufferedBytes = 0;
      return Promise.resolve();
    }
    if (flushInFlight != null) {
      return flushInFlight;
    }
    const chunk = takeChunk();
    if (chunk == null) {
      return Promise.resolve();
    }
    flushInFlight = writeChunk(chunk)
      .catch((error) => {
        reportError(error, "flush");
        // Re-queue the failed chunk in front, bounded so an unwritable disk
        // cannot balloon memory.
        if (chunk.length + bufferedBytes <= MAX_PENDING_BUFFER_BYTES) {
          buffer.unshift(chunk);
          bufferedBytes += chunk.length;
        } else {
          droppedLines += chunk.split("\n").length - 1;
        }
      })
      .finally(() => {
        flushInFlight = null;
        if (bufferedBytes >= maxBufferBytes && !closed) {
          void flush();
        }
      });
    return flushInFlight;
  };

  const scheduleTimer = () => {
    if (!fileEnabled || flushTimer != null) {
      return;
    }
    flushTimer = setInterval(() => {
      void flush();
    }, Math.max(20, Math.trunc(flushIntervalMs)));
    if (typeof flushTimer.unref === "function") {
      flushTimer.unref();
    }
  };

  const emit = (event) => {
    const line = `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`;
    if (stdout) {
      process.stdout.write(line);
    }
    if (!fileEnabled || closed) {
      return;
    }
    if (bufferedBytes + line.length > MAX_PENDING_BUFFER_BYTES) {
      droppedLines += 1;
      return;
    }
    buffer.push(line);
    bufferedBytes += line.length;
    scheduleTimer();
    if (bufferedBytes >= maxBufferBytes) {
      void flush();
    }
  };

  const flushSync = () => {
    if (!fileEnabled) {
      return;
    }
    const chunk = takeChunk();
    if (chunk == null) {
      return;
    }
    try {
      ensureDirectory();
      rotateIfNeededSync(chunk.length);
      fs.appendFileSync(filePath, chunk, "utf8");
      currentFileBytes += chunk.length;
      writtenBytes += chunk.length;
    } catch (error) {
      reportError(error, "flush-sync");
    }
  };

  const close = async () => {
    closed = true;
    if (flushTimer != null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (flushInFlight != null) {
      await flushInFlight.catch(() => {});
    }
    flushSync();
  };

  const stats = () => ({
    bufferedBytes,
    writtenBytes,
    currentFileBytes,
    rotations,
    droppedLines,
  });

  return { emit, flush, flushSync, close, stats };
}
