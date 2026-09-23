import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chacha20Poly1305DecryptRawKey,
  chacha20Poly1305EncryptRawKey,
  decodeAccountEcdhKey,
  decodeStatementData,
  decodeOpaqueMessageAt,
  encodeAccountEcdhKey,
  encodeOpaqueDeviceAddedMessage,
  encodeOpaqueDeviceChatAcceptedMessage,
  encodeOpaqueTextMessage,
  encodeOpaqueRichTextMessage,
  encodeOpaqueReactionMessage,
  encodeOpaqueReplyMessage,
  encodeOpaqueEditedMessage,
  encodeOpaqueDeletedMessage,
  DELETED_CONTENT_KIND,
  encodeOpaqueButtonsMessage,
  encodeOpaqueButtonPressMessage,
  BUTTONS_CONTENT_KIND,
  BUTTON_PRESS_CONTENT_KIND,
  encodeOpaqueTypingMessage,
  encodeOpaqueSeenMessage,
  TYPING_CONTENT_KIND,
  SEEN_CONTENT_KIND,
  TYPING_KINDS,
  encodeOpaqueDataChannelClosedMessage,
  scaleEncodeBytes,
  x25519PublicKeyFromPrivateKey,
  x25519SharedSecret,
} from "../vendor/app-chat-codec.mjs";

const enc = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};
const str = (s) => scaleEncodeBytes(enc.encode(s));
const compact = (n) => {
  if (n < 64) return Uint8Array.of(n << 2);
  if (n < 16_384) {
    const encoded = (n << 2) | 1;
    return Uint8Array.of(encoded & 0xff, encoded >> 8);
  }
  const encoded = (n << 2) | 2;
  return Uint8Array.of(encoded & 0xff, (encoded >> 8) & 0xff, (encoded >> 16) & 0xff, (encoded >> 24) & 0xff);
};
const u32 = (n) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
const u64 = (n) => {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};
const decodeOne = (opaque) => decodeOpaqueMessageAt(opaque, 0).value;
const hex = (value) => new Uint8Array(Buffer.from(value, "hex"));
const hexOf = (value) => Buffer.from(value).toString("hex");

// Hand-build a remote message envelope the way the app does: SCALE(messageId,
// timestamp u64, version 0, contentKind, content), length-prefixed as opaque.
const opaqueMessage = (messageId, contentKind, content) =>
  scaleEncodeBytes(concat(str(messageId), u64(1_720_000_000_000), Uint8Array.of(0), Uint8Array.of(contentKind), content));

// FileVariant fixture matching the iOS app's P2PMixnetFile layout.
const fileVariant = ({ metaTag = 1, thumbnail = null } = {}) => concat(
  Uint8Array.of(0), // FileVariant tag: p2pMixnetFile
  scaleEncodeBytes(new Uint8Array(32).fill(7)),  // identifier
  scaleEncodeBytes(new Uint8Array(32).fill(9)),  // claimTicket
  Uint8Array.of(0), str("wss://hop.example"),    // node: wssUrl
  Uint8Array.of(metaTag), str("image/jpeg"), u32(245_123),
  ...(metaTag === 0 ? [] : [u32(1920), u32(1080)]), // width/height (image) or duration+pad (video handled below)
  ...(metaTag === 0 ? [] : [thumbnail ? concat(Uint8Array.of(1), scaleEncodeBytes(thumbnail)) : Uint8Array.of(0)]),
);

test("X25519 public key matches RFC 7748 section 6.1", () => {
  const privateKey = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
  assert.equal(
    hexOf(x25519PublicKeyFromPrivateKey(privateKey)),
    "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
  );
});

test("X25519 agreement matches RFC 7748 section 6.1", () => {
  const alicePrivate = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
  const bobPublic = hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
  assert.equal(
    hexOf(x25519SharedSecret(alicePrivate, bobPublic)),
    "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
  );
});

test("X25519 rejects every RFC004 small-order public key", () => {
  const privateKey = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
  for (const publicKey of [
    "00".repeat(32),
    `01${"00".repeat(31)}`,
    "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
    "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
  ]) {
    assert.throws(() => x25519SharedSecret(privateKey, hex(publicKey)), /X25519 agreement rejected/);
  }
});

