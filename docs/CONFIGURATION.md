# Configuration reference

Every bot is configured entirely through environment variables read by its
transport entry point: `bot-core/index.mjs` for `polkadot-app` or
`bot-core/t3ams.mjs` for `t3ams`. `pca create/run/deploy` generate the common
ones for you; this document is the full reference, plus annotated `bot.env`
examples.

- **Local runs** (`pca run`): the CLI builds the environment from the bot's
  `~/.pca/bots/<name>/config.json` + `secret.json` and passes it to the process.
- **Deployments** (`pca deploy`): the CLI writes a `bot.env` file (mode 0600) next
  to the compose stack on the server; the container reads it via `env_file`.

`bot.env` holds `BOT_SEED_HEX` — the root seed from which every key derives.
**Whoever has that file is the bot.** It is mode 0600 and gitignored; never
commit or log it. The agent CLI a direct-engine bot spawns is deliberately
*not* given this file (see [DESIGN.md](DESIGN.md) security model): its child
environment is a scrubbed allowlist with the seed and all secrets removed.

The authoritative, always-current lists live in the runtime source. This doc
mirrors them; if it and the code disagree, the code wins.

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
BOT_STATE_DIR=/state            # session keys, dedup set, owed-reply journal, bot.pid. Root-owned; survives restarts
BOT_AI_WORKSPACE=/workspace     # where the agent's tools run; persists across restarts (worktrees under .worktrees/)

# bridge (local HTTP control surface)
BOT_BRIDGE_PORT=8799            # port the bridge listens on
BOT_BRIDGE_TOKEN=Xk3…≥32chars   # shared secret; every bridge request must present it. MANDATORY (process exits without it)

# agent sandboxing (direct engines)
BOT_AI_SKIP_PERMISSIONS=1       # full tool autonomy (the container IS the sandbox); omit for a read/write/edit/bash allowlist
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

Choose the access model deliberately. Most coding and personal-assistant bots
should be private: the person who can message the bot can cause model spend and
direct an agent's tools. `pca create <name> --owner <address-or-username>`
creates that safer starting point.

### Private bot: one or two trusted owners

Use an explicit allowlist and treat the bot like a remote development machine
shared only with those people. This is the recommended profile when responsive
agent behavior, workspace edits, model switching, and durable files matter more
than hostile-input resistance.

```sh
# One or two exact Polkadot account ids. Never leave this empty for this profile.
BOT_ALLOWED_PEERS=40d4fd...,7015aa...

# Let trusted owners select the model in chat. Do not set BOT_AI_ALLOWED_MODELS
# at the same time: an empty value is an intentional lock.
BOT_AI_MODEL_SWITCHING=open
BOT_AI_SKIP_PERMISSIONS=1
BOT_AI_MAX_CONCURRENT_TURNS=2
BOT_AI_MAX_QUEUED_TURNS=20

# Durable files for a small, trusted group. Size these to the actual /state volume.
BOT_FILE_MAX_BYTES=104857600
BOT_FILE_MAX_TOTAL_MB=2048
BOT_FILE_MAX_PEER_MB=1024
BOT_FILE_MAX_ENTRIES=4000
BOT_FILE_MAX_PEER_ENTRIES=2000

# Required for production attachment download. File delivery additionally needs
# an active Bulletin allowance for the derived account shown by /health.
BOT_HOP_ALLOWED_NODES=hop.example.org
BOT_HOP_UPLOAD_NODE=wss://hop.example.org
```

`BOT_AI_SKIP_PERMISSIONS=1` gives the direct agent full tool autonomy inside its
container. Use it only when every allowlisted sender is trusted with the bot's
workspace and its reachable services. Keep the bridge on loopback for a local
run; in a generated framework deployment, `BOT_BRIDGE_HOST=0.0.0.0` is only
reachable on the private Compose network and no bridge port is published.

### Public bot: deliberately bounded

A public bot has `BOT_ALLOWED_PEERS` unset or empty. It must assume arbitrary
prompts, attachment floods, repeated requests, and attempts to spend model or
storage allowance. Prefer a narrow task, a fixed model allowlist, and a
read-only or disposable workspace. The following is a usable conservative
baseline for a directly hosted public bot:

