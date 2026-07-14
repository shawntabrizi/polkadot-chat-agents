---
prev:
  text: "Agent frameworks"
  link: "/guide/harnesses"
---

# Configuration reference

Every bot is configured through environment variables. `pca create`, `pca run`,
and `pca deploy` generate the common ones for you; the selected transport (the
default Polkadot-app transport or T3ams) reads its matching settings. This
document is the full operator reference, plus annotated `bot.env` examples.

- **Local runs** (`pca run`): the CLI builds the environment from the bot's
  `~/.pca/bots/<name>/config.json` + `secret.json` and passes it to the process.
- **Deployments** (`pca deploy`): the CLI writes a `bot.env` file (mode 0600) next
  to the compose stack on the server; the container reads it via `env_file`.

`bot.env` holds `BOT_SEED_HEX` - the root seed from which every key derives.
**Whoever has that file is the bot.** It is mode 0600 and gitignored; never
commit or log it. The agent CLI a direct-engine bot spawns is deliberately
*not* given this file. Its child environment is a scrubbed allowlist with the
seed and all secrets removed; see [Private & public bots](/guide/access) for
the security model.

---

## Example: direct-engine bot (`claude` / `codex` / `opencode`)

As `pca deploy` generates it (container paths shown):

```sh
# bot.env — mode 0600, gitignored. Holds the signing seed = the identity.

# identity & network
BOT_SEED_HEX=0x2222…            # root mini-secret; wallet/chat/identifier keys derive from it (required)
BOT_ENDPOINT=wss://paseo-people-next-system-rpc.polkadot.io  # statement-store RPC node it polls & publishes to
BOT_USERNAME=codebot.61         # registered network username (display/search); cosmetic to the transport
BOT_ALLOWED_PEERS=40d4fd…,7015… # peer account hexes allowed to message it. EMPTY = public (anyone)

# brain
BOT_BRAIN=claude                # claude|codex|opencode (direct CLI) · bridge/hermes (external) · echo (test)

# state & workspace (paths inside the container)
BOT_STATE_DIR=/state            # session keys, dedup set, owed-reply journal, bot.pid, and saved peer files. Root-owned; survives restarts
BOT_AI_WORKSPACE=/workspace     # where the agent's tools run; persists across restarts (worktrees under .worktrees/)

# bridge (local HTTP control surface)
BOT_BRIDGE_PORT=8799            # port the bridge listens on
BOT_BRIDGE_TOKEN=Xk3…≥32chars   # shared secret; every bridge request must present it. MANDATORY (process exits without it)

# portable tool policy (direct engines)
BOT_AI_TOOL_CAPABILITIES=       # default: no tools; comma-separated read,write,bash
BOT_AI_TOOL_SCOPE=workspace     # workspace (default) | container
BOT_AI_TOOL_NETWORK=none        # none (default) | internet; internet requires bash
BOT_AI_AGENT_UID=1000           # spawned agent CLI is dropped to this uid — cannot read /state or the seed
BOT_AI_AGENT_GID=1000           # …and this gid (transport stays root solely to hold the seed)

# model policy
BOT_AI_MODEL=claude-sonnet-5    # (optional) pin the model passed to the CLI's own --model flag
BOT_AI_ALLOWED_MODELS=          # /model allowlist: empty = locked; "a,b" = only those switchable
BOT_AI_MODEL_SWITCHING=locked   # locked (default) | open. open = free /model switching; requires a peer allowlist
```

A direct-engine bot authenticates through its mounted OAuth home (`./home`) —
there is no provider key in `bot.env`. The agent CLI is spawned with a scrubbed
environment that strips every secret-shaped variable (including `*_API_KEY`), so
a direct engine cannot be given provider credentials through the environment;
log in the CLI once against the mounted home instead.

## Example: bridge bot (`hermes` / `openclaw`)

```sh
BOT_SEED_HEX=0x…
BOT_ENDPOINT=wss://paseo-people-next-system-rpc.polkadot.io
BOT_BRAIN=bridge                # hand each message to an external agent framework over the bridge
BOT_ALLOWED_PEERS=40d4fd…,7015…
BOT_USERNAME=hermesbot.01
BOT_STATE_DIR=/state
BOT_BRIDGE_PORT=8799
BOT_BRIDGE_TOKEN=…              # the harness container presents this to drive the bot
# T3ams only, optional: a distinct secret for framework-originated sends with
# no leased inbound turn (for example OpenClaw attached results).
BOT_BRIDGE_PROACTIVE_TOKEN=…
BOT_BRIDGE_HOST=0.0.0.0         # bind beyond loopback so the harness container can reach it (no host ports published)
```

No `BOT_AI_*`: a bridge bot's model, tools, and commands live in the harness.

---

## Deployment profiles

Choose the access model deliberately. Most personal and coding bots should be
private: anyone who can message a bot can spend model quota and direct its
tools. `pca create <name> --owner <address-or-username>` starts with that safer
model.

### Private bot: one or two trusted owners

Use an explicit allowlist and treat the bot like a remote development machine
shared only with those people. This is the practical profile when responsive
agents, workspace edits, model switching, and durable files matter more than
hostile-input resistance.

