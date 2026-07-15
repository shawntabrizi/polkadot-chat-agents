import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  T3AMS_ACCOUNT_XID_DOMAIN,
  T3AMS_BULLETIN_UPLOAD_DERIVATION,
  T3AMS_IDENTITY_AGREEMENT_DOMAIN,
  T3AMS_IDENTITY_SIGN_DOMAIN,
  botSeedFromHex,
  bytesToHex,
  deriveT3amsBulletinUploadSigner,
  deriveT3amsBulletinUploadSignerFromSeed,
  deriveT3amsIdentity,
  deriveT3amsIdentityFromSeed,
} from "../../transports/t3ams/t3ams-identity.mjs";
import { deriveSr25519PairFromSeed } from "../../vendor/lib/wallet-keys.mjs";

const sha256 = (value) => new Uint8Array(createHash("sha256").update(value).digest());
const concat = (...parts) => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const value = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { value.set(part, offset); offset += part.length; }
  return value;
};
const enc = new TextEncoder();

test("T3ams bot material is deterministic, domain separated, and account-XID anchored", () => {
  const seedHex = `0x${"11".repeat(32)}`;
  const seed = botSeedFromHex(seedHex);
  const first = deriveT3amsIdentity(seedHex);
  const second = deriveT3amsIdentityFromSeed(seed);

  assert.deepEqual(first, second);
  // Cross-implementation compatibility vector from the T3ams BCTS derivation
  // domains. Pin all persisted identity material, not just the account XID.
  assert.equal(first.accountIdHex, "0x0297002e8fd125813ac998339a26ff87e1de58c57764d4c57b092543feb8da66");
  assert.equal(first.xidHex, "0x0b2a1456bd1afb7315bb74138fffb168ebae68a557957c9236b028dd1a6dc0a3");
  assert.equal(bytesToHex(first.signingPrivateKey), "0x84d537d7d116cbbfe51d9c09e95a977c38c30b1ef6e41ce0bc61115b9b2ab65d");
  assert.equal(bytesToHex(first.agreementPrivateKey), "0x2f4b7f60ddfc4aa624b831d550543259e0baff636b27c15f29b986c412962acd");
  assert.deepEqual(first.signingPrivateKey, sha256(concat(enc.encode(T3AMS_IDENTITY_SIGN_DOMAIN), seed)));
  assert.deepEqual(first.agreementPrivateKey, sha256(concat(enc.encode(T3AMS_IDENTITY_AGREEMENT_DOMAIN), seed)));
  assert.notDeepEqual(first.signingPrivateKey, first.agreementPrivateKey);

  const accountId = deriveSr25519PairFromSeed(seed, "//wallet").publicKey;
  assert.deepEqual(first.accountId, accountId);
  assert.deepEqual(first.xid, sha256(concat(enc.encode(T3AMS_ACCOUNT_XID_DOMAIN), accountId)));
  assert.equal(first.accountIdHex, bytesToHex(accountId));
  assert.equal(first.xidHex, bytesToHex(first.xid));
});

test("T3ams bot identity rejects malformed BOT_SEED_HEX without exposing it", () => {
  for (const value of [null, "", "0x11", "0xzz".padEnd(66, "z")]) {
    assert.throws(() => botSeedFromHex(value), /exactly 32 bytes/);
  }
  assert.throws(() => deriveT3amsIdentityFromSeed(new Uint8Array(31)), /exactly 32 bytes/);
});

test("T3ams Bulletin uploads use the dedicated allowance signer, not the bot wallet", () => {
  const seedHex = `0x${"22".repeat(32)}`;
  const seed = botSeedFromHex(seedHex);
  const wallet = deriveSr25519PairFromSeed(seed, "//wallet");
  const expected = deriveSr25519PairFromSeed(seed, "//allowance//bulletin//chat");
  const fromSeed = deriveT3amsBulletinUploadSignerFromSeed(seed);
  const fromHex = deriveT3amsBulletinUploadSigner(seedHex);

  assert.equal(T3AMS_BULLETIN_UPLOAD_DERIVATION, "//allowance//bulletin//chat");
  assert.deepEqual(fromSeed.publicKey, expected.publicKey);
  assert.deepEqual(fromHex.publicKey, expected.publicKey);
  assert.notDeepEqual(fromSeed.publicKey, wallet.publicKey);
});
