# Create your first bot

Your first bot runs right on your own computer, in the foreground. It uses
whichever AI-agent CLI you already have installed and logged in — Claude
Code, Codex, or OpenCode — so there's nothing new to authenticate: the bot just
drives the tool you're already using. It's the fastest way to see the whole
thing work end to end, and you get live logs and Ctrl-C to stop.

```bash
npm install
npm run create -- mycoolbot --brain claude --owner yourname.42
npm start -- mycoolbot --greet
```

Every subcommand works this way from the repo root (`npm run list`, `npm run
info -- mycoolbot`, …) — the `--` separates npm's arguments from the bot's. For
the short `pca` form without the npm ceremony, run `npm link` once inside
`bot-core/`; the rest of these docs use `pca`.

::: info Keeping it running
A local bot is only alive while the `pca run` process is — close the terminal
or sleep the laptop and it stops answering. When you're ready for a bot that
stays online around the clock, the next page shows how to
[deploy the same bot to a server](/guide/deploy). You create it once here, then
deploy that identity.
:::

## What `create` does

`create` generates the bot's identity, registers a username on the network, and
restricts the bot so only the `--owner` account can message it. The owner can be
an app username, an SS58 address, or a 32-byte account id in hex.

It prints a link and a username (for example `mycoolbot.07`). Open the link, or
search the username in the Polkadot app, and send a message. Registration is
usually confirmed within a few minutes; `pca info mycoolbot` re-checks.

The number suffix is a network-assigned discriminator, since base names are not
unique. Pass `--digits NN` to request a specific one; if it is taken, `create`
says so before registering anything.

## Access and cost

Because an AI brain spends your quota, `create` locks the bot to you by default
— `--owner <who>` or `--allow a,b`, enforced before a message ever reaches the
brain. Opening it to anyone takes an explicit `--public`, with real cost and
policy consequences. That decision has its own page:
[Private & public bots](/guide/access).

## First reply

If a reply takes longer than about five seconds, the bot sends a configurable
"thinking" acknowledgement so the chat doesn't look stalled — it then edits that
one message through progress into the final answer. Session state is persisted
per bot, so conversations continue across restarts.

`--greet` makes the bot message its owner first on startup — a proof of life, so
you don't have to find and message it. It greets each allowlisted owner once
ever, never into an existing thread.
