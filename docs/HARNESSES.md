# Agent frameworks and direct brains

bot-core handles the Polkadot chat transport (identity, encryption, receive,
send) and stays agnostic about what produces the replies. There are two ways to
plug in an answer source: run bot-core in bridge mode and let an agent framework
drive the conversation over a small HTTP API, or use a direct brain, where
bot-core invokes a model CLI itself.

```
Polkadot app <-> Statement Store <-> bot-core <-> HTTP bridge <-> framework plugin <-> agent
```

Bridge mode is selected with the `hermes` brain:

```bash
pca create mybot --brain hermes --owner yourname.42
pca run mybot
```

The bridge listens on `http://127.0.0.1:8799` by default. Every route requires
`Authorization: Bearer <BOT_BRIDGE_TOKEN>` (or `X-Bridge-Token`). `pca create`
generates and stores this random token in the bot's mode-0600 `config.json`; the
generated harness deployments pass it through `POLKADOT_BRIDGE_TOKEN`.

## The bridge contract

A framework plugin needs this small authenticated API:

| Route | Purpose |
|---|---|
| `GET /health` | returns `{ ok, account, identifierKey, username }` |
| `GET /inbound?wait=<secs>&limit=<n>` | long-poll; returns at most the requested bounded batch of leased `[{ delivery_id, lease_id, lease_ms, chat_id, text, message_id }, ...]`, or an empty array on timeout. `chat_id` is the peer's account-id hex. `text` is always non-empty (a placeholder like `[photo, image/jpeg, 245 KB]` is synthesized for caption-less attachments). Items may carry `kind` (`richText`/`reply`/`edited`), `reply_to`, `edit_of`, and `attachments: [{ id, kind, mime, size, width?, height?, duration?, downloaded, url?, error? }]`. Add `&events=1` to also receive non-message signals (`kind`: `reaction`, `coinageSend`, `leftChat`, `contactAdded`) — opt-in, so a harness that ignores them never chat-replies to a reaction. |
| `POST /inbound/ack { delivery_id, lease_id }` | permanently acknowledges a leased inbound row after the framework has successfully handed it to its own runtime. Accepts `deliveries: [{ delivery_id, lease_id }, ...]` for a batch. Unacknowledged rows are retried after their lease expires; a stale claim acknowledges zero rows. |
| `POST /inbound/renew { delivery_id, lease_id }` | extends an active lease for a long-running turn. Renew before `lease_ms` elapses, then ACK only the current lease. |
| `GET /media/<id>` | bytes of a downloaded attachment (`id`/`url` from the inbound item), served with its content type |
| `GET /files/<chat_id>`; `GET/PUT/DELETE /files/<chat_id>/<path>` | list, read, write raw bytes, or remove a durable file in that peer's vault. `PUT` uses the request content type and obeys the bot's per-file, per-peer, and global caps. |
| `POST /send { chat_id, text?, file_path?, reply_to?, edit_of? }` | publishes a reply to that peer; returns `{ success, message_id }`. `message_id` is the outgoing message's id — hold on to it to edit that message later. `reply_to: <message_id>` renders as a quote of that peer message in the app; `edit_of: <message_id>` rewrites a message the bot sent earlier (the app updates the bubble in place). The two are mutually exclusive. `file_path` names a file already saved in that exact peer's vault; it cannot be combined with a reply or edit and is delivered only when the bot has an operator-pinned HOP endpoint and provisioned Bulletin allowance. **Live replies:** when a turn runs long, bot-core posts a "thinking…" placeholder; the first plain send for that peer is auto-upgraded into the placeholder's final edit (the returned `message_id` is the placeholder's), so the user sees one evolving bubble instead of thinking + answer. `edit_of` sends are throttled and coalesced server-side (latest-wins) to a statement-store-safe cadence — a harness may stream edits as fast as it likes. `GET /health` advertises this under `live: { supportsEdit, minEditMs, placeholderAfterMs }`. |
| `POST /react { chat_id, message_id, emoji, remove? }` | reacts to a peer message with an emoji (shown as a chip under the bubble in the app); `remove: true` retracts a previous reaction. Returns `{ success }`. |
| `POST /typing { chat_id }` | best-effort, currently a no-op |

An adapter is a loop: poll a bounded `/inbound` batch, renew each active lease
while its agent turn runs, ACK only after that handoff succeeds, then use
`POST /send` for replies. Point
it at the bridge with `POLKADOT_BRIDGE_URL` and `POLKADOT_BRIDGE_TOKEN`.
bot-core enforces the allowlist before a message reaches the bridge, so unlisted
senders never reach the agent or spend model quota.

The bridge token authorizes all bridge routes, including every peer vault. Keep
it in the framework's secret environment only, never expose the bridge through
a host port, and make a framework use the `chat_id` from its own inbound work
when calling `/files` or `file_path` delivery.

## Hermes

Hermes (NousResearch/hermes-agent) is a Python agent with a platform-plugin
gateway. The adapter in `hermes-plugin/polkadot/` subclasses
`BasePlatformAdapter`: it long-polls the bridge and posts replies. It recreates
its HTTP connection on error, so a bot-core restart does not wedge it.

The deployed setup is generated by:

