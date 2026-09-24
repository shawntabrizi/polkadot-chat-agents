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
  encodeOpaqueBotInfoMessage,
  BOT_INFO_CONTENT_KIND,
  encodeTxIntent,
  decodeTxIntent,
  encodeOpaqueTransactionReferenceMessage,
  TRANSACTION_REFERENCE_CONTENT_KIND,
  encodeOpaqueDataChannelClosedMessage,
  encodeOpaqueGroupInfoMessage,
  encodeOpaqueGroupMessage,
  encodeOpaqueGroupLeaveMessage,
  GROUP_INFO_CONTENT_KIND,
  GROUP_MESSAGE_CONTENT_KIND,
  GROUP_LEAVE_CONTENT_KIND,
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

// Spec 0008 bot info. This vector is published to the desktop client in
// polkadot-chat-desktop docs/spec/vectors-0008.md; a change here is a wire
// break, not a refactor.
const BOT_INFO_VECTOR = "010214424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b730100";
const vectorBotInfo = {
  kind: 1,
  name: "Guide",
  description: "Polkadot support guide",
  greeting: "Hi! Ask me about Polkadot.",
  commands: [{ name: "staking", description: "Staking basics" }, { name: "governance", description: "How OpenGov works" }],
  version: 1,
};

test("botInfo: pinned vector matches the spec 0008 SCALE layout", () => {
  const opaque = encodeOpaqueBotInfoMessage({ messageId: "BOT-1", timestamp: 1_720_000_000_000, ...vectorBotInfo });
  assert.equal(hexOf(opaque), BOT_INFO_VECTOR);
  // The same bytes built by hand from the spec: u8, 3 strings, Vec<Command>, u16 LE.
  const content = concat(
    Uint8Array.of(1),
    str("Guide"), str("Polkadot support guide"), str("Hi! Ask me about Polkadot."),
    compact(2), str("staking"), str("Staking basics"), str("governance"), str("How OpenGov works"),
    Uint8Array.of(1, 0),
  );
  assert.equal(BOT_INFO_CONTENT_KIND, 244);
  assert.equal(hexOf(opaque), hexOf(opaqueMessage("BOT-1", 244, content)));
  const m = decodeOne(hex(BOT_INFO_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, botKind: m.botKind, name: m.name, description: m.description, greeting: m.greeting, commands: m.commands, version: m.version },
    { kind: "botInfo", messageId: "BOT-1", timestamp: 1_720_000_000_000, botKind: 1, name: vectorBotInfo.name, description: vectorBotInfo.description, greeting: vectorBotInfo.greeting, commands: vectorBotInfo.commands, version: 1 },
  );
});

// version is u16 little-endian: 0x0102 must go out as 02 01, or a client
// comparing versions ("latest wins") would order updates wrongly.
test("round-trip: botInfo with no commands, empty strings and a two-byte version", () => {
  const opaque = encodeOpaqueBotInfoMessage({ kind: 0, name: "Echo", commands: [], version: 0x0102 });
  assert.equal(hexOf(opaque.subarray(-3)), "000201", "empty command vector, then version 0x0102 LE");
  const m = decodeOne(opaque);
  assert.deepEqual([m.kind, m.botKind, m.name, m.description, m.greeting, m.commands, m.version], ["botInfo", 0, "Echo", "", "", [], 0x0102]);
});

// The spec limits (name 40, description/greeting 280, 32 commands, command
// name 32 without a slash, command description 80): the encoder refuses to
// build what a client should never have to render.
test("botInfo encoder enforces the spec 0008 limits", () => {
  const base = { kind: 1, name: "Bot", version: 1 };
  const cmd = (name, description = "d") => ({ name, description });
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, kind: 3 }), /kind/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, name: "" }), /name/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, name: "x".repeat(41) }), /name/);
  assert.doesNotThrow(() => encodeOpaqueBotInfoMessage({ ...base, name: "é".repeat(40) }));
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, description: "x".repeat(281) }), /description/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, greeting: "x".repeat(281) }), /greeting/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, commands: Array.from({ length: 33 }, (_, i) => cmd(`c${i}`)) }), /32 commands/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, commands: [cmd("/help")] }), /no slash/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, commands: [cmd("x".repeat(33))] }), /command name/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, commands: [cmd("ok", "x".repeat(81))] }), /command description/);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...base, version: 65536 }), /u16/);
});

// Spec 0008 v2: the optional balance hint. This vector is published to the
// desktop client in polkadot-chat-desktop docs/spec/vectors-0008b.md: the
// client reads `contract.selector(caller)` from these bytes to show "your
// balance with this bot", so a change here is a wire break.
const BOT_INFO_BALANCE_VECTOR = "010414424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b7301000109013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d65746572";
const vectorBalance = {
  chainId: "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
  contract: "0x30b0c001431a1addb8c11a060ada4d6a7033cf21",
  selector: "0x70a08231", // keccak("balanceOf(address)")[0..4]
  decimals: 18,
  unit: "PAS",
  perReply: 100_000_000_000_000_000n, // 0.1 PAS in the contract's 1e18 scale
  label: "with Meter",
};

