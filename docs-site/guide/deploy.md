# Deploy to a server

Run `deploy` from a machine with `ssh`, `scp`, and `rsync`. It targets a
reachable server with Docker Engine and the Docker Compose plugin:

```bash
pca deploy mycoolbot --host root@your-server

pca status mycoolbot
pca logs mycoolbot -f
pca stop mycoolbot
```

`deploy` uploads `bot-core`, generates a compose file and a `bot.env`, starts
the container with a persistent state volume, and waits for the bot to come
online. Add `--dry-run` to preview the generated files without deploying.

For a private bot on the default Paseo profile, a normal (non-dry-run) deploy
also checks the separate account used for returning saved files and refreshes
its testnet allowance when needed. That happens in your local CLI before the
bot runs on the server; it does not require a Console visit. The persistent
state volume includes the saved-file vault, so keep it when moving or backing
up a bot. [Files & storage](/guide/files) covers the workflow and recovery
steps.

## AI direct engines

`claude`, `codex`, and `opencode` deploy as a **single container**: the
transport process holds the seed and writes `/state`, while the agent CLI it
spawns is dropped to a non-root user — it can't read the seed or session state.
The container is read-only except for its intended volumes and a size-capped
`tmpfs`.

The seed split protects the chat identity, but the mounted OAuth home is not a
safe boundary for an agent with filesystem or shell tools: that same agent
needs to read it to authenticate. Every direct engine starts with no
capabilities, workspace scope, and no tool network. A deployer may select
portable `read`, `write`, and `bash` capabilities with
`--allowed-tools read,write,bash`; `write` includes `read` and `bash` includes
both. `--tool-scope workspace|container` chooses the file boundary, and
`--tool-network none|internet` chooses tool-process egress (`internet` requires
`bash`).

For Bash, OpenCode requires `--tool-network internet` because it has no network
sandbox. Claude requires internet for container-scoped Bash but can use `none`
for workspace-scoped Bash; Codex can keep `none` in either scope. `pca deploy`
validates the combination and reports the effective enforcement.

Workspace scope is the normal project boundary; container scope deliberately
grants selected tools the non-root agent account's container-visible files,
including its OAuth home. Claude and Codex provide native workspace enforcement
for their applicable policies; OpenCode's Bash policy remains bounded by the
container rather than an OS filesystem sandbox. For a public bot, every sender
can direct the selected capability. Use a bridge runtime when a separate
tool-and-credential boundary is required.

After a direct deployment, run the printed one-time CLI login command (for a
Claude bot, `claude login` through the printed `docker exec` command) so the
agent can authenticate through its mounted OAuth home. Those credentials survive
restarts and redeploys; keep the selected policy in the deployment command or
release script.

`echo` also deploys as a single container, but it does not spawn an AI CLI and
needs no provider login.

## Photo and document understanding for T3ams

A no-tools direct bot can safely receive encrypted photos and files, but it
cannot inspect a staged file itself. Enable `--allowed-tools read` with
workspace scope when the direct brain should inspect its current staged
attachment. For a separate API-only attachment-analysis worker, use the
explicit `--media-analyzer` deployment option:

```bash
# First create the private remote directory and edit its media.env directly on
# the VPS. Do not put this provider key in your local shell history or CI logs.
install -d -m 700 /root/pca-bots/<bot>
# In your editor or secret-manager workflow, create /root/pca-bots/<bot>/media.env:
ANTHROPIC_API_KEY=...
MEDIA_ANALYZER_MODEL=<an available Anthropic API model>
chmod 600 /root/pca-bots/<bot>/media.env

# Then deploy; the API key is never passed to bot.env, Claude, or your local pca command.
pca deploy mycoolbot --host root@your-server --media-analyzer
```

The generated worker has no published port and does not mount `/state`, the
agent workspace, any direct-engine OAuth home, or the bot's bridge token. It receives
only verified, bounded attachment bytes, then returns a small untrusted
summary for the brain. It supports common images, PDFs, text documents, and
`.docx`/`.xlsx`/`.pptx`; other file types continue to be delivered/downloadable
but are not semantically inspected. The worker sends supported files to the
Anthropic API, so do not enable it for material that must remain entirely on
your server. See [Configuration](/reference/configuration#optional-isolated-photo-and-document-analysis)
for limits, cancellation, at-most-once recovery behavior, and egress guidance.

## Bridge bots

Bridge bots deploy together with their agent framework as a **two-container
stack**:

- `--harness openclaw` — no interactive steps if the server has Claude CLI
  credentials.
- `--harness hermes` — prints the one login command it cannot automate.

See [Agent frameworks](/guide/harnesses) for the full setup.

## The generated `bot.env`

`deploy` writes an `bot.env` (mode 0600) holding the seed and configuration.
Whoever has that file is the bot. It also generates a mandatory
`BOT_BRIDGE_TOKEN` so the local HTTP bridge is authenticated even on loopback.
Every field is documented in [Configuration](/reference/configuration).

Stopping a deployment stops its containers but retains its server-side state
volume and `bot.env`. Back it up before moving a bot; remove the remote state
directory deliberately when retiring one.
