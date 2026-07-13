import { test } from "node:test";
import assert from "node:assert/strict";
import { createT3amsKnownChats } from "../lib/t3ams-known-chats.mjs";

test("known chat state is LRU-bounded and ignores malformed restored keys", () => {
  const chats = createT3amsKnownChats({
    cap: 2,
    isValid: (chatId) => /^t3ams:dm:[0-9a-f]{64}$/.test(chatId),
  });
  const one = `t3ams:dm:${"11".repeat(32)}`;
  const two = `t3ams:dm:${"22".repeat(32)}`;
  const three = `t3ams:dm:${"33".repeat(32)}`;

  assert.equal(chats.note("not a conversation"), false);
  chats.note(one);
  chats.note(two);
  chats.note(one); // refresh one, so two becomes the LRU victim.
  chats.note(three);
  assert.deepEqual(chats.keys(), [one, three]);
});

test("known chat state retains durable ingress chats until the journal releases them", () => {
  const durable = new Set();
  const chats = createT3amsKnownChats({ cap: 1, isProtected: (chatId) => durable.has(chatId) });

  chats.note("one");
  durable.add("one");
  durable.add("two");
  chats.note("two");
  assert.deepEqual(chats.keys(), ["one", "two"], "bounded overflow contains only durable journal chats");

  durable.delete("one");
  chats.trim();
  assert.deepEqual(chats.keys(), ["two"]);
});
