# Private & public bots

Anyone who can message an AI bot spends its owner's model quota. So the single
most important configuration decision is **who is allowed to talk to it** — and
`pca` is restrictive by default: it will not leave a paid brain open to everyone
unless you say so explicitly.

## Private (the default)

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

## What changes between the two

The private/public choice isn't just who gets in — it changes what the bot
allows in chat:

| Concern | Private (allowlisted) | Public |
|---|---|---|
| Who can message | Only listed accounts | Anyone |
| Who pays | You, for trusted people | You, for everyone |
| `/model` switching | Can be opened (`pca model <bot> open`) — trusted peers only | Never unrestricted; at most an approved set (`pca model <bot> allow a,b`) |
| Sensible model | Your call | Pin a cheaper model |

The model-switching rule exists because switching to an expensive model spends
*your* quota: a stranger on a public bot must never be able to pick the
priciest model. See [Brains & engines](/guide/brains#model-switching-in-chat)
for the full policy.

## The security model behind "open tools"

A direct engine runs its agent with real tools and, by default, full autonomy
(`--dangerously-skip-permissions`). That is safe because of how the deployment
is built, not because the agent is trusted:

- **The container is the sandbox.** A deployed engine runs in a non-root
  container with its own filesystem and no access to the host. The agent can do
  what it likes *inside* that box.
- **The agent never sees the seed.** The signing seed and every secret live in
  the transport process only; the agent CLI is spawned with a scrubbed
  environment (no seed, no API keys) and dropped to a non-root user that can't
  read the bot's state.
- **The bridge is authenticated.** The local HTTP control surface requires a
  32+ character `BOT_BRIDGE_TOKEN`, so nothing on the box can drive the bot
  just by reaching the port.

`--safe-tools` narrows a direct engine to a read / write / edit / bash allowlist
if you want a tighter posture than full autonomy.

## Attachments are hostile input

Files arrive from the peer, so their source node is chosen by the sender. The
transport treats attachment fetches defensively (size caps, integrity checks,
scheme restrictions). For production, pin the nodes you trust with
`BOT_HOP_ALLOWED_NODES` — see [Configuration](/reference/configuration#attachments-hop).

## The knobs

The decisions on this page map to these settings, all detailed in
[Configuration](/reference/configuration):

- `BOT_ALLOWED_PEERS` — the allowlist (empty = public).
- `BOT_AI_ALLOWED_MODELS` / `BOT_AI_MODEL_SWITCHING` — the `/model` policy.
- `BOT_BRIDGE_TOKEN` — bridge authentication.
- `BOT_AI_SKIP_PERMISSIONS` — full tool autonomy vs. `--safe-tools`.
