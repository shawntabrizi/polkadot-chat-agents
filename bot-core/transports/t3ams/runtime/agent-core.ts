// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * A T3ams agent in Node: the T3ams app's own messaging stack (MLS DMs and
 * channels, workspace roster, agent rules), run headless.
 *
 * `pca t3ams setup` compiles this file against a T3ams SPA checkout, so the
 * bot speaks exactly the protocol the installed app does: OpenMLS everywhere,
 * statements on the Statement Store, the agent rules of the workspace doc.
 * The boot sequence mirrors the app's `RootLayout` (src/app/router/layouts.tsx)
 * minus the UI-only parts (backups, push watch list, quota warnings).
 *
 * The bot decides what to say; this module decides what it may hear and
 * where its words go. It reports:
 * - a channel message that @mentions the agent, only where the workspace's
 *   agent rules let it read and reply (agents on, listed in the channel, not
 *   paused, posted after it was admitted);
 * - a direct message;
 * - a workspace invite, which the bot accepts or leaves.
 */

import {
  deriveXIDFromAccountId,
  derivePersonalDMChannel,
  formatXID,
  parseXID,
  restoreIdentity,
  setTopicNamespace,
  type Identity,
} from "@t3ams/bcts";
import type { HostLocalStorage } from "@t3ams-real/host";
import type { StatementTransport } from "@parity/product-sdk-statement-store-real";
import type { PolkadotSigner } from "polkadot-api";

import { installAgentHost } from "./agent-host.ts";

import { restartAccountRuntime } from "@features/account-runtime.ts";
import {
  agentAllowedInChannel,
  agentHas,
  agentsEnabled,
  canDmAgent,
  isAgentMember,
} from "@features/agents/domain/agent-rules.ts";
import { prepareChannelSend, channelSlotHex } from "@features/channels/messaging/send-channel.ts";
import { sendChannelReaction, sendChannelTyping } from "@features/channels/messaging/channel-ops.ts";
import { publicChannelMlsBroadcast } from "@features/channels/messaging/public-channel-mls.ts";
import { useChannelsStore } from "@features/channels/store/use-channels-store.ts";
import {
  devicesOf,
  getOwnDeviceRecord,
  isDeviceRevoked,
  isThisDeviceRemoved,
  rememberDeviceRecord,
  rememberRevocation,
  revocationRecordsOf,
} from "@features/devices/directory.ts";
import { startDmRoster } from "@features/dms/messaging/dm-roster.ts";
import { sendDmTyping } from "@features/dms/messaging/dm-typing.ts";
import { prepareDmSend } from "@features/dms/messaging/send-dm.ts";
import { sendGroupControl } from "@features/groups/messaging/group-control.ts";
import { startGroupRoster } from "@features/groups/messaging/group-roster.ts";
import {
  configureMlsKeyPackageIssuer,
  requestMlsKeyPackage,
} from "@features/groups/messaging/mls-key-package-exchange.ts";
import {
  followUpKeyPackageAnswer,
  startMlsDeviceMembership,
} from "@features/groups/messaging/mls-device-membership.ts";
import type { ChatMessage } from "@features/messaging/domain/message.ts";
import { mayApplyMlsCommit } from "@features/messaging/domain/mls-commit-authority.ts";
import { deliveryErrorFor } from "@features/messaging/services/delivery-error.ts";
import { startJoinBackfill } from "@features/messaging/services/join-backfill.ts";
import { startMemberSince } from "@features/messaging/services/member-since.ts";
import { requestActiveMlsResync } from "@features/messaging/services/request-active-mls-resync.ts";
import { useConversationsStore } from "@features/messaging/store/use-conversations-store.ts";
import type { ChannelRegistryEntry } from "@features/workspaces/domain/channel-registry.ts";
import type { WorkspaceStateDoc } from "@features/workspaces/domain/workspace.ts";
import { acceptWorkspaceInvite } from "@features/workspaces/messaging/ws-invite.ts";
import { startWorkspaceRoster } from "@features/workspaces/messaging/ws-roster.ts";
import { useWorkspacesStore } from "@features/workspaces/store/use-workspaces-store.ts";
import { useWsInvitesStore, type IncomingWsInvite } from "@features/workspaces/store/use-ws-invites-store.ts";
import { serveIdentityVerificationManager } from "@shared/identity/identity-verification-manager.ts";
import { createSmartContractIdentityVerificationManager } from "@shared/identity/smart-contract-identity-verification-manager.ts";
import { MLS_CUTOVER_ENABLED } from "@shared/mls/cutover.ts";
import type { MlsDeviceDirectory } from "@shared/mls/device-trust.ts";
import { setMlsResyncRequester } from "@shared/mls/resync-request.ts";
import { startMlsRuntime, stopMlsRuntime } from "@shared/mls/runtime.ts";
import { getAppStorage, setStorageAccountScope } from "@shared/store/admin-kv.ts";
import { useProfileStore } from "@shared/store/use-profile-store.ts";
import { useSessionStore } from "@shared/store/use-session-store.ts";

