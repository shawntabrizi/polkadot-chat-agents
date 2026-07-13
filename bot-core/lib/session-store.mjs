// Tiny disk-backed JSON store for bot session state, so conversations survive a
// restart. Atomic (tmp + rename), debounced, mode 0600 (it holds key material).
// A caller that must durably record work before acknowledging it can await
// flush() and defer the acknowledgement when disk persistence fails.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export function createStateStore(filePath, { debounceMs = 1000, retryMs = Math.max(1000, debounceMs) } = {}) {
  let timer = null;
  let pending = null;
  let flushing = null;
  let warned = false;
  let tempSequence = 0;
  const retryDelay = Number.isSafeInteger(retryMs) && retryMs > 0 ? retryMs : 1000;

  const scheduleFlush = (delayMs) => {
    if (timer || pending == null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  };

  const write = async (data) => {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    // `wx` and a per-process sequence prevent a stale temporary file or a
    // second store instance from silently replacing an in-progress snapshot.
    const tmp = `${filePath}.${process.pid}.${tempSequence += 1}.tmp`;
    let handle;
    try {
      handle = await fsp.open(tmp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(data));
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(tmp, filePath);
      // Best effort: directory fsync is not supported by every platform, but
      // where it is this makes the rename durable across a sudden power loss.
      try {
        const directory = await fsp.open(dir, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } catch { /* unsupported filesystem */ }
    } catch (error) {
      try { await handle?.close(); } catch { /* ignore close failure */ }
      try { await fsp.rm(tmp, { force: true }); } catch { /* keep original error */ }
      throw error;
    }
  };

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    // All callers share one drain. A save that occurs while a write is in
    // flight stays in `pending` and is written by the same drain before it
    // resolves, so an ACK-critical caller does not accidentally acknowledge
    // an older snapshot.
    if (flushing) return flushing;
    flushing = (async () => {
      while (pending != null) {
        const data = pending;
        pending = null;
        try {
          await write(data);
          warned = false;
        } catch (e) {
          // Preserve a newer save if one arrived during this write; otherwise
          // retain the failed snapshot for a later retry.
          if (pending == null) pending = data;
          if (!warned) {
            warned = true;
            console.log(JSON.stringify({ time: new Date().toISOString(), event: "BOT_STATE_SAVE_FAILED", error: String(e?.message ?? e) }));
          }
          // A transient full disk or mount hiccup must not leave the retained
          // snapshot in memory forever when no new chat activity arrives.
          scheduleFlush(retryDelay);
          return false;
        }
      }
      return true;
    })().finally(() => { flushing = null; });
    return flushing;
  };

  return {
    load() {
      try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch { return null; }
    },
    save(data) {
      pending = data;
      scheduleFlush(debounceMs);
    },
    flush,
  };
}
