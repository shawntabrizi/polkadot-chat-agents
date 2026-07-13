# Create your first bot

```bash
npm install
npm run create -- mycoolbot --brain claude --owner yourname.42
npm start -- mycoolbot --greet
```

Every subcommand works this way from the repo root (`npm run list`, `npm run
info -- mycoolbot`, …) — the `--` separates npm's arguments from the bot's. For
the short `pca` form without the npm ceremony, run `npm link` once inside
`bot-core/`; the rest of these docs use `pca`.

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

Because an AI brain spends your quota, `create` refuses to leave one open to
arbitrary senders unless you pass `--public`. Restrict it instead:

- `--owner <who>` — lock it to a single account.
- `--allow a,b` — an allowlist of several accounts.

The allowlist is enforced in the transport, before a message ever reaches the
brain, so unlisted senders never spend your model quota.

## First reply

If a reply takes longer than about five seconds, the bot sends a configurable
"thinking" acknowledgement so the chat doesn't look stalled — it then edits that
one message through progress into the final answer. Session state is persisted
per bot, so conversations continue across restarts.

`--greet` makes the bot message its owner first on startup — a proof of life, so
you don't have to find and message it. It greets each allowlisted owner once
ever, never into an existing thread.

## Next

- [Deploy to a server](/guide/deploy)
- [Brains & engines](/guide/brains)
