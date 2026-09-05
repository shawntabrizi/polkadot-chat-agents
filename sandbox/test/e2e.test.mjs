// End to end over the real path: the daemon on random ports, personas
// talking to the store node over WebSocket through the SDK, driven through
// the HTTP API only (the CLI has its own smoke test). This is the S1
// acceptance in PLAN.md as a test: alice (1 device) opens a chat with bob
// (2 devices), bob accepts, text flows both ways and reaches every device,
// reactions and edits round-trip, and the wire shows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDaemon } from "../daemon.mjs";
import { waitFor } from "./helpers.mjs";

const call = async (url, method, route, body) => {
  const res = await fetch(url + route, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${json.error}`);
  return json;
};

test("alice (1 device) and bob (2 devices): request, accept, text, reply from device 2, reaction, edit", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-e2e-"));
  const daemon = await startDaemon({ dir, port: 0 });
  t.after(async () => { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const api = daemon.url;
  const get = (route) => call(api, "GET", route);
  const post = (route, body) => call(api, "POST", route, body);

  assert.equal((fs.statSync(dir).mode & 0o777), 0o700, "state dir is private");
  const node = await get("/node");
  assert.equal(node.url, daemon.storeUrl);

  // Mint and register.
  const alice = await post("/personas", { name: "alice", devices: 1 });
  const bob = await post("/personas", { name: "bob", devices: 2 });
  assert.equal(bob.devices.length, 2);
  assert.ok(!("seed" in alice) && !("identity" in alice), "the API never returns key material");
  const consumer = await get(`/consumers/${bob.account}`);
  assert.equal(consumer.identifierKey.length, 2 + 65 * 2, "what bot-core reads: the 65-byte container");
  assert.equal(consumer.identifierKey.slice(0, 4), "0x00");
  const accounts = await get("/accounts");
  assert.equal(accounts.filter((a) => a.allowance).length, 5, "identity + device accounts have allowances");
  await assert.rejects(post("/personas", { name: "alice", devices: 1 }), /exists/);
  // The directory reads bot-core makes, and the registration a bot makes.
  assert.deepEqual(await get("/usernames/bob"), { username: "bob", ...consumer });
  await assert.rejects(get("/usernames/nobody"), /404/);
  await assert.rejects(get(`/consumers/0x${"33".repeat(32)}`), /404/);
  const botKey = `0x00${"44".repeat(32)}${"00".repeat(32)}`;
  const registered = await post("/accounts/register", { account: `0x${"55".repeat(32)}`, username: "echobot", identifierKey: botKey });
  assert.deepEqual(registered, { account: `0x${"55".repeat(32)}`, username: "echobot", identifierKey: botKey });
  assert.equal((await get(`/consumers/0x${"55".repeat(32)}`)).identifierKey, botKey, "a registered bot is messageable");
  assert.equal((await get("/accounts")).find((a) => a.username === "echobot").allowance, true, "and may submit statements");
  await assert.rejects(post("/accounts/register", { account: `0x${"66".repeat(32)}`, username: "echobot", identifierKey: botKey }), /409/);
  await assert.rejects(post("/accounts/register", { account: `0x${"66".repeat(32)}`, username: "x" }), /400/);

  // alice requests bob; every bob device sees it once.
  const { requestId } = await post("/personas/alice/requests", { to: "bob", welcome: "hi bob" });
  const pending = await waitFor(async () => (await get("/personas/bob/requests?status=pending")).find((r) => r.requestId === requestId));
  assert.deepEqual([pending.direction, pending.peerUsername, pending.welcomeMessage], ["incoming", "alice", "hi bob"]);
  assert.equal((await get("/personas/bob/requests")).length, 1, "two devices, one request row");
  assert.equal((await get("/personas/alice/requests"))[0].status, "pending");

  // bob accepts on device 1; alice learns bob's device 1 from the accept and device 2 from the fan-out.
  const accepted = await post(`/personas/bob/requests/${requestId}/accept`, { device: 1 });
  assert.deepEqual([accepted.status, accepted.device], ["accepted", 1]);
  await waitFor(async () => (await get("/personas/alice/requests"))[0].status === "accepted");
  const aliceView = await waitFor(async () => {
    const v = await get("/personas/alice");
    return v.contacts[0]?.devices.length === 2 ? v : null;
  });
  const bobDeviceAccounts = bob.devices.map((d) => d.account).sort();
  assert.deepEqual(aliceView.contacts[0].devices.map((d) => d.statementAccountId).sort(), bobDeviceAccounts, "alice's roster holds both bob devices");
  const bobView = await get("/personas/bob");
  assert.deepEqual(bobView.contacts[0].devices.map((d) => d.statementAccountId), [alice.devices[0].account]);
  // The welcome message is bob's first row (read), the accept a system row on both sides.
  const bobRoom = await get("/personas/bob/rooms/alice");
  assert.deepEqual(bobRoom.messages.map((m) => [m.direction, m.content.type]), [["incoming", "text"], ["system", "contactAdded"]]);
  assert.equal(bobRoom.messages[0].messageId, requestId);
  assert.deepEqual(bobRoom.messages[0].receivedBy, [1, 2]);
  assert.equal(bobRoom.room.unreadCount, 0);

  // alice sends text; both bob devices receive and ACK it; alice sees delivered.
  const sent = await post("/personas/alice/rooms/bob/messages", { text: "hello bob" });
  assert.equal(sent.status, "sent");
  const delivered = await waitFor(async () => {
    const m = (await get("/personas/alice/rooms/bob")).messages.find((x) => x.messageId === sent.messageId);
    return m.status === "delivered" ? m : null;
  });
  assert.equal(delivered.device, 1);
  const onBoth = await waitFor(async () => {
    const m = (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === sent.messageId);
    return m && m.receivedBy.length === 2 && m.ackedBy.length === 2 ? m : null;
  });
  assert.deepEqual([onBoth.receivedBy.sort(), onBoth.ackedBy.sort()], [[1, 2], [1, 2]]);
  const device2 = await get("/personas/bob/rooms/alice?device=2");
  assert.ok(device2.messages.some((m) => m.messageId === sent.messageId && m.content.text === "hello bob"), "inbox --device 2 shows the text");
  assert.equal((await get("/personas/bob/rooms/alice?device=3")).messages.filter((m) => m.direction === "incoming").length, 0);
  const unread = await get("/personas/bob/rooms/alice?unread=1");
  assert.deepEqual(unread.messages.map((m) => m.messageId), [sent.messageId]);
  assert.equal((await get("/personas/bob/rooms")).find((r) => r.peerName === "alice").unreadCount, 1);
  await post("/personas/bob/rooms/alice/read");
  assert.equal((await get("/personas/bob/rooms/alice?unread=1")).messages.length, 0);

  // bob replies from device 2 (a reply quoting alice's text); alice sees it once, delivered to bob.
  const reply = await post("/personas/bob/rooms/alice/messages", { text: "hi from my laptop", replyTo: sent.messageId, device: 2 });
  assert.deepEqual([reply.device, reply.content.type, reply.content.messageId], [2, "reply", sent.messageId]);
  const onAlice = await waitFor(async () => (await get("/personas/alice/rooms/bob")).messages.find((m) => m.messageId === reply.messageId));
  assert.deepEqual([onAlice.direction, onAlice.content.text, onAlice.receivedBy], ["incoming", "hi from my laptop", [1]]);
  await waitFor(async () => (await get("/personas/bob/rooms/alice")).messages.find((m) => m.messageId === reply.messageId).status === "delivered");

  // Reaction and edit round-trip.
  await post("/personas/alice/rooms/bob/messages", { react: { messageId: reply.messageId, emoji: "🔥" } });
  await waitFor(async () => {
    const m = (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === reply.messageId);
    return m.reactions.some((r) => r.emoji === "🔥" && r.by === "peer");
  });
  await post("/personas/bob/rooms/alice/messages", { edit: { messageId: reply.messageId, text: "hi from my laptop (edited)" }, device: 2 });
  const edited = await waitFor(async () => {
    const m = (await get("/personas/alice/rooms/bob")).messages.find((x) => x.messageId === reply.messageId);
    return m.editedAt ? m : null;
  });
  assert.equal(edited.content.text, "hi from my laptop (edited)");
  await post("/personas/alice/rooms/bob/messages", { react: { messageId: reply.messageId, emoji: "🔥", add: false } });
  await waitFor(async () => (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === reply.messageId).reactions.length === 0);
  await assert.rejects(post("/personas/alice/rooms/bob/messages", { edit: { messageId: reply.messageId, text: "not mine" } }), /no own message/);

  // The wire: alice's text sits on her device session towards bob, signed by alice#1;
  // bob's reply on bob#2's session; bob's devices each ACKed on their own response channel.
  const wire = (await get("/wire?peer=alice")).statements;
  const aliceText = wire.find((s) => s.signerLabel === "alice#1" && s.channelLabel === "session alice#1→bob /request");
  assert.ok(aliceText, "alice's text statement on session alice#1→bob");
  assert.deepEqual(aliceText.topics.map((x) => x.label), ["session alice#1→bob"]);
  assert.equal(aliceText.expiresAt, null, "chat statements never expire (0xffffffff)");
  assert.ok(wire.some((s) => s.signerLabel === "bob#2" && s.channelLabel === "session bob#2→alice /request"), "bob's reply from device 2");
  for (const d of [1, 2]) assert.ok(wire.some((s) => s.channelLabel === `session bob#${d}→alice /response`), `bob#${d} ACKed on its own channel`);
  assert.ok(wire.some((s) => s.channelLabel === "identity bob→alice /request"), "the accept rode the identity session");
  assert.ok(wire.some((s) => s.channelLabel === "chat request" && s.topics.some((x) => x.label === "request→bob")), "the request on bob's discovery topics");
  assert.equal((await get("/wire?peer=carol")).statements.length, 0);
  assert.equal((await get(`/wire?signer=${bob.devices[1].account}`)).statements.every((s) => s.signerLabel === "bob#2"), true);
  assert.ok((await get("/wire?raw=1")).statements.every((s) => s.hex.startsWith("0x")));

  // Events: every state change was published, with a replayable sequence.
  const res = await fetch(`${api}/events?since=0`);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value);
  assert.ok(text.includes("event: persona") && text.includes("event: message") && text.includes("event: wire"));

  // A third persona cannot message an unknown name, and declining is local.
  await post("/personas", { name: "carol", devices: 1 });
  await assert.rejects(post("/personas/carol/requests", { to: "nobody" }), /unknown peer/);
  const { requestId: r2 } = await post("/personas/carol/requests", { to: "bob" });
  await waitFor(async () => (await get("/personas/bob/requests")).find((r) => r.requestId === r2));
  await post(`/personas/bob/requests/${r2}/decline`, {});
  assert.equal((await get(`/personas/bob/requests?status=declined`)).length, 1);
  assert.equal((await get("/personas/carol/requests"))[0].status, "pending", "the wire has no decline; carol's request stays pending");
  assert.equal((await get("/personas/bob")).contacts.length, 1);
});