```sh
# One or two exact Polkadot account ids. Do not leave this empty.
BOT_ALLOWED_PEERS=<peer-hex-1>,<peer-hex-2>

# Trusted owners may select a model in chat. Do not also set
# BOT_AI_ALLOWED_MODELS: an empty value deliberately locks switching.
BOT_AI_MODEL_SWITCHING=open
BOT_AI_TOOL_CAPABILITIES=read,write
BOT_AI_TOOL_SCOPE=workspace
BOT_AI_TOOL_NETWORK=none
BOT_AI_MAX_CONCURRENT_TURNS=2
BOT_AI_MAX_QUEUED_TURNS=20

# Size durable files to the actual persistent /state volume.
BOT_FILE_MAX_BYTES=104857600
BOT_FILE_MAX_TOTAL_MB=2048
BOT_FILE_MAX_PEER_MB=1024
BOT_FILE_MAX_ENTRIES=4000
BOT_FILE_MAX_PEER_ENTRIES=2000
```

`BOT_AI_TOOL_CAPABILITIES=read,write` gives a direct agent the normal file
outcomes; `write` includes `read`. Add `bash` when the bot should run commands;
it includes both file capabilities.
Workspace scope is the default; container scope deliberately grants the
non-root agent account all of its container-visible files, including its OAuth
home. `BOT_AI_TOOL_NETWORK=internet` requires `bash`; the default is no tool
network. Every sender of a public bot can direct the policy the deployer chose.
For a production HOP configuration, pin the download and upload nodes you
trust, and provision its allowance through the appropriate operator flow. The
generated framework deployment exposes its bridge only to the private Compose
network; do not publish that port.

### Public bot: deliberately bounded

A public bot has `BOT_ALLOWED_PEERS` unset or empty. It must assume arbitrary
prompts, attachment floods, repeated requests, and attempts to spend model or
storage capacity. Give it one narrow task, a pinned low-cost model, and a
read-only or disposable workspace. Claude, Codex, and OpenCode use the same
portable direct-agent tool policy; this example leaves its conservative
no-tools default in place.

```sh
BOT_ALLOWED_PEERS=

# Public bots may expose only a small approved model set.
BOT_AI_MODEL=<pinned-low-cost-model>
BOT_AI_ALLOWED_MODELS=<pinned-low-cost-model>,<second-low-cost-model>
BOT_AI_TOOL_CAPABILITIES=
BOT_AI_TOOL_SCOPE=workspace
BOT_AI_TOOL_NETWORK=none
# This no-tools profile can answer text but cannot inspect staged file bytes.
# Enable work deliberately with --allowed-tools read,write plus a scope
# and tool-network choice appropriate to the bot.
BOT_AI_MAX_CONCURRENT_TURNS=2
BOT_AI_MAX_QUEUED_TURNS=20
BOT_AI_MAX_OUTPUT_BYTES=262144

# Bound durable and temporary attachment storage per sender and globally.
BOT_FILE_MAX_BYTES=10485760
BOT_FILE_MAX_TOTAL_MB=256
BOT_FILE_MAX_PEER_MB=25
BOT_FILE_MAX_ENTRIES=200
BOT_FILE_MAX_PEER_ENTRIES=20
BOT_MEDIA_MAX_BYTES=10485760
BOT_MEDIA_MAX_TOTAL_MB=128
BOT_MEDIA_MAX_CONCURRENT_DOWNLOADS=1
BOT_MEDIA_DOWNLOAD_QUEUE_CAP=20
BOT_MEDIA_MAX_INFLIGHT_BYTES=33554432

# Required before a production bot can download attachment bytes. Use only
# trusted HOP host suffixes.
BOT_HOP_ALLOWED_NODES=<trusted-hop-host>

# Keep outbound HOP file delivery disabled. Private Paseo's automatic grant
# intentionally does not apply to public bots.
# BOT_HOP_UPLOAD_NODE=
```

For a public **T3ams** direct engine, `2` active turns and `20` queued turns are
runtime defaults when those variables are unset; the explicit values above make
the intended budget visible in deployment configuration. Authenticated `GET /health`
also exposes `direct.queue` for this open direct profile, so an operator can see
active, queued, and configured capacity without exposing it to chat users.

Those HOP settings are for the default transport. A public T3ams bot instead
uses the `BOT_T3AMS_ATTACHMENT_*` and `BOT_T3AMS_MEDIA_*` bounds below, plus an
explicit MIME policy such as `image/*,application/pdf` when broad file support
is not intended. T3ams does not inherit `BOT_HOP_ALLOWED_NODES`; set
`BOT_T3AMS_BULLETIN_RPC=` explicitly empty for metadata-only behavior when the
bot should never fetch or return attachment bytes.

Never mount a valuable host repository, credentials, a Docker socket, or a home
directory into a public bot. Use a dedicated VM or volume with disk quotas, a
low-privilege model account with spending limits, and firewall management ports.
Do not publish the authenticated bridge port. The deploy container and resource
limits help, but they cannot make a sensitive host mount or exposed bridge token
safe.

The portable policy is not a claim that a mounted OAuth home is safe from an
agent. Workspace scope is the normal project boundary; container scope
deliberately exposes the non-root agent account's container-visible files.
Claude and Codex provide native workspace enforcement for their applicable
policies. OpenCode's Bash policy remains bounded by the container rather than
an OS filesystem sandbox. Use a bridge runtime when you need a separately
designed tool-and-credential boundary.

---

## Reference

Defaults are what the code uses when the variable is unset. "gen" marks the
variables `pca deploy` writes into `bot.env` automatically.

### Identity & network

