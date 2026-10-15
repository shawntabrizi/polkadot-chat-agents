// SPDX-License-Identifier: GPL-3.0-or-later

import { formatXID, parseXID, derivePersonalDMChannel } from "@t3ams/bcts";

import { startAgentCore, type T3amsAgentOptions } from "../../../transports/t3ams/runtime/agent-core.ts";
import { addAgentToChannel, inviteAgent, setAgentPermissions, setAgentsEnabled } from "@features/agents/messaging/ws-agents.ts";
import type { AgentPermission } from "@features/agents/domain/agent-types.ts";
import { currentRuntime, publicChannelConversationKey } from "@features/channels/messaging/channel-mls.ts";
import { channelSlotHex, sendChannelMessage } from "@features/channels/messaging/send-channel.ts";
import { useChannelsStore } from "@features/channels/store/use-channels-store.ts";
import { inviteDmPeer } from "@features/dms/messaging/dm-handshake.ts";
import { sendDm } from "@features/dms/messaging/send-dm.ts";
import type { ChatMessage } from "@features/messaging/domain/message.ts";
import { useConversationsStore } from "@features/messaging/store/use-conversations-store.ts";
import { createWorkspace } from "@features/workspaces/messaging/ws-lifecycle.ts";
import { useWorkspacesStore } from "@features/workspaces/store/use-workspaces-store.ts";
import { mlsMemberXid } from "@shared/mls/member-map.ts";
import { useSessionStore } from "@shared/store/use-session-store.ts";

export type HumanOptions = Omit<T3amsAgentOptions, "onMention" | "onDirectMessage" | "onWorkspaceInvite">;

export interface ReceivedMessage {
  readonly id: string;
  readonly body: string;
  readonly senderXid: string;
  readonly threadRootId: string | null;
  readonly scheme: string | null;
  readonly reactions: readonly string[];
}

export interface Human {
  readonly xidHex: string;
  publishIdentity(): Promise<string>;
  createWorkspace(name: string): Promise<{ wsId: string; generalId: string }>;
  enableAgents(wsId: string): Promise<void>;
  inviteAgent(wsId: string, username: string, permissions: readonly string[]): Promise<string>;
  addAgentToChannel(wsId: string, agentXid: string, channelId: string): Promise<string>;
  setAgentPermissions(wsId: string, agentXid: string, permissions: readonly string[]): Promise<void>;
  agentSeated(wsId: string, agentXid: string): boolean;
  /** Whether this device's MLS group for the public channel has a leaf bound to `xid`. */
  channelGroupHas(wsId: string, channelId: string, xid: string): Promise<boolean>;
  mention(wsId: string, channelId: string, agentXid: string, body: string): Promise<string>;
  /** New chat → pick the person, as AddDmModal does. */
  startDm(peerXid: string, username: string): Promise<void>;
  dm(peerXid: string, body: string): Promise<void>;
  channelMessages(wsId: string, channelId: string): ReceivedMessage[];
  dmMessages(peerXid: string): ReceivedMessage[];
}

const toReceived = (m: ChatMessage): ReceivedMessage => ({
  id: m.id,
  body: m.body,
  senderXid: m.senderXid,
  threadRootId: m.threadRootId ?? null,
  scheme: m.messageScheme ?? null,
  reactions: (m.reactions ?? []).map((r) => r.emoji),
});

export async function startHumanCore(options: HumanOptions): Promise<Human> {
  const core = await startAgentCore({
    ...options,
    onMention: () => {},
    onDirectMessage: () => {},
    onWorkspaceInvite: () => false,
  });
  const identity = () => {
    const current = useSessionStore.getState().identity;
    if (current == null) throw new Error("no identity");
    return current;
  };
  const channel = (wsId: string, channelId: string) => {
    const entry = useChannelsStore.getState().byWorkspace[wsId]?.find((c) => c.idHex === channelId);
    if (entry == null) throw new Error(`no channel ${channelId}`);
    return entry;
  };
  return {
    xidHex: core.xidHex,
    publishIdentity: () => core.publishIdentity(),
    async createWorkspace(name) {
      const record = await createWorkspace({ identity: identity(), name, senderName: options.displayName });
      const general = useChannelsStore.getState().byWorkspace[record.wsId]?.find((c) => c.name === "general");
      if (general == null) throw new Error("workspace has no #general");
      return { wsId: record.wsId, generalId: general.idHex };
    },
    enableAgents: (wsId) => setAgentsEnabled(wsId, true),
    async inviteAgent(wsId, username, permissions) {
      const { agentXid } = await inviteAgent({
        wsId,
        username,
        ownerXid: core.xidHex,
        permissions: permissions as AgentPermission[],
        channelIds: [],
      });
      return agentXid;
    },
    addAgentToChannel,
    setAgentPermissions: (wsId, agentXid, permissions) => setAgentPermissions(wsId, agentXid, permissions as AgentPermission[]),
    agentSeated: (wsId, agentXid) =>
      useWorkspacesStore.getState().workspaces[wsId]?.doc.members.some((m) => m.xid === agentXid) === true,
    async channelGroupHas(wsId, channelId, xid) {
      const runtime = await currentRuntime();
      if (runtime == null) return false;
      const key = publicChannelConversationKey(wsId, channelId);
      if (!(await runtime.session.exists(key))) return false;
      const clients = await runtime.session.members(key);
      const xids = await Promise.all(clients.map((clientId) => mlsMemberXid(runtime, key, clientId)));
      return xids.includes(xid);
    },
    async mention(wsId, channelId, agentXid, body) {
      const { message } = await sendChannelMessage({
        identity: identity(),
        wsId,
        entry: channel(wsId, channelId),
        senderName: options.displayName,
        body,
        mentions: [agentXid],
      });
      return message.id;
    },
    startDm: (peerXid, username) => inviteDmPeer({ identity: identity(), peerXidHex: peerXid, username }),
    async dm(peerXid, body) {
      await sendDm({ identity: identity(), peerXidHex: peerXid, body });
    },
    channelMessages: (wsId, channelId) =>
      (useConversationsStore.getState().byChannel[channelSlotHex(channel(wsId, channelId))] ?? []).map(toReceived),
    dmMessages: (peerXid) =>
      (useConversationsStore.getState().byChannel[formatXID(derivePersonalDMChannel(identity().xid, parseXID(peerXid)))] ?? [])
        .map(toReceived),
  };
}
