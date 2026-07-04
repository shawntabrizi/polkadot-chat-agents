import crypto from "node:crypto";

import { blake2b } from "@noble/hashes/blake2.js";
import { verify as sr25519Verify } from "@scure/sr25519";

const CHAT_REQUEST_CONTEXT = new TextEncoder().encode("chat-request");
const CHAT_SESSION_CONTEXT = new TextEncoder().encode("session");
const CHAT_REQUEST_CHANNEL_CONTEXT = new TextEncoder().encode("request");
const CHAT_RESPONSE_CHANNEL_CONTEXT = new TextEncoder().encode("response");
const CHAT_REQUEST_DAY_UNIX_OFFSET_SECS = 1_763_164_800;
const CHAT_REQUEST_IDENTITY_PROOF_CONTEXT = "mds-chat-request";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function concatBytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function hexToBytes(hex) {
  const clean = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`Invalid hex value: ${hex}`);
  }
  return Uint8Array.from(clean.match(/../g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

function normalizeHex(hex) {
  return hex.trim().toLowerCase().replace(/^0x/, "");
}

function blake2b32(data, key) {
  return blake2b(data, { dkLen: 32, key });
}

function scaleCompactEncodeLength(length) {
  if (length < 0) {
    throw new Error(`Invalid compact length: ${length}`);
  }
  if (length < 64) {
    return Uint8Array.of(length << 2);
  }
  if (length < 16_384) {
    const encoded = (length << 2) | 0x01;
    return Uint8Array.of(encoded & 0xff, encoded >> 8);
  }
  if (length < 1_073_741_824) {
    const encoded = (length << 2) | 0x02;
    return Uint8Array.of(
      encoded & 0xff,
      (encoded >> 8) & 0xff,
      (encoded >> 16) & 0xff,
      (encoded >> 24) & 0xff,
    );
  }
  throw new Error(`Compact length too large: ${length}`);
}

function scaleCompactDecode(bytes, offset = 0) {
  const first = bytes[offset];
  if (first == null) {
    throw new Error(`Missing compact byte at ${offset}`);
  }

  const mode = first & 0x03;
  if (mode === 0) {
    return { value: first >> 2, offset: offset + 1 };
  }
  if (mode === 1) {
    return { value: ((first | (bytes[offset + 1] << 8)) >> 2), offset: offset + 2 };
  }
  if (mode === 2) {
    const raw =
      first |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    return { value: raw >>> 2, offset: offset + 4 };
  }

  const byteLength = (first >> 2) + 4;
  let value = 0;
  for (let index = 0; index < byteLength; index += 1) {
    value += bytes[offset + 1 + index] * 2 ** (8 * index);
  }
  return { value, offset: offset + 1 + byteLength };
}

function scaleEncodeCompactBigInt(value) {
  const normalized = BigInt(value);
  if (normalized < 0n) {
    throw new Error(`Invalid compact integer: ${value}`);
  }
  if (normalized < 1n << 6n) {
    return Uint8Array.of(Number(normalized << 2n));
  }
  if (normalized < 1n << 14n) {
    const encoded = Number((normalized << 2n) | 0x01n);
    return Uint8Array.of(encoded & 0xff, (encoded >> 8) & 0xff);
  }
  if (normalized < 1n << 30n) {
    const encoded = Number((normalized << 2n) | 0x02n);
    return Uint8Array.of(
      encoded & 0xff,
      (encoded >> 8) & 0xff,
      (encoded >> 16) & 0xff,
      (encoded >> 24) & 0xff,
    );
  }

  const valueBytes = [];
  let remaining = normalized;
  while (remaining > 0n) {
    valueBytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  while (valueBytes.length < 4) {
    valueBytes.push(0);
  }
  if (valueBytes.length > 67) {
    throw new Error(`Compact integer too large: ${value}`);
  }

  return Uint8Array.of(((valueBytes.length - 4) << 2) | 0x03, ...valueBytes);
}

function scaleDecodeCompactBigIntAt(bytes, offset = 0) {
  const first = bytes[offset];
  if (first == null) {
    throw new Error(`Missing compact byte at ${offset}`);
  }

  const mode = first & 0x03;
  if (mode === 0) {
    return { value: BigInt(first >> 2), offset: offset + 1 };
  }
  if (mode === 1) {
    return {
      value: BigInt((first | (bytes[offset + 1] << 8)) >> 2),
      offset: offset + 2,
    };
  }
  if (mode === 2) {
    const raw =
      first |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    return { value: BigInt(raw >>> 2), offset: offset + 4 };
  }

  const byteLength = (first >> 2) + 4;
  let value = 0n;
  for (let index = 0; index < byteLength; index += 1) {
    value |= BigInt(bytes[offset + 1 + index]) << BigInt(8 * index);
  }
  return { value, offset: offset + 1 + byteLength };
}

export function scaleEncodeBytes(bytes) {
  return concatBytes(scaleCompactEncodeLength(bytes.length), bytes);
}

function scaleDecodeBytesAt(bytes, offset = 0) {
  const length = scaleCompactDecode(bytes, offset);
  const end = length.offset + length.value;
  if (end > bytes.length) {
    throw new Error(`SCALE bytes exceed buffer at ${offset}`);
  }
  return { value: bytes.slice(length.offset, end), offset: end };
}

function scaleEncodeString(value) {
  return scaleEncodeBytes(textEncoder.encode(value));
}

export function encodeChatRequestProofPayload(messageBytes, acceptorAccountId) {
  return concatBytes(messageBytes, scaleEncodeBytes(acceptorAccountId));
}

function scaleDecodeStringAt(bytes, offset = 0) {
  const decoded = scaleDecodeBytesAt(bytes, offset);
  return { value: textDecoder.decode(decoded.value), offset: decoded.offset };
}

function scaleEncodeOption(encodedValue) {
  return encodedValue == null ? Uint8Array.of(0) : concatBytes(Uint8Array.of(1), encodedValue);
}

function scaleDecodeOptionAt(bytes, offset, decodeInner) {
  const tag = bytes[offset];
  if (tag === 0) {
    return { value: null, offset: offset + 1 };
  }
  if (tag !== 1) {
    throw new Error(`Invalid SCALE option tag ${tag} at ${offset}`);
  }
  return decodeInner(bytes, offset + 1);
}

function scaleEncodeArray(encodedItems) {
  return concatBytes(scaleCompactEncodeLength(encodedItems.length), ...encodedItems);
}

function scaleDecodeArrayAt(bytes, offset, decodeInner) {
  const length = scaleCompactDecode(bytes, offset);
  const items = [];
  let itemOffset = length.offset;
  for (let index = 0; index < length.value; index += 1) {
    const decoded = decodeInner(bytes, itemOffset);
    items.push(decoded.value);
    itemOffset = decoded.offset;
  }
  return { value: items, offset: itemOffset };
}

function scaleEncodeUInt64(value) {
  const encoded = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 0; index < 8; index += 1) {
    encoded[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return encoded;
}

function scaleDecodeUInt64At(bytes, offset = 0) {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(bytes[offset + index]) << BigInt(8 * index);
  }
  return { value, offset: offset + 8 };
}

function chatTimestampNow() {
  return BigInt(Date.now());
}

export function makeAppUuid() {
  return crypto.randomUUID().toUpperCase();
}

// Desktop generates chat message IDs with nanoid at two lengths: nanoid(12)
// on the P2P chat-transport path and nanoid(32) on the product/local chat
// path (confirmed in polkadot-desktop; default URL-safe alphabet, no custom
// alphabet). Match both. Mobile uses a 36-char hyphenated UUID
// (crypto.randomUUID()), so neither length can collide with a real mobile ID.
const DESKTOP_NANOID_MESSAGE_ID_PATTERN = /^(?:[A-Za-z0-9_-]{12}|[A-Za-z0-9_-]{32})$/;

export function isDesktopNanoidMessageId(messageId) {
  return typeof messageId === "string" && DESKTOP_NANOID_MESSAGE_ID_PATTERN.test(messageId);
}

export function isDesktopLikeChatRequest(decodedRequest) {
  return isDesktopNanoidMessageId(decodedRequest?.messageId);
}

export function deriveP256PrivateKey(chatSr25519Pair) {
  const privateKey = chatSr25519Pair.privateKey;
  if (privateKey == null) {
    throw new Error("Cannot derive chat P-256 key without sr25519 private key material");
  }
  return blake2b32(privateKey.slice(0, 32));
}

export function p256PublicKeyFromPrivateKey(privateKey) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKey));
  return new Uint8Array(ecdh.getPublicKey(null, "uncompressed"));
}