test("ChaCha20-Poly1305 matches the RFC 8439 no-AAD vector", () => {
  const key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
  const nonce = hex("070000004041424344454647");
  const plaintext = hex(
    "4c616469657320616e642047656e746c656d656e206f662074686520636c6173" +
    "73206f66202739393a204966204920636f756c64206f6666657220796f75206f" +
    "6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73" +
    "637265656e20776f756c642062652069742e",
  );
  const ciphertext =
    "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6" +
    "3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36" +
    "92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc" +
    "3ff4def08e4b7a9de576d26586cec64b6116";
  const expected = `${hexOf(nonce)}${ciphertext}6a23a4681fd59456aea1d29f82477216`;
  const encrypted = chacha20Poly1305EncryptRawKey(key, plaintext, nonce);
  assert.equal(hexOf(encrypted), expected);
  assert.deepEqual(chacha20Poly1305DecryptRawKey(key, encrypted), plaintext);
  assert.equal(chacha20Poly1305EncryptRawKey(key, new Uint8Array(41)).length, 69);

  const tampered = encrypted.slice();
  tampered[12] ^= 1;
  assert.throws(() => chacha20Poly1305DecryptRawKey(key, tampered), /authenticate|state/i);
  assert.throws(() => chacha20Poly1305DecryptRawKey(key, encrypted.slice(0, -1)), /authenticate|state/i);
});

test("AccountEcdhKey X25519 container is 65 bytes and ignores padding", () => {
  const publicKey = new Uint8Array(32).fill(0xab);
  const encoded = encodeAccountEcdhKey(publicKey);
  assert.equal(hexOf(encoded), `00${"ab".repeat(32)}${"00".repeat(32)}`);
  encoded.fill(0x7f, 33);
  const decoded = decodeAccountEcdhKey(encoded);
  assert.equal(decoded.kind, "x25519");
  assert.deepEqual(decoded.publicKey, publicKey);
});

test("AccountEcdhKey rejects malformed widths and preserves unsupported containers", () => {
  const legacy = new Uint8Array(65).fill(0x11);
  legacy[0] = 0x04;
  const decoded = decodeAccountEcdhKey(legacy);
  assert.equal(decoded.kind, "unsupported");
  assert.deepEqual(decoded.raw, legacy);
  assert.deepEqual(encodeAccountEcdhKey(decoded), legacy);
  assert.throws(() => decodeAccountEcdhKey(new Uint8Array(33)), /must be 65 bytes/);
});

test("device lifecycle messages carry 32-byte X25519 public keys", () => {
  const statementAccountId = new Uint8Array(32).fill(0x22);
  const encryptionPublicKey = new Uint8Array(32).fill(0x33);
  const added = decodeOne(encodeOpaqueDeviceAddedMessage({ statementAccountId, encryptionPublicKey }));
  assert.equal(added.kind, "deviceAdded");
  assert.deepEqual(added.statementAccountId, statementAccountId);
  assert.deepEqual(added.encryptionPublicKey, encryptionPublicKey);

  const accepted = decodeOne(encodeOpaqueDeviceChatAcceptedMessage({
    acceptedRequestId: "REQ-1",
    statementAccountId,
    encryptionPublicKey,
  }));
  assert.equal(accepted.kind, "deviceChatAccepted");
  assert.deepEqual(accepted.statementAccountId, statementAccountId);
  assert.deepEqual(accepted.encryptionPublicKey, encryptionPublicKey);
});

test("round-trip: reaction add and remove", () => {
  for (const removed of [false, true]) {
    const m = decodeOne(encodeOpaqueReactionMessage({ targetMessageId: "TARGET-1", emoji: "🔥", removed }));
    assert.equal(m.kind, "reaction");
    assert.equal(m.removed, removed);
    assert.equal(m.targetMessageId, "TARGET-1");
    assert.equal(m.emoji, "🔥");
    assert.ok(m.messageId.length > 0);
  }
});

test("round-trip: reply carries quoted id and text", () => {
  const m = decodeOne(encodeOpaqueReplyMessage({ replyToMessageId: "QUOTED-9", text: "sure thing" }));
  assert.equal(m.kind, "reply");
  assert.equal(m.replyToMessageId, "QUOTED-9");
  assert.equal(m.text, "sure thing");
  assert.equal(m.richText.attachments, null);
});

