# CLI commands

The `pca` command manages a bot's whole lifecycle. From the repo root without
`npm link`, every command is `npm run <cmd> -- <args>` (or `npm start -- …` for
`run`); with `npm link` in `bot-core/`, it's just `pca <cmd>`.

| Command | Purpose |
|---|---|
| `pca create <name>` | Generate an identity, register a username, and save the bot. |
| `pca register <name>` | Finish or retry registration for an existing bot. |
| `pca run <name>` | Start the bot locally in the foreground. |
| `pca deploy <name> --host <ssh>` | Ship it to a Docker + SSH server and run it. |
| `pca logs <name> [-f]` | Tail a deployed bot's logs. |
| `pca status <name>` | Is the bot running and healthy? (local or deployed) |
| `pca stop <name>` | Stop a deployed bot. |
| `pca delete <name> --yes` | Delete a local bot (destroys its key — irreversible). |
| `pca list` | List your bots. |
| `pca info <name>` | Show the address and how to message it. |
| `pca project <name> …` | Manage the project registry (`add`, `rm`). |
| `pca model <name> …` | Manage the `/model` switching policy (`allow`, `open`). |

## Common flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--brain <b>` | create | `echo`, `claude`, `codex`, `opencode`, `bridge`/`hermes`. |
| `--owner <who>` | create | Lock to one account (username, SS58, or hex). |
| `--allow a,b` | create | Allowlist several accounts. |
| `--public` | create | Allow anyone to message it (required for a paid brain left open). |
| `--username <u>` / `--digits NN` | create | Network username base / requested discriminator. |
| `--model <m>` | create, run, deploy | Pin the model (saved at create; overrides per run/deploy). |
| `--greet` | run, deploy | Message allowlisted owners once on startup. |
| `--host <ssh>` | deploy, logs, status, stop | Target server (saved after first deploy). |
| `--harness openclaw\|hermes` | deploy | Agent framework for a bridge bot. |
| `--safe-tools` | deploy | Restrict a direct engine to a read/write/edit/bash allowlist. |
| `--dry-run` | deploy | Print the generated files without deploying. |

Bots live in `~/.pca/bots/<name>/` (override with `PCA_BOTS_DIR`).

For every runtime environment variable, see [Configuration](/reference/configuration).