| Variable | Default | Purpose |
|---|---|---|
| `BOT_TRANSPORT` | `polkadot-app` | `polkadot-app` or `t3ams`. Set by `pca create --transport …`; selects the matching runner. **gen** |
| `BOT_SEED_HEX` | — (required) | Root mini-secret; all keys derive from it. `FAUCET_CHAT_SERVICE_SECRET` is an accepted alias. **gen** |
| `BOT_ENDPOINT` | Paseo people-next wss | Statement-store RPC node to poll and publish to. **gen** |
| `BOT_USERNAME` | `""` | Registered network username (display/search only). `FAUCET_CHAT_SERVICE_USERNAME` alias. **gen** |
| `BOT_PEER_IDENTIFIER_KEYS` | `""` | `peerhex=keyhex,…` — pin identifier keys, skipping the on-chain lookup (tests / fixed fleets). |

### Access control

| Variable | Default | Purpose |
|---|---|---|
| `BOT_ALLOWED_PEERS` | `""` | Comma-separated peer account hexes allowed to message the bot. **Empty = public** (anyone). Enforced before a message reaches any brain. **gen** |

### Brain

| Variable | Default | Purpose |
|---|---|---|
| `BOT_BRAIN` | `bridge` | `claude`\|`codex`\|`opencode` (direct CLI), `bridge`/`hermes` (external harness), `echo` (test). **gen** |
| `BOT_ACK_TEXT` | "Connecting you to the agent…" (bridge/hermes) | First-contact acknowledgement text. |
| `BOT_GREET` | `0` | `1` = message allowlisted owners once on startup (proof of life). **gen when --greet** |
| `BOT_GREET_TEXT` | auto | Custom greeting text. |

### State & durability

| Variable | Default | Purpose |
|---|---|---|
| `BOT_STATE_DIR` | (deploy: `/state`) | Persistent state dir: `session-state.json` (session keys, dedup set, owed-reply journal), `bot.pid`. Losing it orphans open conversations. **gen** |
| `BOT_MAX_SESSIONS` | 1000 | Cap on retained peer sessions. |
| `BOT_MAX_PEER_DEVICES` | 32 | Cap on device channels per peer. |
| `BOT_SESSION_IDLE_MS` | 30 days | Idle TTL after which a session is evicted. |
| `BOT_MAX_OWED_REPLIES` | 2000 | Cap on the crash-durable owed-reply backlog. |
| `BOT_MAX_OWED_BYTES` | 16 MB | Byte cap on that backlog. |

### HTTP bridge (authenticated control surface)

| Variable | Default | Purpose |
|---|---|---|
| `BOT_BRIDGE_TOKEN` | — (required) | 32+ char shared secret; every request must present it (`Authorization: Bearer` or `x-bridge-token`). Process exits if unset/short. **gen** |
| `BOT_BRIDGE_PROACTIVE_TOKEN` | unset | T3ams bridge/Hermes only: optional, distinct 32+ char outbound capability. An otherwise authenticated unleased `POST /send`, `/react`, or `/typing` must present it in `x-bridge-proactive-token`; it does not replace `BOT_BRIDGE_TOKEN`. |
| `BOT_BRIDGE_PORT` | 8799 | Port the bridge listens on. **gen** |
| `BOT_BRIDGE_HOST` | `127.0.0.1` | Bind address. Deploy sets `0.0.0.0` for harness stacks (compose network only). **gen for bridge** |
| `BOT_BRIDGE_BODY_MAX_BYTES` | 1000000 | Max request body. |
| `BOT_BRIDGE_TEXT_MAX_BYTES` | 128000 | Max `/send` text length. |
| `BOT_BRIDGE_FILE_MAX_BYTES` | `BOT_FILE_MAX_BYTES` | Max raw body accepted by `PUT /files/<chat>/<path>`. |
| `BOT_BRIDGE_LEASE_MS` | 300000 | Inbound-delivery lease duration (at-least-once handoff). |
| `BOT_BRIDGE_WAITER_CAP` | 100 | Max concurrent long-poll waiters. |
| `BOT_BRIDGE_DELIVERY_BATCH_CAP` | 32 | Max messages leased per `/inbound`. |
| `BOT_INBOUND_CAP` | 1000 | Bridge inbound queue depth. |

### Direct engine — model & reasoning

| Variable | Default | Purpose |
|---|---|---|
| `BOT_AI_MODEL` | `""` | Pin the model passed to the CLI's own model flag (opencode: a `provider/model` slug). **gen when --model** |
| `BOT_AI_ALLOWED_MODELS` | `""` | `/model` allowlist. Empty = switching locked; `a,b` = only those. Always wins over `BOT_AI_MODEL_SWITCHING`. **gen (direct)** |
| `BOT_AI_MODEL_SWITCHING` | `locked` | `locked` \| `open`. `open` allows free `/model` switching but **requires a peer allowlist** (public bots must use an approved set instead; the process refuses `open` + public). **gen (direct)** |
| `BOT_AI_REASONING` | `""` | Default reasoning effort; per-engine levels (`/reasoning` overrides per peer). |

### Direct engine — tools, sandboxing & limits

