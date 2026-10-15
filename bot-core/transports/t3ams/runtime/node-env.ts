// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Browser globals the T3ams messaging stack reads, provided for Node.
 *
 * Imported first by the runtime entry: several T3ams modules read `window`,
 * `localStorage` or `fetch` while they evaluate. Nothing here pretends to be a
 * DOM. It only satisfies the few checks the messaging code makes:
 *
 * - `window`: the MLS binding (core-crypto) initialises only when it exists.
 * - `localStorage` / `sessionStorage`: small UI flags (theme, reload markers).
 *   Kept in memory; everything durable goes through the host key-value store,
 *   which the agent backs with a file (see `agent.ts`).
 * - `fetch`: core-crypto loads its WASM through `fetch`. The build copies the
 *   artifact next to this bundle and requests for it are served from disk.
 */

import { readFileSync } from "node:fs";

const globals = globalThis as unknown as Record<string, unknown>;

globals["window"] ??= globalThis;
globals["global"] ??= globalThis;

// Route watchers and lifecycle hooks subscribe to window events and read the
// current path; an agent has one fixed route and no events to deliver.
const windowEvents = new EventTarget();
globals["addEventListener"] ??= windowEvents.addEventListener.bind(windowEvents);
globals["removeEventListener"] ??= windowEvents.removeEventListener.bind(windowEvents);
globals["dispatchEvent"] ??= windowEvents.dispatchEvent.bind(windowEvents);
globals["location"] ??= { pathname: "/", hash: "", search: "", host: "", hostname: "", protocol: "agent:", href: "agent:/" };
const documentEvents = new EventTarget();
globals["document"] ??= {
  visibilityState: "visible",
  hidden: false,
  hasFocus: () => false,
  addEventListener: documentEvents.addEventListener.bind(documentEvents),
  removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
};
globals["history"] ??= { pushState() {}, replaceState() {}, back() {}, forward() {}, go() {}, state: null, length: 1 };

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  let usable = false;
  try {
    // Node 25 exposes a `localStorage` getter that warns and returns an
    // unusable object unless started with `--localstorage-file`.
    const existing = globals[name] as Storage | undefined;
    existing?.setItem("__t3ams_probe__", "1");
    existing?.removeItem("__t3ams_probe__");
    usable = existing != null;
  } catch {
    usable = false;
  }
  if (!usable) {
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true, writable: true });
  }
}

const WASM_FILE = new URL("./index_bg.wasm", import.meta.url);
let wasmBytes: ArrayBuffer | null = null;
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/index_bg[^/]*\.wasm(?:$|\?)/.test(url)) {
    wasmBytes ??= Uint8Array.from(readFileSync(WASM_FILE)).buffer;
    return new Response(wasmBytes, { headers: { "content-type": "application/wasm" } });
  }
  return realFetch(input, init);
}) as typeof globalThis.fetch;
