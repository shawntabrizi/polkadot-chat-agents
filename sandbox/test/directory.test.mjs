// The directory is the People chain the clients read: an account is
// messageable only with a 65-byte identifier-key container, usernames are
// unique, and registering grants the store-node allowance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirectory, wrapIdentifierKey, unwrapIdentifierKey, IDENTIFIER_KEY_BYTES } from "../lib/directory.mjs";

const acct = (fill) => new Uint8Array(32).fill(fill);
const key = (fill) => new Uint8Array(32).fill(fill);
const hex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;

test("identifier key container is 0x00 || pk || pad, and readers ignore the padding", () => {
  const container = wrapIdentifierKey(key(0xab));
  assert.equal(container.length, IDENTIFIER_KEY_BYTES);
  assert.equal(container[0], 0x00);
  assert.deepEqual(container.slice(1, 33), key(0xab));
  assert.deepEqual(container.slice(33), new Uint8Array(32));
  const padded = Uint8Array.from(container);
  padded[40] = 0xff;
  assert.deepEqual(unwrapIdentifierKey(padded), key(0xab));
  // A P-256 container (type byte 0x04) is not an X25519 key.
  const p256 = Uint8Array.from(container); p256[0] = 0x04;
  assert.equal(unwrapIdentifierKey(p256), null);
  assert.equal(unwrapIdentifierKey(new Uint8Array(32)), null);
  assert.throws(() => wrapIdentifierKey(new Uint8Array(31)), /32 or 65 bytes/);
  // A container passed in is stored as-is (what `pcs bot attach` will send).
  assert.deepEqual(wrapIdentifierKey(hex(container)), container);
});

test("register publishes the container, maps the username and grants the allowance", () => {
  const allowances = new Set();
  const directory = createDirectory({ allowances });
  const entry = directory.register(acct(1), { username: "alice", identifierKey: key(0xa1) });
  assert.equal(entry.account, hex(acct(1)));
  assert.equal(entry.identifierKey, hex(wrapIdentifierKey(key(0xa1))));
  assert.ok(allowances.has(hex(acct(1))), "the identity account may submit statements");

  // bot-core reads the container; the SDK's lookup reads the unwrapped key.
  assert.deepEqual(directory.consumer(acct(1)), { account: hex(acct(1)), username: "alice", identifierKey: hex(wrapIdentifierKey(key(0xa1))) });
  assert.deepEqual(directory.identityOf(hex(acct(1))).chatPublicKey, key(0xa1));
  assert.equal(directory.usernameOwner("alice"), hex(acct(1)));
  assert.equal(directory.usernameOwner("nobody"), null);
  assert.equal(directory.consumer(acct(2)), null);
});

test("usernames are unique; an account may rotate its key but not its name", () => {
  const directory = createDirectory({ allowances: new Set() });
  directory.register(acct(1), { username: "alice", identifierKey: key(1) });
  assert.throws(() => directory.register(acct(2), { username: "alice", identifierKey: key(2) }), /username taken/);
  assert.throws(() => directory.register(acct(1), { username: "alice2", identifierKey: key(1) }), /already owns/);
  assert.throws(() => directory.register(acct(3), { username: "Not Valid!", identifierKey: key(3) }), /invalid username/);
  // update_identifier_key: same account, same name, new key.
  directory.register(acct(1), { username: "alice", identifierKey: key(9) });
  assert.deepEqual(directory.identityOf(acct(1)).chatPublicKey, key(9));
  assert.equal(directory.list().length, 1);
});

test("allow grants a device account bandwidth without making it messageable", () => {
  const allowances = new Set();
  const directory = createDirectory({ allowances });
  directory.allow(acct(7));
  assert.ok(allowances.has(hex(acct(7))));
  assert.equal(directory.consumer(acct(7)), null, "no identifier key: nobody can open a chat with a device account");
  assert.equal(directory.identityOf(acct(7)), null);
  assert.deepEqual(directory.list(), [{ account: hex(acct(7)), username: null, identifierKey: null, allowance: true }]);
  assert.equal(directory.hasAllowance(acct(7)), true);
  assert.equal(directory.hasAllowance(acct(8)), false);
});