| Variable | Default | Purpose |
|---|---|---|
| `BOT_AI_TOOL_CAPABILITIES` | `""` | Comma-separated portable direct-agent outcomes: `read`, `write`, `bash`. Empty disables tools; `write` includes `read`, and `bash` includes both. **gen (deploy)** |
| `BOT_AI_TOOL_SCOPE` | `workspace` | `workspace` scopes normal work to the selected project and current staged attachments; `container` deliberately grants the non-root agent account all of its container-visible files. **gen (deploy)** |
| `BOT_AI_TOOL_NETWORK` | `none` | `none` or `internet` for tool-process egress. `internet` requires `bash`; enforcement depends on the selected engine. **gen (deploy)** |
| `BOT_AI_AGENT_UID` / `BOT_AI_AGENT_GID` | unset | Drop the spawned agent to this uid/gid so it can't read `/state` or the seed. **gen (deploy: 1000)** |
| `BOT_AI_IDLE_TIMEOUT_MS` | 600000 | Kill a turn that has emitted nothing for this long (wedge backstop). |
| `BOT_AI_MAX_MS` | 3600000 | Hard per-turn wall-clock cap. |
| `BOT_AI_MAX_CONCURRENT_TURNS` | 4; public T3ams direct: 2 | Global cap on simultaneously-running agent turns. An explicit value always overrides the T3ams profile default. |
| `BOT_AI_MAX_QUEUED_TURNS` | 100; public T3ams direct: 20 | Global cap on queued turns before backpressure. An explicit value always overrides the T3ams profile default. |
| `BOT_AI_MAX_OUTPUT_BYTES` | 1000000 | Cap on captured agent output per turn. |
| `BOT_AI_CMD` / `BOT_AI_ARGS` | unset | Escape hatch: a custom CLI speaking claude-shaped stream-json (`BOT_AI_ARGS` is a JSON array; `__PROMPT__` is substituted). |

For Bash, deploy validates the engine-specific network combination: OpenCode
requires `--tool-network internet` because it has no network sandbox; Claude
requires it for container-scoped Bash but can use `none` for workspace-scoped
Bash; Codex can keep `none` in either scope. The deploy report names the
effective enforcement level.

### Direct engine — projects & workspace

| Variable | Default | Purpose |
|---|---|---|
| `BOT_AI_WORKSPACE` | `BOT_STATE_DIR`-adjacent (deploy: `/workspace`) | Non-secret directory the agent works in, separate from state. **gen (direct)** |
| `BOT_AI_PROJECTS` | unset | JSON `{alias: dir}`. `/project <alias>[@branch]` then picks the turn cwd; branches get isolated git worktrees under `BOT_AI_WORKSPACE/.worktrees`. Set via `pca project`. |
| `BOT_AI_WORKTREES_DIR` | `BOT_AI_WORKSPACE/.worktrees` | Override the worktree root. |

### Replies & live replies

| Variable | Default | Purpose |
|---|---|---|
| `BOT_REPLY_CHUNK_BYTES` | 4000 | Long answers are split into parts ≤ this many UTF-8 bytes (paragraph/code-fence aware). |
| `BOT_THINKING_TEXT` | "🤔 One moment — thinking…" | Placeholder text; empty disables it. |
| `BOT_THINKING_AFTER_MS` | 5000 | Post the placeholder if no reply within this delay. |
| `BOT_LIVE_EDIT_MIN_MS` / `BOT_LIVE_EDIT_MAX_MS` | 3000 / 15000 | Live-edit throttle (escalating). |
| `BOT_LIVE_HEARTBEAT_MS` | 5000 | Typing refresh and elapsed-clock frame cadence; stays below the T3ams client's 6-second typing expiry. |
| `BOT_LIVE_ACK_TIMEOUT_MS` | 60000 | Give up gating edits on the peer's ACK after this. |
| `BOT_LIVE_FINAL_ACK_WAIT_MS` | 10000 | Wait for the placeholder ACK before finalizing. |
| `BOT_LIVE_PROGRESS` | `1` | `0` = placeholder and final only (no per-tool progress frames). |
| `BOT_LIVE_TTL_MS` | 600000 | A placeholder never finalized resolves to a timeout note. |
| `BOT_LIVE_TIMEOUT_TEXT` | auto | That timeout note's text. |
| `BOT_OUTBOUND_ACK_GRACE_MS` | 60000 | How long an un-ACKed statement holds the channel slot before a queued one takes over. |

T3ams uses the same placeholder, progress, final-wait, timeout, and chunk
settings. Unlike the default transport, it has native typing, edit, and reaction
operations, so every placeholder, live edit, typing signal, and reaction is a
Statement Store publish. Keep `BOT_LIVE_EDIT_MIN_MS` conservative for the
available allowance and submit queue. `BOT_LIVE_ACK_TIMEOUT_MS` is not used by
the T3ams runner because its edit protocol does not use the default transport's
peer-ACK gate.

### Attachments (HOP)

| Variable | Default | Purpose |
|---|---|---|
| `BOT_HOP_ALLOWED_NODES` | `""` | Comma-separated trusted host suffixes. **Required for production downloads** (empty rejects all in prod). |
| `BOT_MEDIA_MAX_BYTES` | 32 MB | Max single attachment size. |
| `BOT_MEDIA_MAX_TOTAL_MB` | 512 | Media-store total cap. |
| `BOT_MEDIA_TTL_HOURS` | 48 | Downloaded-blob TTL. |
| `BOT_MEDIA_MAX_CONCURRENT_DOWNLOADS` | 2 | Concurrent HOP downloads. |
| `BOT_MEDIA_DOWNLOAD_QUEUE_CAP` | 100 | Download queue depth. |
| `BOT_MEDIA_MAX_INFLIGHT_BYTES` | max(2 x single-file cap + 4 MiB, 64 MiB) | Reserved in-memory budget across attachment downloads. |
| `BOT_HOP_TIMEOUT_MS` | 120000 | Per-download deadline. |
| `BOT_HOP_RPC_FRAME_MAX_BYTES` | 4.5 MB | Max HOP RPC frame. |
| `BOT_HOP_ALLOW_INSECURE` | `0` | Tests only: permit `ws://` and IP-literal hosts. |
| `BOT_HOP_UPLOAD_NODE` | `""` | Operator-pinned HOP endpoint for returning files. It must match `BOT_HOP_ALLOWED_NODES` in production and needs an active Bulletin allowance. |
| `BOT_HOP_UPLOAD_TIMEOUT_MS` | 120000 | Whole-upload deadline. |

