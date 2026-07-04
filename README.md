# polkadot-chat-agents

Framework for running AI chat bots (Hermes, etc.) as participants in the Polkadot
app's built-in chat, over the Statement Store — **no chat server required**.

**Status: working & deployed.** A Hermes agent backed by a Codex subscription holds
conversations over Polkadot app chat, running on a VPS. Confirmed end-to-end.

## Layout

- **`bot-core/`** — standalone Node transport (no faucet dependency). Loads a bot
  identity, connects to a Polkadot RPC, receives chat requests + session messages,
  resolves peers' chat keys on-chain, ACKs, and exposes a local HTTP bridge:
  - `GET /health`, `GET /inbound?wait=` (long-poll), `POST /send {chat_id,text}`.
  - Reuses only the generic chat codec + transport (`bot-core/vendor/`).
  - `bot-core/test-client.mjs` — headless tester (send from an attested seed, read replies).
- **`hermes-plugin/polkadot/`** — Hermes `BasePlatformAdapter` that relays Polkadot
  app chat to/from the bot-core bridge (drops into `~/.hermes/plugins/`).
- **`docs/`** — architecture (`DESIGN.md`) and the round-trip test guide.

## Run

```bash
cd bot-core && npm install
BOT_SEED_HEX=0x<root-seed> BOT_ALLOWED_PEERS=<hex,hex> node index.mjs
```
Then point a Hermes instance (with the `polkadot` plugin, `POLKADOT_BRIDGE_URL`) at it,
or drive it directly with `test-client.mjs`. See `docs/DESIGN.md`.

---
_History: the first working version reused the faucet chat listener in "bridge mode";
`bot-core` is the clean, faucet-free extraction that replaced it._

## Start here

Read [`docs/DESIGN.md`](docs/DESIGN.md). It captures the transport model, the key
constraint, the corrected onboarding flow, and the MVP plan.

## The one thing to know

An interactive bot must be **messageable**, which on-chain means its account is a
registered consumer (`Resources::Consumers`, holding an `identifier_key`). That
requires the bot account to be an **attested lite person** — which requires a
**verifier with governance-granted attestation quota**. Delegating a statement
slot gives bandwidth but does **not** make a bot messageable.

So the MVP prerequisite is **verifier access**, not code.

## Decisions made

1. **Target network:** Paseo (people-next-v2).
2. **Verifier:** reuse the faucet's identity backend
   (`identity-backend-next.parity-testnet.parity.io`) as the verifier for now —
   it holds attestation quota and its registration flow mints a messageable
   lite-person consumer. i.e. path A with the existing backend.

Decentralized issuance (path D, runtime change in `../individuality`) is a later
track, not the MVP.

## MVP plan (once unblocked)

1. Manually attest one bot identity (de-risk issuance).
2. Minimal listener: subscribe to bot topics → decode inbound → ACK → AI API call
   with per-peer history → publish reply.
3. Prove a phone→bot→reply round trip (start with a hardcoded echo, then AI).
4. Generalize into the multi-bot CLI onboarding.

## Related repos

- `../summit-faucet-chatbot` — the working faucet; source of the transport,
  identity, and session-crypto code to extract a minimal `bot-core` from.
- `../individuality` — the runtime (pallets `people-lite`, `resources`); home of
  path D if we pursue decentralized issuance.
