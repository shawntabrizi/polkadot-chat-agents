# Brains & engines

A bot's **brain** is what produces its replies. Pick it with `--brain` at
`create`.

Direct engines run a headless AI-agent CLI with verbatim prompts and native
session memory (`--resume`). Claude, Codex, and OpenCode start with no tools;
their deployer may select the same portable policy for either public or
allowlisted bots. The CLI retains its OAuth home inside that bot's container so
it can authenticate; container-scoped native file tools and Bash can access it.

| `--brain` | Replies come from | Reaches | Authentication |
|---|---|---|---|
| `claude` | the `claude` CLI | Claude models | Claude Code login |
| `codex` | the `codex` CLI | OpenAI models | ChatGPT / Codex login |
| `opencode` | the `opencode` CLI | many providers via `--model provider/model` | `opencode auth login` |
| `echo` | bot-core itself (repeats the message) | — | none |
| `bridge` | an agent framework over the HTTP bridge | — | the framework's |

`opencode` is the many-models path — one engine reaches Anthropic, OpenAI,
Google, xAI, OpenRouter, local models, and more.

## Tool policy

Use `pca deploy --allowed-tools read,write,bash` to select exact lowercase
outcome capabilities. `write` includes `read`, and `bash` includes both.
`--tool-scope workspace|container` scopes native file tools. The default is no
capabilities and workspace scope.
A read-capable turn can inspect its staged attachment, and a write-capable turn
can produce returnable files.

Workspace scopes native file tools to the normal project working area; container
scope deliberately exposes all files visible to the non-root agent account,
including its OAuth home. Bash uses the agent process boundary in either scope:
the dedicated bot container for a deployment, or the local process account for
`pca run`. Treat local Bash bots as trusted-machine tools. Do not mount unrelated
host repositories, credentials, Docker sockets, or home directories into a
deployed bot container. See [Private & public bots](/guide/access) for the boundary.

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