export type { StatementTransport, HostLocalStorage };

export interface T3amsAgentOptions {
  /** 32-byte T3ams signing and agreement private keys (`t3ams-identity.mjs`). */
  readonly signingPrivateKey: Uint8Array;
  readonly agreementPrivateKey: Uint8Array;
  /** The bot's Polkadot account, SS58. Its id anchors the bot's XID. */
  readonly accountAddress: string;
  /** 32-byte account public key. */
  readonly accountPublicKey: Uint8Array;
  /** Registered DotNS username, e.g. `helper.42`. */
  readonly username: string;
  readonly displayName: string;
  /** First label of the T3ams app host (Settings → Debug → topic context). */
  readonly namespace: string;
  /** Durable key-value store for every piece of app state, MLS keystore included. */
  readonly storage: HostLocalStorage;
  /** Opens a Statement Store connection; called again whenever the app drops a dead one. */
  readonly createStatementTransport: () => StatementTransport;
  /** Signs extrinsics as the bot account (identity attestation on the registry). */
  readonly txSigner: PolkadotSigner;
  /** Deterministic 32-byte entropy for a context, derived from the bot seed. */
  readonly deriveEntropy: (context: Uint8Array) => Promise<Uint8Array>;
  readonly onMention: (event: T3amsMention) => void;
  readonly onDirectMessage: (event: T3amsDirectMessage) => void;
  /** Return true to join the workspace. Agent invites name the owner, channels and permissions. */
  readonly onWorkspaceInvite: (invite: T3amsWorkspaceInvite) => boolean;
  readonly log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface T3amsMention {
  readonly wsId: string;
  readonly workspaceName: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly messageId: string;
  /** The thread a reply belongs in: the mention's thread, or the mention itself. */
  readonly threadRootId: string;
  readonly senderXid: string;
  readonly senderName: string;
  readonly text: string;
  readonly timestamp: number;
  readonly canReply: boolean;
  readonly canReact: boolean;
}

export interface T3amsDirectMessage {
  readonly peerXid: string;
  readonly messageId: string;
  readonly senderName: string;
  readonly text: string;
  readonly timestamp: number;
  /** Seated as an agent in at least one workspace. */
  readonly isWorkspaceAgent: boolean;
  /** An admin turned on Direct messages for this agent in a workspace it shares. */
  readonly workspaceAllowsDm: boolean;
}

export interface T3amsWorkspaceInvite {
  readonly wsId: string;
  readonly workspaceName: string;
  readonly inviterXid: string;
  readonly inviterName: string;
  readonly asAgent: boolean;
  readonly ownerXid: string | null;
  readonly permissions: readonly string[];
}

export interface T3amsAgent {
  readonly xidHex: string;
  /** Reply in a channel thread; refused when the agent rules no longer allow it. */
  replyInThread(wsId: string, channelId: string, threadRootId: string, text: string): Promise<void>;
  replyInDm(peerXid: string, text: string): Promise<void>;
  react(wsId: string, channelId: string, messageId: string, emoji: string): Promise<void>;
  channelTyping(wsId: string, channelId: string): void;
  dmTyping(peerXid: string): void;
  /** Publish the bot's MLS-capable key attestation on the T3ams registry if it is missing or stale. */
  publishIdentity(): Promise<string>;
  stop(): void;
}

const STORAGE_BOUND_ACCOUNT = "session/boundAccount";
const STORAGE_USERNAME = "session/username";

const mlsDevices: MlsDeviceDirectory = {
  devicesOf,
  rememberDeviceRecord,
  isDeviceRevoked,
  rememberRevocation: async (record) => (await rememberRevocation(record)) != null,
  revocationRecordsOf,
};

class AgentRefusedError extends Error {}

function workspaceDoc(wsId: string): WorkspaceStateDoc | null {
  return useWorkspacesStore.getState().workspaces[wsId]?.doc ?? null;
}

function channelEntry(wsId: string, channelId: string): ChannelRegistryEntry {
  const entry = useChannelsStore.getState().byWorkspace[wsId]?.find((c) => c.idHex === channelId);
  if (entry == null) throw new AgentRefusedError(`unknown channel ${channelId} in workspace ${wsId}`);
  return entry;
}

/** When the agent last regained `channelId` (resumed, or added to it). It
 *  catches up on what was posted before, but must not answer it — the same
 *  rule the app's demo agent follows. */
function channelAccessSince(doc: WorkspaceStateDoc | null, selfXid: string, channelId: string): number {
  let since = 0;
  for (const entry of doc?.agentLog ?? []) {
    if (entry.agentXid !== selfXid || entry.at <= since) continue;
    if (entry.action === "resumed" || (entry.action === "joinedChannel" && entry.channelId === channelId)) {
      since = entry.at;
    }
  }
  return since;
}

function senderNameIn(docs: readonly (WorkspaceStateDoc | null)[], message: ChatMessage): string {
  const own = message.senderName?.trim();
  if (own) return own;
  for (const doc of docs) {
    const name = doc?.members.find((member) => member.xid === message.senderXid)?.name.trim();
    if (name) return name;
  }
  return "";
}

export async function startAgentCore(options: T3amsAgentOptions): Promise<T3amsAgent> {
  const log = options.log ?? (() => {});
  installAgentHost({
    deriveEntropy: options.deriveEntropy,
    storage: options.storage,
    createStatementTransport: options.createStatementTransport,
    signRootBytes: (payload) => options.txSigner.signBytes(payload),
  });
  setTopicNamespace(options.namespace);
  const manager = createSmartContractIdentityVerificationManager();
  if (manager != null) serveIdentityVerificationManager(manager);

  const identity: Identity = restoreIdentity(options.signingPrivateKey, options.agreementPrivateKey);
  identity.xid = deriveXIDFromAccountId(options.accountPublicKey);
  const selfXid = formatXID(identity.xid);
  const accountAddress = options.accountAddress;

  // The app's session, as `createSession` leaves it for a standalone account
  // that is also its own username owner.
  await getAppStorage().set(STORAGE_BOUND_ACCOUNT, accountAddress);
  await getAppStorage().set(STORAGE_USERNAME, options.username);
  setStorageAccountScope(accountAddress);
  useSessionStore.setState({
    status: "ready",
    identity,
    adapter: {
      mode: "sdk",
      getPublicKey: () => options.accountPublicKey,
      signRaw: (data) => options.txSigner.signBytes(data),
      deriveEncryptionMaterial: () => options.deriveEntropy(new TextEncoder().encode("t3ams:encryption:v1")),
      getAccountAddress: () => accountAddress,
      getAccountInfo: async () => ({ identifierKey: null, liteUsername: options.username }),
      isReady: () => true,
    },
    txSigner: options.txSigner,
    xidHex: selfXid,
    accountAddress,
    username: options.username,
    accountConflict: null,
    identityRecoverable: true,
  });

  const results = await restartAccountRuntime(selfXid);
  for (const result of results ?? []) {
    if (result.status === "rejected") log("T3AMS_STORE_INIT_FAILED", { reason: String(result.reason) });
  }
  if (useProfileStore.getState().displayName.trim() === "") {
    useProfileStore.setState({ displayName: options.displayName });
  }

  setMlsResyncRequester(requestActiveMlsResync);
  configureMlsKeyPackageIssuer(null);
  if (!MLS_CUTOVER_ENABLED) throw new Error("This T3ams build has MLS turned off (VITE_MLS_CUTOVER_ENABLED=false).");
  const runtime = await startMlsRuntime({
    accountAddress,
    identity,
    authorizeCommit: (conversation, senderXidHex) => mayApplyMlsCommit(conversation, selfXid, senderXidHex),
    rotationIntervalMs: useProfileStore.getState().mlsRotationIntervalMs,
    requestKeyPackage: (peerXidHex, conversation, signal) =>
      requestMlsKeyPackage(identity, peerXidHex, conversation, signal),
    devices: mlsDevices,
    onCommitDeliveryFailure: () => log("T3AMS_MLS_COMMIT_DELIVERY_FAILED"),
    broadcast: publicChannelMlsBroadcast(identity),
    deliverToPeer: (peerXidHex, payload) =>
      sendGroupControl({
        identity,
        peerXidHex,
        event: { kind: "mls-control", groupId: payload.conversation, payload },
      }),
  });
  configureMlsKeyPackageIssuer(
    async (requesterXidHex, requestId, conversation) => {
      if (await isThisDeviceRemoved()) return null;
      const keyPackage = await runtime.keyPackages.issueFor(requesterXidHex, requestId, conversation);
      if (keyPackage == null) return null;
      const deviceCert = await getOwnDeviceRecord().catch(() => null);
      const revocations = await revocationRecordsOf(selfXid).catch(() => []);
      if (deviceCert != null) followUpKeyPackageAnswer(conversation);
      const held = await runtime.session.exists(conversation);
      return {
        clientId: runtime.session.clientId,
        keyPackage,
        ...(deviceCert == null ? {} : { deviceCert }),
        ...(revocations.length === 0 ? {} : { revocations }),
        ...(held ? { held } : {}),
      };
    },
    { devices: mlsDevices, selfXidHex: selfXid, selfClientId: runtime.session.clientId },
  );
  log("T3AMS_MLS_READY", { xid: selfXid, clientId: runtime.session.clientId });

  const stops: (() => void)[] = [];
  for (const roster of [startDmRoster(identity), startWorkspaceRoster(identity), startGroupRoster(identity)]) {
    stops.push(() => roster.stop());
  }
  stops.push(startMlsDeviceMembership(identity), startJoinBackfill(identity), startMemberSince(identity));

  const since = Date.now();
  const seen = new Set<string>();
  const dmChannelOf = (peerXid: string): string => formatXID(derivePersonalDMChannel(identity.xid, parseXID(peerXid)));
  const channelOfSlot = (slotHex: string): { wsId: string; entry: ChannelRegistryEntry } | null => {
    for (const [wsId, entries] of Object.entries(useChannelsStore.getState().byWorkspace)) {
      const entry = entries.find((candidate) => channelSlotHex(candidate) === slotHex);
      if (entry != null) return { wsId, entry };
    }
    return null;
  };
  const allDocs = (): WorkspaceStateDoc[] =>
    Object.values(useWorkspacesStore.getState().workspaces).map((record) => record.doc);

  const onChannelMessage = (wsId: string, entry: ChannelRegistryEntry, message: ChatMessage): void => {
    if (message.mentions?.includes(selfXid) !== true) return;
    const doc = workspaceDoc(wsId);
    if (!agentsEnabled(doc) || !agentAllowedInChannel(doc, selfXid, entry.idHex)) return;
    if (message.timestamp < channelAccessSince(doc, selfXid, entry.idHex)) return;
    options.onMention({
      wsId,
      workspaceName: doc?.name ?? "",
      channelId: entry.idHex,
      channelName: entry.name,
      messageId: message.id,
      threadRootId: message.threadRootId ?? message.id,
      senderXid: message.senderXid,
      senderName: senderNameIn([doc], message),
      text: message.body,
      timestamp: message.timestamp,
      canReply: agentHas(doc, selfXid, "replyWhenMentioned"),
      canReact: agentHas(doc, selfXid, "react"),
    });
  };

  const onConversations = (
    byChannel: Readonly<Record<string, readonly ChatMessage[]>>,
    previous: Readonly<Record<string, readonly ChatMessage[]>> | null,
  ): void => {
    for (const [slotHex, messages] of Object.entries(byChannel)) {
      if (previous?.[slotHex] === messages) continue;
      for (const message of messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        if (message.mine || message.system === true || message.deletedAt != null) continue;
        if (message.undecryptable === true || message.timestamp < since) continue;
        const channel = channelOfSlot(slotHex);
        if (channel != null) {
          onChannelMessage(channel.wsId, channel.entry, message);
        } else if (dmChannelOf(message.senderXid) === slotHex) {
          const docs = allDocs();
          options.onDirectMessage({
            peerXid: message.senderXid,
            messageId: message.id,
            senderName: senderNameIn(docs, message),
            text: message.body,
            timestamp: message.timestamp,
            isWorkspaceAgent: docs.some((doc) => doc.members.some((m) => m.xid === selfXid && isAgentMember(m))),
            workspaceAllowsDm: canDmAgent(docs, selfXid),
          });
        }
      }
    }
  };

  const invitesHandled = new Set<string>();
  const onInvites = (incoming: readonly IncomingWsInvite[]): void => {
    for (const invite of incoming) {
      const key = `${invite.wsId}/${invite.inviterXidHex}/${invite.timestamp}`;
      if (invitesHandled.has(key)) continue;
      invitesHandled.add(key);
      const accept = options.onWorkspaceInvite({
        wsId: invite.wsId,
        workspaceName: invite.name,
        inviterXid: invite.inviterXidHex,
        inviterName: invite.inviterName,
        asAgent: invite.role === "agent",
        ownerXid: invite.agent?.ownerXid ?? null,
        permissions: invite.agent?.permissions ?? [],
      });
      if (!accept) continue;
      acceptWorkspaceInvite({ identity, invite, senderName: options.displayName }).then(
        () => log("T3AMS_WORKSPACE_JOINED", { wsId: invite.wsId, asAgent: invite.role === "agent" }),
        (error: unknown) => {
          log("T3AMS_WORKSPACE_ACCEPT_FAILED", { wsId: invite.wsId, error: deliveryErrorFor(error) });
          // The inviter may not be reachable yet: try again on the next store change.
          invitesHandled.delete(key);
        },
      );
    }
  };

  stops.push(
    useConversationsStore.subscribe((state, prev) => {
      if (state.byChannel !== prev.byChannel) onConversations(state.byChannel, prev.byChannel);
    }),
    useWsInvitesStore.subscribe((state, prev) => {
      if (state.incoming !== prev.incoming) onInvites(state.incoming);
    }),
  );
  onConversations(useConversationsStore.getState().byChannel, null);
  onInvites(useWsInvitesStore.getState().incoming);

  const submitTracked = async (prepared: {
    readonly channelHex: string;
    readonly message: ChatMessage;
    submit(): Promise<unknown>;
  }): Promise<void> => {
    const store = useConversationsStore.getState();
    store.addMessage(prepared.channelHex, prepared.message);
    try {
      await prepared.submit();
    } catch (error) {
      store.updateDeliveryStatus(prepared.channelHex, prepared.message.id, "failed", deliveryErrorFor(error));
      throw error;
    }
    store.updateDeliveryStatus(prepared.channelHex, prepared.message.id, "sent");
  };

  return {
    xidHex: selfXid,
    async replyInThread(wsId, channelId, threadRootId, text) {
      const doc = workspaceDoc(wsId);
      if (!agentAllowedInChannel(doc, selfXid, channelId) || !agentHas(doc, selfXid, "replyWhenMentioned")) {
        throw new AgentRefusedError("the workspace's agent rules do not allow a reply in this channel now");
      }
      const entry = channelEntry(wsId, channelId);
      await submitTracked(
        await prepareChannelSend({
          identity,
          wsId,
          entry,
          senderName: useProfileStore.getState().displayName || options.displayName,
          body: text,
          threadRootId,
        }),
      );
    },
    async replyInDm(peerXid, text) {
      await submitTracked(
        await prepareDmSend({
          identity,
          peerXidHex: peerXid,
          body: text,
          onPending: (channelHex, message) => useConversationsStore.getState().addMessage(channelHex, message),
        }),
      );
    },
    async react(wsId, channelId, messageId, emoji) {
      if (!agentHas(workspaceDoc(wsId), selfXid, "react")) {
        throw new AgentRefusedError("this agent may not react in that workspace");
      }
      const entry = channelEntry(wsId, channelId);
      const timestamp = Date.now();
      await sendChannelReaction({ identity, wsId, entry, messageIdHex: messageId, emoji, op: "add", timestamp });
      useConversationsStore.getState().applyReaction(channelSlotHex(entry), {
        op: "add",
        messageId,
        emoji,
        timestamp,
        senderXid: selfXid,
      });
    },
    channelTyping(wsId, channelId) {
      sendChannelTyping({ identity, wsId, entry: channelEntry(wsId, channelId) });
    },
    dmTyping(peerXid) {
      sendDmTyping({ identity, peerXidHex: peerXid });
    },
    async publishIdentity() {
      const result = await useSessionStore.getState().publishIdentityBinding();
      return "reason" in result ? `${result.status}:${result.reason}` : result.status;
    },
    stop() {
      for (const stop of stops.splice(0)) stop();
      setMlsResyncRequester(null);
      configureMlsKeyPackageIssuer(null);
      stopMlsRuntime(accountAddress);
    },
  };
}
