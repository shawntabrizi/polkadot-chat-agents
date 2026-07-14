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
BOT_AI_SKIP_PERMISSIONS=0       # default: Claude has no tools
# Deployer-selected: BOT_AI_ALLOWED_TOOLS=Read (or a deliberate narrow list)
# Deployer-selected: BOT_AI_SKIP_PERMISSIONS=1 for full autonomy
# Public T3ams Claude only, emitted by: pca deploy <bot> --attachment-read
# BOT_T3AMS_PUBLIC_ATTACHMENT_READ=1
# BOT_AI_ALLOWED_TOOLS=Read    # runtime scopes Read to each temporary attachment directory
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
container. The deployer can enable it for a public or private bot, but should
treat every sender of that bot as able to direct its workspace, reachable
services, and the CLI's own OAuth home: a tool-enabled agent can read or misuse
its provider credential. Keep the bridge on loopback for a local run; in a generated framework deployment,
`BOT_BRIDGE_HOST=0.0.0.0` is only reachable on the private Compose network and
no bridge port is published.

### Public bot: deliberately bounded

A public bot has `BOT_ALLOWED_PEERS` unset or empty. It must assume arbitrary
prompts, attachment floods, repeated requests, and attempts to spend model or
storage allowance. Prefer a narrow task, a fixed model allowlist, and a
read-only or disposable workspace. Built-in public direct deployment starts
with Claude's hardened no-tools profile. The deployer may explicitly opt in to
a narrower tool list, `--safe-tools`, or `--full-autonomy` at deploy time. The
following is a usable conservative baseline for a directly hosted public bot:

