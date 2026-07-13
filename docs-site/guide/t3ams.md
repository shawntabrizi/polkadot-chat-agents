---
prev:
  text: "Files & storage"
  link: "/guide/files"
next:
  text: "In-chat commands"
  link: "/guide/commands"
---

# Run a bot in T3ams

T3ams is a first-class chat transport for the same direct brains and bridge
frameworks. People discover the bot by its registered DotNS username, DM it,
or invite it into a workspace/channel. The bot uses the normal T3ams encryption
and membership flows; it does not bypass a private channel's key grants.

Use `--transport t3ams` when you create the bot. Existing bots remain on the
default Polkadot-app transport unless they are created with that option.

## Create a bot

The T3ams runner requires the local `@t3ams/bcts` SDK package in the
`bot-core` checkout used for the run or deployment. `pca create` checks for it
and refuses to make a T3ams bot when it is absent. Install the package supplied
by the T3ams project into `bot-core` before creating or deploying the bot; see
[T3ams transport setup](/reference/configuration#t3ams-transport-setup).

A private bot needs a verified T3ams signing public-key pin for every allowed
person. Obtain that tagged-CBOR key out of band, then create the bot:

```bash
pca create teamhelper --transport t3ams --brain claude \
  --owner <your-polkadot-account-or-username> \
  --t3ams-peer-key '<same-account-or-username>=<tagged-cbor-signing-key-hex>' \
  --username teamhelper
```

Use `--t3ams-display-name` when the name shown in T3ams should differ from the
registered username. A public bot is possible, but gives arbitrary people a
route to spend model, Statement Store, and media capacity; start private unless
you have set tight model, file, and queue limits.

## Join a DM or workspace

1. Search for the bot's username in T3ams and send a DM. A private bot verifies
   the configured signing-key pin before it accepts first contact.
2. Invite it to a workspace through T3ams. A public bot does not automatically
   accept arbitrary workspace invitations unless you explicitly enable that
   policy.
3. Mention the bot in a channel. Channel messages remain mention-gated, so the
   bot does not turn ordinary room traffic into model work.
4. For a private channel, grant the bot the channel key through T3ams's normal
   key-grant flow. Workspace membership alone is not enough to decrypt it.

One T3ams DM and one workspace channel each have an independent conversation
session. Threads in a channel share that channel session and replies preserve a
thread root where one exists. An optional bounded channel-context cache can
give a later explicit mention the recent authenticated text without making the
bot listen or reply to every room message.

## A live, collaborative chat experience

For a slow direct-brain turn, the bot emits a native typing signal and then a
thinking message. Tool/activity progress edits that same message in place, and
the final answer replaces it; a long answer continues in ordered follow-up
messages. This gives the group one evolving reply instead of an orphaned
thinking bubble followed by a separate answer.

Bridge frameworks receive the same lifecycle. They can use `POST /send` with
`edit_of` for coalesced streaming edits, `POST /react` for real T3ams emoji
reactions, and `POST /typing` for a native typing signal. The authenticated
bridge's `GET /health.live` describes the current support. See
[Agent frameworks](/guide/harnesses#t3ams-bridge-behavior).

For `BOT_BRAIN=bridge` or `hermes`, a framework also includes the leased
`delivery_id` and `lease_id` on each outbound `POST /send`, `POST /react`, and
`POST /typing`. Editing or deleting a prompt revokes that claim, so a stale
worker cannot publish an answer or live activity for old text.

For an explicit framework-originated action with no inbound turn (for example
an OpenClaw attached result), configure a distinct
`BOT_BRIDGE_PROACTIVE_TOKEN`. The request still needs ordinary bridge
authentication and must also send that secret in `x-bridge-proactive-token`.
It permits only an entirely unleased `/send`, `/react`, or `/typing`; it never
turns a supplied stale lease into a valid one. Leave this capability unset when
proactive output is not needed.

Edits and deletes are authenticated on a separate retained operation route.
bot-core reconciles them before queued work is dispatched: an edit updates the
pending prompt/context and a deletion removes pending work or stops an active
direct-agent turn. It cannot retract a reply already published before the bot
received the deletion. Reactions and typing never become prompts.

In a channel, normal mentioned prompts and `/stop` are available to members.
By default, only workspace owners/admins may change a shared direct-brain
session with `/reset`, `/model`, `/reasoning`, or `/project`; tune the threshold
with `BOT_T3AMS_CHANNEL_CONTROL_ROLE`.

## Photos, documents, audio, video, and other files

T3ams uses encrypted Bulletin/HOP attachments. By default, a rich-text message
can carry up to eight valid MIME-typed attachments, 25 MiB each, including
photos, documents, audio, video, and application files. The bot validates the
encrypted reference, size, hash, metadata, and MIME policy before fetching it.
It never treats an attachment as an arbitrary URL, and neither a direct brain
nor a bridge framework receives the decryption ticket.

Operators can narrow the policy with exact MIME types or `type/*` patterns in
`BOT_T3AMS_ATTACHMENT_MIME_TYPES`; `*/*` is the broad default. Image dimensions
and audio/video duration are available as safe metadata when present. A direct
brain with explicitly enabled file tools can inspect a temporary staged copy for
the turn. Claude's default no-tools profile — required for a public built-in AI
direct bot — cannot inspect the staged bytes. A bridge gets an opaque,
authenticated `/media/<id>` URL that can materialize the bytes on demand.
`BOT_T3AMS_ATTACHMENT_MAX_DURATION_MS` bounds declared duration metadata to
seven days by default.

A tool-enabled private direct turn can also return a generated file. The bot
gives that turn a private `PCA_OUTPUT_DIR`; files written directly at its top
level are uploaded as native attachments and then removed locally. The default
and public Claude no-tools profiles cannot produce those files. The limit is
`BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS` (the attachment-count limit by default);
`BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` also caps the total batch. Nested files
and symlinks are ignored, and the normal outbound size and MIME policy still
applies. Before upload, accepted files are copied into a private durable turn
outbox together with the final reply chunks, so a transient delivery retry
reuses the same immutable answer and bytes rather than rerunning the agent. The
independent `BOT_T3AMS_AGENT_OUTBOX_*` and `BOT_T3AMS_REPLY_OUTBOX_*` budgets
bound retained file and reply state. If Bulletin upload or generic-file MIME
delivery is unavailable, `PCA_OUTPUT_DIR` is withheld and the bot still returns
text normally.

Use `/file put <path>` with one successfully fetched attachment to retain it in
that T3ams conversation's vault, and `/file get <path>` to return it as a fresh
encrypted attachment. A DM has its own vault; a channel intentionally shares a
vault among its members. Frameworks can manage that same vault through the
bridge, but can send only a saved `file_path`, never an arbitrary host path.
Read [Files & storage](/guide/files#t3ams-photos-media-and-documents) for the
full flow.

## Capacity and deployment checklist

- Keep the bot's `BOT_STATE_DIR` private and persistent. It holds T3ams session
  state, durable ingress work, and short-lived attachment capability material.
- T3ams media needs a trusted `BOT_T3AMS_BULLETIN_RPC`. Setting it empty leaves
  the bot in metadata-only mode: no encrypted media download or file return.
- Text, placeholders, edits, typing, and reactions consume Statement Store
  publishing capacity. Media upload needs a separate T3ams Bulletin allowance.
  The normal `pca storage` flow for the default transport does not provision it.
- Restrict a public bot's attachment count/size/MIME policy, media cache, vault,
  and model/agent capacity before inviting untrusted users.

The [configuration reference](/reference/configuration#t3ams-media-and-file-vault)
lists the transport-specific limits, cache controls, and group settings.
