// Wallet and memo key derivation for the faucet bot.
//
// Extracted from scripts/faucet-chat-listener.mjs. The protocol contract
// (docs/chat-coinage-faucet-flow.md) lives here: app chat memos carry
// schnorrkel SecretKey::to_bytes() (`privateKey || nonce`) for
// `//pps//coin//<index>`, and numeric derivation junctions are SCALE u64.

import { blake2b } from "@noble/hashes/blake2.js";
import {
  deriveSlotAccountPublicKey,
  signSlotAccountSecret,
  substrateSlotSecretFromSeedBytes,
} from "@novasamatech/substrate-slot-sr25519-wasm";
import {
  mnemonicToEntropy,
  mnemonicToMiniSecret,
  sr25519,
  sr25519Derive,
} from "@polkadot-labs/hdkd-helpers";

const textEncoder = new TextEncoder();

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

function bytesToHexLocal(bytes) {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function hexToBytesLocal(hex) {
  const clean = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`Invalid hex value: ${hex}`);
  }
  return Uint8Array.from(clean.match(/../g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

function normalizeHexLocal(hex) {
  return hex.trim().toLowerCase().replace(/^0x/, "");
}

function scaleCompactLength(length) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`invalid SCALE compact length: ${length}`);
  }
  if (length < 1 << 6) {
    return Uint8Array.of(length << 2);
  }
  if (length < 1 << 14) {
    const value = (length << 2) | 0x01;
    return Uint8Array.of(value & 0xff, (value >> 8) & 0xff);
  }
  if (length < 1 << 30) {
    const value = (length << 2) | 0x02;
    return Uint8Array.of(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >> 24) & 0xff,
    );
  }
  throw new Error(`SCALE compact length is too large for derivation path: ${length}`);
}

// Substrate/app numeric path components use SCALE u64.
export function chainCode(junction) {
  const output = new Uint8Array(32);
  if (typeof junction === "number" || typeof junction === "bigint") {
    if (typeof junction === "number" && (!Number.isSafeInteger(junction) || junction < 0)) {
      throw new Error(`substrate junction index must be a safe non-negative integer: ${junction}`);
    }
    let value = BigInt(junction);
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new Error(`substrate junction index must fit u64: ${junction}`);
    }
    for (let offset = 0; offset < 8; offset += 1) {
      output[offset] = Number(value & 0xffn);
      value >>= 8n;
    }
    return output;
  }

  const bytes = textEncoder.encode(String(junction));
  const encoded = concatBytes(scaleCompactLength(bytes.length), bytes);
  const chainBytes = encoded.length > 32
    ? blake2b(encoded, { dkLen: 32 })
    : encoded;
  output.set(chainBytes);
  return output;
}

export function parseSr25519DerivationPath(path) {
  const derivations = [];
  for (const match of path.matchAll(/(\/{1,2})([^/]+)/g)) {
    derivations.push({
      hard: match[1] === "//",
      junction: /^\d+$/.test(match[2]) ? BigInt(match[2]) : match[2],
    });
  }
  return derivations;
}

export function deriveSr25519PrivateKeyFromSeed(seed, derivationPath) {
  const derivations = parseSr25519DerivationPath(derivationPath).map(({ hard, junction }) => (
    [hard ? "hard" : "soft", chainCode(junction)]
  ));
  const extractor = sr25519Derive(
    seed,
    {
      getPublicKey() {
        throw new Error("unused sr25519 private-key extractor public-key callback");
      },
      sign(_message, privateKey) {
        return privateKey;
      },
      verify() {
        return false;
      },
    },
    derivations,
  );
  const privateKey = extractor.sign(new Uint8Array());
  if (privateKey.length !== 64) {
    throw new Error(`sr25519 derivation returned ${privateKey.length} bytes, expected 64`);
  }
  return privateKey;
}

export function sr25519PairFromPrivateKey(privateKey) {
  if (privateKey.length !== 64) {
    throw new Error(`sr25519 private key must be 64 bytes, got ${privateKey.length}`);
  }
  return {
    publicKey: sr25519.getPublicKey(privateKey),
    privateKey,
    sign: (message) => sr25519.sign(message, privateKey),
  };
}

export function deriveSr25519PairFromSeed(seed, derivationPath) {
  return sr25519PairFromPrivateKey(deriveSr25519PrivateKeyFromSeed(seed, derivationPath));
}

export function deriveSr25519PairFromMnemonic(mnemonic, derivationPath) {
  return deriveSr25519PairFromSeed(mnemonicToMiniSecret(mnemonic.trim()), derivationPath);
}

export function scureSr25519SecretToSubstrateSlotSecret(privateKey) {
  if (privateKey.length !== 64) {
    throw new Error(`sr25519 private key must be 64 bytes, got ${privateKey.length}`);
  }

  const secret = new Uint8Array(privateKey);
  let carry = 0;
  for (let offset = 31; offset >= 0; offset -= 1) {
    const value = secret[offset] | (carry << 8);
    secret[offset] = value >> 3;
    carry = value & 0x07;
  }
  if (carry !== 0) {
    throw new Error("sr25519 private key is not cofactor-encoded");
  }
  return secret;
}

