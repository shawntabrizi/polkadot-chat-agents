# Testing a bot without a phone

Both test clients send real messages over the Statement Store from an attested
identity and print the bot's replies. You need the sender's root seed and the
target bot's account id and identifier key (`pca info <name>` prints the bot's
values; the account and identifier key are in its `config.json`).

## Basic round trip

```bash
node bot-core/test-client.mjs \
  --seed-hex 0x<sender-root-seed> \
  --bot-account 0x<bot-account-hex> \
  --bot-identifier-key 0x<bot-p256-hex> \
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
  --bot-identifier-key 0x<bot-p256-hex> \
  "hello from a device channel"
```

If a bot answers `test-client.mjs` but not the app, this client is the repro
tool: the bug is almost certainly in device-session polling or ACKs.

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
| `BOT_SENT_TEXT` | reply published |
| `BOT_AI_FAILED` / `BOT_AI_TIMEOUT` / `BOT_AI_AUTH_REVOKED` | direct-brain model call failed (the last one means re-login) |

## CI

`.github/workflows/ci.yml` runs on every push: bot-core installs from scratch and
its CLI creates a bot offline, the vendored wasm proof helper is run against a
known answer, the OpenClaw plugin bundle is rebuilt and compared to the committed
`dist/`, and the Rust proof helper builds for native and wasm targets.