test("round-trip: edited carries target id and new text", () => {
  const m = decodeOne(encodeOpaqueEditedMessage({ targetMessageId: "MSG-3", text: "fixed" }));
  assert.equal(m.kind, "edited");
  assert.equal(m.targetMessageId, "MSG-3");
  assert.equal(m.text, "fixed");
});

// RFC-0003: DeletedContent { messageId: UUID } is one SCALE string after the
// content byte, the same shape as the edit and reply targets. A fixed vector
// pins the layout a phone client would have to produce byte for byte.
test("deleted: byte vector matches the SCALE layout of an edit target", () => {
  const opaque = encodeOpaqueDeletedMessage({ messageId: "DEL-1", timestamp: 1_720_000_000_000, targetMessageId: "MSG-3" });
  assert.equal(
    hexOf(opaque),
    "58" // compact length of the remote message (22 bytes)
      + "14" + "44454c2d31" // messageId "DEL-1"
      + "0030fd7790010000" // timestamp u64 LE
      + "00" // version
      + "15" // content kind 21 (deleted)
      + "14" + "4d53472d33", // target "MSG-3"
  );
  assert.equal(hexOf(opaque), hexOf(opaqueMessage("DEL-1", DELETED_CONTENT_KIND, str("MSG-3"))));
});

test("round-trip: deleted carries its own id and the target id", () => {
  const m = decodeOne(encodeOpaqueDeletedMessage({ messageId: "DEL-2", targetMessageId: "MSG-9" }));
  assert.equal(m.kind, "deleted");
  assert.equal(m.messageId, "DEL-2");
  assert.equal(m.targetMessageId, "MSG-9");
});

// Index 20 is DeviceChatAccepted (mds.md). A deletion must never reuse it:
// every accept would then read as a deletion, and a deletion as a broken accept.
test("deleted does not collide with deviceChatAccepted", () => {
  assert.notEqual(DELETED_CONTENT_KIND, 20);
  const accept = decodeOne(encodeOpaqueDeviceChatAcceptedMessage({
    acceptedRequestId: "REQ-1",
    statementAccountId: new Uint8Array(32).fill(1),
    encryptionPublicKey: x25519PublicKeyFromPrivateKey(new Uint8Array(32).fill(3)),
  }));
  assert.equal(accept.kind, "deviceChatAccepted");
  assert.throws(() => encodeOpaqueDeletedMessage({ targetMessageId: "" }), /target message id/);
});

// Spec 0006 buttons. These two vectors are published to the desktop client
// in polkadot-chat-desktop docs/spec/vectors-0006.md; the desktop codec must
// decode them byte for byte, so a change here is a wire break, not a refactor.
const BUTTONS_VECTOR = "45011442544e2d310030fd779001000000f2205069636b206f6e650808104563686f001c6563686f20686918436f6c6f7572010801020410446f6373025068747470733a2f2f706f6c6b61646f742e636f6d00";
const BUTTON_PRESS_VECTOR = "6c145052532d31e833fd779001000000f31442544e2d310001080102";
const vectorRows = [
  [{ label: "Echo", action: { command: "echo hi" } }, { label: "Colour", action: { callback: Uint8Array.of(1, 2) } }],
  [{ label: "Docs", action: { url: "https://polkadot.com" } }],
];

test("buttons: pinned vector A matches the spec 0006 SCALE layout", () => {
  const opaque = encodeOpaqueButtonsMessage({ messageId: "BTN-1", timestamp: 1_720_000_000_000, text: "Pick one", rows: vectorRows, oneShot: false });
  assert.equal(hexOf(opaque), BUTTONS_VECTOR);
  // The same bytes built by hand from the spec: text, Vec<Vec<Button>>, bool.
  const button = (label, tag, value) => concat(str(label), Uint8Array.of(tag), value);
  const content = concat(
    str("Pick one"),
    compact(2),
    compact(2), button("Echo", 0, str("echo hi")), button("Colour", 1, scaleEncodeBytes(Uint8Array.of(1, 2))),
    compact(1), button("Docs", 2, str("https://polkadot.com")),
    Uint8Array.of(0),
  );
  assert.equal(BUTTONS_CONTENT_KIND, 242);
  assert.equal(hexOf(opaque), hexOf(opaqueMessage("BTN-1", 242, content)));
  const m = decodeOne(hex(BUTTONS_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, text: m.text, rows: m.rows, oneShot: m.oneShot },
    { kind: "buttons", messageId: "BTN-1", timestamp: 1_720_000_000_000, text: "Pick one", rows: vectorRows, oneShot: false },
  );
});

