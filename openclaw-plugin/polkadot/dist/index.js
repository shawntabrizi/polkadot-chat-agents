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
  const dmPolicy = acct.dmPolicy ?? root.dmPolicy ?? "pairing";
  const allowFrom = (acct.allowFrom ?? root.allowFrom ?? []).map(normId);
  const enabled = acct.enabled ?? root.enabled ?? true;
  return { accountId: id, name: acct.name ?? root.name, enabled, configured: Boolean(bridgeUrl), bridgeUrl, dmPolicy, allowFrom };
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

// src/bridge.ts
function createBridge(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    health: () => fetch(`${base}/health`).then((r) => r.json()),
    // Long-poll for inbound messages; returns [] on timeout.
    poll: async (waitSecs, signal) => {
      const res = await fetch(`${base}/inbound?wait=${waitSecs}`, { signal });
      if (!res.ok) throw new Error(`inbound poll HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    send: async (chatId, text) => {
      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      return res.json();
    }
  };
}

// src/gateway.ts
var POLL_WAIT_SECS = 25;
async function startPolkadotGatewayAccount(ctx) {
  const account = resolvePolkadotAccount({ cfg: ctx.cfg, accountId: ctx.account?.accountId });
  if (!account.enabled) return;
  if (!account.configured) throw new Error(`polkadot account "${account.accountId}" is missing bridgeUrl`);
  const channelRuntime = ctx.channelRuntime;
  if (!channelRuntime?.inbound?.run) throw new Error("polkadot requires OpenClaw channel runtime (inbound.run)");
  const bridge = createBridge(account.bridgeUrl);
  ctx.setStatus?.({ accountId: account.accountId, running: true, connected: true, lastStartAt: Date.now(), lastError: null });
  try {
    while (!ctx.abortSignal?.aborted) {
      let batch = [];
      try {
        batch = await bridge.poll(POLL_WAIT_SECS, ctx.abortSignal);
      } catch (err) {
        if (ctx.abortSignal?.aborted) break;
        ctx.log?.warn?.(`polkadot poll error: ${String(err)}`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      for (const msg of batch) {
        if (ctx.abortSignal?.aborted) break;
        try {
          await dispatchInbound(ctx, channelRuntime, account, bridge, msg);
        } catch (err) {
          ctx.log?.warn?.(`polkadot dispatch error: ${String(err)}`);
        }
      }
    }
  } finally {
    ctx.setStatus?.({ accountId: account.accountId, running: false, connected: false, lastStopAt: Date.now() });
  }
}
async function dispatchInbound(ctx, channelRuntime, account, bridge, msg) {
  const chatId = msg.chat_id;
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
        textForAgent: msg.text,
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
          from: `polkadot:${chatId}`,
          sender: { id: chatId, name: chatId },
          conversation: { kind: "direct", id: chatId, label: chatId },
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
              const text = String(payload?.text ?? "").trim();
              if (!text) return { visibleReplySent: false };
              await bridge.send(chatId, text);
              return { visibleReplySent: true };
            },
            onError: (e) => ctx.log?.warn?.(`polkadot deliver failed: ${String(e)}`)
          },
          record: { onRecordError: (e) => ctx.log?.warn?.(`polkadot session record failed: ${String(e)}`) }
        };
      }
    }
  });
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
        const res = await createBridge(account.bridgeUrl).send(to, text);
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
