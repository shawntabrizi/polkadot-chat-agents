---
prev:
  text: "Agent frameworks"
  link: "/guide/harnesses"
next:
  text: "Configuration (env vars)"
  link: "/reference/configuration"
---

# Testing a bot without a phone

## The local sandbox: a whole network on your machine

`sandbox/` is a local replica of the chat network: a statement-store node,
a directory that plays the People chain and the identity backend, and
"personas" — users with one or more devices, driven from the terminal with
`pcs`. Personas run the SDK behind Polkadot Desktop, not bot-core's
transport, so a bot is tested against an independent implementation of the
protocol. No phone, no testnet, no proof.

```bash
cd sandbox && npm ci
pcs up                                   # store node + directory + control API
pca create mybot --brain echo --network sandbox   # registers through the sandbox, no proof
pca run mybot                            # in another terminal
pcs user add alice --devices 2
pcs request alice mybot --welcome "hello"   # alice opens the chat; the bot accepts
pcs send alice mybot "from my laptop" --device 2
pcs inbox alice --device 2               # the bot's answers, with per-device ACK state
pcs wire --peer alice                    # every statement, labelled by session and channel
```

`pca create --network sandbox` finds the daemon through `--sandbox-url`,
`PCA_SANDBOX_URL`, or the `daemon.json` that `pcs up` writes. `pcs bot attach
<name>` registers a bot's account by hand (it reads only `config.json`).

Scenarios are scripted conversations with assertions, run as tests:

```bash
pcs scenario run scenarios/echo-roundtrip.mjs   # alice (2 devices) ↔ echo bot: opener,
                                                # device-2 follow-up, reaction, reply, edit
pcs scenario run scenarios/bot-restart.mjs      # kill -9 with a reply owed, restart: one answer
```

`npm test` in `sandbox/` runs them with the rest of the suite (and CI does).
Anything that touches sessions or inbound handling must keep both green.

## Offline, automated (no network at all)

`npm test` in `bot-core/` runs the transport end-to-end against the sandbox
daemon (`sandbox/daemon.mjs`: its store node and its directory, so the
identifier-key lookup is the deployed path through `lib/people-directory.mjs`,
not a pin list). It covers, in both ingress modes (poll-only and subscription):

- round trips with poison batches, restart survival with dedup, and owed-reply
  crash recovery;
- the rich features — attachment download (against an in-memory HOP node,
  `test/mock-hop-node.mjs`), reply quotes, reactions, and call auto-decline.

Single-mode tests cover the bridge surface (`/inbound` shape, `/media`,
`reply_to`/`edit_of`/`/react`, `events=1`), an owed *attachment* surviving
kill -9, and the live-reply lifecycle: placeholder → ACK-gated progress edits
with stream-json tool actions → final-as-edit, the no-ACK plain-message
fallback, and bridge auto-upgrade with throttled harness edits.

CI runs this on every push. The device client ACKs bot requests like the
app does; `--no-ack` simulates a peer that never fetches.

## Live network

Both test clients send real messages over the Statement Store from an attested
identity and print the bot's replies. You need the sender's root seed and the
target bot's account id and identifier key (`pca info <name>` prints the bot's
values; the account and identifier key are in its `config.json`).

## Basic round trip

```bash
node bot-core/test-client.mjs \
  --seed-hex 0x<sender-root-seed> \
  --bot-account 0x<bot-account-hex> \
  --bot-identifier-key 0x<bot-identifier-container-hex> \
  --wait-secs 45 \
  "hello" "a follow-up message"
```

The first message is a chat opener; later arguments are sent as follow-ups on the
identity session channel. Replies print as `[BOT] ...` and the exit code is
non-zero if none arrived.

Note that session topics are reused between runs, so a long-lived test identity
will also print stale replies from earlier conversations. Check for a reply to
the text you actually sent.

## Device-channel round trip

The mobile app does not send follow-ups the way `test-client.mjs` does: it uses a
per-device encryption key, which puts messages on a different session channel
than the identity key would. `test-client-device.mjs` reproduces that behavior,
including a multi-device envelope opener and an undecodable message in a batch:

```bash
node bot-core/test-client-device.mjs \
  --seed-hex 0x<sender-root-seed> \
  --bot-account 0x<bot-account-hex> \
  --bot-identifier-key 0x<bot-identifier-container-hex> \
  "hello from a device channel"
```

If a bot answers `test-client.mjs` but not the app, this client is the repro
tool: the bug is almost certainly in device-session polling or ACKs.

The sandbox scenarios cover the same ground with the real SDK (opener,
per-device follow-ups, reaction, reply, edit, restart survival) and are the
preferred check. `test-client-device.mjs` stays for what they do not cover
yet: an undecodable message in a batch (the "poison" richText), a real HOP
attachment, `--no-ack`, a call offer, and sending over a live network. It is
also the harness of bot-core's offline suite. Known limit: it keys the
multi-device envelope by the peer's identity account, ignoring the
`statementAccountId` in `deviceChatAccepted`, so a peer whose device account
differs from its identity account (a persona, a phone) cannot decrypt its
follow-ups; bot-core's own device account equals its identity account, so
the offline suite is unaffected. It will be retired when the sandbox covers
the remaining cases (S3, v1.5).

## Named-testnet outbound file delivery

Create an allowlisted bot on default Products Devnet, or add `--network paseo`
to exercise the Paseo profile. Normal local
onboarding provisions its derived allowance on the selected testnet
automatically, including an expiry refresh when needed. Confirm it with:

```bash
pca storage <name> status
```

