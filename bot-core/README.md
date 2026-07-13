# polkadot-chat-agents

Run an AI chat bot that people can message from the Polkadot app. Replies come
from a model CLI (Claude, Codex, or opencode) or an agent framework (Hermes,
OpenClaw). There is no chat server: messages travel over the Statement Store and
conversations are end-to-end encrypted, so a bot is just a process with an
outbound connection to a public RPC node.

```bash
npm install -g polkadot-chat-agents

pca create mycoolbot --brain claude --owner <your-app-username>
pca run mycoolbot --greet
```

`create` generates the bot's identity, registers a username on the network
(currently the Paseo testnet), and locks the bot to your account. With
`--greet`, the bot messages you first — watch your phone.

Requirements: Node 22+, and for an AI brain the model's CLI installed and
logged in (for example [Claude Code](https://claude.com/claude-code)). Use
`--brain echo` for a zero-dependency smoke test.

Highlights:

- `pca deploy mybot --host root@server` ships the bot to any Docker+SSH box,
  including two-container agent-framework stacks (`--harness openclaw|hermes`).
- In-chat commands (`/help`, `/reset`, `/model`, `/project`, `/ping`), a
  "thinking" acknowledgement for slow replies, and per-bot model pinning
  (`--model`).
- Multi-project workspaces: `pca project <bot> add <alias> <path>`, then
  `/project <alias>` in chat (or `/project <alias>@<branch>` for an isolated
  git worktree) points the agent at that repo.
- Long answers arrive as several ordered messages (split at paragraph and
  code-fence boundaries), never as one failed oversized send.
- Conversations survive restarts; state lives in `~/.pca/bots/<name>/`.

Full documentation, architecture notes, and the framework plugins live in the
[repository](https://github.com/shawntabrizi/polkadot-chat-agents).
