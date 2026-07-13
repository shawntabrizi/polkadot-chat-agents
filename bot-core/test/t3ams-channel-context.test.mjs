import { test } from "node:test";
import assert from "node:assert/strict";
import { createT3amsChannelContext } from "../lib/t3ams-channel-context.mjs";

const xid = (value) => Number(value).toString(16).padStart(64, "0");
const chat = (value) => `t3ams:channel:${xid(value)}:${xid(Number(value) + 1000)}`;
const message = (value, sender, text = `message-${value}`, threadRootId = null, extra = {}) => ({
  messageId: xid(value),
  senderXid: xid(sender),
  senderName: `member-${sender}`,
  text,
  threadRootId,
  ...extra,
});
const ids = (records) => records.map((record) => record.messageId);

test("channel context is opt-in and rejects malformed or oversized records", () => {
  const disabled = createT3amsChannelContext();
  assert.deepEqual(disabled.append(chat(1), message(1, 1)), { accepted: false, reason: "disabled" });

  const store = createT3amsChannelContext({
    enabled: true,
    maxRecordBytes: 512,
    maxBytesPerSender: 512,
    maxBytesPerChat: 512,
    maxTotalBytes: 512,
  });
  assert.equal(store.append("not-a-channel", message(1, 1)).reason, "invalid-chat");
  assert.equal(store.append(chat(1), { ...message(1, 1), messageId: "nope" }).reason, "invalid-record");
  assert.equal(store.append(chat(1), message(2, 1, "x".repeat(1_000))).reason, "record-too-large");
  assert.equal(store.stats().records, 0);
});

test("snapshots are in local receipt order and respect top-level versus thread scope", () => {
  let clock = 10;
  const store = createT3amsChannelContext({ enabled: true, now: () => clock });
  const channel = chat(1);
  const rootOne = xid(2);
  const rootTwo = xid(5);

  assert.equal(store.append(channel, message(1, 10, "top one", null, { timestamp: 999_999 })).accepted, true);
  clock += 10;
  store.append(channel, message(2, 11, "thread one root"));
  clock += 10;
  store.append(channel, message(3, 12, "thread one reply", rootOne));
  clock += 10;
  store.append(channel, message(4, 13, "top two"));
  clock += 10;
  store.append(channel, message(5, 14, "thread two root"));
  clock += 10;
  store.append(channel, message(6, 15, "thread two reply", rootTwo));

  assert.deepEqual(ids(store.snapshot(channel)), [xid(1), xid(2), xid(4), xid(5)]);
  assert.deepEqual(ids(store.snapshot(channel, { threadRootId: rootOne })), [xid(2), xid(3)]);
  assert.deepEqual(ids(store.snapshot(channel, { threadRootId: rootTwo })), [xid(5), xid(6)]);
  assert.deepEqual(store.snapshot(channel, { threadRootId: rootOne }).map((record) => record.receivedAt), [20, 30]);
});

test("thread snapshots pin the retained root and otherwise select newest relevant context", () => {
  const store = createT3amsChannelContext({ enabled: true });
  const channel = chat(2);
  const root = xid(10);
  store.append(channel, message(10, 1, "root"));
  store.append(channel, message(11, 2, "old reply", root));
  store.append(channel, message(12, 3, "new reply", root));

  assert.deepEqual(
    ids(store.snapshot(channel, { threadRootId: root, maxRecords: 2 })),
    [xid(10), xid(12)],
  );
  assert.deepEqual(
    ids(store.snapshot(channel, { threadRootId: root, maxRecords: 1 })),
    [xid(10)],
  );
});

test("TTL uses local receipt time, not a sender timestamp", () => {
  let clock = 1_000;
  const store = createT3amsChannelContext({ enabled: true, ttlMs: 100, now: () => clock });
  const channel = chat(3);
  store.append(channel, message(1, 1, "recent", null, { timestamp: 9_999_999_999 }));

  clock = 1_099;
  assert.equal(store.snapshot(channel).length, 1);
  clock = 1_100;
  assert.deepEqual(store.snapshot(channel), []);
  assert.deepEqual(store.stats().records, 0);
});

