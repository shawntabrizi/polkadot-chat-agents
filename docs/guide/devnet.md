# Use Products Devnet

Products Devnet is the default network for new bots. Paseo Next v2 remains
available with `--network paseo`.

Devnet uses a different People chain, identity backend, Bulletin chain, HOP
nodes, and file-allowance profile. Its identity backend also protects username
writes with a bearer session. `pca` obtains that session automatically from the
bot's own wallet key.

## How automatic authentication works

The hosted Devnet currently runs platform attestation in development/soft
mode. It still requires a JWT for username writes, but a headless client may
mint that JWT with an SR25519 challenge-response:

1. Request a server challenge from `POST /api/v1/auth/challenges`.
2. Derive the bot's `//wallet` SR25519 key.
3. Sign `SHA256(challenge || clientId || SHA256("{}"))`.
4. Exchange the proof at `POST /api/v1/auth/token` without platform headers.
5. Use the returned bearer token for `POST /api/v1/usernames`.

The backend signs the JWT; `pca` does not fabricate a local token. The JWT
subject is the bot's wallet public key, which keeps registration and any
account-scoped follow-up APIs aligned.

## Create a Devnet bot

```bash
pca create devagent --brain claude --owner <your-username-or-address>
```

From a source checkout, use the repository command:

```bash
npm run pca -- create devagent --brain claude --owner <your-username-or-address>
```

PCA proves possession of the bot's wallet key and stores the returned access
and refresh tokens in the bot's mode-`0600` `secret.json` only while
registration is incomplete.

To prepare only the local identity without attempting registration:

```bash
pca create devagent --brain claude \
  --owner <your-username-or-address> --no-register
```

Finish later with `pca register devagent`; authentication is still automatic.

## Retry safely

If token exchange succeeded but the username write or network confirmation was
interrupted, the saved session is already reusable:

```bash
pca register devagent
```

PCA refreshes an expiring saved session automatically and removes the saved
registration session after the username claim succeeds.

For controlled automation, `PCA_IDENTITY_TOKEN` can provide an already-issued
backend bearer token instead. If the Devnet operator later enables hard
platform-attestation enforcement, `PCA_IDENTITY_VOUCHER` can provide a
single-use fallback; `pca` first tries automatic enrollment and only presents
the voucher after an authentication rejection. Keep either optional credential
out of checked-in files and command arguments.

## Test the flow locally on macOS

The repository's registration tests use a mocked identity backend while
exercising the real SR25519 client-proof construction, challenge exchange,
wallet binding, optional voucher fallback, session persistence and refresh,
and authenticated username write:

```bash
cd bot-core
node --test --test-timeout=900000 test/register.test.mjs test/cli.test.mjs
```

The hosted auth exchange can also be exercised directly by creating a
disposable bot; no mobile emulator is required. A complete local Devnet
emulator would still need a compatible People chain, attester, and identity
backend:

```bash
pca create credentialcheck --brain echo --public
```

Use a disposable, previously unused username because this performs a real
registration.

## Verify and run

After registration:

```bash
pca info devagent
pca storage devagent status
pca run devagent --greet
```

`pca info` shows the selected network and registered identity. Private Devnet
bots also use the Devnet-specific test file-delivery allowance.

## Use Paseo

Select it explicitly for every new Paseo bot:

```bash
pca create paseoagent --network paseo --brain claude --owner <your-username-or-address>
```

The network profile is saved when a bot is created. Changing the default does
not migrate existing bot identities, so create a new local bot name rather than
editing an existing bot's `config.json`.

For the exact environment variables and endpoints, see
[Configuration](/reference/configuration). For live-network contributor checks,
see [Testing without a phone](/guide/testing#products-devnet-registration).