```sh
BOT_ALLOWED_PEERS=

# Public bots cannot use unrestricted /model switching. Pin one model and,
# if switching is needed, expose only a small approved list.
BOT_AI_MODEL=provider/model
BOT_AI_ALLOWED_MODELS=provider/model,provider/low-cost-model
BOT_AI_SKIP_PERMISSIONS=0
BOT_AI_ALLOWED_TOOLS=Read
BOT_AI_MAX_CONCURRENT_TURNS=2
BOT_AI_MAX_QUEUED_TURNS=20
BOT_AI_MAX_OUTPUT_BYTES=262144

# Bound durable and transient attachment storage per sender as well as globally.
BOT_FILE_MAX_BYTES=10485760
BOT_FILE_MAX_TOTAL_MB=256
BOT_FILE_MAX_PEER_MB=25
BOT_FILE_MAX_ENTRIES=200
BOT_FILE_MAX_PEER_ENTRIES=20
BOT_MEDIA_MAX_BYTES=10485760
BOT_MEDIA_MAX_TOTAL_MB=128
BOT_MEDIA_MAX_CONCURRENT_DOWNLOADS=1
BOT_MEDIA_DOWNLOAD_QUEUE_CAP=20

# Keep outbound HOP file delivery disabled. The automatic Paseo testnet grant
# intentionally excludes public bots; inbound /file put remains quota-bounded.
# BOT_HOP_UPLOAD_NODE=
```

For a public bot, do not mount a valuable host repository, credentials, Docker
socket, or home directory into the agent container. Run it under a separate
bot identity on a dedicated VM or volume with disk quotas; do not publish the
authenticated bridge port; firewall management ports; and use a separate
low-privilege model account with spending limits. `pca deploy` provides a
container boundary and CPU/memory/process limits, but it cannot make an
unbounded host-mounted workspace or a public bridge token safe.

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

For `BOT_TRANSPORT=t3ams`, `BOT_STATE_DIR` is also the private root for
`t3ams-state.json`, the encrypted-media cache, and the durable file vault.
The T3ams runner creates it with mode `0700`; do not share it with the agent
workspace or a host user, and encrypt or otherwise protect backups. A retained
T3ams ingress record can contain an attachment's Bulletin claim capability, so
the directory is sensitive even if no model session has been created.

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
| `BOT_AI_ALLOWED_TOOLS` | `Bash,Read,Edit,Write` | Tool allowlist used when permissions are not skipped. |
| `BOT_AI_SKIP_PERMISSIONS` | `0` | `1` = full tool autonomy (the container is the sandbox). **gen unless --safe-tools** |
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

T3ams uses the same thinking, edit cadence, progress, final-wait, timeout, and
chunk settings. Its protocol can safely apply an edit without the default
transport's peer-ACK gate, so `BOT_LIVE_ACK_TIMEOUT_MS` is not read by the
T3ams runner. Remember that every placeholder, live edit, typing signal, and
reaction is a publish operation: set `BOT_LIVE_EDIT_MIN_MS` conservatively for
the available Statement Store allowance and submit queue.

### Attachments (Polkadot-app HOP transport)

| Variable | Default | Purpose |
|---|---|---|
| `BOT_HOP_ALLOWED_NODES` | `""` | Comma-separated trusted host suffixes. **Required for production downloads** (empty rejects all in prod). |
| `BOT_MEDIA_MAX_BYTES` | 32 MB | Max single attachment size. |
| `BOT_MEDIA_MAX_TOTAL_MB` | 512 | Media-store total cap. |
| `BOT_MEDIA_TTL_HOURS` | 48 | Downloaded-blob TTL. |
| `BOT_MEDIA_MAX_CONCURRENT_DOWNLOADS` | 2 | Concurrent HOP downloads. |
| `BOT_MEDIA_DOWNLOAD_QUEUE_CAP` | 100 | Download queue depth. |
| `BOT_HOP_TIMEOUT_MS` | 120000 | Per-download deadline. |
| `BOT_HOP_RPC_FRAME_MAX_BYTES` | 4.5 MB | Max HOP RPC frame. |
| `BOT_HOP_ALLOW_INSECURE` | `0` | Tests only: permit `ws://` and IP-literal hosts. |
| `BOT_HOP_UPLOAD_NODE` | `""` | Operator-pinned HOP endpoint for outbound files. It must satisfy `BOT_HOP_ALLOWED_NODES` in production and needs an active Bulletin storage allowance. |
| `BOT_HOP_UPLOAD_TIMEOUT_MS` | 120000 | Whole-upload deadline. |

### Durable files (Polkadot-app HOP transport)

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

Outbound `/file get` and bridge `file_path` delivery use HOP `hop_submit` with
the derived `//allowance//bulletin//chat` signer. For production, the deployed
`BOT_SEED_HEX` can derive and use that account but cannot safely mint its
allowance: the People-chain claim requires the original mnemonic-derived
Bandersnatch person proof and a live `AsResources` transaction extension. Keep
that proof material off the VPS. `/health` reports the exact allowance account
and whether a HOP upload node is configured. `pca storage <bot> status` queries
the named Paseo testnet authorization. Normal private Paseo onboarding handles
that testnet allocation automatically; run `pca storage <bot> grant` only after
status says capacity is missing, expired, or low. If a prior faucet submission
was interrupted or uncertain, use `pca storage <bot> recover` after checking
status instead of retrying a grant. These are testnet-only local CLI commands,
not production provisioning commands.

