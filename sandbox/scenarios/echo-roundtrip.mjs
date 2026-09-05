// alice (two devices) opens a chat with an echo bot created and started
// through pca (--network sandbox). She sends a follow-up from her second
// device, reacts, quotes a bot reply, and edits her message. Every bot answer
// must land on BOTH of her devices with an ACK from each, every request of
// hers must be ACKed by the bot, and the wire must show the bot's statements
// on the right per-device channels.
//
// One ordering fact is inherent to the protocol and asserted as such: the
// answer to the opener reaches device 1 only. The bot learns alice#1 from
// the request itself and answers at once; it learns alice#2 from her
// `deviceAdded` fan-out, which she sends after his accept. A phone's sibling
// devices have the same gap. Everything after the fan-out reaches both.
import assert from "node:assert/strict";

export const description = "alice (2 devices) ↔ echo bot: opener, device-2 follow-up, reaction, reply, edit";

export async function run({ sandbox, pcs, bot, log }) {
  await pcs("user", "add", "alice", "--devices", "2");

  // The bot is created and registered through pca, non-interactively.
  const cfg = await bot.create("echobot", ["--brain", "echo", "--public"]);
  assert.equal(cfg.networkProfile, "sandbox");
  assert.deepEqual([cfg.username, cfg.registered], ["echobot", true]);
  assert.equal((await sandbox.get(`/consumers/${cfg.account}`)).identifierKey, cfg.identifierKey, "pca registered the bot's identifier key");
  const echo = await bot.start("echobot");
  await echo.waitFor((e) => e.event === "BOT_SUBSCRIBED", { label: "BOT_SUBSCRIBED" });
  assert.match((await bot.pca("status", "echobot")).stdout, /is running locally/);
  assert.match((await bot.pca("info", "echobot")).stdout, /live — people can message it/);

  const inbox = async () => (await pcs("inbox", "alice", "--peer", "echobot"))[0];
  const answers = (view) => view.messages.filter((m) => m.direction === "incoming" && m.content.text?.startsWith("Echo:"));
  const onBothDevices = (text) => sandbox.waitFor(async () => {
    const m = answers(await inbox()).find((x) => x.content.text === text);
    return m && [1, 2].every((d) => m.receivedBy.includes(d) && m.ackedBy.includes(d)) ? m : null;
  }, { label: `"${text}" on both alice devices with ACKs` });
  const delivered = (messageId) => sandbox.waitFor(async () => (await inbox()).messages.find((m) => m.messageId === messageId)?.status === "delivered", { label: `bot ACK for ${messageId}` });

  // Opener → accept on the identity session → the echo.
  const request = await pcs("request", "alice", "echobot", "--welcome", "hello bot");
  await echo.waitFor((e) => e.event === "BOT_RECEIVED_OPENER", { label: "BOT_RECEIVED_OPENER" });
  await sandbox.waitFor(async () => (await pcs("requests", "alice")).find((r) => r.requestId === request.requestId)?.status === "accepted", { label: "alice sees the accept" });
  const first = await sandbox.waitFor(async () => answers(await inbox()).find((m) => m.content.text === "Echo: hello bot" && m.ackedBy.includes(1)), { label: "echo of the opener on device 1" });
  log(`opener answered on device(s) ${first.receivedBy.join(",")} (before the fan-out the bot knows device 1 only)`);
  // alice#1 fans out both her devices; the bot folds them into its roster.
  await sandbox.waitFor(() => echo.events.filter((e) => e.event === "BOT_PEER_DEVICE_ADDED").length >= 2, { label: "the bot learned both alice devices" });
  const contact = (await sandbox.get("/personas/alice")).contacts.find((c) => c.username === "echobot");
  assert.equal(contact.devices.length, 1, "alice learned the bot's one device from deviceChatAccepted");
  assert.equal(contact.devices[0].statementAccountId, cfg.account, "bot-core signs with its identity account");

  // Follow-up from device 2: it rides alice#2's device session, which the bot must poll too.
  const fromTwo = await pcs("send", "alice", "echobot", "from my second device", "--device", "2");
  assert.equal(fromTwo.device, 2);
  await echo.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.chars === "from my second device".length, { label: "device-2 follow-up received" });
  const echoTwo = await onBothDevices("Echo: from my second device");
  await delivered(fromTwo.messageId);

  // Reaction: recorded by the bot, never answered.
  await pcs("react", "alice", "echobot", echoTwo.messageId, "👍");
  const reaction = await echo.waitFor((e) => e.event === "BOT_RECEIVED_REACTION", { label: "BOT_RECEIVED_REACTION" });
  assert.deepEqual([reaction.emoji, reaction.target], ["👍", echoTwo.messageId]);

  // Reply quoting the bot, then an edit from device 2: each is answered once more.
  const quote = await pcs("send", "alice", "echobot", "quoting you", "--reply", echoTwo.messageId);
  const replyEvent = await echo.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.kind === "reply", { label: "reply-kind message" });
  assert.equal(replyEvent.chars, "quoting you".length);
  await onBothDevices("Echo: quoting you");
  await delivered(quote.messageId);
  await pcs("edit", "alice", "echobot", fromTwo.messageId, "from my second device (edited)", "--device", "2");
  await echo.waitFor((e) => e.event === "BOT_RECEIVED_TEXT" && e.kind === "edited", { label: "edited-kind message" });
  await onBothDevices("Echo: from my second device (edited)");

  // Exactly one answer per message and none for the reaction; every alice request ACKed.
  const view = await inbox();
  assert.deepEqual(answers(view).map((m) => m.content.text).sort(), [
    "Echo: from my second device", "Echo: from my second device (edited)", "Echo: hello bot", "Echo: quoting you",
  ]);
  assert.equal(echo.events.filter((e) => e.event === "BOT_SENT_TEXT").length, 4, "four answers, no reply to the reaction");
  for (const m of view.messages.filter((x) => x.direction === "outgoing")) assert.equal(m.status, "delivered", `alice's ${m.content.type} ${m.messageId} was not ACKed`);
  assert.equal(view.messages.filter((m) => m.direction === "incoming" && m.content.type === "text" && !m.content.text.startsWith("Echo:")).length, 1, "the bot's (empty) welcome rode the identity session once");

  // The wire: the bot's statements on the labelled per-device channels, every signer named.
  const wire = await pcs("wire", "--peer", "alice");
  const has = (signer, channel) => wire.some((s) => s.signerLabel === signer && s.channelLabel === channel);
  assert.ok(has("echobot", "identity echobot→alice /request"), "the accept on the identity session");
  assert.ok(has("echobot", "session echobot#1→alice /request"), "answers on the bot's device session");
  assert.ok(has("echobot", "session echobot#1→alice /response"), "the bot's ACKs on its response channel");
  assert.ok(has("alice#1", "session alice#1→echobot /request") && has("alice#2", "session alice#2→echobot /request"), "alice's follow-ups on her per-device sessions");
  assert.ok(has("alice#1", "session echobot#1→alice /response") === false, "only the bot signs on its own response channel");
  assert.ok(wire.every((s) => s.signerLabel != null), `unlabelled signer on the wire: ${JSON.stringify(wire.filter((s) => s.signerLabel == null))}`);
  log(`wire: ${wire.length} statements, ${wire.filter((s) => s.signerLabel === "echobot").length} signed by the bot`);

  await echo.stop("SIGTERM");
}