test("botInfo v2: pinned balance-hint vector matches the spec 0008 v2 SCALE layout", () => {
  const opaque = encodeOpaqueBotInfoMessage({ messageId: "BOT-1", timestamp: 1_720_000_000_000, ...vectorBotInfo, balance: vectorBalance });
  assert.equal(hexOf(opaque), BOT_INFO_BALANCE_VECTOR);
  // By hand: the v1 content, then Some(BalanceHint).
  const u128le = (v) => Uint8Array.from({ length: 16 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
  const content = concat(
    Uint8Array.of(1),
    str("Guide"), str("Polkadot support guide"), str("Hi! Ask me about Polkadot."),
    compact(2), str("staking"), str("Staking basics"), str("governance"), str("How OpenGov works"),
    Uint8Array.of(1, 0),
    Uint8Array.of(1), // Some
    str(vectorBalance.chainId),
    compact(20), hex(vectorBalance.contract.slice(2)),
    compact(4), hex(vectorBalance.selector.slice(2)),
    Uint8Array.of(18),
    str("PAS"),
    Uint8Array.of(1), u128le(vectorBalance.perReply),
    str("with Meter"),
  );
  assert.equal(hexOf(opaque), hexOf(opaqueMessage("BOT-1", 244, content)));
  const m = decodeOne(hex(BOT_INFO_BALANCE_VECTOR));
  assert.equal(m.kind, "botInfo");
  assert.equal(m.version, 1);
  assert.deepEqual(
    { ...m.balance, contract: `0x${hexOf(m.balance.contract)}`, selector: `0x${hexOf(m.balance.selector)}` },
    { ...vectorBalance, pending: null }, // v3: a v2 hint reads as pending null (0)
  );
});

// Spec 0008 v3: `pending` appended to the hint, published in
// polkadot-chat-desktop docs/spec/vectors-0008c.md. The client shows
// balance - pending, the same number as the bot's /balance, so a change here
// is a wire break.
const BOT_INFO_PENDING_VECTOR = "450414424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b7301000109013078643665656332363133353330356138616432353761323064303033333537323834633861613033643062646232623335376162306132323337316531316566325030b0c001431a1addb8c11a060ada4d6a7033cf211070a08231120c5041530100008a5d7845630100000000000000002877697468204d657465720100009e1869d029040000000000000000";
const PENDING = 300_000_000_000_000_000n; // 0.3 PAS in the hint's 1e18 unit (3e9 plancks x NativeToEthRatio 1e8)

test("botInfo v3: pinned pending vector is the v2 vector plus Some(u128) after the label", () => {
  const opaque = encodeOpaqueBotInfoMessage({ messageId: "BOT-1", timestamp: 1_720_000_000_000, ...vectorBotInfo, balance: { ...vectorBalance, pending: PENDING } });
  assert.equal(hexOf(opaque), BOT_INFO_PENDING_VECTOR);
  // The remote message is the v2 one with 17 bytes appended; only the outer
  // compact length changes (256 -> 273).
  const v2Remote = BOT_INFO_BALANCE_VECTOR.slice(4);
  assert.equal(BOT_INFO_PENDING_VECTOR.slice(0, 4), "4504");
  assert.equal(BOT_INFO_PENDING_VECTOR.slice(4), `${v2Remote}01${"00009e1869d029040000000000000000"}`);
  const m = decodeOne(hex(BOT_INFO_PENDING_VECTOR));
  assert.equal(m.kind, "botInfo");
  assert.equal(m.balance.pending, PENDING);
  assert.equal(m.balance.label, "with Meter");
});

// Compatibility both ways: a v2 hint keeps its bytes (pending null writes
// nothing), pending 0 is sent as Some(0) (the bot's "charged, nothing owed"),
// and an explicit None byte reads as null. A v2 pca decoder stopped at the
// label, so the appended field never reached it.
test("botInfo v3: pending null keeps the v2 bytes; Some(0) and None round-trip", () => {
  const at = { messageId: "BOT-1", timestamp: 1_720_000_000_000, ...vectorBotInfo };
  assert.equal(hexOf(encodeOpaqueBotInfoMessage({ ...at, balance: { ...vectorBalance, pending: null } })), BOT_INFO_BALANCE_VECTOR);
  const zero = encodeOpaqueBotInfoMessage({ ...at, balance: { ...vectorBalance, pending: 0n } });
  assert.ok(hexOf(zero).endsWith(`77697468204d6574657201${"00".repeat(16)}`));
  assert.equal(decodeOne(zero).balance.pending, 0n);
  const none = concat(hex(BOT_INFO_BALANCE_VECTOR.slice(4)), Uint8Array.of(0));
  const m = decodeOne(concat(compact(none.length), none));
  assert.equal(m.kind, "botInfo");
  assert.equal(m.balance.pending, null);
  assert.throws(() => encodeOpaqueBotInfoMessage({ ...at, balance: { ...vectorBalance, pending: -1n } }), /pending/);
  // A bad option tag after the label is undecodable, alone in its batch.
  const bad = concat(hex(BOT_INFO_BALANCE_VECTOR.slice(4)), Uint8Array.of(7));
  assert.equal(decodeOne(concat(compact(bad.length), bad)).kind, "undecodable");
});

// The compatibility rule of v2: bytes from a v1 encoder (they end after
// `version`) decode with balance = null, and a document without a hint keeps
// its v1 bytes, so vectors-0008 still holds for a v2 encoder.
test("botInfo v2: v1 bytes decode with balance null; no hint keeps the v1 bytes", () => {
  assert.equal(decodeOne(hex(BOT_INFO_VECTOR)).balance, null);
  const withoutHint = encodeOpaqueBotInfoMessage({ messageId: "BOT-1", timestamp: 1_720_000_000_000, ...vectorBotInfo, balance: null });
  assert.equal(hexOf(withoutHint), BOT_INFO_VECTOR);
  // An explicit None byte (a canonical-SCALE encoder) is also balance = null.
  const content = concat(Uint8Array.of(0), str("B"), str(""), str(""), compact(0), Uint8Array.of(1, 0), Uint8Array.of(0));
  const m = decodeOne(opaqueMessage("BOT-N", 244, content));
  assert.equal(m.kind, "botInfo");
  assert.equal(m.balance, null);
});

test("round-trip: botInfo balance hint without perReply (a stake, not a price)", () => {
  const balance = { ...vectorBalance, selector: "0x42623360", perReply: null, label: "your stake" };
  const m = decodeOne(encodeOpaqueBotInfoMessage({ kind: 0, name: "Coin Flip", version: 3, balance }));
  assert.equal(m.version, 3);
  assert.equal(m.balance.perReply, null);
  assert.equal(m.balance.label, "your stake");
  assert.equal(hexOf(m.balance.selector), "42623360");
});

// A hint the client could not use (wrong address or selector size, no
// label) is refused at the source, not rendered as a broken header.
test("botInfo encoder enforces the balance hint shape", () => {
  const base = { kind: 0, name: "Bot", version: 1 };
  const bad = (patch) => () => encodeOpaqueBotInfoMessage({ ...base, balance: { ...vectorBalance, ...patch } });
  assert.throws(bad({ contract: "0x1234" }), /20 bytes/);
  assert.throws(bad({ selector: "0x70a0823100" }), /4 bytes/);
  assert.throws(bad({ decimals: 256 }), /u8/);
  assert.throws(bad({ label: "" }), /label/);
  assert.throws(bad({ label: "x".repeat(41) }), /label/);
  assert.throws(bad({ unit: "" }), /unit/);
  assert.throws(bad({ chainId: "" }), /chainId/);
  assert.throws(bad({ perReply: -1n }), /u128/);
  // A malformed option tag after the version is undecodable, alone in its batch.
  const content = concat(Uint8Array.of(0), str("B"), str(""), str(""), compact(0), Uint8Array.of(1, 0), Uint8Array.of(7));
  assert.equal(decodeOne(opaqueMessage("BOT-X", 244, content)).kind, "undecodable");
});

// A decoder bound: 33 commands on the wire is undecodable, and must not
// break the next message in the batch (the batch-decoding invariant).
test("botInfo decoder rejects more than 32 commands", () => {
  const commands = Array.from({ length: 33 }, () => concat(str("c"), str("")));
  const over = opaqueMessage("BOT-33", 244, concat(Uint8Array.of(0), str("B"), str(""), str(""), compact(33), ...commands, Uint8Array.of(1, 0)));
  assert.equal(decodeOne(over).kind, "undecodable");
});

// Spec 0007 transactions. These two vectors are published to the desktop
// client in polkadot-chat-desktop docs/spec/vectors-0007.md: the desktop
// signer decodes the intent it dry-runs and signs from these bytes, so a
// change here is a wire break, not a refactor.
const TX_CHAIN_ID = `0x${"00".repeat(32)}`;
const TX_INTENT_VECTOR = "01090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303004010150111111111111111111111111111111111111111110deadbeef00e40b5402000000000000000000000000000018546f702075702841646473203120504153010431010c50415301601afe7790010000";
const TX_BUTTONS_VECTOR = `35031054582d310030fd779001000000f248546f7020757020746f20636f6e74696e7565040430546f70207570203120504153036102${TX_INTENT_VECTOR}00`;
const TX_REFERENCE_VECTOR = "4502145245462d311057fd779001000000f5090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303080222222222222222222222222222222222222222222222222222222222222222201017b0000003c546f702d7570206f66203120504153011054582d31";
const vectorIntent = {
  chainId: TX_CHAIN_ID,
  calls: [{ kind: 1, to: `0x${"11".repeat(20)}`, data: "0xdeadbeef", value: 10_000_000_000n }],
  display: { title: "Top up", description: "Adds 1 PAS", amount: "1", asset: "PAS" },
  dryRunRequired: true,
  expiresAt: 1_720_000_060_000,
};
const u128 = (n) => { const out = new Uint8Array(16); let v = BigInt(n); for (let i = 0; i < 16; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; } return out; };

test("tx intent: pinned vector matches the spec 0007 SCALE layout", () => {
  const bytes = encodeTxIntent(vectorIntent);
  assert.equal(hexOf(bytes), TX_INTENT_VECTOR);
  // By hand: version, chainId String, Vec<Call>, Display, bool, u64 LE.
  const call = concat(
    Uint8Array.of(1),                                              // kind 1: Revive
    Uint8Array.of(1), scaleEncodeBytes(new Uint8Array(20).fill(0x11)), // to: Some(20 bytes)
    scaleEncodeBytes(hex("deadbeef")),                             // data
    u128(10_000_000_000n),                                         // value u128 LE (1 PAS)
    Uint8Array.of(0, 0, 0),                                        // gasRefTime, gasProofSize, storageDepositLimit: None
  );
  const byHand = concat(
    Uint8Array.of(1), str(TX_CHAIN_ID), compact(1), call,
    str("Top up"), str("Adds 1 PAS"), Uint8Array.of(1), str("1"), Uint8Array.of(1), str("PAS"),
    Uint8Array.of(1), u64(1_720_000_060_000),
  );
  assert.equal(hexOf(bytes), hexOf(byHand));
  const d = decodeTxIntent(hex(TX_INTENT_VECTOR));
  assert.deepEqual(d, {
    version: 1,
    chainId: TX_CHAIN_ID,
    calls: [{ kind: 1, to: new Uint8Array(20).fill(0x11), data: hex("deadbeef"), value: 10_000_000_000n, gasRefTime: null, gasProofSize: null, storageDepositLimit: null }],
    display: { title: "Top up", description: "Adds 1 PAS", amount: "1", asset: "PAS" },
    dryRunRequired: true,
    expiresAt: 1_720_000_060_000n,
  });
});

test("buttons with a tx action: pinned vector A of spec 0007", () => {
  const opaque = encodeOpaqueButtonsMessage({ messageId: "TX-1", timestamp: 1_720_000_000_000, text: "Top up to continue", rows: [[{ label: "Top up 1 PAS", action: { tx: vectorIntent } }]], oneShot: false });
  assert.equal(hexOf(opaque), TX_BUTTONS_VECTOR);
  const m = decodeOne(hex(TX_BUTTONS_VECTOR));
  assert.equal(m.kind, "buttons");
  assert.equal(m.rows[0][0].label, "Top up 1 PAS");
  assert.equal(hexOf(m.rows[0][0].action.tx), TX_INTENT_VECTOR, "the action carries the intent bytes, length-prefixed");
  assert.equal(decodeTxIntent(m.rows[0][0].action.tx).calls[0].value, 10_000_000_000n);
});

test("transactionReference: pinned vector B of spec 0007", () => {
  const opaque = encodeOpaqueTransactionReferenceMessage({ messageId: "REF-1", timestamp: 1_720_000_010_000, chainId: TX_CHAIN_ID, hash: `0x${"22".repeat(32)}`, status: 1, block: 123, note: "Top-up of 1 PAS", intentMessageId: "TX-1" });
  assert.equal(hexOf(opaque), TX_REFERENCE_VECTOR);
  assert.equal(TRANSACTION_REFERENCE_CONTENT_KIND, 245);
  const content = concat(str(TX_CHAIN_ID), scaleEncodeBytes(new Uint8Array(32).fill(0x22)), Uint8Array.of(1), Uint8Array.of(1), u32(123), str("Top-up of 1 PAS"), Uint8Array.of(1), str("TX-1"));
  assert.equal(hexOf(opaque), hexOf(scaleEncodeBytes(concat(str("REF-1"), u64(1_720_000_010_000), Uint8Array.of(0), Uint8Array.of(245), content))));
  const m = decodeOne(hex(TX_REFERENCE_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, chainId: m.chainId, hash: m.hash, status: m.status, block: m.block, note: m.note, intentMessageId: m.intentMessageId },
    { kind: "transactionReference", messageId: "REF-1", timestamp: 1_720_000_010_000, chainId: TX_CHAIN_ID, hash: new Uint8Array(32).fill(0x22), status: 1, block: 123, note: "Top-up of 1 PAS", intentMessageId: "TX-1" },
  );
});

test("round-trip: a raw-call intent with gas fields absent, several calls, and a reference with no block", () => {
  const intent = {
    chainId: TX_CHAIN_ID,
    calls: [
      { kind: 0, to: null, data: Uint8Array.of(10, 3, 1), value: 0n },
      { kind: 1, to: new Uint8Array(20).fill(7), data: new Uint8Array(0), value: (1n << 128n) - 1n, gasRefTime: 5n, gasProofSize: 6n, storageDepositLimit: 7n },
    ],
    display: { title: "Two", description: "", amount: null, asset: null },
    expiresAt: 1n,
  };
  const d = decodeTxIntent(encodeTxIntent(intent));
  assert.deepEqual(d.calls[0], { kind: 0, to: null, data: Uint8Array.of(10, 3, 1), value: 0n, gasRefTime: null, gasProofSize: null, storageDepositLimit: null });
  assert.deepEqual([d.calls[1].value, d.calls[1].gasRefTime, d.calls[1].gasProofSize, d.calls[1].storageDepositLimit], [(1n << 128n) - 1n, 5n, 6n, 7n]);
  assert.deepEqual(d.display, { title: "Two", description: "", amount: null, asset: null });
  const r = decodeOne(encodeOpaqueTransactionReferenceMessage({ chainId: TX_CHAIN_ID, hash: Uint8Array.of(1), status: 3, note: "failed: out of gas" }));
  assert.deepEqual([r.kind, r.status, r.block, r.note, r.intentMessageId], ["transactionReference", 3, null, "failed: out of gas", null]);
});

// Spec 0007 client rule 1: a client refuses to sign without a dry-run. The
// encoder refuses to build an intent a client must refuse, and the limits
// keep an intent small enough for a button.
test("tx intent encoder and decoder enforce the spec 0007 rules", () => {
  const base = { ...vectorIntent };
  assert.throws(() => encodeTxIntent({ ...base, dryRunRequired: false }), /dryRunRequired/);
  assert.throws(() => encodeTxIntent({ ...base, calls: [] }), /1 to 8 calls/);
  assert.throws(() => encodeTxIntent({ ...base, calls: Array.from({ length: 9 }, () => base.calls[0]) }), /1 to 8 calls/);
  assert.throws(() => encodeTxIntent({ ...base, calls: [{ ...base.calls[0], to: null }] }), /20-byte/);
  assert.throws(() => encodeTxIntent({ ...base, calls: [{ ...base.calls[0], kind: 2 }] }), /kind/);
  assert.throws(() => encodeTxIntent({ ...base, calls: [{ kind: 0, data: "0x00", gasRefTime: 1n }] }), /revive calls only/);
  assert.throws(() => encodeTxIntent({ ...base, calls: [{ ...base.calls[0], data: new Uint8Array(16 * 1024 + 1) }] }), /16384 bytes/);
  assert.throws(() => encodeTxIntent({ ...base, calls: [{ ...base.calls[0], value: -1n }] }), /u128/);
  assert.throws(() => encodeTxIntent({ ...base, display: { ...base.display, title: "x".repeat(61) } }), /title/);
  assert.throws(() => encodeTxIntent({ ...base, display: { ...base.display, description: "x".repeat(281) } }), /description/);
  assert.throws(() => encodeOpaqueTransactionReferenceMessage({ chainId: TX_CHAIN_ID, hash: "0x22", status: 4 }), /status/);
  assert.throws(() => encodeOpaqueTransactionReferenceMessage({ chainId: TX_CHAIN_ID, hash: "0x22", status: 0, note: "x".repeat(141) }), /note/);
  // A bool byte other than 00/01 is malformed; `false` itself decodes, and the client refuses to sign it.
  const noDryRun = hex(TX_INTENT_VECTOR); noDryRun[noDryRun.length - 9] = 2;
  assert.throws(() => decodeTxIntent(noDryRun), /dryRunRequired/);
  assert.throws(() => decodeTxIntent(concat(hex(TX_INTENT_VECTOR), Uint8Array.of(0))), /trailing/);
  const unknownStatus = hex(TX_REFERENCE_VECTOR); unknownStatus[unknownStatus.indexOf(0x80) + 33] = 9;
  assert.equal(decodeOne(unknownStatus).kind, "undecodable");
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

// ---------- spec 0009 fan-out groups ----------
// Pinned in polkadot-chat-desktop docs/spec/vectors-0009.md: the desktop
// codec must decode these bytes to these values and encode them back.
const GROUP_ADMIN = new Uint8Array(32).fill(1);
const GROUP_BOB = new Uint8Array(32).fill(2);
const GROUP_INFO_VALUES = {
  messageId: "GRP-1", timestamp: 1_720_000_000_000, groupId: "GRP-1", name: "Test group", admin: GROUP_ADMIN,
  members: [
    { account: GROUP_ADMIN, username: "alice.01", joinedAt: 1_720_000_000_000 },
    { account: GROUP_BOB, username: "bob.02", joinedAt: 1_720_000_001_000 },
  ],
  version: 1, createdAt: 1_720_000_000_000,
};
const GROUP_INFO_VECTOR = "b902144752502d310030fd779001000000f6144752502d3128546573742067726f7570010101010101010101010101010101010101010101010101010101010101010108010101010101010101010101010101010101010101010101010101010101010120616c6963652e30310030fd7790010000020202020202020202020202020202020202020202020202020202020202020218626f622e3032e833fd7790010000010000000030fd7790010000";
const GROUP_MESSAGE_VECTOR = "b41447524d2d31d037fd779001000000f7144752502d31010000000100000000000000002468656c6c6f20616c6c";
const GROUP_LEAVE_VECTOR = "581447524c2d31b83bfd779001000000f8144752502d31";
const innerText = (text) => encodeOpaqueTextMessage({ messageId: "inner", timestamp: 0, text });

test("groupInfo: pinned vector GRP-1 matches the spec 0009 SCALE layout", () => {
  assert.deepEqual([GROUP_INFO_CONTENT_KIND, GROUP_MESSAGE_CONTENT_KIND, GROUP_LEAVE_CONTENT_KIND], [246, 247, 248]);
  const opaque = encodeOpaqueGroupInfoMessage(GROUP_INFO_VALUES);
  assert.equal(hexOf(opaque), GROUP_INFO_VECTOR);
  // Built by hand from the spec: AccountId raw 32 bytes, u64/u32 LE.
  const member = (account, username, joinedAt) => concat(account, str(username), u64(joinedAt));
  const content = concat(
    str("GRP-1"), str("Test group"), GROUP_ADMIN,
    compact(2), member(GROUP_ADMIN, "alice.01", 1_720_000_000_000), member(GROUP_BOB, "bob.02", 1_720_000_001_000),
    u32(1), u64(1_720_000_000_000),
  );
  assert.equal(hexOf(opaque), hexOf(opaqueMessage("GRP-1", 246, content)));
  const m = decodeOne(hex(GROUP_INFO_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, groupId: m.groupId, name: m.name, adminHex: m.adminHex, version: m.version, createdAt: m.createdAt },
    { kind: "groupInfo", messageId: "GRP-1", timestamp: 1_720_000_000_000, groupId: "GRP-1", name: "Test group", adminHex: "01".repeat(32), version: 1, createdAt: 1_720_000_000_000 },
  );
  assert.deepEqual(m.members.map((x) => [x.accountHex, x.username, x.joinedAt]), [["01".repeat(32), "alice.01", 1_720_000_000_000], ["02".repeat(32), "bob.02", 1_720_000_001_000]]);
});

test("groupMessage: pinned vector GRM-1 wraps a text as inline content", () => {
  const opaque = encodeOpaqueGroupMessage({ messageId: "GRM-1", timestamp: 1_720_000_002_000, groupId: "GRP-1", infoVersion: 1, seq: 1, content: innerText("hello all") });
  assert.equal(hexOf(opaque), GROUP_MESSAGE_VECTOR);
  // The wrapped content is the text content itself (kind 0 + String), no
  // length prefix and no inner envelope.
  const content = concat(str("GRP-1"), u32(1), u64(1), Uint8Array.of(0), str("hello all"));
  assert.equal(hexOf(opaque), hexOf(scaleEncodeBytes(concat(str("GRM-1"), u64(1_720_000_002_000), Uint8Array.of(0), Uint8Array.of(247), content))));
  const m = decodeOne(hex(GROUP_MESSAGE_VECTOR));
  assert.deepEqual(
    { kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, groupId: m.groupId, infoVersion: m.infoVersion, seq: m.seq, content: m.content },
    { kind: "groupMessage", messageId: "GRM-1", timestamp: 1_720_000_002_000, groupId: "GRP-1", infoVersion: 1, seq: 1, content: { kind: "text", text: "hello all" } },
  );
});

test("groupLeave: pinned vector GRL-1", () => {
  const opaque = encodeOpaqueGroupLeaveMessage({ messageId: "GRL-1", timestamp: 1_720_000_003_000, groupId: "GRP-1" });
  assert.equal(hexOf(opaque), GROUP_LEAVE_VECTOR);
  const m = decodeOne(hex(GROUP_LEAVE_VECTOR));
  assert.deepEqual({ kind: m.kind, messageId: m.messageId, timestamp: m.timestamp, groupId: m.groupId }, { kind: "groupLeave", messageId: "GRL-1", timestamp: 1_720_000_003_000, groupId: "GRP-1" });
});

test("round-trip: groupMessage wraps buttons, a tx reference, a reply and typing like any content", () => {
  const wrap = (content, seq = 7) => decodeOne(encodeOpaqueGroupMessage({ messageId: "G", timestamp: 5, groupId: "0A0B0C0D-0000-4000-8000-000000000001", infoVersion: 3, seq, content }));
  const buttons = wrap(encodeOpaqueButtonsMessage({ messageId: "x", timestamp: 0, text: "Pick", rows: [[{ label: "Yes", action: { command: "yes" } }]], oneShot: true }));
  assert.equal(buttons.content.kind, "buttons");
  assert.deepEqual([buttons.content.text, buttons.content.rows[0][0].label, buttons.content.oneShot], ["Pick", "Yes", true]);
  const ref = wrap(encodeOpaqueTransactionReferenceMessage({ messageId: "x", timestamp: 0, chainId: "0x01", hash: `0x${"ab".repeat(32)}`, status: 2, note: "paid" }));
  assert.deepEqual([ref.content.kind, ref.content.status, ref.content.note, ref.content.block], ["transactionReference", 2, "paid", null]);
  const reply = wrap(encodeOpaqueReplyMessage({ messageId: "x", timestamp: 0, replyToMessageId: "GRM-1", text: "me too" }));
  assert.deepEqual([reply.content.kind, reply.content.replyToMessageId, reply.content.text], ["reply", "GRM-1", "me too"]);
  const typing = wrap(encodeOpaqueTypingMessage({ messageId: "x", timestamp: 0, until: 99, kind: TYPING_KINDS.working }), 2n ** 40n);
  assert.deepEqual([typing.content.kind, typing.content.typingKind, typing.seq, typing.infoVersion], ["typing", 1, 2 ** 40, 3]);
  // The envelope's id and timestamp are the message's; the inner ones are dropped.
  assert.deepEqual([reply.messageId, reply.timestamp, reply.content.messageId], ["G", 5, undefined]);
});

test("group kinds refuse nesting and out-of-range fields on both sides", () => {
  const info = encodeOpaqueGroupInfoMessage(GROUP_INFO_VALUES);
  const leave = encodeOpaqueGroupLeaveMessage({ groupId: "GRP-1" });
  for (const nested of [info, leave, encodeOpaqueGroupMessage({ groupId: "GRP-1", infoVersion: 1, seq: 1, content: innerText("x") })]) {
    assert.throws(() => encodeOpaqueGroupMessage({ groupId: "GRP-1", infoVersion: 1, seq: 1, content: nested }), /cannot wrap a group kind/);
  }
  // A hand-built nested group message decodes as undecodable, not as a group turn.
  const nested = opaqueMessage("N", 247, concat(str("GRP-1"), u32(1), u64(1), Uint8Array.of(248), str("GRP-1")));
  assert.equal(decodeOne(nested).kind, "undecodable");
  assert.match(decodeOne(nested).error, /cannot wrap a group kind/);
  assert.equal(decodeOne(opaqueMessage("E", 247, concat(str("GRP-1"), u32(1), u64(1)))).kind, "undecodable");
  const base = GROUP_INFO_VALUES;
  assert.throws(() => encodeOpaqueGroupInfoMessage({ ...base, name: "x".repeat(61) }), /group name/);
  assert.throws(() => encodeOpaqueGroupInfoMessage({ ...base, name: "" }), /group name/);
  assert.throws(() => encodeOpaqueGroupInfoMessage({ ...base, admin: new Uint8Array(31) }), /32-byte account/);
  assert.throws(() => encodeOpaqueGroupInfoMessage({ ...base, members: Array.from({ length: 17 }, () => base.members[0]) }), /1 to 16 members/);
  assert.throws(() => encodeOpaqueGroupInfoMessage({ ...base, version: 2 ** 32 }), /u32/);
  assert.throws(() => encodeOpaqueGroupMessage({ groupId: "GRP-1", infoVersion: 1, seq: -1, content: innerText("x") }), /u64/);
  assert.throws(() => encodeOpaqueGroupLeaveMessage({ groupId: "" }), /group id/);
  // 17 members on the wire: refused by the decoder.
  const one = concat(GROUP_ADMIN, str("a"), u64(0));
  const tooMany = opaqueMessage("T", 246, concat(str("GRP-1"), str("n"), GROUP_ADMIN, compact(17), ...Array.from({ length: 17 }, () => one), u32(1), u64(0)));
  assert.match(decodeOne(tooMany).error, /group members exceeds maximum of 16/);
  // Hex account ids are accepted by the encoder.
  const fromHex = encodeOpaqueGroupInfoMessage({ ...base, admin: `0x${"01".repeat(32)}`, members: [{ account: "02".repeat(32), username: "bob.02", joinedAt: 1 }] });
  assert.equal(decodeOne(fromHex).members[0].accountHex, "02".repeat(32));
});

// ---------- spec 0011 private groups v2: the pinned vectors ----------
// Every byte string below is in polkadot-chat-desktop docs/spec/vectors-0011.md.
// The desktop codec must reproduce the same bytes; a change here is a wire
// change for both clients, never a test fix.
import * as G from "../lib/group-codec.mjs";
import * as GK from "../lib/group-keys.mjs";
import {
  encodeAppStatement,
  encodeOpaqueGroupControlMessage,
} from "../vendor/app-chat-codec.mjs";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import { verify as sr25519Verify } from "@scure/sr25519";

const v11 = (() => {
  const f = (x, n) => new Uint8Array(n).fill(x);
  const hx = (b) => Buffer.from(b).toString("hex");
  const state = {
    groupId: "GRP-2", epoch: 1, version: 1, name: "Test group", avatar: null, defaultPermissions: 1, slowModeSecs: 0, joinPolicy: 1, historyShare: 100,
    members: [
      { account: "01".repeat(32), role: 2, permissions: 0xff, posting: [], joinedAt: 1720000000000 },
      { account: "02".repeat(32), role: 0, permissions: 1, posting: [], joinedAt: 1720000001000 },
    ],
    invites: [{ inviteId: "33".repeat(16), secret: "44".repeat(16), createdBy: "01".repeat(32), expiresAt: 0, maxUses: 0, uses: 0 }],
    pinned: [], topics: null, createdAt: 1720000000000,
  };
  return { f, hx, state, K1: f(0x11, 32), K2: f(0x66, 32), A: f(1, 32), B: f(2, 32), msg: encodeOpaqueTextMessage({ messageId: "GM-1", timestamp: 1720000002000, text: "hello all" }) };
})();

test("0011 (a): epoch-1 topic, message key and channels", () => {
  const d = GK.deriveEpoch(v11.K1, "GRP-2", 1);
  assert.equal(v11.hx(d.topic), "1050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78");
  assert.equal(v11.hx(d.msgKey), "8934a29c1ff0f0abca5fff48cf5eb15e9acfa1e4be0fbd8593f790fb23145267");
  assert.equal(v11.hx(d.channels.msgs), "4ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450");
  assert.equal(v11.hx(d.channels.state), "e1be9084dc06e458f7caece2db5d292dac751f558d9d94b346079a774401f9a6");
  assert.equal(v11.hx(d.channels.rekey), "5b7884e5795aaf767f27d9325455c20c4f8f22bb1215547041eb97e7bd98ce68");
});

test("0011 (b): a messages carrier seals, encodes and opens byte for byte", () => {
  const d = GK.deriveEpoch(v11.K1, "GRP-2", 1);
  assert.equal(v11.hx(v11.msg), "6410474d2d31d037fd779001000000002468656c6c6f20616c6c");
  const plaintext = G.encodeGroupMessages({ from: v11.A, messages: [v11.msg] });
  assert.equal(v11.hx(plaintext), `${"01".repeat(32)}0004${v11.hx(v11.msg)}`);
  assert.equal(v11.hx(GK.sealAad(v11.A, 1, 0)), `677270${"01".repeat(32)}0100000000`);
  const data = G.encodeGroupData({ messages: GK.seal(d.msgKey, { signer: v11.A, epoch: 1, variant: 0, plaintext, nonce: v11.f(0x22, 12) }) });
  const pinned = "002222222222222222222222223101518aa1d987c3ea031a7f5dfbbd628c3b24df6ceb1d68d3f221124b081a8a13f4bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049ca426a27af4b8387496497accf455808c";
  assert.equal(v11.hx(data), pinned);
  const decoded = G.decodeGroupData(Buffer.from(pinned, "hex"));
  assert.equal(decoded.kind, "messages");
  const opened = GK.open(d.msgKey, { signer: v11.A, epoch: 1, variant: 0, sealed: decoded.sealed });
  assert.deepEqual(G.decodeGroupMessages(opened), { from: "01".repeat(32), messages: [v11.msg] });
  // The AAD binds signer and variant: another signer, or the state variant, cannot open it.
  assert.throws(() => GK.open(d.msgKey, { signer: v11.B, epoch: 1, variant: 0, sealed: decoded.sealed }));
  assert.throws(() => GK.open(d.msgKey, { signer: v11.A, epoch: 1, variant: 1, sealed: decoded.sealed }));
});

const STATE_HEX = "144752502d32010000000100000028546573742067726f757000010000000000016408010101010101010101010101010101010101010101010101010101010101010102ff00000030fd7790010000020202020202020202020202020202020202020202020202020202020202020200010000e833fd779001000004333333333333333333333333333333334444444444444444444444444444444401010101010101010101010101010101010101010101010101010101010101010000000000000000000000000000000000000030fd7790010000";

test("0011 (c): GroupState round-trips; stateHash; the sealed state statement", () => {
  const bytes = G.encodeGroupState(v11.state);
  assert.equal(bytes.length, 214);
  assert.equal(v11.hx(bytes), STATE_HEX);
  assert.deepEqual(G.decodeGroupState(bytes), { ...v11.state });
  assert.equal(v11.hx(GK.hash256(bytes)), "71cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35");
  const d = GK.deriveEpoch(v11.K1, "GRP-2", 1);
  const sealed = GK.seal(d.msgKey, { signer: v11.A, epoch: 1, variant: 1, plaintext: bytes, nonce: v11.f(0x23, 12) });
  const pinned = "012323232323232323232323239903123e6e97e44666b0255a664e8591e892283d70e77f62004ad60790d61c648caa5c5a7b5bffb73587cc5090001c58fb1e5525272ed171093f2a02a5a5b16bfd7f04067005123e351149441cdc0cb5e5ad47873dd0f63a43e6af6f6713b8a985073af067857637472b08de6b2d0fe240d1170ebcf12ed226d59f13bd374c5f2a6404a468304517b19ad17ed442e145aae68934f09c6cb514d61654f41c62b8753f341d3ae3e5a6c79e38863465961da9479baf2993e8bf5c57b9c5b78144b3a980b3c28d848e7609d635619824de6f2f3485505d9159959701c8deaadc4039bc3d496fa4c22a21";
  assert.equal(v11.hx(G.encodeGroupData({ state: sealed })), pinned);
  const back = G.decodeGroupData(Buffer.from(pinned, "hex"));
  assert.equal(v11.hx(GK.open(d.msgKey, { signer: v11.A, epoch: 1, variant: 1, sealed: back.sealed })), STATE_HEX);
});

test("0011 decoder bounds: topics Some, no owner, trailing bytes and 1025 members are refused", () => {
  const bytes = Buffer.from(STATE_HEX, "hex");
  const withTopics = Buffer.concat([bytes.subarray(0, bytes.length - 9), Buffer.from("010400", "hex"), bytes.subarray(bytes.length - 8)]);
  assert.throws(() => G.decodeGroupState(withTopics), /topics must be None/);
  assert.throws(() => G.decodeGroupState(Buffer.concat([bytes, Buffer.from("00", "hex")])), /trailing/);
  assert.throws(() => G.encodeGroupState({ ...v11.state, members: v11.state.members.map((m) => ({ ...m, role: 0 })) }) && G.decodeGroupState(G.encodeGroupState({ ...v11.state, members: v11.state.members.map((m) => ({ ...m, role: 0 })) })), /exactly one owner/);
  const many = Array.from({ length: 1025 }, (_, i) => ({ account: i.toString(16).padStart(64, "0"), role: i === 0 ? 2 : 0, permissions: 1, posting: [], joinedAt: 0 }));
  assert.throws(() => G.encodeGroupState({ ...v11.state, members: many }), /1\.\.=1024/);
  const carrier = G.encodeGroupMessages({ from: v11.A, messages: [v11.msg] });
  carrier[32] = 1; // topic: Some(...)
  assert.throws(() => G.decodeGroupMessages(Buffer.concat([carrier.subarray(0, 33), Buffer.from("00000000", "hex"), carrier.subarray(33)])), /topic must be None/);
});

test("0011 (d)(e): welcome and joinRequest, kind 249", () => {
  const welcome = encodeOpaqueGroupControlMessage({
    messageId: "GW-1", timestamp: 1720000003000,
    control: { welcome: { groupId: "GRP-2", epoch: 1, epochKey: v11.K1, stateVersion: 1, stateHash: GK.hash256(Buffer.from(STATE_HEX, "hex")) } },
  });
  assert.equal(v11.hx(welcome), "79011047572d31b83bfd779001000000f900144752502d320100000011111111111111111111111111111111111111111111111111111111111111110100000071cdf88d55888efd322a22deb910897cbfb109fda0ee53eb5fc6860176101d35");
  const w = decodeOpaqueMessageAt(welcome, 0).value;
  assert.equal(w.kind, "groupControl");
  assert.equal(w.control.welcome.epoch, 1);
  assert.equal(v11.hx(w.control.welcome.epochKey), "11".repeat(32));
  const proof = GK.joinProof(v11.f(0x44, 16), v11.B);
  assert.equal(v11.hx(proof), "eba5b4f507de6b1f6405fafdfe30c0da870c1ba104d36e9cb9a5f6a61ece560f");
  const join = encodeOpaqueGroupControlMessage({ messageId: "GJ-1", timestamp: 1720000004000, control: { joinRequest: { groupId: "GRP-2", inviteId: v11.f(0x33, 16), proof, note: "hi" } } });
  assert.equal(v11.hx(join), "250110474a2d31a03ffd779001000000f901144752502d3233333333333333333333333333333333eba5b4f507de6b1f6405fafdfe30c0da870c1ba104d36e9cb9a5f6a61ece560f086869");
  assert.equal(decodeOpaqueMessageAt(join, 0).value.control.joinRequest.note, "hi");
});

test("0011 (h): history, joinDecision, keyRequest and the historyRequest proposal", () => {
  const cases = [
    [{ messageId: "GH-1", timestamp: 1720000005000, control: { history: { groupId: "GRP-2", items: [{ from: v11.A, message: v11.msg }], last: true } } },
      "49011047482d318843fd779001000000f903144752502d320401010101010101010101010101010101010101010101010101010101010101016410474d2d31d037fd779001000000002468656c6c6f20616c6c01"],
    [{ messageId: "GD-1", timestamp: 1720000006000, control: { joinDecision: { groupId: "GRP-2", inviteId: v11.f(0x33, 16), status: 0 } } },
      "9c1047442d317047fd779001000000f902144752502d323333333333333333333333333333333300"],
    [{ messageId: "GK-1", timestamp: 1720000007000, control: { keyRequest: { groupId: "GRP-2", haveEpoch: 1 } } },
      "6810474b2d31584bfd779001000000f904144752502d3201000000"],
    [{ messageId: "GQ-1", timestamp: 1720000008000, control: { historyRequest: { groupId: "GRP-2", since: { messageId: "GM-1" }, limit: 100 } } },
      "741047512d31404ffd779001000000f905144752502d320010474d2d3164"],
    [{ messageId: "GQ-2", timestamp: 1720000008000, control: { historyRequest: { groupId: "GRP-2", since: { timestamp: 1720000000000 }, limit: 50 } } },
      "801047512d32404ffd779001000000f905144752502d32010030fd779001000032"],
  ];
  for (const [input, pinned] of cases) {
    const bytes = encodeOpaqueGroupControlMessage(input);
    assert.equal(v11.hx(bytes), pinned);
    const m = decodeOpaqueMessageAt(Buffer.from(pinned, "hex"), 0).value;
    assert.equal(m.kind, "groupControl");
    const [variant] = Object.keys(input.control);
    assert.equal(v11.hx(encodeOpaqueGroupControlMessage({ messageId: m.messageId, timestamp: m.timestamp, control: { [variant]: m.control[variant] } })), pinned);
  }
});

test("0011 (f): rekey entry with the stand-in K(A, B)", () => {
  const kab = v11.f(0x55, 32);
  const wrap = GK.wrapKey(kab, "GRP-2", 2);
  assert.equal(v11.hx(wrap), "a235cd89db89439c9653c8c57b87270814dee0f85bd96269118c6f8eb1507422");
  assert.equal(v11.hx(GK.entryHint(wrap)), "e88435e61ddfce6b");
  const entry = GK.makeRekeyEntry(kab, { groupId: "GRP-2", newEpoch: 2, newKey: v11.K2, nonce: v11.f(0x77, 12) });
  assert.equal(v11.hx(entry.box), "15a235403c6ceca6c1243940b92fc447b3f19cddef5f65f531d7808e482be8a0e7293d5f70648b5dab4a0c43a1bf80c6");
});

test("0011 (i): a real K(A, B) from two X25519 identity keys and a full rekey with 3 entries", () => {
  const priv = { A: v11.f(0x0a, 32), B: v11.f(0x0b, 32), C: v11.f(0x0c, 32) };
  const pub = Object.fromEntries(Object.entries(priv).map(([k, v]) => [k, x25519PublicKeyFromPrivateKey(v)]));
  assert.equal(v11.hx(pub.A), "f77ff4b10788bfdca62ca0bb160d427cf5762d85f2b5cad6807ec9c3febbde09");
  assert.equal(v11.hx(pub.B), "73b2d8b76aa9b53660032bc8f5d8bee3a3ae4e3b3a7fd49ade81f7347a34aa68");
  assert.equal(v11.hx(pub.C), "97c3b10b4d6c133a78ea5dcc1cf6421d3f81ae37b1f628ce14ca6fce7730f333");
  const kab = GK.pairwiseSecret(priv.A, pub.B);
  assert.equal(v11.hx(kab), "c09d8a17f54f06a53f844eacbc6273017581b9bc53b5f31f3d338cc3ffd7b86b");
  assert.equal(v11.hx(GK.pairwiseSecret(priv.B, pub.A)), v11.hx(kab), "both sides derive K(A, B)");
  const kaa = GK.pairwiseSecret(priv.A, pub.A);
  const kac = GK.pairwiseSecret(priv.A, pub.C);
  assert.equal(v11.hx(kaa), "064b7cec534810674268cef049e065e9bd363d131a4a09a42be2059a9fb8ab61");
  assert.equal(v11.hx(kac), "cf41b439fa7668d5fe9909b55584224eb2d94140dd93fb300232a881cebd2317");
  const entries = [[kaa, 0x77], [kab, 0x78], [kac, 0x79]].map(([k, n]) => GK.makeRekeyEntry(k, { groupId: "GRP-2", newEpoch: 2, newKey: v11.K2, nonce: v11.f(n, 12) }));
  const data = G.encodeGroupData({ rekey: { newEpoch: 2, entries } });
  const pinned = "02020000000cb15f17a0bfb8af0b777777777777777777777777dbd8cd740c9be5aab7e6491eb762d54cbafd76ba4e16172d4e39314bc80732091243fc23c759246c06ee2d11dc7ad59dc4308e7ad84cbaf7797979797979797979797979ef6aa68e222cbad29059038d624cb81b494e7174997965653bb378e63dcc1645d5adf5f8b63e8d1e3d412ba949d6ce22efe9e3c7fbfce4f5787878787878787878787878ee0eee9d9efd1676595fdb40359409c67530e199c596ae7edcfad16406b2c74731552a15be72a6aa22e5affed6d32862";
  assert.equal(v11.hx(data), pinned);
  const { rekey } = G.decodeGroupData(Buffer.from(pinned, "hex"));
  // B finds its entry with K(B, A); C with K(C, A); a stranger finds none.
  assert.equal(v11.hx(GK.openRekeyEntry(GK.pairwiseSecret(priv.B, pub.A), { groupId: "GRP-2", rekey })), "66".repeat(32));
  assert.equal(v11.hx(GK.openRekeyEntry(GK.pairwiseSecret(priv.C, pub.A), { groupId: "GRP-2", rekey })), "66".repeat(32));
  assert.equal(GK.openRekeyEntry(GK.pairwiseSecret(v11.f(0x0d, 32), pub.A), { groupId: "GRP-2", rekey }), null);
});

test("0011 (g): invite link", () => {
  const link = G.encodeInviteLink({ groupId: "GRP-2", name: "Test group", admins: [v11.A], inviteId: v11.f(0x33, 16), secret: v11.f(0x44, 16) });
  assert.equal(G.inviteLinkToBase64Url(link), "FEdSUC0yKFRlc3QgZ3JvdXAEAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEzMzMzMzMzMzMzMzMzMzMzRERERERERERERERERERERA");
  assert.deepEqual(G.decodeInviteLink(link), { groupId: "GRP-2", name: "Test group", admins: ["01".repeat(32)], inviteId: "33".repeat(16), secret: "44".repeat(16) });
});

test("0011 (j): a full signed GroupStatement (Sr25519 proof)", () => {
  const pair = deriveSr25519PairFromSeed(v11.f(0x01, 32), "//wallet");
  assert.equal(v11.hx(pair.publicKey), "a83e8af1ed0f17a66fbf999cde3e95b2afb987e1eed2f762716d86d731263550");
  const d = GK.deriveEpoch(v11.K1, "GRP-2", 1);
  const plaintext = G.encodeGroupMessages({ from: pair.publicKey, messages: [v11.msg] });
  const data = G.encodeGroupData({ messages: GK.seal(d.msgKey, { signer: pair.publicKey, epoch: 1, variant: 0, plaintext, nonce: v11.f(0x22, 12) }) });
  const now = 1_790_000_000;
  const expiry = GK.groupExpiryFactory({ now: () => now * 1000 })();
  assert.equal(expiry.toString(16), "6ac3b08001997900", "ExpirationTime now + 14 d, sequence now - 1_763_164_800");
  const statement = encodeAppStatement({ walletPair: pair, channel: d.channels.msgs, topics: [d.topic], expiry, scaleEncodedPayload: scaleEncodeBytes(data) });
  const material = "020079990180b0c36a034ed5fab5021a794bd7159322654353d2b5736ebc8cc93196cf0c26f1395c7450041050ae1226c62b347cb32a7ee60a8dee9b183987090b7ca075346d38fb466c78086d01002222222222222222222222223101f8b52a296bcdfca474c1c566625d18888a67ea0bf2bb2591517eccde2aad27a5bc10f3e660ffffb80f63986e753af4a14a6cb2b6907021b02005049c7bc7441d8decf3a59fa0041c117ae7ec";
  // Vec of 5 fields; proof = field 0, Sr25519 variant 0, signature, signer; then the signed fields.
  assert.equal(v11.hx(statement.subarray(0, 3)), "140000");
  assert.equal(v11.hx(statement.subarray(67, 99)), v11.hx(pair.publicKey));
  assert.equal(v11.hx(statement.subarray(99)), material);
  assert.ok(sr25519Verify(Buffer.from(material, "hex"), statement.subarray(3, 67), pair.publicKey));
});

test("0011 group expiry: rises with every submission, even within one second", () => {
  const next = GK.groupExpiryFactory({ now: () => 1_790_000_000_000 });
  const a = next(); const b = next(); const c = next();
  assert.ok(a < b && b < c);
  assert.equal(a >> 32n, BigInt(1_790_000_000 + 14 * 86_400));
});

// ---------- spec 0012 attachments: the pinned vectors ----------
// Every byte string below is in polkadot-chat-desktop docs/spec/vectors-0012.md.
// The desktop codec must produce the same bytes; a change here is a wire
// change for both clients, never a test fix.
import {
  ATTACHMENT_CONTENT_KIND,
  ATTACHMENT_LIMITS,
  encodeAttachmentContent,
  encodeOpaqueAttachmentMessage,
} from "../vendor/app-chat-codec.mjs";

const v12 = (() => {
  const genesis = hex("e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59");
  const base = { key: new Uint8Array(32).fill(0x11), nonce: new Uint8Array(12).fill(0x22), store: { kind: "bulletin", genesis, mirror: null }, expiresAt: 1721209600000 };
  const A = {
    messageId: "ATT-1", timestamp: 1720000000000, caption: "Our cat",
    items: [{ ...base, mime: "image/jpeg", name: null, size: 15, media: { kind: "image", width: 640, height: 480 }, blurhash: "LEHV6nWB2yk8", thumbnail: null, chunkSize: 2000000, chunks: [hex("d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a")] }],
  };
  const B = {
    messageId: "ATT-2", timestamp: 1720000000000, caption: null,
    items: [{
      ...base, mime: "audio/ogg; codecs=opus", name: null, size: 13, media: { kind: "voice", durationMs: 4200, waveform: [0, 64, 128, 255] }, blurhash: null, thumbnail: null, chunkSize: 8,
      chunks: [hex("f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb4"), hex("7e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a8")],
      store: { kind: "bulletin", genesis, mirror: "https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/" },
    }],
  };
  return {
    A, B,
    hexA: "0503144154542d310030fd779001000000fa0428696d6167652f6a706567000f000000000000000180020000e001000001304c454856366e574232796b3800111111111111111111111111111111111111111111111111111111111111111122222222222222222222222280841e0004d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a00e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5900003816c090010000011c4f757220636174",
    hexB: "5104144154542d320030fd779001000000fa0458617564696f2f6f67673b20636f646563733d6f707573000d00000000000000036810000010004080ff000011111111111111111111111111111111111111111111111111111111111111112222222222222222222222220800000008f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb47e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a800e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5901e868747470733a2f2f6465766e65742d697066732e6170692e706f6c6b61646f74636f6d6d756e6974792e666f756e646174696f6e2f697066732f003816c09001000000",
  };
})();
// Decoded items carry byte arrays and a normalized shape; compare as encoded.
const reencode = (d) => encodeOpaqueAttachmentMessage({ messageId: d.messageId, timestamp: d.timestamp, items: d.items, caption: d.caption });

test("0012 vector A: an image (C1) encodes to the pinned 195 bytes and decodes back", () => {
  const bytes = encodeOpaqueAttachmentMessage(v12.A);
  assert.equal(bytes.length, 195);
  assert.equal(hexOf(bytes), v12.hexA);
  const d = decodeOne(hex(v12.hexA));
  assert.equal(d.kind, "attachment");
  assert.equal(d.caption, "Our cat");
  assert.deepEqual(d.items[0].media, { kind: "image", width: 640, height: 480 });
  assert.equal(d.items[0].blurhash, "LEHV6nWB2yk8");
  assert.equal(d.items[0].size, 15);
  assert.equal(d.items[0].expiresAt, 1721209600000);
  assert.equal(hexOf(reencode(d)), v12.hexA);
  assert.equal(encodeAttachmentContent({ items: v12.A.items }).length, 169, "vectors-0012 Sizes: vector A without caption");
});

test("0012 vector B: a voice note (C2, a mirror) encodes to the pinned 278 bytes and decodes back", () => {
  const bytes = encodeOpaqueAttachmentMessage(v12.B);
  assert.equal(bytes.length, 278);
  assert.equal(hexOf(bytes), v12.hexB);
  const d = decodeOne(hex(v12.hexB));
  assert.deepEqual(d.items[0].media, { kind: "voice", durationMs: 4200, waveform: [0, 64, 128, 255] });
  assert.equal(d.items[0].store.mirror, "https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/");
  assert.equal(d.items[0].chunks.length, 2);
  assert.equal(d.caption, null);
  assert.equal(hexOf(reencode(d)), v12.hexB);
});

test("0012 sizes: a photo with a name, a 2,048-byte thumbnail and a 100-byte caption is 2,334 bytes", () => {
  const item = { ...v12.A.items[0], name: "IMG_0001.jpg", thumbnail: new Uint8Array(2048) };
  assert.equal(encodeAttachmentContent({ items: [item], caption: "x".repeat(100) }).length, 2334);
});

test("0012 bounds: both sides refuse what does not fit the 4 KB message", () => {
  const item = v12.A.items[0];
  assert.throws(() => encodeOpaqueAttachmentMessage({ items: Array(5).fill(item) }), /1 to 4 items/);
  assert.throws(() => encodeOpaqueAttachmentMessage({ items: [{ ...item, thumbnail: new Uint8Array(2049) }] }), /thumbnail/);
  assert.throws(() => encodeOpaqueAttachmentMessage({ items: [{ ...item, chunks: Array(15).fill(item.chunks[0]) }] }), /1 to 14 chunks/);
  assert.throws(() => encodeOpaqueAttachmentMessage({ items: [{ ...item, size: 0 }] }), /at least 1/);
  // Two items with 2 KB thumbnails pass every per-field cap but not the 3,584-byte budget.
  const big = { ...item, thumbnail: new Uint8Array(2048) };
  assert.throws(() => encodeOpaqueAttachmentMessage({ items: [big, big] }), new RegExp(`limit is ${ATTACHMENT_LIMITS.contentBytes}`));
  // An unknown media or store tag makes only that message undecodable.
  const at = v12.hexA.indexOf("0180020000") / 2;
  const badMedia = hex(v12.hexA); badMedia[at] = 9;
  assert.equal(decodeOne(badMedia).kind, "undecodable");
  const badStore = hex(v12.hexA.replace("8a8a00e101", "8a8a01e101"));
  assert.equal(decodeOne(badStore).kind, "undecodable");
  assert.equal(ATTACHMENT_CONTENT_KIND, 250);
});

// ---------- spec 0013 capabilities and spec 0014 FileVariant 1: the pinned vectors ----------
// The bytes are in polkadot-chat-desktop docs/spec/0013-capabilities.md
// ("Test vector") and docs/spec/vectors-0014.md (A and B). Both were computed
// by a Python SCALE encoder and scale-ts; a difference here is a wire bug.
import {
  CAPABILITIES_CONTENT_KIND,
  FILE_VARIANTS,
  HOP_DIALECTS,
  encodeOpaqueCapabilitiesMessage,
} from "../vendor/app-chat-codec.mjs";

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const CAP_1_HEX = "ec144341502d310030fd779001000000fc01b7ff37000000000000000000000000000000000000000000000000000000ff1f08000108000103000000";
const CAP_1 = {
  messageId: "CAP-1", timestamp: 1720000000000, version: 1,
  kinds: [0, 1, 2, 4, 5, ...range(7, 18), 20, 21, ...range(240, 252)],
  fileVariants: [FILE_VARIANTS.p2pMixnet, FILE_VARIANTS.bulletin],
  hopDialects: [HOP_DIALECTS.legacy, HOP_DIALECTS.aesGcm],
  features: 3,
};

test("0013 vector: capabilities encode to the pinned 60 bytes and decode back", () => {
  const bytes = encodeOpaqueCapabilitiesMessage(CAP_1);
  assert.equal(bytes.length, 60);
  assert.equal(hexOf(bytes), CAP_1_HEX);
  const d = decodeOne(hex(CAP_1_HEX));
  assert.equal(d.kind, "capabilities");
  assert.equal(d.messageId, "CAP-1");
  assert.deepEqual(d.capabilities, { version: 1, kinds: CAP_1.kinds, fileVariants: [0, 1], hopDialects: [0, 1], features: 3 });
  assert.equal(CAPABILITIES_CONTENT_KIND, 252);
});

test("0013 forward rule: bytes after features are ignored; unknown bits and values survive", () => {
  // A later version appends a field: the opaque length grows, the known fields still read.
  const content = hex(CAP_1_HEX).subarray(1);
  const longer = new Uint8Array([...content, 0xaa, 0xbb]);
  const framed = new Uint8Array([longer.length << 2, ...longer]); // 61 bytes: one-byte compact length
  const d = decodeOne(framed);
  assert.equal(d.kind, "capabilities");
  assert.deepEqual(d.capabilities.fileVariants, [0, 1]);
  assert.equal(d.capabilities.features, 3);
  const odd = decodeOne(encodeOpaqueCapabilitiesMessage({ ...CAP_1, kinds: [255], fileVariants: [7], hopDialects: [9], features: 0x8000_0000 }));
  assert.deepEqual([odd.capabilities.kinds, odd.capabilities.fileVariants, odd.capabilities.hopDialects, odd.capabilities.features], [[255], [7], [9], 0x8000_0000]);
});

const v14 = (() => {
  const toVariant = (item) => ({ kind: "bulletinFile", ...item });
  return {
    A: { messageId: "ATT-1", timestamp: 1720000000000, text: "Our cat", attachments: v12.A.items.map(toVariant) },
    B: { messageId: "ATT-2", timestamp: 1720000000000, text: null, attachments: v12.B.items.map(toVariant) },
    hexA: "0103144154542d310030fd7790010000000f011c4f7572206361740104010128696d6167652f6a7065670f00000080020000e001000001304c454856366e574232796b38000000111111111111111111111111111111111111111111111111111111111111111122222222222222222222222280841e0004d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a00e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5900003816c090010000",
    hexB: "4904144154542d320030fd7790010000000f000104010058617564696f2f6f67673b20636f646563733d6f7075730d0000000000016810000010004080ff11111111111111111111111111111111111111111111111111111111111111112222222222222222222222220800000008f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb47e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a800e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5901e868747470733a2f2f6465766e65742d697066732e6170692e706f6c6b61646f74636f6d6d756e6974792e666f756e646174696f6e2f697066732f003816c090010000",
  };
})();

test("0014 vector A: an image as RichText + bulletin encodes to the pinned 194 bytes and maps to its kind-250 twin", () => {
  const bytes = encodeOpaqueRichTextMessage(v14.A);
  assert.equal(bytes.length, 194);
  assert.equal(hexOf(bytes), v14.hexA);
  const d = decodeOne(hex(v14.hexA));
  assert.equal(d.kind, "richText");
  assert.equal(d.text, "Our cat");
  const [item] = d.richText.attachments;
  assert.equal(item.kind, "bulletinFile");
  // Same fields as the decoded kind-250 item of 0012 vector A: one receive path.
  const twin = decodeOne(hex(v12.hexA)).items[0];
  assert.deepEqual({ ...item, kind: undefined }, { ...twin, kind: undefined });
  assert.equal(hexOf(encodeOpaqueRichTextMessage({ ...v14.A, attachments: d.richText.attachments })), v14.hexA);
});

test("0014 vector B: a voice note as RichText + bulletin encodes to the pinned 276 bytes and decodes back", () => {
  const bytes = encodeOpaqueRichTextMessage(v14.B);
  assert.equal(bytes.length, 276);
  assert.equal(hexOf(bytes), v14.hexB);
  const d = decodeOne(hex(v14.hexB));
  const [item] = d.richText.attachments;
  assert.deepEqual(item.media, { kind: "voice", durationMs: 4200, waveform: [0, 64, 128, 255] });
  assert.equal(item.store.mirror, "https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/");
  assert.equal(d.richText.text, null);
  assert.equal(hexOf(encodeOpaqueRichTextMessage({ ...v14.B, attachments: d.richText.attachments })), v14.hexB);
});

test("0014 rules: a RichText never mixes rails; an unknown FileVariant index makes only that message undecodable", () => {
  const hop = { identifier: new Uint8Array(32), claimTicket: new Uint8Array(32), wssUrl: "wss://hop.example", mimeType: "image/png", fileSize: 3 };
  assert.throws(() => encodeOpaqueRichTextMessage({ text: null, attachments: [hop, v14.A.attachments[0]] }), /never mixes/);
  const bad = hex(v14.hexA);
  bad[v14.hexA.indexOf("0104010128") / 2 + 2] = 2; // FileVariant index 2
  assert.equal(decodeOne(bad).kind, "undecodable");
});
