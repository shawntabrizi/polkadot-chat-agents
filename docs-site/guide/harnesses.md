---
next:
  text: "Configuration (env vars)"
  link: "/reference/configuration"
---

# Agent frameworks and direct brains

bot-core handles the Polkadot chat transport (identity, encryption, receive,
send) and stays agnostic about what produces the replies. There are two ways to
plug in an answer source: run bot-core in bridge mode and let an agent framework
drive the conversation over a small HTTP API, or use a direct brain, where
bot-core invokes a model CLI itself.

```
Polkadot app <-> Statement Store <-> bot-core <-> HTTP bridge <-> framework plugin <-> agent
```

Bridge mode is selected with the `bridge` brain:

```bash
pca create mybot --brain bridge --owner yourname.42
pca run mybot
```

The bridge listens on `http://127.0.0.1:8799` by default. Every route requires
`Authorization: Bearer <BOT_BRIDGE_TOKEN>` (or `X-Bridge-Token`). `pca create`
generates and stores this random token in the bot's mode-0600 `config.json`; the
generated harness deployments pass it through `POLKADOT_BRIDGE_TOKEN`.
The token can manage every peer's saved-file vault, so a framework that receives
it is part of the trusted computing base.

## The bridge contract

A framework plugin needs this small authenticated API:

| Route | Purpose |
|---|---|
| `GET /health` | returns `{ ok, transport, account, identifierKey, username, … }`, including live/media/file capability flags. |
| `GET /inbound?wait=<secs>&limit=<n>` | long-poll; returns at most the requested bounded batch of leased `[{ delivery_id, lease_id, lease_ms, chat_id, text, message_id }, ...]`, or an empty array on timeout. `chat_id` is transport-specific. `text` is always non-empty (a safe placeholder is synthesized for a caption-less attachment). Items may carry `kind` (`richText`/`reply`/`edited`), `reply_to`, `edit_of`, and safe attachment metadata. Add `&events=1` to also receive non-message signals — opt-in, so a harness that ignores them never chat-replies to a reaction. |
| `POST /inbound/ack { delivery_id, lease_id }` | permanently acknowledges a leased inbound row after the framework has successfully handed it to its own runtime. Accepts `deliveries: [{ delivery_id, lease_id }, ...]` for a batch. Unacknowledged rows are retried after their lease expires; a stale claim acknowledges zero rows. |
| `POST /inbound/renew { delivery_id, lease_id }` | extends an active lease for a long-running turn. Renew before `lease_ms` elapses, then ACK only the current lease. |
| `GET /media/<id>` | authenticated attachment bytes (`url` from the inbound item), served with its content type. A T3ams URL can materialize validated encrypted media on demand. |
| `GET /files/<chat_id>` / `GET /files/<chat_id>/<path>` | list a peer's durable vault (optional `?prefix=`), or stream one saved file. |
| `PUT /files/<chat_id>/<path>` / `DELETE /files/<chat_id>/<path>` | save raw bytes in that peer's vault (use `?overwrite=1` to replace), or remove one file. |
| `POST /send { chat_id, text?, file_path?, reply_to?, edit_of? }` | publishes a reply, file, or edit; returns `{ success, message_id }`. `file_path` must identify a file already in that same chat's vault. `reply_to` and `edit_of` are mutually exclusive. A T3ams file may include a caption and reply target, but never `edit_of`. **Live replies:** when a turn runs long, bot-core posts a thinking placeholder; the first plain send resolves it into the final answer. `edit_of` frames are throttled and coalesced server-side, so a harness may stream freely. `GET /health` advertises the actual `live` capability. |
| `POST /react { chat_id, message_id, emoji, remove? }` | reacts to a peer message with an emoji; `remove: true` retracts a prior reaction. T3ams publishes the native operation. |
| `POST /typing { chat_id }` | best-effort typing signal. T3ams publishes it natively; transports without that operation can no-op. |

An adapter is a loop: poll a bounded `/inbound` batch, renew each active lease
while its agent turn runs, ACK only after that handoff succeeds, then use
`POST /send` for replies. Point
it at the bridge with `POLKADOT_BRIDGE_URL` and `POLKADOT_BRIDGE_TOKEN`.
bot-core enforces the allowlist before a message reaches the bridge, so unlisted
senders never reach the agent or spend model quota.

To return a framework-generated artifact, store it with
`PUT /files/<chat_id>/<path>` and then call `POST /send` with that `file_path`.
The bridge never accepts an arbitrary host path for delivery. `GET /health`
reports the relevant delivery status: the default transport's derived allowance
account or T3ams's trusted Bulletin endpoint and operator-provisioned media
status.

### T3ams bridge behavior

With `--transport t3ams`, the same poll loop drives DMs and workspace channels.
Native ad-hoc T3ams groups are not supported yet. T3ams chat IDs begin with
`t3ams:` and inbound rows include the conversation
type, sender XID/name, channel/workspace IDs where applicable, and
`thread_root_id` for a threaded message. Send that thread root back with the
reply when the framework should stay in the same thread.