test("buttonPress: pinned vector B matches the spec 0006 SCALE layout", () => {
  const opaque = encodeOpaqueButtonPressMessage({ messageId: "PRS-1", timestamp: 1_720_000_001_000, targetMessageId: "BTN-1", row: 0, index: 1, payload: Uint8Array.of(1, 2) });
  assert.equal(hexOf(opaque), BUTTON_PRESS_VECTOR);
  assert.equal(BUTTON_PRESS_CONTENT_KIND, 243);
  const m = decodeOne(hex(BUTTON_PRESS_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, targetMessageId: m.targetMessageId, row: m.row, index: m.index, payload: m.payload },
    { kind: "buttonPress", messageId: "PRS-1", timestamp: 1_720_000_001_000, targetMessageId: "BTN-1", row: 0, index: 1, payload: Uint8Array.of(1, 2) },
  );
});

test("round-trip: buttons with oneShot, an opaque tx action, and an empty press payload", () => {
  const rows = [[{ label: "Sign", action: { tx: Uint8Array.of(9, 9, 9) } }]];
  const m = decodeOne(encodeOpaqueButtonsMessage({ messageId: "B-2", text: "", rows, oneShot: true }));
  assert.deepEqual([m.kind, m.text, m.rows, m.oneShot], ["buttons", "", rows, true]);
  const p = decodeOne(encodeOpaqueButtonPressMessage({ targetMessageId: "B-2", row: 7, index: 3 }));
  assert.deepEqual([p.kind, p.targetMessageId, p.row, p.index, p.payload.length], ["buttonPress", "B-2", 7, 3, 0]);
});

// The limits are the anti-abuse guards of spec 0006 (Drawbacks): the encoder
// refuses to build what a client should never have to render.
test("buttons encoder enforces rows, row width, label and callback limits", () => {
  const b = (label = "ok", action = { command: "x" }) => ({ label, action });
  const enc9 = () => encodeOpaqueButtonsMessage({ text: "t", rows: Array.from({ length: 9 }, () => [b()]) });
  assert.throws(enc9, /1 to 8 rows/);
  assert.throws(() => encodeOpaqueButtonsMessage({ text: "t", rows: [[b(), b(), b(), b(), b()]] }), /1 to 4 buttons/);
  assert.throws(() => encodeOpaqueButtonsMessage({ text: "t", rows: [[b("x".repeat(41))]] }), /label/);
  assert.doesNotThrow(() => encodeOpaqueButtonsMessage({ text: "t", rows: [[b("é".repeat(40))]] }));
  assert.throws(() => encodeOpaqueButtonsMessage({ text: "t", rows: [[b("ok", { callback: new Uint8Array(257) })]] }), /256 bytes/);
  assert.throws(() => encodeOpaqueButtonsMessage({ text: "t", rows: [[b("ok", { pay: "x" })]] }), /one of command/);
  assert.throws(() => encodeOpaqueButtonPressMessage({ targetMessageId: "B", row: 256, index: 0 }), /u8/);
});

// A decoder bound: 9 rows on the wire is undecodable, and an unknown action
// tag has no length, so the message is undecodable too; neither may break
// the next message in the batch.
test("buttons decoder rejects over-limit rows and unknown action tags", () => {
  const row = concat(compact(1), str("a"), Uint8Array.of(0), str("x"));
  const nine = opaqueMessage("B-9", 242, concat(str("t"), compact(9), ...Array.from({ length: 9 }, () => row), Uint8Array.of(0)));
  assert.equal(decodeOne(nine).kind, "undecodable");
  const unknown = opaqueMessage("B-U", 242, concat(str("t"), compact(1), compact(1), str("a"), Uint8Array.of(4), str("x"), Uint8Array.of(0)));
  assert.match(decodeOne(unknown).error, /unknown button action 4/);
});

