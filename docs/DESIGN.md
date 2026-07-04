# Polkadot Chat Agents — Design Notes

> A framework for running AI chat bots (openclaw, hermes, takopi, or plain direct
> AI API access) as participants in the Polkadot app's built-in chat, over the
> Statement Store.
>
> Status: **design / pre-MVP.** Folder name `polkadot-chat-agents` is provisional.

## 1. Goal

Make it easy to stand up an AI-backed chat bot that a person can message from the
Polkadot phone app and get a back-and-forth conversation. Start simple:
direct AI API (single request/response), text only, CLI setup on a VPS.

## 2. How the transport works (learned from `summit-faucet-chatbot`)

- **No chat server.** Messages ride the **Statement Store** (the app's
  "MessageExchange"). The bot is an *outbound-only client* of a chain RPC node:
  it subscribes to its own topics (`statement_subscribeStatement`) and publishes
  its own statements. No inbound ports, no public IP. Runs anywhere with
  outbound internet.
- **Store-and-forward.** Statements persist in the store (bounded per account)
  until they expire or are evicted; reads are non-destructive. Peers pull them.
  A bot tolerates downtime via historical catch-up over its topics.
- **Sessions are E2E encrypted.** Each conversation derives an AES key from an
  ECDH (P256) shared secret between the two parties' chat `identifier_key`s.
- **Singleton per identity.** Exactly one live process may serve a given bot
  account (a runtime lock / lease), or replies double-send.

## 3. The decisive constraint: being *messageable* requires personhood

Two separate on-chain capabilities — do not conflate them:

| Capability | Extrinsic | Gate | Gives |
|---|---|---|---|
| **Messageable** (receive chats) | `Resources::register_lite_person` / `register_person` | account must be an **attested lite person** / full person | publishes `identifier_key` in `Resources::Consumers` **and** grants statement bandwidth (50 stmts / 500 KiB for lite) |
| **Bandwidth only** (publish) | `Resources::set_statement_store_account` | caller's **own personhood** (decentralized), target = arbitrary account | 2 stmts / 500 KiB, per-period, no `identifier_key` |

The app resolves a recipient's chat key from **on-chain** `Resources::Consumers`
(`faucet-chat-listener.mjs:8684`). An account not in that map is **unreachable**.
The slot-delegation path never writes `identifier_key`, so a slot-only bot can
publish but **cannot receive encrypted chats**.

**Consequence:** an interactive bot must be an **attested lite-person consumer.**
Attestation (`people-lite::attest`) requires a **verifier** holding attestation
quota granted by governance (`AttestationAllowanceManager = EnsureRoot`). So a
fully self-serve decentralized interactive bot is **not possible on the current
runtime** without one of the paths below.

## 4. Options for issuance

- **A. Attested bots (MVP).** Use a verifier you control (existing identity
  backend, or governance grants *you* attestation quota). You attest each bot
  account → lite-person consumer → messageable + bandwidth. Bot count bounded by
  **attestation quota**, not statement slots. *Works today.*
- **B. Bot = your own person account.** Only one messageable identity per person;
  doesn't scale to many bots.
- **C. Slot-delegation publishers.** Decentralized but non-interactive (no DMs).
- **D. Add a decentralized consumer-delegation extrinsic** (runtime change in
  `individuality`): let a person register N consumer `identifier_key`s for
  delegate accounts, mirroring `set_statement_store_account`. The "right" fix for
  decentralized interactive bots. *Future track.*

**Decision:** MVP on **A**; pursue **D** separately in the `individuality` repo.

## 5. Corrected onboarding flow

1. Human has personhood (full or lite).
2. Generate bot key + account (sr25519 wallet key + derived P256 chat key), store
   in an env/secrets file.