### Paseo testnet file delivery

For a private bot created with the named `--network paseo` profile (the default),
`pca create` persists a matching HOP profile and shows the derived allowance
account. `pca run` and `pca deploy` emit these settings automatically:

```sh
BOT_HOP_UPLOAD_NODE=wss://paseo-hop-next-0.polkadot.io
BOT_HOP_ALLOWED_NODES=paseo-hop-next-0.polkadot.io,paseo-hop-next-1.polkadot.io
```

On a successful normal `pca create`, `pca register`, or non-dry-run `pca deploy`,
the local CLI asks the fixed public **Bulletin Paseo Next v2** testnet faucet to
provision that derived account. It preflights expiry and remaining capacity: a
sufficient authorization is left alone, an active authorization approaching
expiry is refreshed, and missing or low capacity receives a bounded test
allocation. Check it with `pca storage <bot> status`. `pca storage <bot> grant`
runs the same preflight when manual provisioning is actually needed. The derived
SS58 account shown by `pca info <bot>` is the target, not the bot's main chat
wallet.

This command is a local CLI action, not a bot-runtime action. It uses the
testnet's public faucet signer only for the fixed Paseo profile; it does not
send the bot mnemonic or a production person proof to the faucet. The faucet's
availability and quota remain testnet operator policy. No Console visit is
needed for the normal flow.

Each automatic or manual faucet attempt creates a local marker keyed to the
derived allowance account immediately before a transaction is submitted. A
confirmed result with a verified follow-up status removes it. A timeout,
transport failure, interrupted CLI, or failed follow-up status query leaves the
marker in place permanently, blocking another grant so an allocation with an
unknown effective state cannot consume a second finite allowance. Resolve that
state with the following sequence:

1. Wait for any pending transaction to finalize, then run `pca storage <bot> status`.
2. Run `pca storage <bot> recover`. When the on-chain allowance is sufficient,
   this read-first command clears the local guard without sending a transaction.
3. If the allowance is still insufficient, do not grant again until the prior
   transaction is known not to finalize. `pca storage <bot> recover --yes`
   clears only the local guard; it does not contact the faucet. Run `grant`
   separately, and only if the status still requires it.

The [Bulletin Console Faucet](https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet)
is an operational fallback for the fixed testnet profile, not a normal onboarding
step. After using it, check `status` and run `recover` if a local guard remains.
`pca` deliberately excludes public bots and arbitrary `wss://` endpoints: a
public sender must not be able to spend a finite upload allowance by default.

### T3ams attachments, media, and file vault

`BOT_TRANSPORT=t3ams` has a separate encrypted Bulletin/HOP data path. Its
settings deliberately do **not** inherit `BOT_HOP_ALLOWED_NODES`,
`BOT_MEDIA_*`, or `BOT_HOP_UPLOAD_NODE` from the default Polkadot-app
transport. The T3ams parser accepts only an encrypted `hop:` BCTS reference;
the claim ticket is never returned in a bridge item or logged.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_ATTACHMENT_MAX_BYTES` | 25 MiB | Per-attachment maximum. It may be narrowed but not raised above 25 MiB. |
| `BOT_T3AMS_ATTACHMENT_MAX_COUNT` | 4 | Maximum rich-text attachments per T3ams message (0–4). |
| `BOT_T3AMS_ATTACHMENT_MIME_TYPES` | built-in image/document list | Comma-separated allowlist. The default includes common image formats, PDF, text/structured text, Office documents, and `application/octet-stream`; narrow it for public bots. |
| `BOT_T3AMS_BULLETIN_RPC` | `wss://paseo-bulletin-next-rpc.polkadot.io` | Trusted T3ams Bulletin RPC endpoint for encrypted downloads and uploads. Set it to an explicit empty value to run metadata-only: retrieval and file delivery are disabled. |
| `BOT_T3AMS_HOP_ALLOW_INSECURE` | `0` | `1` permits insecure `ws://` only for a local test mock. Production uses a validated TLS endpoint. |
| `BOT_T3AMS_HOP_TIMEOUT_MS` | 120000 | Whole encrypted download/upload deadline. |
| `BOT_T3AMS_HOP_RPC_FRAME_MAX_BYTES` | 4.5 MB | Largest accepted Bulletin/HOP RPC frame. |
| `BOT_T3AMS_MEDIA_TTL_HOURS` | 48 | TTL for the evictable downloaded-media cache below `BOT_STATE_DIR/media`. |
| `BOT_T3AMS_MEDIA_MAX_TOTAL_MB` | 512 | Total media-cache capacity. |
| `BOT_T3AMS_MEDIA_MAX_CONCURRENT_DOWNLOADS` | 2 | Concurrent encrypted attachment downloads. |
| `BOT_T3AMS_MEDIA_MAX_INFLIGHT_BYTES` | max(64 MiB, `2 × attachment cap + 4 MiB`) | Reservation for active download/decrypt work. It cannot be set below the value required for one allowed attachment. |
| `BOT_T3AMS_MEDIA_DOWNLOAD_QUEUE_CAP` | 100 | Queued attachment-download limit. |
| `BOT_T3AMS_BRIDGE_MEDIA_REF_CAP` | max(256, min(100000, `BOT_INBOUND_CAP × attachment count`)) | Bounded process-local opaque media references that bridge deliveries may fetch. |
| `BOT_T3AMS_BRIDGE_MEDIA_REF_TTL_MS` | 3600000 | Lifetime of an opaque bridge-media reference; fetching it renews its short-lived TTL. |
| `BOT_BRIDGE_FILE_MAX_BYTES` | `BOT_FILE_MAX_BYTES` | Largest raw `PUT /files` bridge upload; it cannot exceed the T3ams durable-file cap. |

