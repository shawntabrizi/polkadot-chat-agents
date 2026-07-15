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

## The bridge contract

A framework plugin needs this small authenticated API:

| Route | Purpose |
|---|---|
| `GET /health` | returns `{ ok, account, identifierKey, username }` |
| `GET /inbound?wait=<secs>&limit=<n>` | long-poll; returns at most the requested bounded batch of leased `[{ delivery_id, lease_id, lease_ms, chat_id, text, message_id }, ...]`, or an empty array on timeout. `chat_id` is transport-specific (a peer account-id hex for the default transport; T3ams is described below). `text` is always non-empty (a placeholder like `[photo, image/jpeg, 245 KB]` is synthesized for caption-less attachments). Items may carry `kind` (`richText`/`reply`/`edited`), `reply_to`, `edit_of`, and `attachments: [{ id, kind, mime, size, width?, height?, duration_ms?, peaks?, media_id?, downloaded, url?, error? }]`. Add `&events=1` to also receive non-message signals (`kind`: `reaction`, `coinageSend`, `leftChat`, `contactAdded`) — opt-in, so a harness that ignores them never chat-replies to a reaction. |
| `POST /inbound/ack { delivery_id, lease_id }` | permanently acknowledges a leased inbound row after the framework has successfully handed it to its own runtime. Accepts `deliveries: [{ delivery_id, lease_id }, ...]` for a batch. Unacknowledged rows are retried after their lease expires; a stale claim acknowledges zero rows. |
| `POST /inbound/renew { delivery_id, lease_id }` | extends an active lease for a long-running turn. Renew before `lease_ms` elapses, then ACK only the current lease. |
| `GET /media/<id>` | bytes of a downloaded attachment (`url` from the inbound item), served with its content type; T3ams uses its opaque `media_id` rather than the attachment metadata id. |
| `GET /files/<chat_id>`; `GET/PUT/DELETE /files/<chat_id>/<path>` | list, read, write raw bytes, or remove a durable file in that peer's vault. `PUT` uses the request content type and obeys the bot's per-file, per-peer, and global caps. |
| `POST /send { chat_id, text?, file_path?, reply_to?, edit_of? }` | publishes a reply to that peer; returns `{ success, message_id }`. `message_id` is the outgoing message's id — hold on to it to edit that message later. `reply_to: <message_id>` renders as a quote of that peer message in the app; `edit_of: <message_id>` rewrites a message the bot sent earlier (the app updates the bubble in place). The two are mutually exclusive. `file_path` names a file already saved in that exact peer's vault; delivery requires the transport's configured HOP/Bulletin upload path. The default Polkadot-app transport does not combine a file with a reply or edit; T3ams permits a caption and reply target but never an edit (details below). **Live replies:** when a turn runs long, bot-core posts a "thinking…" placeholder; the first plain send for that peer is auto-upgraded into the placeholder's final edit (the returned `message_id` is the placeholder's), so the user sees one evolving bubble instead of thinking + answer. `edit_of` sends are throttled and coalesced server-side (latest-wins) to a statement-store-safe cadence — a harness may stream edits as fast as it likes. `GET /health` advertises this under `live: { supportsEdit, minEditMs, placeholderAfterMs }`. |
| `POST /react { chat_id, message_id, emoji, remove? }` | reacts to a peer message with an emoji (shown as a chip under the bubble in the app); `remove: true` retracts a previous reaction. Returns `{ success }`. |
| `POST /typing { chat_id }` | best-effort transport signal; T3ams publishes it, while transports without a typing operation may no-op. |

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

### T3ams transport fields

`BOT_TRANSPORT=t3ams` keeps the same leased-array bridge API. Its text
deliveries use `chat_id` values beginning with `t3ams:` and add
`conversation_type`, `sender_xid`, `sender_name`, and, for workspace traffic,
`workspace_id` and `channel_id`. A threaded input also carries
`thread_root_id`. Preserve that value on `POST /send` so the reply stays in the
same T3ams thread (or send `reply_to` with the inbound `message_id`).

The supported T3ams surface is DMs and workspace channels, including threads,
live replies, media, and files. Native ad-hoc T3ams groups are not supported
yet.

T3ams supports live bridge operations. `POST /send` accepts plain text,
`thread_root_id`, `reply_to`/`reply_to_message_id`, or `edit_of`; a reply and
edit are mutually exclusive. An edit must name a message issued by the current
bot process, and bot-core coalesces rapid edit frames to the advertised live
cadence. `POST /react` publishes or removes an emoji reaction, and
`POST /typing` publishes a best-effort typing signal. `GET /health` includes
`live: { supportsEdit, supportsTyping, supportsReaction, minEditMs,
placeholderAfterMs }`. A leased T3ams turn can acquire a thinking placeholder;
the first ordinary send finalizes it, while the lease ACK flushes a coalesced
streaming edit. In `BOT_BRAIN=bridge` mode, every outbound
`POST /send`, `POST /react`, and `POST /typing` for that turn must also carry
its `delivery_id` and `lease_id`. An edit/delete revokes the old claim, so an
already-running stale worker cannot answer or publish stale live activity for
the superseded prompt.

For an explicit framework-originated action with no inbound turn (such as an
OpenClaw attached result), configure a distinct `BOT_BRIDGE_PROACTIVE_TOKEN`.
The request still requires normal bridge authentication and must also carry the
secret in `x-bridge-proactive-token`. It permits only an entirely unleased
`/send`, `/react`, or `/typing`; a request that supplies a lease still has to
match an active lease. Leave this optional capability unset when it is not
needed.

T3ams rich-text inbound rows may include `attachments` with only safe metadata
(`id`, `kind`, `mime`, `size`, `filename`, and optional dimensions), plus an
`attachment_error` when a reference could not be accepted. They intentionally
never include a Bulletin claim ticket or raw `hop:` reference. When T3ams
Bulletin retrieval is enabled, an attachment also gets an opaque `media_id`,
`url: /media/<media_id>`, and a best-effort `downloaded` flag. Fetch that URL,
not the attachment's metadata `id`: the opaque id is process-local, bounded,
and expires according to `BOT_T3AMS_BRIDGE_MEDIA_REF_TTL_MS`. It is the only
bridge handle that can retrieve attachment bytes.

`GET /media/<media_id>` downloads from the configured Bulletin endpoint into
the private cache when needed and streams the authenticated bytes. The bridge
also supports `GET/PUT/DELETE /files/<url-encoded-chat_id>[/<path>]`; every
T3ams DM or channel gets a separate opaque vault namespace. `POST /send` with
that chat's `file_path` uploads it as an encrypted BCTS attachment; it may have
a text caption and `reply_to`, but cannot use `edit_of`. A disabled Bulletin
endpoint or missing upload allowance makes byte retrieval/delivery fail rather
than leaking a capability or falling back to an arbitrary URL.

When optional channel context is enabled, a T3ams channel delivery can also
include `channel_context`, a bounded snapshot of earlier authenticated
unmentioned text in the same channel/thread. It is context, not independent
work: do not issue replies for its rows. Treat the bridge token as authority to
send, edit, react, type, read media, and access every vault; keep it inside the
private harness network.
See [T3AMS.md](T3AMS.md#attachments-bulletin-media-and-files) for the
transport-specific media and file-vault configuration.

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
- Direct agents start with no tools. For Claude, Codex, or OpenCode, a deployer
  selects portable lowercase capabilities with `--allowed-tools read,write,bash`,
  then chooses `--tool-scope workspace|container` and
  `--tool-network none|internet`. `write` includes `read`, and `bash` includes
  both. The generated environment records those choices as
  `BOT_AI_TOOL_CAPABILITIES`, `BOT_AI_TOOL_SCOPE`, and
  `BOT_AI_TOOL_NETWORK`. A direct agent with `read` can inspect its current
  turn's staged attachment; one with `write` can produce returnable files.
  For `bash`, OpenCode requires `--tool-network internet`; Claude requires it
  for container scope but can use `none` for workspace scope; Codex can keep
  `none` in either scope. Deploy validates the combination and reports the
  engine's enforcement level.
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
  live placeholder posted when a reply is slow;
  setting the text empty disables it.
- `--greet` on `run`/`deploy` (env `BOT_GREET=1`, text via `BOT_GREET_TEXT`): the
  bot messages each allowlisted owner it has never talked to on startup — once
  ever per owner, never into an existing thread. Works for any brain, including
  bridge mode.
- Failed turns are logged with a cause: `BOT_AI_AUTH_REVOKED` means the CLI
  needs a re-login, `BOT_AI_FAILED` is transient, `BOT_AI_IDLE_TIMEOUT` means a
  wedged turn was killed by the idle backstop.

### Safety model for containerized agents

`pca deploy` runs the transport as root only to own `/state` (the signing seed,
session keys, and bridge token), then spawns the agent as the non-root `node`
user with persistent `/workspace` and `/home/node` access. The source mount is
read-only; the container uses an init reaper, no-new-privileges, and
process/memory/CPU ceilings. The CLI retains `/home/node` to authenticate and
refresh its own OAuth session, while tool actions use the configured
engine-specific policy. With Claude workspace scope, native permission rules
limit file tools; workspace Bash also runs under a Bubblewrap allow/deny
filesystem policy that hides `/home/node`, `/state`, and `/app`. Container
scope intentionally grants selected tools the non-root account's
container-visible files, including its OAuth home. Codex and OpenCode have the
enforcement reported at deploy time; OpenCode Bash remains bounded by the
container rather than an OS filesystem sandbox. Direct deployments therefore
start with no tools, and the deployer deliberately selects any policy for a
public or allowlisted bot. Sessions and the workspace persist across redeploys.

An AI brain spends quota, so `create` requires an allowlist or an explicit
`--public`.
