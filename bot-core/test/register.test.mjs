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
  deriveIdentityKeys,
  obtainIdentitySession,
  redeemIdentityVoucher,
  registerIdentity,
  reregisterIdentity,
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

// A proof helper that answers like the wasm one, so the claim can be built
// without the ring-VRF crypto.
function fakeProofHelper(dir) {
  const helper = path.join(dir, "proof-helper.mjs");
  fs.writeFileSync(helper, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ memberKey: "0x${"22".repeat(32)}", proofOfOwnership: "0xproof" }));\n`, { mode: 0o700 });
  return helper;
}

test("deriveIdentityKeys is the identity a claim publishes: same account, same identifier key, a signing key the wallet accepts", () => {
  const mnemonic = generateMnemonic(128);
  const keys = deriveIdentityKeys(mnemonic);
  const rootSeed = mnemonicToMiniSecret(mnemonic);
  const wallet = deriveSr25519PairFromSeed(rootSeed, "//wallet");
  assert.deepEqual(keys.accountId, wallet.publicKey);
  assert.equal(keys.account, `0x${Buffer.from(wallet.publicKey).toString("hex")}`);
  assert.equal(keys.walletPrivateKey.length, 64);
  assert.deepEqual(keys.identifierKey, encodeAccountEcdhKey(x25519PublicKeyFromPrivateKey(deriveX25519PrivateKey(rootSeed))));
  assert.deepEqual(keys.chatPublicKey, x25519PublicKeyFromPrivateKey(keys.chatPrivateKey));
  const message = new TextEncoder().encode("statement");
  assert.equal(verifySr25519(message, keys.sign(message), keys.accountId), true);
  assert.deepEqual(deriveIdentityKeys(mnemonic).identifierKey, keys.identifierKey, "deterministic");
});

// After a chain reset the backend still holds the username; the chain does
// not. Each outcome of a second claim is reported as the backend gave it.
test("reregisterIdentity: on-chain, claimed with the old digits, renamed by the backend, refused", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pca-reregister-test-"));
  const helper = fakeProofHelper(temp);
  const mnemonic = generateMnemonic(128);
  const { account } = deriveIdentityKeys(mnemonic);
  const backendUrl = "https://identity.example.test";
  const claims = [];
  const backend = (answer) => async (url, options) => {
    if (String(url).endsWith("/attester")) return new Response(JSON.stringify({ attester: `0x${"33".repeat(32)}` }), { status: 200 });
    claims.push(JSON.parse(options.body));
    return answer();
  };
  const directoryHolding = (key) => ({ identifierKeyFor: async (hex) => (hex === account ? key : null) });
  try {
    // Still on the chain: no claim is made.
    const kept = await reregisterIdentity({ mnemonic, username: "macbot.78", backendUrl, directory: directoryHolding(`0x00${"44".repeat(32)}${"00".repeat(32)}`), bandersnatchBin: helper, fetchImpl: backend(() => { throw new Error("must not claim"); }) });
    assert.deepEqual(kept, { outcome: "on-chain", account, username: "macbot.78" });
    assert.equal(claims.length, 0);

    // The chain forgot it; the backend accepts the same number again.
    const same = await reregisterIdentity({ mnemonic, username: "macbot.78", backendUrl, directory: directoryHolding(null), bandersnatchBin: helper, fetchImpl: backend(() => new Response(JSON.stringify({ username: "macbot.78" }), { status: 202 })) });
    assert.deepEqual(same, { outcome: "claimed", account, username: "macbot.78", renamed: false });
    assert.deepEqual([claims[0].username, claims[0].preferredDigits], ["macbot", "78"], "the old digits are asked for");

    // The backend will not reuse the number and assigns another.
    const renamed = await reregisterIdentity({ mnemonic, username: "macbot.78", backendUrl, directory: directoryHolding(null), bandersnatchBin: helper, fetchImpl: backend(() => new Response(JSON.stringify({ username: "macbot.91" }), { status: 202 })) });
    assert.deepEqual(renamed, { outcome: "claimed", account, username: "macbot.91", renamed: true });
    // A number chosen by the operator overrides the old one.
    await reregisterIdentity({ mnemonic, username: "macbot.78", digits: "12", backendUrl, directory: directoryHolding(null), bandersnatchBin: helper, fetchImpl: backend(() => new Response(JSON.stringify({ username: "macbot.12" }), { status: 202 })) });
    assert.equal(claims.at(-1).preferredDigits, "12");

    // The backend refuses: the answer is reported, not retried.
    const refused = await reregisterIdentity({ mnemonic, username: "macbot.78", backendUrl, directory: directoryHolding(null), bandersnatchBin: helper, fetchImpl: backend(() => new Response(JSON.stringify({ error: "Username already assigned" }), { status: 409, statusText: "Conflict" })) });
    assert.deepEqual([refused.outcome, refused.status, refused.username], ["refused", 409, "macbot.78"]);
    assert.match(refused.detail, /409 Conflict/);
    assert.match(refused.detail, /Username already assigned/);

    // No answer at all is not a backend decision.
    await assert.rejects(reregisterIdentity({ mnemonic, username: "macbot.78", backendUrl, directory: directoryHolding(null), bandersnatchBin: helper, fetchImpl: backend(() => { throw new Error("ECONNRESET"); }) }), /ECONNRESET/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
