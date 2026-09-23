---
prev:
  text: "Architecture & security"
  link: "/explanation/architecture"
---

# The wire protocol

This page is the ground truth for how the transport and sessions actually
behave. Several behaviors exist because of hard-won protocol facts, learned by
debugging against the real mobile app — read this before changing transport or
session code. For configuration see the
[configuration reference](/reference/configuration); for framework
integrations see [Agent frameworks](/guide/harnesses).

## Transport

There is no chat server. Polkadot app chat rides the Statement Store, the
chain's store-and-forward message layer:

- The bot is an outbound-only client of a public RPC node. It polls topics
  addressed to its identity and publishes statements of its own. No inbound
  ports, no public IP.
- Statements persist in the store (bounded per account) until they expire, and
  reads are non-destructive, so a bot that was offline catches up by re-reading
  its topics.
- Conversations are end-to-end encrypted. Peers agree raw X25519 shared
  secrets, use those raw bytes for topic/channel derivation, and derive
  ChaCha20-Poly1305 keys with HKDF-SHA256 (empty salt and info). Frames are
  `nonce12 || ciphertext || tag16`, with no AAD. The codec for all of this is
  vendored in `bot-core/vendor/app-chat-codec.mjs`.
- Exactly one process may serve a given bot identity at a time, or replies
  double-send.

## Sessions: the parts that are easy to get wrong

### Openers vs. follow-ups

A new conversation starts with an encrypted chat request on the recipient's
request topics. Subsequent messages arrive on session topics derived from the
shared secret.

### Either side can initiate

The bot can also open a chat (the `--greet` feature sends the owner a
first-contact request). As initiator it must handle the peer's
`DeviceChatAccepted` reply, which advertises the peer's *device* encryption
key — fold that into the session or the peer's device-channel replies go
unseen (the mirror image of the per-device-channels rule below).

### Per-device channels

The app sends follow-ups on a channel derived from a per-device encryption
key, not the identity key. A bot must poll every device session
(`incomingDeviceSessions` from `makePeerSession`), not just the identity
session, or app follow-ups silently never arrive. Test clients whose device
key equals their identity key cannot reproduce this; the sandbox personas
(a device is its own statement account and encryption key) do (see
[Testing](/guide/testing)).

### Acknowledgements

The app resends its backlog until it sees a session response ACK for each
request. A bot that never ACKs receives every message again on every poll.

bot-core ACKs on delivery (before the brain runs) and journals the owed reply
to the state file first, so a crash between ACK and answer re-runs the brain
on restart instead of silently dropping the message. When a pipeline is full
the statement is deferred un-ACKed — the app's resend is the retry
(backpressure, never ACK-then-drop).

