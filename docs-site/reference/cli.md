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
| `pca prepare-host --host <ssh>` | Explicitly install PCA's confined Linux sandbox profile for Docker Claude workspace Bash. |
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
| `--brain <b>` | create | `echo`, `claude`, `codex`, `opencode`, `bridge`. |
| `--owner <who>` | create | Lock to one account (username, SS58, or hex). |
| `--allow a,b` | create | Allowlist several accounts. |
| `--public` | create | Allow anyone to message it (required for a paid brain left open). |
| `--username <u>` / `--digits NN` | create | Network username base (six or more lowercase letters) / requested discriminator. Use a separate `--username` when the bot name has digits or hyphens other than its optional `.NN` suffix. |
| `--model <m>` | create, run, deploy | Pin the model (saved at create; overrides per run/deploy). |
| `--greet` | run, deploy | Message allowlisted owners once on startup. |
| `--network paseo` | create | Use the named default network. Private bots on this profile receive automatic testnet file-delivery setup. |
| `--no-register` | create | Create the identity locally; complete registration later with `pca register`. |
| `--wait <seconds>` | create, register | How long to wait for on-chain registration confirmation. |
| `--host <ssh>` | deploy, prepare-host, logs, status, stop | Target server (saved after first deploy). |
| `--harness openclaw or hermes` | deploy | Agent framework for a bridge bot. |
| `--allowed-tools <read,write,bash>` | run, deploy | Select exact lowercase portable direct-agent capabilities. `write` includes `read`; `bash` includes both. |
| `--tool-scope workspace\|container` | run, deploy | Scope direct-agent tools to the selected workspace (default) or deliberately to all files visible to the non-root agent account in its container. |
| `--tool-network none\|internet` | run, deploy | Request no tool-process network egress (default) or internet access. `internet` requires `bash`; engine enforcement is reported at startup/deploy time. |
| `--dry-run` | deploy | Print the generated files without deploying. |

Bots live in `~/.pca/bots/<name>/` (override with `PCA_BOTS_DIR`).

Direct Claude, Codex, and OpenCode runs and deployments start with no tools: empty
capabilities, workspace scope, and no tool network. The same portable policy
is available to public and allowlisted bots, so every sender of a public bot
can direct whatever capabilities its deployer selects. A `read`-capable turn
can inspect its staged inbound attachment; a `write`-capable turn can produce a
returnable file. See [Private & public bots](/guide/access) for the trust
boundary and engine enforcement caveats.

For Bash, OpenCode requires `--tool-network internet` because it has no network
sandbox. Claude requires internet for container-scoped Bash but can use `none`
for workspace-scoped Bash; Codex can keep `none` in either scope. Deploy
validates the combination and prints the effective enforcement.

For Docker Claude workspace Bash, first run
`pca prepare-host --host root@your-server`. Deploy then verifies a real
Bubblewrap sandbox before it replaces the bot; it does not use privileged
containers, add `CAP_SYS_ADMIN` to the outer Docker container, use
`userns=host`, or use unconfined Docker security settings. Docker mode sets
Claude's `allowAllUnixSockets: true`, opting out of its optional Unix-socket
seccomp filter without enabling `enableWeakerNestedSandbox`. Sandboxed Bash
still has Bubblewrap's filesystem, fresh-`/proc`, and IP-network boundaries;
with `--tool-network none`, it has no IP egress, but can still reach
Unix-domain sockets visible inside the container. Generated direct-agent
services mount no Docker or host socket—do not add one.

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
