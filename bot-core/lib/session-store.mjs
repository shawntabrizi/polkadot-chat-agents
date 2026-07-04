// Tiny disk-backed JSON store for bot session state, so conversations survive a
// restart. Atomic (tmp + rename), debounced, mode 0600 (it holds key material).
// Best-effort: a persistence error never crashes the bot.
import fs from "node:fs";
import path from "node:path";

export function createStateStore(filePath, { debounceMs = 1000 } = {}) {
  let timer = null;
  let pending = null;

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending == null) return;
    const data = pending; pending = null;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, filePath);
    } catch { /* best-effort: don't let a disk error take the bot down */ }
  };

  return {
    load() {
      try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch { return null; }
    },
    save(data) {
      pending = data;
      if (!timer) timer = setTimeout(flush, debounceMs);
    },
    flush,
  };
}
