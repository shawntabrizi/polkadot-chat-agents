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

Invalid attachment metadata does not make a message trusted: a valid text body
is still delivered with a safe attachment warning, while an attachment-only
message with an invalid reference is represented only as an unavailable-file
notice — never as fetched bytes.

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
cannot write those files.

Two settings bound the return path:

- `BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS=0` disables it entirely.
- `BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` caps the batch, on top of the normal
  per-file attachment limit.

Delivery is retry-safe. The transport first copies accepted output into a
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

For a private bot created on the default Products Devnet profile—or explicitly
with `--network paseo`—this works without a separate portal step. `pca create`,
`pca register`, and a normal (non-dry-run) `pca deploy` use the local CLI to
check a separate file-delivery account and request or refresh the selected
testnet's allowance when needed. The allowance belongs to that separate
account, not the bot's chat wallet, and the automatic testnet request never
sends the bot seed or a production person proof to the faucet.

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

## Bulletin attachments (spec 0012)

Clients that speak spec 0012 (the desktop client, pca) send an image or file
as a kind-250 `attachment` message instead of a HOP `richText`. The sender
encrypts the file with a fresh key (AES-256-GCM per 2,000,000-byte chunk),
stores each encrypted chunk with a feeless `TransactionStorage.store` on the
Bulletin chain, and sends one ordinary message with the key, the chunk hashes
(which are also the IPFS CIDs), the media metadata and a caption. The message
costs one statement; the file costs `ceil(size / 2 MB)` Bulletin
transactions. The chain keeps the ciphertext 14 days, and any device of the
recipient can fetch it, so it works for multi-device users and for groups.

**Receive.** On devnet and Paseo every bot reads kind 250 without setup. The
bot fetches each chunk by CID: `bitswap_v1_get` on its Bulletin node, then the
message's mirror, then the network's gateway. It checks each chunk's
BLAKE2b-256 hash, decrypts, checks the length, and stages the file for the
brain exactly like a HOP attachment (same media cache, same
`BOT_MEDIA_MAX_BYTES` cap, same per-turn directory). Logs:
`BOT_ATTACHMENT_RECEIVED` (sizes, media, chunk count) and
`BOT_ATTACHMENT_FETCHED` (bytes, sources, milliseconds). The key is never
logged or passed over the bridge.

**Send.** A file the bot returns (`/file get`, `POST /send` with `file_path`)
goes through Bulletin when the peer has sent the bot a kind-250 message in this
process, or when HOP upload is not configured. Phone users keep getting HOP.
The store is signed by the bot's `//allowance//bulletin//chat` account, which
needs a Bulletin authorization (`pca storage <bot> status`). On a named
testnet an operator may set `BOT_BULLETIN_AUTHORIZER=//Eve` to let the bot
grant itself when it runs short; the bot refuses that key on any other chain.
`BOT_BULLETIN_BUDGET_MB` and `BOT_BULLETIN_BUDGET_TXS` cap the uploads per UTC
day (the chain does not refuse a store over the authorization; it only lowers
its priority). The `echo` brain answers a Bulletin image with an image of its
own: the caption gives the dimensions read from the decrypted bytes.

**Live proof.** `bot-core/scripts/e2e-attachments.mjs` drives a locally running
echo bot from a registered test identity. It prints `CHAT_OK`, `AUTH_OK`,
`STORED <cid>`, `SENT … statements=1`, `BOT_DESCRIBE_OK`, `BOT_FETCH_OK` and
ends with `ATTACH_BOT_OK`:

```bash
PCA_BOTS_DIR=/tmp/pca-e2e BOT_BULLETIN_AUTHORIZER=//Eve node cli.mjs run <bot>   # a throwaway echo bot
node scripts/e2e-attachments.mjs --sender /tmp/pca-e2e/<tester> --bot /tmp/pca-e2e/<bot>
```

**Colour swatches** (`BOT_COLOR_SWATCH=1`, the pcdcolor bot) send generated
PNG swatches on the same path. `bot-core/scripts/e2e-color.mjs` proves it
against an echo bot started with `BOT_COLOR_SWATCH=1`: the text `#ff8800`
comes back as a 512×512 swatch (`COLOR_OK`), and a generated two-colour PNG
comes back as a swatch of its dominant colour (`COLOR_IMAGE_OK`). Same flags
as above.

