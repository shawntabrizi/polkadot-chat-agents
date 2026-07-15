# Private & public bots

Anyone who can message an AI bot spends its owner's model quota. So the single
most important configuration decision is **who is allowed to talk to it** — and
`pca` will not leave a paid brain open accidentally: creating one requires an
owner or allowlist, or an explicit `--public`. An `echo` bot with an empty
allowlist is public.

## Private (recommended)

Lock the bot to accounts you choose, at `create`:

- `--owner <who>` — a single account (an app username like `yourname.42`, an
  SS58 address, or a 32-byte hex account id).
- `--allow a,b` — an allowlist of several accounts.

The allowlist is enforced **in the transport, before a message ever reaches the
brain**. An unlisted sender's message is rejected outright — it never runs the
agent and never spends a token. This is the setup for a personal bot, a
team-shared bot, or anything wired to your own subscription.

## Public

To let anyone message the bot, you must pass `--public` at `create`. `pca`
refuses to leave a paid brain (claude / codex / opencode / a framework) open
without it — an accidental public bot is an accidental open tab on your quota.

A public bot is a real commitment: **you pay for every stranger's
conversation.** Only make one public when you intend to fund it, and prefer a
cheaper pinned model.

::: warning Public means you're paying for everyone
There is no per-user metering or billing. A public bot spends your quota for
whoever messages it, at whatever rate they message it. Treat `--public` as
"I am funding this for the world."
:::

