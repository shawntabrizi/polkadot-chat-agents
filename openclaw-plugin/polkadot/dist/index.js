// index.ts
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

// src/channel.ts
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createMessageReceiptFromOutboundResults } from "openclaw/plugin-sdk/channel-outbound";

// src/accounts.ts
var POLKADOT_CHANNEL_ID = "polkadot";
var channelCfg = (cfg) => cfg?.channels?.[POLKADOT_CHANNEL_ID] ?? {};
var normId = (s) => String(s).trim().replace(/^0x/i, "").toLowerCase();
function resolvePolkadotAccount({ cfg, accountId }) {
  const root = channelCfg(cfg);
  const id = accountId ?? root.defaultAccount ?? "default";
  const acct = root.accounts?.[id] ?? {};
  const bridgeUrl = acct.bridgeUrl ?? root.bridgeUrl ?? process.env.POLKADOT_BRIDGE_URL ?? "http://127.0.0.1:8799";
  const bridgeToken = String(acct.bridgeToken ?? root.bridgeToken ?? process.env.POLKADOT_BRIDGE_TOKEN ?? "").trim();
  const dmPolicy = acct.dmPolicy ?? root.dmPolicy ?? "pairing";
  const allowFrom = (acct.allowFrom ?? root.allowFrom ?? []).map(normId);
  const enabled = acct.enabled ?? root.enabled ?? true;
  return {
    accountId: id,
    name: acct.name ?? root.name,
    enabled,
    configured: Boolean(bridgeUrl && bridgeToken),
    bridgeUrl,
    bridgeToken,
    dmPolicy,
    allowFrom
  };
}
function listPolkadotAccountIds(cfg) {
  const ids = Object.keys(channelCfg(cfg).accounts ?? {});
  return ids.length ? ids : ["default"];
}
function resolveDefaultPolkadotAccountId(cfg) {
  return channelCfg(cfg).defaultAccount ?? "default";
}

// src/gateway.ts
import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

// src/bridge.ts
var responseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    throw new Error(`bridge returned invalid JSON (HTTP ${response.status})`);
  }
};
var requireSuccess = async (response, operation) => {
  const data = await responseJson(response);
  if (!response.ok || data.success !== true) {
    throw new Error(`${operation} failed: ${String(data.error ?? `HTTP ${response.status}`)}`);
  }
  return data;
};
function createBridge(baseUrl, token) {
  const base = baseUrl.replace(/\/+$/, "");
  if (!token?.trim()) throw new Error("polkadot bridge token is required");
  const headers = { authorization: `Bearer ${token}` };
  return {
    health: async () => {
      const response = await fetch(`${base}/health`, { headers });
      return responseJson(response);
    },
    // Long-poll for inbound messages; returns [] on timeout.
    poll: async (waitSecs, signal, limit = 8) => {
      const cappedLimit = Math.max(1, Math.min(1e3, Math.trunc(limit) || 1));
      const res = await fetch(`${base}/inbound?wait=${waitSecs}&limit=${cappedLimit}`, { headers, signal });
      if (!res.ok) throw new Error(`inbound poll HTTP ${res.status}`);
      const data = await responseJson(res);
      return Array.isArray(data) ? data : [];
    },
    ack: async (deliveryId, leaseId) => {
      if (!deliveryId) throw new Error("cannot acknowledge an empty delivery id");
      if (!leaseId) throw new Error("cannot acknowledge an empty lease id");
      const res = await fetch(`${base}/inbound/ack`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ delivery_id: deliveryId, lease_id: leaseId })
      });
      const data = await requireSuccess(res, "inbound acknowledgement");
      if (data.acknowledged !== 1) throw new Error("inbound acknowledgement lost its lease");
    },
    renew: async (deliveryId, leaseId) => {
      if (!deliveryId) throw new Error("cannot renew an empty delivery id");
      if (!leaseId) throw new Error("cannot renew an empty lease id");
      const res = await fetch(`${base}/inbound/renew`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ delivery_id: deliveryId, lease_id: leaseId })
      });
      const data = await requireSuccess(res, "inbound lease renewal");
      if (data.renewed !== 1) throw new Error("inbound lease renewal lost its lease");
    },
    send: async (chatId, text, options = {}) => {
      const body = {
        chat_id: chatId,
        text,
        ...typeof options.replyTo === "string" ? { reply_to: options.replyTo } : {},
        ...typeof options.threadRootId === "string" ? { thread_root_id: options.threadRootId } : {}
      };
      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await responseJson(res);
      if (!res.ok || data.success !== true) return { success: false, error: data.error ?? `HTTP ${res.status}` };
      return data;
    },
    react: async (chatId, messageId, emoji, remove = false) => {
      const res = await fetch(`${base}/react`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, emoji, remove })
      });
      await requireSuccess(res, "reaction");
    },
    fetchMedia: async (relativePath, signal) => {
      if (!relativePath.startsWith("/media/")) throw new Error("invalid bridge media path");
      const res = await fetch(`${base}${relativePath}`, { headers, signal });
      if (!res.ok) throw new Error(`media download HTTP ${res.status}`);
      return res;
    }
  };
}