### Durable files

`/file put <path>` saves exactly one same-message attachment in the sender's
private vault. `/file ls`, `/file info`, `/file rm`, and `/file get` use that
same peer namespace. The authenticated bridge can manage the same vault with
`GET/PUT/DELETE /files/<chat_id>[/<path>]`; `POST /send` accepts only its
`file_path`, never an arbitrary host path.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_FILE_MAX_BYTES` | 50 MB | Largest individual durable file. |
| `BOT_FILE_MAX_TOTAL_MB` | 1024 | Global durable-vault capacity. |
| `BOT_FILE_MAX_ENTRIES` | 2000 | Global durable-vault entry cap. |
| `BOT_FILE_MAX_PEER_MB` | min(256 MB, global cap), raised to the file cap if needed | Capacity available to one chat peer. |
| `BOT_FILE_MAX_PEER_ENTRIES` | min(500, global cap) | Entry cap for one chat peer. |

Outbound `/file get` and bridge `file_path` delivery use HOP with the derived
`//allowance//bulletin//chat` signer. The deployed `BOT_SEED_HEX` can derive and
use that account, but it cannot safely mint a production allowance: the
People-chain claim requires the original mnemonic-derived Bandersnatch person
proof. Keep that proof off the VPS. `/health` reports the allowance account and
whether an upload node is configured.

### Paseo testnet file delivery

For a private bot created with the named `--network paseo` profile (the default),
`pca` automatically writes the matching HOP settings:

```sh
BOT_HOP_UPLOAD_NODE=wss://paseo-hop-next-0.polkadot.io
BOT_HOP_ALLOWED_NODES=paseo-hop-next-0.polkadot.io,paseo-hop-next-1.polkadot.io
```

On a successful normal `pca create`, `pca register`, or non-dry-run `pca deploy`,
the local CLI asks the public Bulletin Paseo Next v2 testnet faucet to provision
the derived account. It leaves sufficient capacity alone, refreshes an allowance
near expiry, and requests a bounded allocation only when capacity is missing or
low. No Console visit is needed for normal onboarding, and the action never
sends the bot mnemonic or a production person proof to the faucet.

Use `pca storage <bot> status` to inspect the result. Run `grant` only if the
status says capacity is missing, low, or expired. Each attempt leaves a local
recovery guard if its transaction or follow-up status is uncertain. Wait for any
pending transaction, then run `status` and `pca storage <bot> recover`.
`recover --yes` clears only that guard after you know the old transaction cannot
finalize; it does not submit a faucet transaction, so run `grant` separately if
needed.

The [Bulletin Console Faucet](https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet)
is an operational fallback, not a normal onboarding step. Public bots and
arbitrary `wss://` endpoints are intentionally excluded from automatic
provisioning. Production allocation remains an explicit local operator flow.

### T3ams transport setup

Create a T3ams bot with `pca create <name> --transport t3ams`. The runner needs
the local T3ams BCTS SDK (`@t3ams/bcts`) in `bot-core/node_modules`; it is
deliberately loaded only by the T3ams runner, so ordinary bots do not need it.
For a local development run, `BOT_T3AMS_BCTS_MODULE` can point at an importable
ESM build instead. A remote deployment must package the SDK with `bot-core`, not
point at an arbitrary path on the deployer's machine.

