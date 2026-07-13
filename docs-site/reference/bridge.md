---
next:
  text: "How it works"
  link: "/explanation/how-it-works"
---

# Bridge HTTP API

In bridge mode, `bot-core` handles the transport (polling, decoding, ACKs,
sending, attachment downloads) and exposes a small local HTTP API. Any
framework that can run a poll loop can drive a bot through it — the Hermes and
OpenClaw integrations are thin adapters over this contract.

## Authentication

Every request must present the bot's `BOT_BRIDGE_TOKEN` — either
`Authorization: Bearer <token>` or an `x-bridge-token` header — compared in
constant time. The process refuses to start without a 32+ character token. The
CLI generates one automatically and shares it with the bundled harness. The
bridge binds to loopback by default; harness stacks bind it to the compose
network only.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ ok, account, identifierKey, username, … }` — reachability and capability flags. |
| `GET /inbound?wait=<secs>&limit=<n>` | Long-poll. Returns leased deliveries: `[{ delivery_id, lease_id, lease_ms, chat_id, text, message_id, … }]`. Add `&events=1` to also receive reactions, coinage, and leftChat signals. |
| `POST /inbound/ack` `{ delivery_id, lease_id }` | Acknowledge a completed delivery so it isn't redelivered. |
| `POST /inbound/renew` `{ delivery_id, lease_id }` | Extend an active lease while still working. |
| `GET /media/<id>` | Bytes of a downloaded attachment. |
| `POST /send` `{ chat_id, text, reply_to?, edit_of? }` | Publish a reply. `reply_to` renders a quote; `edit_of` rewrites one of the bot's own messages. |
| `POST /react` `{ chat_id, message_id, emoji, remove? }` | Emoji reaction. |
| `POST /typing` `{ chat_id }` | Best-effort no-op. |

## Delivery is leased (at-least-once)

`/inbound` hands each message out under a **lease**, not a fire-and-forget
drain. A harness renews the lease while it works and calls `/inbound/ack` only
once the message is fully handled. If the harness crashes mid-turn, the lease
expires and `bot-core` redelivers — so a failed handoff is retried rather than
lost. A harness must therefore **not** acknowledge a delivery it didn't finish.

## Allowlist and long answers

The peer allowlist is enforced inside `bot-core` before a message reaches the
bridge, so unlisted senders never reach the framework or spend model quota.
Long replies sent via `/send` are split into ordered parts automatically, and
the "thinking" placeholder is finalized into the first part — the harness just
sends text.
