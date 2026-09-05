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
  const res = await fetch(`${url}/api${route}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
  const del = (route) => call(api, "DELETE", route);

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
  const res = await fetch(`${api}/api/events?since=0`);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value);
  assert.ok(text.includes("event: persona") && text.includes("event: message") && text.includes("event: wire"));

  // A call offer from alice: bob declines it (no media stack), alice sees the decline under her offer.
  const offer = await post("/personas/alice/rooms/bob/messages", { call: true });
  assert.equal(offer.content.type, "callOffer");
  await waitFor(async () => (await get("/personas/alice/rooms/bob")).messages.some((m) => m.messageId === `call-closed:${offer.messageId}`));
  assert.ok((await get("/personas/bob/rooms/alice")).messages.some((m) => m.messageId === `call-declined:${offer.messageId}`));
  // Raw bytes ride the batch without a row.
  const raw = await post("/personas/alice/rooms/bob/messages", { raw: "0x0102" });
  assert.deepEqual([raw.raw, raw.bytes], [true, 2]);
  await assert.rejects(post("/personas/alice/rooms/bob/messages", { raw: "junk" }), /raw must be/);
  // bob removes device 2: it goes offline for good, alice's roster shrinks, device 1 keeps its number.
  const gone = await del("/personas/bob/devices/2");
  assert.deepEqual([gone.index, gone.removed, gone.online], [2, true, false]);
  await waitFor(async () => (await get("/personas/alice")).contacts[0].devices.length === 1);
  assert.equal((await get("/personas/alice")).contacts[0].devices[0].statementAccountId, bob.devices[0].account);
  await assert.rejects(post("/personas/bob/rooms/alice/messages", { text: "x", device: 2 }), /was removed/);
  await assert.rejects(del("/personas/alice/devices/1"), /last device/);
  const afterRemoval = await post("/personas/alice/rooms/bob/messages", { text: "one device left" });
  await waitFor(async () => (await get("/personas/alice/rooms/bob")).messages.find((m) => m.messageId === afterRemoval.messageId).status === "delivered");
  assert.deepEqual((await get("/personas/bob/rooms/alice")).messages.find((m) => m.messageId === afterRemoval.messageId).receivedBy, [1]);

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

test("faults, clock and node restart; the wire decodes both directions and matches ACKs per device", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-e2e-"));
  const daemon = await startDaemon({ dir, port: 0 });
  t.after(async () => { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const api = daemon.url;
  const get = (route) => call(api, "GET", route);
  const post = (route, body) => call(api, "POST", route, body);
  const del = (route) => call(api, "DELETE", route);
  const label = (name) => encodeURIComponent(name);
  const delivered = (from, to, messageId) => waitFor(async () => (await get(`/personas/${from}/rooms/${to}`)).messages.find((m) => m.messageId === messageId)?.status === "delivered");

  await post("/personas", { name: "alice", devices: 1 });
  const bob = await post("/personas", { name: "bob", devices: 2 });
  const { requestId } = await post("/personas/alice/requests", { to: "bob", welcome: "hi bob" });
  await waitFor(async () => (await get("/personas/bob/requests")).length === 1);
  await post(`/personas/bob/requests/${requestId}/accept`, {});
  await waitFor(async () => (await get("/personas/alice")).contacts[0]?.devices.length === 2);
  const sent = await post("/personas/alice/rooms/bob/messages", { text: "hello bob" });
  await delivered("alice", "bob", sent.messageId);
  await waitFor(async () => (await get("/personas/bob/rooms/alice")).messages.find((m) => m.messageId === sent.messageId)?.ackedBy.length === 2);

  // The decoded wire: the request (bob holds the key), the accept on the
  // identity session, alice's text as a multi-device envelope for both bob
  // devices, and each device's ACK matched to it.
  const wire = (await get("/wire")).statements;
  const opener = wire.find((s) => s.channelLabel === "chat request");
  assert.deepEqual([opener.decoded.kind, opener.decoded.requestId, opener.decoded.welcome, opener.decoded.sender.label], ["chatRequest", requestId, "hi bob", "alice"]);
  assert.equal(opener.decoded.sender.device, daemon.personas.get("alice").devices[0].account, "the request names the sending device");
  const accept = wire.find((s) => s.channelLabel === "identity bob→alice /request");
  assert.equal(accept.decoded.messages[0].content.type, "deviceChatAccepted");
  assert.equal(accept.decoded.messages[0].content.requestId, requestId);
  assert.deepEqual(accept.acks.map((a) => [a.by, a.code]), [["alice#1", "success"]], "alice ACKed the accept on the identity session");
  const text = wire.find((s) => s.channelLabel === "session alice#1→bob /request");
  assert.equal(text.decoded.multiDevice, true);
  assert.deepEqual(text.decoded.recipients.map((r) => r.label).sort(), ["bob#1", "bob#2"], "wrapped for both bob devices");
  const row = text.decoded.messages.find((m) => m.messageId === sent.messageId);
  assert.deepEqual(row.content, { type: "text", text: "hello bob" }, "the inbox's content shape");
  assert.deepEqual(text.acks.map((a) => [a.by, a.code, a.live]).sort(), [["bob#1", "success", true], ["bob#2", "success", true]]);
  assert.ok(wire.every((s) => !("hex" in s)), "no raw bytes unless asked");
  assert.ok(!JSON.stringify(wire).includes(Buffer.from(daemon.personas.get("bob").devices[0].keys.statementSeed).toString("hex").slice(0, 32)), "no key material in the wire view");
  // A slot's history: the fan-out (deviceAdded) sat in alice's request slot before the text replaced it.
  const history = (await get(`/wire/history?channel=${label("session alice#1→bob /request")}`)).history;
  // (whether the text extended the un-ACKed fan-out batch or started a fresh one depends on timing)
  const kinds = (h) => h.decoded.messages.map((m) => m.content.type);
  assert.deepEqual(history.map((h) => h.reason), ["replaced", null]);
  assert.deepEqual([kinds(history[0])[0], kinds(history[1]).at(-1)], ["deviceAdded", "text"]);
  assert.ok(history[0].replacedAt && !history[1].replacedAt);
  assert.equal((await get(`/wire?channel=${label("session alice#1→bob /request")}`)).statements.length, 1);
  await assert.rejects(get("/wire?channel=nope"), /unknown channel/);

  // A fault by persona name and channel label: bob#1's next ACK is swallowed
  // by the node; alice's row is delivered by bob#2's ACK alone.
  const fault = await post("/faults", { kind: "drop", from: "bob", channel: "session bob#1→alice /response", count: 1 });
  assert.deepEqual([fault.kind, fault.count, fault.hits, fault.signer.length], ["drop", 1, 0, 3]);
  assert.deepEqual((await get("/faults")).map((f) => f.id), [fault.id]);
  const second = await post("/personas/alice/rooms/bob/messages", { text: "second" });
  await delivered("alice", "bob", second.messageId);
  await waitFor(async () => (await get("/faults")).length === 0, { attempts: 200 });
  const acked = (await get(`/wire?channel=${label("session alice#1→bob /request")}`)).statements[0];
  assert.deepEqual(acked.acks.filter((a) => a.live).map((a) => a.by), ["bob#2"], "bob#1's ACK never reached the store");
  assert.equal((await get("/node")).faults.length, 0, "a count-1 fault is spent");
  await assert.rejects(post("/faults", { kind: "drop", from: "nobody" }), /unknown signer/);
  await assert.rejects(post("/faults", { kind: "blip" }), /kind must be/);
  const forever = await post("/faults", { kind: "delay", from: "alice", ms: 10, count: null });
  assert.equal(forever.count, null);
  assert.deepEqual(await del(`/faults/${forever.id}`), { cleared: 1 });
  await assert.rejects(del(`/faults/${forever.id}`), /404/);

  // The clock moves the node's expiry checks; chat statements never expire.
  const beforeClock = (await get("/wire")).statements;
  assert.ok(beforeClock.every((s) => s.expiresAt === null), "chat statements carry 0xffffffff");
  assert.deepEqual(await post("/clock", { offsetMs: 2 * 3600 * 1000 }), { offsetMs: 7_200_000 });
  assert.equal((await get("/node")).clock.offsetMs, 7_200_000);
  assert.equal((await get("/wire")).statements.length, beforeClock.length, "nothing expired");
  assert.deepEqual(await post("/clock", { reset: true }), { offsetMs: 0 });

  // A node restart drops every socket and keeps the store; personas rebuild
  // their sessions and traffic continues without a new request.
  const before = (await get("/node")).statements;
  assert.deepEqual(await post("/node/restart"), { ok: true, statements: before });
  const after = await post("/personas/alice/rooms/bob/messages", { text: "after restart" });
  await delivered("alice", "bob", after.messageId);
  const onBoth = await waitFor(async () => {
    const m = (await get("/personas/bob/rooms/alice")).messages.find((x) => x.messageId === after.messageId);
    return m?.receivedBy.length === 2 ? m : null;
  });
  assert.deepEqual(onBoth.receivedBy.sort(), [1, 2]);
  assert.equal((await get("/personas/bob/rooms/alice")).messages.filter((m) => m.direction === "incoming" && m.content.type === "text").length, 4, "the old statements were not received again");
  // A reset wipes the store; the sessions still work.
  assert.deepEqual(await post("/node/reset"), { ok: true, statements: 0 });
  const fresh = await post("/personas/bob/rooms/alice/messages", { text: "fresh store", device: 2 });
  await delivered("bob", "alice", fresh.messageId);
  assert.equal((await get("/wire")).statements.every((s) => s.signerLabel), true);

  // Faults, clock and node events are in the stream, typed apart from wire events.
  const res = await fetch(`${api}/api/events?since=0`);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const stream = new TextDecoder().decode(value);
  for (const type of ["fault", "clock", "node"]) assert.ok(stream.includes(`event: ${type}\n`), `no ${type} event`);
  assert.ok(/"action":"hit"/.test(stream) && /"action":"cleared"/.test(stream) && /"action":"restart"/.test(stream));
  assert.equal(bob.devices.length, 2);
});
