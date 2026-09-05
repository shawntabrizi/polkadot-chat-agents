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
//     pushes carry no `remaining` (the real node sends `None`). A dump with
//     nothing matching is ONE empty page with `remaining: 0`: the RPC's
//     `send_in_chunks` sends nothing, but `Store::subscribe_statement`
//     (statement-store/src/lib.rs) already put that page on the same stream.
//     See docs/decisions.md.
//   - The proof signature is checked (`invalid/badProof`) over the same bytes
//     the real node signs: the SCALE encoding of every field except the proof,
//     without the collection length prefix (`sp_statement_store::Statement::
//     signature_material`, and `getStatementSigner` in the SDK). sr25519 and
//     ed25519 are verified; ecdsa and onChain proofs are not modelled and are
//     refused as `badProof` so a client cannot slip past the check.
//
// Not modelled (yet): per-account byte limits (`dataTooLarge`), global store
// limits (`storeFull`).
//
// Usable as a module (start/stop from tests) or standalone:
//   node lib/store-node.mjs --port 9944

import { WebSocketServer } from "ws";
import { statementCodec } from "@novasamatech/sdk-statement";
import { ed25519 } from "@noble/curves/ed25519.js";
import { verify as verifySr25519 } from "@scure/sr25519";
import { compact } from "scale-ts";

const DEFAULT_MAX_COUNT_PER_ACCOUNT = 1000;
const DEFAULT_PAGE_SIZE = 100;
const HISTORY_PER_SLOT = 100;
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

const hexToBytes = (h) => Uint8Array.from(Buffer.from(stripHex(h), "hex"));

// The bytes a statement proof signs: every field but the proof, SCALE-encoded
// in field order, minus the Vec length prefix the codec adds (the real node
// signs `Field` entries one after another, not a `Vec<Field>`).
function signatureMaterial(decoded) {
  const { proof: _proof, ...unsigned } = decoded;
  const encoded = statementCodec.enc(unsigned);
  return encoded.slice(compact.enc(compact.dec(encoded)).length);
}

// A malformed signer or signature makes the verifiers throw; that is a bad
// proof too, not a node crash.
function proofVerifies(decoded) {
  const proof = decoded.proof;
  try {
    const material = signatureMaterial(decoded);
    if (proof.type === "sr25519") return verifySr25519(material, hexToBytes(proof.value.signature), hexToBytes(proof.value.signer));
    if (proof.type === "ed25519") return ed25519.verify(hexToBytes(proof.value.signature), material, hexToBytes(proof.value.signer));
    return false;
  } catch {
    return false;
  }
}