Private T3ams bots require immutable, out-of-band signing-key pins for their
allowlisted people. The CLI records these through `--t3ams-peer-key`; do not
learn or rotate a private pin from a chat message or invitation.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_BCTS_MODULE` | `@t3ams/bcts` | SDK module to import. A custom path is for a local development run only. |
| `BOT_T3AMS_DISPLAY_NAME` | registered username | Name shown in T3ams. |
| `BOT_T3AMS_TRUSTED_SIGNING_KEYS` | `{}` | JSON map of allowlisted account IDs to verified tagged-CBOR signing public keys. Required for private first contact. |
| `BOT_T3AMS_AUTO_ACCEPT_WORKSPACES` | private: `1`; public: `0` | Whether valid workspace invitations are accepted automatically. Enable it for a public bot only after a capacity review. |

### T3ams media and file vault

T3ams has a separate encrypted Bulletin/HOP path. It does **not** inherit the
default transport's `BOT_HOP_ALLOWED_NODES`, `BOT_HOP_UPLOAD_NODE`, or
`BOT_MEDIA_*` settings. A T3ams attachment contains an encrypted `hop:`
capability, never a generic web URL; the transport keeps its claim ticket
private and exposes only an opaque bridge media handle.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_ATTACHMENT_MAX_BYTES` | 25 MiB | Per-attachment maximum. It may be narrowed but not raised above 25 MiB. |
| `BOT_T3AMS_ATTACHMENT_MAX_COUNT` | 8 | Maximum attachments accepted from one rich-text message. Set `0` to reject them; 16 is the hard cap. |
| `BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS` | `BOT_T3AMS_ATTACHMENT_MAX_COUNT` | Maximum top-level regular files a direct Claude/Codex/OpenCode turn may return through `PCA_OUTPUT_DIR`. Set `0` to disable generated-file delivery; 16 is the hard cap. |
| `BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` | min(64 MiB, count × attachment cap), at least one attachment cap | Cumulative byte budget for all generated files from one direct turn; 512 MiB is the hard cap. |
| `BOT_T3AMS_AGENT_OUTBOX_MAX_ENTRIES` | min(1024, max(16, `128 ×` artifact count)) | Global count cap for private generated-file snapshots waiting for upload. |
| `BOT_T3AMS_AGENT_OUTBOX_MAX_BYTES` | max(per-turn artifact cap, min(512 MiB, `8 ×` per-turn cap)) | Global byte cap for generated-file snapshots waiting for upload (up to 4 GiB). |
| `BOT_T3AMS_REPLY_OUTBOX_MAX_ENTRIES` | 128 | Global cap for incomplete durable direct-agent final replies. |
| `BOT_T3AMS_REPLY_OUTBOX_MAX_BYTES` | max(one reply, min(128 MiB, `32 ×` one reply)) | Global serialized-byte cap for incomplete durable direct-agent final replies (up to 4 GiB). |
| `BOT_T3AMS_ATTACHMENT_MAX_DURATION_MS` | 604800000 (7 days) | Maximum declared audio/video duration accepted as attachment metadata. Set `0` to permit only a zero duration; 31 days is the hard cap. |
| `BOT_T3AMS_ATTACHMENT_MIME_TYPES` | `*/*` | Comma-separated admission policy. Exact MIME types (for example `image/png`) and `type/*` patterns (for example `image/*`) narrow the broad default. |
| `BOT_T3AMS_BULLETIN_RPC` | `wss://paseo-bulletin-next-rpc.polkadot.io` | Trusted T3ams Bulletin RPC for encrypted downloads and uploads. Set explicitly empty for metadata-only mode. |
| `BOT_T3AMS_HOP_ALLOW_INSECURE` | `0` | `1` permits insecure `ws://` only for a local test mock. |
| `BOT_T3AMS_HOP_TIMEOUT_MS` | 120000 | Whole encrypted download/upload deadline. |
| `BOT_T3AMS_HOP_RPC_FRAME_MAX_BYTES` | 4.5 MB | Largest accepted Bulletin/HOP RPC frame. |
| `BOT_T3AMS_MEDIA_TTL_HOURS` | 48 | TTL of the private downloaded-media cache. |
| `BOT_T3AMS_MEDIA_MAX_TOTAL_MB` | 512 | Total media-cache capacity. |
| `BOT_T3AMS_MEDIA_MAX_CONCURRENT_DOWNLOADS` | 2 | Maximum concurrent encrypted downloads. |
| `BOT_T3AMS_MEDIA_MAX_INFLIGHT_BYTES` | max(64 MiB, `2 × attachment cap + 4 MiB`) | Reservation for active download/decrypt work. It cannot be below one allowed attachment's requirement. |
| `BOT_T3AMS_MEDIA_DOWNLOAD_QUEUE_CAP` | 100 | Queued attachment-download limit. |
| `BOT_T3AMS_BRIDGE_MEDIA_REF_CAP` | bounded from inbound capacity | Maximum process-local opaque media handles exposed to the bridge. |
| `BOT_T3AMS_BRIDGE_MEDIA_REF_TTL_MS` | 3600000 | Lifetime of an opaque bridge media handle; fetching it renews its short TTL. |
| `BOT_BRIDGE_FILE_MAX_BYTES` | `BOT_FILE_MAX_BYTES` | Maximum raw `PUT /files` bridge upload. For T3ams it cannot exceed the durable-file and attachment caps. |

### Optional isolated photo and document analysis

Attachment retrieval and attachment understanding are deliberately separate.
Without a `read` capability, a direct bot receives metadata only and must not
claim it read a staged photo or document. That remains the no-tools default for
a bot with an OAuth home.

`pca deploy <bot> --media-analyzer` is available for a T3ams direct engine. It
adds a separate API-only `media-analyzer` container. The transport passes it
only bounded, HOP-verified bytes and receives a bounded summary, which is
marked as **untrusted attachment-derived data** in the brain prompt. The worker
does not mount the bot seed, `/state`, `/workspace`, OAuth home, bridge token,
or a host port; it is the only container with the provider API key.

Enabling analysis sends supported attachment bytes and the accompanying user
request to the configured Anthropic API. Do not turn it on for content that
must stay entirely on the VPS. Supported semantic inputs are JPEG/PNG/GIF/WebP
images, PDFs, UTF-8 plain text/Markdown/CSV/TSV/XML/RTF/JSON/NDJSON, and common
Office XML files (`.docx`, `.xlsx`, `.pptx`). Office files go through a bounded
ZIP/XML text projection, never a shell or desktop converter. Audio/video,
legacy Office binaries, archives, and arbitrary binary files still transfer as
normal downloadable T3ams attachments but remain metadata-only to the brain.
Plain-text and Office projections are capped at 256 KiB before the provider
call even when the encrypted attachment itself is within the larger file limit.
Images above 40 megapixels, encrypted PDFs, and PDFs with more than 50 visible
page markers are metadata-only too.

