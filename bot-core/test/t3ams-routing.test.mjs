import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_T3AMS_TEXT_BYTES,
  commandTextAfterLeadingBotMention,
  conversationKeyFor,
  isExplicitBotMention,
  normalizeT3amsInbound,
  replyTargetFor,
  restoreT3amsIngressRoute,
  toT3amsBridgeInbound,
} from "../lib/t3ams-routing.mjs";

const bot = { xid: "bot-xid-42", aliases: ["Atlas", "atlas-helper"] };

test("conversation keys are stable, escaped, and scoped to a DM or channel", () => {
  assert.equal(conversationKeyFor({ conversationType: "dm", senderXid: "alice" }), "t3ams:dm:alice");
  assert.equal(
    conversationKeyFor({ conversationType: "channel", workspaceId: "team/blue", channelId: "general:chat", senderXid: "alice" }),
    "t3ams:channel:team%2Fblue:general%3Achat",
  );
  // Channel turns share a brain session regardless of who sent them or which
  // thread contained the prompt; separate channels never share one.
  assert.equal(
    conversationKeyFor({ conversationType: "channel", workspaceId: "team", channelId: "general", senderXid: "alice", threadRootId: "root-1" }),
    conversationKeyFor({ conversationType: "group", workspaceId: "team", channelId: "general", senderXid: "bob", threadRootId: "root-2" }),
  );
  assert.notEqual(
    conversationKeyFor({ conversationType: "channel", workspaceId: "team", channelId: "general" }),
    conversationKeyFor({ conversationType: "channel", workspaceId: "team", channelId: "random" }),
  );
});

test("conversation keys reject incomplete or hostile IDs", () => {
  assert.equal(conversationKeyFor({ conversationType: "dm" }), null);
  assert.equal(conversationKeyFor({ conversationType: "channel", workspaceId: "ws" }), null);
  assert.equal(conversationKeyFor({ conversationType: "dm", senderXid: " alice" }), null);
  assert.equal(conversationKeyFor({ conversationType: "dm", senderXid: `a\u0000b` }), null);
  assert.equal(conversationKeyFor({ conversationType: "dm", senderXid: "x".repeat(513) }), null);
});

test("mention detection accepts verified structured mentions and bounded text tokens", () => {
  assert.equal(isExplicitBotMention({ text: "no visible tag", mentions: [{ xid: "bot-xid-42" }] }, bot), true);
  assert.equal(isExplicitBotMention({ text: "(@ATLAS), can you help?" }, bot), true);
  assert.equal(isExplicitBotMention({ text: "@atlas-helper please review this" }, bot), true);
  assert.equal(isExplicitBotMention({ text: "someone@atlas.example" }, bot), false);
  assert.equal(isExplicitBotMention({ text: "@atlas-helperish" }, bot), false);
  assert.equal(isExplicitBotMention({ text: "@other-bot" }, bot), false);
});

test("a leading self mention exposes a slash-command candidate without rewriting normal prompts", () => {
  const names = { xid: "bot-xid-42", aliases: ["dotbot", "dotbot.41"] };
  assert.equal(commandTextAfterLeadingBotMention("@dotbot /help", names), "/help");
  assert.equal(commandTextAfterLeadingBotMention("@dotbot, /model opus", names), "/model opus");
  assert.equal(commandTextAfterLeadingBotMention(" @dotbot.41: /ping", names), "/ping");
  assert.equal(commandTextAfterLeadingBotMention("please @dotbot /help", names), null);
  assert.equal(commandTextAfterLeadingBotMention("@dotbot-helper /help", names), null);
  assert.equal(commandTextAfterLeadingBotMention("@dotbot summarize this", names), null);
});

test("a restored durable channel command retains its command candidate", () => {
  const workspaceId = "a1".repeat(32);
  const channelId = "b2".repeat(32);
  const senderXid = "c3".repeat(32);
  const messageId = "d4".repeat(32);
  const restored = restoreT3amsIngressRoute({
    accepted: true,
    conversationKey: `t3ams:channel:${workspaceId}:${channelId}`,
    message: {
      kind: "text",
      messageId,
      text: "@dotbot /help",
      commandText: "/help",
      conversationType: "channel",
      workspaceId,
      channelId,
      threadRootId: null,
      senderXid,
      senderName: "Alice",
    },
  });
  assert.equal(restored?.message.commandText, "/help");

  const invalidCommand = restoreT3amsIngressRoute({
    accepted: true,
    conversationKey: `t3ams:channel:${workspaceId}:${channelId}`,
    message: {
      kind: "text",
      messageId,
      text: "@dotbot /help",
      commandText: "help",
      conversationType: "channel",
      workspaceId,
      channelId,
      threadRootId: null,
      senderXid,
      senderName: "Alice",
    },
  });
  assert.equal(invalidCommand?.message.commandText, undefined);
});

test("reply target preserves a thread root and always addresses the triggering message", () => {
  assert.deepEqual(replyTargetFor({ messageId: "m-1" }), { replyToMessageId: "m-1", threadRootId: null });
  assert.deepEqual(
    replyTargetFor({ message_id: "m-2", thread_root_id: "root-1" }),
    { replyToMessageId: "m-2", threadRootId: "root-1" },
  );
  assert.equal(replyTargetFor({ messageId: "\n" }), null);
});

