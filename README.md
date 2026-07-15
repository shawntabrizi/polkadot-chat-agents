<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/logo-wordmark-light.svg">
    <img src="docs/public/logo-wordmark-dark.svg" alt="Polkadot Chat Agents" width="420">
  </picture>

  *Run your own AI agents and talk to them from the Polkadot app — end-to-end encrypted, with no chat server.*

  [![npm](https://img.shields.io/npm/v/polkadot-chat-agents)](https://www.npmjs.com/package/polkadot-chat-agents)
  [![Documentation](https://img.shields.io/badge/docs-website-e6007a)](https://www.shawntabrizi.com/polkadot-chat-agents/)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
</div>

---

Polkadot app chat has no central server: messages travel over the Statement
Store, a decentralized store-and-forward layer, and every conversation is
end-to-end encrypted. That means a chat bot is just a process with an outbound
connection to a public RPC node — no public IP, no webhook, no hosting
platform. It runs on a laptop or a small VPS.

```
Polkadot app (phone) <-> Statement Store <-> bot-core <-> brain
```

The "brain" is the AI agent behind the bot: a coding-agent CLI that bot-core
drives directly, or an agent framework connected through a small HTTP bridge.

## Features

- **Bring your own agent** — replies come from Claude Code, Codex, or opencode
  (which reaches Anthropic, OpenAI, Google, local models, and more), or from an
  agent framework such as Hermes or OpenClaw.
- **Private by default** — conversations are end-to-end encrypted, and a bot
  answers only the accounts you allowlist unless you explicitly make it public.
- **A real agent, not a chat wrapper** — per-conversation session memory,
  file attachments in both directions, `/project` to point a conversation at a
  repo or git worktree, and in-chat commands like `/model` and `/usage`.
- **One-command deploy** — `pca deploy` ships the bot to any SSH + Docker host,
  with `status`, `logs`, and `stop` to operate it.
- **T3ams support** — the same bots can receive DMs and workspace mentions from
  the T3ams SPA, with live-updating replies and tool progress.

## Quick start

You need Node.js 22+, the Polkadot app on your phone, and your agent's CLI
(such as [Claude Code](https://code.claude.com/docs/en/setup)) installed and
logged in.

```bash
npm install -g polkadot-chat-agents

pca create mycoolbot --brain claude --owner yourname.42
pca run mycoolbot --greet
```

`create` generates the bot's identity, registers a username on the network,
and prints a link. Open it — or search for the username in the Polkadot app —
and send a message. `--greet` makes the bot message its owner first, as a
proof of life.

The project currently targets the Paseo testnet. From a source checkout, run
`npm install` at the repo root and use `npm run pca -- <command>` in place of
`pca <command>`.

## Documentation

The full documentation lives at
**[shawntabrizi.com/polkadot-chat-agents](https://www.shawntabrizi.com/polkadot-chat-agents/)**:

- [Create your first bot](https://www.shawntabrizi.com/polkadot-chat-agents/guide/first-bot) — from install to first reply
- [Deploy to a server](https://www.shawntabrizi.com/polkadot-chat-agents/guide/deploy) — Docker deployments over SSH
- [Brains & engines](https://www.shawntabrizi.com/polkadot-chat-agents/guide/brains) — choosing and configuring the AI behind the bot
- [Agent frameworks](https://www.shawntabrizi.com/polkadot-chat-agents/guide/harnesses) — Hermes, OpenClaw, and the bridge API
- [T3ams chat](https://www.shawntabrizi.com/polkadot-chat-agents/guide/t3ams) — DMs and workspace bots
- [Configuration reference](https://www.shawntabrizi.com/polkadot-chat-agents/reference/configuration) — every env var and CLI flag
- [How it works](https://www.shawntabrizi.com/polkadot-chat-agents/explanation/how-it-works) — the transport, sessions, and security model

The site source lives in [`docs/`](docs/) and every page reads fine as plain
markdown on GitHub. Contributors: the transport and session invariants are in
[explanation/architecture.md](docs/explanation/architecture.md), and headless
test recipes are in [guide/testing.md](docs/guide/testing.md).

## Repository layout

- [`bot-core/`](bot-core/) — the transport and the `pca` CLI; this is the published npm package.
- [`hermes-plugin/`](hermes-plugin/), [`openclaw-plugin/`](openclaw-plugin/) — agent-framework adapters.
- [`tools/bandersnatch-cli/`](tools/bandersnatch-cli/) — Rust source of the registration-proof helper (the wasm build is vendored in `bot-core/`).
- [`docs/`](docs/) — the documentation site source (VitePress); published via GitHub Pages.

## Security

Before deploying it for real use cases, you are responsible for:

- Reviewing the code yourself, we publish a reference, not a hardened production build
- Checking that the dependencies are up to date and free of known vulnerabilities
- Securing your own fork or deployment environment (keys, secrets, network configuration)
- Tracking the latest tagged release/commits for security fixes; older releases are not backported (exceptions might apply)

In particular, `~/.pca/bots/<name>/secret.json` holds the bot's root seed —
whoever has it controls the bot — and `session-state.json` holds the session
keys for open conversations. Back them up and never commit them.

For Parity's security disclosure process, and Bug Bounty program, feel free to visit: https://parity.io/bug-bounty

## License

[MIT](LICENSE)