test("per-channel and per-sender caps retain fair recent context", () => {
  const store = createT3amsChannelContext({
    enabled: true,
    maxRecordsPerChat: 3,
    maxBytesPerChat: 2_000,
    maxRecordBytes: 700,
    maxRecordsPerSender: 2,
    maxBytesPerSender: 2_000,
    maxTotalBytes: 4_000,
  });
  const channel = chat(4);
  store.append(channel, message(1, 1, "a".repeat(150)));
  store.append(channel, message(2, 1, "b".repeat(150)));
  store.append(channel, message(3, 2, "member two"));
  store.append(channel, message(4, 1, "c".repeat(150)));

  // Sender one exceeds its record share, so its oldest record goes first rather
  // than erasing member two's contribution.
  assert.deepEqual(ids(store.snapshot(channel)), [xid(2), xid(3), xid(4)]);
  assert.ok(store.stats().bytes <= 4_000);
  assert.ok(store.stats().bytes <= store.stats().limits.maxTotalBytes);

  const byteFair = createT3amsChannelContext({
    enabled: true,
    maxRecordsPerChat: 8,
    maxBytesPerChat: 2_000,
    maxRecordBytes: 700,
    maxRecordsPerSender: 4,
    maxBytesPerSender: 650,
    maxTotalBytes: 4_000,
  });
  const byteChannel = chat(40);
  byteFair.append(byteChannel, message(10, 1, "a".repeat(150)));
  byteFair.append(byteChannel, message(11, 2, "member two"));
  byteFair.append(byteChannel, message(12, 1, "b".repeat(150)));
  // Two records are below the four-record sender cap, but their combined
  // bytes exceed the sender budget; only sender one's oldest item is evicted.
  assert.deepEqual(ids(byteFair.snapshot(byteChannel)), [xid(11), xid(12)]);
});

test("per-channel byte and global LRU/byte caps stay bounded and clear is scoped", () => {
  const byteBounded = createT3amsChannelContext({
    enabled: true,
    maxRecordsPerChat: 8,
    maxBytesPerChat: 700,
    maxRecordBytes: 600,
    maxRecordsPerSender: 8,
    maxBytesPerSender: 700,
    maxTotalBytes: 2_000,
  });
  const byteChannel = chat(5);
  byteBounded.append(byteChannel, message(1, 1, "a".repeat(200)));
  byteBounded.append(byteChannel, message(2, 2, "b".repeat(200)));
  assert.deepEqual(ids(byteBounded.snapshot(byteChannel)), [xid(2)]);
  assert.ok(byteBounded.stats().bytes <= byteBounded.stats().limits.maxBytesPerChat);

  const lru = createT3amsChannelContext({
    enabled: true,
    maxChats: 2,
    maxRecordsPerChat: 8,
    maxBytesPerChat: 700,
    maxRecordBytes: 600,
    maxRecordsPerSender: 8,
    maxBytesPerSender: 700,
    maxTotalBytes: 1_600,
  });
  const one = chat(11);
  const two = chat(12);
  const three = chat(13);
  lru.append(one, message(1, 1, "a".repeat(200)));
  lru.append(two, message(2, 2, "b".repeat(200)));
  lru.snapshot(one); // Keep one as the recently used chat before admitting three.
  lru.append(three, message(3, 3, "c".repeat(200)));
  assert.deepEqual(lru.snapshot(two), []);
  assert.equal(lru.snapshot(one).length, 1);
  assert.equal(lru.snapshot(three).length, 1);
  assert.ok(lru.stats().bytes <= lru.stats().limits.maxTotalBytes);

  const globalBytes = createT3amsChannelContext({
    enabled: true,
    maxChats: 8,
    maxRecordsPerChat: 8,
    maxBytesPerChat: 800,
    maxRecordBytes: 600,
    maxRecordsPerSender: 8,
    maxBytesPerSender: 800,
    maxTotalBytes: 700,
  });
  const oldGlobal = chat(21);
  const newGlobal = chat(22);
  globalBytes.append(oldGlobal, message(21, 1, "a".repeat(200)));
  globalBytes.append(newGlobal, message(22, 2, "b".repeat(200)));
  assert.deepEqual(globalBytes.snapshot(oldGlobal), []);
  assert.equal(globalBytes.snapshot(newGlobal).length, 1);
  assert.ok(globalBytes.stats().bytes <= globalBytes.stats().limits.maxTotalBytes);

  assert.equal(lru.clear(one), true);
  assert.deepEqual(lru.snapshot(one), []);
  assert.equal(lru.snapshot(three).length, 1);
  assert.equal(lru.clear(one), false);
});

test("authenticated edits replace and deletes purge a passive context row without changing order", () => {
  const store = createT3amsChannelContext({ enabled: true });
  const channel = chat(30);
  const first = message(1, 1, "first");
  const second = message(2, 2, "second");
  store.append(channel, first);
  store.append(channel, second);

  const edited = store.replace(channel, first.messageId, { senderXid: first.senderXid, text: "first, edited" });
  assert.equal(edited.accepted, true);
  assert.deepEqual(store.snapshot(channel).map((record) => record.text), ["first, edited", "second"]);
  assert.deepEqual(store.replace(channel, first.messageId, { senderXid: second.senderXid, text: "forged" }), {
    accepted: false,
    reason: "sender-mismatch",
  });
  assert.equal(store.remove(channel, first.messageId, { senderXid: first.senderXid }).accepted, true);
  assert.deepEqual(ids(store.snapshot(channel)), [second.messageId]);
  assert.deepEqual(store.remove(channel, second.messageId, { senderXid: first.senderXid }), {
    accepted: false,
    reason: "sender-mismatch",
  });
});