If it is missing, expired, or low, grant it locally with
`pca storage <name> grant`. This is a genesis-pinned transaction to the
selected testnet's faucet; it targets the derived allowance account, not the
bot's main chat address. Run it from the machine that has
`~/.pca/bots/<name>/secret.json`: `pca` derives the target locally and never
sends that seed or mnemonic to the faucet.

Do not retry an interrupted or uncertain grant. Wait for finalization, run
`pca storage <name> status`, then run `pca storage <name> recover`. A sufficient
on-chain allowance clears the persistent local guard without another faucet
transaction. If it remains insufficient, use `recover --yes` only after
verifying that the old transaction cannot finalize; it clears the guard only,
so run `grant` separately if still needed.

Then send a small attachment with the caption `/file put check.txt`, followed by
`/file get check.txt`. The app should receive the returned attachment and the
bot log should contain `BOT_FILE_DELIVERED`.

This validates a real HOP upload. The test faucet and its quota are not a
production provisioning path; production allocation remains an explicit local
operator flow.

## Products Devnet registration

See [Use Products Devnet](/guide/devnet) for the full enrollment flow, local
macOS tests, retry behavior, and the boundary between a mock and the hosted
network.

No phone, voucher, or pre-generated JWT is needed for a live registration
test. Use a disposable bot name:

```bash
npm run pca -- create testagent --brain echo --owner <your-username-or-address>
```

`pca` requests a Devnet challenge, signs the client-proof payload with the
bot's own wallet key, and stores the returned session in the bot's mode-`0600`
`secret.json` only while registration is incomplete. If the username write or
network confirmation is interrupted, run:

```bash
npm run pca -- register testagent
```

The retry reuses or refreshes the saved session. To regression-test the
alternate network, add `--network paseo`. `PCA_IDENTITY_TOKEN` is an optional
controlled-automation override; `PCA_IDENTITY_VOUCHER` is only a fallback if
the hosted environment later hard-enforces platform attestation.

Optional flags exercise the rich features after the follow-ups: `--reply 1`
(follow-ups quote the bot's last message), `--react "🔥"` (expect an ACK and no
reply), `--offer-call 1` (send a WebRTC offer; exit code fails unless the bot
declines it), and `--attach '<json>'` + `--attach-caption` (send a real
richText attachment pre-uploaded to a HOP node — the offline suite generates
the JSON via the mock node's `putFile`).

## Live checklist with a real phone

After transport changes, verify against the actual app: send a photo (expect
`BOT_MEDIA_DOWNLOADED` and a reply that reflects it), react to a bot message
(`BOT_RECEIVED_REACTION`, no reply), edit one of your messages (the bot answers
again with `kind: "edited"` logged), place a call (the app should show it
declined), and send a Coinage payment (`BOT_COINAGE_RECEIVED`, log only).

## Restart survival

To verify persistence, message a bot, restart its process (or
`docker compose up -d --force-recreate` its container), and send a follow-up on
the same session without a new opener. The bot's log should show
`BOT_STATE_RESTORED` on startup and a `BOT_RECEIVED_TEXT` for the follow-up. Old
messages must not be re-answered after the restart.

## Useful log events

bot-core logs one JSON line per event. The ones worth grepping:

| Event | Meaning |
|---|---|
| `BOT_LISTENING` | identity loaded, polling started |
| `BOT_STATE_RESTORED` | sessions and dedup reloaded from disk |
| `BOT_RECEIVED_OPENER` / `BOT_RECEIVED_TEXT` | inbound message accepted |
| `BOT_REJECTED_UNLISTED` | sender not on the allowlist |
| `BOT_SESSION_DECODE_FAILED` | follow-up arrived but could not be decrypted |
| `BOT_SENT_TEXT` | reply published (carries `replyTo`/`editOf` when quoting/editing) |
| `BOT_MEDIA_DOWNLOADED` / `BOT_MEDIA_DOWNLOAD_FAILED` | attachment fetched from the HOP node (or not — the brain gets a failure note) |
| `BOT_RECEIVED_REACTION` / `BOT_SENT_REACTION` | emoji reaction in / out |
| `BOT_CALL_OFFER` / `BOT_CALL_DECLINED` | WebRTC call offer received / auto-declined |
| `BOT_COINAGE_RECEIVED` | peer sent a Coinage payment (informational; the bot cannot claim it) |
| `BOT_UNDECODABLE_MESSAGE` / `BOT_UNSUPPORTED_CONTENT` | message kind the codec can't parse / doesn't know |
| `BOT_LIVE_PLACEHOLDER` / `BOT_LIVE_STATUS` / `BOT_LIVE_FALLBACK` | thinking placeholder posted / retired to its status line / peer never ACKed it, answer superseded it instead |
| `BOT_LIVE_ACK_TIMEOUT` / `BOT_LIVE_EDIT_FAILED` / `BOT_LIVE_FINALIZE_FAILED` | live-reply edge cases (progress dropped, final fell back) |
| `BOT_AI_FAILED` / `BOT_AI_AUTH_REVOKED` / `BOT_AI_IDLE_TIMEOUT` | direct-engine turn failed / needs re-login / was killed by the idle backstop |
| `BOT_STOP` / `BOT_RESUME_INVALIDATED` | user /stop cancelled a turn / resume tokens dropped after an engine, model, or workspace change |

## CI

`.github/workflows/ci.yml` runs on every push: bot-core installs from scratch and
its CLI creates a bot offline, the vendored wasm proof helper is run against a
known answer, the sandbox suite runs with its scenarios (a pca bot against
personas), the OpenClaw plugin bundle is rebuilt and compared to the committed
`dist/`, and the Rust proof helper builds for native and wasm targets.
