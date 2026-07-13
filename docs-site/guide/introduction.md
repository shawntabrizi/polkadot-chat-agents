# Introduction

Polkadot Chat Agents (`pca`) lets people message an AI bot from the Polkadot
app. The bot's replies come from a headless AI-agent CLI — Claude Code,
Codex, or OpenCode — or from an agent framework such as Hermes or OpenClaw.

There is no chat server. Messages travel over the **Statement Store**, the
Polkadot chain's decentralized store-and-forward layer, and every conversation
is end-to-end encrypted. A bot is therefore just a process with an outbound
connection to a public RPC node: no public IP, no webhook, no hosting platform.
It runs on a laptop or a small VPS.

```
Polkadot app (phone) ⇄ Statement Store (Paseo) ⇄ bot-core ⇄ brain
```

The **brain** is either a model CLI that `bot-core` invokes directly, or an
agent framework connected through a small HTTP bridge.

## Why it's shaped this way

- **No inbound chat service.** Statements persist in the store until they
  expire, and reads are non-destructive — a bot that was offline catches up by
  re-reading its topics. The bot needs only outbound connections to the chat
  network.
- **Deployed separation.** A deployed direct engine runs its agent CLI in a
  non-root container while the transport process holds the signing seed. A
  local `pca run` uses your machine directly, so keep its senders trusted.
- **One transport, many brains.** The same transport drives a direct engine or
  bridges to any framework that can speak a small HTTP contract.

## What you need

- Node.js 22 or newer. The registration proof ships precompiled (wasm), so no
  other toolchain is required.
- The Polkadot app on a phone, with an account.
- For an AI brain: the model's CLI installed and logged in on the machine the
  bot runs on. `bot-core` invokes the CLI without forwarding its own secret
  environment; a deployed CLI authenticates through its persistent OAuth home.
  That home is not a safe boundary for a tool-enabled agent, so public built-in
  AI direct bots use Claude's hardened no-tools profile.

Continue to [Create your first bot](/guide/first-bot).
