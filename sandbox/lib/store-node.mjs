// In-memory statement-store node for the sandbox and for bot-core's offline
// transport tests.
//
// Speaks the statement JSON-RPC surface that clients use: statement_submit,
// statement_subscribeStatement (initial dump in pages + live pushes),
// statement_unsubscribeStatement, and the papi connect probes. Everything
// else answers "method not found", which the unused papi internals tolerate.
//
// It enforces the store rules the chat protocol depends on, taken from the
// real node (polkadot-sdk substrate/client/statement-store/src/lib.rs,
// `SubmitIndex::insert` and `Store::submit`) and the chat spec
// (chat-spec/base-spec.md, "expiry" and "channel"):
//
//   - One statement per (signer, channel). A new statement replaces the old
//     one only when its expiry is STRICTLY greater; lower or EQUAL is rejected
//     with `channelPriorityTooLow { submitted_expiry, min_expiry }`. The real
//     node's check is `expiry <= channel_record.expiry` (its own test says
//     "Equal priority should be rejected"), the spec says "strictly greater",
//     and the SDK's session keeps `Expiry(A, B)` strictly monotonic
//     (`nextExpiry` = max(fresh, current + 1)) for that reason. The sandbox
//     plan's "equal or higher" wording is wrong and is not implemented.
//   - Resubmitting a statement the store already holds answers `known`.
//   - Expiry is `u64(expiration_secs) << 32 | sequence`; a statement whose
//     expiration is not in the future is `invalid/alreadyExpired`, and stored
//     statements vanish once the clock passes their expiration.
//   - A signer without an allowance is rejected with `noAllowance`.
//   - Per-account statement count: a new statement evicts the account's
//     lowest-expiry statements to make room, but only ones with a strictly
//     lower expiry; otherwise `accountFull { submitted_expiry, min_expiry }`.
//   - Initial dumps are paged; each page carries `remaining` = how many
//     matching statements follow, the last page has `remaining: 0`. Live
//     pushes carry no `remaining` (the real node sends `None`).
//
// Not modelled (yet): signature verification (`badProof`), per-account byte
// limits (`dataTooLarge`), global store limits (`storeFull`).
//
// Usable as a module (start/stop from tests) or standalone:
//   node lib/store-node.mjs --port 9944

import { WebSocketServer } from "ws";
import { statementCodec } from "@novasamatech/sdk-statement";

const DEFAULT_MAX_COUNT_PER_ACCOUNT = 1000;
const DEFAULT_PAGE_SIZE = 100;
// jsonrpsee: base STATEMENT (7000) + 1, "Statement store error: ...".
const RPC_STATEMENT_STORE_ERROR = 7001;

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const stripHex = (h) => String(h).replace(/^0x/i, "").toLowerCase();
const bareHex = (value) => (value == null ? null : stripHex(typeof value === "string" ? value : toHex(value)));
// u64 expiries exceed 2^53, and the real node writes them as bare JSON
// integers; stringify bigints the same way so the wire bytes match.
const toJson = (value) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `\u0000big:${v}\u0000` : v))
  .replace(/"\\u0000big:(\d+)\\u0000"/g, "$1");
const log = (event, extra = {}) => process.stderr.write(`${toJson({ ts: new Date().toISOString(), event, ...extra })}\n`);

// A stored statement: { hex, topics: [bareHex], signer: bareHex|null, channel: bareHex|null,
//   expiry: bigint, receivedAt: ms, replacedCount }
function decodeStored(hexWithPrefix) {
  const decoded = statementCodec.dec(hexWithPrefix);
  const proof = decoded.proof ?? null;
  const signer = proof == null ? null : bareHex(proof.value?.signer ?? proof.value?.who ?? null);
  return {
    hex: hexWithPrefix,
    topics: (decoded.topics ?? []).map(bareHex),
    signer,
    channel: bareHex(decoded.channel),
    expiry: decoded.expiry ?? 0n,
    hasProof: proof != null,
  };
}

const expirationSecs = (expiry) => Number(expiry >> 32n);

function matchesFilter(stored, filter) {
  if (filter === "any" || filter == null) return true;
  if (Array.isArray(filter.matchAll)) {
    return filter.matchAll.every((t) => stored.topics.includes(stripHex(t)));
  }
  if (Array.isArray(filter.matchAny)) {
    return filter.matchAny.some((t) => stored.topics.includes(stripHex(t)));
  }
  return false;
}

