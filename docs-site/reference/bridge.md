---
next:
  text: "How it works"
  link: "/explanation/how-it-works"
---

# Bridge HTTP API

In bridge mode, `bot-core` handles the transport (polling, decoding, ACKs,
sending, and media retrieval) and exposes a small local HTTP API. Any framework
that can run a poll loop can drive a bot through it — the Hermes and OpenClaw
integrations are thin adapters over this contract. The API is shared by the
default Polkadot-app transport and T3ams; the [T3ams-specific fields](#t3ams-rich-chat)
below describe the richer media and live-operation behavior.

## Authentication

Every request must present the bot's `BOT_BRIDGE_TOKEN` — either
`Authorization: Bearer <token>` or an `x-bridge-token` header — compared in
constant time. The process refuses to start without a 32+ character token. The
CLI generates one automatically and shares it with the bundled harness. The
bridge binds to loopback by default; harness stacks bind it to the compose
network only.

The token can manage every peer's saved-file vault as well as send messages.
Treat a framework that receives it as part of the bot's trusted computing base;
do not expose the bridge port or token to an untrusted process.

T3ams bridge mode adds a lease fence for outbound chat operations:
normally `/send`, `/react`, and `/typing` carry the active `delivery_id` and
`lease_id`. If an operator explicitly needs a framework-originated action with
no inbound delivery, they may configure a distinct 32+ character
`BOT_BRIDGE_PROACTIVE_TOKEN`. That request still needs normal bridge
authentication and must additionally carry the raw
`x-bridge-proactive-token` header. This optional capability is not an
alternative bridge credential, does not authorize vault access by itself, and
never turns a supplied stale lease into a valid one.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ ok, account, identifierKey, username, … }` — reachability plus transport, media/file, and live-operation capability flags. |
| `GET /inbound?wait=<secs>&limit=<n>` | Long-poll. Returns leased deliveries: `[{ delivery_id, lease_id, lease_ms, chat_id, text, message_id, … }]`. Rows can include thread, reply/edit, attachment, and transport-specific fields. Add `&events=1` to also receive non-message signals. |
| `POST /inbound/ack` `{ delivery_id, lease_id }` | Acknowledge a completed delivery so it isn't redelivered. |
| `POST /inbound/renew` `{ delivery_id, lease_id }` | Extend an active lease while still working. |
| `GET /media/<id>` | Authenticated attachment bytes. For T3ams, `<id>` is an opaque, short-lived bridge handle and a fetch can materialize the encrypted media on demand. |
| `GET /files/<chat_id>` | List durable files for one chat. Add `?prefix=<path>` to narrow the list. |
| `GET /files/<chat_id>/<path>` | Stream one durable file. |
| `PUT /files/<chat_id>/<path>` | Save raw request bytes in that chat's vault. Set `Content-Type`; add `?overwrite=1` to replace a file. |
| `DELETE /files/<chat_id>/<path>` | Remove one durable file. |
| `POST /send` `{ chat_id, text?, file_path?, reply_to?, edit_of? }` | Publish a reply, edit a bot-issued message, or send a vault file. `reply_to` renders a quote; `edit_of` rewrites one of the bot's own messages. T3ams also permits a file caption and reply target, but never an edit of a file message. |
| `POST /react` `{ chat_id, message_id, emoji, remove? }` | Publish or remove an emoji reaction. T3ams maps this to its native reaction operation. |
| `POST /typing` `{ chat_id }` | Best-effort typing signal. T3ams publishes it natively; a transport without a typing operation can no-op. |

## Delivery is leased (at-least-once)

`/inbound` hands each message out under a **lease**, not a fire-and-forget
drain. A harness renews the lease while it works and calls `/inbound/ack` only
once the message is fully handled. If the harness crashes mid-turn, the lease
expires and `bot-core` redelivers — so a failed handoff is retried rather than
lost. A harness must therefore **not** acknowledge a delivery it didn't finish.

## Allowlist, live replies, and long answers

The peer allowlist is enforced inside `bot-core` before a message reaches the
bridge, so unlisted senders never reach the framework or spend model quota.
Long replies sent via `/send` are split into ordered parts automatically, and
the "thinking" placeholder is finalized into the first part — the harness just
sends text.

For a T3ams lease, bot-core can publish a typing signal and a thinking
placeholder while the framework works. The first ordinary `POST /send` resolves
that placeholder into the final answer. A framework may also stream
`edit_of` updates: bot-core coalesces and throttles them to the advertised
safe cadence, then flushes the newest frame when the lease is acknowledged.
Only message IDs issued by the current bot process may be edited.

For file delivery, store the framework's artifact with `PUT /files/<chat_id>/<path>`
first, then send it with `POST /send` and that `file_path`. The bridge resolves
only that peer-scoped vault entry, never an arbitrary path on the host. Its
`GET /health` response exposes the relevant delivery status. The default
transport reports `files.delivery`, including its derived allowance account;
T3ams reports its trusted Bulletin endpoint and operator-provisioned media
status separately.

## T3ams rich chat

T3ams keeps the same leased bridge API, but its chat IDs are opaque conversation
keys: `t3ams:dm:<xid>` for a direct message and
`t3ams:channel:<workspace-xid>:<channel-id>` for a workspace channel. A
delivery adds `conversation_type`, `sender_xid`, and `sender_name`; channel
messages also add `workspace_id`, `channel_id`, and, when applicable,
`thread_root_id`. Preserve `thread_root_id` on a send to keep the reply in the
same thread.

When `BOT_T3AMS_CHANNEL_CONTEXT=1`, a mentioned channel prompt can additionally
carry `channel_context`: a bounded snapshot of earlier authenticated text from
that same channel or thread. It is context only, not work to answer on its own.

### Media and attachments

T3ams rich-text attachments arrive with safe metadata such as `id`, `kind`,
`mime`, `size`, `filename`, optional image dimensions, and `duration_ms` for
audio/video when supplied.
They never expose the encrypted Bulletin/HOP claim ticket or a raw `hop:`
reference. When Bulletin retrieval is enabled, the attachment also includes an
opaque `media_id` and `url: /media/<media_id>`. Treat `downloaded` as a cache
hint only: fetch the authenticated URL when the framework needs bytes, because
the bridge can download and validate the media on demand.

Those opaque media IDs are process-local, bounded, and expire according to
`BOT_T3AMS_BRIDGE_MEDIA_REF_TTL_MS`. They are the sole bridge capability for
media; never attempt to reconstruct or fetch the original attachment reference.

### Files and live operations

Every T3ams DM or channel has a separate conversation-scoped vault. The bridge
supports `GET`, `PUT`, and `DELETE` under
`/files/<url-encoded-chat_id>[/<path>]`. `POST /send` with a file from that
same vault uploads a fresh encrypted T3ams attachment. It may include a text
caption, `reply_to`, and `thread_root_id`, but cannot use `edit_of`.

When the T3ams bot runs `BOT_BRAIN=bridge`, bind every outbound
`POST /send`, `POST /react`, and `POST /typing` to the leased inbound work by
including its `delivery_id` and `lease_id`. An authenticated edit or delete
revokes the old claim, preventing a stale worker from replying to the
superseded prompt or publishing stale live activity.

There is one deliberate exception: a framework action with no inbound
delivery. For that, configure the separate `BOT_BRIDGE_PROACTIVE_TOKEN` and
send it in `x-bridge-proactive-token` alongside the normal bridge token. The
header is accepted only for an entirely unleased `/send`, `/react`, or
`/typing` request; a request that supplies a lease must still have an active
matching lease.

T3ams supports `POST /send` edits, `POST /react`, and `POST /typing` as real
chat operations. `GET /health` advertises the exact support under
`live: { supportsEdit, supportsTyping, supportsReaction, minEditMs,
placeholderAfterMs }`; check it rather than assuming a capability on another
transport. Media retrieval and file delivery require a trusted
`BOT_T3AMS_BULLETIN_RPC`; outbound files additionally require the bot's separate
T3ams Bulletin upload allowance.