For the default Polkadot-app transport, public bots receive attachment
references but only download and process their bytes after you configure
`BOT_HOP_ALLOWED_NODES` with trusted HOP hosts. Its automatic Paseo
file-delivery allowance is intentionally disabled. For T3ams, use a trusted
`BOT_T3AMS_BULLETIN_RPC`, narrow `BOT_T3AMS_ATTACHMENT_MIME_TYPES`, and bound
the count, size, cache, and vault; T3ams has no automatic Bulletin upload grant.
Keep outbound file delivery off unless you deliberately fund it and have set
tight storage, queue, and model limits. The
[public deployment profile](/reference/configuration#public-bot-deliberately-bounded)
has a conservative starting point.

Public direct bots can use Claude, Codex, or OpenCode with the same portable
tool policy. They start with no tools, but their deployer may deliberately
enable `read`, `write`, or `bash`, choose workspace or container scope, and
choose tool-process network access. Every public sender can direct the chosen
capabilities: `read` can inspect staged attachment bytes and `write` can create
generated files. Use a bridge runtime when a public bot needs a separately
designed tool-and-credential boundary.

## What changes between the two

The private/public choice isn't just who gets in — it changes what the bot
allows in chat:

| Concern | Private (allowlisted) | Public |
|---|---|---|
| Who can message | Only listed accounts | Anyone |
| Who pays | You, for trusted people | You, for everyone |
| `/model` switching | Can be opened (`pca model <bot> open`) — trusted peers only | Never unrestricted; at most an approved set (`pca model <bot> allow a,b`) |
| Returning saved files | Ready automatically on the default Paseo testnet profile | No automatic finite-allowance profile |
| Sensible model | Your call | Pin a cheaper model |
| Built-in direct-agent tools | No tools by default; deployer chooses portable capability/scope/network policy | Same policy; every sender can direct the selected capability |

The model-switching rule exists because switching to an expensive model spends
*your* quota: a stranger on a public bot must never be able to pick the
priciest model. See [Brains & engines](/guide/brains#model-switching-in-chat)
for the full policy.

## Direct-agent tools and the trust boundary

A direct Claude, Codex, or OpenCode deployment starts with no tools. That is
the default for both `pca run` and `pca deploy`, rather than a permission prompt
the model can talk its way around. The deployer chooses one portable policy:

| Choice | Effect |
|---|---|
| no tool flag | No capabilities; workspace scope and no tool network. |
| `--allowed-tools read,write,bash` | Exact lowercase outcome capabilities. `write` includes `read`; `bash` includes both. |
| `--tool-scope workspace` | Default project scope; a read-capable turn can also inspect its current staged attachment. |
| `--tool-scope container` | Deliberately broad access to files visible to the non-root agent account, including its OAuth home. |
| `--tool-network none` / `internet` | Default `none` requests no tool-process egress. `internet` requires `bash`. |

For Bash, deploy validates the engine-specific network combination: OpenCode
requires `--tool-network internet` because it has no network sandbox; Claude
requires it for container-scoped Bash but can use `none` for workspace-scoped
Bash; Codex can keep `none` in either scope. The deploy report names the
effective enforcement level.

Authentication and tool access are separate. The direct CLI retains its OAuth
home only to authenticate and refresh its own session. In workspace scope,
Claude's native path rules constrain file tools; workspace Bash also has an
allow/deny Bubblewrap filesystem policy that hides `/home/node`, `/state`, and
`/app`. Container scope deliberately exposes the non-root agent account's
container-visible files, including its OAuth home. Codex and OpenCode use the
enforcement reported at deploy time; OpenCode Bash remains bounded by the
container rather than an OS filesystem sandbox. The deploy report states the
selected engine's enforcement level.

For Docker Claude workspace Bash, the deployer must explicitly prepare the
Linux host once with `pca prepare-host --host root@your-server`. PCA then keeps
`no-new-privileges`, installs a confined AppArmor profile, uses a pinned Docker
seccomp derivative, and probes Bubblewrap before replacing the bot. It never
falls back to a privileged container, adds `CAP_SYS_ADMIN` to the outer Docker
container, enables `userns=host`, or uses an unconfined security profile. The
Claude CLI remains in the direct-agent container; each sandboxed Bash
subprocess gets a fresh `/proc`, a read-only root, and a payload AppArmor
profile that denies capability use. Its writes follow the configured filesystem
policy, including the selected workspace and, when enabled, PCA's per-turn
output directory. The workspace policy explicitly denies `/home/node`,
`/state`, and `/app` to sandboxed Bash. Docker mode sets
`allowAllUnixSockets: true`, opting out of its optional Unix-socket seccomp
filter without enabling
`enableWeakerNestedSandbox`. Sandboxed Bash retains Bubblewrap's filesystem,
fresh-`/proc`, and IP-network boundaries; with `--tool-network none`, it has no
IP egress, but can still reach Unix-domain sockets visible inside the container.
Generated direct-agent services mount no Docker or host socket—do not add one.

The deployed transport still protects the chat identity: it owns `/state`, the
signing seed, session keys, and bridge token, while the agent CLI runs as a
non-root user. The CLI keeps its mounted OAuth home for authentication, not as
a tool grant; the selected engine's scope determines whether a model-directed
tool action can reach it. In particular, Claude workspace Bash is denied that
home, while container scope deliberately exposes it.

For a public deployment, treat every sender as able to direct the chosen policy;
for `pca run`, remember that the local machine is the runtime boundary. Use a
bridge runtime when you need a genuinely separate tool-and-credential boundary.
The local HTTP bridge itself still requires a 32+ character `BOT_BRIDGE_TOKEN`,
so nothing on the box can drive the transport just by reaching its port.

## Attachments are hostile input

Files arrive from the peer and are hostile input. The transport treats fetches
defensively with size caps, integrity checks, and strict reference handling. On
the default transport, pin the trusted HOP hosts with `BOT_HOP_ALLOWED_NODES`.
On T3ams, attachments are encrypted `hop:` capabilities rather than peer-chosen
web URLs; use the trusted `BOT_T3AMS_BULLETIN_RPC`, narrow the MIME policy when
appropriate, and keep the private media cache/vault bounded. See
[T3ams media configuration](/reference/configuration#t3ams-media-and-file-vault).

## The knobs

The decisions on this page map to these settings, all detailed in
[Configuration](/reference/configuration):

- `BOT_ALLOWED_PEERS` — the allowlist (empty = public).
- `BOT_AI_ALLOWED_MODELS` / `BOT_AI_MODEL_SWITCHING` — the `/model` policy.
- `BOT_BRIDGE_TOKEN` — bridge authentication.
- `BOT_AI_TOOL_CAPABILITIES` — empty by default; comma-separated portable
  `read`, `write`, and `bash` outcomes.
- `BOT_AI_TOOL_SCOPE` / `BOT_AI_TOOL_NETWORK` — workspace versus container
  scope and no-network versus internet tool-process egress.
- `BOT_T3AMS_ATTACHMENT_MIME_TYPES` / `BOT_T3AMS_ATTACHMENT_MAX_*` — T3ams
  attachment admission policy and media bounds.