T3ams rows can include `attachments` with safe metadata (`mime`, `size`,
filename, optional dimensions, or `duration_ms`) and an opaque
`/media/<media_id>` URL. The original encrypted Bulletin reference is
deliberately absent. Fetch the bridge URL when the agent needs bytes;
`downloaded` only says whether it is already cached, not whether the URL is
usable. The framework can read or write only the same conversation's vault
through `/files`, then return an artifact as an encrypted T3ams attachment with
`file_path`.

Slow T3ams turns use the same thinking placeholder pattern as direct brains.
The bridge performs real typing, reaction, and edit operations, including
coalesced edit streaming. Read `GET /health.live` rather than hard-coding
support. An optional `channel_context` field is bounded earlier authenticated
channel text supplied only with an explicit mention; it is background context,
not an inbound message to answer independently. See the
[Bridge HTTP API](/reference/bridge#t3ams-rich-chat) and
[T3ams files](/guide/files#t3ams-photos-media-and-documents) for the
transport-specific limits and allowance requirements.

For `BOT_BRAIN=bridge`, normal `/send`, `/react`, and `/typing`
calls carry the active inbound `delivery_id` and `lease_id`; a prompt edit or
delete revokes that claim. A framework action with no inbound turn (such as an
OpenClaw attached result) can instead use the opt-in, distinct
`BOT_BRIDGE_PROACTIVE_TOKEN` in `x-bridge-proactive-token`, in addition to
ordinary bridge authentication. It is accepted only for an entirely unleased
operation and never validates a supplied stale lease. Leave it unset unless
that proactive path is required.

## Bundled framework deployments

The generated Hermes and OpenClaw deployments use bundled adapter packages. Run
`pca deploy ... --harness hermes` or `--harness openclaw` from a full source
checkout with its dependencies installed; a global or npm-only installation does
not include those adapters.

## Hermes

Hermes (NousResearch/hermes-agent) is a Python agent with platform-plugin
support. Its bundled adapter long-polls the bridge and posts replies,
reconnecting after a bot-core restart.

The deployed setup is generated by:

```bash
pca deploy mybot --host root@server --harness hermes
```

This starts bot-core and Hermes on a private network and gives Hermes the bridge
URL and token it needs. Hermes then needs its one-time model login, which cannot
be automated; the deploy prints the command:

```bash
docker exec -it <hermes-container> hermes auth add openai-codex --type oauth --no-browser
```

Model configuration for the ChatGPT/Codex subscription, in Hermes's
`config.yaml` (or via `hermes config set`):

```yaml
model:
  provider: openai-codex
  default: gpt-5.5          # this endpoint accepts base gpt-5.5 only
  base_url: https://chatgpt.com/backend-api/codex
agent:
  reasoning_effort: low     # the main cost lever on a reasoning model
```

For a local (non-Docker) setup, copy `hermes-plugin/polkadot` into
`~/.hermes/plugins/`, export both `POLKADOT_BRIDGE_URL` and
`POLKADOT_BRIDGE_TOKEN`, and run `hermes gateway run`.

## OpenClaw

OpenClaw is a multi-channel AI gateway. Its bundled adapter polls each bot,
hands messages to the gateway, and returns replies through the bridge. It can
also be installed with a normal `openclaw plugins install <path-or-git>` flow.

The deployed setup is generated by:

```bash
pca deploy mybot --host root@server --harness openclaw
```

This builds a gateway image with OpenClaw and Claude Code, installs the adapter,
generates the model, channel, and gateway configuration, and seeds Claude
credentials from the server's `~/.claude` login. If the server has those
credentials, there are no interactive steps.

Manual channel configuration, if you run OpenClaw yourself
(`openclaw.json` under `channels.polkadot`):

```jsonc
{
  "enabled": true,
  "bridgeUrl": "http://127.0.0.1:8799",
  "bridgeToken": "<BOT_BRIDGE_TOKEN>",
  "dmPolicy": "allowlist",
  "allowFrom": ["<peer account-id hex>"]
}
```

Operational notes:

- The gateway requires `gateway.mode: "local"` in its config and an
  `OPENCLAW_GATEWAY_TOKEN` in its environment when it detects it is running in a
  container. It also requires `POLKADOT_BRIDGE_TOKEN` (or the channel's
  `bridgeToken`) to call bot-core.
- Claude OAuth refresh tokens rotate. Once a container's claude CLI refreshes,
  any older copy of `.credentials.json` (for example the host original) is
  stale. If a redeploy reports "Not logged in", re-seed the container home from
  wherever the live token is.

The bundled OpenClaw adapter includes per-setting notes for advanced setup.

## Other frameworks

Any framework that can run the poll loop above can drive a bot; the
[Bridge HTTP API](/reference/bridge) is the complete integration contract. The
Hermes integration is a practical template.

## Direct engines

Without a framework, bot-core runs a headless AI-agent CLI itself — as an
autonomous agent, not a chat wrapper: the user's message is passed verbatim (no
injected persona), conversation continuity is the CLI's own native session
(`--resume`), and bot-core presents its progress and answer in the chat. Direct
Claude, Codex, and OpenCode engines start with no tools; the deployer chooses a
portable capability and scope policy explicitly.

| Engine | Invokes | Reaches | Authentication |
|---|---|---|---|
| `claude` | `claude -p --output-format stream-json …` | Claude models | Claude Code login |
| `codex` | `codex exec --json …` | OpenAI models | `codex login` |
| `opencode` | `opencode run --format json …` | **many providers** via `--model provider/model` (anthropic/…, openai/…, google/…, xai/…, openrouter/…, ollama/…) | `opencode auth login` |

opencode is the many-models path: one engine reaches ~any provider, so there is
no need for per-vendor brains (`gemini`/`grok` were removed — use
`opencode --model google/…` or `xai/…`).

```bash
pca create mybot --brain claude --owner yourname.42
pca run mybot
```

Related settings:

- `--model` on `create` (saved) or `run`/`deploy` (override) selects the model —
  `BOT_AI_MODEL`. For opencode it's a `provider/model` slug (the provider
  selector); for claude/codex a plain model name.