// src/gateway.ts
var POLL_WAIT_SECS = 25;
var MAX_CONCURRENT_DISPATCHES = 4;
var MAX_PENDING_DISPATCHES = 100;
var MAX_ATTACHMENTS_PER_MESSAGE = 8;
var MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
var MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024;
var DISPATCH_SHUTDOWN_WAIT_MS = 3e4;
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var BoundedKeyedDispatcher = class {
  constructor(maxConcurrent, maxPending) {
    this.maxConcurrent = maxConcurrent;
    this.maxPending = maxPending;
  }
  queues = /* @__PURE__ */ new Map();
  ready = [];
  readySet = /* @__PURE__ */ new Set();
  activeKeys = /* @__PURE__ */ new Set();
  capacityWaiters = [];
  abortController = new AbortController();
  activeTasks = /* @__PURE__ */ new Set();
  active = 0;
  pending = 0;
  closed = false;
  async submit(key, run) {
    while (!this.closed && this.pending >= this.maxPending) {
      await new Promise((resolve2) => this.capacityWaiters.push(resolve2));
    }
    if (this.closed) throw new Error("polkadot dispatcher is closed");
    let resolve;
    let reject;
    const done = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const queue = this.queues.get(key) ?? [];
    queue.push({ run, resolve, reject });
    this.queues.set(key, queue);
    this.pending += 1;
    this.markReady(key);
    this.pump();
    return { done };
  }
  get signal() {
    return this.abortController.signal;
  }
  async close(reason = new Error("polkadot dispatcher stopped")) {
    if (this.closed) return;
    this.closed = true;
    this.abortController.abort(reason);
    for (const queue of this.queues.values()) {
      for (const task of queue) task.reject(reason);
      this.pending -= queue.length;
    }
    this.queues.clear();
    this.ready.length = 0;
    this.readySet.clear();
    while (this.capacityWaiters.length > 0) this.capacityWaiters.shift()();
    const active = Promise.allSettled([...this.activeTasks]);
    await Promise.race([active, delay(DISPATCH_SHUTDOWN_WAIT_MS)]);
  }
  markReady(key) {
    if (this.activeKeys.has(key) || this.readySet.has(key) || !this.queues.get(key)?.length) return;
    this.ready.push(key);
    this.readySet.add(key);
  }
  pump() {
    while (!this.closed && this.active < this.maxConcurrent && this.ready.length > 0) {
      const key = this.ready.shift();
      this.readySet.delete(key);
      if (this.activeKeys.has(key)) continue;
      const queue = this.queues.get(key);
      const task = queue?.shift();
      if (!task) continue;
      if (queue?.length === 0) this.queues.delete(key);
      this.active += 1;
      this.activeKeys.add(key);
      const running = this.run(key, task);
      this.activeTasks.add(running);
      void running.finally(() => this.activeTasks.delete(running));
    }
  }
  async run(key, task) {
    try {
      await task.run();
      task.resolve();
    } catch (error) {
      task.reject(error);
    } finally {
      this.active -= 1;
      this.pending -= 1;
      this.activeKeys.delete(key);
      this.markReady(key);
      this.releaseCapacity();
      this.pump();
    }
  }
  releaseCapacity() {
    while (this.pending < this.maxPending && this.capacityWaiters.length > 0) this.capacityWaiters.shift()();
  }
};
var extensionForMime = (mime) => {
  const suffix = mime.split("/", 2)[1]?.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return suffix || "bin";
};
var attachmentKind = (value) => value === "image" || value === "video" || value === "general" ? value : "file";
var attachmentMime = (value) => {
  const mime = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/.test(mime) ? mime : "application/octet-stream";
};
var contentLength = (response) => {
  const value = response.headers.get("content-length");
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
var readResponseBytes = async (response, maxBytes) => {
  const declared = contentLength(response);
  if (declared != null && declared > maxBytes) throw new Error("attachment exceeds download limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("attachment response has no body");
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error("attachment exceeds download limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received);
};
async function materializeAttachments(msg, bridge) {
  if (!msg.attachments?.length) return { notes: "" };
  const notes = [];
  let tempDir;
  let totalBytes = 0;
  const ensureTempDir = async () => {
    if (!tempDir) {
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "polkadot-media-"));
      await fsp.chmod(tempDir, 448);
    }
    return tempDir;
  };
  for (const [index, a] of msg.attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).entries()) {
    if (!a || typeof a !== "object") {
      notes.push("\n[attachment metadata was invalid]");
      continue;
    }
    const kind = attachmentKind(a.kind);
    const mime = attachmentMime(a.mime);
    if (!(a.downloaded && a.url)) {
      notes.push(`
[attachment ${kind} (${mime}) could not be downloaded]`);
      continue;
    }
    const advertisedBytes = Number(a.size);
    const remaining = MAX_TOTAL_ATTACHMENT_BYTES - totalBytes;
    if (remaining <= 0 || Number.isFinite(advertisedBytes) && advertisedBytes > Math.min(MAX_ATTACHMENT_BYTES, remaining)) {
      notes.push(`
[attachment ${kind} (${mime}) was skipped because it exceeds the attachment limit]`);
      continue;
    }
    try {
      const response = await bridge.fetchMedia(a.url);
      const bytes = await readResponseBytes(response, Math.min(MAX_ATTACHMENT_BYTES, remaining));
      const dir = await ensureTempDir();
      const filePath = path.join(dir, `attachment-${index}.${extensionForMime(mime)}`);
      await fsp.writeFile(filePath, bytes, { mode: 384, flag: "wx" });
      totalBytes += bytes.byteLength;
      notes.push(`
[attachment ${kind} from the user, saved at ${filePath} (${mime}, ${bytes.byteLength} bytes) - read that file to view it]`);
    } catch (error) {
      notes.push(`
[attachment ${kind}: could not be fetched from the bridge]`);
    }
  }
  if (msg.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    notes.push(`
[${msg.attachments.length - MAX_ATTACHMENTS_PER_MESSAGE} additional attachments were skipped]`);
  }
  return { notes: notes.join(""), tempDir };
}
var cleanupAttachments = async ({ tempDir }) => {
  if (!tempDir) return;
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => void 0);
};
async function startPolkadotGatewayAccount(ctx) {
  const account = resolvePolkadotAccount({ cfg: ctx.cfg, accountId: ctx.account?.accountId });
  if (!account.enabled) return;
  if (!account.configured) throw new Error(`polkadot account "${account.accountId}" is missing bridgeUrl or bridgeToken`);
  const channelRuntime = ctx.channelRuntime;
  if (!channelRuntime?.inbound?.run) throw new Error("polkadot requires OpenClaw channel runtime (inbound.run)");
  const bridge = createBridge(account.bridgeUrl, account.bridgeToken);
  const dispatcher = new BoundedKeyedDispatcher(MAX_CONCURRENT_DISPATCHES, MAX_PENDING_DISPATCHES);
  ctx.setStatus?.({ accountId: account.accountId, running: true, connected: true, lastStartAt: Date.now(), lastError: null });
  try {
    while (!ctx.abortSignal?.aborted) {
      let batch = [];
      try {
        batch = await bridge.poll(POLL_WAIT_SECS, ctx.abortSignal, MAX_CONCURRENT_DISPATCHES * 2);
      } catch (error) {
        if (ctx.abortSignal?.aborted) break;
        ctx.log?.warn?.(`polkadot poll error: ${String(error)}`);
        await delay(1500);
        continue;
      }
      for (const msg of batch) {
        if (ctx.abortSignal?.aborted) break;
        const chatKey = String(msg.chat_id || "invalid");
        const { done } = await dispatcher.submit(
          chatKey,
          () => processDelivery(ctx, channelRuntime, account, bridge, msg, dispatcher.signal)
        );
        void done.catch((error) => ctx.log?.warn?.(`polkadot dispatch task failed: ${String(error)}`));
      }
    }
  } finally {
    await dispatcher.close();
    ctx.setStatus?.({ accountId: account.accountId, running: false, connected: false, lastStopAt: Date.now() });
  }
}
async function processDelivery(ctx, channelRuntime, account, bridge, msg, signal) {
  const lease = startLeaseKeeper(bridge, msg, signal);
  try {
    if (signal.aborted) return;
    try {
      await dispatchInbound(ctx, channelRuntime, account, bridge, msg, signal);
    } catch (error) {
      if (!/initialization conflicted/i.test(String(error))) throw error;
      await delay(1e3);
      if (signal.aborted) return;
      await dispatchInbound(ctx, channelRuntime, account, bridge, msg, signal);
    }
    if (signal.aborted) return;
    await lease.renewNow();
    if (signal.aborted) return;
    if (msg.delivery_id && msg.lease_id) await acknowledgeWithRetry(bridge, msg.delivery_id, msg.lease_id);
  } catch (error) {
    ctx.log?.warn?.(`polkadot dispatch error: ${String(error)}`);
  } finally {
    lease.stop();
  }
}
function startLeaseKeeper(bridge, msg, signal) {
  if (!msg.delivery_id || !msg.lease_id) return { renewNow: async () => {
  }, stop: () => {
  } };
  const advertised = Number(msg.lease_ms);
  const leaseMs = Number.isSafeInteger(advertised) && advertised >= 1e3 ? advertised : 3e5;
  const intervalMs = Math.max(250, Math.min(6e4, Math.floor(leaseMs / 3)));
  let stopped = false;
  let renewing = null;
  const renew = async () => {
    if (stopped || signal.aborted) return;
    if (renewing) return renewing;
    renewing = bridge.renew(msg.delivery_id, msg.lease_id).finally(() => {
      renewing = null;
    });
    return renewing;
  };
  const timer = setInterval(() => {
    void renew().catch(() => {
    });
  }, intervalMs);
  return {
    renewNow: renew,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}
async function acknowledgeWithRetry(bridge, deliveryId, leaseId) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await bridge.ack(deliveryId, leaseId);
      return;
    } catch (error) {
      lastError = error;
      await delay(250 * (attempt + 1));
    }
  }
  throw lastError ?? new Error("inbound acknowledgement failed");
}
async function dispatchInbound(ctx, channelRuntime, account, bridge, msg, signal) {
  const chatId = msg.chat_id;
  const threadRootId = typeof msg.thread_root_id === "string" ? msg.thread_root_id : void 0;
  const isChannel = msg.conversation_type === "channel";
  const senderId = typeof msg.sender_xid === "string" ? msg.sender_xid : chatId;
  const senderName = typeof msg.sender_name === "string" && msg.sender_name ? msg.sender_name : senderId;
  const materialized = await materializeAttachments(msg, bridge);
  try {
    const route = channelRuntime.routing.resolveAgentRoute({
      cfg: ctx.cfg,
      channel: POLKADOT_CHANNEL_ID,
      accountId: account.accountId,
      peer: { kind: "direct", id: chatId }
    });
    const storePath = channelRuntime.session.resolveStorePath(ctx.cfg.session?.store, { agentId: route.agentId });
    await channelRuntime.inbound.run({
      channel: POLKADOT_CHANNEL_ID,
      accountId: account.accountId,
      raw: msg,
      adapter: {
        ingest: () => ({
          id: msg.message_id || randomUUID(),
          timestamp: Date.now(),
          rawText: msg.text,
          textForAgent: msg.text + materialized.notes,
          textForCommands: msg.text,
          raw: msg
        }),
        resolveTurn: (input) => {
          const ctxPayload = channelRuntime.inbound.buildContext({
            channel: POLKADOT_CHANNEL_ID,
            accountId: account.accountId,
            provider: POLKADOT_CHANNEL_ID,
            surface: POLKADOT_CHANNEL_ID,
            messageId: input.id,
            timestamp: input.timestamp,
            from: `polkadot:${senderId}`,
            sender: { id: senderId, name: senderName },
            conversation: { kind: isChannel ? "group" : "direct", id: chatId, label: chatId },
            route: {
              agentId: route.agentId,
              accountId: account.accountId,
              routeSessionKey: route.sessionKey,
              dispatchSessionKey: route.sessionKey
            },
            reply: { to: `polkadot:${chatId}`, replyToId: input.id },
            message: { rawBody: input.rawText, bodyForAgent: input.textForAgent, commandBody: input.textForCommands }
          });
          return {
            cfg: ctx.cfg,
            channel: POLKADOT_CHANNEL_ID,
            accountId: account.accountId,
            agentId: route.agentId,
            routeSessionKey: route.sessionKey,
            storePath,
            ctxPayload,
            recordInboundSession: channelRuntime.session.recordInboundSession,
            dispatchReplyWithBufferedBlockDispatcher: channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
            // The single seam where the agent's generated reply reaches the bridge.
            delivery: {
              deliver: async (payload) => {
                if (signal.aborted) throw new Error("polkadot dispatcher stopped");
                const text = String(payload?.text ?? "").trim();
                if (!text) return { visibleReplySent: false };
                const result = await bridge.send(chatId, text, {
                  replyTo: msg.message_id,
                  threadRootId
                });
                if (!result.success) throw new Error(`polkadot /send failed: ${result.error ?? "unknown"}`);
                return { visibleReplySent: true };
              },
              onError: (error) => ctx.log?.warn?.(`polkadot deliver failed: ${String(error)}`)
            },
            record: { onRecordError: (error) => ctx.log?.warn?.(`polkadot session record failed: ${String(error)}`) }
          };
        }
      }
    });
  } finally {
    await cleanupAttachments(materialized);
  }
}

