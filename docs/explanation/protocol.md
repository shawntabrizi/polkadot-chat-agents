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
through its own subscription; a miss resubscribes. Each heartbeat is one
Statement Store submission, so `BOT_HEARTBEAT_MS` defaults to 120 s: 30
submissions per hour per bot (it was 30 s, 120 per hour, more than an idle bot
spends on chat). A dead subscription is found within about 130 s; until then
the sweep below still reads new messages every `BOT_SWEEP_MS`.

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

**Sending extensions is gated by capabilities (spec 0013).** Each device
sends its peers a `capabilities` message (kind 252): the kinds it reads, the
file variants it fetches (0 HOP, 1 Bulletin), the HOP dialects it decrypts
and feature bits. Owner ruling (2026-09-24): the phone apps show one
"unsupported" bubble for it, once per chat, and no other extension kind goes
to a device that did not list it. So the bot:

- sends its own set once per chat, in the accept's statement (or with the
  first message to a peer), and again when the set changes or the peer adds a
  device: zero extra submissions (`BOT_SENT_CAPABILITIES`);
- stores each peer device's set by the device's statement account (the
  topic of the device session it came on; on the identity session, the
  device the same batch accepted with), persisted as `pc`, newest message
  timestamp wins, dropped on `deviceRemoved` (`BOT_RECEIVED_CAPABILITIES`);
- sends an extension kind only when it is enabled here and every known
  device of the peer listed it. A device without a set is a baseline client
  (base spec only): no seen, typing, botInfo, deletion or transaction
  reference; buttons go as the numbered menu text, and a reply of a number or
  a label is that button's press; `tx` buttons are left out without feature
  bit 1. A peer that sent botInfo counts as listing botInfo.

