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

## Quick start

```bash
cd bot-core
npm install                                                   # deps + descriptors
cargo build --manifest-path ../tools/bandersnatch-cli/Cargo.toml   # one-time: identity tool

# Create an AI bot — generates its identity, registers it, and locks it to you
node cli.mjs create mycoolbot --brain codex --owner <your-polkadot-app-address>

# Run it — now message "mycoolbot" from the Polkadot app and it replies
node cli.mjs run mycoolbot
```

**Keep it running on a server** — `pca deploy` ships the bot to any box with Docker
+ SSH and starts it in a container (survives logout/reboot):

```bash
# claude bot, fully headless — pin a low-cost model to keep tokens cheap
node cli.mjs deploy mycoolbot --host root@1.2.3.4 \
  --anthropic-key sk-ant-… --model claude-haiku-4-5-20251001

node cli.mjs deploy mycoolbot --host root@1.2.3.4 --dry-run   # preview compose+env first
```

It uploads bot-core, generates the compose + env, brings the container up, and waits
for it to come online. Supports the `echo` and `claude` brains today (single
container); `codex`/`gemini`/`grok` need an interactive login and `hermes` needs a
second container — set those up per `docs/HARNESSES.md`.

`--owner <address>` locks the bot so only your Polkadot app address can message it
(recommended — an AI/`hermes` bot spends your quota, so it won't be left open
unless you pass `--public`). `create` prints a link to message your bot;
`node cli.mjs info mycoolbot` shows it again + whether the network has confirmed the
bot (can take a few minutes). `node cli.mjs list` lists your bots. (Install as `pca`.)

**Brains** (`--brain`): a **direct AI brain** answers by shelling out to that
model's own CLI (which owns its own auth) — `codex`, `claude`, `gemini`, or `grok`.
`echo` repeats you (a zero-config smoke test). `hermes`/`bridge` hands messages to
an external agent framework via the HTTP bridge (see below). Any other CLI works
via `BOT_AI_CMD`/`BOT_AI_ARGS`. See `docs/HARNESSES.md`.

## Advanced: plug into a harness (Hermes)

Run bot-core with `--brain hermes`, point a Hermes instance at its bridge
(`POLKADOT_BRIDGE_URL`, `hermes-plugin/polkadot` dropped into `~/.hermes/plugins/`),
and Hermes drives the conversation. See `docs/DESIGN.md`.

## Testing without a phone

`node bot-core/test-client.mjs --seed-hex 0x<attested-seed> --bot-account 0x.. \
  --bot-identifier-key 0x.. "hello"` sends a message and prints the bot's replies.

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
