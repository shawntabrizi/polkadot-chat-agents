import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateMnemonic, mnemonicToMiniSecret } from "@polkadot-labs/hdkd-helpers";
import { verify as verifySr25519 } from "@scure/sr25519";
import { deriveSr25519PairFromSeed } from "../vendor/lib/wallet-keys.mjs";
import {
  deriveX25519PrivateKey,
  encodeAccountEcdhKey,
  x25519PublicKeyFromPrivateKey,
} from "../vendor/app-chat-codec.mjs";
import {
  acquireIdentitySession,
  obtainIdentitySession,
  redeemIdentityVoucher,
  registerIdentity,
} from "../lib/register.mjs";

const concatBytes = (...parts) => {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

test("automatic enrollment obtains a challenge and proves possession of the bot wallet", async () => {
  const mnemonic = generateMnemonic(128);
  const wallet = deriveSr25519PairFromSeed(mnemonicToMiniSecret(mnemonic), "//wallet");
  const challenge = Buffer.alloc(48, 5);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/auth/challenges")) {
      return new Response(JSON.stringify({ challenge: challenge.toString("base64") }), { status: 201 });
    }
    return new Response(JSON.stringify({ token: "access.jwt.token", refreshToken: "refresh-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await obtainIdentitySession({
    backendUrl: "https://identity.example.test",
    mnemonic,
    fetchImpl,
  });

  assert.deepEqual(result, { token: "access.jwt.token", refreshToken: "refresh-token" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://identity.example.test/api/v1/auth/challenges");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[1].url, "https://identity.example.test/api/v1/auth/token");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.body, "{}");
  const headers = new Headers(requests[1].options.headers);
  assert.equal(headers.has("auth-attestation-type"), false);
  assert.equal(headers.has("auth-payload"), false);

  const clientId = new Uint8Array(Buffer.from(headers.get("auth-clientid"), "base64"));
  const proof = new Uint8Array(Buffer.from(headers.get("auth-clientproof"), "base64"));
  assert.deepEqual(clientId, wallet.publicKey);
  assert.equal(proof.length, 64);
  assert.deepEqual(new Uint8Array(Buffer.from(headers.get("auth-challenge"), "base64")), new Uint8Array(challenge));
  const body = new TextEncoder().encode("{}");
  const clientDataHash = sha256(concatBytes(challenge, clientId, sha256(body)));
  assert.equal(verifySr25519(clientDataHash, proof, clientId), true);
});

test("voucher fallback uses the same challenge/proof contract and bot wallet", async () => {
  const voucher = Buffer.alloc(32, 7).toString("base64");
  const mnemonic = generateMnemonic(128);
  const wallet = deriveSr25519PairFromSeed(mnemonicToMiniSecret(mnemonic), "//wallet");
  const challenge = Buffer.alloc(56, 9);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/auth/challenges")) {
      return new Response(JSON.stringify({ challenge: challenge.toString("base64") }), { status: 201 });
    }
    return new Response(JSON.stringify({ token: "access.jwt.token", refreshToken: "refresh-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await redeemIdentityVoucher({
    backendUrl: "https://identity.example.test",
    secret: voucher,
    mnemonic,
    fetchImpl,
  });

  assert.deepEqual(result, { token: "access.jwt.token", refreshToken: "refresh-token" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://identity.example.test/api/v1/auth/challenges");
  assert.equal(requests[1].url, "https://identity.example.test/api/v1/auth/token");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.body, "{}");
  const headers = new Headers(requests[1].options.headers);
  assert.equal(headers.get("auth-attestation-type"), "voucher");
  assert.equal(headers.get("auth-voucher-secret"), voucher);

  const clientId = new Uint8Array(Buffer.from(headers.get("auth-clientid"), "base64"));
  const proof = new Uint8Array(Buffer.from(headers.get("auth-clientproof"), "base64"));
  const requestChallenge = new Uint8Array(Buffer.from(headers.get("auth-challenge"), "base64"));
  assert.deepEqual(clientId, wallet.publicKey);
  assert.equal(proof.length, 64);
  assert.deepEqual(requestChallenge, new Uint8Array(challenge));
  const body = new TextEncoder().encode("{}");
  const clientDataHash = sha256(concatBytes(requestChallenge, clientId, sha256(body)));
  assert.equal(verifySr25519(clientDataHash, proof, clientId), true);
});

test("automatically acquired sessions are persisted and reused without minting twice", async () => {
  const mnemonic = generateMnemonic(128);
  const challenge = Buffer.alloc(48, 11);
  const future = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: future })).toString("base64url")}.x`;
  const requests = [];
  let persisted = null;
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/auth/challenges")) {
      return new Response(JSON.stringify({ challenge: challenge.toString("base64") }), { status: 201 });
    }
    return new Response(JSON.stringify({ token: jwt, refreshToken: "refresh-token" }), { status: 200 });
  };

  const first = await acquireIdentitySession({
    backendUrl: "https://identity.example.test",
    mnemonic,
    persistSession: (session) => { persisted = session; },
    fetchImpl,
  });
  const second = await acquireIdentitySession({
    backendUrl: "https://identity.example.test/",
    mnemonic,
    savedSession: persisted,
    fetchImpl,
  });

  assert.equal(first.token, jwt);
  assert.equal(second.token, jwt);
  assert.deepEqual(requests, [
    "https://identity.example.test/api/v1/auth/challenges",
    "https://identity.example.test/api/v1/auth/token",
  ]);
  assert.deepEqual(persisted, {
    backendUrl: "https://identity.example.test/",
    token: jwt,
    refreshToken: "refresh-token",
  });
});

test("automatic enrollment falls back to a voucher only when the soft gate rejects it", async () => {
  const mnemonic = generateMnemonic(128);
  const voucher = Buffer.alloc(32, 13).toString("base64");
  const challenge = Buffer.alloc(48, 13).toString("base64");
  const tokenHeaders = [];
  const fetchImpl = async (url, options) => {
    if (String(url).endsWith("/auth/challenges")) {
      return new Response(JSON.stringify({ challenge }), { status: 201 });
    }
    tokenHeaders.push(new Headers(options.headers));
    if (tokenHeaders.length === 1) {
      return new Response(JSON.stringify({ title: "Missing Authentication Headers" }), {
        status: 401,
        statusText: "Unauthorized",
      });
    }
    return new Response(JSON.stringify({ token: "voucher.jwt.token", refreshToken: "voucher-refresh" }), { status: 200 });
  };

  const result = await acquireIdentitySession({
    backendUrl: "https://identity.example.test",
    mnemonic,
    enrollmentVoucher: voucher,
    fetchImpl,
  });

  assert.deepEqual(result, {
    backendUrl: "https://identity.example.test/",
    token: "voucher.jwt.token",
    refreshToken: "voucher-refresh",
  });
  assert.equal(tokenHeaders.length, 2);
  assert.equal(tokenHeaders[0].has("auth-attestation-type"), false);
  assert.equal(tokenHeaders[1].get("auth-attestation-type"), "voucher");
  assert.equal(tokenHeaders[1].get("auth-voucher-secret"), voucher);
});

test("an expiring saved session rotates and persists its single-use refresh token", async () => {
  const expired = `x.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.x`;
  let persisted = null;
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), "https://identity.example.test/api/v1/auth/token/refresh");
    assert.deepEqual(JSON.parse(options.body), { refreshToken: "old-refresh" });
    return new Response(JSON.stringify({ token: "new.jwt.token", refreshToken: "new-refresh" }), { status: 200 });
  };

  const result = await acquireIdentitySession({
    backendUrl: "https://identity.example.test",
    savedSession: {
      backendUrl: "https://identity.example.test/",
      token: expired,
      refreshToken: "old-refresh",
    },
    persistSession: (session) => { persisted = session; },
    fetchImpl,
  });

  assert.equal(result.token, "new.jwt.token");
  assert.deepEqual(persisted, {
    backendUrl: "https://identity.example.test/",
    token: "new.jwt.token",
    refreshToken: "new-refresh",
  });
});

test("voucher enrollment rejects malformed secrets before a network request", async () => {
  let called = false;
  await assert.rejects(
    redeemIdentityVoucher({
      backendUrl: "https://identity.example.test",
      secret: "not-a-voucher",
      fetchImpl: async () => { called = true; },
    }),
    /base64-encoded 32-byte enrollment voucher/,
  );
  assert.equal(called, false);
});

test("username registration sends the acquired bearer token on the protected write", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pca-register-test-"));
  const proofHelper = path.join(temp, "proof-helper.mjs");
  fs.writeFileSync(
    proofHelper,
    `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ memberKey: "0x${"22".repeat(32)}", proofOfOwnership: "0xproof" }));\n`,
    { mode: 0o700 },
  );
  const requests = [];
  const mnemonic = generateMnemonic(128);
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/attester")) {
      return new Response(JSON.stringify({ attester: `0x${"33".repeat(32)}` }), { status: 200 });
    }
    return new Response(JSON.stringify({ username: "testbot.01" }), { status: 202 });
  };

  try {
    await registerIdentity({
      mnemonic,
      username: "testbot.01",
      backendUrl: "https://identity.example.test",
      bandersnatchBin: proofHelper,
      identityToken: "issued-bearer-token",
      fetchImpl,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(new Headers(requests[0].options.headers).has("authorization"), false);
  assert.equal(requests[1].url, "https://identity.example.test/api/v1/usernames");
  assert.equal(new Headers(requests[1].options.headers).get("authorization"), "Bearer issued-bearer-token");

  const body = JSON.parse(requests[1].options.body);
  const rootSeed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(rootSeed, "//wallet");
  const expectedIdentifierKey = encodeAccountEcdhKey(
    x25519PublicKeyFromPrivateKey(deriveX25519PrivateKey(rootSeed)),
  );
  assert.equal(body.identifierKey, `0x${Buffer.from(expectedIdentifierKey).toString("hex")}`);
  assert.equal(expectedIdentifierKey.length, 65);
  assert.equal(expectedIdentifierKey[0], 0);
  assert.deepEqual(expectedIdentifierKey.slice(33), new Uint8Array(32));

  const username = new TextEncoder().encode("testbot");
  const resourcesPayload = concatBytes(
    wallet.publicKey,
    new Uint8Array(32).fill(0x33),
    expectedIdentifierKey,
    Uint8Array.of(username.length << 2),
    username,
    Uint8Array.of(0),
  );
  const consumerSignature = new Uint8Array(Buffer.from(body.consumerRegistrationSignature.slice(2), "hex"));
  assert.equal(verifySr25519(resourcesPayload, consumerSignature, wallet.publicKey), true);
});