function p256EphemeralKeypair() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: new Uint8Array(ecdh.getPrivateKey()),
    publicKey: new Uint8Array(ecdh.getPublicKey(null, "uncompressed")),
  };
}

function p256SharedSecret(privateKey, peerPublicKey) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKey));
  return new Uint8Array(ecdh.computeSecret(Buffer.from(peerPublicKey)));
}

function aesKeyFromSharedSecret(sharedSecret) {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(sharedSecret), Buffer.alloc(0), Buffer.alloc(0), 32));
}

function aesGcmEncrypt(sharedSecret, data) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKeyFromSharedSecret(sharedSecret), nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([nonce, ciphertext, tag]));
}

function aesGcmEncryptRawKey(rawKey, data) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(rawKey), nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([nonce, ciphertext, tag]));
}

export function aesGcmDecrypt(sharedSecret, encryptedData) {
  const encrypted = Buffer.from(encryptedData);
  if (encrypted.length < 28) {
    throw new Error("AES-GCM payload is too short");
  }

  const nonce = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(12, encrypted.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKeyFromSharedSecret(sharedSecret), nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

function aesGcmDecryptRawKey(rawKey, encryptedData) {
  const encrypted = Buffer.from(encryptedData);
  if (encrypted.length < 28) {
    throw new Error("AES-GCM payload is too short");
  }

  const nonce = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(12, encrypted.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(rawKey), nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function makePeerSession({
  ownAccountId,
  peerAccountId,
  peerIdentifierKey,
  ownP256PrivateKey,
  ownDeviceP256PrivateKey = ownP256PrivateKey,
  peerDevices = [],
  ownPin = null,
  peerPin = null,
}) {
  const sharedSecret = p256SharedSecret(ownDeviceP256PrivateKey, peerIdentifierKey);
  const identitySharedSecret = p256SharedSecret(ownP256PrivateKey, peerIdentifierKey);
  const deviceInfos = peerDevices.map((device) => {
    const statementAccountId = typeof device.statementAccountId === "string"
      ? hexToBytes(device.statementAccountId)
      : device.statementAccountId;
    const encryptionPublicKey = typeof device.encryptionPublicKey === "string"
      ? hexToBytes(device.encryptionPublicKey)
      : device.encryptionPublicKey;
    const deviceSharedSecret = p256SharedSecret(ownDeviceP256PrivateKey, encryptionPublicKey);
    const incomingSharedSecret = p256SharedSecret(ownP256PrivateKey, encryptionPublicKey);
    const incoming = makeSessionParts(
      ownAccountId,
      statementAccountId,
      incomingSharedSecret,
      ownPin,
      peerPin,
    );

    return {
      statementAccountId,
      statementAccountIdHex: normalizeHex(bytesToHex(statementAccountId)),
      encryptionPublicKey,
      encryptionPublicKeyHex: normalizeHex(bytesToHex(encryptionPublicKey)),
      sharedSecret: deviceSharedSecret,
      incomingSharedSecret,
      incomingSession: {
        ...incoming,
        sharedSecret: incomingSharedSecret,
        multiDeviceKeySharedSecret: deviceSharedSecret,
        multiDevicePeerPublicKey: encryptionPublicKey,
        peerStatementAccountId: statementAccountId,
      },
    };
  });

  const session = makeSessionParts(ownAccountId, peerAccountId, sharedSecret, ownPin, peerPin);
  return {
    ...session,
    sharedSecret,
    identitySharedSecret,
    multiDeviceKeySharedSecret: deviceInfos[0]?.sharedSecret ?? sharedSecret,
    ownDeviceP256PrivateKey,
    ownAccountId,
    peerAccountId,
    peerIdentifierKey,
    peerDevices: deviceInfos,
    incomingDeviceSessions: deviceInfos.map((device) => device.incomingSession),
  };
}

function makeSessionParts(ownAccountId, peerAccountId, sharedSecret, ownPin, peerPin) {
  const ownParameter = makeRawSessionParameter(ownAccountId, peerAccountId, ownPin, peerPin);
  const peerParameter = makeRawSessionParameter(peerAccountId, ownAccountId, peerPin, ownPin);
  const ownSessionId = blake2b32(concatBytes(CHAT_SESSION_CONTEXT, ownParameter), sharedSecret);
  const peerSessionId = blake2b32(concatBytes(CHAT_SESSION_CONTEXT, peerParameter), sharedSecret);
  const requestChannel = blake2b32(CHAT_REQUEST_CHANNEL_CONTEXT, ownSessionId);
  const responseChannel = blake2b32(CHAT_RESPONSE_CHANNEL_CONTEXT, ownSessionId);
  const peerRequestChannel = blake2b32(CHAT_REQUEST_CHANNEL_CONTEXT, peerSessionId);
  const incomingRequestChannel = chatRequestChannel(peerParameter, sharedSecret);
  const outgoingRequestChannel = chatRequestChannel(ownParameter, sharedSecret);

  return {
    ownAccountId,
    peerAccountId,
    sharedSecret,
    ownParameter,
    peerParameter,
    ownSessionId,
    peerSessionId,
    requestChannel,
    responseChannel,
    peerRequestChannel,
    incomingRequestChannel,
    outgoingRequestChannel,
  };
}

function makeRawSessionParameter(firstAccountId, secondAccountId, firstPin, secondPin) {
  return concatBytes(
    firstAccountId,
    secondAccountId,
    makePinPart(firstPin),
    makePinPart(secondPin),
  );
}

function makePinPart(pin) {
  return pin == null ? textEncoder.encode("/") : textEncoder.encode(`/${pin}`);
}

function chatRequestChannel(sessionParameter, sharedSecret) {
  return blake2b32(concatBytes(CHAT_REQUEST_CONTEXT, sessionParameter), sharedSecret);
}

export function chatRequestDayFromUnixSeconds(unixSeconds) {
  const timestampDiff = unixSeconds - CHAT_REQUEST_DAY_UNIX_OFFSET_SECS;
  if (timestampDiff < 0) {
    return null;
  }
  return Math.floor(timestampDiff / 86_400);
}

export function chatRequestAllPeerStatementsTopic(accountId) {
  return blake2b32(concatBytes(scaleEncodeBytes(CHAT_REQUEST_CONTEXT), scaleEncodeBytes(accountId)));
}

export function chatRequestPaginationTopic(accountId, day) {
  return blake2b32(
    concatBytes(
      scaleEncodeBytes(CHAT_REQUEST_CONTEXT),
      scaleEncodeBytes(accountId),
      scaleEncodeUInt64(BigInt(day)),
    ),
  );
}

export function encodeNativeChatRequestV2({
  walletPair,
  botAccountId,
  botIdentifierKey,
  ownP256PrivateKey,
  ownP256PublicKey = p256PublicKeyFromPrivateKey(ownP256PrivateKey),
  text,
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
}) {
  const identitySharedSecret = p256SharedSecret(ownP256PrivateKey, botIdentifierKey);
  const identityProof = blake2b32(
    concatBytes(
      walletPair.publicKey,
      walletPair.publicKey,
      scaleEncodeString(CHAT_REQUEST_IDENTITY_PROOF_CONTEXT),
    ),
    identitySharedSecret,
  );
  const messageBytes = concatBytes(
    scaleEncodeString(messageId),
    scaleEncodeUInt64(BigInt(timestamp)),
    Uint8Array.of(1),
    walletPair.publicKey,
    identityProof,
    ownP256PublicKey,
    Uint8Array.of(0),
    Uint8Array.of(1),
    Uint8Array.of(1),
    scaleEncodeString(text),
    Uint8Array.of(0),
  );
  const proofPayload = encodeChatRequestProofPayload(messageBytes, botAccountId);
  const signature = walletPair.sign(proofPayload);
  const remoteModel = concatBytes(
    messageBytes,
    Uint8Array.of(0),
    signature,
    walletPair.publicKey,
  );
  const envelopeKey = p256EphemeralKeypair();
  const encrypted = aesGcmEncrypt(p256SharedSecret(envelopeKey.privateKey, botIdentifierKey), remoteModel);
  const statementData = concatBytes(scaleEncodeBytes(envelopeKey.publicKey), scaleEncodeBytes(encrypted));
  const payload = scaleEncodeBytes(statementData);
  return {
    messageId,
    payload,
    scaleEncodedPayload: payload,
    statementData,
    envelopeIdentifierKeyHex: normalizeHex(bytesToHex(envelopeKey.publicKey)),
  };
}

export function decodeEncryptedChatRequestPayload(payload, ownP256PrivateKey, ownAccountId) {
  let remotePayloadBytes = payload;
  try {
    const wrapped = scaleDecodeBytesAt(payload, 0);
    if (wrapped.offset === payload.length) {
      remotePayloadBytes = wrapped.value;
    }
  } catch {
    remotePayloadBytes = payload;
  }

  let offset = 0;
  const encryptionPubKey = scaleDecodeBytesAt(remotePayloadBytes, offset);
  offset = encryptionPubKey.offset;
  const encryptedData = scaleDecodeBytesAt(remotePayloadBytes, offset);
  if (encryptedData.offset !== remotePayloadBytes.length) {
    throw new Error("Encrypted chat request model has trailing bytes");
  }

  const requestSharedSecret = p256SharedSecret(ownP256PrivateKey, encryptionPubKey.value);
  const decrypted = aesGcmDecrypt(requestSharedSecret, encryptedData.value);
  const remoteModel = decodeChatRequestRemoteModel(decrypted);
  const proofPayload = encodeChatRequestProofPayload(remoteModel.messageBytes, ownAccountId);
  const isValid = sr25519Verify(proofPayload, remoteModel.proof.signature, remoteModel.proof.signer);

  if (!isValid) {
    throw new Error("Invalid chat request proof");
  }

  return {
    ...remoteModel.message,
    peerAccountId: remoteModel.message.identityProof?.identityAccountId ?? remoteModel.proof.signer,
    peerAccountIdHex: normalizeHex(bytesToHex(remoteModel.message.identityProof?.identityAccountId ?? remoteModel.proof.signer)),
    peerStatementAccountId: remoteModel.proof.signer,
    peerStatementAccountIdHex: normalizeHex(bytesToHex(remoteModel.proof.signer)),
    encryptionPubKeyHex: normalizeHex(bytesToHex(encryptionPubKey.value)),
    proofSigner: remoteModel.proof.signer,
    requestProofFormat: "app-scale",
  };
}

export function verifyChatRequestIdentityProof(decodedRequest, ownP256PrivateKey, peerIdentityPublicKey) {
  if (decodedRequest.identityProof == null) {
    return true;
  }

  const sharedSecret = p256SharedSecret(ownP256PrivateKey, peerIdentityPublicKey);
  const payload = concatBytes(
    decodedRequest.identityProof.identityAccountId,
    decodedRequest.peerStatementAccountId,
    scaleEncodeString(CHAT_REQUEST_IDENTITY_PROOF_CONTEXT),
  );
  const expected = blake2b32(payload, sharedSecret);
  return Buffer.from(expected).equals(Buffer.from(decodedRequest.identityProof.proof));
}

function decodeChatRequestRemoteModel(bytes) {
  const message = decodeChatRequestMessageAt(bytes, 0);
  const proof = decodeStatementProofAt(bytes, message.offset);
  return {
    message: message.value,
    messageBytes: bytes.slice(0, message.offset),
    proof: proof.value,
    offset: proof.offset,
  };
}

function decodeChatRequestMessageAt(bytes, offset = 0) {
  const start = offset;
  const messageId = scaleDecodeStringAt(bytes, offset);
  offset = messageId.offset;
  const timestamp = scaleDecodeUInt64At(bytes, offset);
  offset = timestamp.offset;
  const version = bytes[offset];
  if (version !== 0 && version !== 1) {
    throw new Error(`Unsupported chat request content version: ${version}`);
  }
  offset += 1;

  let identityProof = null;
  let deviceEncPubKey = null;
  if (version === 1) {
    const identityAccountId = bytes.slice(offset, offset + 32);
    offset += 32;
    const proof = bytes.slice(offset, offset + 32);
    offset += 32;
    deviceEncPubKey = bytes.slice(offset, offset + 65);
    offset += 65;
    identityProof = { identityAccountId, proof };
  }

  const pushToken = scaleDecodeOptionAt(bytes, offset, decodeRemoteTokenContentAt);
  offset = pushToken.offset;
  const welcomeMessage = scaleDecodeOptionAt(bytes, offset, decodeRichTextAt);
  offset = welcomeMessage.offset;

  return {
    value: {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      text: welcomeMessage.value?.text ?? "",
      welcomeMessage: welcomeMessage.value,
      pushToken: pushToken.value,
      requestContentVersion: version === 0 ? "v1" : "v2",
      identityProof,
      deviceEncPubKey,
      deviceEncPubKeyHex: deviceEncPubKey == null ? null : normalizeHex(bytesToHex(deviceEncPubKey)),
    },
    messageBytes: bytes.slice(start, offset),
    offset,
  };
}

function decodeRemoteTokenContentAt(bytes, offset) {
  const token = scaleDecodeBytesAt(bytes, offset);
  const pushType = bytes[token.offset];
  return {
    value: { token: token.value, pushType },
    offset: token.offset + 1,
  };
}

function decodeRichTextAt(bytes, offset) {
  const text = scaleDecodeOptionAt(bytes, offset, scaleDecodeStringAt);
  offset = text.offset;
  const attachments = scaleDecodeOptionAt(bytes, offset, decodeUnsupportedAttachmentsAt);
  return {
    value: { text: text.value, attachments: attachments.value },
    offset: attachments.offset,
  };
}

function decodeUnsupportedAttachmentsAt(bytes, offset) {
  const decoded = scaleDecodeArrayAt(bytes, offset, (attachmentBytes, attachmentOffset) => {
    throw new Error(`Unsupported rich-text attachment at ${attachmentOffset}`);
  });
  return decoded;
}

function decodeStatementProofAt(bytes, offset = 0) {
  const proofKind = bytes[offset];
  if (proofKind !== 0) {
    throw new Error(`Unsupported statement proof kind: ${proofKind}`);
  }
  const signatureStart = offset + 1;
  const signatureEnd = signatureStart + 64;
  const signerEnd = signatureEnd + 32;
  return {
    value: {
      kind: "sr25519",
      signature: bytes.slice(signatureStart, signatureEnd),
      signer: bytes.slice(signatureEnd, signerEnd),
    },
    offset: signerEnd,
  };
}

export function encodeOpaqueTextMessage({ messageId = makeAppUuid(), timestamp = chatTimestampNow(), text }) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(0), scaleEncodeString(text)),
  });
}

export function encodeOpaqueChatAcceptedMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  acceptedRequestId,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(14), scaleEncodeString(acceptedRequestId)),
  });
}

export function encodeOpaqueMultiChatAcceptedMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  acceptedRequestId,
  statementAccountId,
  encryptionPublicKey,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(
      Uint8Array.of(20),
      scaleEncodeString(acceptedRequestId),
      statementAccountId,
      encryptionPublicKey,
    ),
  });
}

export function encodeOpaqueCoinageSendMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  totalValue,
  coinKeys,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(
      Uint8Array.of(16),
      scaleEncodeCompactBigInt(BigInt(totalValue)),
      scaleEncodeArray(coinKeys.map((coinKey) => scaleEncodeBytes(coinKey))),
    ),
  });
}

function encodeOpaqueRemoteMessage({ messageId, timestamp, content }) {
  const remoteMessage = concatBytes(
    scaleEncodeString(messageId),
    scaleEncodeUInt64(BigInt(timestamp)),
    Uint8Array.of(0),
    content,
  );
  return scaleEncodeBytes(remoteMessage);
}

function scaleEncodeUInt128(value) {
  const encoded = new Uint8Array(16);
  let remaining = BigInt(value);
  for (let index = 0; index < 16; index += 1) {
    encoded[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return encoded;
}

function encodeMessageExchangeRequestPayload(requestId, opaqueMessages) {
  return concatBytes(
    scaleEncodeString(requestId),
    scaleEncodeArray(opaqueMessages),
  );
}

function encodeMessageExchangeResponsePayload(requestId, responseCode = 0) {
  return concatBytes(
    scaleEncodeString(requestId),
    Uint8Array.of(responseCode),
  );
}

export function encodeStatementDataRequest(requestId, opaqueMessages) {
  return concatBytes(
    Uint8Array.of(0),
    encodeMessageExchangeRequestPayload(requestId, opaqueMessages),
  );
}

export function encodeStatementDataResponse(requestId, responseCode = 0) {
  return concatBytes(
    Uint8Array.of(1),
    encodeMessageExchangeResponsePayload(requestId, responseCode),
  );
}

export function encodeStatementDataMultiRequest(requestId, opaqueMessages, session) {
  return concatBytes(
    Uint8Array.of(2),
    encodeMultiDeviceEnvelope(encodeMessageExchangeRequestPayload(requestId, opaqueMessages), session),
  );
}

export function encodeStatementDataMultiResponse(requestId, responseCode, session) {
  return concatBytes(
    Uint8Array.of(3),
    encodeMultiDeviceEnvelope(encodeMessageExchangeResponsePayload(requestId, responseCode), session),
  );
}

function encodeMultiDeviceEnvelope(innerPayload, session) {
  if (!Array.isArray(session?.peerDevices) || session.peerDevices.length === 0) {
    throw new Error("Cannot encode multi-device envelope without peer devices");
  }

  const oneshotKey = crypto.randomBytes(32);
  const encryptedPayload = aesGcmEncryptRawKey(oneshotKey, innerPayload);
  const devicesInfo = session.peerDevices.map((device) => {
    const keySharedSecret = device.sharedSecret ?? p256SharedSecret(session.ownDeviceP256PrivateKey, device.encryptionPublicKey);
    return concatBytes(
      device.statementAccountId,
      scaleEncodeBytes(aesGcmEncrypt(keySharedSecret, oneshotKey)),
    );
  });

  return concatBytes(
    scaleEncodeBytes(encryptedPayload),
    scaleEncodeArray(devicesInfo),
  );
}

export function encodeEncryptedStatementPayload(statementDataBytes, sharedSecret) {
  return scaleEncodeBytes(aesGcmEncrypt(sharedSecret, statementDataBytes));
}

export function encodeSessionRequestPayload(session, requestId, opaqueMessages, options = {}) {
  const useMultiDevice = !options.forceIdentity && (session.peerDevices?.length ?? 0) > 0;
  const statementData = useMultiDevice
    ? encodeStatementDataMultiRequest(requestId, opaqueMessages, session)
    : encodeStatementDataRequest(requestId, opaqueMessages);
  const sharedSecret = useMultiDevice
    ? session.sharedSecret
    : (session.identitySharedSecret ?? session.sharedSecret);
  return encodeEncryptedStatementPayload(statementData, sharedSecret);
}

export function encodeSessionResponsePayload(session, requestId, responseCode = 0, options = {}) {
  const useMultiDevice = !options.forceIdentity && (session.peerDevices?.length ?? 0) > 0;
  const statementData = useMultiDevice
    ? encodeStatementDataMultiResponse(requestId, responseCode, session)
    : encodeStatementDataResponse(requestId, responseCode);
  const sharedSecret = useMultiDevice
    ? session.sharedSecret
    : (session.identitySharedSecret ?? session.sharedSecret);
  return encodeEncryptedStatementPayload(statementData, sharedSecret);
}

export function decodeSessionStatementPayload(data, session, senderAccountId = null) {
  try {
    return decodeEncryptedStatementPayload(data, session.sharedSecret, session, senderAccountId);
  } catch {
    return decodeStatementData(aesGcmDecrypt(session.sharedSecret, data), session, senderAccountId);
  }
}

export function decodeEncryptedStatementPayload(payload, sharedSecret, session = null, senderAccountId = null) {
  const encrypted = scaleDecodeBytesAt(payload, 0);
  const decrypted = aesGcmDecrypt(sharedSecret, encrypted.value);
  return decodeStatementData(decrypted, session, senderAccountId);
}

export function decodeStatementData(bytes, session = null, senderAccountId = null) {
  const kind = bytes[0];
  if (kind === 0) {
    const request = decodeMessageExchangeRequestAt(bytes, 1);
    return { kind: "request", ...request.value, offset: request.offset };
  }
  if (kind === 1) {
    const response = decodeMessageExchangeResponseAt(bytes, 1);
    return { kind: "response", ...response.value, offset: response.offset };
  }
  if (kind === 2) {
    const multiRequest = decodeMultiDeviceEnvelopeAt(bytes, 1);
    if (session == null) {
      return { kind: "multirequest", ...multiRequest.value, offset: multiRequest.offset };
    }
    const requestBytes = decodeMultiDeviceInnerPayload(multiRequest.value, session, senderAccountId);
    const request = decodeMessageExchangeRequestAt(requestBytes, 0);
    return { kind: "request", multiDevice: true, ...request.value, offset: multiRequest.offset };
  }
  if (kind === 3) {
    const multiResponse = decodeMultiDeviceEnvelopeAt(bytes, 1);
    if (session == null) {
      return { kind: "multiresponse", ...multiResponse.value, offset: multiResponse.offset };
    }
    const responseBytes = decodeMultiDeviceInnerPayload(multiResponse.value, session, senderAccountId);
    const response = decodeMessageExchangeResponseAt(responseBytes, 0);
    return { kind: "response", multiDevice: true, ...response.value, offset: multiResponse.offset };
  }
  throw new Error(`Unsupported statement data kind: ${kind}`);
}

function decodeMultiDeviceEnvelopeAt(bytes, offset) {
  const encryptedPayload = scaleDecodeBytesAt(bytes, offset);
  const devicesInfo = scaleDecodeArrayAt(bytes, encryptedPayload.offset, decodeRequestDeviceInfoAt);
  return {
    value: {
      encryptedPayload: encryptedPayload.value,
      devicesInfo: devicesInfo.value,
    },
    offset: devicesInfo.offset,
  };
}

function decodeRequestDeviceInfoAt(bytes, offset) {
  const statementAccountId = bytes.slice(offset, offset + 32);
  const encryptedKey = scaleDecodeBytesAt(bytes, offset + 32);
  return {
    value: {
      statementAccountId,
      statementAccountIdHex: normalizeHex(bytesToHex(statementAccountId)),
      encryptedKey: encryptedKey.value,
    },
    offset: encryptedKey.offset,
  };
}

function decodeMultiDeviceInnerPayload(envelope, session, senderAccountId = null) {
  const ownAccountIdHex = normalizeHex(bytesToHex(session.ownAccountId));
  const senderAccountIdHex = senderAccountId == null ? null : normalizeHex(bytesToHex(senderAccountId));

  if (senderAccountIdHex === ownAccountIdHex) {
    for (const device of session.peerDevices ?? []) {
      const peerEntry = envelope.devicesInfo.find((entry) => (
        entry.statementAccountIdHex === device.statementAccountIdHex
      ));
      if (peerEntry != null) {
        const oneshotKey = aesGcmDecrypt(device.sharedSecret, peerEntry.encryptedKey);
        return aesGcmDecryptRawKey(oneshotKey, envelope.encryptedPayload);
      }
    }
    throw new Error("Own multi-device payload has no known peer device entry");
  }

  const ownDeviceEntry = envelope.devicesInfo.find((entry) => entry.statementAccountIdHex === ownAccountIdHex);
  if (ownDeviceEntry == null) {
    throw new Error("Peer multi-device payload has no entry for own statement account");
  }

  const keySharedSecret = session.multiDeviceKeySharedSecret ?? session.sharedSecret;
  const oneshotKey = aesGcmDecrypt(keySharedSecret, ownDeviceEntry.encryptedKey);
  return aesGcmDecryptRawKey(oneshotKey, envelope.encryptedPayload);
}

function decodeMessageExchangeRequestAt(bytes, offset) {
  const requestId = scaleDecodeStringAt(bytes, offset);
  offset = requestId.offset;
  const messages = scaleDecodeArrayAt(bytes, offset, decodeOpaqueMessageAt);
  return {
    value: {
      requestId: requestId.value,
      messages: messages.value,
    },
    offset: messages.offset,
  };
}

function decodeMessageExchangeResponseAt(bytes, offset) {
  const requestId = scaleDecodeStringAt(bytes, offset);
  return {
    value: {
      requestId: requestId.value,
      responseCode: bytes[requestId.offset],
    },
    offset: requestId.offset + 1,
  };
}

function decodeOpaqueMessageAt(bytes, offset) {
  const opaque = scaleDecodeBytesAt(bytes, offset);
  // Each opaque message is length-prefixed, so one undecodable message (e.g. a
  // rich-text image attachment) must not abort the rest of the batch — the app
  // resends its whole unacked backlog as a single request.
  let decoded;
  try {
    decoded = decodeRemoteMessage(opaque.value);
  } catch (error) {
    decoded = { kind: "undecodable", error: error instanceof Error ? error.message : String(error) };
  }
  return { value: decoded, offset: opaque.offset };
}

function decodeRemoteMessage(bytes) {
  let offset = 0;
  const messageId = scaleDecodeStringAt(bytes, offset);
  offset = messageId.offset;
  const timestamp = scaleDecodeUInt64At(bytes, offset);
  offset = timestamp.offset;
  const version = bytes[offset];
  if (version !== 0) {
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "unsupported",
      rawContent: bytes.slice(offset),
    };
  }
  offset += 1;

  const contentKind = bytes[offset];
  offset += 1;
  if (contentKind === 0) {
    const text = scaleDecodeStringAt(bytes, offset);
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "text",
      text: text.value,
      offset: text.offset,
    };
  }
  if (contentKind === 14) {
    const accepted = scaleDecodeStringAt(bytes, offset);
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "chatAccepted",
      acceptedRequestId: accepted.value,
      offset: accepted.offset,
    };
  }
  if (contentKind === 20) {
    const accepted = scaleDecodeStringAt(bytes, offset);
    offset = accepted.offset;
    const statementAccountId = bytes.slice(offset, offset + 32);
    offset += 32;
    const encryptionPublicKey = bytes.slice(offset, offset + 65);
    offset += 65;
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "multiChatAccepted",
      acceptedRequestId: accepted.value,
      statementAccountId,
      statementAccountIdHex: normalizeHex(bytesToHex(statementAccountId)),
      encryptionPublicKey,
      encryptionPublicKeyHex: normalizeHex(bytesToHex(encryptionPublicKey)),
      offset,
    };
  }
  if (contentKind === 15) {
    const richText = decodeRichTextAt(bytes, offset);
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "richText",
      text: richText.value.text ?? "",
      richText: richText.value,
      offset: richText.offset,
    };
  }
  if (contentKind === 16) {
    const totalValue = scaleDecodeCompactBigIntAt(bytes, offset);
    const coinKeys = scaleDecodeArrayAt(bytes, totalValue.offset, scaleDecodeBytesAt);
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "coinageSend",
      totalValue: totalValue.value,
      totalValueString: totalValue.value.toString(),
      coinKeys: coinKeys.value,
      offset: coinKeys.offset,
    };
  }
  return {
    messageId: messageId.value,
    timestamp: Number(timestamp.value),
    kind: "unsupported",
    contentKind,
    rawContent: bytes.slice(offset),
  };
}