// Spec 0005 typing and seen. Published to the desktop client in
// polkadot-chat-desktop docs/spec/vectors-0005.md: a change here is a wire
// break, not a refactor.
const TYPING_VECTOR = "64145459502d310030fd779001000000f07047fd779001000001";
const SEEN_VECTOR = "781453454e2d31d037fd779001000000f1144d53472d33d037fd7790010000";

test("typing: pinned vector matches the spec 0005 SCALE layout", () => {
  const opaque = encodeOpaqueTypingMessage({ messageId: "TYP-1", timestamp: 1_720_000_000_000, until: 1_720_000_006_000, kind: TYPING_KINDS.working });
  assert.equal(hexOf(opaque), TYPING_VECTOR);
  assert.equal(TYPING_CONTENT_KIND, 240);
  // By hand: until u64 LE, then kind u8.
  assert.equal(hexOf(opaque), hexOf(opaqueMessage("TYP-1", 240, concat(u64(1_720_000_006_000), Uint8Array.of(1)))));
  const m = decodeOne(hex(TYPING_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, until: m.until, typingKind: m.typingKind },
    { kind: "typing", messageId: "TYP-1", timestamp: 1_720_000_000_000, until: 1_720_000_006_000, typingKind: 1 },
  );
});

test("seen: pinned vector matches the spec 0005 SCALE layout", () => {
  const opaque = encodeOpaqueSeenMessage({ messageId: "SEN-1", timestamp: 1_720_000_002_000, upTo: "MSG-3", at: 1_720_000_002_000 });
  assert.equal(hexOf(opaque), SEEN_VECTOR);
  assert.equal(SEEN_CONTENT_KIND, 241);
  const content = concat(str("MSG-3"), u64(1_720_000_002_000));
  assert.equal(hexOf(opaque), hexOf(scaleEncodeBytes(concat(str("SEN-1"), u64(1_720_000_002_000), Uint8Array.of(0), Uint8Array.of(241), content))));
  const m = decodeOne(hex(SEEN_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, upTo: m.upTo, at: m.at },
    { kind: "seen", messageId: "SEN-1", timestamp: 1_720_000_002_000, upTo: "MSG-3", at: 1_720_000_002_000 },
  );
});

test("round-trip: every typing kind and a seen with a UUID target", () => {
  for (const kind of [0, 1, 2]) {
    const m = decodeOne(encodeOpaqueTypingMessage({ until: 123_456, kind }));
    assert.deepEqual([m.kind, m.until, m.typingKind], ["typing", 123_456, kind]);
  }
  const upTo = globalThis.crypto.randomUUID().toUpperCase();
  const s = decodeOne(encodeOpaqueSeenMessage({ upTo, at: 99n }));
  assert.deepEqual([s.kind, s.upTo, s.at], ["seen", upTo, 99]);
});

test("typing and seen encoders refuse values the spec does not define", () => {
  assert.throws(() => encodeOpaqueTypingMessage({ until: 1, kind: 3 }), /typing kind/);
  assert.throws(() => encodeOpaqueTypingMessage({ until: -1, kind: 0 }), /u64/);
  assert.throws(() => encodeOpaqueSeenMessage({ upTo: "", at: 1 }), /upTo/);
  // A truncated typing (no kind byte) makes only that message undecodable.
  const truncated = decodeOne(scaleEncodeBytes(hex(TYPING_VECTOR.slice(2, -2))));
  assert.equal(truncated.kind, "undecodable");
});

test("round-trip: dataChannelClosed carries offerId", () => {
  const m = decodeOne(encodeOpaqueDataChannelClosedMessage({ offerId: "OFFER-5" }));
  assert.equal(m.kind, "dataChannelClosed");
  assert.equal(m.offerId, "OFFER-5");
});

test("round-trip: plain text still decodes", () => {
  const m = decodeOne(encodeOpaqueTextMessage({ text: "hello" }));
  assert.equal(m.kind, "text");
  assert.equal(m.text, "hello");
});