// src/channel.ts
var polkadotPlugin = createChatChannelPlugin({
  base: {
    id: POLKADOT_CHANNEL_ID,
    meta: {
      id: POLKADOT_CHANNEL_ID,
      label: "Polkadot",
      selectionLabel: "Polkadot (app chat)",
      docsPath: "/channels/polkadot",
      docsLabel: "polkadot",
      blurb: "Chat with your agent from the Polkadot mobile app, over the Statement Store.",
      order: 80
    },
    capabilities: { chatTypes: ["direct"] },
    reload: { configPrefixes: ["channels.polkadot"] },
    config: {
      listAccountIds: listPolkadotAccountIds,
      resolveAccount: (cfg, accountId) => resolvePolkadotAccount({ cfg, accountId }),
      defaultAccountId: resolveDefaultPolkadotAccountId,
      isConfigured: (a) => a.configured,
      isEnabled: (a) => a.enabled,
      resolveAllowFrom: ({ cfg, accountId }) => resolvePolkadotAccount({ cfg, accountId }).allowFrom
    },
    // The background long-poll loop that pulls messages from the bot-core bridge.
    gateway: { startAccount: startPolkadotGatewayAccount }
  },
  // Gate who may DM the agent (peer chat-ids in allowFrom); bot-core also enforces
  // its own allowlist, so this is defense-in-depth.
  security: {
    dm: {
      channelKey: POLKADOT_CHANNEL_ID,
      resolvePolicy: (a) => a.dmPolicy,
      resolveAllowFrom: (a) => a.allowFrom,
      defaultPolicy: "pairing",
      approveHint: "openclaw pairing approve polkadot <code>"
    }
  },
  // Outbound: POST the agent's reply to the bot-core bridge.
  outbound: {
    base: { deliveryMode: "direct" },
    attachedResults: {
      channel: POLKADOT_CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId }) => {
        const account = resolvePolkadotAccount({ cfg, accountId });
        const res = await createBridge(account.bridgeUrl, account.bridgeToken).send(to, text);
        if (!res.success) throw new Error(`polkadot /send failed for ${to}: ${res.error ?? "unknown"}`);
        const messageId = String(res.message_id ?? Date.now());
        return {
          messageId,
          chatId: to,
          receipt: createMessageReceiptFromOutboundResults({
            results: [{ channel: POLKADOT_CHANNEL_ID, messageId }],
            kind: "text"
          })
        };
      }
    }
  }
});

// index.ts
var index_default = defineChannelPluginEntry({
  id: "polkadot",
  name: "Polkadot",
  description: "Polkadot app chat channel \u2014 bridges the Polkadot mobile app to OpenClaw via the bot-core HTTP bridge.",
  plugin: polkadotPlugin
});
export {
  index_default as default
};