`BOT_PROTOCOL_EXTENSIONS` is the operator's switch: unset means all except
`typing` (see [Typing and seen](#typing-and-seen-spec-0005)), `none` makes the
bot a baseline client (it sends no capabilities and no extension kind), a
comma list keeps only the named ones. When a peer sends an extension kind,
the bot logs `BOT_PROTOCOL_EXTENSION_OBSERVED { peer, kind }` once per peer (a
log only).

`deleteMessage(peerHex, messageId)` follows the RFC's sender cases on top of
the outbound lane: a message still queued and never submitted is removed with
no wire trace; otherwise, with the `deleted` extension on, the deletion is
enqueued with `supersedes: [messageId]`, so a target still in the un-ACKed
statement leaves the slot in the same re-encode that carries the deletion.
With the extension off, nothing is sent (`BOT_DELETE_SKIPPED`). Live replies use it once: when a
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
byte). `tx` carries a spec 0007 TxIntent (see Transactions below). Limits: 8 rows of 4 buttons,
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
- `oneShot` is optional (default false). A `tx` action takes the JSON form in Transactions (spec 0007) below.

The bot strips the block and sends the rest of the text plus the rows as ONE
kind-242 message (a long text is chunked; the last part carries the rows).
Parsing is lenient (spec 0006 "Host parsing leniency", revision 2026-09-24;
`extractButtonsBlock`), because small models get the form wrong: the fence
can be tagged `buttons`, `json` or nothing; the JSON can be the rows object or
a flat array of buttons (one row); the block can be anywhere, and the text
before and after it is kept, joined with a blank line. With several such
fences, the last one that validates gives the rows. A fence that looks like
buttons (tagged `buttons`, or JSON with `label` keys) but breaks a limit or an
action rule is stripped, and `BOT_BUTTONS_INVALID` logs the reason, so a person
never sees the raw JSON. Any other fence is ordinary code and stays in the
text. The brain's hint still asks for the canonical form above. A quoted bridge reply (`reply_to`) cannot be a
buttons message, so it gets the fallback.

**Sending** follows the extension switch above: with `buttons` on (the
default) every peer gets kind 242. With it off, every peer gets the spec's
fallback: the text, then the labels as a numbered list
(`BOT_BUTTONS_FALLBACK`), and the operator context does not tell the brain
about the block.

**Receiving a press:** a `buttonPress` is accepted only for a buttons message
this bot sent to that same peer (the bot keeps its last 50 per peer, persisted
as `bp`). It then runs a brain turn with the text `[button] <label>`, plus
` (payload: <hex>)` when the press carries bytes, and logs
`BOT_RECEIVED_BUTTON_PRESS { from, messageId, row, index }`. A press for an
unknown message, another peer's message, or a missing button is logged as
`BOT_BUTTON_PRESS_IGNORED` and dropped. A `buttons` message from a peer reaches
the brain as its fallback text. `command` presses arrive as normal text and
`url` presses never reach the bot.

### Typing and seen (spec 0005)

Spec 0005 (`polkadot-chat-desktop/docs/spec/0005-typing-and-seen.md`) adds two
provisional kinds:

```
typing(TypingContent) -> 240   TypingContent { until: u64, kind: u8 }   // 0 composing, 1 working, 2 stopped
seen(SeenContent)     -> 241   SeenContent   { upTo: String, at: u64 }  // unix ms
```

The envelope is the usual one. The codec is `encodeOpaqueTypingMessage` /
`encodeOpaqueSeenMessage` in `vendor/app-chat-codec.mjs`; two pinned byte
vectors are in `polkadot-chat-desktop/docs/spec/vectors-0005.md` and in
`test/codec.test.mjs`.

Both kinds are **ephemeral**. The bot puts them straight into the peer's
outbound lane: they are never journaled as an owed answer, never re-sent after
a restart, and never recorded anywhere once the lane settles them. The sender
logic is `lib/typing-seen.mjs`.

**Submission budget (revision 2026-09-23).** Every standalone signal is one
Statement Store submission, and a 1:1 conversation must cost one submission
per message (`polkadot-chat-desktop/docs/spec/efficiency.md`). So the bot sends
no `typing` by default, and its `seen` rides in the same request statement as
its reply. Each statement the lane submits logs `BOT_OUTBOUND_SUBMITTED
{ to, messages }` or `BOT_OUTBOUND_EXTENDED { to, messages, added }`; one line
is one submission.

**Typing: not sent by default.** `BOT_PROTOCOL_EXTENSIONS` unset leaves
`typing` out. A client that has the bot's `botInfo` shows a local "working"
state from its own send until the reply, with no wire signal. An operator who
names `typing` in the list gets the spec's opt-in behavior:

- A brain turn starts (a direct engine's turn, or a bridge hand-off): the bot
  sends `typing{working, until: now + 12 s}` and refreshes it every 10 s while
  the turn runs. Never more than one `typing` per 10 s per peer, across turns
  too. A refresh is skipped while the previous hint is still un-ACKed: a peer
  that has not fetched it gains nothing from the next one, and each in-slot
  replacement spends one of the lane's extensions.
- The real reply supersedes (`supersedes` on the lane entry) every typing the
  peer has not ACKed, so an unfetched hint leaves the slot in the same
  re-encode that carries the answer. After a reply no `stopped` is sent: the
  recipient clears the indicator on any real message.
- A turn that ends with no reply (for example a failed delivery, or `/stop`
  that only edits the placeholder) sends `typing{stopped}`, when the 10 s rate
  limit allows. A bridge harness that never answers stops the refresh after
  `BOT_LIVE_TTL_MS` and sends `stopped`.
- Log: `BOT_SENT_TYPING { to, kind: "working" }` once per turn (not per
  refresh), and `{ kind: "stopped" }` when a stop is sent.

**Seen (the bot sends read receipts) rides the reply.** When the bot starts
to handle a peer's message, it holds `seen{upTo: <that message id>, at}`. The
next real message to that peer (the reply, an error fallback, a greeting, a
command answer, a meter or faucet answer, a transaction reference) takes it
along: the `seen` enters the lane in the same tick, so both ride one request
statement, one submission. While the message is still being handled or a
brain turn runs for the peer, no standalone `seen` goes out, whatever the
delay: a real model takes about 10 s, and a `seen` alone at 5 s plus the
reply at 10 s was two submissions per reply (desktop M13 e2e, 2026-09-24).
The client's local "working" state covers the wait. A standalone `seen` goes
out only for a message that got no reply and started no turn (or whose turn
ended with no reply, for example `/stop`), and never sooner than 5 s after the
message was consumed. A bridge turn whose harness never answers holds it at
most `BOT_LIVE_TTL_MS`. Messages consumed before the `seen` goes out share one
`seen` with the latest id, and an unfetched older `seen` is superseded (`upTo`
covers it). Log: `BOT_SENT_SEEN { to, upTo }`, with `withMessage: true` when
it rode a message.

**Receiving.** A peer's `typing` and `seen` are decoded and logged at debug
level only (`BOT_RECEIVED_TYPING { from, kind, until }`, `BOT_RECEIVED_SEEN
{ from, upTo, at }`, printed with `BOT_LOG_LEVEL=debug`). They are never
answered, never fed to the brain, never stored as messages, and not even
added to the dedup set (a repeat only logs again). The bot keeps no
per-message delivery state, so a `seen` changes nothing on the bot's side.

**Live placeholders.** A client that knows the bot (the `botinfo` extension,
on by default) shows its own "working" state, and with `typing` on the typing
indicator does the same, so the bot does not post the "thinking" placeholder
at the start of a turn. A client must not show a thinking row and a working
indicator for the same wait. The placeholder appears only when a turn runs
past 20 s (`max(BOT_THINKING_AFTER_MS, 20 s)`), and its first frame is the
progress status (`⏳ working · 20s · step N` and the recent `▸` action lines),
not `BOT_THINKING_TEXT`. After that the frames and the terminal status line
work as before. With both `botinfo` and `typing` off, the placeholder follows
`BOT_THINKING_AFTER_MS` and `BOT_THINKING_TEXT` as before. The bridge's `GET
/health` reports the delay in use as `live.placeholderAfterMs`. (Decisions
2026-09-23, with spec 0005.)

### Bot info (spec 0008)

Spec 0008 (`polkadot-chat-desktop/docs/spec/0008-bot-info.md`) adds one
provisional kind. A bot uses it to describe itself to a peer:

```
botInfo(BotInfo) -> 244
BotInfo = { kind: u8, name: String, description: String, greeting: String,
            commands: Vec<Command>, version: u16 LE }
Command = { name: String /* no slash */, description: String }
// kind: 0 bot (automated), 1 agent (an AI acting for a person), 2 person-operated service
```

The envelope is the usual one. The codec is `encodeOpaqueBotInfoMessage` in
`vendor/app-chat-codec.mjs`; the pinned byte vector is in
`polkadot-chat-desktop/docs/spec/vectors-0008.md` and in
`test/codec.test.mjs`. The encoder refuses a document over the spec limits
(name 40 characters, description and greeting 280, 32 commands, command name
32 without a slash, command description 80). The decoder bounds the same
fields in bytes; a larger message is undecodable and the rest of the batch
still decodes.

**The document.** It comes from `botinfo.json` in the bot workspace, next to
`PERSONA.md` (see [Configuration](../reference/configuration.md#bot-info-botinfo-json)).
The file is operator-owned: `pca create` and `pca run` seed it once with
defaults and never overwrite it. The bot reads it again for each send, so an
edit applies to the next accept or `/start` with no restart. A field that is
missing takes its default. An unknown field or a value over a limit makes the
file invalid: the bot logs `BOT_BOTINFO_INVALID { error }` and sends no
`botInfo` until the file is fixed (`/start` is then ordinary input). The file
has no `version`. The bot keeps `{ hash, version }` in `botinfo.state.json`
next to it and adds 1 to the version each time the document's content hash
changes (a new layout of the same JSON is not a change). A client keeps the
highest version, so an edit that did not raise it would never show. The
version stops at 65535; it never wraps to a lower number. The logic is
`lib/bot-info.mjs`.

**Sending.**

- On request accept: the `botInfo` is enqueued on the identity channel right
  after the accept and the `BOT_ACK_TEXT` welcome, so all of them ride one
  statement. A failed accept is retried with its `botInfo`.
- On a text `/start` (any brain; a bridge harness never sees it): the
  `botInfo` on the session lane, then the greeting as a normal text message.
  An empty greeting sends no text.
- Catch-up: the spec says a bot MUST send `botInfo` with its next reply to a
  peer that has not received the current `version`. The bot keeps, per peer,
  the version it last sent (`bs` in the session state). When a peer's `bs` is
  missing or lower than the current version, the bot enqueues `botInfo` in
  the same tick as the reply, just before it, so both ride one statement. A
  reply is any new outbound message: text, buttons, a file, the live
  placeholder, or a re-sent owed answer. An edit of the bot's own message does
  not trigger it. The bot marks `bs` before the send, so two replies never both
  carry it; a failed send goes back to the old value. The accept and `/start`
  sends also set `bs`. So a peer from before the bot had a document, or from
  before an edit of `botinfo.json`, gets the current version once, without
  asking. A crash between the send and the next state save can send it once
  more.
- Log: `BOT_SENT_BOTINFO { to, version, on: "accept" | "start" | "catch-up" | "pending", pending? }`.
  At startup the bot logs `BOT_BOTINFO { kind, version, commands }`, and
  `BOT_BOTINFO_VERSION { version }` each time the version goes up.
- `BOT_PROTOCOL_EXTENSIONS` without `botinfo` turns all of this off.

**Bot-declared balance (spec 0008 v2).** `BotInfo` ends with an optional
field, appended after `version`:

```
balance: Option<BalanceHint>
BalanceHint = { chainId: String /* genesis hash, 0x hex */, contract: Bytes /* 20 */,
                selector: Bytes /* 4 */, decimals: u8, unit: String,
                perReply: Option<u128 LE>, label: String /* <= 40 */,
                pending: Option<u128 LE> /* v3, appended */ }
```

It tells a client where to read "your balance with this bot": the client
calls `contract.selector(caller H160)` at the best block on each new block
and shows `label: <value / 10^decimals> <unit>`, plus `~N replies` when
`perReply` is set (`perReply` is in the same units as the returned value).
Compatibility: a v1 encoder ends after `version`, so the decoder reads the end
of the message there as `balance = null`. The `pca` encoder writes nothing
after `version` when there is no hint, so a document without one keeps its v1
bytes (`vectors-0008.md` still holds). With a hint it writes `0x01` and the
hint. A `0x00` byte after `version` also decodes as `null`. The encoder
refuses a contract that is not 20 bytes, a selector that is not 4 bytes, an
empty or over-long `label` (40) or `unit` (16), and an empty `chainId`. The
pinned vector (the BOT-1 document plus the Meter hint) is in
`polkadot-chat-desktop/docs/spec/vectors-0008b.md` and `test/codec.test.mjs`.
The hint comes from an optional `balance` object in `botinfo.json` (hex
strings for bytes, `perReply` as a decimal string or `null`). Adding,
changing or removing it raises the version. A file without it hashes as it
did before v2, so the upgrade did not bump any version. `BOT_BOTINFO` logs
`balance: "<contract>.<selector>"` when a hint is set. `pcdmeter` declares
`balanceOf(address)` of its Meter with `perReply` 10^17 (0.1 PAS);
`pcdflip` declares `stakeOf(address)` of its Flip contract, labelled
"your stake", with no `perReply`.

**Pending on the hint (spec 0008 v3).** `pending` is what the bot has
metered but not yet charged, in the same units as the returned value (the
Meter's 1e18 scale: 0.3 PAS = 3 × 10^17). The client shows one number,
`value − pending`, the same number as the bot's `/balance`. A hint that ends
after `label` (every v2 encoder) decodes as `pending = null` (0); `0x00`
there is also `null`. The `pca` encoder writes nothing after `label` when
`pending` is `null`, so a v2 hint keeps its v2 bytes (`vectors-0008b.md`
still holds). A v2 `pca` decoder stops at `label`, so it ignores the field.
The pinned vectors are in `polkadot-chat-desktop/docs/spec/vectors-0008c.md`
and `test/codec.test.mjs`. `pending` is never in `botinfo.json`: the meter
sets it, and it does not change the version. Resend rule (a meter bot whose
`botinfo.json` has a `balance` hint):

- The first real message of each metered turn (an edit of a live
  placeholder too) carries a `botInfo` with the pending debit that includes
  this reply, enqueued in the same tick, so it rides the reply's request
  statement: no extra submission (`BOT_SENT_BOTINFO { on: "pending" }`).
- The final reference of a charge (status 1, or 3) carries a `botInfo` with
  the pending left after the charge (0 when no reply came in meanwhile), in
  the same statement as the reference.
- Every other `botInfo` (accept, `/start`, catch-up) carries the current
  pending once the bot has read a balance, else no `pending`.

**Receiving.** A peer's `botInfo` (the peer is another bot) is stored per peer
in the session state (`bi`), and a lower version than the stored one is
ignored (`stale: true` in the log). It is never answered, never fed to the
brain, and never makes the bot send its own `botInfo`: two bots must not
loop. Log: `BOT_RECEIVED_BOTINFO { from, kind, name, version, commands }`.

### Transactions (spec 0007)

Spec 0007 (`polkadot-chat-desktop/docs/spec/0007-transactions.md`) fills the
`tx` action of spec 0006 and adds one provisional kind:

```
Action::tx(Bytes)   -> 3      // Bytes = SCALE(TxIntent)
TxIntent = { version: u8 (1), chainId: String /* genesis hash, 0x hex */,
             calls: Vec<Call> /* 1..8 */, display: Display,
             dryRunRequired: bool /* true in v1 */, expiresAt: u64 /* unix ms, 0 = never */ }
Call     = { kind: u8 /* 0 raw call, 1 Revive */, to: Option<Bytes>, data: Bytes /* <= 16 KiB */,
             value: u128, gasRefTime: Option<u64>, gasProofSize: Option<u64>,
             storageDepositLimit: Option<u128> }
Display  = { title: String /* <= 60 */, description: String /* <= 280 */,
             amount: Option<String>, asset: Option<String> }
transactionReference(TransactionReference) -> 245
TransactionReference = { chainId: String, hash: Bytes, status: u8 /* 0 submitted, 1 in block,
                         2 finalized, 3 failed */, block: Option<u32>, note: String /* <= 140 */,
                         intentMessageId: Option<String> }
```

`u64` and `u128` are fixed-width little-endian. The codec is
`encodeTxIntent` / `decodeTxIntent` and `encodeOpaqueTransactionReferenceMessage`
in `vendor/app-chat-codec.mjs`; the pinned vectors are in
`polkadot-chat-desktop/docs/spec/vectors-0007.md` and in `test/codec.test.mjs`.
A buttons message decodes with the `tx` action as bytes; `decodeTxIntent`
gives its shape. `encodeOpaqueButtonsMessage` takes `{ tx }` as bytes or as a
TxIntent object. The encoder refuses `dryRunRequired: false`, more than 8
calls, and a Revive call without a 20-byte `to`.

**The key stays with the client.** The bot never signs for the user. A `tx`
button is an intent: the client dry-runs it at the best block, shows the
effect and the fee, and signs with the user's key. What the bot signs with
its own wallet key (a meter charge, a faucet transfer) it reports with a
`transactionReference`.

**Limits of a Revive call (rule, 2026-09-24).** A `tx` intent that a bot
feature builds (the flip's stake, the meter's top-up) sets `gasRefTime`,
`gasProofSize` and `storageDepositLimit` on each kind 1 call, from the call's
worst case over every path the contract can take (`reviveIntentLimits` in
`lib/revive-chain.mjs`):

```
storageDepositLimit = max(deposit × 1.5, deposit + 0.1 PAS)
gasRefTime          = refTime × 1.5
gasProofSize        = proofSize × 1.5
```

`deposit`, `refTime` and `proofSize` are the largest a `ReviveApi_call` of
the call shows on any path (measured on devnet, next to the intent:
`FLIP_STAKE_WORST`, `METER_TOPUP_WORST`). Why not the client's dry-run: the
dry-run takes the path of the state it reads, and the extrinsic can run in
another state (another player's call lands first, or the best block that held
an earlier call is reorged away). Flip's first stake charges 52 800 000
plancks for two new slots; the settling stake refunds them, so its dry-run
shows a deposit of 0, but it needs 2.3× the weight. On 2026-09-24 a second
stake, dry-run with the first stake in the best block, ran as a first stake
(the first stake had been "in block #13630936" and landed in #13630955) and
failed with `Revive.StorageDepositLimitExhausted`; the mirror case fails with
`Revive.OutOfGas`. The limits are caps: the signer pays only what the call
uses. The client must sign with, per field, the larger of the intent's value
and its own estimate plus margin.

**From a brain.** The fenced ```buttons block (spec 0006) accepts
`"action": { "tx": { "chainId", "calls", "display", "expiresAt"?, "dryRunRequired"? } }`,
with `to` and `data` as 0x hex and `value` as a decimal string (u128).
`expiresAt` 0 or missing means the intent never expires; set a time only when
the call depends on state.
`dryRunRequired` defaults to true; false, an unknown key, or any value out of
range makes the whole block invalid: it is stripped and logged as
`BOT_BUTTONS_INVALID` (`lib/buttons-block.mjs`, `toTxIntent`).

**Sending references.** `BOT_PROTOCOL_EXTENSIONS` without `txref` stops them
(`BOT_TX_REFERENCE_SKIPPED`). Log: `BOT_SENT_TX_REFERENCE { to, messageId,
status, block, hash, note }`. One reference per transaction (spec 0007 client
rule 3, revision 2026-09-23): status 1 (in block) when its extrinsic is in a
best block, or 3 when it failed on chain. Status 0 (submitted) goes out only
when no best block holds the extrinsic 30 s after the submit
(`REFERENCE_PENDING_AFTER_MS` in `lib/revive-chain.mjs`); status 1 or 3
follows it, and status 3 also closes a status 0 whose extrinsic never made a
block. Status 2 (finalized) is never sent: a receiver tracks finality from the
chain with the hash and block. The bot's own extrinsics from one account go
out one at a time (`serialQueue`), so two of them never share a nonce.

**Receiving references.** A peer's `transactionReference` is logged
(`BOT_RECEIVED_TX_REFERENCE { from, status, block, hash, note,
intentMessageId? }`), kept in memory per peer (the last 20), and never
answered or fed to the brain. It is a claim, not proof: with the meter on,
the bot re-reads the user's balance from the chain (`BOT_METER_BALANCE
{ on: "reference" }`) and trusts only that.

**Chain access.** `lib/revive-chain.mjs` talks to a pallet-revive chain
(devnet Asset Hub) through Substrate extrinsics and runtime calls with papi's
metadata-driven API: `ReviveApi_call` dry-runs at the best block,
`Revive.call` with the dry-run's weight and deposit plus 20 %,
`Revive.map_account` once, and `Balances.transfer_keep_alive`. A user's
contract address is pallet-revive's mapping of the chat account:
`keccak256(accountId32)[12..32]`. Inside a contract, native value is scaled
by the runtime's `NativeToEthRatio` (1e8 on Asset Hub, so 1 PAS = 1e18).

**Meter (pay-as-you-go replies).** `BOT_METER_CONTRACT` + `BOT_METER_CHAIN`
turn it on for a direct brain (`lib/meter.mjs`; the contract is
`contracts/meter/`). Before each brain turn the bot reads `balanceOf(user)` at
the best block. Every balance the bot uses or shows is that balance minus the
user's pending debit (below). Below `BOT_METER_PRICE` it answers with one
buttons message: a line with the balance and a "Top up 1 PAS" `tx` button (a
Revive call of `topUp()` with 1 PAS), and the brain does not run. Otherwise
the brain runs, and the reply's price joins the user's pending debit
(`BOT_METER_PENDING`). The bot charges the pending debit with ONE
`charge(user, n × price)` from its own wallet (the contract's operator) when
`BOT_METER_BATCH_REPLIES` replies are pending (default 5), when
`BOT_METER_BATCH_MS` has passed since the first pending reply (default 10
min), before it refuses a reply for a low balance, and on SIGINT/SIGTERM
(bounded to 60 s). Each charge sends one `transactionReference` with the note
`balance: <remaining plancks>` (efficiency.md: one Asset Hub extrinsic per 5
metered replies or 10 min, not one per reply). The pending replies persist
with the peer's session (`md: { r: replies, t: first reply ms }`): after a
crash the bot restores them (`BOT_METER_PENDING_RESTORED { replies, chargeInMs
}`) and charges them when the rest of the batch time ends. A charge in flight
is not saved, so a crash during a charge never charges twice (a charge that
did not land is lost, in the user's favor).
`/balance` answers the balance and a Top up button; `/topup` sends the button.
Other slash commands are free. A failed balance read answers with a notice
and runs no brain (fail closed). The `botInfo` balance hint shows the
pending debit through its v3 `pending` field (above). Logs:
`BOT_METER_ENABLED { batchReplies, batchMs }`, `BOT_METER_BALANCE { pending
}`, `BOT_METER_PENDING { replies, plancks }`, `BOT_METER_TOPUP_OFFERED`,
`BOT_METER_CHARGED { on: "batch" | "timer" | "refusal" | "shutdown", replies
}`, `BOT_METER_CHARGE_FAILED`, `BOT_METER_READ_FAILED`,
`BOT_METER_OPERATOR_MAPPED`.

**Faucet.** `BOT_FAUCET_KEY` turns it on (`lib/faucet.mjs`). `/drip <SS58 or
0x account>` sends `BOT_FAUCET_AMOUNT` with `Balances.transfer_keep_alive`
and posts a reference with the note "Dripped 1 PAS". Drips go out one at a
time, so two `/drip` commands in the same second do not race on the faucet
account's nonce. `BOT_FAUCET_COOLDOWN_MS` (off by default) limits drips per
target account (in memory); a failed transfer does not use it up. The
key is a derivation path of the public Substrate dev phrase only. Logs:
`BOT_FAUCET_ENABLED`, `BOT_FAUCET_DRIPPED`, `BOT_FAUCET_REFUSED`,
`BOT_FAUCET_FAILED`.

**Coin flip.** `BOT_FLIP_CONTRACT` turns it on (`lib/flip.mjs`; the contract
is `contracts/flip/`, documented in
`polkadot-chat-desktop/docs/spec/contracts/flip.md`). Every message (the
opener after an accept, `/stake`, any other text) is answered with one
buttons message, "Stake 0.5 PAS to flip. The second staker triggers the flip;
the winner takes 1 PAS.", with one `tx` button "Stake 0.5 PAS": a Revive call
of `stake()` with a value of 5 000 000 000 plancks and the limits of the
stake's worst path (see "Limits of a Revive call"), which expires after 10
minutes. No brain turn runs (use the `echo` brain). The bot never signs a
stake. The contract settles in the second player's own call: it takes a
winner from `keccak256(abi.encode(blockhash(block.number - 1), player1,
player2))` (`block.prevrandao` is a constant on pallet-revive) and pays the
1 PAS pot. The second player can predict the result before signing; this is
acceptable only for devnet.

The bot watches the contract at the best block
(`watchContractEvents` in `lib/revive-chain.mjs`: `System.Events` of each new
best block, `Revive.ContractEmitted` from the contract, and the settling
extrinsic's hash from the block body). On `Settled` it sends a
`transactionReference` (status 1, that block, the settling extrinsic hash,
note "Flip settled: <winner's username, or its 0x address> won 1 PAS") to
both players. The players come from the `Matched(round, player1, player2)`
event the contract emits just before `Settled`, so the bot needs no memory of
the first stake. A round is notified once, even when a reorg delivers its
block again.

To find a player's chat, the bot keeps a map from contract address (H160) to
peer. The account that signs a `tx` intent is the chat identity's own wallet
account (spec 0007 client rule 3), so the bot computes `reviveAddress(peer)`
for each peer it talks to: each inbound message, each received
`transactionReference`, and each peer restored from the session state at
startup. A player the bot never talked to is logged
(`BOT_FLIP_UNKNOWN_PLAYER`) and not notified. Logs: `BOT_FLIP_ENABLED`,
`BOT_FLIP_WATCHING`, `BOT_FLIP_OFFERED { on }`, `BOT_FLIP_STAKED`,
`BOT_FLIP_SETTLED`, `BOT_FLIP_NOTIFIED`, `BOT_FLIP_NOTIFY_FAILED`,
`BOT_FLIP_UNKNOWN_PLAYER`, `BOT_FLIP_REFUNDED`, `BOT_FLIP_REFERENCE`,
`BOT_FLIP_WATCH_FAILED`, `BOT_FLIP_OFFER_FAILED`, `BOT_FLIP_USERNAME_FAILED`.

**DAO chat (M14).** `BOT_DAO_CONTRACT` turns it on (`lib/dao.mjs`; the
contract is `contracts/dao/`, documented in
`polkadot-chat-desktop/docs/spec/contracts/dao.md`). It works in v2 groups
(spec 0011) where the bot is an admin with the pin permission. A member's
`/propose <title> | <amount> PAS to <username>` in the group makes the bot:
register the group's members on the contract (`setMembers`, only when the
roster changed since the last proposal; the group is keyed by
`keccak256(group id)`), create the proposal (`propose`, deadline now +
`BOT_DAO_VOTING_SECS`), post ONE buttons message with "Vote yes (stake 0.1
PAS)" / "Vote no (stake 0.1 PAS)" `tx` buttons and a "View on Subscan" url
button, and pin it (one state statement). A sender who is not a member gets
"Refused". `/proposals` lists the group's open proposals. The command never
runs a brain turn; with the `echo` brain the bot does not answer other group
messages.

The bot watches the contract at the best block. A `Voted` event of one of
its proposals becomes one tally line, a reply to the proposal message
("Tally #N: yes … (k votes), no …. <name> voted yes with 0.1 PAS."), in the
bot's next group statement; a reorg that delivers the event again adds no
line. Twelve seconds after the deadline the bot posts the result: "passed"
with an "Execute" and a "Withdraw stake" `tx` button, or "rejected" with
only "Withdraw stake" (valid for 7 days). An `Executed` event becomes one
line; a `Withdrawn` event is only logged. Every intent carries the limits of
its worst contract path (see "Limits of a Revive call"). Proposals and the
registered roster are session state. Registering members writes their
contract addresses next to the group key on a public chain. Logs:
`BOT_DAO_ENABLED`, `BOT_DAO_WATCHING`, `BOT_DAO_MEMBERS_SET`,
`BOT_DAO_PROPOSED`, `BOT_DAO_PINNED`, `BOT_DAO_VOTED`, `BOT_DAO_CLOSED`,
`BOT_DAO_EXECUTED`, `BOT_DAO_WITHDRAWN`, `BOT_DAO_REFUSED`,
`BOT_DAO_PROPOSE_FAILED`, `BOT_DAO_COMMAND_FAILED`, `BOT_DAO_POST_FAILED`,
`BOT_DAO_WATCH_FAILED`. Live proof: `bot-core/scripts/e2e-dao.mjs`.

### Groups (spec 0009)

Spec 0009 (`polkadot-chat-desktop/docs/spec/0009-groups.md`) adds small group
rooms with no new cryptography. A group is an id, a name and a roster. A
member sends to the group by fanning one message out over its pairwise
sessions. Three provisional kinds:

```
groupInfo(GroupInfo)       -> 246
groupMessage(GroupMessage) -> 247
groupLeave(GroupLeave)     -> 248
GroupInfo = { groupId: String /* UUID */, name: String /* <= 60 */, admin: AccountId /* 32 raw bytes */,
              members: Vec<Member> /* <= 16 */, version: u32 LE, createdAt: u64 LE }
Member = { account: AccountId, username: String, joinedAt: u64 LE }
GroupMessage = { groupId: String, infoVersion: u32 LE, seq: u64 LE, content: MessageContent }
GroupLeave = { groupId: String }
```

`content` is inline: the kind byte and the body of any non-group kind, to the
end of the message, with no length prefix and no inner envelope. The codec is
`encodeOpaqueGroupInfoMessage`, `encodeOpaqueGroupMessage` (it takes an
opaque message from any other encoder and keeps only its content) and
`encodeOpaqueGroupLeaveMessage` in `vendor/app-chat-codec.mjs`. The decoder
decodes the wrapped content with the normal decoder. Both sides refuse a
group kind inside a `groupMessage`. The pinned vectors are in
`polkadot-chat-desktop/docs/spec/vectors-0009.md` and `test/codec.test.mjs`.

**Joining.** A bot is a member like any other. The admin invites it with a
chat request (a public bot accepts as always; an allowlisted bot accepts
when the admin is allowlisted) and sends the `groupInfo` on the session. The
bot applies a `groupInfo` only from the admin it names, and only when its
`version` is higher than the one it holds. A `groupInfo` from anyone else,
or an older one, is ignored (`BOT_GROUP_INFO_IGNORED { reason }`). On join
(`BOT_GROUP_JOINED`) the bot sends its `botInfo`, wrapped, to every member.
The rules live in `lib/groups.mjs`; the rosters, the bot's own `seq` and the
recent envelope ids per group persist in the session state (`groups`).

**Allowlisted bots.** An allowlisted bot also talks to the members of a group
whose admin it allows, for the group kinds only. It accepts their chat
requests (`BOT_GROUP_MEMBER_ACCEPTED`; the welcome text is not a turn) and
drops any other kind from them (`BOT_GROUP_ONLY_DROPPED`).

**Receiving.** A `groupMessage` from an account that is not in the roster, or
that sent a `groupLeave`, is rejected (`BOT_GROUP_MESSAGE_REJECTED { reason:
"non-member" }`). A second copy of one envelope id is rejected as
`duplicate`. Per sender, `seq` orders messages; a gap is logged once
(`BOT_GROUP_SEQ_GAP`). A text, rich text, reply, edit or buttons message
becomes one brain turn: the brain sees `[group <name>] <sender username>:
<text>`. A direct engine runs it under the session key `group:<groupId>`, so
the group has its own conversation history, separate from each member's 1:1
history. Chat commands (`/help`, `/model` …) in a group apply to the group's
session. The operator context gains one line: "You are in the group <name>
with N people; address the sender by name. Do not send tx (transaction)
buttons in a group." (v1 groups carry no spec 0007 intents.) A `buttonPress` runs a turn only
for a buttons message the bot sent to that group. Reactions, deletions,
`botInfo` and transaction references inside a group are logged
(`BOT_GROUP_RECEIVED { kind }`) and never answered. The group features that
are 1:1 by nature (`/start`, file commands, the meter, the faucet, the coin
flip) do not run in a group.

**Replying.** The answer goes to every other member in the bot's roster as a
`groupMessage`. Every copy has one envelope id and one timestamp, and the
bot's next per-group `seq` (`BOT_GROUP_SENT { group, kind, messageId, seq, to
}`). Long answers are chunked and a trailing buttons block becomes spec 0006
buttons, as in a 1:1 chat. To reach a member it has no session with, the bot
opens a chat request first (`BOT_GROUP_REQUEST_OPENED`); the request text is
the fallback form of its `botInfo` (name — description). A failure to reach
one member is logged (`BOT_GROUP_SEND_FAILED`) and does not stop the others.
A bridge harness gets a group turn with `group_id`, `group_name` and `sender`
and answers with `POST /send { group_id, text }`.

**Typing and seen.** With `typing` listed in `BOT_PROTOCOL_EXTENSIONS` (it is
off by default), `typing` fans out while a direct-engine turn runs (refreshed
every 10 s); it carries the bot's current `seq` and does not advance it, so a
client that does not store typing sees no gap. `seen` does not fan
out, and the bot sends no 1:1 `seen` for a group message.

**Stopping.** A `groupLeave` from a member takes that member out of the
fan-out (`BOT_GROUP_MEMBER_LEFT`). A `groupInfo` whose roster does not list
the bot marks the group `removed` (`BOT_GROUP_REMOVED`): the bot stops sending
to it and rejects its messages (`reason: "removed"`) until a higher version
lists it again. `BOT_PROTOCOL_EXTENSIONS` without `groups` ignores every
group kind (`BOT_GROUP_IGNORED`).

### Private groups v2 (spec 0011)

Spec 0011 (`polkadot-chat-desktop/docs/spec/0011-groups-v2.md`) replaces the
fan-out for new groups: a group is an epoch key `K_e`, and a group message is
**one statement** on a secret per-epoch topic, with no ACK. v1 rooms (above)
keep working until their admin migrates them.

**The Statement Store path (M16 check, 2026-09-24).** No new adapter was
needed. bot-core submits every statement through the vendored
`submitAppStatement` (`statement_submit` over the lazy client's request
function), which already takes any `channel`, up to 4 `topics` and an
`expiryFactory`; subscriptions go through the vendored raw page subscriber
(`statement_subscribeStatement` with a `matchAny` filter) and sweeps through
the SDK adapter's `queryStatements({ matchAny })`. A decoded statement carries
its topics, channel, expiry, data and `proof.value.signer` (as `0x` hex
strings on the raw path). `scripts/probe-group-statement.mjs` proves it on the
devnet People chain RPC: a statement with a random `topic1`, a chosen
`channel` and the group expiry comes back by subscription and by query with
every field intact, and a second one on the same channel replaces it
(`PROBE_OK`). The SDK is not forked.

**Keys and wire** (`lib/group-keys.mjs`, `lib/group-codec.mjs`, vectors in
`test/codec.test.mjs` = `vectors-0011.md`). `Topic_e`, `MsgKey_e` and the
channels `ChMsgs_e`, `ChState_e`, `ChRekey_e` are keyed BLAKE2b-256 of `K_e`.
Statement data is `GroupData = enum { messages(Sealed), state(Sealed),
rekey(Rekey) }`; `Sealed` is AES-256-GCM with AAD `b"grp" : signer : e :
variant`. `K(A, B)`, which wraps each member's copy of the next epoch key, is
the raw X25519 agreement of the two identity chat keys (the value that keys
`SessionId`), so every device of a member opens its entry. Group statements
use the base spec's Expiry with `ExpirationTime` = now + 14 days (lower than a
DM's `u32.max`, so a full account loses group statements first).

**Pairwise control, kind 249** (`encodeOpaqueGroupControlMessage`):
`welcome` 0, `joinRequest` 1, `joinDecision` 2, `history` 3, `keyRequest` 4,
and `historyRequest` 5 (pca's proposal for the reviewer's "history on
request": `{ groupId, since: enum { messageId(String), timestamp(u64) },
limit: u8 }`). Controls ride the peer's outbound lane and run after the ACK.

**The bot as a member** (`lib/groups-v2.mjs`). A `welcome` is accepted from a
peer the bot allows (the v1 admission rule), or from an admin of a group it is
already in (`BOT_GROUP2_WELCOME`); the bot then reads the topic at once and
applies the state only if its hash matches the welcome (`BOT_GROUP2_JOINED`).
A carrier counts only when its signer is `from` or one of `from`'s posting
accounts, `from` holds `post` (a `groupLeave` always passes) and, for role 0
under slow mode, it did not arrive sooner than `slowModeSecs` minus a 2 s
grace for network delay after the previous one (the bot's own sends keep the
exact limit). Messages dedup by id; a text becomes one turn under
`group:<groupId>`, as in v1 (the sender shows as an account prefix: v2 states
carry no usernames). Carried messages older than the bot's join are history,
never turns. The answer is ONE statement on the bot's `ChMsgs_e`: the new
parts plus its own messages of the last 24 h in this epoch, newest first,
within 4096 bytes (`BOT_GROUP2_SENT { messages, carried, bytes }`). At most
one statement per second, and for a role-0 bot one per `slowModeSecs`: a send
that must wait is merged with what queues meanwhile (`BOT_GROUP2_SEND_WAIT`).
No typing and no seen in v2 groups.

**Epochs.** A rekey out of the current epoch from an admin: the bot opens its
entry with `K(admin, bot)`, switches epoch, subscribes to the new topic and
keeps the old key 14 days (`BOT_GROUP2_REKEYED`). No entry while still listed
sends a `keyRequest` to that admin (`BOT_GROUP2_KEY_REQUESTED`). Two rekeys
out of one epoch: the lower signer wins, the other key stays 24 h.

**History provider.** Any member may send `historyRequest`; the bot answers
with `history` pages of at most 4 KB each, newest first, at most 100
messages, `last` on the final page (`BOT_GROUP2_HISTORY_SENT`). With
`historyShare` 0 it never shares messages older than the asker's join. The bot
keeps the last 200 messages per group in memory (100 persist).

**The bot as an admin** (when the state gives it role ≥ 1 and the flag): it
answers a listed member's `keyRequest` with a `welcome`; it accepts a
"Join request: <name> [grp:<inviteId>:<proof>]" chat request from a stranger
when the proof matches one of its groups' invites, then admits the
`joinRequest` (policy 2: new state + `welcome`; policy 1: `joinDecision`
pending; anything invalid: rejected); it removes a member that posted
`groupLeave` (rekey on the old topic + state on the new one, two statements,
`BOT_GROUP2_EPOCH_OPENED`); and it rotates the epoch after 7 days (plus up
to an hour of jitter). The cap for v2 is 256 members. An admin's `/invite`
over DM answers `polkadot-chat://g#<InviteLink base64url>` (0011 ruling 9,
amended: not `polkadotapp://`, which would capture the phone app's pairing
links); `/revoke-invite` also accepts a bare `g#<b64>` and, for one release,
the old `polkadotapp://g#<b64>`.

**Live proof.** `scripts/e2e-groups-v2.mjs` (two registered test identities
and a local bot): `CHAT_OK V2_CREATED ONE_SUBMISSION BOT_REPLY_OK REMOVED
REMOVED_LOCKED_OUT BOT_EPOCH2_OK GROUP2_LIVE_OK`.

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
private per-peer, per-turn directory outside the workspace before the engine
runs, and removed after the turn. The engine is granted only that directory. `/file put` is
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

If no reply has gone out within `BOT_THINKING_AFTER_MS` (default 5s; 20 s
while the botinfo or typing extension is on, see [Typing and seen](#typing-and-seen-spec-0005)) of
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