| Transport variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_MEDIA_ANALYZER_URL` | unset | Exact worker endpoint, normally `http://media-analyzer:8798/v1/analyze`. Set together with the token; both empty disables analysis. |
| `BOT_T3AMS_MEDIA_ANALYZER_TOKEN` | unset | 32+ character worker capability. `pca deploy --media-analyzer` generates it and writes it to `bot.env`; never pass it to an agent. |
| `BOT_T3AMS_MEDIA_ANALYZER_HTTP_HOSTS` | `media-analyzer` | Comma-separated hosts permitted for an `http:` worker URL. Use HTTPS for a non-internal endpoint. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_FILES` | 4 | Maximum semantic-analysis files per message (1–8). |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_FILE_BYTES` | 7 MiB | Per-file semantic-analysis cap (up to 12 MiB). Larger attachments remain downloadable but are not copied to the worker. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_TOTAL_BYTES` | 12 MiB | Cumulative semantic-analysis cap (at least the per-file cap; up to 16 MiB). |
| `BOT_T3AMS_MEDIA_ANALYZER_TIMEOUT_MS` | 90000 | Worker wait (1 s–10 min). Failure falls back to metadata-only rather than failing the chat turn. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_PROMPT_BYTES` | 12288 | User request bytes copied to the worker. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_SUMMARY_BYTES` | 6144 | Maximum worker summary bytes copied to the brain. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_CONCURRENT` | 1 | Maximum in-flight provider analyses before the direct-agent queue (1–8). |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_QUEUED` | 20 | Bounded waiting analyses (0–1000); a full queue falls back to metadata-only. |
| `BOT_T3AMS_MEDIA_ANALYZER_SENDER_CAP` | 4 | Durable analyses available to one authenticated sender in its refill window. |
| `BOT_T3AMS_MEDIA_ANALYZER_SENDER_WINDOW_MS` | 3600000 | Sender-token refill window (1 s–31 days). |
| `BOT_T3AMS_MEDIA_ANALYZER_GLOBAL_CAP` | 30 | Durable analyses available to the bot in its refill window. |
| `BOT_T3AMS_MEDIA_ANALYZER_GLOBAL_WINDOW_MS` | 3600000 | Global-token refill window (1 s–31 days). |
| `BOT_T3AMS_MEDIA_ANALYZER_SENDER_BUCKET_CAP` | 1000 | Maximum remembered sender buckets; least-recent/stale buckets are evicted. |

Before a supported attachment leaves the transport, the bot durably records a
rate reservation and a `submitted` marker. `/stop`, edits, and deletes abort
the worker request. If a process dies after submission but before the result is
saved, a recovery attempt stays metadata-only rather than uploading that
attachment a second time.

`deploy` creates a separate `media-token.env` with the worker capability. It
never creates, reads, prints, uploads, or overwrites the VPS's `media.env`.
Before the first deployment, create that mode-`0600` file in the remote bot
directory with the provider key and an API model name:

```sh
# On the VPS, make the remote bot directory private, then use an editor or
# secret manager to create its media.env. Keep the provider key out of CI.
install -d -m 700 <remote bot directory>
# <remote bot directory>/media.env — pca never reads it
ANTHROPIC_API_KEY=...
MEDIA_ANALYZER_MODEL=<an available Anthropic API model>
chmod 600 <remote bot directory>/media.env
```

The worker accepts matching `MEDIA_ANALYZER_MAX_*` limits plus
`MEDIA_ANALYZER_MAX_TOKENS` and `MEDIA_ANALYZER_TIMEOUT_MS`; keep them no larger
than the transport limits. Its container needs outbound HTTPS for the provider.
Use a host firewall or egress proxy if that must be narrowed to a specific
provider endpoint.

The same `BOT_FILE_MAX_BYTES`, `BOT_FILE_MAX_TOTAL_MB`, `BOT_FILE_MAX_ENTRIES`,
`BOT_FILE_MAX_PEER_MB`, and `BOT_FILE_MAX_PEER_ENTRIES` settings bound the
T3ams conversation vault. A T3ams DM and channel have separate vaults; one
channel's members intentionally share that channel vault. `/file put` requires
one successfully retrieved attachment. For T3ams, `BOT_FILE_MAX_BYTES` defaults
to the attachment limit and cannot exceed it. `/file get` and bridge `file_path`
delivery upload a fresh encrypted attachment; they never accept an arbitrary
host path.

For a direct brain, bot-core creates a fresh private `PCA_OUTPUT_DIR` for a
turn only when generated-file delivery is enabled. The agent may write bounded,
top-level regular files there; bot-core uploads them as new native T3ams
attachments and removes the directory after handoff. Nested files and symlinks
are ignored, and generated files must satisfy the same attachment size and MIME
policy as any other outbound file. Before any upload or final-answer statement,
bot-core persists the generated-file snapshot and every final-reply chunk in a
private durable turn outbox. A normal delivery retry drains that exact turn
rather than regenerating an image, document, or answer; it also reuses a
persisted Bulletin reference after upload. If Bulletin upload, attachment count,
or generic-file MIME delivery is disabled, `PCA_OUTPUT_DIR` is withheld so text
replies cannot be trapped behind an undeliverable artifact.

Bulletin upload and Statement Store submission do not provide a transactional
cross-service idempotency key. A process loss after a remote statement succeeds
but before local journal progress is flushed can therefore yield one
at-least-once duplicate on recovery; ordinary delivery retries drain the
durable completed turn without rerunning the model.

Bulletin capacity is separate from the Statement Store allowance that pays for
text, live edits, typing, and reactions. Before enabling outbound T3ams files,
provision and monitor the T3ams Bulletin upload allowance independently. The
default transport's `pca storage`/Paseo faucet flow does not preflight or grant
that T3ams allowance.

In T3ams bridge/Hermes mode, regular outbound `/send`, `/react`, and `/typing`
requests remain bound to their active inbound `delivery_id` and `lease_id`.
`BOT_BRIDGE_PROACTIVE_TOKEN` is a separate opt-in for a framework action that
has no inbound lease at all (such as a generic attached result). It must be a
different random secret, is required in the `x-bridge-proactive-token` header
in addition to normal bridge authentication, and never makes a stale supplied
lease valid. Leave it unset unless that explicit proactive behavior is needed.

### T3ams channels and direct-brain sessions

T3ams channels remain mention-gated: ordinary unmentioned traffic does not
start a model turn. These settings can make a later explicit mention more useful
without turning the bot into an always-on listener.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_CHANNEL_CONTEXT` | `0` | `1` retains a bounded, in-memory snapshot of earlier authenticated channel text for a later explicit mention. It is never a standalone prompt. |
| `BOT_T3AMS_CHANNEL_CONTEXT_TTL_MS` | 1800000 | Context retention time. `0` expires a record immediately. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_CHATS` | 128 | Channel conversations retained in memory. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORDS` / `MAX_BYTES` | 16 / 8192 | Per-channel record and text budgets. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORD_BYTES` | 2048 | Largest retained message. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORDS_PER_SENDER` / `MAX_BYTES_PER_SENDER` | 4 / 2048 | Fairness limits for one sender. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_TOTAL_BYTES` | 262144 | Process-wide passive-context memory budget. |
| `BOT_T3AMS_CHANNEL_CONTROL_ROLE` | `admin` | Minimum role for direct-brain channel/thread session commands: `admin` allows owners/admins, `mod` includes moderators, `all` allows any authenticated channel member. |

Top-level prompts share the channel session; a reply thread has its own native
session. Normal mentioned prompts and `/stop` remain usable by channel members;
`/stop` targets the current thread/conversation. The role gate applies only to
direct-brain session-changing commands such as `/reset`, `/model`, `/reasoning`,
and `/project`; it does not control a bridge framework's own command vocabulary.

### T3ams message-operation reconciliation

Edits and deletes are authenticated on T3ams's separate operation slots. The
bot keeps a bounded persisted index so a retained edit or deletion can arrive before
the message carrier: an edit updates not-yet-dispatched work and channel
context, while a deletion removes queued work and stops an in-flight direct
turn. It cannot retract a response that was already published before the bot
received the operation. Reactions and typing are not model prompts.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_MESSAGE_LIFECYCLE_MAX_RECORDS` | max(1024, `4 × BOT_INBOUND_CAP`) | Bound for recently seen message/edit/delete state. |
| `BOT_T3AMS_MESSAGE_LIFECYCLE_TTL_MS` | 21600000 (6 hours) | Retention for that reconciliation state; `0` expires it immediately. |
| `BOT_T3AMS_MESSAGE_LIFECYCLE_MAX_BYTES` | 8 MiB | Aggregate persisted lifecycle-state budget; oldest records are evicted before it grows beyond this limit. |
| `BOT_T3AMS_SUBSCRIPTION_CAP` | 1024 | Maximum active T3ams subscriptions. A known DM needs both its carrier and edit/delete operation route. |

