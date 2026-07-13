# Files & storage

Attachments have two useful modes: give the bot a file for one task, or keep a
file with this conversation for later.

## Give the bot a file for one task

Attach a photo, document, or other file to a normal message. The bot downloads
it into a private working directory for that turn, so a request such as "read
this brief and turn it into a plan" works naturally. That temporary copy is
removed when the turn finishes.

The raw download is kept separately in the bot's private media cache for up to
`BOT_MEDIA_TTL_HOURS` (48 hours by default), subject to its media-store limits.
It is not a saved chat file and is evicted automatically.

This is the default for anything the bot only needs once.

## Keep a file with the chat

To save an attachment, attach exactly one file and make the message caption:

```text
/file put references/brief.pdf
```

The file is stored in a durable vault for this chat. Other chat peers cannot
list or retrieve it. Names may use folders, but must be relative paths; `..`,
leading slashes, and backslashes are rejected. To replace an existing saved
file, add `--force`:

```text
/file put references/brief.pdf --force
```

Use these commands in the chat:

| Command | What it does |
|---|---|
| `/file` | Show file help. |
| `/file put <path>` | Save exactly one attached file under this chat. |
| `/file ls [prefix]` | List saved files, optionally below a folder prefix. |
| `/file info <path>` | Show the file type, size, and save time. |
| `/file get <path>` | Send a saved file back as an attachment. |
| `/file rm <path>` | Remove a saved file. |

Saved files remain until you remove them or erase the persistent state volume.
A deployed bot's state volume survives `pca stop`, so back it up before moving
a bot and manage the server-side state deliberately when retiring one.

## Returning a saved file

`/file get <path>` sends a file that is already saved for this chat. It does not
expose an arbitrary file from the bot's host or an agent's workspace.

For a private bot created with the default `--network paseo` profile, this works
without a separate portal step. `pca create`, `pca register`, and a normal
(non-dry-run) `pca deploy` use the local CLI to check a separate file-delivery
account and request or refresh its fixed Paseo testnet allowance when needed.
The allowance belongs to that separate account, not the bot's chat wallet, and
the automatic Paseo testnet request never sends the bot seed or a production
person proof to the faucet.

Check the allowance only when file return is not ready:

```bash
pca storage mybot status
```

If the result says it is missing, low, or expired, run:

```bash
pca storage mybot grant
```

After an interrupted, timed-out, or otherwise uncertain grant, do not retry it.
Wait for any pending transaction, then run `status` followed by:

```bash
pca storage mybot recover
```

When the allowance is already sufficient, `recover` clears the local guard
without submitting a transaction. Only use `recover --yes` after confirming an
old transaction cannot still finalize; it clears the guard only, so run `grant`
separately if the status still needs it.

## What is deliberately not automatic

The automatic allowance is limited to private bots on the named Paseo testnet
profile. Public bots and custom network endpoints are excluded so strangers
cannot spend a finite upload allowance by default. A public bot receives an
attachment reference, but only downloads its bytes after you configure trusted
`BOT_HOP_ALLOWED_NODES`; keep outbound file delivery disabled unless you have
deliberately funded and bounded it.

Production needs an explicit local operator flow with the original
mnemonic-derived person proof. Keep that proof off the VPS and out of the bot
runtime. The [configuration reference](/reference/configuration#paseo-testnet-file-delivery)
explains the runtime HOP settings; it does not automate production allocation.

## Framework bots

The `/file` commands work for direct, echo, and bridge bots. A framework with
the bridge token can also manage the same chat-scoped vault and return a saved
file through the bridge API. It must first place the file in that peer's vault;
the API never accepts an arbitrary host path as something to send. See the
[Bridge HTTP API](/reference/bridge).