The journal holds the answer too, once it exists. The store pushes a stored
statement to subscribers before it answers the submitter, so a bot killed
right after submitting its reply leaves the phone holding an answer the
journal (question only) knows nothing about; a restart would run the brain
again and send a second answer under a new id — with an LLM, a different
one. Every message a direct turn sends is therefore recorded in its owed
entry (message id, exact envelope bytes, superseded ids) and made durable
before the outbound lane submits it. On restart an entry with a journaled
answer is re-sent as-is under the same ids (peers dedup by id; usually the
statement is still in the slot and the re-send changes nothing) and only an
entry with no answer re-runs the brain. The placeholder and its progress
frames are not the answer and are never journaled. The entry leaves the
journal once the answer is on the node (the submit returned), not on the
peer's ACK: a peer that is offline for days must not pin the bounded journal
that admits every other peer's messages. Bridge deliveries keep their own
contract (settled by the harness's lease ACK) and are not journaled here.

### One statement per channel (outbound lanes)

The statement store keeps a single statement per (account, channel), and every
bot→peer message rides the session request channel — so publishing a second
statement before the peer fetched the first silently REPLACES it. Never submit
directly on the request channel.

All outbound session messages therefore flow through a per-peer outbound lane
(`lib/outbound-lanes.mjs`), mirroring the app's own `OutgoingRequestQueue`:

- At most one un-ACKed request statement is current per peer.
- Messages that arrive meanwhile extend it (a re-encoded superset under a new
  requestId — replacement is then lossless, receivers dedup by messageId) or
  wait in a bounded queue that drains on the peer's session-response ACK.
- ACKs of a superseded requestId are ignored (the peer will fetch and ACK the
  extended statement too).
- Liveness backstop: when messages are queued behind a statement un-ACKed for
  `BOT_OUTBOUND_ACK_GRACE_MS` (60s), the queued batch takes the slot over
  (old-style replacement, so an unreachable peer can't mute the bot); with
  nothing queued the current statement waits in the slot indefinitely.

### Long answers are chunked

A reply is split by `lib/chunk.mjs` (`BOT_REPLY_CHUNK_BYTES`, default 4000
UTF-8 bytes; splits prefer paragraph boundaries, re-open code fences across
parts, never tear a UTF-8 code point) into several messages that ride the
outbound lane in order. This keeps every bubble readable and every statement
far below the account's 500 KiB statement allowance
(`LitePersonStatementLimit` on the people chain). The first part finalizes the
live placeholder; the rest follow as messages.

### Batches

One session statement can carry several messages, including kinds the bot
cannot decode (unknown content kinds, future attachment variants). Decoding is
per-message; one undecodable message must not abort the batch.

### Persistence

Session keys and channels exist only at the two endpoints; there is no server
to rejoin. bot-core persists its random X25519 device private key, per-peer
identity/device public keys, a dedup set, and the owed-replies journal to
`BOT_STATE_DIR/session-state.json` and rebuilds sessions on startup
(`makePeerSession` is deterministic), so restarts do not orphan open
conversations or drop ACKed-but-unanswered messages.

### Ingress

Statements arrive by subscription (`statement_subscribeStatement` via the
vendored ingress supervisor): chunked `matchAny` groups for openers and
session topics, resubscribed when the watch set changes.

Liveness is proven end-to-end — the bot submits a heartbeat statement on a
private channel (channel replacement = one slot, ever) and expects it back
through its own subscription; a miss resubscribes.

The poll loop remains as a slow reconciliation sweep (`BOT_SWEEP_MS`, 30s)
that re-examines deferred statements, and falls back to full cadence
(`BOT_POLL_MS`) whenever the subscription is unhealthy or disabled
(`BOT_SUBSCRIBE=0`). Sweep queries use the same chunked `matchAny` batches, so
RPC count stays roughly constant as peers accumulate.

All dispatch — pages and sweep results — runs through one serial chain, so
per-session handling order never interleaves.

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
| deleted (21) | RFC-0003 tombstone, see [Message deletion](#message-deletion-rfc-0003) — never answered |
| buttons (242) | answered like text: the brain gets the text and the labels as a numbered list, see [Buttons](#buttons-spec-0006) |
| buttonPress (243) | a brain turn with `[button] <label>`, only for a buttons message this bot sent to that peer |
| anything else | logged (`BOT_UNSUPPORTED_CONTENT` / `BOT_UNDECODABLE_MESSAGE`) and skipped |

Outbound, the bot can send plain text, replies (quotes), edits of its own
messages, reactions, HOP-backed file attachments, and buttons (spec 0006).

### Message deletion (RFC-0003)

chat-spec RFC-0003 (`rfcs/0003-message-deletion.md`) adds `deleted(DeletedContent { messageId: UUID })`: the sender retracts one of
its own messages. The layout is one SCALE string after the content byte, like
an edit target (`encodeOpaqueDeletedMessage` in `vendor/app-chat-codec.mjs`).

**Content kind 21, not 20.** The RFC text says 20, but 20 is
`DeviceChatAccepted` (`mds.md`, and `@novasamatech/host-chat`), and 19 is held
for RFC-0002. The RFC's own rule for a clash ("whatever is next free at merge
time") gives 21. `DELETED_CONTENT_KIND` is the only place to change it.

**Receiving is always on** (`lib/message-deletion.mjs`, wired in `index.mjs`):

- A deletion applies only to a message the bot received from that same peer.
  The receive record is keyed by peer, so a peer cannot touch another peer's
  message or the bot's own. An unknown target goes into that peer's pending
  set (500 per peer; eviction is safe) and applies if the target arrives later.
- An applied deletion drops every copy the bot still holds: an owed message
  not yet handed to the brain is never answered, an unleased bridge delivery
  is withdrawn, and downloaded attachment bytes are removed. Text that an
  engine already received stays in the engine's native session (no engine
  lets pca edit its history); bridge pollers get a `deleted` event with
  `target_message_id` so a harness can drop it from its own history.
- Deletion is terminal: an `edited` for a deleted message is ignored. A second
  deletion of the same target is a no-op.
- Tombstones and pending deletions persist with the peer's session (`dl`).
- Log: `BOT_RECEIVED_DELETED { from, messageId, applied: true | false | "pending" }`
  (`false` with `duplicate: true` for a repeat), and
  `BOT_DELETED_MESSAGE_DROPPED` when a message or edit is dropped for it.

**Sending is gated per peer.** A phone that predates the RFC renders kind 21 as
an "Unsupported message content" bubble, so the bot sends a deletion to a peer
only when:

- that peer has sent the bot a deletion itself (evidence; persisted with the
  session as `x`, logged once as `BOT_PROTOCOL_EXTENSION_ENABLED { peer, kind }`), or
- the operator sets `BOT_PROTOCOL_EXTENSIONS=deleted` (comma list, default
  empty), which enables it for every peer.

`deleteMessage(peerHex, messageId)` follows the RFC's sender cases on top of
the outbound lane: a message still queued and never submitted is removed with
no wire trace; otherwise, when the gate allows it, the deletion is enqueued
with `supersedes: [messageId]`, so a target still in the un-ACKed statement
leaves the slot in the same re-encode that carries the deletion. Without the
gate, nothing is sent (`BOT_DELETE_SKIPPED`). Live replies use it once: when a
placeholder was never ACKed, the fallback answer already supersedes it, and
the bot then also retracts it, in case the peer fetched it without the ACK
arriving.

### Buttons (spec 0006)

Spec 0006 (`polkadot-chat-desktop/docs/spec/0006-buttons.md`) adds two
provisional kinds from the desktop spec set (range 240–249):

```
buttons(ButtonsContent)         -> 242
buttonPress(ButtonPressContent) -> 243
ButtonsContent     { text: String, rows: Vec<Vec<Button>>, oneShot: bool }
Button             { label: String, action: Action }
Action             { command(String)=0 | callback(Bytes)=1 | url(String)=2 | tx(Bytes)=3 }
ButtonPressContent { messageId: String, row: u8, index: u8, payload: Bytes }
```

The envelope is the usual one (messageId, timestamp u64 LE, version 0, kind
byte). `tx` is opaque bytes until RFC 0007. Limits: 8 rows of 4 buttons,
labels up to 40 characters, callback payloads up to 256 bytes. The codec is
`encodeOpaqueButtonsMessage` / `encodeOpaqueButtonPressMessage` in
`vendor/app-chat-codec.mjs`; two pinned byte vectors are in
`polkadot-chat-desktop/docs/spec/vectors-0006.md` and in `test/codec.test.mjs`.
An action tag above 3 has no known length, so such a message is undecodable
(the rest of the batch still decodes).

**A brain sends buttons** by ending its reply with a fenced block tagged
`buttons` (parser: `lib/buttons-block.mjs`, shared with the desktop client):

````
Pick one
```buttons
{"rows": [[{"label": "Yes", "action": {"command": "yes"}},
           {"label": "More", "action": {"callback": "page-2"}}],
          [{"label": "Docs", "action": {"url": "https://polkadot.com"}}]],
 "oneShot": false}
```
````

- `command`: the client sends the string as the user's text.
- `callback`: UTF-8 bytes, or raw bytes with a `base64:` prefix; the client
  sends them back in a `buttonPress`.
- `url`: `https://` or `polkadotapp://` only.
- `oneShot` is optional (default false). `tx` is not offered to brains.

The bot strips the block and sends the rest of the text plus the rows as ONE
kind-242 message (a long text is chunked; the last part carries the rows).
An invalid block (bad JSON, a broken limit, a block that does not end the
reply) is left as plain text. A quoted bridge reply (`reply_to`) cannot be a
buttons message, so it gets the fallback.

**Sending is gated per peer**, with the same gate as deletion. A peer gets
kind 242 only when it has sent the bot any extension kind (21, 242, 243, or
another 240–249 kind; evidence persisted as `x`), or when the operator sets
`BOT_PROTOCOL_EXTENSIONS=buttons`. Any other peer gets the spec's fallback: the
text, then the labels as a numbered list (`BOT_BUTTONS_FALLBACK`). The operator
context tells a brain about the block only for a peer that can render it (a
bridge harness gets one context for every peer, so there the hint follows
`BOT_PROTOCOL_EXTENSIONS=buttons`).

**Receiving a press:** a `buttonPress` is accepted only for a buttons message
this bot sent to that same peer (the bot keeps its last 50 per peer, persisted
as `bp`). It then runs a brain turn with the text `[button] <label>`, plus
` (payload: <hex>)` when the press carries bytes, and logs
`BOT_RECEIVED_BUTTON_PRESS { from, messageId, row, index }`. A press for an
unknown message, another peer's message, or a missing button is logged as
`BOT_BUTTON_PRESS_IGNORED` and dropped. A `buttons` message from a peer reaches
the brain as its fallback text. `command` presses arrive as normal text and
`url` presses never reach the bot.

### Attachments (photos/videos/files)

The chat message carries only a reference —
`{ identifier, claimTicket, wssUrl, meta }` — and the encrypted bytes live on
a "HOP" store-and-forward node (JSON-RPC over WebSocket,
`hop_claim`/`hop_ack`). Everything needed to fetch and decrypt derives from
the 32-byte `claimTicket` in the message (ChaCha20-Poly1305 key and the sr25519
claim keypair, both via keyed blake2b), so receiving needs no on-chain state.
The HOP encryption key is used directly; it does not pass through HKDF.

`lib/hop-client.mjs` downloads in the per-peer work queue strictly *after* the
ACK; blobs land in `BOT_STATE_DIR/media/<identifierHex>.<ext>` (0600, TTL + a
hard cache budget enforced before every write) and are served to harnesses at
`GET /media/:id`. A download failure becomes a note to the brain, never a
dropped message.

The peer chooses the `wssUrl`, so it is hostile input: wss-only, no
credentials or IP-literal hosts, size caps enforced against the metadata *and*
the actual bytes, capped JSON-RPC frames, and per-chunk blake2b integrity
checks. The app trusts only HOP nodes from its remote config; the bot has no
equivalent list, so production attachment downloads require
`BOT_HOP_ALLOWED_NODES` (comma-separated trusted host suffixes). The
`claimTicket` is key material: it is journaled with the owed message (the
state file already holds session keys) but never logged and never crosses the
bridge.

### Durable files

Media is intentionally an evictable cache. A user opts into long-lived storage
by captioning exactly one attachment `/file put <path>`. `lib/file-store.mjs`
copies it into a private, peer-scoped vault with a manifest, path/symlink
checks, atomic updates, global limits, and independent per-peer byte and entry
limits. `/file ls`, `/file info`, `/file rm`, and `/file get` operate only
within that sender's namespace. The bridge exposes the same vault under
authenticated `GET/PUT/DELETE /files/<chat_id>[/<path>]`, never an arbitrary
host path.

### Sending files

`lib/hop-client.mjs` implements `hop_submit`: it generates a fresh claim
ticket, encrypts the chunks and metadata with ChaCha20-Poly1305, signs every
submission from `//allowance//bulletin//chat`, and wraps the resulting reference in an
encrypted rich-text message. The upload endpoint is operator-pinned with
`BOT_HOP_UPLOAD_NODE`; peer-supplied HOP endpoints are never used for uploads.

That signer needs a Bulletin storage allowance. The fixed private Products
Devnet and Paseo profiles are the narrow exceptions: local `pca` can call the
selected profile's public `//Eve` test faucet for its derived account. Each
profile pins its own Bulletin genesis and descriptor. `pca storage <bot>
status|grant|recover` keeps that testnet action local: it preflights capacity
and expiry, refreshes a near-expiry authorization before a top-up, and leaves
a profile-scoped persistent local guard after an interrupted or ambiguous
faucet submit. Recovery always reads the selected chain before permitting
another grant. This is not a transport-daemon action and does not solve
production provisioning.

A deployed `BOT_SEED_HEX` can derive and use the signer, but it cannot safely
create a production allowance: the People-chain claim requires the original
mnemonic-derived Bandersnatch person proof plus the live
`AsResources(ClaimLongTermStorage)` extension. Keep that proof material off
the VPS; production allocation belongs in a confirmed local operator flow, not
a chat command or the transport daemon.

## Identity: being messageable requires personhood

Two distinct on-chain capabilities are easy to conflate:

| Capability | How | Gives |
|---|---|---|
| Messageable (receive chats) | `Resources::register_lite_person`, gated on being an attested lite person | publishes an `identifier_key` in `Resources::Consumers`, plus statement bandwidth |
| Bandwidth only (publish) | `Resources::set_statement_store_account`, delegated from a person's own quota | statement slots, but no `identifier_key` |

The app resolves a recipient's chat key from `Resources::Consumers`. An
account that is not in that map cannot receive encrypted chats at all, so slot
delegation alone can never make a bot interactive.

Attestation of lite persons requires a verifier holding governance-granted
quota. This framework uses the selected named profile's identity backend—the
Polkadot Community Foundation service on default Products Devnet, or the Parity
service on Paseo—as that verifier. The Products Devnet backend additionally
requires an authenticated session for writes. While its platform-attestation
gate is in development mode, a headless `pca` client obtains a server
challenge, signs the client-proof payload with the bot's `//wallet` SR25519
key, persists the returned JWT session only across an incomplete registration,
and sends the access token with the username claim. The JWT subject is
therefore the bot account. A single-use operator voucher remains a fallback if
the platform-attestation gate is later hard-enforced. Paseo retains its
unauthenticated registration path.

`pca create` generates the bot's keys, produces a bandersnatch
ring-VRF proof-of-ownership (the Rust helper in `tools/bandersnatch-cli`,
shipped as a committed wasm build and run via `node:wasi`), and submits the
username claim to the backend, which attests the account on-chain. Base
usernames are not unique; a two-digit discriminator (`mybot.07`) is assigned
by the backend, or requested with `--digits`.

The on-chain `identifier_key` is a fixed 65-byte RFC004 container:
`0x00 || x25519_public_key32 || zero_padding32`. Other type bytes are rejected
as unsupported. This is a breaking key migration: bots registered with a
legacy P-256 identifier key must publish the X25519 container before current
apps can message them. `bot-core/scripts/rotate-identifier-key.mjs` does that
without re-registering: run it with the bot's env (`BOT_SEED_HEX`,
`BOT_ENDPOINT`, `BOT_NETWORK_PROFILE`) and it submits an owner-signed
`Resources.update_identifier_key` when the on-chain key differs (`--dry-run`
to only report). It is a deliberate operator step, not runtime self-healing.

A decentralized issuance path (a consumer-delegation extrinsic in the
`individuality` runtime, letting a person register identifier keys for
delegate accounts the way `set_statement_store_account` delegates bandwidth)
would remove the centralized verifier. That is a runtime change and remains
future work.

## Components

```
bot-core (Node)
  identity + registration        cli.mjs create / lib/register.mjs
  transport                      index.mjs: poll, decode, ACK, send
  session persistence            lib/session-store.mjs
  brains                         direct engine (claude/codex/opencode/kimi) or bridge
  agent runtime                  lib/agent-runtime.mjs (turns, per-peer state,
                                 commands) over lib/runners.mjs (engine table)
  HTTP bridge                    for agent frameworks
  deploy + ops                   cli.mjs deploy / logs / status / stop

hermes-plugin/polkadot (Python)  Hermes BasePlatformAdapter over the bridge
openclaw-plugin/polkadot (TS)    OpenClaw channel plugin over the bridge
```

One transport, many brains. A **direct engine** runs a headless coding-agent
CLI (claude/codex/opencode/kimi) as an autonomous agent. The user's message is
kept as the user prompt while PCA separately supplies deterministic facts about
the running bot and an optional operator-owned `PERSONA.md`. Continuity is the
CLI's native session via `--resume` (a token captured from its event stream,
persisted per peer, invalidated on an engine/workspace change), and tools run
in a persistent workspace. Claude receives context through its system prompt;
Codex, OpenCode, and Kimi use a PCA-marked `AGENTS.md`, with a first-prompt
fallback when an operator owns that filename.

`lib/runners.mjs` holds each engine's argv builder + JSONL-event normalizer
(to one started/action/text/result vocabulary); `lib/agent-runtime.mjs` owns
everything above it — the shared turn loop (spawn in a process group, stream
and normalize, feed live-reply progress frames, an idle-silence backstop plus
a configurable hard wall-clock cap, `BOT_AI_MAX_MS`, default one hour; a long
build is legitimate, a wedge is killed and the peer queue unblocks), all
per-peer agent state, and the in-chat commands. The runtime is
transport-blind: index.mjs hands it a three-call `chat` surface (sendText /
deliver / beginTurn) — the in-process twin of the HTTP bridge that serves
out-of-process brains. `/stop` cancels a turn (intercepted before the per-peer
queue), `/reset` starts a fresh session. opencode reaches many providers
through one `--model provider/model` flag, so there are no per-vendor brains.

Per-peer engine knobs: `/model` (operator-locked by default; an explicitly
approved set or explicit non-public open policy permits switching),
`/reasoning` (validated against the engine's levels — claude
`--effort low|medium|high|xhigh|max`, codex `-c model_reasoning_effort=…`;
opencode and kimi have none), `/project` (see workspaces below). Each turn's token/cost
usage from the CLI's result event is logged as `BOT_AI_USAGE` and tallied
in-memory for `/usage`. Ordinary downloaded attachments are staged in a
private per-turn directory before the engine runs and removed after the turn,
so the agent acts on files inside its own workspace. `/file put` is
deliberately the separate explicit path for long-lived files; it copies the
attachment into the peer vault before the message reaches any brain.

Multi-project workspaces (`BOT_AI_PROJECTS`, managed by `pca project`): a peer
picks a registered project with `/project <alias>` — or
`/project <alias>@<branch>`, which resolves to a lazily-created `git worktree`
under `BOT_AI_WORKSPACE/.worktrees` (or `BOT_AI_WORKTREES_DIR`)
(`lib/workspaces.mjs`; conservative alias/branch charsets, path-escape
guards). The active project persists per peer in the session snapshot;
switching clears the resume token, because a resumed engine session is only
valid in the cwd it started in. Bridge mode instead hands messages to an
external agent framework over one HTTP hop. Its inbound `context` field carries
the same facts; adapters inject it once per framework session, while persona
remains the framework's responsibility. Deployed engines run in a non-root
container that is the sandbox for their tools (see
[Agent frameworks](/guide/harnesses#safety-model-for-containerized-agents)).

If no reply has gone out within `BOT_THINKING_AFTER_MS` (default 5s) of
receiving a message, the bot posts a "thinking" placeholder — a LIVE message
that is then edited in place (elapsed clock, compact `▸ action` lines from
claude's stream-json tool events) until the answer finalizes it. Edits are
gated on the peer's session ACK for the placeholder (channel replacement would
otherwise orphan them), throttled with an escalating interval, and coalesced
latest-wins; a peer that never ACKs gets the answer as a plain message
instead. This also means the bot consumes the app's session-response ACKs (it
previously ignored them).

## Where the rest lives

- The bridge HTTP contract (every route, auth, leases) is specified in the
  [Bridge HTTP API](/reference/bridge).
- Access control and quota rationale are in
  [Private & public bots](/guide/access).
- The deployment security model (container boundary, tool scopes, secret
  handling) is in [Architecture & security](/explanation/architecture) and the
  [safety model for containerized agents](/guide/harnesses#safety-model-for-containerized-agents).