T3ams uses the shared `BOT_FILE_MAX_BYTES`, `BOT_FILE_MAX_TOTAL_MB`,
`BOT_FILE_MAX_ENTRIES`, `BOT_FILE_MAX_PEER_MB`, and
`BOT_FILE_MAX_PEER_ENTRIES` settings for a conversation-scoped durable vault
under `BOT_STATE_DIR/files`. For this transport, `BOT_FILE_MAX_BYTES` defaults
to `BOT_T3AMS_ATTACHMENT_MAX_BYTES` and cannot exceed it. A DM and a channel
are different vault namespaces; a group channel intentionally shares one vault
among its members. `/file put` requires exactly one successfully downloaded
attachment, and `/file get` uploads the saved regular file as a new encrypted
T3ams attachment. The bridge can access the same private namespace with its
authenticated `/files` routes and can send only a vault `file_path`, never an
arbitrary host path.

Keep Bulletin capacity separate from the Statement Store allowance that funds
text and live operations. Before enabling `/file get` or bridge `file_path`,
ensure the bot account has the required T3ams Bulletin upload allowance and
monitor it independently; `pca storage <bot>` and its named Paseo faucet flow
document the default Polkadot-app transport, not a T3ams Bulletin preflight.
The bridge token authorizes access to cached media and every file in every
conversation vault, so do not publish the bridge port or inject that token into
an untrusted agent process.

### T3ams group-channel context (optional)

T3ams remains mention-gated by default: unmentioned channel traffic is never
sent to a brain. Set `BOT_T3AMS_CHANNEL_CONTEXT=1` only when a later explicit
mention should receive a small, in-memory snapshot of recent authenticated
channel context. It is not persisted, does not change membership/private-key
checks, and its caps should stay small on a public bot.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_CHANNEL_CONTEXT` | `0` | `1` enables passive, memory-only context collection for channel chats. |
| `BOT_T3AMS_CHANNEL_CONTEXT_TTL_MS` | 1800000 | Retention time; `0` expires records immediately. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_CHATS` | 128 | Channel conversations retained in memory. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORDS` | 16 | Records per channel. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_BYTES` | 8192 | Text budget per channel. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORD_BYTES` | 2048 | Maximum one retained message. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_RECORDS_PER_SENDER` | 4 | Fairness cap per sender in one channel. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_BYTES_PER_SENDER` | 2048 | Per-sender text budget in one channel. |
| `BOT_T3AMS_CHANNEL_CONTEXT_MAX_TOTAL_BYTES` | 262144 | Process-wide memory budget for passive context. |

### T3ams shared-channel direct-brain controls

A channel uses one shared direct-brain session. Normal mentioned prompts remain
available to channel members, but the session-changing direct commands
`/reset`, `/model`, `/reasoning`, and `/project` are role-gated from the
authenticated T3ams workspace state. This setting does not apply to DMs or a
bridge framework's own commands. `/stop` remains available to any channel
member so a stuck shared turn always has a group-visible cancellation lever.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_CHANNEL_CONTROL_ROLE` | `admin` | Minimum role for shared-session commands: `admin` permits owners/admins; `mod` also permits moderators; `all` permits any member whose message reaches the bot. |

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
`open` + public is refused at startup. Manage it with `pca model <bot> allow
a,b` or `pca model <bot> open`.
