# Use Products Devnet

Products Devnet is an opt-in network for integration work. New bots use Paseo
Next v2 unless you pass `--network devnet`.

Devnet uses a different People chain, identity backend, Bulletin chain, HOP
nodes, and file-allowance profile. Its identity backend also protects username
writes with a bearer session, so creating a registered bot requires a
credential that Paseo does not.

## Get an enrollment voucher

Ask the Devnet operator for one single-use enrollment voucher for each new
client enrollment. The voucher is a base64-encoded 32-byte secret.

You cannot generate a token that the hosted Devnet will accept solely on your
Mac. The backend issues and verifies its own sessions; a locally generated JWT
has no trust relationship with that service. A local mock is still useful for
testing PCA's client flow, but it cannot grant access to the hosted Devnet.

## Create a Devnet bot

Keep the voucher out of command arguments and shell history:

```bash
read -s PCA_IDENTITY_VOUCHER
export PCA_IDENTITY_VOUCHER
pca create devagent --network devnet --brain claude --owner <your-username-or-address>
unset PCA_IDENTITY_VOUCHER
```

From a source checkout, use the repository command:

```bash
read -s PCA_IDENTITY_VOUCHER
export PCA_IDENTITY_VOUCHER
npm run pca -- create devagent --network devnet --brain claude --owner <your-username-or-address>
unset PCA_IDENTITY_VOUCHER
```

PCA generates a fresh SR25519 client key, proves possession of it, and exchanges
the voucher at the Devnet identity backend. It stores the returned access and
refresh tokens in the bot's mode-`0600` `secret.json` only while registration is
incomplete. The voucher itself is never saved.

If you do not have a voucher yet, you can prepare the local identity without
attempting registration:

```bash
pca create devagent --network devnet --brain claude \
  --owner <your-username-or-address> --no-register
```

Supply the voucher later and finish with `pca register devagent`.

## Retry safely

If voucher exchange succeeded but the username write or network confirmation
was interrupted, the saved session is already reusable. Do not present the
single-use voucher again:

```bash
unset PCA_IDENTITY_VOUCHER
pca register devagent
```

PCA refreshes an expiring saved session automatically and removes the saved
registration session after the username claim succeeds.

For controlled automation, `PCA_IDENTITY_TOKEN` can provide an already-issued
backend bearer token instead. Do not place either credential in a checked-in
file or a CLI argument.

## Test the flow locally on macOS

The repository's registration tests run without a voucher or a live network.
They use a mocked identity backend while exercising the real SR25519
client-proof construction, voucher request, session persistence and refresh,
and authenticated username write:

```bash
cd bot-core
node --test --test-timeout=900000 test/register.test.mjs test/cli.test.mjs
```

The repository does not ship a full Devnet emulator. A complete emulator would
need a compatible People chain, attester, and identity backend configured to
trust the same local issuer. The mocked tests are the practical way to validate
PCA's authentication client on a Mac; a real end-to-end registration still
needs an operator voucher and the hosted Devnet.

To verify the missing-credential safety check without creating an identity,
unset both credential variables and run an explicit Devnet create. PCA should
stop before it writes a bot directory:

```bash
unset PCA_IDENTITY_VOUCHER PCA_IDENTITY_TOKEN
pca create credentialcheck --network devnet --brain echo --public
```

Use a disposable, previously unused local name for that check.

## Verify and run

After registration:

```bash
pca info devagent
pca storage devagent status
pca run devagent --greet
```

`pca info` shows the selected network and registered identity. Private Devnet
bots also use the Devnet-specific test file-delivery allowance.

## Return to Paseo

Omit `--network` for every new Paseo bot:

```bash
pca create paseoagent --brain claude --owner <your-username-or-address>
```

The network profile is saved when a bot is created. Changing the default does
not migrate existing bot identities, so create a new local bot name rather than
editing an existing bot's `config.json`.

For the exact environment variables and endpoints, see
[Configuration](/reference/configuration). For live-network contributor checks,
see [Testing without a phone](/guide/testing#products-devnet-registration).