### Ingress (poll / subscribe)

| Variable | Default | Purpose |
|---|---|---|
| `BOT_SUBSCRIBE` | `1` | `0` = poll-only (disable subscription ingress). |
| `BOT_POLL_MS` | 2000 | Poll cadence when subscription is unhealthy/disabled. |
| `BOT_SWEEP_MS` | 30000 | Reconciliation sweep cadence while subscription is healthy. |
| `BOT_HEARTBEAT_MS` | 30000 | Subscription liveness heartbeat interval. |
| `BOT_QUERY_TIMEOUT_MS` | 15000 | Deadline for every chain query/submit. |
| `BOT_REQUEST_LOOKBACK_DAYS` / `BOT_REQUEST_FUTURE_DAYS` | 7 / 2 | Opener request-topic day window. |
| `BOT_TOPIC_BATCH` | 16 | Topics per `matchAny` query batch. |
| `BOT_DISPATCH_CONCURRENCY` | 4 | Global keyed-dispatcher worker budget. |
| `BOT_DISPATCH_QUEUE_CAP` | 1000 | Dispatcher queue depth. |
| `BOT_DISPATCH_INPUT_CAP` | `BOT_DISPATCH_QUEUE_CAP` | Maximum statements accepted from one ingress batch before excess are deferred for resend/sweep. |
| `BOT_WORK_CAP` | 20 | Per-peer in-flight work cap (backpressure). |

---

## Model-switching policy, resolved

The `/model` command's behavior comes from two variables:

1. `BOT_AI_ALLOWED_MODELS` set (non-empty) → **restricted** to that list, regardless of anything else.
2. `BOT_AI_ALLOWED_MODELS=""` (explicitly empty) → **locked**.
3. Otherwise `BOT_AI_MODEL_SWITCHING=open` **and** the bot has a peer allowlist → **open** (any model).
4. Otherwise → **locked** (the default).

Rationale: an allowlisted bot only talks to trusted peers, so open switching is
safe if the operator opts in; a public bot must never allow unrestricted
switching (a stranger could select an expensive model on the owner's quota), so
`open` + public is refused at startup. Manage it with
`pca model <bot> allow a,b` or `pca model <bot> open`.
