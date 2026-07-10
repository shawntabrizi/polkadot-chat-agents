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
  request on the recipient's request topics. Subsequent messages arrive on
  session topics derived from the shared secret.
- **Either side can initiate.** The bot can also open a chat (the `--greet`
  feature sends the owner a first-contact request). As initiator it must handle
  the peer's `multiChatAccepted` reply, which advertises the peer's *device*
  encryption key — fold that into the session or the peer's device-channel
  replies go unseen (the mirror image of the per-device-channels rule below).
- **Per-device channels.** The app sends follow-ups on a channel derived from a
  per-device encryption key, not the identity key. A bot must poll every device
  session (`incomingDeviceSessions` from `makePeerSession`), not just the
  identity session, or app follow-ups silently never arrive. Test clients whose
  device key equals their identity key cannot reproduce this; use
  `test-client-device.mjs`.
- **Acknowledgements.** The app resends its backlog until it sees a session
  response ACK for each request. A bot that never ACKs receives every message
  again on every poll. bot-core ACKs on delivery (before the brain runs) and
  journals the owed reply to the state file first, so a crash between ACK and
  answer re-runs the brain on restart instead of silently dropping the message.
  When a pipeline is full the statement is deferred un-ACKed — the app's resend
  is the retry (backpressure, never ACK-then-drop).
