// S2 answer 2: an empty BOT_ACK_TEXT means "send the accept alone", not
// "send an empty welcome". The echo brain's default is empty: the identity
// session statement must carry exactly [deviceChatAccepted] and the persona
// must see only the contactAdded row after the accept. A bot with a welcome
// text sends [deviceChatAccepted, text] and the persona sees the welcome.
// Spec 0008: a botInfo (kind 244) follows in the same statement; the
// sandbox's SDK does not know that kind, so its wire view says undecodable.
import assert from "node:assert/strict";

export const description = "an empty BOT_ACK_TEXT sends the accept alone; a welcome text rides next to it";

const kinds = (slot) => slot.decoded.messages.map((m) => (m.undecodable ? "undecodable (botInfo)" : m.content.type));

export async function run({ openChat, log }) {
  // Default (empty): the accept alone.
  const bare = await openChat({ user: "alice", name: "echobot" });
  const aliceRows = (await bare.inbox()).messages;
  assert.ok(aliceRows.some((m) => m.direction === "system" && m.content.type === "contactAdded"), "the accept shows as contactAdded");
  const strays = aliceRows.filter((m) => m.direction === "incoming" && m.content.type === "text" && !m.content.text.startsWith("Echo:"));
  assert.deepEqual(strays, [], "no welcome row, empty or otherwise");
  const accept = await bare.slot("identity echobot→alice /request");
  assert.deepEqual(kinds(accept), ["deviceChatAccepted", "undecodable (botInfo)"], "the identity statement carries the accept and the botInfo, no welcome");
  assert.equal(accept.decoded.messages[0].content.requestId, bare.request.requestId);
  assert.ok(accept.acks.some((a) => a.by === "alice#1" && a.code === "success"));
  log("echobot (BOT_ACK_TEXT empty): [deviceChatAccepted, botInfo], no welcome row");

  // A welcome text: next to the accept, once.
  const greeter = await openChat({ user: "bob", name: "greeter", env: { BOT_ACK_TEXT: "Welcome aboard" } });
  const welcome = (await greeter.inbox()).messages.filter((m) => m.direction === "incoming" && m.content.type === "text" && m.content.text === "Welcome aboard");
  assert.equal(welcome.length, 1, "the welcome shows once");
  const withWelcome = await greeter.slot("identity greeter→bob /request");
  assert.deepEqual(kinds(withWelcome), ["deviceChatAccepted", "text", "undecodable (botInfo)"], "accept, welcome and botInfo ride one identity statement");
  assert.equal(withWelcome.decoded.messages[1].content.text, "Welcome aboard");
  log('greeter (BOT_ACK_TEXT "Welcome aboard"): [deviceChatAccepted, text, botInfo]');
}
