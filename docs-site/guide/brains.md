# Brains & engines

A bot's **brain** is what produces its replies. Pick it with `--brain` at
`create`.

Direct engines run a headless AI-agent CLI as an autonomous agent — verbatim
prompts, native session memory (`--resume`), and real tools (bash, read, edit,
and write). A deployed bot runs those tools in a container; `pca run` uses the
local machine, so do not use it with untrusted senders.

| `--brain` | Replies come from | Reaches | Authentication |
|---|---|---|---|
| `claude` | the `claude` CLI | Claude models | Claude Code login |
| `codex` | the `codex` CLI | OpenAI models | ChatGPT / Codex login |
| `opencode` | the `opencode` CLI | many providers via `--model provider/model` | `opencode auth login` |
| `echo` | bot-core itself (repeats the message) | — | none |
| `hermes` / `bridge` | an agent framework over the HTTP bridge | — | the framework's |

`opencode` is the many-models path — one engine reaches Anthropic, OpenAI,
Google, xAI, OpenRouter, local models, and more.

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
