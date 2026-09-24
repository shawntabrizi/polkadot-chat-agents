// Spec 0011 private groups v2: keys, topic, channels, sealing and rekey
// entries. Every value here is pinned by docs/spec/vectors-0011.md in the
// desktop repo.
//
//   Topic_e   = khash(K_e, b"grp-topic" : encode(groupId) : encode(e))
//   MsgKey_e  = khash(K_e, b"grp-msg")
//   ChMsgs_e  = khash(K_e, b"grp-ch-msgs")      a member's message carrier
//   ChState_e = khash(K_e, b"grp-ch-state")     an admin's group state
//   ChRekey_e = khash(K_e, b"grp-ch-rekey")     an admin's rekey out of epoch e
//   Sealed    = AES-256-GCM(MsgKey_e, nonce, plaintext, aad = b"grp" : signer : encode(e) : variant)
//   WrapKey(A, B, e) = khash(K(A, B), b"grp-wrap" : encode(groupId) : encode(e))
//   box       = AES-256-GCM(WrapKey(admin, member, e'), nonce, K_e', aad = encode(e'))
//   hint      = khash(WrapKey, b"grp-hint")[0..8]
//
// K(A, B) is the base spec's pairwise secret as the network computes it
// today: the raw X25519 agreement of the two IDENTITY chat keys (the value
// that keys SessionId), not an HKDF output. Every device of a member holds the
// identity chat key (mds.md), so every device opens the member's entry.
import crypto from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";
import { x25519SharedSecret } from "../vendor/app-chat-codec.mjs";
import { concat, str, toBytes, u32 } from "./group-codec.mjs";

const te = new TextEncoder();
export const khash = (key, payload) => blake2b(payload, { key, dkLen: 32 });
export const hash256 = (payload) => blake2b(payload, { dkLen: 32 });

const label = (s) => te.encode(s);
export const groupTopic = (key, groupId, epoch) => khash(key, concat(label("grp-topic"), str(groupId), u32(epoch)));
export const groupMsgKey = (key) => khash(key, label("grp-msg"));
export const groupChannels = (key) => ({
  msgs: khash(key, label("grp-ch-msgs")),
  state: khash(key, label("grp-ch-state")),
  rekey: khash(key, label("grp-ch-rekey")),
});
// Everything a holder of K_e derives, once.
export const deriveEpoch = (key, groupId, epoch) => ({
  key,
  epoch,
  topic: groupTopic(key, groupId, epoch),
  msgKey: groupMsgKey(key),
  channels: groupChannels(key),
});

// ---------- AEAD ----------
export const aesGcmSeal = (key, nonce, plaintext, aad) => {
  const c = crypto.createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(nonce), { authTagLength: 16 });
  c.setAAD(Buffer.from(aad));
  return new Uint8Array(Buffer.concat([c.update(Buffer.from(plaintext)), c.final(), c.getAuthTag()]));
};
export const aesGcmOpen = (key, nonce, sealed, aad) => {
  if (sealed.length < 16) throw new Error("ciphertext shorter than the tag");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(nonce), { authTagLength: 16 });
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(sealed.subarray(sealed.length - 16)));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(sealed.subarray(0, sealed.length - 16))), d.final()]));
};

// variant: 0 messages, 1 state (the GroupData index byte).
export const sealAad = (signer, epoch, variant) => concat(label("grp"), toBytes(signer, 32, "signer"), u32(epoch), Uint8Array.of(variant));
export const seal = (msgKey, { signer, epoch, variant, plaintext, nonce = crypto.randomBytes(12) }) => ({
  nonce: new Uint8Array(nonce),
  ciphertext: aesGcmSeal(msgKey, nonce, plaintext, sealAad(signer, epoch, variant)),
});
export const open = (msgKey, { signer, epoch, variant, sealed }) =>
  aesGcmOpen(msgKey, sealed.nonce, sealed.ciphertext, sealAad(signer, epoch, variant));

// ---------- pairwise ----------
export const pairwiseSecret = (ownIdentityPrivateKey, peerIdentityPublicKey) =>
  x25519SharedSecret(toBytes(ownIdentityPrivateKey, 32, "identity private key"), toBytes(peerIdentityPublicKey, 32, "peer identity key"));
export const wrapKey = (kab, groupId, epoch) => khash(kab, concat(label("grp-wrap"), str(groupId), u32(epoch)));
export const entryHint = (wrap) => khash(wrap, label("grp-hint")).slice(0, 8);

export const makeRekeyEntry = (kab, { groupId, newEpoch, newKey, nonce = crypto.randomBytes(12) }) => {
  const wrap = wrapKey(kab, groupId, newEpoch);
  return { hint: entryHint(wrap), nonce: new Uint8Array(nonce), box: aesGcmSeal(wrap, nonce, toBytes(newKey, 32, "epoch key"), u32(newEpoch)) };
};
// The entry for the pair (admin, self), or null. A hint can collide (8
// bytes), so every entry with the hint is tried.
export const openRekeyEntry = (kab, { groupId, rekey }) => {
  const wrap = wrapKey(kab, groupId, rekey.newEpoch);
  const hint = Buffer.from(entryHint(wrap));
  for (const e of rekey.entries) {
    if (!hint.equals(Buffer.from(e.hint))) continue;
    try { return aesGcmOpen(wrap, e.nonce, e.box, u32(rekey.newEpoch)); } catch { /* a colliding hint */ }
  }
  return null;
};

export const joinProof = (inviteSecret, joinerAccount) =>
  khash(toBytes(inviteSecret, 16, "invite secret"), concat(label("grp-join"), toBytes(joinerAccount, 32, "joiner")));

// ---------- statement expiry ----------
// The base spec's Expiry rule with ExpirationTime = now + 14 days:
//   newExpiry = (now + 14 d) << 32 | (now − 1_763_164_800)
//   expiry    = max(previous + 1, newExpiry)
// The expiration rises with every submission, so a replacement on the same
// channel always wins; it is lower than a DM's u32.max, so a full account
// loses group statements before DMs.
export const GROUP_EXPIRY_SECS = 14 * 86_400;
const TIMESTAMP_OFFSET = 1_763_164_800;
export const groupExpiryFactory = ({ now = () => Date.now() } = {}) => {
  let last = 0n;
  return (attempt = 0) => {
    const secs = Math.floor(now() / 1000);
    const next = (BigInt(secs + GROUP_EXPIRY_SECS) << 32n) | BigInt(Math.max(0, secs - TIMESTAMP_OFFSET) + attempt);
    last = next > last ? next : last + 1n;
    return last;
  };
};
