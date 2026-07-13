import crypto from "node:crypto";

import { blake2b } from "@noble/hashes/blake2.js";
import { verify as sr25519Verify } from "@scure/sr25519";

const CHAT_REQUEST_CONTEXT = new TextEncoder().encode("chat-request");
const CHAT_SESSION_CONTEXT = new TextEncoder().encode("session");
const CHAT_REQUEST_CHANNEL_CONTEXT = new TextEncoder().encode("request");
const CHAT_RESPONSE_CHANNEL_CONTEXT = new TextEncoder().encode("response");
const CHAT_REQUEST_DAY_UNIX_OFFSET_SECS = 1_763_164_800;
const CHAT_REQUEST_IDENTITY_PROOF_CONTEXT = "mds-chat-request";

// Every vector below originates from a peer-controlled encrypted payload. Keep
// the limits close to the decoder so a valid compact length cannot turn into an
// unbounded loop or array before ingress has a chance to apply backpressure.
const MAX_MESSAGES_PER_REQUEST = 256;
const MAX_ATTACHMENTS_PER_MESSAGE = 32;
const MAX_MULTI_DEVICE_ENTRIES = 64;
const MAX_COIN_KEYS_PER_MESSAGE = 256;
const MAX_GENERIC_SCALE_VECTOR_ITEMS = 1_024;
const MAX_TOTAL_SCALE_VECTOR_ITEMS = 1_024;
const MAX_SCALE_BYTES = 512 * 1024;
const MAX_OPAQUE_MESSAGE_BYTES = 128 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_ID_BYTES = 256;
const MAX_URL_BYTES = 2 * 1024;
const MAX_MIME_BYTES = 256;
const MAX_PUSH_TOKEN_BYTES = 8 * 1024;
const MAX_THUMBNAIL_BYTES = 256 * 1024;
const MAX_ENCRYPTED_KEY_BYTES = 4 * 1024;
const MAX_SDP_BYTES = 64 * 1024;

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

function newScaleVectorBudget() {
  return { remaining: MAX_TOTAL_SCALE_VECTOR_ITEMS };
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
    if (offset + 2 > bytes.length) {
      throw new Error(`Truncated SCALE compact value at ${offset}`);
    }
    return { value: ((first | (bytes[offset + 1] << 8)) >> 2), offset: offset + 2 };
  }
  if (mode === 2) {
    if (offset + 4 > bytes.length) {
      throw new Error(`Truncated SCALE compact value at ${offset}`);
    }
    const raw =
      first |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    return { value: raw >>> 2, offset: offset + 4 };
  }

  const byteLength = (first >> 2) + 4;
  if (offset + 1 + byteLength > bytes.length) {
    throw new Error(`Truncated SCALE compact value at ${offset}`);
  }
  let value = 0n;
  for (let index = 0; index < byteLength; index += 1) {
    value |= BigInt(bytes[offset + 1 + index]) << BigInt(8 * index);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`SCALE compact value exceeds safe integer at ${offset}`);
  }
  return { value: Number(value), offset: offset + 1 + byteLength };
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
    if (offset + 2 > bytes.length) {
      throw new Error(`Truncated SCALE compact integer at ${offset}`);
    }
    return {
      value: BigInt((first | (bytes[offset + 1] << 8)) >> 2),
      offset: offset + 2,
    };
  }
  if (mode === 2) {
    if (offset + 4 > bytes.length) {
      throw new Error(`Truncated SCALE compact integer at ${offset}`);
    }
    const raw =
      first |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    return { value: BigInt(raw >>> 2), offset: offset + 4 };
  }

  const byteLength = (first >> 2) + 4;
  if (offset + 1 + byteLength > bytes.length) {
    throw new Error(`Truncated SCALE compact integer at ${offset}`);
  }
  let value = 0n;
  for (let index = 0; index < byteLength; index += 1) {
    value |= BigInt(bytes[offset + 1 + index]) << BigInt(8 * index);
  }
  return { value, offset: offset + 1 + byteLength };
}