- **One statement per channel (outbound lanes).** The statement store keeps a
  single statement per (account, channel), and every bot→peer message rides the
  session request channel — so publishing a second statement before the peer
  fetched the first silently REPLACES it. All outbound session messages
  therefore flow through a per-peer outbound lane (`lib/outbound-lanes.mjs`),
  mirroring the app's own `OutgoingRequestQueue`: at most one un-ACKed request
  statement is current per peer; messages that arrive meanwhile extend it (a
  re-encoded superset under a new requestId — replacement is then lossless,
  receivers dedup by messageId) or wait in a bounded queue that drains on the
  peer's session-response ACK. ACKs of a superseded requestId are ignored (the
  peer will fetch and ACK the extended statement too). Liveness backstop: when
  messages are queued behind a statement un-ACKed for
  `BOT_OUTBOUND_ACK_GRACE_MS` (60s), the queued batch takes the slot over
  (old-style replacement, so an unreachable peer can't mute the bot); with
  nothing queued the current statement waits in the slot indefinitely. Never
  submit directly on the request channel.
- **Long answers are chunked.** A reply is split by `lib/chunk.mjs`
  (`BOT_REPLY_CHUNK_BYTES`, default 4000 UTF-8 bytes; splits prefer paragraph
  boundaries, re-open code fences across parts, never tear a UTF-8 code point)
  into several messages that ride the outbound lane in order. This keeps every
  bubble readable and every statement far below the account's 500 KiB
  statement allowance (`LitePersonStatementLimit` on the people chain). The
  first part finalizes the live placeholder; the rest follow as messages.
- **Batches.** One session statement can carry several messages, including kinds
  the bot cannot decode (unknown content kinds, future attachment variants).
  Decoding is per-message; one undecodable message must not abort the batch.
- **Persistence.** Session keys and channels exist only at the two endpoints;
  there is no server to rejoin. bot-core persists per-peer device keys, a dedup
  set, and the owed-replies journal to `BOT_STATE_DIR/session-state.json` and
  rebuilds sessions on startup (`makePeerSession` is deterministic), so restarts
  do not orphan open conversations or drop ACKed-but-unanswered messages.
- **Ingress.** Statements arrive by subscription (`statement_subscribeStatement`
  via the vendored ingress supervisor): chunked `matchAny` groups for openers
  and session topics, resubscribed when the watch set changes. Liveness is
  proven end-to-end — the bot submits a heartbeat statement on a private
  channel (channel replacement = one slot, ever) and expects it back through
  its own subscription; a miss resubscribes. The poll loop remains as a slow
  reconciliation sweep (`BOT_SWEEP_MS`, 30s) that re-examines deferred
  statements, and falls back to full cadence (`BOT_POLL_MS`) whenever the
  subscription is unhealthy or disabled (`BOT_SUBSCRIBE=0`). Sweep queries use
  the same chunked `matchAny` batches, so RPC count stays roughly constant as
  peers accumulate. All dispatch — pages and sweep results — runs through one
  serial chain, so per-session handling order never interleaves.

## Messages beyond text

Wire formats for the non-text content kinds were recovered from the mobile app
source (`polkadot-app-ios-v2`: `Modules/Chat/Model/RemoteChatMessage.swift`,
`ChatRichRemoteContent.swift`, `Packages/HandoffService/`). What the bot does
with each inbound kind:

| Kind | Handling |
|---|---|
| text (0), richText (15), reply (7), edited (12) | run the brain (journaled + owed like any message) |
| reacted / reactionRemoved (4/5) | recorded: logged, and delivered to `/inbound?events=1` bridge pollers — never answered (a chat reply to a reaction is bizarre UX) |
| coinageSend (16), contactAdded (3), leftChat (13) | logged + bridge event; coinage is informational only (claiming needs the full Coinage stack) |
| dataChannelOffer (8) | auto-declined with dataChannelClosed (11) after the ACK — the bot has no WebRTC stack, declining beats ringing forever |
| anything else | logged (`BOT_UNSUPPORTED_CONTENT` / `BOT_UNDECODABLE_MESSAGE`) and skipped |

Outbound, the bot can send plain text, replies (quotes), edits of its own
messages, and reactions.

**Attachments (photos/videos/files).** The chat message carries only a
reference — `{ identifier, claimTicket, wssUrl, meta }` — and the encrypted
bytes live on a "HOP" store-and-forward node (JSON-RPC over WebSocket,
`hop_claim`/`hop_ack`). Everything needed to fetch and decrypt derives from the
32-byte `claimTicket` in the message (AES-256-GCM key and the sr25519 claim
keypair, both via keyed blake2b), so receiving needs no on-chain state.
`lib/hop-client.mjs` downloads in the per-peer work queue strictly *after* the
ACK; blobs land in `BOT_STATE_DIR/media/<identifierHex>.<ext>` (0600, TTL +
size-capped sweep) and are served to harnesses at `GET /media/:id`. A download
failure becomes a note to the brain, never a dropped message.

The peer chooses the `wssUrl`, so it is hostile input: wss-only, no credentials
or IP-literal hosts, size caps enforced against the metadata *and* the actual
bytes, per-chunk blake2b integrity checks. The app trusts only HOP nodes from
its remote config; the bot has no equivalent list, so the default is
allow-with-caps — set `BOT_HOP_ALLOWED_NODES` (comma-separated host suffixes)
to pin trusted nodes. The `claimTicket` is key material: it is journaled with
the owed message (the state file already holds session keys) but never logged
and never crosses the bridge.

**Sending files is not implemented.** The upload path needs `hop_submit` with a
wallet-signed sender proof *plus* an on-chain bulletin-chain allowance for the
bot account, and a trusted node to upload to — backlog, pending live
investigation of whether a bot account can obtain that allowance.

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
  brains                         direct engine (claude/codex/opencode) or bridge
  agent engines                  lib/runners.mjs (engine table) + index.mjs runEngine
  HTTP bridge                    for agent frameworks
  deploy + ops                   cli.mjs deploy / logs / status / stop

hermes-plugin/polkadot (Python)  Hermes BasePlatformAdapter over the bridge
openclaw-plugin/polkadot (TS)    OpenClaw channel plugin over the bridge
```

One transport, many brains. A **direct engine** runs a headless coding-agent CLI
(claude/codex/opencode) as an autonomous agent: the message is passed verbatim
(no injected persona), continuity is the CLI's native session via `--resume`
(a token captured from its event stream, persisted per peer, invalidated on an
engine/workspace change), and tools run in a persistent workspace. `lib/runners
.mjs` holds each engine's argv builder + JSONL-event normalizer (to one
started/action/text/result vocabulary); `runEngine` in index.mjs owns the shared
loop — spawn in a process group, stream and normalize, feed live-reply progress
frames, and enforce an idle-silence backstop (no wall-clock limit; a long build
is legitimate, a wedge is killed and the peer queue unblocks). `/stop` cancels a
turn (intercepted before the per-peer queue), `/reset` starts a fresh session.
opencode reaches many providers through one `--model provider/model` flag, so
there are no per-vendor brains.

Per-peer engine knobs: `/model` (any string, passed to the CLI's model flag),
`/reasoning` (validated against the engine's levels — claude
`--effort low|medium|high|xhigh|max`, codex `-c model_reasoning_effort=…`;
opencode has none), `/project` (see workspaces below). Each turn's token/cost
usage from the CLI's result event is logged as `BOT_AI_USAGE` and tallied
in-memory for `/usage`. Downloaded attachments are staged into the turn cwd's
`.attachments/` before the engine runs, so the agent acts on files inside its
own workspace.

Multi-project workspaces (`BOT_AI_PROJECTS`, managed by `pca project`): a peer
picks a registered project with `/project <alias>` — or `/project
<alias>@<branch>`, which resolves to a lazily-created `git worktree` under
`BOT_STATE_DIR/worktrees` (`lib/workspaces.mjs`; conservative alias/branch
charsets, path-escape guards). The active project persists per peer in the
session snapshot; switching clears the resume token, because a resumed engine
session is only valid in the cwd it started in. Bridge mode instead hands messages to an external
agent framework over one HTTP hop. Deployed engines run in a non-root container
that is the sandbox for their tools (see HARNESSES.md).

If no reply has gone out within `BOT_THINKING_AFTER_MS` (default 5s) of receiving
a message, the bot posts a "thinking" placeholder — a LIVE message that is then
edited in place (elapsed clock, Takopi-style `▸ action` lines from claude's
stream-json tool events) until the answer finalizes it. Edits are gated on the
peer's session ACK for the placeholder (channel replacement would otherwise
orphan them), throttled with an escalating interval, and coalesced latest-wins;
a peer that never ACKs gets the answer as a plain message instead. See
docs/LIVE-REPLIES.md for the research and the full constraint set. This also
means the bot now consumes the app's session-response ACKs (it previously
ignored them).

## Bridge contract

Any framework that can run a poll loop can drive a bot:

- `GET /health` → `{ ok, account, identifierKey, username }`
- `GET /inbound?wait=<secs>` → long-poll, returns `[{ chat_id, text, message_id }, ...]`
  (empty array on timeout; `chat_id` is the peer's account-id hex). Items may
  carry `kind`, `reply_to`, `edit_of`, and `attachments` (metadata + a
  `/media/:id` URL). `&events=1` additionally delivers non-message signals
  (reactions, coinage, leftChat, contactAdded) — opt-in, because an unaware
  harness would chat-reply to a reaction.
- `GET /media/:id` → bytes of a downloaded attachment
- `POST /send { chat_id, text, reply_to?, edit_of? }` → `{ success, message_id }`
  (`reply_to` renders a quote; `edit_of` rewrites one of the bot's own messages)
- `POST /react { chat_id, message_id, emoji, remove? }` → `{ success }`
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
- The bot-core transport never handles model credentials: direct engines call
  the CLI (which owns its own auth), and frameworks hold their own. The
  exception is the deploy CLI — `pca deploy --anthropic-key` (and
  `--openai-key`/`--openrouter-key`/…) writes the key into the container's
  `bot.env`; OAuth creds can instead be mounted at `./home`. Treat `bot.env` as
  a secret (it also holds the seed; mode 0600, gitignored).
- Deployed engines and harness stacks run the CLI as a non-root container user
  (`USER node`), which is what lets a direct engine use
  `--dangerously-skip-permissions` safely — the container is the sandbox for its
  tools (own filesystem, open egress, nothing from the host; the allowlist gates
  who can drive it). `--safe-tools` restricts to a read/write/edit/bash allowlist.
