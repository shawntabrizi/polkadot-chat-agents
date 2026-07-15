# Files & storage

Attachments have two useful modes: give the bot a file for one task, or keep a
file with this conversation for later. Both the default Polkadot-app transport
and T3ams use that model, but T3ams carries media through its own encrypted
Bulletin path; its limits and return allowance are separate.

## Give the bot a file for one task

Attach a photo, document, or other file to a normal message. The bot downloads
it into a private working directory for that turn, so a request such as "read
this brief and turn it into a plan" works naturally. That temporary copy is
removed when the turn finishes.

The raw download is kept separately in the bot's private media cache for a
bounded TTL. The default transport uses `BOT_MEDIA_TTL_HOURS`; T3ams uses
`BOT_T3AMS_MEDIA_TTL_HOURS`. It is not a saved chat file and is evicted
automatically.

This is the default for anything the bot only needs once.

## T3ams photos, media, and documents

T3ams rich text can carry encrypted Bulletin/HOP attachments. A valid reference
is authenticated and checked before the bot fetches it; it is not an arbitrary
web URL. The claim ticket that decrypts the bytes stays in the private transport
state and is never passed to a direct brain, framework, log, or bridge payload.

By default, T3ams accepts up to **eight** attachments per message, at most
**25 MiB** each, for any valid MIME type. Image dimensions and audio/video
duration are retained as metadata when supplied. That broad default is about
interoperability, not trust: all bytes remain untrusted input, and an agent
should not execute a received file merely because it was accepted.

For a public or specialized bot, narrow the admission policy with
`BOT_T3AMS_ATTACHMENT_MIME_TYPES`. It accepts comma-separated exact MIME types
such as `image/png` and type wildcards such as `image/*`; `*/*` restores the
default broad policy. `BOT_T3AMS_ATTACHMENT_MAX_BYTES` can only lower the
25 MiB cap, and `BOT_T3AMS_ATTACHMENT_MAX_COUNT` may be set from `0` through
the hard limit of 16. `BOT_T3AMS_ATTACHMENT_MAX_DURATION_MS` bounds declared
audio/video duration metadata (seven days by default). See
[Configuration](/reference/configuration#t3ams-media-and-file-vault).

A direct brain with the portable `read` capability can inspect a staged private
copy for the current turn, not the media-cache path. The default no-tools policy
cannot inspect those staged bytes. A bridge framework gets safe metadata and an
authenticated, opaque `/media/<id>` URL; it can fetch that URL when it needs the
bytes. The bridge may download and verify the attachment on demand, so
`downloaded: false` is only a cache hint, not a reason to discard the URL.

A direct turn with the portable `write` capability can return its own generated
files too. bot-core gives a turn a private `PCA_OUTPUT_DIR` and attaches only
bounded, top-level regular files written there; it ignores symlinks and nested
paths, then deletes the directory after delivery. The default no-tools policy
cannot write those files. Set
`BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS=0` to disable that return path.
`BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` caps the batch as well as the normal
per-file attachment limit. The transport first copies accepted output into a
private durable turn outbox with the final reply chunks, so a retry can deliver
the same answer, image, or document without asking the agent to recreate it.
The outbox uses separate global file and reply budgets
(`BOT_T3AMS_AGENT_OUTBOX_*` and `BOT_T3AMS_REPLY_OUTBOX_*`). If Bulletin upload
or generic-file MIME delivery is unavailable, the bot withholds
`PCA_OUTPUT_DIR` and continues to return text normally.

## Keep a file with the chat

To save an attachment, attach exactly one file and make the message caption:

```text
/file put references/brief.pdf
```

The file is stored in a durable vault for this conversation. Other DMs cannot
list or retrieve it. A T3ams workspace channel intentionally shares one vault
between the channel's members, while each T3ams DM has its own vault. Names may
use folders, but must be relative paths; `..`, leading slashes, and backslashes
are rejected. To replace an existing saved file, add `--force`:

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

### T3ams return path

For T3ams, `/file get` uploads the saved regular file as a new encrypted
Bulletin attachment. A bridge framework can do the same by first putting bytes
in that conversation's vault and calling `POST /send` with `file_path`; it may
also attach a caption or reply target, but cannot edit a file message.

This path requires a trusted `BOT_T3AMS_BULLETIN_RPC` and a separately funded
T3ams Bulletin upload allowance. Setting the RPC variable explicitly empty puts
the bot in metadata-only mode: it can describe a valid attachment, but cannot
retrieve bytes or deliver a file. The normal `pca storage` allowance flow is for
the default Polkadot-app transport; it does not prove or provision T3ams
Bulletin capacity.

### Default Polkadot-app return path

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

For the default Polkadot-app transport, the automatic allowance is limited to
private bots on the named Paseo testnet profile. Public bots and custom network
endpoints are excluded so strangers cannot spend a finite upload allowance by
default. A public bot receives an attachment reference, but only downloads its
bytes after you configure trusted `BOT_HOP_ALLOWED_NODES`; keep outbound file
delivery disabled unless you have deliberately funded and bounded it.

T3ams has no automatic Bulletin upload grant. Public T3ams bots should keep the
attachment count, size, MIME admission policy, media cache, file vault, and
agent workspace deliberately tight before exposing the bot to arbitrary people.
Use a trusted Bulletin RPC only; attachment references never grant the sender a
way to make the bot fetch an arbitrary HTTP, filesystem, or data URL.

Production needs an explicit local operator flow with the original
mnemonic-derived person proof. Keep that proof off the VPS and out of the bot
runtime. The [configuration reference](/reference/configuration#paseo-testnet-file-delivery)
explains the runtime HOP settings; it does not automate production allocation.

## Framework bots

The `/file` commands work for direct, echo, and bridge bots. A framework with
the bridge token can also manage the same chat-scoped vault and return a saved
file through the bridge API. It must first place the file in that peer's vault;
the API never accepts an arbitrary host path as something to send. For T3ams,
the bridge receives opaque media URLs rather than raw Bulletin credentials and
can send only a vault `file_path` as a fresh encrypted attachment. See the
[Bridge HTTP API](/reference/bridge#t3ams-rich-chat).
