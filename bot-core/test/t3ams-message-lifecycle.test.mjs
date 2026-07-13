import { test } from "node:test";
import assert from "node:assert/strict";
import { createT3amsMessageLifecycle } from "../lib/t3ams-message-lifecycle.mjs";

const chatId = `t3ams:channel:${"a1".repeat(32)}:${"b2".repeat(32)}`;
const alice = "c3".repeat(32);
const bob = "d4".repeat(32);
const messageId = "e5".repeat(32);

test("an edit that arrives before its message is applied only to the matching author", () => {
  const lifecycle = createT3amsMessageLifecycle();
  assert.deepEqual(lifecycle.applyOperation({
    kind: "edit", chatId, messageId, senderXid: alice, text: "edited first", timestamp: 20,
  }), {
    accepted: true, changed: true, messageSeen: false, deleted: false, text: "edited first", editedAt: 20,
  });
  assert.deepEqual(lifecycle.applyMessage({ chatId, messageId, senderXid: alice, text: "original", timestamp: 10 }), {
    accepted: true, deleted: false, text: "edited first", editedAt: 20,
  });

  const mismatched = createT3amsMessageLifecycle();
  mismatched.applyOperation({ kind: "edit", chatId, messageId, senderXid: alice, text: "not Bob's", timestamp: 20 });
  assert.deepEqual(mismatched.applyMessage({ chatId, messageId, senderXid: bob, text: "Bob's original", timestamp: 10 }), {
    accepted: true, deleted: false, text: "Bob's original",
  });
});

test("delete tombstones suppress queued/replayed content and cannot be revived by a later edit", () => {
  const lifecycle = createT3amsMessageLifecycle();
  lifecycle.applyMessage({ chatId, messageId, senderXid: alice, text: "erase me", timestamp: 10 });
  assert.deepEqual(lifecycle.applyOperation({ kind: "delete", chatId, messageId, senderXid: alice, timestamp: 50 }), {
    accepted: true, changed: true, messageSeen: true, deleted: true, deletedAt: 50,
  });
  assert.deepEqual(lifecycle.applyOperation({ kind: "edit", chatId, messageId, senderXid: alice, text: "resurrect", timestamp: 60 }), {
    accepted: true, changed: false, messageSeen: true, deleted: true, deletedAt: 50,
  });
  assert.deepEqual(lifecycle.applyMessage({ chatId, messageId, senderXid: alice, text: "replayed original", timestamp: 10 }), {
    accepted: true, deleted: true, text: null, deletedAt: 50,
  });
});

test("operations are bounded, expire, and reject malformed/mismatched data", () => {
  let clock = 100;
  const lifecycle = createT3amsMessageLifecycle({ maxRecords: 1, ttlMs: 10, now: () => clock });
  assert.equal(lifecycle.applyOperation({ kind: "edit", chatId, messageId, senderXid: alice, text: "ok", timestamp: 1 }).accepted, true);
  assert.deepEqual(lifecycle.applyOperation({ kind: "delete", chatId, messageId, senderXid: bob, timestamp: 2 }), {
    accepted: false, reason: "sender-mismatch",
  });
  assert.deepEqual(lifecycle.applyOperation({ kind: "edit", chatId, messageId, senderXid: alice, text: "", timestamp: 2 }), {
    accepted: true, changed: true, messageSeen: false, deleted: false, text: "", editedAt: 2,
  });
  clock += 11;
  assert.equal(lifecycle.stats().records, 0);
});

test("an empty caption remains representable for an attachment-only carrier", () => {
  const lifecycle = createT3amsMessageLifecycle();
  assert.deepEqual(lifecycle.applyMessage({ chatId, messageId, senderXid: alice, text: "", timestamp: 10 }), {
    accepted: true,
    deleted: false,
    text: "",
  });
});

