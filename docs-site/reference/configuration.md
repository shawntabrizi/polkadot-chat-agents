---
prev:
  text: "Agent frameworks"
  link: "/guide/harnesses"
---

# Configuration reference

Every bot is configured entirely through environment variables read by
`bot-core/index.mjs`. `pca create/run/deploy` generate the common ones for you;
this document is the full reference, plus annotated `bot.env` examples.

- **Local runs** (`pca run`): the CLI builds the environment from the bot's
  `~/.pca/bots/<name>/config.json` + `secret.json` and passes it to the process.
- **Deployments** (`pca deploy`): the CLI writes a `bot.env` file (mode 0600) next
  to the compose stack on the server; the container reads it via `env_file`.

`bot.env` holds `BOT_SEED_HEX` — the root seed from which every key derives.
**Whoever has that file is the bot.** It is mode 0600 and gitignored; never
commit or log it. The agent CLI a direct-engine bot spawns is deliberately
*not* given this file (see [DESIGN.md](/explanation/architecture) security model): its child
environment is a scrubbed allowlist with the seed and all secrets removed.

The authoritative, always-current list lives in the header comment at the top
of `bot-core/index.mjs`. This doc mirrors it; if they disagree, the code wins.

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

# agent sandboxing (direct engines)
BOT_AI_SKIP_PERMISSIONS=1       # full tool autonomy (the container IS the sandbox); see the engine-specific note below for the non-autonomous mode
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
BOT_AI_SKIP_PERMISSIONS=1
BOT_AI_MAX_CONCURRENT_TURNS=2
BOT_AI_MAX_QUEUED_TURNS=20

# Size durable files to the actual persistent /state volume.
BOT_FILE_MAX_BYTES=104857600
BOT_FILE_MAX_TOTAL_MB=2048
BOT_FILE_MAX_PEER_MB=1024
BOT_FILE_MAX_ENTRIES=4000
BOT_FILE_MAX_PEER_ENTRIES=2000
```

`BOT_AI_SKIP_PERMISSIONS=1` gives a direct agent full tool autonomy inside its
container. Use it only when every allowlisted sender is trusted with the bot's
workspace and services it can reach. For a production HOP configuration, pin
the download and upload nodes you trust, and provision its allowance through
the appropriate operator flow. The generated framework deployment exposes its
bridge only to the private Compose network; do not publish that port.

### Public bot: deliberately bounded

A public bot has `BOT_ALLOWED_PEERS` unset or empty. It must assume arbitrary
prompts, attachment floods, repeated requests, and attempts to spend model or
storage capacity. Give it one narrow task, a pinned low-cost model, and a
read-only or disposable workspace.

```sh
BOT_ALLOWED_PEERS=

# Public bots may expose only a small approved model set.
BOT_AI_MODEL=<pinned-low-cost-model>
BOT_AI_ALLOWED_MODELS=<pinned-low-cost-model>,<second-low-cost-model>
BOT_AI_SKIP_PERMISSIONS=0
# Claude honors this allowlist. Codex and OpenCode do not; use a disposable
# workspace or container and their own engine controls for those engines.
BOT_AI_ALLOWED_TOOLS=Read
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

Never mount a valuable host repository, credentials, a Docker socket, or a home
directory into a public bot. Use a dedicated VM or volume with disk quotas, a
low-privilege model account with spending limits, and firewall management ports.
Do not publish the authenticated bridge port. The deploy container and resource
limits help, but they cannot make a sensitive host mount or exposed bridge token
safe.

`BOT_AI_ALLOWED_TOOLS` is a Claude setting, not a general sandbox. With
`BOT_AI_SKIP_PERMISSIONS=0`, Codex uses its `workspace-write` sandbox and
OpenCode follows its own normal permission mode. Keep either one in a disposable
workspace or container when the bot is public.

---

## Reference

Defaults are what the code uses when the variable is unset. "gen" marks the
variables `pca deploy` writes into `bot.env` automatically.

### Identity & network

| Variable | Default | Purpose |
|---|---|---|
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
| `BOT_AI_ALLOWED_TOOLS` | `Bash,Read,Edit,Write` | Claude-only `--allowedTools` list when permissions are not skipped. Codex and OpenCode do not consume it. |
| `BOT_AI_SKIP_PERMISSIONS` | `0` | `1` = full tool autonomy (the container is the sandbox). With `0`, Claude uses its allowlist, Codex uses `workspace-write`, and OpenCode uses its normal CLI mode. **gen unless --safe-tools** |
| `BOT_AI_AGENT_UID` / `BOT_AI_AGENT_GID` | unset | Drop the spawned agent to this uid/gid so it can't read `/state` or the seed. **gen (deploy: 1000)** |
| `BOT_AI_IDLE_TIMEOUT_MS` | 600000 | Kill a turn that has emitted nothing for this long (wedge backstop). |
| `BOT_AI_MAX_MS` | 3600000 | Hard per-turn wall-clock cap. |
| `BOT_AI_MAX_CONCURRENT_TURNS` | 4 | Global cap on simultaneously-running agent turns. |
| `BOT_AI_MAX_QUEUED_TURNS` | 100 | Global cap on queued turns before backpressure. |
| `BOT_AI_MAX_OUTPUT_BYTES` | 1000000 | Cap on captured agent output per turn. |
| `BOT_AI_CMD` / `BOT_AI_ARGS` | unset | Escape hatch: a custom CLI speaking claude-shaped stream-json (`BOT_AI_ARGS` is a JSON array; `__PROMPT__` is substituted). |

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
| `BOT_LIVE_HEARTBEAT_MS` | 15000 | Elapsed-clock frame cadence. |
| `BOT_LIVE_ACK_TIMEOUT_MS` | 60000 | Give up gating edits on the peer's ACK after this. |
| `BOT_LIVE_FINAL_ACK_WAIT_MS` | 10000 | Wait for the placeholder ACK before finalizing. |
| `BOT_LIVE_PROGRESS` | `1` | `0` = placeholder and final only (no per-tool progress frames). |
| `BOT_LIVE_TTL_MS` | 600000 | A placeholder never finalized resolves to a timeout note. |
| `BOT_LIVE_TIMEOUT_TEXT` | auto | That timeout note's text. |
| `BOT_OUTBOUND_ACK_GRACE_MS` | 60000 | How long an un-ACKed statement holds the channel slot before a queued one takes over. |

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

The `/model` command's behavior comes from two variables, resolved in
`resolveModelPolicy` (`lib/commands.mjs`):

1. `BOT_AI_ALLOWED_MODELS` set (non-empty) → **restricted** to that list, regardless of anything else.
2. `BOT_AI_ALLOWED_MODELS=""` (explicitly empty) → **locked**.
3. Otherwise `BOT_AI_MODEL_SWITCHING=open` **and** the bot has a peer allowlist → **open** (any model).
4. Otherwise → **locked** (the default).

Rationale: an allowlisted bot only talks to trusted peers, so open switching is
safe if the operator opts in; a public bot must never allow unrestricted
switching (a stranger could select an expensive model on the owner's quota), so
`open` + public is refused at startup. Manage it with
`pca model <bot> allow a,b` or `pca model <bot> open`.
