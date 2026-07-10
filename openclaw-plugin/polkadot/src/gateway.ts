// Per-account background loop: long-poll the bot-core bridge and dispatch each
// inbound message into OpenClaw's agent core via channelRuntime.inbound.run.
// The agent's reply comes back through delivery.deliver -> POST /send.
//
// gateway.startAccount is OpenClaw's canonical background-task hook for a channel
// (bounded by ctx.abortSignal). Modeled on extensions/clickclack/src/gateway.ts
// and extensions/raft/src/inbound.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge, type InboundMsg } from "./bridge.js";
import { POLKADOT_CHANNEL_ID, resolvePolkadotAccount, type ResolvedPolkadotAccount } from "./accounts.js";

const POLL_WAIT_SECS = 25;

// The agent only sees text, and the gateway container has no curl/wget for it
// to fetch URLs with — so fetch each attachment from the bridge here (plain
// Node fetch) and hand the agent a LOCAL file path. The Claude CLI's Read tool
// renders image files natively, which is what actually gives the agent vision.
async function materializeAttachments(msg: InboundMsg, bridgeBaseUrl: string): Promise<string> {
  if (!msg.attachments?.length) return "";
  const base = bridgeBaseUrl.replace(/\/+$/, "");
  const notes: string[] = [];
  for (const a of msg.attachments) {
    if (!(a.downloaded && a.url)) {
      notes.push(`\n[attachment ${a.kind} (${a.mime}) failed to download${a.error ? `: ${a.error}` : ""}]`);
      continue;
    }
    try {
      const res = await fetch(`${base}${a.url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = a.mime.split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
      const filePath = path.join(os.tmpdir(), `polkadot-media-${a.id.slice(0, 16)}.${ext}`);
      await fsp.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
      notes.push(`\n[attachment ${a.kind} from the user, saved at ${filePath} (${a.mime}, ${a.size} bytes) — read that file to view it]`);
    } catch (err) {
      notes.push(`\n[attachment ${a.kind}: could not be fetched from the bridge (${String(err)}); metadata: ${a.mime}, ${a.size} bytes]`);
    }
  }
  return notes.join("");
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
          // "reply session initialization conflicted" is a pre-agent race in
          // OpenClaw's session store (a lost optimistic commit right after a
          // turn ends with a CLI-session restart) — the agent never ran, so a
          // retry is idempotent and almost always wins the second time.
          if (/initialization conflicted/i.test(String(err))) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              await dispatchInbound(ctx, channelRuntime, account, bridge, msg);
              continue;
            } catch (retryErr) {
              ctx.log?.warn?.(`polkadot dispatch retry failed: ${String(retryErr)}`);
            }
          }
          // The message is already drained from the bridge (custody is ours),
          // so a silent drop looks like a frozen chat — tell the user.
          try {
            await bridge.send(msg.chat_id, "⚠️ I hit a snag processing that message — please send it again.");
          } catch { /* best effort */ }
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
  const attachmentNotes = await materializeAttachments(msg, account.bridgeUrl);
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
        textForAgent: msg.text + attachmentNotes,
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