test("round-trip: outgoing richText carries a general file attachment", () => {
  const m = decodeOne(encodeOpaqueRichTextMessage({
    text: "report.txt",
    attachments: [{
      identifier: new Uint8Array(32).fill(7),
      claimTicket: new Uint8Array(32).fill(9),
      wssUrl: "wss://hop.example",
      mime: "text/plain",
      size: 42,
      fileKind: "general",
    }],
  }));
  assert.equal(m.kind, "richText");
  assert.equal(m.text, "report.txt");
  const [attachment] = m.richText.attachments;
  assert.equal(attachment.fileKind, "general");
  assert.equal(attachment.mimeType, "text/plain");
  assert.equal(attachment.fileSize, 42);
  assert.equal(attachment.wssUrl, "wss://hop.example");
  assert.deepEqual([...attachment.identifier], Array(32).fill(7));
  assert.deepEqual([...attachment.claimTicket], Array(32).fill(9));
});

test("richText with image attachment decodes every field", () => {
  const richText = concat(
    Uint8Array.of(1), str("look at this"),          // text: Some
    Uint8Array.of(1), Uint8Array.of(4), fileVariant(), // attachments: Some, Vec len 1
  );
  const m = decodeOne(opaqueMessage("MSG-IMG", 15, richText));
  assert.equal(m.kind, "richText");
  assert.equal(m.text, "look at this");
  const [a] = m.richText.attachments;
  assert.equal(a.kind, "p2pMixnetFile");
  assert.equal(a.fileKind, "image");
  assert.equal(a.identifierHex, "07".repeat(32));
  assert.deepEqual([...a.claimTicket], Array(32).fill(9));
  assert.equal(a.wssUrl, "wss://hop.example");
  assert.equal(a.mimeType, "image/jpeg");
  assert.equal(a.fileSize, 245_123);
  assert.equal(a.width, 1920);
  assert.equal(a.height, 1080);
  assert.equal(a.thumbnail, null);
});

test("caption-less attachment (text None) decodes with empty text", () => {
  const richText = concat(Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(4), fileVariant());
  const m = decodeOne(opaqueMessage("MSG-NOCAP", 15, richText));
  assert.equal(m.kind, "richText");
  assert.equal(m.text, "");
  assert.equal(m.richText.attachments.length, 1);
});

test("general file meta decodes without dimensions", () => {
  const richText = concat(Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(4), fileVariant({ metaTag: 0 }));
  const m = decodeOne(opaqueMessage("MSG-FILE", 15, richText));
  const [a] = m.richText.attachments;
  assert.equal(a.fileKind, "general");
  assert.equal(a.width, undefined);
});

test("inline thumbnail bytes survive decoding", () => {
  const thumb = Uint8Array.of(1, 2, 3, 4, 5);
  const richText = concat(Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(4), fileVariant({ thumbnail: thumb }));
  const m = decodeOne(opaqueMessage("MSG-THUMB", 15, richText));
  assert.deepEqual([...m.richText.attachments[0].thumbnail], [...thumb]);
});

test("reply with attachment carries it through the nested richText", () => {
  const richText = concat(Uint8Array.of(1), str("re: photo"), Uint8Array.of(1), Uint8Array.of(4), fileVariant());
  const m = decodeOne(opaqueMessage("MSG-REPLY-IMG", 7, concat(str("QUOTED-1"), richText)));
  assert.equal(m.kind, "reply");
  assert.equal(m.richText.attachments[0].fileKind, "image");
});

test("unknown FileVariant tag makes only that message undecodable", () => {
  const richText = concat(Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(4), Uint8Array.of(9), u32(0));
  const m = decodeOne(opaqueMessage("MSG-BADTAG", 15, richText));
  assert.equal(m.kind, "undecodable");
  assert.match(m.error, /FileVariant tag 9/);
});

test("the legacy poison fixture still fails strict decode, sibling text survives", () => {
  // Byte-for-byte what test-client-device.mjs sends: attachments Some, len 1,
  // then 4 junk bytes that truncate mid-FileVariant.
  const poison = opaqueMessage("MSG-POISON", 15, concat(
    Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(4), Uint8Array.of(0, 0, 0, 0),
  ));
  const text = encodeOpaqueTextMessage({ text: "still here" });
  const batch = concat(poison, text);
  const first = decodeOpaqueMessageAt(batch, 0);
  assert.equal(first.value.kind, "undecodable");
  const second = decodeOpaqueMessageAt(batch, first.offset);
  assert.equal(second.value.kind, "text");
  assert.equal(second.value.text, "still here");
});

