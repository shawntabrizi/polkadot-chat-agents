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
| `pca storage <name> [status, grant, or recover]` | Inspect, provision, or recover a private named-testnet file allowance. |

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
| `--network paseo` | create | Use Paseo Next v2 (the default). Private bots receive matching testnet file-delivery setup. |
| `--network devnet` | create | Use Polkadot Products Devnet. Its People, identity, Bulletin, HOP, and storage settings remain available; username writes require an enrollment credential. |
| `--no-register` | create | Create the identity locally; complete registration later with `pca register`. |
| `--wait <seconds>` | create, register | How long to wait for on-chain registration confirmation. |
| `--host <ssh>` | deploy, logs, status, stop | Target server (saved after first deploy). |
| `--harness openclaw or hermes` | deploy | Agent framework for a bridge bot. |
| `--allowed-tools <read,write,bash>` | run, deploy | Select exact lowercase portable direct-agent capabilities. `write` includes `read`; `bash` includes both. |
| `--tool-scope workspace\|container` | run, deploy | Scope native file tools to the selected workspace (default) or deliberately to all files visible to the non-root agent account in its container. Bash uses the agent process boundary in either scope. |
| `--dry-run` | deploy | Print the generated files without deploying. |

Bots live in `~/.pca/bots/<name>/` (override with `PCA_BOTS_DIR`).

## Products Devnet registration credential

The Products Devnet identity backend requires a bearer token for username
writes. Select it explicitly with `--network devnet`, obtain a single-use
enrollment voucher from the Devnet operator, and pass it through the
environment rather than a CLI flag:

```bash
read -s PCA_IDENTITY_VOUCHER
export PCA_IDENTITY_VOUCHER
pca create mycoolbot --network devnet --brain claude --owner yourname.42
unset PCA_IDENTITY_VOUCHER
```

`pca` proves possession of a fresh SR25519 client key, exchanges the voucher at
`/api/v1/auth/token`, and persists the returned refreshable session in
`secret.json` only while registration is incomplete. A retry uses that session,
so do not redeem the voucher twice:

```bash
pca register mycoolbot
```

`PCA_IDENTITY_TOKEN` accepts an already-issued bearer token for controlled
automation. The default Paseo profile retains its unauthenticated
username-registration flow. See [Use Products Devnet](/guide/devnet) for the
complete opt-in workflow and local testing options.

Direct Claude, Codex, and OpenCode runs and deployments start with no tools:
empty capabilities and workspace scope. The same portable policy is available
to public and allowlisted bots, so every sender of a public bot can direct
whatever capabilities its deployer selects.

- A `read`-capable turn can inspect its staged inbound attachment; a
  `write`-capable turn can produce a returnable file.
- Workspace scope applies to native file tools; Bash uses the agent process
  boundary.
- A deployment uses its dedicated bot container; local `pca run` uses the
  local process account, so treat it as a trusted-machine tool.

See [Private & public bots](/guide/access) for the trust boundary.

## Private named-testnet file allowance

For a private bot on the default Paseo profile or the explicit Products Devnet
profile, `create`, `register`, and a non-dry-run `deploy` automatically check
the separate account that returns saved files and request an allowance from
the matching testnet when it is needed. Normal users do not need the Bulletin
Console.

`pca storage <name> status` is read-only. Run `grant` only when the status says
capacity is missing, low, or expired. After an interrupted or uncertain
submission, wait for any pending transaction, run `status`, then run `recover`.
`recover --yes` only clears the local guard after you have established that the
old transaction cannot finalize; it never submits another grant. See
[Files & storage](/guide/files) for the user workflow and boundaries.

For every runtime environment variable, see [Configuration](/reference/configuration).
