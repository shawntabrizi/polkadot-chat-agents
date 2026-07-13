# CLI commands

The `pca` command manages a bot's whole lifecycle. Install it with
`npm install -g polkadot-chat-agents` to use `pca <command>`. From a source
checkout, use the universal form `npm run pca -- <command> <args>`; it works for
every command, including `project`, `model`, and `storage`.

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
| `pca storage <name> [status, grant, or recover]` | Inspect, provision, or recover the private Paseo testnet file allowance. |

## Common flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--brain <b>` | create | `echo`, `claude`, `codex`, `opencode`, `bridge`/`hermes`. |
| `--owner <who>` | create | Lock to one account (username, SS58, or hex). |
| `--allow a,b` | create | Allowlist several accounts. |
| `--public` | create | Allow anyone to message it (required for a paid brain left open). |
| `--username <u>` / `--digits NN` | create | Network username base (six or more lowercase letters) / requested discriminator. Use a separate `--username` when the bot name has digits or hyphens other than its optional `.NN` suffix. |
| `--model <m>` | create, run, deploy | Pin the model (saved at create; overrides per run/deploy). |
| `--greet` | run, deploy | Message allowlisted owners once on startup. |
| `--network paseo` | create | Use the named default network. Private bots on this profile receive automatic testnet file-delivery setup. |
| `--no-register` | create | Create the identity locally; complete registration later with `pca register`. |
| `--wait <seconds>` | create, register | How long to wait for on-chain registration confirmation. |
| `--host <ssh>` | deploy, logs, status, stop | Target server (saved after first deploy). |
| `--harness openclaw or hermes` | deploy | Agent framework for a bridge bot. |
| `--safe-tools` | deploy | For a private, trusted Claude bot, opt in to the conventional `Bash,Read,Edit,Write` tool list. |
| `--allowed-tools <list>` | deploy | For a private, trusted Claude bot, opt in to this exact comma-separated tool list (for example `Read`). |
| `--full-autonomy` | deploy | For a private, trusted direct bot, explicitly bypass the engine's permission controls. Cannot be combined with `--safe-tools` or `--allowed-tools`. |
| `--dry-run` | deploy | Print the generated files without deploying. |

Bots live in `~/.pca/bots/<name>/` (override with `PCA_BOTS_DIR`).

Direct Claude deployments start with no model tools. A public built-in AI direct
bot is limited to Claude's hardened no-tools profile: it rejects
`--safe-tools`, non-empty `--allowed-tools`, and `--full-autonomy`. Use a
private allowlist before enabling tools, or an externally isolated bridge
runtime when a public bot must analyze files or use tools. See
[Private & public bots](/guide/access) for the trust boundary.

## Private Paseo file allowance

For a private bot on the default Paseo profile, `create`, `register`, and a
non-dry-run `deploy` automatically check the separate account that returns
saved files and request a testnet allowance when it is needed. Normal users do
not need the Bulletin Console.

`pca storage <name> status` is read-only. Run `grant` only when the status says
capacity is missing, low, or expired. After an interrupted or uncertain
submission, wait for any pending transaction, run `status`, then run `recover`.
`recover --yes` only clears the local guard after you have established that the
old transaction cannot finalize; it never submits another grant. See
[Files & storage](/guide/files) for the user workflow and boundaries.

For every runtime environment variable, see [Configuration](/reference/configuration).