### Devnet facts (measured 2026-09-24)

Gating check for spec 0012 on `wss://bullet.sik.rocks` ("Bulletin Paseo",
para 1010, genesis `0xe101f0fa…0a59`), with vector C1 of
`polkadot-chat-desktop/docs/spec/vectors-0012.md`:

| Step | Result |
|---|---|
| `authorize_account(5Fje7L52…dNQoY, 10 tx, 1,000,000 bytes)` signed by `//Eve` | accepted: tx `0x61aaaaad…2b92`, best block #970864; events `System.NewAccount`, `TransactionStorage.AccountAuthorized`, `SkipFeelessPayment.FeeSkipped`, `System.ExtrinsicSuccess`. Authorization: 10 transactions, 1,000,000 bytes, expires at block 1,172,464 (+201,600) |
| `store(c_0)` (31 bytes) from that account | tx `0xdcd8112d…2eca`, best block #970865 (`0x051328de…4993`), extrinsic 2; `Stored { index: 0, content_hash: 0xd47b2b87…8a8a, cid: Some(0x0155a0e40220d47b…8a8a) }` |
| content hash | equals `chunks[0]` of C1 |
| `bitswap_v1_get(bafk2bzacedkhwk4hqr7cfe4526y7krkb7753jl7pycofql525ces2buc7sfiu)` | 31 bytes, equal to `c_0`, hash matches; 0.2 s after the best block |
| `https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/<cid>` | HTTP 200, 31 bytes, hash matches; 0.5 s after the best block |

So `//Eve` is an authorizer on devnet today, and a fresh account can store
feelessly one block after the grant.

Other measurements that shaped `lib/bulletin.mjs`:

- `bitswap_v1_get` of a 2,000,016-byte chunk took 30–33 s (WebSocket and HTTP
  alike; once 1 s). A 203 KB chunk took 2–3.6 s. The gateway served 2 MB in
  6–8 s. With the spec's 30 s per source, a 2 MB chunk usually comes from the
  gateway.
- The node's HTTPS endpoint refuses a 2 MB request body (HTTP 413), so stores
  go up the WebSocket; reads (`bitswap_v1_get`, `state_getStorage`) use HTTP.
- papi's transaction watch missed some 2 MB stores that had landed. The bot
  therefore confirms a store by polling `TransactionByContentHash` at the best
  block (the entry the same extrinsic writes with the `Stored` event; it holds
  the block and index). It never waits for finality.
- A store submitted in the block right after a fresh grant was once refused
  with `Invalid::Payment`; the retry (10 s later) stored it.
- 2.1 MB (2 chunks, 2 transactions) stored in one best block about 10 s after
  submit.

## What is deliberately not automatic

For the default Polkadot-app transport, the automatic allowance is limited to
private bots on the named Products Devnet and Paseo profiles. Public bots and
custom network endpoints are excluded so strangers cannot spend a finite
upload allowance by default. A public bot receives an attachment reference,
but only downloads its bytes after you configure trusted
`BOT_HOP_ALLOWED_NODES`; keep outbound file delivery disabled unless you have
deliberately funded and bounded it.

T3ams has no automatic Bulletin upload grant. Public T3ams bots should keep the
attachment count, size, MIME admission policy, media cache, file vault, and
agent workspace deliberately tight before exposing the bot to arbitrary people.
Use a trusted Bulletin RPC only; attachment references never grant the sender a
way to make the bot fetch an arbitrary HTTP, filesystem, or data URL.

Production needs an explicit local operator flow with the original
mnemonic-derived person proof. Keep that proof off the VPS and out of the bot
runtime. The [configuration reference](/reference/configuration#named-testnet-file-delivery)
explains the runtime HOP settings; it does not automate production allocation.

## Framework bots

The `/file` commands work for direct, echo, and bridge bots. A framework with
the bridge token can also manage the same chat-scoped vault and return a saved
file through the bridge API. It must first place the file in that peer's vault;
the API never accepts an arbitrary host path as something to send. For T3ams,
the bridge receives opaque media URLs rather than raw Bulletin credentials and
can send only a vault `file_path` as a fresh encrypted attachment. See the
[Bridge HTTP API](/reference/bridge#t3ams-rich-chat).
