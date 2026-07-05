# Architecture

How the framework works and why it is shaped this way. For setup instructions see
the [README](../README.md); for framework integrations see
[HARNESSES.md](HARNESSES.md).

## Transport

There is no chat server. Polkadot app chat rides the Statement Store, the chain's
store-and-forward message layer:

- The bot is an outbound-only client of a public RPC node. It polls topics
  addressed to its identity and publishes statements of its own. No inbound
  ports, no public IP.
- Statements persist in the store (bounded per account) until they expire, and
  reads are non-destructive, so a bot that was offline catches up by re-reading
  its topics.
- Conversations are end-to-end encrypted. Each session derives AES keys from a
  P256 ECDH shared secret between the parties' chat keys. The codec for all of
  this is vendored in `bot-core/vendor/app-chat-codec.mjs`.
- Exactly one process may serve a given bot identity at a time, or replies
  double-send.

## Sessions: the parts that are easy to get wrong

These were all learned by debugging against the real mobile app:

- **Openers vs. follow-ups.** A new conversation starts with an encrypted chat
  request on the bot's request topics. Subsequent messages arrive on session
  topics derived from the shared secret.
- **Per-device channels.** The app sends follow-ups on a channel derived from a
  per-device encryption key, not the identity key. A bot must poll every device
  session (`incomingDeviceSessions` from `makePeerSession`), not just the
  identity session, or app follow-ups silently never arrive. Test clients whose
  device key equals their identity key cannot reproduce this; use
  `test-client-device.mjs`.
- **Acknowledgements.** The app resends its backlog until it sees a session
  response ACK for each request. A bot that never ACKs receives every message
  again on every poll.
- **Batches.** One session statement can carry several messages, including kinds
  the bot cannot decode (for example image attachments). Decoding is per-message;
  one undecodable message must not abort the batch.
- **Persistence.** Session keys and channels exist only at the two endpoints;
  there is no server to rejoin. bot-core persists per-peer device keys and a
  dedup set to `BOT_STATE_DIR/session-state.json` and rebuilds sessions on
  startup (`makePeerSession` is deterministic), so restarts do not orphan open
  conversations.

## Identity: being messageable requires personhood

Two distinct on-chain capabilities are easy to conflate:

| Capability | How | Gives |
|---|---|---|
| Messageable (receive chats) | `Resources::register_lite_person`, gated on being an attested lite person | publishes an `identifier_key` in `Resources::Consumers`, plus statement bandwidth |
| Bandwidth only (publish) | `Resources::set_statement_store_account`, delegated from a person's own quota | statement slots, but no `identifier_key` |

The app resolves a recipient's chat key from `Resources::Consumers`. An account
that is not in that map cannot receive encrypted chats at all, so slot delegation
alone can never make a bot interactive.

Attestation of lite persons requires a verifier holding governance-granted quota.
This framework uses Parity's identity backend on Paseo as that verifier:
`pca create` generates the bot's keys, produces a bandersnatch ring-VRF
proof-of-ownership (the Rust helper in `tools/bandersnatch-cli`, shipped as a
committed wasm build and run via `node:wasi`), and submits the username claim to
the backend, which attests the account on-chain. Base usernames are not unique; a
two-digit discriminator (`mybot.07`) is assigned by the backend, or requested
with `--digits`.

A decentralized issuance path (a consumer-delegation extrinsic in the
`individuality` runtime, letting a person register identifier keys for delegate
accounts the way `set_statement_store_account` delegates bandwidth) would remove
the centralized verifier. That is a runtime change and remains future work.

## Components

```
bot-core (Node)
  identity + registration        cli.mjs create / lib/register.mjs
  transport                      index.mjs: poll, decode, ACK, send
  session persistence            lib/session-store.mjs
  brains                         direct CLI (claude/codex/gemini/grok) or bridge
  HTTP bridge                    for agent frameworks
  deploy + ops                   cli.mjs deploy / logs / status / stop

hermes-plugin/polkadot (Python)  Hermes BasePlatformAdapter over the bridge
openclaw-plugin/polkadot (TS)    OpenClaw channel plugin over the bridge
```

One transport, many brains. A direct brain shells out to a model CLI (the CLI
owns its own credentials; `BOT_AI_MODEL` selects the model). Bridge mode hands
messages to an external agent framework instead, so the language boundary between
the Node transport and a Python or TypeScript agent is one HTTP hop.

If no reply has gone out within `BOT_THINKING_AFTER_MS` (default 5s) of receiving
a message, the bot sends a "thinking" acknowledgement; any real reply cancels it.

## Bridge contract

Any framework that can run a poll loop can drive a bot:

- `GET /health` → `{ ok, account, identifierKey, username }`
- `GET /inbound?wait=<secs>` → long-poll, returns `[{ chat_id, text, message_id }, ...]`
  (empty array on timeout; `chat_id` is the peer's account-id hex)
- `POST /send { chat_id, text }` → `{ success, message_id }`
- `POST /typing { chat_id }` → best-effort no-op

bot-core enforces the allowlist before a message reaches the bridge, so unlisted
senders never reach the agent or spend model quota.

## Access control and cost

Anyone who can message an AI bot spends its owner's model quota. `pca create`
therefore requires either `--owner`/`--allow` (an allowlist, resolvable from an
app username) or an explicit `--public` for any brain that costs money.

## Security model

- `secret.json` (the bot's root seed) and `session-state.json` (session keys) are
  written mode 0600 and gitignored. Whoever holds the seed is the bot.
- The bot-core transport never handles model credentials: direct brains call the
  model's own CLI, and frameworks hold their own auth. The one exception is the
  deploy CLI — `pca deploy --anthropic-key` writes the key you pass into the
  container's `bot.env` so a headless `claude` bot can authenticate; treat that
  file as a secret (it also holds the seed; mode 0600, gitignored).
- Deployed harness stacks run the agent CLI as a non-root container user, so no
  permission-bypass flags are needed.