const filterMentions = (filter, topic) => {
  if (topic == null) return true;
  const topics = filter?.matchAll ?? filter?.matchAny ?? [];
  return topics.some((t) => stripHex(t) === stripHex(topic));
};

export function startMockStatementNode({
  port = 0,
  host = "127.0.0.1",
  allowances = null,
  maxCountPerAccount = DEFAULT_MAX_COUNT_PER_ACCOUNT,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const statements = []; // insertion order; the live reference tests assert on
  const subs = new Map(); // subId -> { ws, filter }
  let nextSub = 1;
  let nextFault = 1;
  const faultList = []; // { id, kind, signer, channel, count, ms, topic, hits, held: [] }

  const node = {
    port: 0,
    url: "",
    statements,
    // null = every signer may submit; a Set of signer hex = only those may.
    allowances,
    limits: { maxCountPerAccount },
    clock: { offsetMs: 0 },
  };

  const now = () => Date.now() + node.clock.offsetMs;
  const isExpired = (stored) => Math.floor(now() / 1000) >= expirationSecs(stored.expiry);
  const pruneExpired = () => {
    for (let i = statements.length - 1; i >= 0; i -= 1) {
      if (isExpired(statements[i])) statements.splice(i, 1);
    }
  };

  const matchingFault = (kind, stored) => faultList.find((f) => f.kind === kind
    && (f.signer == null || f.signer === stored.signer)
    && (f.channel == null || f.channel === stored.channel));
  const hitFault = (fault) => {
    fault.hits += 1;
    if (fault.count != null && fault.hits >= fault.count) faultList.splice(faultList.indexOf(fault), 1);
    log("STORE_NODE_FAULT_HIT", { id: fault.id, kind: fault.kind, hits: fault.hits });
  };

  const send = (ws, payload) => { if (ws.readyState === ws.OPEN) ws.send(toJson(payload)); };
  const notify = (ws, subId, page) => send(ws, {
    jsonrpc: "2.0",
    method: "statement_subscribeStatement",
    params: { subscription: subId, result: page },
  });

  // Initial dump: everything currently matching, in pages of `pageSize`.
  // A store with nothing matching still answers one empty page. The real
  // node (send_in_chunks) sends nothing at all in that case, but the SDK's
  // getStatements — and so bot-core's poll sweep — only resolves on a page,
  // so an empty page keeps them from hanging. Open question in docs/questions.md.
  const sendDump = (ws, subId, filter) => {
    pruneExpired();
    const dump = statements.filter((s) => matchesFilter(s, filter)).map((s) => s.hex);
    if (dump.length === 0) return notify(ws, subId, { event: "newStatements", data: { statements: [], remaining: 0 } });
    for (let i = 0; i < dump.length; i += pageSize) {
      const page = dump.slice(i, i + pageSize);
      notify(ws, subId, { event: "newStatements", data: { statements: page, remaining: dump.length - i - page.length } });
    }
  };

  const activateSubscription = ({ ws, subId, filter }) => {
    if (ws.readyState !== ws.OPEN) return;
    subs.set(subId, { ws, filter });
    sendDump(ws, subId, filter);
  };

  // Rules follow the real node's Store::submit order; every reason string
  // and field name is what the real node serialises (serde camelCase tags,
  // snake_case fields), so clients see the same shapes they see live.
  const submit = (hexWithPrefix) => {
    let stored;
    try { stored = decodeStored(hexWithPrefix); }
    catch (e) { return { error: `Error decoding statement: ${String(e?.message ?? e)}` }; }
    pruneExpired();
    if (isExpired(stored)) return { result: { status: "invalid", reason: "alreadyExpired" } };
    if (statements.some((s) => stripHex(s.hex) === stripHex(stored.hex))) return { result: { status: "known" } };
    if (!stored.hasProof) return { result: { status: "invalid", reason: "noProof" } };
    if (node.allowances != null && !node.allowances.has(stored.signer) && !node.allowances.has(`0x${stored.signer}`)) {
      return { result: { status: "rejected", reason: "noAllowance" } };
    }

    const evicted = [];
    // Only channelled statements occupy a slot; channel-less ones just count.
    const previous = stored.channel
      ? statements.find((s) => s.signer === stored.signer && s.channel === stored.channel)
      : null;
    if (previous) {
      if (stored.expiry <= previous.expiry) {
        return { result: { status: "rejected", reason: "channelPriorityTooLow", submitted_expiry: stored.expiry, min_expiry: previous.expiry } };
      }
      evicted.push(previous);
    }
    // Count limit: evict the account's lowest-expiry statements first, and
    // only ones the newcomer outranks; the first one it does not outrank is
    // the `min_expiry` the client must beat.
    const own = statements.filter((s) => s.signer === stored.signer && !evicted.includes(s))
      .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
    for (const candidate of own) {
      if (own.length - (evicted.length - (previous ? 1 : 0)) + 1 <= node.limits.maxCountPerAccount) break;
      if (candidate.expiry >= stored.expiry) {
        return { result: { status: "rejected", reason: "accountFull", submitted_expiry: stored.expiry, min_expiry: candidate.expiry } };
      }
      evicted.push(candidate);
    }

    const drop = matchingFault("drop", stored);
    if (drop) { hitFault(drop); return { result: { status: "new" } }; }

    for (const s of evicted) statements.splice(statements.indexOf(s), 1);
    statements.push({
      ...stored,
      receivedAt: now(),
      replacedCount: previous ? previous.replacedCount + 1 : 0,
    });
    for (const [id, sub] of subs) {
      if (matchesFilter(stored, sub.filter)) {
        notify(sub.ws, id, { event: "newStatements", data: { statements: [stored.hex] } });
      }
    }
    return { result: { status: "new" } };
  };

  const wss = new WebSocketServer({ port, host });

  wss.on("connection", (ws) => {
    ws.on("close", () => {
      for (const [id, sub] of subs) if (sub.ws === ws) subs.delete(id);
    });
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (process.env.MOCK_DEBUG) console.error("[mock] <-", msg.method, msg.id ?? "");
      const reply = (result) => send(ws, { jsonrpc: "2.0", id: msg.id, result });
      const replyError = (code, message) => send(ws, { jsonrpc: "2.0", id: msg.id, error: { code, message } });

      // papi probes rpc_methods on connect and treats an error reply as a dead
      // endpoint (reconnect loop). Advertise the modern method names so its
      // translator passes requests through untouched.
      if (msg.method === "rpc_methods") {
        return reply({
          methods: [
            "statement_submit", "statement_subscribeStatement", "statement_unsubscribeStatement",
            "chainHead_v1_follow", "chainHead_v1_unfollow", "chainHead_v1_body", "chainHead_v1_call",
            "chainHead_v1_header", "chainHead_v1_storage", "chainHead_v1_stopOperation",
            "chainHead_v1_continue", "chainHead_v1_unpin",
            "chainSpec_v1_chainName", "chainSpec_v1_genesisHash", "chainSpec_v1_properties",
          ],
        });
      }
      if (msg.method === "chainSpec_v1_chainName") return reply("sandbox-statement-node");
      if (msg.method === "chainSpec_v1_genesisHash") return reply(`0x${"00".repeat(32)}`);
      if (msg.method === "chainSpec_v1_properties") return reply({});
      // papi eagerly opens a chainHead follow and treats an error reply as a
      // dead endpoint. Hand it a subscription id and stay silent — the
      // statement paths under test never consume chainHead events.
      if (msg.method === "chainHead_v1_follow") return reply(`mock-follow-${nextSub++}`);
      if (msg.method === "chainHead_v1_unfollow") return reply(null);

      if (msg.method === "statement_submit") {
        const run = () => {
          const outcome = submit(msg.params[0]);
          if (outcome.error) return replyError(RPC_STATEMENT_STORE_ERROR, `Statement store error: ${outcome.error}`);
          if (outcome.result.status !== "new" && outcome.result.status !== "known") {
            log("STORE_NODE_SUBMIT_REFUSED", { ...outcome.result });
          }
          reply(outcome.result);
        };
        // A delay fault holds the whole submit (validation included), like a
        // node that is slow to process — the client waits for its answer.
        let stored = null;
        try { stored = decodeStored(msg.params[0]); } catch { /* run() reports the decode error */ }
        const delay = stored && matchingFault("delay", stored);
        if (delay) { hitFault(delay); setTimeout(run, delay.ms); return; }
        return run();
      }

      if (msg.method === "statement_subscribeStatement") {
        const filter = msg.params?.[0] ?? "any";
        const subId = `mock-sub-${nextSub++}`;
        reply(subId);
        // A held subscription is not live until released: no dump, no pushes,
        // as if the node had not got round to it yet.
        const hold = faultList.find((f) => f.kind === "holdDump" && filterMentions(filter, f.topic));
        if (hold) { hold.hits += 1; hold.held.push({ ws, subId, filter }); return; }
        return activateSubscription({ ws, subId, filter });
      }

      if (msg.method === "statement_unsubscribeStatement") {
        const subId = msg.params?.[0];
        reply(subs.delete(subId));
        return;
      }

      return replyError(-32601, `Method not found: ${msg.method}`);
    });
  });

  const addFault = (fault) => {
    const entry = { id: nextFault++, hits: 0, held: [], ...fault };
    faultList.push(entry);
    log("STORE_NODE_FAULT_SET", { id: entry.id, kind: entry.kind });
    return entry;
  };
  const clearFault = (entry) => {
    const i = faultList.indexOf(entry);
    if (i >= 0) faultList.splice(i, 1);
    for (const held of entry.held.splice(0)) activateSubscription(held);
  };
  const faults = {
    // Matching submits answer "new" but are never stored (a lossy node).
    drop: ({ signer = null, channel = null, count = 1 } = {}) => {
      const entry = addFault({ kind: "drop", signer: bareHex(signer), channel: bareHex(channel), count });
      return { id: entry.id, clear: () => clearFault(entry) };
    },
    // Matching submits are processed and answered `ms` later.
    delay: ({ signer = null, channel = null, ms, count = null } = {}) => {
      if (!(ms >= 0)) throw new Error("delay fault needs ms >= 0");
      const entry = addFault({ kind: "delay", signer: bareHex(signer), channel: bareHex(channel), ms, count });
      return { id: entry.id, clear: () => clearFault(entry) };
    },
    // New subscriptions whose filter mentions `topic` (all of them when topic
    // is omitted) get no dump and no pushes until released.
    holdDump: ({ topic = null } = {}) => {
      const entry = addFault({ kind: "holdDump", topic: bareHex(topic) });
      return { id: entry.id, release: () => clearFault(entry), clear: () => clearFault(entry) };
    },
    list: () => faultList.map(({ held, ...f }) => ({ ...f, held: held.length })),
    clear: (id = null) => {
      for (const entry of [...faultList]) if (id == null || entry.id === id) clearFault(entry);
    },
  };

  const dropClients = () => {
    for (const c of wss.clients) c.terminate();
    subs.clear();
    for (const f of faultList) f.held.length = 0;
  };

  Object.assign(node, {
    faults,
    // Decoded read side for the inspector; nothing here needs a key.
    list: ({ topic = null, signer = null, channel = null } = {}) => {
      pruneExpired();
      const [t, s, c] = [bareHex(topic), bareHex(signer), bareHex(channel)];
      return statements
        .filter((e) => (t == null || e.topics.includes(t)) && (s == null || e.signer === s) && (c == null || e.channel === c))
        .map(({ hex, topics, signer: sg, channel: ch, expiry, receivedAt, replacedCount }) =>
          ({ hex, topics: [...topics], signer: sg, channel: ch, expiry, receivedAt, replacedCount }));
    },
    // A node restart: every connection drops, the store survives.
    restart: () => { dropClients(); log("STORE_NODE_RESTART", { statements: statements.length }); },
    // A wipe: connections drop and the store is emptied. Faults stay set.
    reset: () => { dropClients(); statements.length = 0; log("STORE_NODE_RESET"); },
    close: () => new Promise((r) => { dropClients(); wss.close(() => r()); }),
  });

  return new Promise((resolve, reject) => {
    wss.on("error", reject);
    wss.on("listening", () => {
      node.port = wss.address().port;
      node.url = `ws://${host}:${node.port}`;
      resolve(node);
    });
  });
}

// Standalone: node lib/store-node.mjs --port 9944
if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 9944;
  const node = await startMockStatementNode({ port });
  console.log(`statement store node listening on ${node.url}`);
}
