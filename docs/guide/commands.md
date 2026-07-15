# In-chat commands

Direct-engine bots (claude / codex / opencode) answer a small set of slash
commands themselves, instantly, without invoking the model. `/file` is a
transport command handled before either a direct engine or a framework sees the
message, so it also works with bridge and echo bots. Other slash commands are
left to the framework in bridge mode.

| Command | What it does |
|---|---|
| `/help` | List the commands this bot supports. |
| `/reset` | Start a fresh session — forget the conversation so far (drops the engine's native resume token). |
| `/stop` | Stop the turn currently running. Intercepted before the work queue, so it cancels the very turn it means to. |
| `/model` | Show the active model. `/model <name>` switches (if allowed); `/model default` reverts. See [model policy](/guide/brains#model-switching-in-chat). |
| `/reasoning` | Show reasoning effort. `/reasoning <level>` sets it (claude / codex); `/reasoning default` reverts. |
| `/project` | Show or switch the working project. `/project <name>[@branch]`, `/project default`. See [Projects](/guide/projects). |
| `/file` | Save, list, inspect, remove, or return a file kept for this chat. See [Files & storage](/guide/files). |
| `/usage` | Tokens and cost spent on this chat since the bot's last restart. |
| `/ping` | Check the bot is alive and see chain-connection state. |

A command-shaped message that isn't a known command (a typo like `/rest`) is
redirected to `/help` rather than handed to the model. Text that merely starts
with `/` but isn't command-shaped still goes to the model.

## Discovery

The very first reply a direct-engine bot sends a new peer carries a one-time
`/help` hint, so a user learns the commands exist without having to ask.