3. On a VPS: clone this framework, give it the bot key.
4. **Attest the bot account as a lite-person consumer** (via a verifier you
   control) — publishes `identifier_key`, grants bandwidth. *(replaces "delegate
   statement slot")*
5. Message the bot from the phone app → framework forwards to the AI API →
   publishes the reply as a chat statement.
6. All via CLI: `clone → setup (does step 4) → run listener`.

## 6. Open gaps to resolve before/while building

- **Fees/gas** for `attest` + registration + publishing. Check the `pgas`
  pallet — personhood may subsidize transactions.
- **AI API cost abuse:** anyone who can message the bot burns your tokens →
  per-peer rate limits / allowlist / quotas required.
- **Per-conversation context/memory**, keyed by chat session/peer.
- **Verifier access:** do we have (or can we get) attestation quota on the target
  network? This is the true prerequisite for path A.
- **Reuse vs. rewrite:** the faucet listener is ~10.5k lines of coinage/stripe/
  inventory logic irrelevant to a chat bot. Extract a minimal `bot-core`
  (identity, transport subscribe/catch-up/decode/ACK/send, session crypto,
  runtime lock) rather than fork the whole thing.

## 6b. Harness integration architecture (decided 2026-07-03)

Round-trip + codex AI reply are PROVEN (see TEST-ROUND-TRIP.md). For real
harnesses, the target is **Hermes (NousResearch/hermes-agent)**, which is a
Python agent with a **platform-plugin gateway** (telegram/slack/whatsapp/…).
Hermes's WhatsApp integration = a **Node bridge (Express HTTP server) + a thin
Python `BasePlatformAdapter`**. Our situation (Node transport, Python agent) is
identical, so we copy that pattern. Hermes "Plugin Path" = drop `plugin.yaml` +
`adapter.py` into `~/.hermes/plugins/`, register via `ctx.register_platform()`,
**zero changes to Hermes core**.

```
polkadot-chat-agents/
  bot-core/       (Node)  reusable transport daemon; reuses faucet codec/session/
                          subscribe/send. Local API: GET /health, inbound push
                          {chat_id=peerHex, text, session}, POST /send {chat_id,text}.
  hermes-plugin/  (Python) plugins/platforms/polkadot: adapter.py subclasses
                          BasePlatformAdapter — connect() consumes bot-core inbound →
                          self.handle_message(event); send(chat_id,text) → POST bot-core.
```

Adapter required methods (from `gateway/platforms/ADDING_A_PLATFORM.md`):
`__init__`, `connect()->bool`, `disconnect()`, `send(chat_id,text)->SendResult`,
`send_typing(chat_id)`, `send_image(...)`, `get_chat_info(chat_id)`. Inbound via
`self.handle_message(MessageEvent)`; sources via `self.build_source(...)`.

`bot-core` is harness-agnostic: same daemon backs the Hermes plugin, future
openclaw/takopi adapters, AND a standalone mode where bot-core calls a backend
directly (the proven codex spike). One transport, many brains. NOTE language
boundary: Hermes is Python, our transport is Node — the HTTP bridge resolves it,
exactly as Hermes's WhatsApp/Baileys bridge does.

## 6c. bot-core bridge HTTP contract (spec)

The Hermes plugin (`hermes-plugin/polkadot/adapter.py`, built) talks to bot-core over:

- `GET /health` → `200 {ok:true, account:"5..."/"0x..", identifierKey:"0x.."}`
- `GET /inbound?wait=<secs>` → long-poll; returns `200 [{chat_id, text, message_id, user_name?}, …]`
  (empty array on timeout). `chat_id` = peer account-id hex. Adapter loops this.
- `POST /send {chat_id, text}` → `200 {success:true, message_id}` or `{success:false, error}`.
  Publishes a chat reply statement to that peer.
- `POST /typing {chat_id}` → best-effort, optional (adapter never fails on it).

**Open implementation detail (the one tricky bit):** `POST /send` must resolve the
peer's chat **session** to call the listener's `sendTextToPeer(session, peerHex, text, cause)`.
On the inbound path the session is in hand; for an outbound reply we need a
`peerHex → session` lookup (sessions are created/held internally by the listener).
The bridge must keep (or query) that map. This touches listener session plumbing,
so it's best built against the running bot with live testing — deferred to the
next working session, not scaffolded blind.

Status: Hermes plugin scaffolded + syntax-checked (untested — Hermes not installed
here; `./hermes` fails importing `hermes_cli.main`). Node bridge = next code step.

## 7. Proposed MVP scope (smallest thing that proves it works)

1. One pre-attested bot identity (do the attestation manually first to de-risk).
2. Minimal listener: subscribe to the bot's topics → decode inbound chat → ACK →
   call AI API with per-peer history → publish the text reply.
3. Send a message from the phone, confirm a reply. **Only then** generalize into
   the multi-bot CLI onboarding.

De-risking spike: prove step 3 with a hardcoded echo (no AI) before wiring the AI
API, to isolate transport bring-up from AI integration.