test("declared vectors are capped before decoding their entries", () => {
  const oversized = 100_000;

  const request = concat(Uint8Array.of(0), str("REQ-OVERSIZED"), compact(oversized));
  assert.throws(() => decodeStatementData(request), /message batch exceeds maximum/);

  const envelope = concat(Uint8Array.of(2), scaleEncodeBytes(new Uint8Array(0)), compact(oversized));
  assert.throws(() => decodeStatementData(envelope), /multi-device entries exceeds maximum/);

  const oversizedAttachments = concat(Uint8Array.of(0), Uint8Array.of(1), compact(oversized));
  const attachmentMessage = decodeOne(opaqueMessage("MSG-OVERSIZED-ATTACHMENTS", 15, oversizedAttachments));
  assert.equal(attachmentMessage.kind, "undecodable");
  assert.match(attachmentMessage.error, /attachments exceeds maximum/);

  const oversizedCoins = decodeOne(opaqueMessage("MSG-OVERSIZED-COINS", 16, concat(Uint8Array.of(0), compact(oversized))));
  assert.equal(oversizedCoins.kind, "undecodable");
  assert.match(oversizedCoins.error, /coin keys exceeds maximum/);
});

test("nested vectors share an aggregate decode budget", () => {
  const coinKeys = new Uint8Array(256); // 256 SCALE-encoded empty byte strings
  const coinMessage = opaqueMessage("MSG-COIN-BUDGET", 16, concat(Uint8Array.of(0), compact(256), coinKeys));
  const request = concat(Uint8Array.of(0), str("REQ-BUDGET"), compact(4), coinMessage, coinMessage, coinMessage, coinMessage);
  const decoded = decodeStatementData(request);

  assert.equal(decoded.messages[0].kind, "coinageSend");
  assert.equal(decoded.messages[1].kind, "coinageSend");
  assert.equal(decoded.messages[2].kind, "coinageSend");
  assert.equal(decoded.messages[3].kind, "undecodable");
  assert.match(decoded.messages[3].error, /aggregate maximum/);
});

test("truncated compact vector lengths are rejected", () => {
  const request = concat(Uint8Array.of(0), str("REQ-TRUNCATED"), Uint8Array.of(0x01));
  assert.throws(() => decodeStatementData(request), /Truncated SCALE compact value/);
});

test("hostile text and identifier fields are byte-capped before persistence", () => {
  const oversizedId = decodeOne(opaqueMessage("I".repeat(257), 0, str("hello")));
  assert.equal(oversizedId.kind, "undecodable");
  assert.match(oversizedId.error, /message id exceeds maximum/);

  const oversizedText = decodeOne(opaqueMessage("MSG-BIG-TEXT", 0, str("x".repeat(64 * 1024 + 1))));
  assert.equal(oversizedText.kind, "undecodable");
  assert.match(oversizedText.error, /SCALE string exceeds maximum/);

  const badAttachment = concat(
    Uint8Array.of(0),
    scaleEncodeBytes(new Uint8Array(33)),
    scaleEncodeBytes(new Uint8Array(32)),
  );
  const richText = concat(Uint8Array.of(0), Uint8Array.of(1), Uint8Array.of(4), badAttachment);
  const decoded = decodeOne(opaqueMessage("MSG-BAD-ATTACHMENT", 15, richText));
  assert.equal(decoded.kind, "undecodable");
  assert.match(decoded.error, /attachment identifier/);
});

test("contactAdded and leftChat decode as bare events", () => {
  assert.equal(decodeOne(opaqueMessage("MSG-CA", 3, new Uint8Array(0))).kind, "contactAdded");
  assert.equal(decodeOne(opaqueMessage("MSG-LC", 13, new Uint8Array(0))).kind, "leftChat");
});

test("dataChannelOffer surfaces purpose and sdp length only", () => {
  const sdp = enc.encode("v=0 fake sdp");
  const m = decodeOne(opaqueMessage("MSG-OFFER", 8, concat(scaleEncodeBytes(sdp), Uint8Array.of(1))));
  assert.equal(m.kind, "dataChannelOffer");
  assert.equal(m.purpose, 1);
  assert.equal(m.sdpLength, sdp.length);
  assert.equal(m.sdp, undefined);
});
