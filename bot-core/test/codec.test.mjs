import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeOpaqueMessageAt,
  encodeOpaqueTextMessage,
  encodeOpaqueReactionMessage,
  encodeOpaqueReplyMessage,
  encodeOpaqueEditedMessage,
  encodeOpaqueDataChannelClosedMessage,
  scaleEncodeBytes,
} from "../vendor/app-chat-codec.mjs";

const enc = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};
const str = (s) => scaleEncodeBytes(enc.encode(s));
const u32 = (n) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
const u64 = (n) => {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};
const decodeOne = (opaque) => decodeOpaqueMessageAt(opaque, 0).value;

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
