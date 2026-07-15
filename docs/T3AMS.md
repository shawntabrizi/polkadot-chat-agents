# T3ams transport

`pca` can run the same AI brains as a T3ams bot. T3ams remains the chat client:
it discovers a bot by its registered DotNS username, handles its normal DM and
workspace flows, and carries encrypted messages through the Statement Store.

This is an optional transport. Choose it explicitly with `--transport t3ams`
when creating a bot; every current bot config records its transport.

## Prerequisites

- A registered bot account with a DotNS username. Create it normally with
  `pca create`; wait for `pca info <bot>` to show that registration is complete.
  The username is how people find and invite the bot in T3ams.
- A funded account with the Statement Store publishing allowance required by
  the target network. Text, a live-reply placeholder or edit, typing, and a
  reaction are all published operations, so size that allowance and the
  submission queue for the bot's expected turn rate. This is distinct from
  Bulletin media/storage capacity: do not assume `pca storage <bot> status`
  (the default transport's saved-file delivery allowance) provisions a T3ams
  Bulletin endpoint.
- Node.js 22+, a selected brain (or `--brain echo` for a transport check), and
  the local T3ams BCTS SDK package described below.

## Install the local BCTS package

`@t3ams/bcts` is **not currently published on public npm**. Do **not** run
`npm install @t3ams/bcts`; it is not a valid installation path today.

Build and pack the package from the T3ams SPA checkout, then install that
tarball into the exact `bot-core` checkout from which you will run or deploy
the bot:

```sh
cd /Users/shawntabrizi/Documents/GitHub/t3ams-spa/packages/bcts

# First install the T3ams SPA workspace dependencies using that repository's
# package manager, if needed. Then build this package.
npm run build
npm pack
# Note the emitted filename, for example: t3ams-bcts-<version>.tgz

cd <path-to-polkadot-chat-agents>
npm --prefix bot-core install --no-save \
  --package-lock=false \
  /Users/shawntabrizi/Documents/GitHub/t3ams-spa/packages/bcts/t3ams-bcts-<version>.tgz
```

`--no-save` is deliberate: it avoids recording a dependency that npm cannot
retrieve from the public registry. Keep `bot-core/node_modules/@t3ams/bcts`
present when running `pca deploy`; deployment uploads that local dependency with
the transport. Do not run `npm ci` after this step without reinstalling the
tarball. Rebuild, pack, reinstall, and redeploy when the local BCTS source
changes.

For a local `pca run` only, an operator can instead set
`BOT_T3AMS_BCTS_MODULE` to an importable custom ESM path. A remote Docker deploy
cannot use an arbitrary host path; install the tarball into `bot-core` so it is
uploaded with the app. A normal tarball install needs no extra setting.

## Create and start a bot

Create a registered, initially private bot. `--owner`/`--allow` accepts the
same Polkadot account identifiers as the other transport and remains the
transport-level access control for T3ams DMs, invitations, and messages. A
private T3ams bot also needs an immutable tagged-CBOR **signing public-key pin**
for every allowed account.

```sh
pca create teamhelper --transport t3ams --brain echo \
  --owner <your-polkadot-account-or-username> \
  --t3ams-peer-key '<same-account-or-username>=<tagged-cbor-signing-public-key-hex>' \
  --username teamhelper

pca info teamhelper
pca run teamhelper
# Or, after the local BCTS tarball is installed:
pca deploy teamhelper --host root@your-server
```

`BOT_TRANSPORT=t3ams` and `BOT_USERNAME` are generated from the saved bot
configuration. Use `--t3ams-display-name <name>` to set the name shown in
T3ams (otherwise the registered username is used). The usual `BOT_ENDPOINT`,
`BOT_STATE_DIR`, `BOT_BRAIN`, model policy, and bridge settings still apply.
Keep the state directory: it contains T3ams peer/workspace/key state, the
durable inbound/bridge journal, attachment capability material while it is
being processed, and the AI brain's conversation state. The transport creates
and enforces it as mode `0700`; keep it on a private encrypted volume, do not
mount it into the agent workspace, and treat backups as secrets.

### Obtain and rotate a private signing-key pin

An account-derived T3ams XID does not cryptographically prove ownership of a
device's Ed25519 signing key. For that reason, `--t3ams-peer-key` is required
for every private `--owner`/`--allow` account. Obtain the value from a trusted
T3ams client/device out of band: it is the hex encoding of that identity's
`signingPublicKey.taggedCborData()`. Verify it with the account holder through
a separate trusted channel before saving it. Current T3ams account discovery
does not provide a global account-to-device-key resolver.

Do not accept a key merely because it is carried in a DM or invitation. If the
person rotates their T3ams signing device, verify the replacement key out of
band, update `t3amsTrustedSigningKeys` in the bot's mode-0600 `config.json`,
and restart/redeploy the bot. Private bots intentionally reject silent rekeys.

## T3ams onboarding

The supported T3ams conversation surface is DMs and workspace channels,
including their threads, live replies, media, and files. Native ad-hoc T3ams
groups are not supported yet; use a workspace channel for a shared bot
conversation.

1. Search for the bot's registered DotNS username in T3ams and send it a DM.
   A verified, allowed DM pair is accepted automatically; no manual accept step
   is required from the bot operator. This first pairing is also required
   before a public bot will accept that person's workspace invitation, so the
   invite has a verified signing key rather than relying on unauthenticated
   first contact.
2. Invite the bot to a workspace using the existing T3ams workspace invitation
   flow. For a private bot, the inviter's outer request must verify against
   that account's configured signing-key pin; this is not TOFU. The bot accepts
   it, announces itself as a member (and maintains presence while running), and
   waits for the workspace owner to publish the updated state document that
   includes the bot before it subscribes to channel traffic.
3. In a public channel, mention the bot explicitly (normally
   `@<registered-username>` or its configured display name). It does not call a
   brain for ordinary unmentioned channel traffic.
4. For a private channel, grant the bot the channel key through T3ams's normal
   private-channel key-grant flow. Workspace membership alone does not decrypt
   a private channel. Rotate keys through the normal T3ams flow whenever access
   changes.

If a private bot is meant to participate in a workspace, its configured
allowlist must include the people who will DM, invite, or prompt it. Use
`--public` only when deliberately exposing the selected AI brain to arbitrary
senders. Public bots do **not** auto-accept workspace invitations by default;
use `--t3ams-auto-accept-workspaces` only when enrollment by arbitrary public
senders is intended. Use `--t3ams-no-auto-accept-workspaces` to disable
automatic enrollment even for an allowlisted bot. Deliberately public bots use
first-contact TOFU only after that explicit enrollment opt-in. Their public
admission state is bounded by default: 128 remembered DM peers, eight
workspaces, 32 new DM pairings/hour, and four new workspace enrollments/hour.
Fresh public entries are not evicted; inactive entries become eligible after
the one-hour admission window. Operators may tune these limits with
`BOT_T3AMS_PUBLIC_PEER_CAP`, `BOT_T3AMS_PUBLIC_WORKSPACE_CAP`,
`BOT_T3AMS_PUBLIC_PEER_ADMISSIONS_PER_HOUR`, and
`BOT_T3AMS_PUBLIC_WORKSPACE_ADMISSIONS_PER_HOUR`. Keep the defaults unless a
capacity review supports changing them.

The live subscription set and outbound Statement Store queue are bounded as
well. `BOT_T3AMS_SUBSCRIPTION_CAP` (default 1024),
`BOT_T3AMS_INGRESS_CALLBACK_CAP` (default 128), and
`BOT_T3AMS_SUBMIT_QUEUE_CAP` (default 128) are defensive limits, not traffic
targets. A known DM uses a carrier route and a separate edit/delete operation
route. `BOT_T3AMS_KNOWN_CHAT_CAP` (default 128 for a public bot, 500 for a
private bot) also bounds persisted native-agent session state; active durable
ingress items are protected until they finish. A full submit queue or exhausted
allowance leaves the prompt in the durable journal and retries with backoff, so
restore publishing allowance to resume those replies. The transport refreshes
retained subscriptions every two minutes by default; tune
`BOT_T3AMS_SUBSCRIPTION_REFRESH_MS` only when the Statement Store and VPS have
been sized for the resulting replay traffic.

For an open direct engine, the model budget also defaults to two active turns
and 20 queued turns (private direct bots retain four and 100). An authenticated
`GET /health` includes `direct.queue` for this public profile, showing active,
queued, and configured capacity without exposing it to chat users.

## Current scope

- DMs and workspace channels support text, threads, live replies, authenticated
  rich-text attachments, media, and files.
- Native ad-hoc T3ams groups are not supported yet.
- Thread-root context is retained; replies to a threaded prompt are sent in the
  same thread.
- Every DM and every workspace channel has its own AI session identity.
  Top-level channel prompts use that session, while each reply thread has its
  own isolated native session.
- Channel turns remain mention-gated. If `BOT_T3AMS_CHANNEL_CONTEXT=1`, a
  bounded, memory-only snapshot of recent authenticated unmentioned **text**
  can accompany a later explicit mention in that same channel or thread; it
  never independently triggers a brain.
- By default, only a workspace owner or admin can use a channel/thread
  session-changing `/reset`, `/model`, `/reasoning`, or `/project` command;
  ordinary mentioned prompts and `/stop` remain available to channel members.
  `/stop` targets the current thread/conversation. Configure the threshold with
  `BOT_T3AMS_CHANNEL_CONTROL_ROLE`.
- Slow direct-brain turns use a live message: a thinking placeholder appears
  after `BOT_THINKING_AFTER_MS`, progress can edit that message in place, and
  the first final chunk replaces it. Long replies continue in additional
  messages.
- A bridge harness can use `POST /send` with `edit_of`, `POST /react`, and
  `POST /typing`; `GET /health` advertises those live capabilities. See
  [HARNESSES.md](HARNESSES.md#t3ams-transport-fields) for the exact contract.
- Authenticated edits and deletions reconcile before queued work is dispatched.
  An edit updates pending input/context; a deletion removes pending input or
  stops an active direct turn. Neither can retract a reply already published.
- Incoming reactions, typing, calls, and other non-message events are not
  agent prompts. They remain outside the direct-brain input contract.

The bot only processes messages it can decrypt and authenticate through the
standard T3ams membership/key flows. It does not bypass private-channel
encryption or workspace membership controls.

## Live replies and bridge operations

A direct brain starts a best-effort typing signal as soon as it begins a turn.
If the turn is still running after `BOT_THINKING_AFTER_MS`, the bot publishes
`BOT_THINKING_TEXT` and keeps that one message current. The live-edit cadence,
heartbeat, progress frames, final wait, and timeout are controlled by the
`BOT_LIVE_*` settings in [CONFIGURATION.md](CONFIGURATION.md#replies--live-replies).
Set `BOT_LIVE_PROGRESS=0` when only a thinking bubble and final answer are
desired. Each update remains an on-chain T3ams operation, so very short edit
intervals raise Statement Store allowance and queue pressure rather than making
the response free.

For a framework-driven bot, the bridge begins the same typing/placeholder flow
when it leases an inbound turn. Its first ordinary `POST /send` finalizes that
placeholder. A framework may stream `edit_of` updates as frequently as it
wants; bot-core coalesces them to the safe live-edit cadence and flushes the
latest update when the matching lease is acknowledged. `edit_of` is restricted
to a message issued by the current bot process, and it cannot be combined with
`reply_to`. Preserve an inbound `thread_root_id` on sends to keep a
workspace-channel reply in the same T3ams thread.

## Attachments, Bulletin media, and files

T3ams rich text carries an encrypted Bulletin/HOP capability as a BCTS
attachment reference. It is not a normal network URL. The reference's claim
ticket is a secret: the transport accepts only the `hop:` form, validates the
authenticated id, content hash, MIME type, size, filename, and image dimensions,
and never exposes the raw reference or ticket through bridge payloads or logs.
Rejecting arbitrary `http:`, `https:`, `file:`, or `data:` values prevents a
message from turning into an SSRF or local-file fetch request.

The default inbound policy permits up to eight attachments, each no larger than
25 MiB, with a hard count of 16. It accepts any syntactically valid MIME type,
so photos, video, audio, PDFs, Office documents, archives, and application
files work without a framework-specific allowlist. Operators can narrow the
policy to exact MIME types or `type/*` patterns for a public bot. Image
dimensions and declared audio/video duration are retained as safe metadata.
Invalid attachment metadata does not make a message trusted: a valid text body
can still be delivered with a safe attachment warning, while an attachment-only
invalid message is represented only as an unavailable-file notice—never as
fetched bytes.

Only a configured, trusted T3ams Bulletin endpoint may retrieve the encrypted
bytes. Until retrieval is configured, direct brains receive attachment metadata
and an explicit unavailable-file note rather than a path or a fetchable ticket.
When retrieval succeeds, a direct brain receives a staged private copy for its
turn, not the media-cache path itself. `/file put <path>` can retain one such
attachment in the conversation vault, and `/file get <path>` publishes a new
encrypted attachment back into that same DM or channel.

Direct T3ams bots start with no tools, regardless of whether they use Claude,
Codex, or OpenCode. The deployer can deliberately enable portable
`read`, `write`, and `bash` capabilities with
`--allowed-tools read,write,bash` and choose `--tool-scope workspace|container`.
`read` lets the agent inspect a verified attachment staged for its current turn;
`write` also lets it create a returnable artifact. The staged directory is
removed after the turn. This uses the selected CLI's existing login and does not
require an API key for the direct brain. Workspace scopes native file tools to
the current project and staged attachments; Bash uses the agent process boundary
in either scope. Container scope deliberately includes every file visible to the
non-root agent account, including its OAuth/session home. For a deployment, the
agent process runs in the bot's dedicated container; local `pca run` uses the
local process account and should be treated as a trusted-machine tool. Choose
the default no-tools policy, workspace scope, container scope, or the separate
API-only media analyzer for the bot's trust boundary.

Each direct bot runs in its own container. The transport owns the signing seed,
session state, and bridge token in `/state`, while the agent runs as a non-root
user and cannot read them. The CLI OAuth home is intentionally part of the bot
container so it can authenticate; container-scoped native file tools and Bash
can access it. Do not mount unrelated host repositories, credentials, Docker
sockets, or home directories into a bot container.

Direct Claude, Codex, and OpenCode turns can also return generated files. For a
turn, the bot creates a private `PCA_OUTPUT_DIR`; only bounded top-level regular
files written there are uploaded as fresh native attachments, and the directory
is removed after handoff. Nested paths and symlinks are ignored. Set
`BOT_T3AMS_AGENT_OUTPUT_MAX_ARTIFACTS=0` to disable this return path; otherwise
it defaults to the attachment-count limit and uses the same outbound size/MIME
policy. `BOT_T3AMS_AGENT_OUTPUT_MAX_TOTAL_BYTES` independently caps the whole
file batch. Before any upload or final-answer statement, bot-core persists the
accepted file snapshots and final reply chunks in a private durable turn outbox.
A normal delivery retry drains that exact turn rather than asking the agent to
recreate a document, image, or answer; a successfully uploaded Bulletin
reference is persisted before its chat statement. The outbox has independent
global file and reply caps (`BOT_T3AMS_AGENT_OUTBOX_*` and
`BOT_T3AMS_REPLY_OUTBOX_*`). If Bulletin upload, attachment count, or generic
file MIME delivery is disabled, the bot withholds `PCA_OUTPUT_DIR` so an
undeliverable file cannot block an otherwise valid text answer.

Bridge harnesses receive an opaque `media_id` and authenticated `/media` URL
for a valid attachment only when Bulletin retrieval is enabled; the original
attachment id is metadata, not a fetch credential. The opaque id is bounded and
expires, while `GET/PUT/DELETE /files/<chat_id>[/<path>]` stays scoped to that
one conversation. A bridge `POST /send` may deliver a vault `file_path` with a
caption or reply target, but never as an edit. In bridge mode it must
also include the active inbound `delivery_id` and `lease_id`; the same claim is
required for bridge `POST /react` and `POST /typing`. An edit or delete revokes
the old claim before a stale worker can reply or emit stale live activity. See
[HARNESSES.md](HARNESSES.md#t3ams-transport-fields) for that API contract.

Some framework facilities deliberately originate outside an inbound turn (for
example OpenClaw attached results). If those need to post to T3ams, configure
the distinct optional `BOT_BRIDGE_PROACTIVE_TOKEN` and present it in the
`x-bridge-proactive-token` header as well as normal bridge authentication. It
permits only an entirely unleased `/send`, `/react`, or `/typing`; it is not a
replacement for `BOT_BRIDGE_TOKEN`, does not grant vault access by itself, and
cannot make a stale supplied lease valid. Leave it unset when proactive output
is not required.

Keep the media cache and any durable file vault below the private state volume,
with disk quotas and retention limits sized for the 25 MiB per-attachment cap.
The generic Polkadot-app HOP settings are not automatically a T3ams Bulletin
configuration; use the transport-specific settings described in
[CONFIGURATION.md](CONFIGURATION.md#t3ams-attachments-media-and-file-vault).
