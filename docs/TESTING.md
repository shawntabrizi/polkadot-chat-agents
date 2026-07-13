# Testing a bot without a phone

## Offline, automated (no network at all)

`npm test` in `bot-core/` runs the transport end-to-end against an in-memory
statement node (`test/mock-statement-node.mjs`): round trips with poison
batches, restart survival with dedup, owed-reply crash recovery, and the rich
features — attachment download (against an in-memory HOP node,
`test/mock-hop-node.mjs`), reply quotes, reactions, and call auto-decline —
each in both ingress modes (poll-only and subscription). Single-mode tests
cover the bridge surface (`/inbound` shape, `/media`, `reply_to`/`edit_of`/
`/react`, `events=1`), an owed *attachment* surviving kill -9, and the
live-reply lifecycle (placeholder → ACK-gated progress edits with stream-json
tool actions → final-as-edit; the no-ACK plain-message fallback; bridge
auto-upgrade + throttled harness edits). CI runs this on every push.
`BOT_PEER_IDENTIFIER_KEYS` pins peer identifier keys so no people chain is
needed. The device client ACKs bot requests like the app does; `--no-ack`
simulates a peer that never fetches.

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
| `BOT_LIVE_PLACEHOLDER` / `BOT_LIVE_FALLBACK` | thinking placeholder posted / peer never ACKed it, answer sent plain |
| `BOT_LIVE_ACK_TIMEOUT` / `BOT_LIVE_EDIT_FAILED` / `BOT_LIVE_FINALIZE_FAILED` | live-reply edge cases (progress dropped, final fell back) |
| `BOT_AI_FAILED` / `BOT_AI_AUTH_REVOKED` / `BOT_AI_IDLE_TIMEOUT` | direct-engine turn failed / needs re-login / was killed by the idle backstop |
| `BOT_STOP` / `BOT_RESUME_INVALIDATED` | user /stop cancelled a turn / resume tokens dropped after an engine, model, or workspace change |

## CI

`.github/workflows/ci.yml` runs on every push: bot-core installs from scratch and
its CLI creates a bot offline, the vendored wasm proof helper is run against a
known answer, the OpenClaw plugin bundle is rebuilt and compared to the committed
`dist/`, and the Rust proof helper builds for native and wasm targets.
