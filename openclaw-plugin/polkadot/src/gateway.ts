// Per-account background loop: long-poll the bot-core bridge and dispatch each
// inbound message into OpenClaw's agent core via channelRuntime.inbound.run.
// The agent's reply comes back through delivery.deliver -> POST /send.
//
// gateway.startAccount is OpenClaw's canonical background-task hook for a channel
// (bounded by ctx.abortSignal). Modeled on extensions/clickclack/src/gateway.ts
// and extensions/raft/src/inbound.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "node:crypto";
import { createBridge, type InboundMsg } from "./bridge.js";
import { POLKADOT_CHANNEL_ID, resolvePolkadotAccount, type ResolvedPolkadotAccount } from "./accounts.js";

const POLL_WAIT_SECS = 25;

// The agent only sees text, so attachments (already downloaded by bot-core)
// surface as bracketed notes with an absolute /media URL the agent can fetch.
function attachmentNotes(msg: InboundMsg, bridgeBaseUrl: string): string {
  if (!msg.attachments?.length) return "";
  const base = bridgeBaseUrl.replace(/\/+$/, "");
  return msg.attachments
    .map((a) =>
      a.downloaded && a.url
        ? `\n[attachment ${a.kind}: ${base}${a.url} (${a.mime}, ${a.size} bytes)]`
        : `\n[attachment ${a.kind} (${a.mime}) failed to download${a.error ? `: ${a.error}` : ""}]`,
    )
    .join("");
}

export async function startPolkadotGatewayAccount(ctx: any): Promise<void> {
  const account: ResolvedPolkadotAccount = resolvePolkadotAccount({ cfg: ctx.cfg, accountId: ctx.account?.accountId });
  if (!account.enabled) return;
  if (!account.configured) throw new Error(`polkadot account "${account.accountId}" is missing bridgeUrl`);

  // gateway startup injects the full PluginRuntimeChannel here (typed thin; cast it — as raft does).
  const channelRuntime = ctx.channelRuntime;
  if (!channelRuntime?.inbound?.run) throw new Error("polkadot requires OpenClaw channel runtime (inbound.run)");

  const bridge = createBridge(account.bridgeUrl);
  ctx.setStatus?.({ accountId: account.accountId, running: true, connected: true, lastStartAt: Date.now(), lastError: null });

  try {
    while (!ctx.abortSignal?.aborted) {
      let batch: InboundMsg[] = [];
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

async function dispatchInbound(
  ctx: any,
  channelRuntime: any,
  account: ResolvedPolkadotAccount,
  bridge: ReturnType<typeof createBridge>,
  msg: InboundMsg,
): Promise<void> {
  const chatId = msg.chat_id;
  const route = channelRuntime.routing.resolveAgentRoute({
    cfg: ctx.cfg,
    channel: POLKADOT_CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: "direct", id: chatId },
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
        textForAgent: msg.text + attachmentNotes(msg, account.bridgeUrl),
        textForCommands: msg.text,
        raw: msg,
      }),
      resolveTurn: (input: any) => {
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
            dispatchSessionKey: route.sessionKey,
          },
          reply: { to: `polkadot:${chatId}`, replyToId: input.id },
          message: { rawBody: input.rawText, bodyForAgent: input.textForAgent, commandBody: input.textForCommands },
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
            deliver: async (payload: any) => {
              const text = String(payload?.text ?? "").trim();
              if (!text) return { visibleReplySent: false };
              await bridge.send(chatId, text);
              return { visibleReplySent: true };
            },
            onError: (e: unknown) => ctx.log?.warn?.(`polkadot deliver failed: ${String(e)}`),
          },
          record: { onRecordError: (e: unknown) => ctx.log?.warn?.(`polkadot session record failed: ${String(e)}`) },
        };
      },
    },
  });
}
