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
It supports DMs and workspace channels, including threads, live replies, media,
and files. Native ad-hoc T3ams groups are not supported yet; use a workspace
channel for a shared bot conversation.

Use `--transport t3ams` when you create the bot. Every current bot config
records its chosen transport explicitly.

## Create a bot

The T3ams runner requires the local `@t3ams/bcts` SDK package in the
`bot-core` checkout used for the run or deployment. Install the package
supplied by the T3ams project into `bot-core` before running or deploying the
bot; see [T3ams transport setup](/reference/configuration#t3ams-transport-setup).

People discover the bot by its registered DotNS username, so create it with
`pca create` and wait for `pca info <bot>` to show that registration is
complete.

A private bot needs a verified T3ams signing public-key pin for every allowed
person. Obtain that tagged-CBOR key out of band (see
[signing-key pins](/reference/configuration#signing-key-pins)), then create
the bot:

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
   the configured signing-key pin before it accepts first contact; a verified,
   allowed DM pair is then accepted automatically, with no manual accept step
   from the operator. For a public bot, this first pairing is also required
   before it will accept that person's workspace invitation, so the invite
   carries a verified signing key rather than relying on unauthenticated first
   contact.
2. Invite it to a workspace through T3ams. For a private bot, the inviter's
   outer request must verify against that account's configured signing-key
   pin — this is not trust-on-first-use. A public bot does not automatically
   accept arbitrary workspace invitations unless you explicitly enable that
   policy. On accept, the bot announces itself as a member (and maintains
   presence while running) and waits for the workspace owner to publish the
   updated state document that includes it before subscribing to channel
   traffic.
3. Mention the bot in a channel. Channel messages remain mention-gated, so the
   bot does not turn ordinary room traffic into model work.
4. For a private channel, grant the bot the channel key through T3ams's normal
   key-grant flow. Workspace membership alone is not enough to decrypt it.
   Rotate keys through the normal T3ams flow whenever access changes.

One T3ams DM and each workspace channel have independent conversation sessions.
Top-level channel prompts use that channel session, while every reply thread has
its own isolated native session; replies preserve their thread root. An optional
bounded channel-context cache can give a later explicit mention the recent
authenticated text without making the bot listen or reply to every room message.

## A live, collaborative chat experience

For a slow direct-brain turn, the bot emits a native typing signal and then a
thinking message. Tool/activity progress edits that same message in place, and
the final answer replaces it; a long answer continues in ordered follow-up
messages. This gives the conversation one evolving reply instead of an orphaned
thinking bubble followed by a separate answer.

Bridge frameworks receive the same lifecycle. They can use `POST /send` with
`edit_of` for coalesced streaming edits, `POST /react` for real T3ams emoji
reactions, and `POST /typing` for a native typing signal. The authenticated
bridge's `GET /health.live` describes the current support. See
[Agent frameworks](/guide/harnesses#t3ams-bridge-behavior).

For `BOT_BRAIN=bridge`, a framework also includes the leased
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
received the deletion. Reactions, typing, calls, and other non-message events
never become prompts.

In a channel, normal mentioned prompts and `/stop` are available to members.
Top-level prompts share a channel session, while each reply thread has its own
native session. By default, only workspace owners/admins may change the current
channel/thread session with `/reset`, `/model`, `/reasoning`, or `/project`;
tune the threshold with `BOT_T3AMS_CHANNEL_CONTROL_ROLE`.

## Photos, documents, audio, video, and other files

T3ams uses encrypted Bulletin/HOP attachments. By default, a rich-text message
can carry up to eight valid MIME-typed attachments of 25 MiB each — photos,
documents, audio, video, and application files.

Attachments are authenticated before anything touches them:

- The bot validates the encrypted reference, size, hash, metadata, and MIME
  policy before fetching.
- An attachment is never treated as an arbitrary URL.
- Neither a direct brain nor a bridge framework ever receives the decryption
  ticket.

What a brain can do with a fetched attachment depends on its capabilities. A
direct brain with the portable `read` capability can inspect a temporary staged
copy for the turn; the default no-tools policy cannot. A bridge gets an opaque,
authenticated `/media/<id>` URL that can materialize the bytes on demand.

Operators tune the inbound policy with two settings:

- `BOT_T3AMS_ATTACHMENT_MIME_TYPES` narrows accepted types with exact MIME
  types or `type/*` patterns; `*/*` is the broad default.
- `BOT_T3AMS_ATTACHMENT_MAX_DURATION_MS` bounds declared duration metadata,
  seven days by default.

Image dimensions and audio/video duration are available as safe metadata when
present.

### Returning generated files

A direct turn with the portable `write` capability can also return files it
creates. The bot gives that turn a private `PCA_OUTPUT_DIR`; files written
directly at its top level are uploaded as native attachments and then removed
locally. Nested files and symlinks are ignored, and the default no-tools
policy cannot produce those files.

Limits and delivery guarantees:

- `BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS` caps the file count (the
  attachment-count limit by default), and
  `BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` caps the total batch. The normal
  outbound size and MIME policy still applies.
- Before upload, accepted files are copied into a private durable turn outbox
  together with the final reply chunks, so a transient delivery retry reuses
  the same immutable answer and bytes rather than rerunning the agent. The
  independent `BOT_T3AMS_AGENT_OUTBOX_*` and `BOT_T3AMS_REPLY_OUTBOX_*`
  budgets bound that retained state.
- If Bulletin upload or generic-file MIME delivery is unavailable,
  `PCA_OUTPUT_DIR` is withheld and the bot still returns text normally.

Use `/file put <path>` with one successfully fetched attachment to retain it in
that T3ams conversation's vault, and `/file get <path>` to return it as a fresh
encrypted attachment. A DM has its own vault; a channel intentionally shares a
vault among its members. Frameworks can manage that same vault through the
bridge, but can send only a saved `file_path`, never an arbitrary host path.
Read [Files & storage](/guide/files#t3ams-photos-media-and-documents) for the
full flow.

## Capacity and deployment checklist

- Keep the bot's `BOT_STATE_DIR` private and persistent. It holds T3ams session
  state, durable ingress work, short-lived attachment capability material, and
  the brain's conversation state. The transport creates it with mode `0700`;
  keep it on a private encrypted volume, never mount it into the agent
  workspace, and treat backups as secrets.
- T3ams media needs a trusted `BOT_T3AMS_BULLETIN_RPC`. Setting it empty leaves
  the bot in metadata-only mode: no encrypted media download or file return.
- Text, placeholders, edits, typing, and reactions consume Statement Store
  publishing capacity. Media upload needs a separate T3ams Bulletin allowance.
  The normal `pca storage` flow for the default transport does not provision it.
  A full submit queue or an exhausted allowance leaves the prompt in the
  durable journal and retries with backoff; restore publishing allowance to
  resume those replies.
- Restrict a public bot's attachment count/size/MIME policy, media cache, vault,
  and model/agent capacity before inviting untrusted users.
- An open direct engine defaults to two active turns and 20 queued turns; its
  authenticated `GET /health` response includes `direct.queue` so the operator
  can observe active and queued work plus the configured caps.

The [configuration reference](/reference/configuration#t3ams-media-and-file-vault)
lists the transport-specific limits, cache controls, and channel settings.
