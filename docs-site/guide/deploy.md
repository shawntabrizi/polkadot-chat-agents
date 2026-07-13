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
spawns is dropped to a non-root user that can only touch its `/workspace` and
OAuth home — it can't read the seed or the session state. The container is
read-only except for those volumes and a size-capped `tmpfs`.

The seed split protects the chat identity, but the mounted OAuth home is not a
safe boundary for an agent with filesystem or shell tools: that same agent
needs to read it to authenticate. A direct Claude deployment starts with no
model tools. A public built-in AI direct bot must remain Claude's hardened
no-tools profile; use an externally isolated bridge runtime for public tools or
file analysis.

For a private, allowlisted Claude bot, choose tool access deliberately at
deploy time: `--safe-tools` opts into `Bash,Read,Edit,Write`,
`--allowed-tools Read,...` selects an exact list, and `--full-autonomy` is the
explicit unrestricted override. Do not combine `--full-autonomy` with either
tool-list flag.

After a direct deployment, run the printed one-time CLI login command (for a
Claude bot, `claude login` through the printed `docker exec` command) so the
agent can authenticate through its mounted OAuth home. Those credentials survive
restarts and redeploys; keep a tool-enabled deployment private and allowlisted.

`echo` also deploys as a single container, but it does not spawn an AI CLI and
needs no provider login.

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