test("DMs reach the brain without a mention and retain transport-neutral context", () => {
  const routed = normalizeT3amsInbound({
    conversationType: "direct",
    sender: { xid: "alice-xid", name: "Alice" },
    messageId: "dm-1",
    text: "hello bot",
  }, bot);
  assert.equal(routed.accepted, true);
  assert.equal(routed.conversationKey, "t3ams:dm:alice-xid");
  assert.deepEqual(routed.replyTarget, { replyToMessageId: "dm-1", threadRootId: null });
  assert.deepEqual(routed.message, {
    kind: "text",
    messageId: "dm-1",
    text: "hello bot",
    conversationType: "dm",
    workspaceId: null,
    channelId: null,
    threadRootId: null,
    senderXid: "alice-xid",
    senderName: "Alice",
  });
});

test("channel traffic invokes a bot only on mention, and preserves thread routing", () => {
  const base = {
    conversationType: "channel",
    workspaceId: "w-1",
    channelId: "c-2",
    senderXid: "alice-xid",
    senderName: "Alice",
    messageId: "m-3",
    threadRootId: "thread-1",
  };
  assert.deepEqual(normalizeT3amsInbound({ ...base, text: "a useful observation" }, bot), {
    accepted: false,
    reason: "unmentioned-channel-message",
  });

  const routed = normalizeT3amsInbound({ ...base, text: "@Atlas, please summarize" }, bot);
  assert.equal(routed.accepted, true);
  assert.equal(routed.conversationKey, "t3ams:channel:w-1:c-2");
  assert.deepEqual(routed.replyTarget, { replyToMessageId: "m-3", threadRootId: "thread-1" });
  assert.deepEqual(toT3amsBridgeInbound(routed), {
    chat_id: "t3ams:channel:w-1:c-2",
    kind: "text",
    message_id: "m-3",
    text: "@Atlas, please summarize",
    conversation_type: "channel",
    sender_xid: "alice-xid",
    sender_name: "Alice",
    workspace_id: "w-1",
    channel_id: "c-2",
    thread_root_id: "thread-1",
  });

  const command = normalizeT3amsInbound({ ...base, text: "@Atlas /help" }, bot);
  assert.equal(command.message.text, "@Atlas /help", "the raw prompt remains available to a model");
  assert.equal(command.message.commandText, "/help");
});

test("routing rejects self messages, unsupported content, invalid events, and oversized text", () => {
  const base = { conversationType: "dm", senderXid: "alice", messageId: "m", text: "hi" };
  assert.deepEqual(normalizeT3amsInbound({ ...base, senderXid: "bot-xid-42" }, bot), { accepted: false, reason: "self-message" });
  assert.deepEqual(normalizeT3amsInbound({ ...base, kind: "file" }, bot), { accepted: false, reason: "unsupported-content" });
  assert.deepEqual(normalizeT3amsInbound({ ...base, messageId: "" }, bot), { accepted: false, reason: "invalid-message" });
  assert.deepEqual(
    normalizeT3amsInbound({ ...base, text: "x".repeat(MAX_T3AMS_TEXT_BYTES + 1) }, bot),
    { accepted: false, reason: "invalid-text" },
  );
});

test("operators can require rich-text mention metadata instead of matching source text", () => {
  const event = {
    conversationType: "channel", workspaceId: "w", channelId: "c", senderXid: "alice", messageId: "m", text: "@Atlas help",
  };
  assert.equal(normalizeT3amsInbound(event, bot, { allowTextMentions: false }).accepted, false);
  assert.equal(normalizeT3amsInbound({ ...event, mentions: [{ xid: bot.xid }] }, bot, { allowTextMentions: false }).accepted, true);
});

test("a bounded channel-context snapshot survives the private journal and reaches a bridge without attachment capabilities", () => {
  const ws = "a1".repeat(32);
  const channel = "b2".repeat(32);
  const sender = "c3".repeat(32);
  const priorSender = "d4".repeat(32);
  const messageId = "e5".repeat(32);
  const priorId = "f6".repeat(32);
  const routed = normalizeT3amsInbound({
    conversationType: "channel",
    workspaceId: ws,
    channelId: channel,
    senderXid: sender,
    senderName: "Alice",
    messageId,
    text: "@Atlas summarize this thread",
    channelContext: [{
      messageId: priorId,
      senderXid: priorSender,
      senderName: "Bob",
      text: "Earlier authenticated note",
      threadRootId: null,
      // Attempted capability-shaped fields must not survive the context codec.
      claimTicketHex: "never-routed",
    }],
  }, bot);
  assert.equal(routed.accepted, true);
  assert.deepEqual(routed.message.channelContext, [{
    messageId: priorId,
    senderXid: priorSender,
    senderName: "Bob",
    text: "Earlier authenticated note",
    threadRootId: null,
  }]);
  const bridge = toT3amsBridgeInbound(routed);
  assert.deepEqual(bridge.channel_context, [{
    message_id: priorId,
    sender_xid: priorSender,
    sender_name: "Bob",
    text: "Earlier authenticated note",
  }]);
  const restored = restoreT3amsIngressRoute(routed);
  assert.deepEqual(restored?.message.channelContext, routed.message.channelContext);

  const invalid = normalizeT3amsInbound({
    conversationType: "channel",
    workspaceId: ws,
    channelId: channel,
    senderXid: sender,
    messageId,
    text: "@Atlas bad context",
    channelContext: [{ messageId: "not-an-xid", senderXid: priorSender, text: "nope" }],
  }, bot);
  assert.deepEqual(invalid, { accepted: false, reason: "invalid-channel-context" });
});
