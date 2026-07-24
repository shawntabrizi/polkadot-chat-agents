# Create your first bot

Your first bot runs right on your own computer, in the foreground. It uses
whichever AI-agent CLI you already have installed and logged in — Claude
Code, Codex, or OpenCode — so there's nothing new to authenticate: the bot just
drives the tool you're already using. It's the fastest way to see the whole
thing work end to end, and you get live logs and Ctrl-C to stop.

## Install

Install the `pca` command with Node.js 22 or newer:

```bash
npm install -g polkadot-chat-agents
```

Install and sign in to the AI-agent CLI you want the bot to use before creating
it: [Claude Code](https://code.claude.com/docs/en/setup),
[Codex CLI](https://developers.openai.com/codex/cli/), or
[OpenCode](https://opencode.ai/docs/). For a no-model transport check, use
`--brain echo` instead.

If you are working from a source checkout, run `npm install` at the repository
root and use `npm run pca -- <command> ...` in place of `pca <command> ...`.

## Create and run

```bash
pca create mycoolbot --brain claude --owner <your-app-username-or-SS58-address>
pca run mycoolbot --greet
```

The default network is Paseo Next v2, whose test registration service does not
require a separate enrollment credential.

### Opting into Products Devnet

Products Devnet remains available explicitly. Ask its operator for one
single-use enrollment voucher per bot, then keep that secret out of your shell
history and process arguments:

```bash
read -s PCA_IDENTITY_VOUCHER
export PCA_IDENTITY_VOUCHER
pca create mycoolbot --network devnet --brain claude --owner <your-app-username-or-SS58-address>
unset PCA_IDENTITY_VOUCHER
```

`pca` exchanges the voucher for an identity-backend session, never saves the
voucher, and removes the saved session after the username claim succeeds. If
registration is interrupted after the exchange, retry without presenting the
voucher again:

```bash
pca register mycoolbot
```

For controlled automation, `PCA_IDENTITY_TOKEN` can supply an already-issued
Devnet bearer token instead. The dedicated
[Products Devnet guide](/guide/devnet) covers local macOS testing, safe retries,
and why a local emulator cannot mint a token accepted by the hosted service.

::: info Keeping it running
A local bot is only alive while the `pca run` process is — close the terminal
or sleep the laptop and it stops answering. When you're ready for a bot that
stays online around the clock, the next page shows how to
[deploy the same bot to a server](/guide/deploy). You create it once here, then
deploy that identity.
:::

## What `create` does

`create` generates the bot's identity and registers a username on the network.
In the command above, `--owner` restricts the bot so only that account can
message it. The owner can be an app username, an SS58 address, or a 32-byte
account id in hex.

It prints a link and a username (for example `mycoolbot.07`). Open the link, or
search the username in the Polkadot app, and send a message. Registration is
usually confirmed within a few minutes; `pca info mycoolbot` re-checks.

The number suffix is a network-assigned discriminator, since base names are not
unique. Pass `--digits NN` to request a specific one; if it is taken, `create`
says so before registering anything.

The local bot name can include lowercase letters, digits, and hyphens, but a
registered network username base must be at least six lowercase letters. When a
bot name contains digits or hyphens other than the optional `.NN` discriminator,
provide a separate valid base such as `--username mycoolbot`; use `--no-register`
only when you intend to register later.

For a private bot on the default Paseo profile—or on Products Devnet selected
with `--network devnet`—`create` also prepares a separate testnet account used
only to return saved files. The local CLI checks and provisions its allowance
automatically; no portal visit is part of the normal setup. See
[Files & storage](/guide/files) for the file workflow and what to do only if
that automatic check is interrupted.

## Access and cost

Because an AI brain spends your quota, `create` requires `--owner <who>` or
`--allow a,b`, enforced before a message ever reaches the brain, or an explicit
`--public`. An `echo` bot can be created open with an empty allowlist. Opening a
paid bot to anyone has real cost and policy consequences. That decision has its
own page:
[Private & public bots](/guide/access).

## First reply

If a reply takes longer than about five seconds, the bot sends a configurable
"thinking" acknowledgement so the chat doesn't look stalled — it then edits that
one message through progress into the final answer. Session state is persisted
per bot, so conversations continue across restarts.

`--greet` makes the bot message its owner first on startup — a proof of life, so
you don't have to find and message it. It greets each allowlisted owner once
ever, never into an existing thread.
