# Connecting an AI agent harness

`bot-core` is **harness-agnostic**. It handles the Polkadot app chat transport
(identity, encryption, receive/send) and exposes a small local HTTP **bridge**.
Any agent framework ("harness") drives the conversation by talking to that bridge
through a thin **channel/platform plugin**.

```
Polkadot app  ⇄  Statement Store  ⇄  bot-core (--brain hermes)  ⇄  HTTP bridge  ⇄  harness plugin  ⇄  agent (Hermes / OpenClaw / …)
```

Run bot-core in bridge mode so it hands messages to a harness instead of replying
itself:

```bash
pca create mybot --brain hermes --owner <your-address>
pca run mybot         # bot-core now exposes the bridge on http://127.0.0.1:8799
```

## The bridge contract (write an adapter for any harness)

The plugin only needs to speak HTTP to bot-core:

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ ok, account, identifierKey, username }` |
| `GET /inbound?wait=<secs>` | **long-poll** for inbound messages → `[{ chat_id, text, message_id }, …]` (empty array on timeout; `chat_id` is the peer's id) |
| `POST /send { chat_id, text }` | send a reply to that peer → `{ success, message_id }` |
| `POST /typing { chat_id }` | best-effort (currently a no-op) |

A harness plugin = **loop on `GET /inbound` → feed each message to the agent →
`POST /send` the reply**. Point it at the bridge with `POLKADOT_BRIDGE_URL`
(default `http://127.0.0.1:8799`).

`bot-core` already enforces the **allowlist** (`--owner` / `--public`) before a
message is ever handed to the harness, so unlisted senders never reach your agent
or spend quota.

---

## Hermes (NousResearch/hermes-agent)

Hermes is a Python agent with a platform-plugin gateway. The Polkadot plugin
(`hermes-plugin/polkadot/`) is a `BasePlatformAdapter` that long-polls the bridge
and posts replies.

**1. Install Hermes** and configure a model. On the ChatGPT/Codex subscription:

```bash
hermes config set model.provider openai-codex
hermes config set model.default  gpt-5.5          # base gpt-5.5 only; -codex/-mini 400 on this endpoint
hermes config set model.base_url https://chatgpt.com/backend-api/codex
docker exec -it <hermes> hermes auth add openai-codex --type oauth --no-browser   # device-flow login
```

**2. Install the Polkadot plugin** into Hermes's plugins dir (`$HERMES_HOME/plugins/`,
i.e. `~/.hermes/plugins/` — in the Docker image, `/opt/data/plugins/`):

```bash
cp -r hermes-plugin/polkadot  <HERMES_HOME>/plugins/polkadot
```

**3. Point it at the bridge and run the gateway:**

```bash
export POLKADOT_BRIDGE_URL=http://127.0.0.1:8799      # or the bot-core container's URL
hermes gateway run
```

Send your bot a message in the Polkadot app — Hermes answers, with its full
memory/tools/model behind it.

**Docker (recommended, mirrors the reference deploy).** Two services on their own
network: `bot-core` (Node) exposing the bridge, and `nousresearch/hermes-agent`
with `command: ["gateway","run"]`, the plugin bind-mounted at
`/opt/data/plugins/polkadot`, and `POLKADOT_BRIDGE_URL=http://bot-core:8799`. The
plugin recreates its HTTP connection on error, so a bot-core restart won't wedge it.

---

## OpenClaw (openclaw/openclaw)

OpenClaw is a TypeScript/Node multi-channel AI gateway with a channel-plugin SDK.
The Polkadot channel plugin bridges the same way (long-poll `/inbound`, `POST /send`).

_Setup steps are filled in once the channel plugin lands — see `openclaw-plugin/`._

---

## Other harnesses

Any framework that can run a small loop (poll `/inbound`, call your agent, `POST
/send`) can drive a Polkadot bot — the bridge contract above is all it needs. For
frameworks with no plugin system, use bot-core's built-in brains instead
(`--brain codex`, or add a direct-API brain) so bot-core calls the model itself.