export function scaleEncodeBytes(bytes) {
  return concatBytes(scaleCompactEncodeLength(bytes.length), bytes);
}

function scaleDecodeBytesAt(bytes, offset = 0, maxBytes = MAX_SCALE_BYTES, label = "SCALE bytes") {
  const length = scaleCompactDecode(bytes, offset);
  if (length.value > maxBytes) {
    throw new Error(`${label} exceeds maximum of ${maxBytes} bytes`);
  }
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

function scaleDecodeStringAt(bytes, offset = 0, maxBytes = MAX_TEXT_BYTES, label = "SCALE string") {
  const decoded = scaleDecodeBytesAt(bytes, offset, maxBytes, label);
  return { value: textDecoder.decode(decoded.value), offset: decoded.offset };
}

const decodeIdAt = (bytes, offset = 0, label = "message id") =>
  scaleDecodeStringAt(bytes, offset, MAX_ID_BYTES, label);
const fixedBytesAt = (bytes, offset, length, label) => {
  if (offset + length > bytes.length) throw new Error(`${label} exceeds buffer at ${offset}`);
  return { value: bytes.slice(offset, offset + length), offset: offset + length };
};

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

function scaleDecodeArrayAt(
  bytes,
  offset,
  decodeInner,
  maxItems = MAX_GENERIC_SCALE_VECTOR_ITEMS,
  label = "SCALE vector",
  budget = null,
) {
  const length = scaleCompactDecode(bytes, offset);
  if (length.value > maxItems) {
    throw new Error(`${label} exceeds maximum of ${maxItems} items`);
  }
  if (budget != null) {
    if (length.value > budget.remaining) {
      throw new Error(`${label} exceeds aggregate maximum of ${MAX_TOTAL_SCALE_VECTOR_ITEMS} items`);
    }
    budget.remaining -= length.value;
  }
  const items = new Array(length.value);
  let itemOffset = length.offset;
  for (let index = 0; index < length.value; index += 1) {
    const decoded = decodeInner(bytes, itemOffset);
    items[index] = decoded.value;
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

function scaleEncodeUInt32(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Invalid SCALE u32: ${value}`);
  }
  return Uint8Array.of(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  );
}

function scaleDecodeUInt32At(bytes, offset = 0) {
  if (offset + 4 > bytes.length) {
    throw new Error(`SCALE u32 exceeds buffer at ${offset}`);
  }
  let value = 0;
  for (let index = 0; index < 4; index += 1) {
    value += bytes[offset + index] * 2 ** (8 * index);
  }
  return { value, offset: offset + 4 };
}

function scaleDecodeUInt64At(bytes, offset = 0) {
  if (offset + 8 > bytes.length) {
    throw new Error(`SCALE u64 exceeds buffer at ${offset}`);
  }
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
    const wrapped = scaleDecodeBytesAt(payload, 0, MAX_SCALE_BYTES, "encrypted chat request");
    if (wrapped.offset === payload.length) {
      remotePayloadBytes = wrapped.value;
    }
  } catch {
    remotePayloadBytes = payload;
  }

  let offset = 0;
  const encryptionPubKey = scaleDecodeBytesAt(remotePayloadBytes, offset, 65, "chat request encryption key");
  if (encryptionPubKey.value.length !== 65) throw new Error("invalid chat request encryption key length");
  offset = encryptionPubKey.offset;
  const encryptedData = scaleDecodeBytesAt(remotePayloadBytes, offset, MAX_SCALE_BYTES, "chat request ciphertext");
  if (encryptedData.offset !== remotePayloadBytes.length) {
    throw new Error("Encrypted chat request model has trailing bytes");
  }

  const requestSharedSecret = p256SharedSecret(ownP256PrivateKey, encryptionPubKey.value);
  const decrypted = aesGcmDecrypt(requestSharedSecret, encryptedData.value);
  const remoteModel = decodeChatRequestRemoteModel(decrypted, newScaleVectorBudget());
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

function decodeChatRequestRemoteModel(bytes, budget) {
  const message = decodeChatRequestMessageAt(bytes, 0, budget);
  const proof = decodeStatementProofAt(bytes, message.offset);
  return {
    message: message.value,
    messageBytes: bytes.slice(0, message.offset),
    proof: proof.value,
    offset: proof.offset,
  };
}

function decodeChatRequestMessageAt(bytes, offset = 0, budget = newScaleVectorBudget()) {
  const start = offset;
  const messageId = decodeIdAt(bytes, offset, "chat request id");
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
    const identityAccountId = fixedBytesAt(bytes, offset, 32, "identity account id");
    offset = identityAccountId.offset;
    const proof = fixedBytesAt(bytes, offset, 32, "identity proof");
    offset = proof.offset;
    const deviceKey = fixedBytesAt(bytes, offset, 65, "device encryption key");
    offset = deviceKey.offset;
    deviceEncPubKey = deviceKey.value;
    identityProof = { identityAccountId: identityAccountId.value, proof: proof.value };
  }

  const pushToken = scaleDecodeOptionAt(bytes, offset, decodeRemoteTokenContentAt);
  offset = pushToken.offset;
  const welcomeMessage = scaleDecodeOptionAt(bytes, offset, (data, itemOffset) => decodeRichTextAt(data, itemOffset, budget));
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
  const token = scaleDecodeBytesAt(bytes, offset, MAX_PUSH_TOKEN_BYTES, "push token");
  const pushType = bytes[token.offset];
  return {
    value: { token: token.value, pushType },
    offset: token.offset + 1,
  };
}

function decodeRichTextAt(bytes, offset, budget = newScaleVectorBudget()) {
  const text = scaleDecodeOptionAt(bytes, offset, scaleDecodeStringAt);
  offset = text.offset;
  const attachments = scaleDecodeOptionAt(bytes, offset, (data, itemOffset) => decodeAttachmentsAt(data, itemOffset, budget));
  return {
    value: { text: text.value, attachments: attachments.value },
    offset: attachments.offset,
  };
}

function decodeAttachmentsAt(bytes, offset, budget) {
  return scaleDecodeArrayAt(
    bytes,
    offset,
    decodeFileVariantAt,
    MAX_ATTACHMENTS_PER_MESSAGE,
    "attachments",
    budget,
  );
}

// Attachment layout mirrors the mobile app's FileVariant (ChatRichRemoteContent
// .swift). Unknown enum tags throw on purpose: the per-message try/catch in
// decodeOpaqueMessageAt turns the message undecodable without hurting the batch.
function decodeFileVariantAt(bytes, offset) {
  const variantTag = bytes[offset];
  if (variantTag !== 0) {
    throw new Error(`Unsupported FileVariant tag ${variantTag} at ${offset}`);
  }
  const identifier = scaleDecodeBytesAt(bytes, offset + 1, 32, "attachment identifier");
  if (identifier.value.length !== 32) throw new Error("attachment identifier must be 32 bytes");
  const claimTicket = scaleDecodeBytesAt(bytes, identifier.offset, 32, "attachment claim ticket");
  if (claimTicket.value.length !== 32) throw new Error("attachment claim ticket must be 32 bytes");
  const node = decodeNodeEndpointAt(bytes, claimTicket.offset);
  const meta = decodeFileMetaAt(bytes, node.offset);
  return {
    value: {
      kind: "p2pMixnetFile",
      identifier: identifier.value,
      identifierHex: normalizeHex(bytesToHex(identifier.value)),
      claimTicket: claimTicket.value,
      wssUrl: node.value,
      ...meta.value,
    },
    offset: meta.offset,
  };
}

function decodeNodeEndpointAt(bytes, offset) {
  const tag = bytes[offset];
  if (tag !== 0) {
    throw new Error(`Unsupported NodeEndpoint tag ${tag} at ${offset}`);
  }
  return scaleDecodeStringAt(bytes, offset + 1, MAX_URL_BYTES, "attachment node URL");
}

function decodeFileMetaAt(bytes, offset) {
  const tag = bytes[offset];
  if (tag !== 0 && tag !== 1 && tag !== 2) {
    throw new Error(`Unsupported FileMeta tag ${tag} at ${offset}`);
  }
  const mimeType = scaleDecodeStringAt(bytes, offset + 1, MAX_MIME_BYTES, "attachment MIME type");
  const fileSize = scaleDecodeUInt32At(bytes, mimeType.offset);
  const general = { mimeType: mimeType.value, fileSize: fileSize.value };
  if (tag === 0) {
    return { value: { fileKind: "general", ...general }, offset: fileSize.offset };
  }
  if (tag === 1) {
    const width = scaleDecodeUInt32At(bytes, fileSize.offset);
    const height = scaleDecodeUInt32At(bytes, width.offset);
    const thumbnail = scaleDecodeOptionAt(bytes, height.offset, (data, itemOffset) =>
      scaleDecodeBytesAt(data, itemOffset, MAX_THUMBNAIL_BYTES, "attachment thumbnail"));
    return {
      value: { fileKind: "image", ...general, width: width.value, height: height.value, thumbnail: thumbnail.value },
      offset: thumbnail.offset,
    };
  }
  const duration = scaleDecodeUInt32At(bytes, fileSize.offset);
  const thumbnail = scaleDecodeOptionAt(bytes, duration.offset, (data, itemOffset) =>
    scaleDecodeBytesAt(data, itemOffset, MAX_THUMBNAIL_BYTES, "attachment thumbnail"));
  return {
    value: { fileKind: "video", ...general, duration: duration.value, thumbnail: thumbnail.value },
    offset: thumbnail.offset,
  };
}

function decodeStatementProofAt(bytes, offset = 0) {
  const proofKind = bytes[offset];
  if (proofKind !== 0) {
    throw new Error(`Unsupported statement proof kind: ${proofKind}`);
  }
  const signatureStart = offset + 1;
  const signature = fixedBytesAt(bytes, signatureStart, 64, "statement proof signature");
  const signer = fixedBytesAt(bytes, signature.offset, 32, "statement proof signer");
  return {
    value: {
      kind: "sr25519",
      signature: signature.value,
      signer: signer.value,
    },
    offset: signer.offset,
  };
}

export function encodeOpaqueTextMessage({ messageId = makeAppUuid(), timestamp = chatTimestampNow(), text }) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(0), scaleEncodeString(text)),
  });
}

// RichText on the wire: Option<String> text, Option<Vec<FileVariant>> attachments.
// Only the p2pMixnetFile variant currently exists in the mobile clients. Keep
// this encoder strict: a malformed outgoing attachment would be encrypted and
// accepted by the statement store but become unreadable to the recipient.
function encodeFileVariant(attachment) {
  const identifier = attachment?.identifier;
  const claimTicket = attachment?.claimTicket;
  if (!(identifier instanceof Uint8Array) || identifier.length !== 32) {
    throw new Error("outgoing attachment identifier must be 32 bytes");
  }
  if (!(claimTicket instanceof Uint8Array) || claimTicket.length !== 32) {
    throw new Error("outgoing attachment claim ticket must be 32 bytes");
  }
  const wssUrl = String(attachment?.wssUrl ?? "");
  if (!wssUrl || textEncoder.encode(wssUrl).length > MAX_URL_BYTES) {
    throw new Error("outgoing attachment node URL is invalid");
  }
  const mimeType = String(attachment?.mimeType ?? attachment?.mime ?? "");
  if (!mimeType || textEncoder.encode(mimeType).length > MAX_MIME_BYTES) {
    throw new Error("outgoing attachment MIME type is invalid");
  }
  const fileSize = Number(attachment?.fileSize ?? attachment?.size);
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > 0xffff_ffff) {
    throw new Error("outgoing attachment size is invalid");
  }
  const base = [
    Uint8Array.of(0), // FileVariant::P2PMixnetFile
    scaleEncodeBytes(identifier),
    scaleEncodeBytes(claimTicket),
    Uint8Array.of(0), // NodeEndpoint::Url
    scaleEncodeString(wssUrl),
  ];
  const fileKind = attachment?.fileKind ?? "general";
  if (fileKind === "general") {
    return concatBytes(...base, Uint8Array.of(0), scaleEncodeString(mimeType), scaleEncodeUInt32(fileSize));
  }
  const thumbnail = attachment?.thumbnail;
  const encodedThumbnail = thumbnail == null
    ? Uint8Array.of(0)
    : thumbnail instanceof Uint8Array && thumbnail.length <= MAX_THUMBNAIL_BYTES
      ? scaleEncodeOption(scaleEncodeBytes(thumbnail))
      : (() => { throw new Error("outgoing attachment thumbnail is invalid"); })();
  if (fileKind === "image") {
    const width = Number(attachment?.width);
    const height = Number(attachment?.height);
    return concatBytes(
      ...base,
      Uint8Array.of(1), scaleEncodeString(mimeType), scaleEncodeUInt32(fileSize),
      scaleEncodeUInt32(width), scaleEncodeUInt32(height), encodedThumbnail,
    );
  }
  if (fileKind === "video") {
    const duration = Number(attachment?.duration);
    return concatBytes(
      ...base,
      Uint8Array.of(2), scaleEncodeString(mimeType), scaleEncodeUInt32(fileSize),
      scaleEncodeUInt32(duration), encodedThumbnail,
    );
  }
  throw new Error(`unsupported outgoing attachment kind: ${fileKind}`);
}

function encodeRichText(text, attachments = null) {
  if (text != null && typeof text !== "string") throw new Error("rich text must be a string or null");
  if (text != null && textEncoder.encode(text).length > MAX_TEXT_BYTES) throw new Error("rich text exceeds maximum length");
  if (attachments != null && (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS_PER_MESSAGE)) {
    throw new Error("outgoing attachments exceed maximum");
  }
  return concatBytes(
    scaleEncodeOption(text == null ? null : scaleEncodeString(text)),
    scaleEncodeOption(attachments == null ? null : scaleEncodeArray(attachments.map(encodeFileVariant))),
  );
}

export function encodeOpaqueRichTextMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  text = null,
  attachments = [],
}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw new Error("outgoing rich text requires at least one attachment");
  }
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(15), encodeRichText(text, attachments)),
  });
}

export function encodeOpaqueReactionMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  targetMessageId,
  emoji,
  removed = false,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(
      Uint8Array.of(removed ? 5 : 4),
      scaleEncodeString(targetMessageId),
      scaleEncodeString(emoji),
    ),
  });
}

export function encodeOpaqueReplyMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  replyToMessageId,
  text,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(7), scaleEncodeString(replyToMessageId), encodeRichText(text)),
  });
}

export function encodeOpaqueEditedMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  targetMessageId,
  text,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(12), scaleEncodeString(targetMessageId), encodeRichText(text)),
  });
}

export function encodeOpaqueDataChannelClosedMessage({
  messageId = makeAppUuid(),
  timestamp = chatTimestampNow(),
  offerId,
}) {
  return encodeOpaqueRemoteMessage({
    messageId,
    timestamp,
    content: concatBytes(Uint8Array.of(11), scaleEncodeString(offerId)),
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
  const encrypted = scaleDecodeBytesAt(payload, 0, MAX_SCALE_BYTES, "encrypted session statement");
  const decrypted = aesGcmDecrypt(sharedSecret, encrypted.value);
  return decodeStatementData(decrypted, session, senderAccountId);
}

export function decodeStatementData(bytes, session = null, senderAccountId = null, budget = newScaleVectorBudget()) {
  const kind = bytes[0];
  if (kind === 0) {
    const request = decodeMessageExchangeRequestAt(bytes, 1, budget);
    return { kind: "request", ...request.value, offset: request.offset };
  }
  if (kind === 1) {
    const response = decodeMessageExchangeResponseAt(bytes, 1);
    return { kind: "response", ...response.value, offset: response.offset };
  }
  if (kind === 2) {
    const multiRequest = decodeMultiDeviceEnvelopeAt(bytes, 1, budget);
    if (session == null) {
      return { kind: "multirequest", ...multiRequest.value, offset: multiRequest.offset };
    }
    const requestBytes = decodeMultiDeviceInnerPayload(multiRequest.value, session, senderAccountId);
    const request = decodeMessageExchangeRequestAt(requestBytes, 0, budget);
    return { kind: "request", multiDevice: true, ...request.value, offset: multiRequest.offset };
  }
  if (kind === 3) {
    const multiResponse = decodeMultiDeviceEnvelopeAt(bytes, 1, budget);
    if (session == null) {
      return { kind: "multiresponse", ...multiResponse.value, offset: multiResponse.offset };
    }
    const responseBytes = decodeMultiDeviceInnerPayload(multiResponse.value, session, senderAccountId);
    const response = decodeMessageExchangeResponseAt(responseBytes, 0);
    return { kind: "response", multiDevice: true, ...response.value, offset: multiResponse.offset };
  }
  throw new Error(`Unsupported statement data kind: ${kind}`);
}

function decodeMultiDeviceEnvelopeAt(bytes, offset, budget) {
  const encryptedPayload = scaleDecodeBytesAt(bytes, offset, MAX_SCALE_BYTES, "multi-device ciphertext");
  const devicesInfo = scaleDecodeArrayAt(
    bytes,
    encryptedPayload.offset,
    decodeRequestDeviceInfoAt,
    MAX_MULTI_DEVICE_ENTRIES,
    "multi-device entries",
    budget,
  );
  return {
    value: {
      encryptedPayload: encryptedPayload.value,
      devicesInfo: devicesInfo.value,
    },
    offset: devicesInfo.offset,
  };
}

function decodeRequestDeviceInfoAt(bytes, offset) {
  const statementAccountId = fixedBytesAt(bytes, offset, 32, "device statement account");
  const encryptedKey = scaleDecodeBytesAt(bytes, statementAccountId.offset, MAX_ENCRYPTED_KEY_BYTES, "device encrypted key");
  return {
    value: {
      statementAccountId: statementAccountId.value,
      statementAccountIdHex: normalizeHex(bytesToHex(statementAccountId.value)),
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

function decodeMessageExchangeRequestAt(bytes, offset, budget) {
  const requestId = decodeIdAt(bytes, offset, "session request id");
  offset = requestId.offset;
  const messages = scaleDecodeArrayAt(
    bytes,
    offset,
    (data, itemOffset) => decodeOpaqueMessageAt(data, itemOffset, budget),
    MAX_MESSAGES_PER_REQUEST,
    "message batch",
    budget,
  );
  return {
    value: {
      requestId: requestId.value,
      messages: messages.value,
    },
    offset: messages.offset,
  };
}

function decodeMessageExchangeResponseAt(bytes, offset) {
  const requestId = decodeIdAt(bytes, offset, "session response id");
  if (requestId.offset >= bytes.length) throw new Error("session response code exceeds buffer");
  return {
    value: {
      requestId: requestId.value,
      responseCode: bytes[requestId.offset],
    },
    offset: requestId.offset + 1,
  };
}

// Exported for the codec unit tests (round-trip a single opaque message
// without building a whole encrypted session statement).
export function decodeOpaqueMessageAt(bytes, offset, budget = newScaleVectorBudget()) {
  const opaque = scaleDecodeBytesAt(bytes, offset, MAX_OPAQUE_MESSAGE_BYTES, "opaque message");
  // Each opaque message is length-prefixed, so one undecodable message (e.g. a
  // rich-text image attachment) must not abort the rest of the batch — the app
  // resends its whole unacked backlog as a single request.
  let decoded;
  try {
    decoded = decodeRemoteMessage(opaque.value, budget);
  } catch (error) {
    decoded = { kind: "undecodable", error: error instanceof Error ? error.message : String(error) };
  }
  return { value: decoded, offset: opaque.offset };
}

function decodeRemoteMessage(bytes, budget) {
  let offset = 0;
  const messageId = decodeIdAt(bytes, offset, "message id");
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
    const accepted = decodeIdAt(bytes, offset, "accepted request id");
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "chatAccepted",
      acceptedRequestId: accepted.value,
      offset: accepted.offset,
    };
  }
  if (contentKind === 20) {
    const accepted = decodeIdAt(bytes, offset, "accepted request id");
    offset = accepted.offset;
    const statementAccountId = fixedBytesAt(bytes, offset, 32, "device statement account");
    offset = statementAccountId.offset;
    const encryptionPublicKey = fixedBytesAt(bytes, offset, 65, "device encryption key");
    offset = encryptionPublicKey.offset;
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "multiChatAccepted",
      acceptedRequestId: accepted.value,
      statementAccountId: statementAccountId.value,
      statementAccountIdHex: normalizeHex(bytesToHex(statementAccountId.value)),
      encryptionPublicKey: encryptionPublicKey.value,
      encryptionPublicKeyHex: normalizeHex(bytesToHex(encryptionPublicKey.value)),
      offset,
    };
  }
  if (contentKind === 15) {
    const richText = decodeRichTextAt(bytes, offset, budget);
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
    const coinKeys = scaleDecodeArrayAt(
      bytes,
      totalValue.offset,
      scaleDecodeBytesAt,
      MAX_COIN_KEYS_PER_MESSAGE,
      "coin keys",
      budget,
    );
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
  if (contentKind === 3) {
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "contactAdded",
      offset,
    };
  }
  if (contentKind === 4 || contentKind === 5) {
    const targetMessageId = decodeIdAt(bytes, offset, "reaction target id");
    const emoji = scaleDecodeStringAt(bytes, targetMessageId.offset, 64, "reaction emoji");
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "reaction",
      removed: contentKind === 5,
      targetMessageId: targetMessageId.value,
      emoji: emoji.value,
      offset: emoji.offset,
    };
  }
  if (contentKind === 7) {
    const replyToMessageId = decodeIdAt(bytes, offset, "reply target id");
    const richText = decodeRichTextAt(bytes, replyToMessageId.offset, budget);
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "reply",
      replyToMessageId: replyToMessageId.value,
      text: richText.value.text ?? "",
      richText: richText.value,
      offset: richText.offset,
    };
  }
  if (contentKind === 8) {
    // WebRTC call offer. The sdp blob is decoded only for framing — surface its
    // length, not its content. The offer's envelope messageId doubles as the
    // offerId a dataChannelClosed decline must reference.
    const sdp = scaleDecodeBytesAt(bytes, offset, MAX_SDP_BYTES, "call offer SDP");
    if (sdp.offset >= bytes.length) throw new Error("call offer purpose exceeds buffer");
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "dataChannelOffer",
      purpose: bytes[sdp.offset],
      sdpLength: sdp.value.length,
      offset: sdp.offset + 1,
    };
  }
  if (contentKind === 11) {
    const offerId = decodeIdAt(bytes, offset, "call offer id");
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "dataChannelClosed",
      offerId: offerId.value,
      offset: offerId.offset,
    };
  }
  if (contentKind === 12) {
    const targetMessageId = decodeIdAt(bytes, offset, "edit target id");
    const richText = decodeRichTextAt(bytes, targetMessageId.offset, budget);
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "edited",
      targetMessageId: targetMessageId.value,
      text: richText.value.text ?? "",
      richText: richText.value,
      offset: richText.offset,
    };
  }
  if (contentKind === 13) {
    return {
      messageId: messageId.value,
      timestamp: Number(timestamp.value),
      kind: "leftChat",
      offset,
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