test("edits use the SPA's strict timestamp LWW rule across pre-arrival and live operations", () => {
  const lifecycle = createT3amsMessageLifecycle();
  const dmChatId = `t3ams:dm:${"f6".repeat(32)}`;

  lifecycle.applyOperation({ kind: "edit", chatId: dmChatId, messageId, senderXid: alice, text: "stale", timestamp: 10 });
  assert.deepEqual(lifecycle.applyMessage({ chatId: dmChatId, messageId, senderXid: alice, text: "original", timestamp: 20 }), {
    accepted: true, deleted: false, text: "original",
  });
  assert.deepEqual(lifecycle.applyOperation({ kind: "edit", chatId: dmChatId, messageId, senderXid: alice, text: "equal", timestamp: 20 }), {
    accepted: true, changed: false, messageSeen: true, deleted: false,
  });
  assert.deepEqual(lifecycle.applyOperation({ kind: "edit", chatId: dmChatId, messageId, senderXid: alice, text: "fresh", timestamp: 21 }), {
    accepted: true, changed: true, messageSeen: true, deleted: false, text: "fresh", editedAt: 21,
  });
  assert.deepEqual(lifecycle.applyOperation({ kind: "edit", chatId: dmChatId, messageId, senderXid: alice, text: "same time", timestamp: 21 }), {
    accepted: true, changed: false, messageSeen: true, deleted: false, text: "fresh", editedAt: 21,
  });
});

test("a bounded snapshot restores valid pre-arrival edit and delete state after restart", () => {
  let clock = 1_000;
  const deletedMessageId = "f6".repeat(32);
  const source = createT3amsMessageLifecycle({ now: () => clock });
  source.applyOperation({
    kind: "edit", chatId, messageId, senderXid: alice, text: "edited before carrier", timestamp: 20,
  });
  source.applyOperation({
    kind: "delete", chatId, messageId: deletedMessageId, senderXid: alice, timestamp: 21,
  });

  const state = source.snapshot();
  assert.deepEqual(state, {
    v: 1,
    records: [
      {
        chatId, messageId, senderXid: alice, messageSeen: false,
        edit: { text: "edited before carrier", timestamp: 20 }, touchedAt: 1_000,
      },
      {
        chatId, messageId: deletedMessageId, senderXid: alice, messageSeen: false,
        deletedAt: 21, touchedAt: 1_000,
      },
    ],
  });

  clock += 1;
  const restarted = createT3amsMessageLifecycle({ now: () => clock, initialSnapshot: state });
  assert.deepEqual(restarted.stats(), {
    records: 2,
    maxRecords: 8192,
    ttlMs: 6 * 60 * 60 * 1000,
    maxTextBytes: 64 * 1024,
    maxStateBytes: 8 * 1024 * 1024,
  });
  assert.deepEqual(restarted.applyMessage({ chatId, messageId, senderXid: alice, text: "original", timestamp: 10 }), {
    accepted: true, deleted: false, text: "edited before carrier", editedAt: 20,
  });
  assert.deepEqual(restarted.applyMessage({
    chatId, messageId: deletedMessageId, senderXid: alice, text: "deleted original", timestamp: 10,
  }), {
    accepted: true, deleted: true, text: null, deletedAt: 21,
  });
});