// A stored statement: { hex, topics: [bareHex], signer: bareHex|null, channel: bareHex|null,
//   expiry: bigint, receivedAt: ms, replacedCount }
function decodeStored(hexWithPrefix) {
  const decoded = statementCodec.dec(hexWithPrefix);
  const proof = decoded.proof ?? null;
  const signer = proof == null ? null : bareHex(proof.value?.signer ?? proof.value?.who ?? null);
  return {
    hex: hexWithPrefix,
    data: bareHex(decoded.data ?? new Uint8Array()),
    topics: (decoded.topics ?? []).map(bareHex),
    signer,
    channel: bareHex(decoded.channel),
    expiry: decoded.expiry ?? 0n,
    hasProof: proof != null,
    proofOk: proof != null && proofVerifies(decoded),
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

export function startStoreNode({
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
  const faultList = []; // { id, kind, signers: Set|null, channel, topic, count, ms, hits, held: [] }
  const watchers = new Set(); // listeners for wire events (the daemon's event stream)
  // What a (signer, channel) slot held before: replaced, evicted or expired
  // statements, newest last, so the inspector can show a slot's history and
  // find ACKs that a later ACK on the same response channel pushed out.
  const history = new Map(); // `${signer}:${channel}` -> [{ ...stored, replacedAt, reason }]

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
  const emit = (event) => { for (const fn of watchers) fn(event); };

  const slotKey = (s) => `${s.signer}:${s.channel}`;
  const retire = (stored, reason) => {
    statements.splice(statements.indexOf(stored), 1);
    if (!stored.channel) return;
    const list = history.get(slotKey(stored)) ?? [];
    list.push({ ...stored, replacedAt: now(), reason });
    if (list.length > HISTORY_PER_SLOT) list.splice(0, list.length - HISTORY_PER_SLOT);
    history.set(slotKey(stored), list);
  };
  const pruneExpired = () => {
    for (const s of [...statements]) {
      if (isExpired(s)) { retire(s, "expired"); emit({ event: "expired", signer: s.signer, channel: s.channel, topics: [...s.topics], expiry: s.expiry }); }
    }
  };

  const faultView = ({ held, signers, ...f }) => ({ ...f, signer: signers ? [...signers] : null, held: held.length });
  const matchingFault = (kind, stored) => faultList.find((f) => f.kind === kind
    && (f.signers == null || f.signers.has(stored.signer))
    && (f.channel == null || f.channel === stored.channel)
    && (f.topic == null || stored.topics.includes(f.topic)));
  const hitFault = (fault, stored = null) => {
    fault.hits += 1;
    const spent = fault.count != null && fault.hits >= fault.count;
    if (spent) faultList.splice(faultList.indexOf(fault), 1);
    log("STORE_NODE_FAULT_HIT", { id: fault.id, kind: fault.kind, hits: fault.hits });
    emit({ event: "fault", action: "hit", ...faultView(fault), spent, signer: stored?.signer ?? null, channel: stored?.channel ?? null });
  };

  const send = (ws, payload) => { if (ws.readyState === ws.OPEN) ws.send(toJson(payload)); };
  const notify = (ws, subId, page) => send(ws, {
    jsonrpc: "2.0",
    method: "statement_subscribeStatement",
    params: { subscription: subId, result: page },
  });

  // Initial dump: everything currently matching, in pages of `pageSize`.
  // Nothing matching still answers one empty page (`remaining: 0`), exactly
  // as `Store::subscribe_statement` does; the SDK's getStatements and the
  // SDK sessions' init() both wait for that page to learn "empty".
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
    if (!stored.proofOk) return { result: { status: "invalid", reason: "badProof" } };
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
    if (drop) { hitFault(drop, stored); return { result: { status: "new" } }; }

    for (const s of evicted) retire(s, s === previous ? "replaced" : "evicted");
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
    emit({ event: "stored", signer: stored.signer, channel: stored.channel, topics: [...stored.topics], expiry: stored.expiry, replaced: previous != null, evicted: evicted.length - (previous ? 1 : 0) });
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
            emit({ event: "refused", signer: stored?.signer ?? null, channel: stored?.channel ?? null, ...outcome.result });
          }
          reply(outcome.result);
        };
        // A delay fault holds the whole submit (validation included), like a
        // node that is slow to process — the client waits for its answer.
        let stored = null;
        try { stored = decodeStored(msg.params[0]); } catch { /* run() reports the decode error */ }
        const delay = stored && matchingFault("delay", stored);
        if (delay) { hitFault(delay, stored); setTimeout(run, delay.ms); return; }
        return run();
      }

      if (msg.method === "statement_subscribeStatement") {
        const filter = msg.params?.[0] ?? "any";
        const subId = `mock-sub-${nextSub++}`;
        reply(subId);
        // A held subscription is not live until released: no dump, no pushes,
        // as if the node had not got round to it yet.
        const hold = faultList.find((f) => f.kind === "holdDump" && filterMentions(filter, f.topic));
        if (hold) { hold.hits += 1; hold.held.push({ ws, subId, filter }); emit({ event: "fault", action: "hit", ...faultView(hold), spent: false }); return; }
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

  // `signer` is one account or a list (a persona's identity and device
  // accounts); null matches every signer. `channel` and `topic` narrow further.
  const signerSet = (signer) => {
    if (signer == null) return null;
    const list = (Array.isArray(signer) ? signer : [signer]).map(bareHex);
    return list.length ? new Set(list) : null;
  };
  const addFault = (fault) => {
    const entry = { id: nextFault++, hits: 0, held: [], ...fault };
    faultList.push(entry);
    log("STORE_NODE_FAULT_SET", { id: entry.id, kind: entry.kind });
    emit({ event: "fault", action: "set", ...faultView(entry) });
    return entry;
  };
  const clearFault = (entry) => {
    const i = faultList.indexOf(entry);
    if (i >= 0) faultList.splice(i, 1);
    for (const held of entry.held.splice(0)) activateSubscription(held);
    emit({ event: "fault", action: "cleared", ...faultView(entry) });
  };
  const faults = {
    // Matching submits answer "new" but are never stored (a lossy node).
    // count: hits before the fault disappears; null = forever.
    drop: ({ signer = null, channel = null, topic = null, count = 1 } = {}) => {
      const entry = addFault({ kind: "drop", signers: signerSet(signer), channel: bareHex(channel), topic: bareHex(topic), count });
      return { id: entry.id, clear: () => clearFault(entry) };
    },
    // Matching submits are processed and answered `ms` later.
    delay: ({ signer = null, channel = null, topic = null, ms, count = null } = {}) => {
      if (!(ms >= 0)) throw new Error("delay fault needs ms >= 0");
      const entry = addFault({ kind: "delay", signers: signerSet(signer), channel: bareHex(channel), topic: bareHex(topic), ms, count });
      return { id: entry.id, clear: () => clearFault(entry) };
    },
    // New subscriptions whose filter mentions `topic` (all of them when topic
    // is omitted) get no dump and no pushes until released.
    holdDump: ({ topic = null } = {}) => {
      const entry = addFault({ kind: "holdDump", topic: bareHex(topic) });
      return { id: entry.id, release: () => clearFault(entry), clear: () => clearFault(entry) };
    },
    list: () => faultList.map(faultView),
    clear: (id = null) => {
      let cleared = 0;
      for (const entry of [...faultList]) if (id == null || entry.id === id) { clearFault(entry); cleared += 1; }
      return cleared;
    },
  };

  const dropClients = () => {
    for (const c of wss.clients) c.terminate();
    subs.clear();
    for (const f of faultList) f.held.length = 0;
  };

  const view = ({ hex, data, topics, signer: sg, channel: ch, expiry, receivedAt, replacedCount, replacedAt = null, reason = null }) =>
    ({ hex, data, topics: [...topics], signer: sg, channel: ch, expiry, receivedAt, replacedCount, replacedAt, reason });
  const selects = (t, s, c) => (e) => (t == null || e.topics.includes(t)) && (s == null || e.signer === s) && (c == null || e.channel === c);

  Object.assign(node, {
    faults,
    // Decoded read side for the inspector; nothing here needs a key. `data`
    // is the statement's data field (bare hex), still encrypted.
    list: ({ topic = null, signer = null, channel = null } = {}) => {
      pruneExpired();
      return statements.filter(selects(bareHex(topic), bareHex(signer), bareHex(channel))).map(view);
    },
    // What slots held before, oldest first: every entry a later statement
    // replaced or evicted, or the clock expired (`reason`, `replacedAt`).
    history: ({ topic = null, signer = null, channel = null } = {}) => {
      pruneExpired();
      return [...history.values()].flat().filter(selects(bareHex(topic), bareHex(signer), bareHex(channel)))
        .sort((a, b) => a.replacedAt - b.replacedAt).map(view);
    },
    // Wire events for the inspector: `stored` (with `replaced` when the
    // statement took over a channel slot), `refused` (rule rejections),
    // `expired`, and `fault` (set / hit / cleared).
    watch: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    // A node restart: every connection drops, the store survives.
    restart: () => { dropClients(); log("STORE_NODE_RESTART", { statements: statements.length }); emit({ event: "node", action: "restart", statements: statements.length }); },
    // A wipe: connections drop and the store is emptied. Faults stay set.
    reset: () => { dropClients(); statements.length = 0; history.clear(); log("STORE_NODE_RESET"); emit({ event: "node", action: "reset" }); },
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
  const node = await startStoreNode({ port });
  console.log(`statement store node listening on ${node.url}`);
}