function encodeAppStatement({ walletPair, channel, topics, expiry, scaleEncodedPayload }) {
  const unsignedFields = [
    encodeStatementField(2, scaleEncodeUInt64(BigInt(expiry))),
    encodeStatementField(3, channel),
    ...topics.slice(0, 4).map((topic, index) => encodeStatementField(4 + index, topic)),
    encodeStatementField(8, scaleEncodedPayload),
  ].sort(compareStatementFields);

  const proofData = concatBytes(...unsignedFields);
  const signature = walletPair.sign(proofData);
  const proofField = encodeStatementField(
    0,
    concatBytes(Uint8Array.of(0), signature, walletPair.publicKey),
  );

  return scaleEncodeArray([proofField, ...unsignedFields].sort(compareStatementFields));
}

function encodeStatementField(index, encodedValue) {
  return concatBytes(Uint8Array.of(index), encodedValue);
}

function compareStatementFields(left, right) {
  return left[0] - right[0];
}

export async function submitAppStatement(requestRpc, options) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const expiry = options.expiryFactory(attempt);
    const encoded = encodeAppStatement({
      ...options,
      expiry,
    });
    const encodedHex = bytesToHex(encoded);
    try {
      const result = await requestRpc("statement_submit", [encodedHex]);
      ensureStatementSubmitSuccess(result);
      return { result, encodedBytes: encoded.length, priority: expiry.toString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error?.minExpiry != null && typeof options.noteRejectedPriority === "function") {
        options.noteRejectedPriority(error.minExpiry);
      }
      const reason = error?.statementSubmitReason ?? "";
      const retryablePriorityRejection =
        reason === "noAllowance" ||
        reason === "channelPriorityTooLow" ||
        reason === "accountFull" ||
        message.includes("noAllowance") ||
        message.includes("channelPriorityTooLow") ||
        message.includes("accountFull");
      if (retryablePriorityRejection && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unreachable submit retry state");
}

function parseSubmitExpiry(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(value) : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return BigInt(value);
  }
  return null;
}

