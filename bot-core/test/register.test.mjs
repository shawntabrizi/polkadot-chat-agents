import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateMnemonic } from "@polkadot-labs/hdkd-helpers";
import { verify as verifySr25519 } from "@scure/sr25519";
import {
  acquireIdentitySession,
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

test("voucher enrollment matches the identity backend client-proof contract", async () => {
  const voucher = Buffer.alloc(32, 7).toString("base64");
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ token: "access.jwt.token", refreshToken: "refresh-token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await redeemIdentityVoucher({
    backendUrl: "https://identity.example.test",
    secret: voucher,
    fetchImpl,
  });

  assert.deepEqual(result, { token: "access.jwt.token", refreshToken: "refresh-token" });
  assert.equal(request.url, "https://identity.example.test/api/v1/auth/token");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, "{}");
  const headers = new Headers(request.options.headers);
  assert.equal(headers.get("auth-attestation-type"), "voucher");
  assert.equal(headers.get("auth-voucher-secret"), voucher);

  const clientId = new Uint8Array(Buffer.from(headers.get("auth-clientid"), "base64"));
  const proof = new Uint8Array(Buffer.from(headers.get("auth-clientproof"), "base64"));
  const challenge = new Uint8Array(Buffer.from(headers.get("auth-challenge"), "base64"));
  assert.equal(clientId.length, 32);
  assert.equal(proof.length, 64);
  assert.equal(challenge.length, 24);
  const body = new TextEncoder().encode("{}");
  const clientDataHash = sha256(concatBytes(challenge, clientId, sha256(body)));
  assert.equal(verifySr25519(clientDataHash, proof, clientId), true);
});

test("acquired voucher sessions are persisted and reused without redeeming twice", async () => {
  const voucher = Buffer.alloc(32, 11).toString("base64");
  const future = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: future })).toString("base64url")}.x`;
  const requests = [];
  let persisted = null;
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ token: jwt, refreshToken: "refresh-token" }), { status: 200 });
  };

  const first = await acquireIdentitySession({
    backendUrl: "https://identity.example.test",
    enrollmentVoucher: voucher,
    persistSession: (session) => { persisted = session; },
    fetchImpl,
  });
  const second = await acquireIdentitySession({
    backendUrl: "https://identity.example.test/",
    enrollmentVoucher: voucher,
    savedSession: persisted,
    fetchImpl,
  });

  assert.equal(first.token, jwt);
  assert.equal(second.token, jwt);
  assert.equal(requests.length, 1);
  assert.deepEqual(persisted, {
    backendUrl: "https://identity.example.test/",
    token: jwt,
    refreshToken: "refresh-token",
  });
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
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/attester")) {
      return new Response(JSON.stringify({ attester: `0x${"33".repeat(32)}` }), { status: 200 });
    }
    return new Response(JSON.stringify({ username: "testbot.01" }), { status: 202 });
  };

  try {
    await registerIdentity({
      mnemonic: generateMnemonic(128),
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
});