export function normalizeMemoSecret(secret) {
  if (secret.length === 32 || secret.length === 64) {
    return secret;
  }
  throw new Error(`chat Coinage memo entry must be 32 or 64 bytes, got ${secret.length}`);
}

export function expandAppMemoSecret(secret) {
  if (secret.length === 32) {
    return substrateSlotSecretFromSeedBytes(secret);
  }
  return secret;
}

export function memoSecretFormat(secret) {
  const normalized = normalizeMemoSecret(secret);
  if (normalized.length === 32) {
    deriveSlotAccountPublicKey(expandAppMemoSecret(normalized));
    return "app-raw-slot-sr25519";
  }
  if (normalized.length === 64) {
    return "app-sr25519-private-key";
  }

  throw new Error(`unsupported app chat Coinage memo secret encoding (${secret.length} bytes)`);
}

export function deriveMemoSecretPublicKey(secret) {
  const normalized = normalizeMemoSecret(secret);
  const format = memoSecretFormat(normalized);
  if (format === "app-raw-slot-sr25519") {
    return deriveSlotAccountPublicKey(expandAppMemoSecret(normalized));
  }
  if (format === "app-sr25519-private-key") {
    return deriveSlotAccountPublicKey(normalized);
  }
  throw new Error(`unsupported app chat Coinage memo secret public-key format: ${format}`);
}

export function signMemoSecret(secret, payload) {
  const normalized = normalizeMemoSecret(secret);
  const format = memoSecretFormat(normalized);
  if (format === "app-raw-slot-sr25519") {
    return signSlotAccountSecret(expandAppMemoSecret(normalized), payload);
  }
  if (format === "app-sr25519-private-key") {
    return signSlotAccountSecret(normalized, payload);
  }
  throw new Error(`unsupported app chat Coinage memo secret signing format: ${format}`);
}

export function isChatMemoSecret(secret) {
  try {
    memoSecretFormat(secret);
    return true;
  } catch {
    return false;
  }
}

export function assertChatMemoSecret(secret, label = "chat Coinage memo entry") {
  if (!isChatMemoSecret(secret)) {
    throw new Error(`${label} is not an app-compatible Coinage memo secret, got ${secret.length} bytes`);
  }
  return normalizeMemoSecret(secret);
}

export function deriveCoinageWalletSlotSecret(mnemonic, index) {
  const privateKey = deriveSr25519PrivateKeyFromSeed(
    mnemonicToMiniSecret(mnemonic.trim()),
    `//pps//coin//${index}`,
  );

  // App chat memos carry schnorrkel SecretKey::to_bytes() (`privateKey || nonce`).
  // @scure/sr25519 exposes the same key material with the scalar half multiplied by the
  // cofactor, so convert before passing it to the mobile SlotAccountKey-compatible WASM.
  return scureSr25519SecretToSubstrateSlotSecret(privateKey);
}

export function deriveCoinageWalletMemoSecret({
  mnemonic,
  index,
  expectedAccount = null,
  label = "wallet coin memo secret",
}) {
  const memoSecret = assertChatMemoSecret(deriveCoinageWalletSlotSecret(mnemonic, index), label);
  const actualAccountHex = normalizeHexLocal(bytesToHexLocal(deriveMemoSecretPublicKey(memoSecret)));
  const expectedAccountHex =
    expectedAccount != null
      ? normalizeHexLocal(bytesToHexLocal(expectedAccount))
      : null;

  if (expectedAccountHex != null && actualAccountHex !== expectedAccountHex) {
    throw new Error(
      `${label} for //pps//coin//${index} derives 0x${actualAccountHex}, expected 0x${expectedAccountHex}`,
    );
  }
  return memoSecret;
}

export function deriveCoinageWalletAccount(mnemonic, index) {
  const memoSecret = deriveCoinageWalletMemoSecret({
    mnemonic,
    index,
    label: `wallet coin ${index} account memo secret`,
  });
  return deriveMemoSecretPublicKey(memoSecret);
}

export function signCoinageWalletMemoSecret({ mnemonic, index, expectedAccount = null }, payload) {
  return signMemoSecret(
    deriveCoinageWalletMemoSecret({ mnemonic, index, expectedAccount, label: "wallet coin signing memo secret" }),
    payload,
  );
}

export function deriveVoucherSeed(mnemonic, index) {
  const rootEntropy = mnemonicToEntropy(mnemonic.trim());
  return ["pps", "ring-vrf", index].reduce(
    (seed, junction) => blake2b(seed, { key: chainCode(junction), dkLen: 32 }),
    rootEntropy,
  );
}

export function normalizeAppCoinageMemoEntries(coinKeys, label = "chat Coinage memo entries") {
  if (!Array.isArray(coinKeys) || coinKeys.length === 0) {
    throw new Error(`${label} must contain at least one memo entry`);
  }
  return coinKeys.map((coinKey, index) => assertChatMemoSecret(
    coinKey instanceof Uint8Array ? coinKey : hexToBytesLocal(coinKey),
    `${label}[${index}]`,
  ));
}
