---
prev:
  text: "How it works"
  link: "/explanation/how-it-works"
---

# Architecture & security

This is the operator view of the system: where messages travel, what needs to
remain private, and which boundary protects a deployed agent.

The default Polkadot-app transport and T3ams share these security boundaries.
For T3ams-specific BCTS/Bulletin media, native typing, reactions, edits, and
conversation-scoped files, see [Run a bot in T3ams](/guide/t3ams).

## The path a message takes

```text
Polkadot app <-> encrypted message layer <-> your bot <-> selected AI engine
```

The app and bot establish a private chat session. The network carries encrypted
messages while your bot polls for new work and publishes its replies. The bot
only needs outbound network access; it does not expose a public webhook or chat
port.

## Identity and persistent state

The bot's seed is its identity. It derives the account and chat keys used to
receive and send messages, so protect `BOT_SEED_HEX` and the bot's persistent
state as carefully as a wallet key.

Deployments store this material in `bot.env` and the persistent state volume.
That state also keeps session continuity and any files saved with `/file put`.
Back it up before moving a bot, and do not commit it, log it, or share it with a
framework integration.

## Direct-agent boundary

For Claude, Codex, and OpenCode bots, `pca deploy` separates the chat transport
from the agent CLI. The transport retains the signing seed and session state;
the agent runs as a non-root user with its own workspace and provider-login
home. The CLI process retains that home only to authenticate and refresh its
session; container-scoped native file tools and Bash can access it inside that
bot container.

Direct Claude, Codex, and OpenCode start with no tools. Their deployer may
select portable `read`, `write`, and `bash` capabilities, workspace or container
scope for either public or allowlisted bots. Workspace scopes native file tools
to the normal working area; container scope deliberately exposes all files
visible to the non-root agent account. Bash uses the agent process boundary in
either scope: the bot's dedicated container for a deployment, or the local
process account for `pca run`. Treat local Bash bots as trusted-machine tools.
Do not mount unrelated host repositories, credentials, Docker sockets, or home
directories into a deployed bot container. See [Private & public bots](/guide/access)
for the deployment profiles.

## Files and attachments

On the default Polkadot-app transport, an attachment arrives as an encrypted
reference. The bot downloads it only from trusted HOP nodes, then stages it for
the current turn. A normal attachment is temporary; `/file put` is the explicit
action that saves it in that chat's durable vault. `/file get` returns only a
file from that same vault.

The named private Paseo profile can provision the default transport's testnet
allowance used for returning saved files. T3ams uses encrypted Bulletin media
and a separate operator-provisioned upload allowance. Public deployments and
production allocation require deliberate operator choices. See
[Files & storage](/guide/files).

## Framework integrations

Hermes, OpenClaw, and custom frameworks interact with bot-core through an
authenticated local bridge. The bridge token can read inbound messages and
manage every chat vault, so it is a privileged integration secret. Keep the
port inside the private Compose network and never publish it to the internet.

The [Bridge HTTP API](/reference/bridge) documents the integration contract.

## Operational implications

- Keep the bot's state volume and `bot.env` private and backed up.
- Restrict message senders before they can spend model quota or deliberately
  enabled tools; apply the selected engine's documented scope rather than
  assuming one universal credential boundary.
- Keep the bridge token and provider login separate from source control.
- Treat a public bot as an internet-facing workload: use a dedicated container
  or VM, disk limits, a low-cost model, and trusted attachment nodes.

The [deployment guide](/guide/deploy) and
[configuration reference](/reference/configuration) cover the concrete setup.
