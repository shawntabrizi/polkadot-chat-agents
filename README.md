# polkadot-chat-agents

Framework for running AI chat bots (openclaw / hermes / takopi, or direct AI API)
as participants in the Polkadot app chat, over the Statement Store.

**Status: design / pre-MVP.** No code yet — a decision gates the first build step.

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
