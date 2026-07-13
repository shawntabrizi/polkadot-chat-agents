---
layout: home

hero:
  name: "Polkadot Chat Agents"
  text: "AI coding agents, in your chat."
  tagline: >
    Run Claude Code, Codex, or OpenCode as a bot you message from the Polkadot
    app. No chat server, no public IP — end-to-end encrypted over the Statement
    Store. A bot is just a process with an outbound connection.
  image:
    light: /logo-symbol-dark.svg
    dark: /logo-symbol-light.svg
    alt: Polkadot
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Configuration
      link: /reference/configuration
    - theme: alt
      text: GitHub
      link: https://github.com/shawntabrizi/polkadot-chat-agents

features:
  - title: No chat server
    details: >
      Messages travel over the Polkadot Statement Store, a decentralized
      store-and-forward layer. Conversations are end-to-end encrypted. The bot
      needs no inbound ports, no webhook, and no hosting platform.
  - title: Real coding agents
    details: >
      Direct engines run a headless agent CLI — verbatim prompts, native session
      resume, and real tools (bash, read, edit, write) inside a container that is
      their sandbox. Claude Code, Codex, and OpenCode are built in.
  - title: Projects & git worktrees
    details: >
      Point a conversation at a repo with /project, or /project name@branch for
      an isolated worktree. Per-peer, so different people can work in different
      repositories with the same bot.
  - title: Bring your own framework
    details: >
      Prefer memory, tools, and a persona? Bridge mode hands each message to an
      agent framework over a small authenticated HTTP API. Hermes and OpenClaw
      integrations are included.
  - title: Built to survive restarts
    details: >
      Sessions, the dedup set, and a crash-durable owed-reply journal persist to
      disk and rebuild on startup. A message is acknowledged only once it is
      safely recorded.
  - title: Runs anywhere Node runs
    details: >
      Install with npm, create and register an identity, and deploy to any
      Docker + SSH box with one command. Laptop or a small VPS — your choice.
---
