# T3ams transport

`pca` can run the same AI brains as a T3ams bot. T3ams remains the chat client:
it discovers a bot by its registered DotNS username, handles its normal DM and
workspace flows, and carries encrypted messages through the Statement Store.

This is an optional transport. Existing bots continue to use `polkadot-app`
unless they were created with `--transport t3ams`.

## Prerequisites

- A registered bot account with a DotNS username. Create it normally with
  `pca create`; wait for `pca info <bot>` to show that registration is complete.
  The username is how people find and invite the bot in T3ams.
- A funded account with the Statement Store publishing allowance required by
  the target network. This is distinct from the optional HOP/file-delivery
  allowance: `pca storage <bot> status` concerns saved-file delivery, not basic
  T3ams text messaging.
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
durable inbound/bridge journal, and the AI brain's conversation state.

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
well. `BOT_T3AMS_SUBSCRIPTION_CAP` (default 256),
`BOT_T3AMS_INGRESS_CALLBACK_CAP` (default 128), and
`BOT_T3AMS_SUBMIT_QUEUE_CAP` (default 128) are defensive limits, not traffic
targets. `BOT_T3AMS_KNOWN_CHAT_CAP` (default 128 for a public bot, 500 for a
private bot) also bounds persisted native-agent session state; active durable
ingress items are protected until they finish. A full submit queue or exhausted
allowance leaves the prompt in the durable journal and retries with backoff,
so restore publishing allowance to resume those replies. The transport refreshes
retained subscriptions every two minutes by default; tune
`BOT_T3AMS_SUBSCRIPTION_REFRESH_MS` only when the Statement Store and VPS have
been sized for the resulting replay traffic.

## Current scope

- Text DMs and text channel messages are supported.
- Thread-root context is retained; replies to a threaded prompt are sent in the
  same thread.
- Every DM and every workspace channel has its own AI session identity; threads
  in one channel share that channel's session.
- Attachments, reactions, edits, calls, typing indicators, and other non-text
  T3ams events are not brain inputs in this first version.

The bot only processes messages it can decrypt and authenticate through the
standard T3ams membership/key flows. It does not bypass private-channel
encryption or workspace membership controls.
