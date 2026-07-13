// The polkadot channel plugin: composes base + security (allowlist) + outbound.
// Inbound is driven by the gateway long-poll loop (see gateway.ts).
//
// NOTE: built against the OpenClaw channel-plugin SDK (pluginApi >= 2026.6.11),
// modeled on the in-repo `raft` (structure) and `clickclack` (polling + outbound)
// channels. Untested against a live OpenClaw install — treat as the reference
// implementation to drop in and `openclaw plugins inspect`.

import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createMessageReceiptFromOutboundResults } from "openclaw/plugin-sdk/channel-outbound";
import {
  POLKADOT_CHANNEL_ID,
  listPolkadotAccountIds,
  resolveDefaultPolkadotAccountId,
  resolvePolkadotAccount,
  type ResolvedPolkadotAccount,
} from "./accounts.js";
import { startPolkadotGatewayAccount } from "./gateway.js";
import { createBridge } from "./bridge.js";

export const polkadotPlugin: ChannelPlugin<ResolvedPolkadotAccount> = createChatChannelPlugin<ResolvedPolkadotAccount>({
  base: {
    id: POLKADOT_CHANNEL_ID,
    meta: {
      id: POLKADOT_CHANNEL_ID,
      label: "Polkadot",
      selectionLabel: "Polkadot (app chat)",
      docsPath: "/channels/polkadot",
      docsLabel: "polkadot",
      blurb: "Chat with your agent from the Polkadot mobile app, over the Statement Store.",
      order: 80,
    },
    capabilities: { chatTypes: ["direct"] },
    reload: { configPrefixes: ["channels.polkadot"] },
    config: {
      listAccountIds: listPolkadotAccountIds,
      resolveAccount: (cfg: unknown, accountId?: string | null) => resolvePolkadotAccount({ cfg, accountId }),
      defaultAccountId: resolveDefaultPolkadotAccountId,
      isConfigured: (a: ResolvedPolkadotAccount) => a.configured,
      isEnabled: (a: ResolvedPolkadotAccount) => a.enabled,
      resolveAllowFrom: ({ cfg, accountId }: { cfg: unknown; accountId?: string | null }) =>
        resolvePolkadotAccount({ cfg, accountId }).allowFrom,
    },
    // The background long-poll loop that pulls messages from the bot-core bridge.
    gateway: { startAccount: startPolkadotGatewayAccount },
  },

  // Gate who may DM the agent (peer chat-ids in allowFrom); bot-core also enforces
  // its own allowlist, so this is defense-in-depth.
  security: {
    dm: {
      channelKey: POLKADOT_CHANNEL_ID,
      resolvePolicy: (a: ResolvedPolkadotAccount) => a.dmPolicy,
      resolveAllowFrom: (a: ResolvedPolkadotAccount) => a.allowFrom,
      defaultPolicy: "pairing",
      approveHint: "openclaw pairing approve polkadot <code>",
    },
  },

  // Outbound: POST the agent's reply to the bot-core bridge.
  outbound: {
    base: { deliveryMode: "direct" },
    attachedResults: {
      channel: POLKADOT_CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId }: { cfg: unknown; to: string; text: string; accountId?: string | null }) => {
        const account = resolvePolkadotAccount({ cfg, accountId });
        // Attached results can be produced outside the inbound gateway turn,
        // so they have no delivery/lease pair. Only request the deliberately
        // separate proactive capability when an operator configured it.
        const res = await createBridge(
          account.bridgeUrl,
          account.bridgeToken,
          account.bridgeProactiveToken,
        ).send(to, text, { proactive: account.bridgeProactiveToken.length > 0 });
        if (!res.success) throw new Error(`polkadot /send failed for ${to}: ${res.error ?? "unknown"}`);
        const messageId = String(res.message_id ?? Date.now());
        return {
          messageId,
          chatId: to,
          receipt: createMessageReceiptFromOutboundResults({
            results: [{ channel: POLKADOT_CHANNEL_ID, messageId }],
            kind: "text",
          }),
        };
      },
    },
  },
});
