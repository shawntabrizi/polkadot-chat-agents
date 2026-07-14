# Brains & engines

A bot's **brain** is what produces its replies. Pick it with `--brain` at
`create`.

Direct engines run a headless AI-agent CLI with verbatim prompts and native
session memory (`--resume`). Claude, Codex, and OpenCode start with no tools;
their deployer may select the same portable policy for either public or
allowlisted bots. Workspace scope is the normal project boundary, while
container scope deliberately exposes the non-root agent account's OAuth home.
Use a separately isolated bridge runtime when that is not an acceptable
credential boundary.

| `--brain` | Replies come from | Reaches | Authentication |
|---|---|---|---|
| `claude` | the `claude` CLI | Claude models | Claude Code login |
| `codex` | the `codex` CLI | OpenAI models | ChatGPT / Codex login |
| `opencode` | the `opencode` CLI | many providers via `--model provider/model` | `opencode auth login` |
| `echo` | bot-core itself (repeats the message) | — | none |
| `hermes` / `bridge` | an agent framework over the HTTP bridge | — | the framework's |

`opencode` is the many-models path — one engine reaches Anthropic, OpenAI,
Google, xAI, OpenRouter, local models, and more.

## Tool policy

Use `pca deploy --allowed-tools read,write,bash` to select exact lowercase
outcome capabilities. `write` includes `read`, and `bash` includes both.
`--tool-scope workspace|container` chooses the filesystem boundary;
`--tool-network none|internet` selects tool-process egress (`internet` requires
`bash`). The default is no capabilities, workspace scope, and no tool network.
A read-capable turn can inspect its staged attachment, and a write-capable turn
can produce returnable files.

For Bash, OpenCode requires `--tool-network internet` because it has no network
sandbox. Claude requires internet for container-scoped Bash but can use `none`
for workspace-scoped Bash; Codex can keep `none` in either scope. `pca deploy`
validates the combination and reports the effective enforcement.

The policy is not a general credential sandbox: the OAuth home is visible to
the agent under container scope. Claude and Codex provide native workspace
enforcement for their applicable policies; OpenCode's Bash policy remains
bounded by the container rather than an OS filesystem sandbox. See
[Private & public bots](/guide/access) for the boundary.

## Pinning a model

`--model` pins the model (`BOT_AI_MODEL`; a `provider/model` slug for opencode).
Set it at `create` (saved to the bot) or override per run. `BOT_AI_CMD` /
`BOT_AI_ARGS` wire in a custom CLI that speaks claude-shaped stream-json.

## Model switching in chat

`/model` always shows the active model. Whether a chat user can *switch* it is a
policy decision, because switching to an expensive model spends the owner's
quota:

- **Locked by default.** An unconfigured bot only shows the model.
- **Approved set.** `pca model <bot> allow model-a,model-b` lets chat users pick
  from that list (this is the only option for a public bot — unrestricted
  switching is never allowed publicly).
- **Open.** `pca model <bot> open` allows free switching, but only for a bot
  with an explicit allowlist (trusted peers).

## Reasoning effort

`/reasoning <level>` dials thinking depth per conversation on engines that
support it (claude, codex). `BOT_AI_REASONING` sets the default.