```sh
BOT_ALLOWED_PEERS=

# Public bots cannot use unrestricted /model switching. Pin one model and,
# if switching is needed, expose only a small approved list.
BOT_AI_MODEL=provider/model
BOT_AI_ALLOWED_MODELS=provider/model,provider/low-cost-model
BOT_AI_SKIP_PERMISSIONS=0
# Do not set BOT_AI_ALLOWED_TOOLS for the conservative default. The deployer
# may choose --allowed-tools, --safe-tools, or --full-autonomy at deployment.
# This no-tools profile can answer text but cannot inspect staged file bytes.
# To deliberately enable subscription-backed attachment reading for public
# T3ams Claude, deploy with: pca deploy <bot> --attachment-read
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

For a public **T3ams** direct engine, `2` active turns and `20` queued turns are
runtime defaults when those variables are unset; the explicit values above make
the intended budget visible in deployment configuration. Authenticated `GET /health`
also exposes `direct.queue` for this open direct profile, so an operator can see
active, queued, and configured capacity without exposing it to chat users.

`pca deploy <bot> --attachment-read` is the pragmatic public-T3ams option for
a bot such as dotbot that already runs in its own container. It needs a normal
Claude Code subscription login, not `ANTHROPIC_API_KEY`. On a turn with a
verified, downloaded attachment, PCA gives Claude only its native `Read` tool,
pre-approves only that turn's temporary staged-directory path, and explicitly
denies the persistent workspace, transport state, app source, and Claude home.
On a text-only turn, it exposes no tools. The launch also uses Claude safe mode
and disables plugins, hooks, MCP, browser control, and slash commands. It never
grants Bash, edit, write, glob, or grep.

This is still an operator choice, not a claim that the bot has no valuable
state: Claude Code's own OAuth/session files remain in its container and its
native permission enforcement is a separate layer from Docker. Use the default
no-tools profile for the strictest public posture, or `--media-analyzer` when
you prefer a separate API-only attachment-analysis container instead.

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
| `BOT_AI_ALLOWED_TOOLS` | `""` | Claude-only explicit tool availability/approval list. Unset or empty disables all built-in tools. The deployer may set a deliberate list for a public or private bot; `--attachment-read` is the separate exact-`Read`, per-turn scoped profile. |
| `BOT_AI_SAFE_MODE` | `0` | `1` enables Claude safe mode without removing the explicit built-in tool list. Deploy emits it with `--safe-tools`, disabling ambient project/user customizations, hooks, plugins, MCP, browser control, and slash commands. It has no effect when full autonomy bypasses Claude permission checks. |
| `BOT_AI_SKIP_PERMISSIONS` | `0` | `1` = explicit full autonomy inside the bot container. Deploy emits it only with `--full-autonomy`; treat every person who can message that bot as able to direct its full agent capability. |
| `BOT_T3AMS_PUBLIC_ATTACHMENT_READ` | `""` | Public built-in Claude/T3ams only: exact `1` enables the deploy-generated per-turn, path-scoped `Read` profile. It requires exactly `BOT_AI_ALLOWED_TOOLS=Read`, rejects any other tool/full-autonomy setting, and has no effect outside T3ams. Prefer `pca deploy --attachment-read` to setting it manually. |
| `BOT_AI_AGENT_UID` / `BOT_AI_AGENT_GID` | unset | Drop the spawned agent to this uid/gid so it can't read `/state` or the seed. **gen (deploy: 1000)** |
| `BOT_AI_IDLE_TIMEOUT_MS` | 600000 | Kill a turn that has emitted nothing for this long (wedge backstop). |
| `BOT_AI_MAX_MS` | 3600000 | Hard per-turn wall-clock cap. |
| `BOT_AI_MAX_CONCURRENT_TURNS` | 4; public T3ams direct: 2 | Global cap on simultaneously-running agent turns. An explicit value always overrides the T3ams profile default. |
| `BOT_AI_MAX_QUEUED_TURNS` | 100; public T3ams direct: 20 | Global cap on queued turns before backpressure. An explicit value always overrides the T3ams profile default. |
| `BOT_AI_MAX_OUTPUT_BYTES` | 1000000 | Cap on captured agent output per turn. |
| `BOT_AI_CMD` / `BOT_AI_ARGS` | unset | Escape hatch: a custom CLI speaking claude-shaped stream-json (`BOT_AI_ARGS` is a JSON array; `__PROMPT__` is substituted). |

#### Tool profiles

`pca deploy` regenerates `bot.env`, so make the selected tool profile part of
the deploy command or release script. Omitting a profile on a later deploy
intentionally returns a direct bot to the no-tools default.

| Deploy selection | Effective capability |
|---|---|
| *(no tool flag)* | No Claude tools. The process uses `dontAsk` plus safe mode and does not load project/user settings, MCP, hooks, browser control, or slash commands. |
| `--allowed-tools Read,Edit,Write` | The exact comma-separated Claude Code tool list. Listed tools are pre-approved and execute non-interactively; no unlisted built-in tool is available. Use this for a deployer-defined profile, including a read/edit/write bot without shell access. |
| `--safe-tools` | The conventional `Bash,Read,Edit,Write` allowlist in Claude safe mode. This enables useful coding-agent work, including writing and editing files in the bot's workspace, while disabling ambient project/user customizations, hooks, plugins, and MCP servers. `Bash` is broad: people who can message the bot can direct commands against everything the non-root agent account can reach in its container. |
| `--full-autonomy` | Passes Claude Code's `--dangerously-skip-permissions`; this is an unrestricted, deployer-authorized agent inside the container. It cannot be combined with an allowlist. |
| `--attachment-read` | Public T3ams Claude only. On a turn with a verified attachment, gives native `Read` only for that turn's temporary staging directory; text-only turns have no tools. It uses the Claude Code subscription rather than an API key and cannot be combined with the broader profiles. |

The first four choices work for both public and allowlisted **Claude** direct
bots. Public built-in direct bots currently use Claude; use a bridge/runtime
you operate for a public bot based on another engine. `--media-analyzer` is
separate from tool policy: it may accompany the normal profiles, but requires
an API credential in its isolated worker.

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
| `BOT_T3AMS_ATTACHMENT_MAX_COUNT` | 8 | Maximum rich-text attachments per T3ams message (0–16). |
| `BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS` | `BOT_T3AMS_ATTACHMENT_MAX_COUNT` | Maximum top-level regular files a direct Claude/Codex/OpenCode turn can return from its private `PCA_OUTPUT_DIR` (0–16; `0` disables generated-file delivery). |
| `BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` | min(64 MiB, count × attachment cap), at least one attachment cap | Cumulative byte budget for all generated files from one direct turn (1 byte–512 MiB). |
| `BOT_T3AMS_AGENT_OUTBOX_MAX_ENTRIES` | min(1024, max(16, `128 ×` artifact count)) | Global count cap for private generated-file snapshots waiting for upload. |
| `BOT_T3AMS_AGENT_OUTBOX_MAX_BYTES` | max(per-turn artifact cap, min(512 MiB, `8 ×` per-turn cap)) | Global byte cap for generated-file snapshots waiting for upload (up to 4 GiB). |
| `BOT_T3AMS_REPLY_OUTBOX_MAX_ENTRIES` | 128 | Global cap for incomplete durable direct-agent final replies. |
| `BOT_T3AMS_REPLY_OUTBOX_MAX_BYTES` | max(one reply, min(128 MiB, `32 ×` one reply)) | Global serialized-byte cap for incomplete durable direct-agent final replies (up to 4 GiB). |
| `BOT_T3AMS_ATTACHMENT_MAX_DURATION_MS` | 604800000 (7 days) | Maximum declared audio/video duration accepted as attachment metadata (0–31 days). |
| `BOT_T3AMS_ATTACHMENT_MIME_TYPES` | `*/*` | Comma-separated MIME admission policy. Exact MIME types and `type/*` patterns narrow the broad default. |
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

### Attachment understanding options

Fetching a T3ams attachment and understanding its contents are intentionally
different capabilities. By default, a hardened public direct bot receives only
attachment metadata: its Claude process has no filesystem tools and must not
claim that it read a staged file. That remains the strict default for a bot
with an OAuth home.

For a public T3ams bot backed by a logged-in Claude Code subscription,
`pca deploy <bot> --attachment-read` is a second, local route. It does not use
an API key or send an attachment to a separate provider call: Claude reads only
the verified temporary copy PCA gives it for that turn. The capability is
limited to native `Read`, path-scoped to that directory, and removed after the
turn. It is suitable when the dedicated bot container is the intended boundary;
it is not a general filesystem or agent-autonomy profile.

For a T3ams direct deployment, `pca deploy <bot> --media-analyzer` adds a
separate API-only `media-analyzer` container. The transport sends it only
bounded, HOP-verified bytes; it returns a bounded summary that is explicitly
wrapped as **untrusted attachment-derived data** before it reaches the brain.
The worker has no bot seed, `/state`, `/workspace`, OAuth home, bridge token,
published port, or tools. It is the only container that receives the provider
API key.

Enabling it changes the data boundary: supported attachment bytes and the
user's accompanying request are sent to the configured Anthropic API. Do not
enable it for content that must remain entirely within the VPS. The worker can
summarize JPEG/PNG/GIF/WebP images, PDFs, UTF-8 plain text/Markdown/CSV/TSV/
XML/RTF/JSON/NDJSON, and common Office XML files (`.docx`, `.xlsx`, `.pptx`).
Office files are projected through a bounded ZIP/XML reader; they are not run
through a shell or desktop converter. Audio/video, legacy Office binaries,
archives, and arbitrary binary files remain normal downloadable T3ams
attachments with metadata only. Plain-text and Office projections are capped at
256 KiB before the provider call even when the encrypted attachment itself is
within the larger file limit. Images above 40 megapixels, encrypted PDFs, and
PDFs with more than 50 visible page markers are rejected for semantic analysis
but remain downloadable.

| Transport variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_MEDIA_ANALYZER_URL` | unset | Exact worker endpoint, normally `http://media-analyzer:8798/v1/analyze`. Set together with the token; leaving both empty disables analysis. |
| `BOT_T3AMS_MEDIA_ANALYZER_TOKEN` | unset | 32+ character capability for the worker request. Generated by `pca deploy --media-analyzer` and written to `bot.env`; never pass it to an agent. |
| `BOT_T3AMS_MEDIA_ANALYZER_HTTP_HOSTS` | `media-analyzer` | Comma-separated hosts allowed for an `http:` worker URL. Use HTTPS for any non-internal endpoint. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_FILES` | 4 | Maximum supported files copied to one analysis request (1–8). |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_FILE_BYTES` | 7 MiB | Per-file byte cap for semantic analysis (1 byte–12 MiB). Larger chat attachments remain downloadable but are not sent to the worker. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_TOTAL_BYTES` | 12 MiB | Cumulative worker request cap (at least the per-file cap; at most 16 MiB). |
| `BOT_T3AMS_MEDIA_ANALYZER_TIMEOUT_MS` | 90000 | Transport wait for the isolated worker (1 s–10 min). A timeout degrades to metadata-only, not a failed chat turn. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_PROMPT_BYTES` | 12288 | User-request text copied to the worker. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_SUMMARY_BYTES` | 6144 | Maximum worker summary copied into the brain prompt. |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_CONCURRENT` | 1 | Maximum provider analyses in flight before the direct-agent queue (1–8). |
| `BOT_T3AMS_MEDIA_ANALYZER_MAX_QUEUED` | 20 | Bounded waiting analyses (0–1000); a full queue falls back to metadata-only. |
| `BOT_T3AMS_MEDIA_ANALYZER_SENDER_CAP` | 4 | Durable analyses available to one authenticated sender in its refill window. |
| `BOT_T3AMS_MEDIA_ANALYZER_SENDER_WINDOW_MS` | 3600000 | Sender-token refill window (1 s–31 days). |
| `BOT_T3AMS_MEDIA_ANALYZER_GLOBAL_CAP` | 30 | Durable analyses available to the entire bot in its refill window. |
| `BOT_T3AMS_MEDIA_ANALYZER_GLOBAL_WINDOW_MS` | 3600000 | Global-token refill window (1 s–31 days). |
| `BOT_T3AMS_MEDIA_ANALYZER_SENDER_BUCKET_CAP` | 1000 | Maximum remembered sender buckets; least-recent/stale records are evicted. |

Before a supported file is sent externally, bot-core persists both its rate
reservation and a `submitted` marker. `/stop`, edits, and deletes abort the
transport-to-worker request; if a process dies after submission but before it
can save the result, the next attempt intentionally uses metadata only rather
than uploading the same private attachment a second time.

The deploy command creates a distinct `media-token.env` containing the worker
capability, but never creates, reads, prints, uploads, or overwrites the
server-side `media.env`. Before the first deployment, create that file on the
VPS with mode `0600` and exactly the provider configuration you intend to use:

```sh
# On the VPS: make the remote directory private, then create this file with
# your editor or secret manager. Keep the key out of local shell history/CI.
install -d -m 700 <remote bot directory>
# <remote bot directory>/media.env — pca never reads it
ANTHROPIC_API_KEY=...
MEDIA_ANALYZER_MODEL=<an available Anthropic API model>
chmod 600 <remote bot directory>/media.env
```

The worker also accepts `MEDIA_ANALYZER_MAX_FILES`,
`MEDIA_ANALYZER_MAX_FILE_BYTES`, `MEDIA_ANALYZER_MAX_TOTAL_BYTES`,
`MEDIA_ANALYZER_MAX_PROMPT_BYTES`, `MEDIA_ANALYZER_MAX_SUMMARY_BYTES`,
`MEDIA_ANALYZER_MAX_TOKENS`, and `MEDIA_ANALYZER_TIMEOUT_MS`; keep its limits
at or below the transport limits. Docker Compose gives the worker ordinary
outbound HTTPS access so it can call the provider; use a VPS firewall or egress
proxy if it must be restricted further to an exact provider endpoint.

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

For a direct brain, generated files are uploaded from a fresh private
`PCA_OUTPUT_DIR` at the end of a turn. Only top-level regular files are
considered; nested paths and symlinks are ignored and the directory is removed
after delivery. Before the first upload or final-answer statement, bot-core
durably records the final reply chunks and copies accepted bytes into a private
per-turn outbox. A normal delivery retry drains that exact turn rather than
asking the model to create a second text response, image, or document. Uploaded
Bulletin references are also persisted before their chat statement, avoiding a
repeat upload on a later statement retry. Generated files follow the same
outbound MIME, per-file size, and cumulative-output policy. If Bulletin upload,
attachments, or generic `application/octet-stream` delivery is disabled by
configuration, direct-agent file generation is disabled rather than creating a
stuck retry; text replies continue normally.

The remote Bulletin upload and Statement Store submission APIs do not expose a
transactional cross-service idempotency key. A process loss after a remote
statement succeeds but before local journal progress is flushed can therefore
produce one at-least-once duplicate on recovery; the durable turn outbox avoids
rerunning the completed model turn in ordinary delivery-retry cases.

Keep Bulletin capacity separate from the Statement Store allowance that funds
text and live operations. Before enabling `/file get` or bridge `file_path`,
ensure the bot account has the required T3ams Bulletin upload allowance and
monitor it independently; `pca storage <bot>` and its named Paseo faucet flow
document the default Polkadot-app transport, not a T3ams Bulletin preflight.
The bridge token authorizes access to cached media and every file in every
conversation vault, so do not publish the bridge port or inject that token into
an untrusted agent process.

In T3ams bridge/Hermes mode, regular outbound `/send`, `/react`, and `/typing`
requests remain bound to their active inbound `delivery_id` and `lease_id`.
`BOT_BRIDGE_PROACTIVE_TOKEN` is a separate opt-in for a framework action that
has no inbound lease at all (such as a generic attached result). It must be a
different random secret, is required in the `x-bridge-proactive-token` header
in addition to normal bridge authentication, and never makes a stale supplied
lease valid. Leave it unset unless that explicit proactive behavior is needed.

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

### T3ams channel direct-brain controls

Top-level channel prompts use the channel's direct-brain session, while each
thread receives its own isolated native session. Normal mentioned prompts
remain available to channel members, but the session-changing direct commands
`/reset`, `/model`, `/reasoning`, and `/project` are role-gated from the
authenticated T3ams workspace state. This setting does not apply to DMs or a
bridge framework's own commands. `/stop` remains available to any channel
member and targets the current channel conversation/thread.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_CHANNEL_CONTROL_ROLE` | `admin` | Minimum role for channel/thread session commands: `admin` permits owners/admins; `mod` also permits moderators; `all` permits any member whose message reaches the bot. |

### T3ams message-operation reconciliation

T3ams retains messages separately from edit/delete operations. bot-core keeps a
bounded, persisted lifecycle index so a valid edit/deletion can arrive before its
message carrier, update pending channel context/work, or cancel a queued direct
turn. Reactions and typing never become model prompts, and a deletion cannot
retract a response already published by the bot.

| Variable | Default | Purpose |
|---|---|---|
| `BOT_T3AMS_MESSAGE_LIFECYCLE_MAX_RECORDS` | max(1024, `4 × BOT_INBOUND_CAP`) | Cap for recently seen message/edit/delete state. |
| `BOT_T3AMS_MESSAGE_LIFECYCLE_TTL_MS` | 21600000 (6 hours) | Lifecycle retention; `0` expires state immediately. |
| `BOT_T3AMS_MESSAGE_LIFECYCLE_MAX_BYTES` | 8 MiB | Aggregate durable lifecycle-state budget; oldest records are evicted before the journal grows beyond it. |
| `BOT_T3AMS_SUBSCRIPTION_CAP` | 1024 | Active T3ams subscription cap; each known DM needs carrier and operation routes. |

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
