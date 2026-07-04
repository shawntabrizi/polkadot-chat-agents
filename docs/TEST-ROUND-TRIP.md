# Sanity check: prove a phone → bot → reply round trip

> **RESULT (2026-07-03): PROVEN.** Bot `agentechobot.90` on Paseo, phone sent "Hi",
> bot replied `pong 🏓` in ~620ms (decode→send). On-chain discovery, session
> encryption, delivery, and reply all confirmed. Headless load-test path was blocked
> only by backend attestation lag for the *client* identity (issuance bottleneck),
> not the transport. Faucet's command router also fired a "fallback options" reply —
> that router is what the framework replaces with an AI call.

Goal: confirm the transport works end-to-end **before building the framework** —
with **zero new code** and **zero funding**, by reusing `../summit-faucet-chatbot`
as a stand-in echo bot.

Why this works:
- `register_lite_person` is `Pays::No` → registering a messageable identity is feeless.
- With `FAUCET_CHAT_AUTO_CLAIM_ON_ACCEPT=false`, the faucet listener replies with
  `FAUCET_CHAT_ACK_TEXT` and does **no** coinage — so no wallet/inventory/gas.
- `scripts/faucet-load-test.mjs` is a headless "phone": it registers app-style
  identities via the same Paseo identity backend and sends real chat requests,
  then reports `ordinaryMessagesAllReplied` + a `textReplyAt` latency.

All commands run from `../summit-faucet-chatbot`.

## 0. Prerequisites (one-time)

```bash
npm install                 # installs deps + runs `papi generate`
npm run bot:build-tools     # builds the Rust bandersnatch CLI (needs cargo)
```

## 1. Register a messageable bot identity on Paseo (feeless)

```bash
npm run bot:setup -- \
  --instance 90 \
  --username echotestbot \        # >= 6 lowercase letters
  --network paseo-next \
  --allow-no-admin                 # skip the admin seed for a throwaway test
```
Writes `secrets/faucet.env`, the lite-person consumer registration, and QR codes
(`secrets/.../*.deeplink.png`). This publishes the bot's `identifier_key` on-chain
→ it is now messageable.

## 2. Run the faucet as a text-only echo (no coinage, no funding)

```bash
set -a; source secrets/faucet.env; set +a
FAUCET_CHAT_AUTO_CLAIM_ON_ACCEPT=false \
FAUCET_CHAT_ACK_TEXT="pong 🏓" \
npm run bot:chat
```
Any incoming message now gets `pong 🏓` back.

## 3a. Test headlessly (fast, deterministic — no phone)

In a second shell (env still sourced for the bot account/identifier key):
```bash
node scripts/faucet-load-test.mjs \
  --scenario ramp --users 1 \
  --endpoint wss://paseo-people-next-system-rpc.polkadot.io --allow-public \
  --bot-account "$FAUCET_CHAT_SERVICE_ACCOUNT" \
  --bot-identifier-key "$FAUCET_CHAT_SERVICE_IDENTIFIER_KEY" \
  --out roundtrip.json
```
**Pass criteria** in `roundtrip.json`: `ordinaryMessagesAllReplied: true` and a
non-null `textReplyAt` latency. That proves: our identity is discoverable on-chain,
the session encrypts, the message is delivered, and the reply comes back.

## 3b. Test from the real phone (proves the true path)

Open the Polkadot app (on Paseo), scan `secrets/.../<identity>.deeplink.png`, send
any message → expect `pong 🏓`.

## What this validates / what's next

Validates the whole transport + discovery + session-crypto path with our own
identity. The framework's first increment is then just to **replace the static
`ackText`** with (1) an echo of the user's text, then (2) an AI API call with
per-peer history. Nothing else about the transport needs to change.