function statementSubmitError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function ensureStatementSubmitSuccess(result) {
  if (result == null || typeof result !== "object") {
    return;
  }

  if (result.status === "new" || result.status === "known") {
    return;
  }

  if (result.status === "rejected") {
    throw statementSubmitError(`statement_submit rejected: ${result.reason ?? "unknown"}`, {
      statementSubmitStatus: result.status,
      statementSubmitReason: result.reason ?? "unknown",
      submittedExpiry: parseSubmitExpiry(result.submitted_expiry),
      minExpiry: parseSubmitExpiry(result.min_expiry),
    });
  }

  if (result.status === "invalid") {
    throw statementSubmitError(`statement_submit invalid: ${result.reason ?? "unknown"}`, {
      statementSubmitStatus: result.status,
      statementSubmitReason: result.reason ?? "unknown",
      submittedSize: result.submitted_size ?? null,
      maxSize: result.max_size ?? null,
    });
  }

  if (result.status === "knownExpired") {
    throw statementSubmitError("statement_submit knownExpired", {
      statementSubmitStatus: result.status,
    });
  }

  if (result.status === "internalError") {
    throw statementSubmitError(`statement_submit internalError: ${result.error ?? "unknown"}`, {
      statementSubmitStatus: result.status,
      statementSubmitDetail: result.error ?? null,
    });
  }
}
