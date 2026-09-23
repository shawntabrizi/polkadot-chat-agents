// A persona's registration on a real network, against a mocked identity
// backend and a mocked chain: the record is minted and persisted before the
// claim, the claim goes to the backend with the persona's own keys, the
// wait ends "attested" or stays "claimed" (pending) and resumes without a
// second claim, the chain check (not the genesis) marks a record the chain
// forgot and the next run registers it again — the old number first, a new
// one when the backend refuses it — and the Bulletin allowance failure is
// recorded, not thrown.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { deriveSr25519PublicKey } from "@novasamatech/statement-store";
import { verify as verifySr25519 } from "@scure/sr25519";
import { createPersonaStore } from "../lib/persona-store.mjs";
import { applyCheck, checkRegistration, defaultUsername, keysOf, mintPersonaRecord, provisionBulletin, registerPersona, registrationView } from "../lib/registration.mjs";
import { unwrapIdentifierKey } from "../lib/directory.mjs";
import { networkProfile } from "../lib/network.mjs";

const GENESIS = `0x${"4a".repeat(32)}`;
const concatBytes = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

function fakeProofHelper(dir) {
  const helper = path.join(dir, "proof-helper.mjs");
  fs.writeFileSync(helper, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ memberKey: "0x${"22".repeat(32)}", proofOfOwnership: "0xproof" }));\n`, { mode: 0o700 });
  return helper;
}
/** The identity backend: the attester, and a claim answered with a username. */
function fakeBackend(assign) {
  const claims = [];
  return {
    claims,
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/attester")) return new Response(JSON.stringify({ attester: `0x${"33".repeat(32)}` }), { status: 200 });
      const body = JSON.parse(options.body);
      claims.push(body);
      return new Response(JSON.stringify({ username: assign(body) }), { status: 202 });
    },
  };
}
/** The chain: accounts it holds an identifier key for (with the username each was attested under). */
const CONTAINER = `0x00${"44".repeat(32)}${"00".repeat(32)}`;
const fakeChain = (attested = new Set(), names = new Map(), keys = new Map()) => ({
  attested,
  names,
  keys,
  identifierKeyFor: async (account) => (attested.has(account) ? keys.get(account) ?? CONTAINER : null),
  consumer: async (account) => (attested.has(account) ? { account, username: names.get(account) ?? null, identifierKey: keys.get(account) ?? CONTAINER, credibility: "Lite" } : null),
  usernameOwner: async (name) => [...names.entries()].find(([account, n]) => n === name && attested.has(account))?.[0] ?? null,
});

test("the default username is the name when the backend takes it, else a padded one, else nothing", () => {
  assert.equal(defaultUsername("alicesmith"), "alicesmith");
  assert.equal(defaultUsername("alice"), "sandboxalice");
  assert.equal(defaultUsername("bob"), "sandboxbob");
  assert.equal(defaultUsername("alice2"), null, "digits are not letters");
  assert.equal(defaultUsername("a-b"), null);
  assert.throws(() => mintPersonaRecord("alice2"), /not a valid network username/);
  assert.equal(mintPersonaRecord("alice2", { username: "alicetwo" }).usernameBase, "alicetwo");
});

test("a minted record holds the keys a single-device identity needs, and keysOf derives them as bot-core would", () => {
  const record = mintPersonaRecord("alice", { genesis: GENESIS });
  assert.equal(record.mnemonic.split(" ").length, 12);
  assert.deepEqual([record.username, record.registration.status, record.registration.genesis, record.bulletin.status], [null, "minted", GENESIS, "none"]);
  const keys = keysOf(record);
  assert.deepEqual(keys.identity.identityAccountId, deriveSr25519PublicKey(keys.identity.seed), "the identity signs with the //wallet key");
  assert.equal(keys.deviceKeys.length, 1);
  assert.deepEqual(keys.deviceKeys[0].statementAccountId, keys.identity.identityAccountId, "the one device IS the identity account, as for a bot");
  assert.deepEqual(keys.deviceKeys[0].encryptionPublicKey, x25519.getPublicKey(keys.deviceKeys[0].encryptionPrivateKey));
  assert.notDeepEqual(keys.deviceKeys[0].encryptionPublicKey, keys.identity.identityChatPublicKey, "the device key is random, not the identity chat key");
  assert.deepEqual(unwrapIdentifierKey(keys.identifierKey), keys.identity.identityChatPublicKey, "the container the claim publishes wraps the chat key the persona uses");
  assert.deepEqual(keysOf(record).account, keys.account, "deterministic from the record");
  assert.equal(keys.bulletin.account.length, 66);
});

test("claim, wait, pending, resume, attested — one claim in total; the chain forgot it: registered again, old number first", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-registration-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bandersnatchBin = fakeProofHelper(temp);
  const store = createPersonaStore(path.join(temp, "state"));
  const backend = fakeBackend((body) => `${body.username}.07`);
  const chain = fakeChain();
  const saves = [];
  const save = async (record) => { saves.push(record.registration.status); store.savePersona(record); };
  const deps = { backendUrl: "https://identity.example.test", directory: chain, genesis: GENESIS, save, fetchImpl: backend.fetchImpl, bandersnatchBin, waitMs: 30 };

  const record = mintPersonaRecord("alice", { genesis: GENESIS });
  store.savePersona(record);
  const file = path.join(temp, "state", "personas", "alice", "identity.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, "the mnemonic is on disk 0600 before anything is claimed");
  assert.equal(fs.statSync(path.join(temp, "state")).mode & 0o777, 0o700);

  // The claim goes out with the persona's own account; attestation does not land in time.
  const pending = await registerPersona(record, deps);
  assert.deepEqual([pending.status, pending.username], ["claimed", "sandboxalice.07"]);
  assert.equal(backend.claims.length, 1);
  const { account, identifierKey } = keysOf(record);
  assert.equal(backend.claims[0].username, "sandboxalice", "the stem; the backend appends the number");
  assert.equal(backend.claims[0].identifierKey, identifierKey, "the claim publishes the container the persona chats with");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).username, "sandboxalice.07", "persisted with the assigned username");

  // Resume: no second claim, still pending.
  assert.equal((await registerPersona(record, deps)).status, "claimed");
  assert.equal(backend.claims.length, 1, "a pending record only waits");
  // The chain attests: resumed once more, attested.
  chain.attested.add(account);
  const done = await registerPersona(record, deps);
  assert.deepEqual([done.status, done.username, typeof done.attestedAt], ["attested", "sandboxalice.07", "string"]);
  assert.equal((await registerPersona(record, deps)).status, "attested", "idempotent");
  assert.equal(backend.claims.length, 1);
  assert.deepEqual(saves, ["claimed", "attested"]);

  // The chain forgot the registration (a migration; the genesis is unchanged):
  // the check marks the record with the chain's reason, and the next run
  // registers again — the old number first, then the backend's pick when it
  // refuses — with the same keys.
  const reloaded = store.loadPersonas().get("alice");
  assert.equal(reloaded.mnemonic, record.mnemonic);
  const wiped = fakeChain();
  const check = await checkRegistration(wiped, { account, username: "sandboxalice.07", identifierKey });
  assert.deepEqual(check, { onChain: false, reason: `the chain has no identifier key for ${account.slice(0, 10)}…` });
  assert.equal(applyCheck(reloaded, check), true);
  assert.deepEqual([registrationView(reloaded).status, registrationView(reloaded).reason], ["needs-reregistration", check.reason]);
  assert.equal(applyCheck(reloaded, check), false, "marking is idempotent");
  const again = fakeBackend((body) => `${body.username}.31`);
  const answers = [];
  const refusing = async (url, options) => {
    if (String(url).endsWith("/usernames") && JSON.parse(options.body).preferredDigits) { answers.push("409"); return new Response(JSON.stringify({ error: "Preferred digits 07 already taken for username sandboxalice" }), { status: 409, statusText: "Conflict" }); }
    return again.fetchImpl(url, options);
  };
  const view = await registerPersona(reloaded, { ...deps, directory: wiped, genesis: GENESIS, fetchImpl: refusing });
  assert.deepEqual([view.status, view.username, view.reason], ["claimed", "sandboxalice.31", null]);
  assert.deepEqual([answers, again.claims.map((c) => c.preferredDigits)], [["409"], [undefined]], "the old number was asked for and refused; the backend then chose");
  assert.equal(keysOf(reloaded).account, account, "the account did not change");
  // Attested again under the new name: the check clears the mark.
  wiped.attested.add(account); wiped.names.set(account, "sandboxalice.31"); wiped.keys.set(account, identifierKey);
  assert.equal(applyCheck(reloaded, await checkRegistration(wiped, { account, username: "sandboxalice.31", identifierKey })), true, "the check promotes a claimed record the chain attested");
  assert.deepEqual([registrationView(reloaded).status, registrationView(reloaded).reason], ["attested", null]);
  assert.ok(!JSON.stringify([pending, done, view]).includes(record.mnemonic.split(" ")[0]), "no view carries the mnemonic");

  // A record the chain holds after all (attested while marked): no claim, attested.
  const held = store.loadPersonas().get("alice");
  applyCheck(held, { onChain: false, reason: "stale mark" });
  const untouched = fakeBackend(() => { throw new Error("must not claim"); });
  const kept = await registerPersona(held, { ...deps, directory: wiped, fetchImpl: untouched.fetchImpl });
  assert.deepEqual([kept.status, kept.username, untouched.claims.length], ["attested", "sandboxalice.31", 0]);
  // The backend refuses every claim: the record stays marked and the error carries the backend's words.
  const marked = store.loadPersonas().get("alice");
  applyCheck(marked, { onChain: false, reason: "wiped" });
  const gated = async (url) => (String(url).endsWith("/attester") ? new Response(JSON.stringify({ attester: `0x${"33".repeat(32)}` }), { status: 200 }) : new Response(JSON.stringify({ error: "attestation required" }), { status: 401, statusText: "Unauthorized" }));
  await assert.rejects(registerPersona(marked, { ...deps, directory: fakeChain(), fetchImpl: gated }), /refused to register sandboxalice\.31 again: 401 Unauthorized/);
  assert.equal(registrationView(marked).status, "needs-reregistration");
});

test("the Bulletin allowance is provisioned through bot-core's testnet helper; failure is recorded, not thrown", async () => {
  const record = mintPersonaRecord("alice", { genesis: GENESIS });
  const calls = [];
  const saved = [];
  const save = async (r) => saved.push(r.bulletin.status);
  const sufficient = { present: true, active: true, expiresAt: 5000, currentBlock: 100, remainingBlocks: 4900, remainingTransactions: 1000, remainingBytes: 100_000_000n };
  const ok = await provisionBulletin(record, { botProfile: "paseo", save, ensure: async (args) => { calls.push(args); return { action: "authorized", ...sufficient }; } });
  assert.deepEqual([ok.status, ok.detail, ok.expiresAt], ["authorized", "authorized", 5000]);
  const low = await provisionBulletin(record, { botProfile: "paseo", save, ensure: async () => ({ action: "already-authorized", ...sufficient, remainingBlocks: 10 }) });
  assert.equal(low.status, "insufficient", "an allowance about to expire is not called authorized (bot-core's rule)");
  assert.equal(calls[0].networkProfile, "paseo");
  assert.match(calls[0].address, /^5/, "the upload signer as an SS58 address, what the faucet helper takes");
  const failed = await provisionBulletin(record, { botProfile: "paseo", save, ensure: async () => { throw new Error("faucet down"); } });
  assert.deepEqual([failed.status, failed.detail], ["failed", "faucet down"]);
  // The faucet answered after the helper's deadline: the chain is re-read until the grant shows.
  const unknown = Object.assign(new Error("finalization could not be confirmed"), { code: "TESTNET_ALLOWANCE_FINALIZATION_UNKNOWN" });
  const reads = [];
  const landed = await provisionBulletin(record, { botProfile: "paseo", save, settleMs: 200, pollMs: 10, ensure: async () => { throw unknown; }, readStatus: async () => { reads.push(1); return reads.length < 3 ? { ...sufficient, present: false, active: false } : sufficient; } });
  assert.deepEqual([landed.status, reads.length], ["authorized", 3]);
  const stuck = await provisionBulletin(record, { botProfile: "paseo", save, settleMs: 30, pollMs: 10, ensure: async () => { throw unknown; }, readStatus: async () => ({ present: false, active: false }) });
  assert.deepEqual([stuck.status, stuck.detail], ["pending", "finalization could not be confirmed"]);
  assert.deepEqual(saved, ["authorized", "insufficient", "failed", "authorized", "pending"]);
});

test("checkRegistration reads the key and the username back from the chain and names what is wrong; applyCheck promotes or marks", async () => {
  const account = `0x${"a1".repeat(32)}`;
  const other = `0x${"a2".repeat(32)}`;
  const chain = fakeChain(new Set([account, other]), new Map([[account, "echobot.19"], [other, "macbot.78"]]));
  assert.deepEqual(await checkRegistration(chain, { account, username: "echobot.19", identifierKey: CONTAINER }), { onChain: true, consumer: { account, username: "echobot.19", identifierKey: CONTAINER, credibility: "Lite" } });
  assert.deepEqual(await checkRegistration(chain, { account }), { onChain: true, consumer: { account, username: "echobot.19", identifierKey: CONTAINER, credibility: "Lite" } }, "no username known: the key is enough");
  assert.deepEqual(await checkRegistration(chain, { account: `0x${"a3".repeat(32)}`, username: "gone.01" }), { onChain: false, reason: `the chain has no identifier key for 0x${"a3".repeat(4)}…` });
  assert.deepEqual(await checkRegistration(chain, { account, username: "echobot.20" }), { onChain: false, reason: "the chain has no username echobot.20" });
  assert.deepEqual(await checkRegistration(chain, { account, username: "macbot.78" }), { onChain: false, reason: "macbot.78 belongs to another account on the chain" });
  assert.deepEqual(await checkRegistration(chain, { account, identifierKey: `0x00${"55".repeat(32)}${"00".repeat(32)}` }), { onChain: false, reason: "the chain holds a different identifier key for this account" });
  await assert.rejects(checkRegistration({ consumer: async () => { throw new Error("socket closed"); } }, { account }), /socket closed/, "unreachable is not gone");

  // applyCheck: a claimed record the chain holds becomes attested; a minted one is never marked; a marked one is cleared.
  const claimed = mintPersonaRecord("alice", { genesis: GENESIS });
  claimed.registration.status = "claimed";
  assert.equal(applyCheck(claimed, { onChain: true }), true);
  assert.deepEqual([claimed.registration.status, typeof claimed.registration.attestedAt], ["attested", "string"]);
  const minted = mintPersonaRecord("bob", { genesis: GENESIS });
  assert.equal(applyCheck(minted, { onChain: false, reason: "no key" }), false, "nothing was claimed yet: nothing to re-register");
  // A claim the chain does not hold yet is pending, not forgotten (devnet's attester took 51 s for one persona and
  // stalled for the next, 2026-09-15): marking it would make `pcs user register` claim a second username.
  const pending = mintPersonaRecord("carol", { genesis: GENESIS });
  pending.registration.status = "claimed";
  assert.equal(applyCheck(pending, { onChain: false, reason: "no key" }), false, "a pending claim is left alone");
  assert.deepEqual([registrationView(pending).status, registrationView(pending).reason], ["claimed", null]);
  assert.equal(applyCheck(claimed, { onChain: false, reason: "wiped" }), true);
  assert.deepEqual([claimed.registration.needsReregistration, claimed.registration.reason], [true, "wiped"]);
  assert.equal(applyCheck(claimed, { onChain: true }), true);
  assert.deepEqual([claimed.registration.needsReregistration, claimed.registration.reason, claimed.registration.status], [false, null, "attested"]);
});

// The identity backend of a client-proof profile (Products Devnet): the
// challenge, the token minted with the persona's own //wallet key, the
// bearer on the claim, the session persisted 0600 before the claim and
// dropped after it, an issued PCA_IDENTITY_TOKEN in place of the exchange,
// the PCA_IDENTITY_VOUCHER fallback after a refusal, and the refusal itself
// as the `pcs user add` error that names the enrollment rules.
function fakeClientProofBackend({ refuse = () => false, assign = (body) => `${body.username}.05` } = {}) {
  const calls = [];
  const challenge = Buffer.alloc(48, 5).toString("base64");
  return {
    calls,
    fetchImpl: async (url, options = {}) => {
      const route = new URL(String(url)).pathname;
      const headers = new Headers(options.headers ?? {});
      calls.push({ route, headers, body: options.body ?? null });
      if (route.endsWith("/auth/challenges")) return new Response(JSON.stringify({ challenge }), { status: 201 });
      if (route.endsWith("/auth/token")) {
        if (refuse(headers)) return new Response(JSON.stringify({ error: "platform attestation required" }), { status: 401, statusText: "Unauthorized" });
        return new Response(JSON.stringify({ token: "access.jwt.token", refreshToken: "refresh-token" }), { status: 200 });
      }
      if (route.endsWith("/attester")) return new Response(JSON.stringify({ attester: `0x${"33".repeat(32)}` }), { status: 200 });
      return new Response(JSON.stringify({ username: assign(JSON.parse(options.body)) }), { status: 202 });
    },
  };
}

test("Paseo registration authenticates with the persona's wallet and retains credentials only until the claim succeeds", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-registration-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bandersnatchBin = fakeProofHelper(temp);
  const store = createPersonaStore(path.join(temp, "state"));
  const file = path.join(temp, "state", "personas", "alice", "identity.json");
  const backend = fakeClientProofBackend();
  const sessionsOnDiskAtClaim = [];
  const fetchImpl = async (url, options) => {
    if (new URL(String(url)).pathname.endsWith("/usernames")) sessionsOnDiskAtClaim.push(JSON.parse(fs.readFileSync(file, "utf8")).identityRegistrationSession ?? null);
    return backend.fetchImpl(url, options);
  };
  const record = mintPersonaRecord("alice", { genesis: GENESIS });
  store.savePersona(record);
  const profile = networkProfile("paseo");
  const deps = { backendUrl: profile.identityBackendUrl, identityAuth: profile.identityRegistrationAuth, env: {}, directory: fakeChain(), genesis: GENESIS, save: async (r) => store.savePersona(r), fetchImpl, bandersnatchBin, waitMs: 30 };

  const view = await registerPersona(record, deps);
  assert.deepEqual([view.status, view.username], ["claimed", "sandboxalice.05"]);
  assert.deepEqual(backend.calls.map((c) => c.route), ["/api/v1/auth/challenges", "/api/v1/auth/token", "/api/v1/attester", "/api/v1/usernames"], "challenge, token, then the claim");
  const token = backend.calls[1];
  const { identity } = keysOf(record);
  assert.deepEqual(new Uint8Array(Buffer.from(token.headers.get("auth-clientid"), "base64")), identity.identityAccountId, "the client is the persona's //wallet key — the account the claim registers");
  assert.equal(token.headers.has("auth-attestation-type"), false, "no voucher offered before a refusal");
  const proof = new Uint8Array(Buffer.from(token.headers.get("auth-clientproof"), "base64"));
  const challenge = new Uint8Array(Buffer.from(token.headers.get("auth-challenge"), "base64"));
  const clientDataHash = sha256(concatBytes(challenge, identity.identityAccountId, sha256(new TextEncoder().encode(token.body))));
  assert.equal(verifySr25519(clientDataHash, proof, identity.identityAccountId), true, "the proof is the persona's signature over the backend's client-data hash");
  assert.equal(backend.calls[3].headers.get("authorization"), "Bearer access.jwt.token", "the claim carries the minted bearer");
  assert.deepEqual(sessionsOnDiskAtClaim, [{ backendUrl: new URL(profile.identityBackendUrl).href, token: "access.jwt.token", refreshToken: "refresh-token" }], "the session was on disk before the claim, so a failed claim reuses it");
  assert.equal(record.identityRegistrationSession, undefined, "and is dropped once the claim is in");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).identityRegistrationSession, undefined);
  assert.ok(!JSON.stringify(view).includes("access.jwt.token"), "no view carries the token");
});

test("client-proof: an issued PCA_IDENTITY_TOKEN skips the exchange; a refusal names the enrollment rules; the voucher is offered only after it", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-registration-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bandersnatchBin = fakeProofHelper(temp);
  const base = { backendUrl: "https://identity.example.test", identityAuth: "client-proof", directory: fakeChain(), genesis: GENESIS, save: async () => {}, bandersnatchBin, waitMs: 30 };

  // An issued bearer: no challenge, the token as given.
  const issued = fakeClientProofBackend();
  const withToken = await registerPersona(mintPersonaRecord("alice", { genesis: GENESIS }), { ...base, env: { PCA_IDENTITY_TOKEN: "issued.jwt.token" }, fetchImpl: issued.fetchImpl });
  assert.equal(withToken.status, "claimed");
  assert.deepEqual(issued.calls.map((c) => c.route), ["/api/v1/attester", "/api/v1/usernames"]);
  assert.equal(issued.calls[1].headers.get("authorization"), "Bearer issued.jwt.token");

  // The backend refuses the client proof and no voucher is set: no claim, the record stays minted, the error tells the operator what to set and where.
  const refusing = fakeClientProofBackend({ refuse: () => true });
  const record = mintPersonaRecord("alice", { genesis: GENESIS });
  await assert.rejects(registerPersona(record, { ...base, env: {}, fetchImpl: refusing.fetchImpl }), (error) => {
    assert.match(error.message, /refused to enroll alice with the client proof of its wallet key \(401 Unauthorized/);
    assert.match(error.message, /PCA_IDENTITY_VOUCHER \(a single-use enrollment voucher\) or PCA_IDENTITY_TOKEN \(an issued bearer\) in its environment/);
    assert.match(error.message, /pcs user add alice {2}again/);
    return true;
  });
  assert.equal(record.registration.status, "minted");
  assert.ok(!refusing.calls.some((c) => c.route.endsWith("/usernames")), "nothing was claimed without a bearer");

  // A voucher in the environment: presented on the second try only, and the claim goes through.
  const voucher = Buffer.alloc(32, 7).toString("base64");
  const gated = fakeClientProofBackend({ refuse: (headers) => headers.get("auth-attestation-type") !== "voucher" });
  const view = await registerPersona(record, { ...base, env: { PCA_IDENTITY_VOUCHER: voucher }, fetchImpl: gated.fetchImpl });
  assert.equal(view.status, "claimed");
  const tokenTries = gated.calls.filter((c) => c.route.endsWith("/auth/token"));
  assert.equal(tokenTries.length, 2);
  assert.deepEqual(tokenTries.map((c) => c.headers.get("auth-attestation-type")), [null, "voucher"], "the client proof first, the voucher after the refusal");
  assert.equal(tokenTries[1].headers.get("auth-voucher-secret"), voucher);
  assert.ok(!JSON.stringify(view).includes(voucher), "no view carries the voucher");

  // A custom backend without a bearer: no exchange at all, and no authorization header.
  const open = fakeClientProofBackend();
  await registerPersona(mintPersonaRecord("alice", { genesis: GENESIS }), { ...base, identityAuth: "none", env: {}, fetchImpl: open.fetchImpl });
  assert.deepEqual(open.calls.map((c) => c.route), ["/api/v1/attester", "/api/v1/usernames"]);
  assert.equal(open.calls[1].headers.get("authorization"), null);
});