- `pca model <bot> show|set|allow|lock|open` controls chat-side `/model`.
  Switching is locked by default. `allow` persists an approved list;
  `open` is an explicit option for allowlisted bots only. Public bots cannot
  allow unrestricted switching.
- Claude, Codex, and OpenCode start with no tools. Deploy a portable policy
  with `--allowed-tools read,write,bash` and
  `--tool-scope workspace|container`. `write` includes `read`; `bash` includes
  both. The generated environment uses `BOT_AI_TOOL_CAPABILITIES` and
  `BOT_AI_TOOL_SCOPE`.
- Public direct bots use the same policy. Every sender can direct the selected
  capability, so choose the model and scope deliberately. A
  read-capable turn can inspect its staged attachment, and a write-capable turn
  can return generated files.
- Workspace scopes native file tools to the selected project and staged
  attachments. Bash uses the agent process boundary in either scope.
- The agent works in a persistent non-secret workspace (`BOT_AI_WORKSPACE`,
  defaulting to a sibling of `BOT_STATE_DIR`) that survives restarts.
- `BOT_AI_CMD`/`BOT_AI_ARGS` wire in a custom CLI that speaks claude-shaped
  stream-json (`__PROMPT__` is replaced with the prompt).
- Transport file commands (`/file put|ls|info|rm|get`) work for every brain,
  before a direct engine or bridge framework receives the message. Other
  in-chat commands are direct-engine-only: /help, /reset (start a fresh
  session), /stop (cancel the current turn), /model [name|default], /ping.
  Bridge bots pass those remaining slash commands through to the framework.
- A direct turn has a configurable hard cap (`BOT_AI_MAX_MS`, default one
  hour) as well as an idle-silence backstop (`BOT_AI_IDLE_TIMEOUT_MS`, default
  10 min of zero output). Either one kills a wedged turn and unblocks the peer;
  `/stop` is the user's cancel lever.
- `BOT_THINKING_AFTER_MS` (default 5000) and `BOT_THINKING_TEXT` control the
  live placeholder posted when a reply is slow; setting the text empty disables
  it.
- `--greet` on `run`/`deploy` (env `BOT_GREET=1`, text via `BOT_GREET_TEXT`): the
  bot messages each allowlisted owner it has never talked to on startup — once
  ever per owner, never into an existing thread. Works for any brain, including
  bridge mode.
- Failed turns are logged with a cause: `BOT_AI_AUTH_REVOKED` means the CLI
  needs a re-login, `BOT_AI_FAILED` is transient, `BOT_AI_IDLE_TIMEOUT` means a
  wedged turn was killed by the idle backstop.

### Safety model for containerized agents

`pca deploy` keeps the transport as root only to own `/state` (the signing seed,
session keys, and bridge token), then spawns the agent as the non-root `node`
user with persistent `/workspace`, `/home/node`, and private per-turn attachment
directories. The source mount is read-only; the container uses an init reaper,
no-new-privileges, and process/memory/CPU ceilings. This protects the chat
identity from the agent process.

The CLI retains `/home/node` only to authenticate and refresh its own OAuth
session; container-scoped native file tools and Bash can access it. Workspace
scopes native file tools to the selected project; Bash uses the agent process
boundary in either scope. A deployed bot has a dedicated container; local
`pca run` uses the local process account and should be treated as a
trusted-machine tool. Container scope deliberately exposes the home to native
file tools. For a public bot, every sender can direct the policy the deployer
selected. Sessions and the workspace persist across redeploys.

An AI brain spends quota, so `create` requires an allowlist or an explicit
`--public`.