```bash
pca deploy mybot --host root@server --harness hermes
```

This starts a two-container stack (bot-core plus `nousresearch/hermes-agent` with
the plugin bind-mounted at `/opt/data/plugins/polkadot`,
`POLKADOT_BRIDGE_URL=http://bot:8799`, and a bridge token in its secret env
file). Hermes then needs its one-time model
login, which cannot be automated; the deploy prints the command:

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

OpenClaw is a TypeScript multi-channel AI gateway with a channel-plugin SDK. The
plugin in `openclaw-plugin/polkadot/` runs a long-poll loop per account and
dispatches messages through `channelRuntime.inbound.run`; replies route back via
`delivery.deliver` to `POST /send`. It ships a compiled `dist/` bundle, so a
normal `openclaw plugins install <path-or-git>` works.

The deployed setup is generated by:

```bash
pca deploy mybot --host root@server --harness openclaw
```

This builds a gateway image (`openclaw` plus `@anthropic-ai/claude-code`,
running as the non-root `node` user, so the claude CLI needs no root override),
installs the plugin, generates the model, channel, and gateway configuration,
and seeds Claude credentials from the server's `~/.claude` login. If the server
has those credentials, there are no interactive steps.

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

Two operational notes learned in deployment:

- The gateway requires `gateway.mode: "local"` in its config and an
  `OPENCLAW_GATEWAY_TOKEN` in its environment when it detects it is running in a
  container. It also requires `POLKADOT_BRIDGE_TOKEN` (or the channel's
  `bridgeToken`) to call bot-core.
- Claude OAuth refresh tokens rotate. Once a container's claude CLI refreshes,
  any older copy of `.credentials.json` (for example the host original) is
  stale. If a redeploy reports "Not logged in", re-seed the container home from
  wherever the live token is.

`openclaw-plugin/polkadot/README.md` has per-setting notes.

## Other frameworks

Any framework that can run the poll loop above can drive a bot; the bridge
contract is the whole integration surface. The Hermes adapter (~150 lines of
Python) is a reasonable template.

## Direct engines

Without a framework, bot-core runs a headless coding-agent CLI itself — as an
autonomous agent, not a chat wrapper: the user's message is passed verbatim (no
injected persona), conversation continuity is the CLI's own native session
(`--resume`), and tools are on. Each engine is a small config in
`lib/runners.mjs` that turns a (prompt, model, resume) into argv and normalizes
the CLI's JSONL event stream; bot-core owns the shared spawn/stream loop.

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
- Tools are on by default (`BOT_AI_ALLOWED_TOOLS`, default `Bash,Read,Edit,Write`).
  `BOT_AI_SKIP_PERMISSIONS=1` grants full autonomy (all tools) — safe because a
  deployed engine runs inside its own container (see the safety model below).
- The agent works in a persistent non-secret workspace (`BOT_AI_WORKSPACE`,
  defaulting to a sibling of `BOT_STATE_DIR`) that survives restarts.
- `BOT_AI_CMD`/`BOT_AI_ARGS` wire in a custom CLI that speaks claude-shaped
  stream-json (`__PROMPT__` is replaced with the prompt).
- In-chat commands (direct engines only): /help, /reset (start a fresh session),
  /stop (cancel the current turn), /model [name|default], /ping. Handled by
  bot-core instantly. Bridge bots pass slash-commands through to the framework.
- No wall-clock timeout — a long build/test is legitimate. An idle-silence
  backstop (`BOT_AI_IDLE_TIMEOUT_MS`, default 10 min of zero output) kills a
  wedged turn and unblocks the peer; `/stop` is the user's cancel lever.
- `BOT_THINKING_AFTER_MS` (default 5000) and `BOT_THINKING_TEXT` control the
  live placeholder posted when a reply is slow (see docs/LIVE-REPLIES.md);
  setting the text empty disables it.
- `--greet` on `run`/`deploy` (env `BOT_GREET=1`, text via `BOT_GREET_TEXT`): the
  bot messages each allowlisted owner it has never talked to on startup — once
  ever per owner, never into an existing thread. Works for any brain, including
  bridge mode.
- Failed turns are logged with a cause: `BOT_AI_AUTH_REVOKED` means the CLI
  needs a re-login, `BOT_AI_FAILED` is transient, `BOT_AI_IDLE_TIMEOUT` means a
  wedged turn was killed by the idle backstop.

### Safety model for containerized agents

A deployed engine runs its tools autonomously, so the boundary is the
**container**, not a permission prompt. `pca deploy` runs the transport as root
only to own `/state` (the signing seed, session keys, and bridge token), then
spawns the agent as the non-root `node` user with only persistent `/workspace`
and `/home/node` access plus private per-turn attachment directories. The source
mount is read-only; the container uses an init reaper, no-new-privileges, and
process/memory/CPU ceilings. Provider API keys are not injected into the agent
process; authenticate the CLI once through its native OAuth login in `/home/node`.
An agent with tool access can still use its own provider credentials, so restrict
senders with `--owner`/`--allow` and use `--safe-tools` when full autonomy is not
appropriate. Sessions and the workspace persist across redeploys.

An AI brain spends quota, so `create` requires an allowlist or an explicit
`--public`.