test("snapshot restore ignores malformed records and an invalid top-level snapshot", () => {
  let clock = 100;
  const lifecycle = createT3amsMessageLifecycle({ maxRecords: 4, ttlMs: 20, now: () => clock });
  lifecycle.applyOperation({ kind: "delete", chatId, messageId, senderXid: alice, timestamp: 1 });
  assert.deepEqual(lifecycle.restore({ nope: true }), { accepted: false, restored: 0, ignored: 0 });
  assert.deepEqual(lifecycle.applyMessage({ chatId, messageId, senderXid: alice, text: "still deleted", timestamp: 2 }), {
    accepted: true, deleted: true, text: null, deletedAt: 1,
  });

  const validId = "f6".repeat(32);
  const result = lifecycle.restore({
    v: 1,
    records: [
      null,
      { chatId: "not-a-chat", messageId: validId, senderXid: alice, messageSeen: false, deletedAt: 1, touchedAt: 100 },
      { chatId, messageId: validId, senderXid: alice, messageSeen: true, touchedAt: 100 },
      { chatId, messageId: validId, senderXid: alice, messageSeen: false, edit: { text: "x".repeat(64 * 1024 + 1), timestamp: 1 }, touchedAt: 100 },
      { chatId, messageId: validId, senderXid: alice, messageSeen: false, deletedAt: -1, touchedAt: 100 },
      { chatId, messageId: validId, senderXid: alice, messageSeen: false, edit: { text: "valid", timestamp: 3 }, touchedAt: 100 },
    ],
  });
  assert.deepEqual(result, { accepted: true, restored: 1, ignored: 5 });
  assert.deepEqual(lifecycle.applyMessage({ chatId, messageId: validId, senderXid: alice, text: "original", timestamp: 2 }), {
    accepted: true, deleted: false, text: "valid", editedAt: 3,
  });
});

test("snapshot restore prunes expired state and retains only the bounded recent suffix", () => {
  let clock = 100;
  const firstId = "f6".repeat(32);
  const secondId = "07".repeat(32);
  const source = createT3amsMessageLifecycle({ maxRecords: 2, ttlMs: 10, now: () => clock });
  source.applyOperation({ kind: "delete", chatId, messageId: firstId, senderXid: alice, timestamp: 1 });
  clock += 1;
  source.applyOperation({ kind: "delete", chatId, messageId: secondId, senderXid: alice, timestamp: 2 });
  const state = source.snapshot();

  const capped = createT3amsMessageLifecycle({ maxRecords: 1, ttlMs: 10, now: () => clock, initialSnapshot: state });
  assert.equal(capped.stats().records, 1);
  assert.deepEqual(capped.applyMessage({ chatId, messageId: secondId, senderXid: alice, text: "second", timestamp: 2 }), {
    accepted: true, deleted: true, text: null, deletedAt: 2,
  });
  const missingOldest = createT3amsMessageLifecycle({ maxRecords: 1, ttlMs: 10, now: () => clock, initialSnapshot: state });
  assert.deepEqual(missingOldest.applyMessage({ chatId, messageId: firstId, senderXid: alice, text: "first", timestamp: 1 }), {
    accepted: true, deleted: false, text: "first",
  });

  clock += 10;
  const expired = createT3amsMessageLifecycle({ ttlMs: 10, now: () => clock, initialSnapshot: state });
  assert.equal(expired.stats().records, 0);
  assert.deepEqual(expired.applyMessage({ chatId, messageId: secondId, senderXid: alice, text: "no longer tombstoned", timestamp: 2 }), {
    accepted: true, deleted: false, text: "no longer tombstoned",
  });
});

test("aggregate lifecycle state bytes evict oldest edits before a durable snapshot grows unbounded", () => {
  let clock = 1_000;
  const lifecycle = createT3amsMessageLifecycle({
    maxRecords: 10,
    maxStateBytes: 1_024,
    now: () => clock,
  });
  const firstId = "f6".repeat(32);
  const secondId = "07".repeat(32);
  const thirdId = "18".repeat(32);
  const text = "x".repeat(600);
  lifecycle.applyOperation({ kind: "edit", chatId, messageId: firstId, senderXid: alice, text, timestamp: 1 });
  clock += 1;
  lifecycle.applyOperation({ kind: "edit", chatId, messageId: secondId, senderXid: alice, text, timestamp: 2 });
  clock += 1;
  lifecycle.applyOperation({ kind: "edit", chatId, messageId: thirdId, senderXid: alice, text, timestamp: 3 });

  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.records.length, 1, "the newest record survives the byte budget");
  assert.equal(snapshot.records[0].messageId, thirdId);
  assert.equal(lifecycle.stats().maxStateBytes, 1_024);
});
