# Deploy to a server

`deploy` targets any machine reachable over SSH that has Docker installed:

```bash
pca deploy mycoolbot --host root@your-server

pca status mycoolbot
pca logs mycoolbot -f
pca stop mycoolbot
```

`deploy` uploads `bot-core`, generates a compose file and a `bot.env`, starts
the container with a persistent state volume, and waits for the bot to come
online. Add `--dry-run` to preview the generated files without deploying.

## Direct engines

`echo`, `claude`, `codex`, and `opencode` deploy as a **single container**: the
transport process holds the seed and writes `/state`, while the agent CLI it
spawns is dropped to a non-root user that can only touch its `/workspace` and
OAuth home — it can't read the seed or the session state. The container is
read-only except for those volumes and a size-capped `tmpfs`.

After a direct deployment, run the printed one-time CLI login command (for a
claude bot, `claude setup-token` inside the container) so the agent can
authenticate through its mounted OAuth home. Those credentials survive restarts
and redeploys.

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

## Next

- [Configuration reference](/reference/configuration)
- [Agent frameworks](/guide/harnesses)
