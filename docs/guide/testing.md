---
prev:
  text: "Agent frameworks"
  link: "/guide/harnesses"
next:
  text: "Configuration (env vars)"
  link: "/reference/configuration"
---

# Testing a bot without a phone

## The local sandbox: a whole network on your machine

`sandbox/` is a local replica of the chat network: a statement-store node,
a HOP node (the attachment pool the Bulletin network provides), a directory
that plays the People chain and the identity backend, and "personas" —
users with one or more devices, driven from the terminal with `pcs`.
Personas run the SDK behind Polkadot Desktop, not bot-core's transport, so
a bot is tested against an independent implementation of the protocol. No
phone, no testnet, no proof.

```bash
cd sandbox && npm ci
pcs up                                   # store node + HOP node + directory + control API
pca create mybot --brain echo --network sandbox   # registers through the sandbox, no proof;
                                         # the sandbox HOP node becomes the bot's upload node
pca run mybot                            # in another terminal
pcs user add alice --devices 2
pcs request alice mybot --welcome "hello"   # alice opens the chat; the bot accepts
pcs send alice mybot "from my laptop" --device 2
pcs send alice mybot --attach photo.png --caption "look"   # through HOP, like the desktop
pcs inbox alice --device 2               # the bot's answers, with per-device ACK state;
                                         # an attachment the bot returned: claimed on one
                                         # device, "claimed by device N" on the other
pcs wire --peer alice                    # every statement, labelled by session and channel
pcs hop                                  # the pool: every entry, who signed and claimed it
pcs hop fault refuse|cut|delay|drop|corrupt [--hash <entry>] [--count N]
```

`pca create --network sandbox` finds the daemon through `--sandbox-url`,
`PCA_SANDBOX_URL`, or the `daemon.json` that `pcs up` writes. `pcs bot attach
<name>` registers a bot's account by hand (it reads only `config.json`,
including the public half of the bot's upload signer, which the sandbox
grants its Bulletin allowance).

The wire is readable wherever the sandbox holds a key, and breakable on
purpose:

```bash
pcs wire --decode                        # every statement decrypted: kind, requestId,
                                         # messages in the inbox's shape, who ACKed it
pcs wire --history "session alice#1→echobot /request"   # what the slot held before
pcs fault drop --from echobot --channel "session echobot#1→alice /response" --count 1
pcs fault delay --from alice --ms 2000 --count forever
pcs fault delay-reply --from echobot --ms 30000 --count forever   # store and push at once, answer the submitter late
pcs fault list | pcs fault clear
pcs clock +2h | pcs clock reset          # the store node's clock (expiry checks)
pcs node restart | pcs node reset        # drop every socket; keep / wipe the store
pcs call alice echobot                   # a WebRTC offer; the bot's decline shows in the inbox
pcs send alice echobot --raw 0x…         # raw message bytes into the batch (an undecodable one)
pcs device add alice | pcs device remove alice 2   # the persona fans out deviceRemoved
```

Scenarios are scripted conversations with assertions, run as tests, one per
invariant in `CLAUDE.md` plus the S2 answers:

```bash
pcs scenario run scenarios/echo-roundtrip.mjs   # alice (2 devices) ↔ echo bot: opener,
                                                # device-2 follow-up, reaction, reply, edit
pcs scenario run scenarios/bot-restart.mjs      # kill -9 with a reply owed, restart: one answer
pcs scenario run scenarios/ack-or-resend.mjs    # the node drops the bot's ACK: resend answered once
pcs scenario run scenarios/poison-batch.mjs     # an undecodable message next to a good one
pcs scenario run scenarios/channel-clobber.mjs  # direct submits clobber (node); lanes never (bot)
pcs scenario run scenarios/every-device-session.mjs   # 3 devices, 3 channels, all polled
pcs scenario run scenarios/expiry-while-queued.mjs    # clock +2h with a message waiting
pcs scenario run scenarios/no-ack-peer.mjs      # one un-ACKed statement, queue, the backstop
pcs scenario run scenarios/call-offer.mjs       # ACK, then dataChannelClosed
pcs scenario run scenarios/accept-without-welcome.mjs # empty BOT_ACK_TEXT: the accept alone
pcs scenario run scenarios/device-removed.mjs   # the bot stops addressing an unpaired device
pcs scenario run scenarios/attachment-to-bot.mjs      # a photo in: ACK, one download, /media, the answer
pcs scenario run scenarios/attachment-from-bot.mjs    # /file get: one device claims, the other a placeholder
pcs scenario run scenarios/poison-attachment-batch.mjs # an undecodable attachment next to a real one
pcs scenario run scenarios/hop-faults.mjs       # cut, rate-limited, corrupt, gone: retries and notes
```

Every scenario asserts on the wire (`GET /wire`, decoded) as well as on the
inboxes and the bot's log. `npm test` in `sandbox/` runs them with the rest
of the suite (and CI does). Anything that touches sessions or inbound
handling must keep both green.

### The sandbox on a testnet (Products Devnet, Paseo Next)

`pcs up --network devnet` (or `paseo`) runs the same daemon against the real
testnet: the People chain's statement store and `Resources` pallet are the
store and the directory, the identity backend registers the personas, and
the Bulletin HOP nodes carry attachments — so a persona can chat with a
deployed bot and with a phone. Both profiles are rows of bot-core's network
table (`lib/network-config.mjs`), so `pca create --network <id>` and
`pcs up --network <id>` see one network. `mock` stays the default and is
unchanged. Devnet is the one whose backend attests today (its
client-proof session is minted from the persona's own wallet key, as
`pca create` does; `PCA_IDENTITY_TOKEN` / `PCA_IDENTITY_VOUCHER` in the
daemon's environment are the same overrides `pca` takes — see
[Use Products Devnet](/guide/devnet)).

```bash
pcs up --network devnet                  # prints the chain genesis; refuses to start if the RPC is unreachable
pcs user add alice                       # mints a mnemonic, claims sandboxalice.NN through the backend
                                         # (alice is too short for a username), waits for the attestation;
                                         # "pending" if it does not land in time — run it again to keep waiting
pcs user add alice --username alicetest --wait 300
pcs user list                            # username, attested | pending attestation | needs re-registration
pcs user find shawntabrizi               # the backend's search, each hit checked against the chain (onChain)
pca create sandboxecho --brain echo --network devnet --owner <alice's account>
pcs bot attach sandboxecho               # verified on chain; then  pca run sandboxecho
pcs request alice sandboxecho --welcome hi
pcs send alice sandboxecho --attach photo.png
pcs send alice sandboxecho --attach notes.txt --caption "/file put notes.txt"
pcs send alice sandboxecho "/file get notes.txt"      # the bot returns the file through the real HOP node
pcs inbox alice
pcs wire --decode                        # what alice's subscriptions saw, and what she submitted
pcs scenario run scenarios/echo-roundtrip.mjs --network devnet      # live checks, not CI
pcs scenario run scenarios/attachment-to-bot.mjs --network paseo
```

What differs from the mock, and why:

- A testnet persona is **single-device**: its identity account is its
  statement account and its device key is a persisted random X25519 key —
  exactly what a bot is. A second device needs the `AsResources` ring-proof
  origin only the phone can mint. `--devices 2` is refused.
- Persona seeds live in the state dir (`~/.pca/sandbox/default/personas/
  <name>/identity.json`, mode 0600) because the chain outlives the daemon.
  On restart the personas come back with their registration state.
- **Chain resets.** The daemon records the genesis it registered each
  persona on (and `daemon.json` carries the current one). When it starts
  on a different genesis it marks every persona and attached bot `needs
  re-registration` and says so; `pcs user add <name>` then claims a new
  username (the backend refuses to reuse the old number), and
  `pca register <bot> --again` does the same for a bot.
- Faults, the clock, node restarts and the HOP pool view are refused with
  `409` (`pcs` prints the reason): the sandbox holds no node to break.
  The UI shows a network badge and hides those controls.
- Scenarios that need none of those run on both networks behind
  `--network`; the rest are mock-only and say so.

### The web UI

The same control API has a browser front: personas, requests, chats with
markdown rendering (tables, code blocks, lists, links — what a bot answers
with), and the wire inspector with the fault controls.

```bash
cd sandbox/ui && npm ci && npm run build   # once; pcs up then serves it
pcs up                                     # open http://127.0.0.1:7788
npm run dev                                # live reload, proxies /api to the daemon
npm run check                              # tsc, vitest, build (CI runs this)
npm run acceptance                         # echo bot + headless Chromium, screenshots to sandbox/docs/images
```

An agent checks rendering without a browser:
`GET /api/personas/alice/rooms/echobot?format=html` returns the room as a page
through the same markdown pipeline the Room view uses (`sandbox/lib/markdown.mjs`),
so a `<table>` or `<pre><code>` in that response is what a person sees.

## Offline, automated (no network at all)

`npm test` in `bot-core/` runs the transport end-to-end against the sandbox
daemon (`sandbox/daemon.mjs`: its store node, its HOP node and its
directory, so the identifier-key lookup is the deployed path through
`lib/people-directory.mjs`, not a pin list). The peer is a sandbox persona
driven through the daemon's API — a device whose statement account and
encryption key differ from its identity's, as a phone's do. It covers, in
both ingress modes (poll-only and subscription):

- round trips with poison batches, restart survival with dedup, and owed-reply
  crash recovery;
- the rich features — attachment download (a real HOP upload by the persona),
  reply quotes, reactions, and call auto-decline.

Single-mode tests cover the bridge surface (`/inbound` shape, `/media`,
`reply_to`/`edit_of`/`/react`, `events=1`), the durable vault (`/file put`,
bridge `/files`, a vault file returned through HOP and claimed by the
persona), an owed *attachment* surviving kill -9, and the live-reply
lifecycle: placeholder → ACK-gated progress edits with stream-json tool
actions → final-as-edit (the persona keeps a row's edit history, so every
frame is asserted), the no-ACK plain-message fallback (the node drops the
persona's ACKs), and bridge auto-upgrade with throttled harness edits.

CI runs this on every push.

## Live network

`test-client.mjs` sends real messages over the Statement Store from an
attested identity and prints the bot's replies. You need the sender's root
seed and the target bot's account id and identifier key (`pca info <name>`
prints the bot's values; the account and identifier key are in its
`config.json`).

## Basic round trip

```bash
node bot-core/test-client.mjs \
  --seed-hex 0x<sender-root-seed> \
  --bot-account 0x<bot-account-hex> \
  --bot-identifier-key 0x<bot-identifier-container-hex> \
  --wait-secs 45 \
  "hello" "a follow-up message"
```

The first message is a chat opener; later arguments are sent as follow-ups on the
identity session channel. Replies print as `[BOT] ...` and the exit code is
non-zero if none arrived.

Note that session topics are reused between runs, so a long-lived test identity
will also print stale replies from earlier conversations. Check for a reply to
the text you actually sent.

## Device-channel round trip

The mobile app does not send follow-ups the way `test-client.mjs` does: it
uses a per-device encryption key and a per-device statement account, which
puts messages on a different session channel than the identity key would.
The sandbox personas reproduce that behavior (a device is its own statement
account and encryption key), including the multi-device envelope, an
undecodable message in a batch, and HOP attachments; bot-core's offline
suite and the sandbox scenarios both drive them.

If a bot answers `test-client.mjs` but not the app, the sandbox is the repro
tool: open a chat from a two-device persona (`pcs user add alice --devices
2`, `pcs request`, `pcs send … --device 2`) and read `pcs wire --decode` —
the bug is almost certainly in device-session polling or ACKs.

`test-client-device.mjs`, the earlier headless reproduction of the device
channel, was retired in sandbox S5: everything it did (including its
`--attach` HOP attachment and the poison-in-a-batch case) is covered by the
persona API, and it keyed the multi-device envelope by the peer's identity
account, which a phone's device account never equals. Live-network sends
from a real seed use `test-client.mjs` (identity channel).

## Named-testnet outbound file delivery

Create an allowlisted bot on default Products Devnet, or add `--network paseo`
to exercise the Paseo profile. Normal local
onboarding provisions its derived allowance on the selected testnet
automatically, including an expiry refresh when needed. Confirm it with:

```bash
pca storage <name> status
```

If it is missing, expired, or low, grant it locally with
`pca storage <name> grant`. This is a genesis-pinned transaction to the
selected testnet's faucet; it targets the derived allowance account, not the
bot's main chat address. Run it from the machine that has
`~/.pca/bots/<name>/secret.json`: `pca` derives the target locally and never
sends that seed or mnemonic to the faucet.

Do not retry an interrupted or uncertain grant. Wait for finalization, run
`pca storage <name> status`, then run `pca storage <name> recover`. A sufficient
on-chain allowance clears the persistent local guard without another faucet
transaction. If it remains insufficient, use `recover --yes` only after
verifying that the old transaction cannot finalize; it clears the guard only,
so run `grant` separately if still needed.

Then send a small attachment with the caption `/file put check.txt`, followed by
`/file get check.txt`. The app should receive the returned attachment and the
bot log should contain `BOT_FILE_DELIVERED`.

This validates a real HOP upload. The test faucet and its quota are not a
production provisioning path; production allocation remains an explicit local
operator flow.

## Products Devnet registration

See [Use Products Devnet](/guide/devnet) for the full enrollment flow, local
macOS tests, retry behavior, and the boundary between a mock and the hosted
network.

No phone, voucher, or pre-generated JWT is needed for a live registration
test. Use a disposable bot name:

```bash
npm run pca -- create testagent --brain echo --owner <your-username-or-address>
```

`pca` requests a Devnet challenge, signs the client-proof payload with the
bot's own wallet key, and stores the returned session in the bot's mode-`0600`
`secret.json` only while registration is incomplete. If the username write or
network confirmation is interrupted, run:

```bash
npm run pca -- register testagent
```

The retry reuses or refreshes the saved session. To regression-test the
alternate network, add `--network paseo`. `PCA_IDENTITY_TOKEN` is an optional
controlled-automation override; `PCA_IDENTITY_VOUCHER` is only a fallback if
the hosted environment later hard-enforces platform attestation.

## Live checklist with a real phone

After transport changes, verify against the actual app: send a photo (expect
`BOT_MEDIA_DOWNLOADED` and a reply that reflects it), react to a bot message
(`BOT_RECEIVED_REACTION`, no reply), edit one of your messages (the bot answers
again with `kind: "edited"` logged), place a call (the app should show it
declined), and send a Coinage payment (`BOT_COINAGE_RECEIVED`, log only).

## Restart survival

To verify persistence, message a bot, restart its process (or
`docker compose up -d --force-recreate` its container), and send a follow-up on
the same session without a new opener. The bot's log should show
`BOT_STATE_RESTORED` on startup and a `BOT_RECEIVED_TEXT` for the follow-up. Old
messages must not be re-answered after the restart.

## Useful log events

bot-core logs one JSON line per event. The ones worth grepping:

| Event | Meaning |
|---|---|
| `BOT_LISTENING` | identity loaded, polling started |
| `BOT_STATE_RESTORED` | sessions and dedup reloaded from disk |
| `BOT_RECEIVED_OPENER` / `BOT_RECEIVED_TEXT` | inbound message accepted |
| `BOT_REJECTED_UNLISTED` | sender not on the allowlist |
| `BOT_SESSION_DECODE_FAILED` | follow-up arrived but could not be decrypted |
| `BOT_PEER_DEVICE_ADDED` / `BOT_PEER_DEVICE_REMOVED` | the peer's device roster changed (`deviceChatAccepted`, `deviceAdded`, `deviceRemoved`) |
| `BOT_OUTBOUND_EXTENDED` / `BOT_OUTBOUND_TAKEOVER` | the un-ACKed statement grew losslessly / the liveness backstop replaced it (a peer that never ACKs) |
| `BOT_SENT_TEXT` | reply published (carries `replyTo`/`editOf` when quoting/editing) |
| `BOT_MEDIA_DOWNLOADED` / `BOT_MEDIA_DOWNLOAD_FAILED` | attachment fetched from the HOP node (or not — the brain gets a failure note) |
| `BOT_RECEIVED_REACTION` / `BOT_SENT_REACTION` | emoji reaction in / out |
| `BOT_CALL_OFFER` / `BOT_CALL_DECLINED` | WebRTC call offer received / auto-declined |
| `BOT_COINAGE_RECEIVED` | peer sent a Coinage payment (informational; the bot cannot claim it) |
| `BOT_UNDECODABLE_MESSAGE` / `BOT_UNSUPPORTED_CONTENT` | message kind the codec can't parse / doesn't know |
| `BOT_LIVE_PLACEHOLDER` / `BOT_LIVE_STATUS` / `BOT_LIVE_FALLBACK` | thinking placeholder posted / retired to its status line / peer never ACKed it, answer superseded it instead |
| `BOT_LIVE_ACK_TIMEOUT` / `BOT_LIVE_EDIT_FAILED` / `BOT_LIVE_FINALIZE_FAILED` | live-reply edge cases (progress dropped, final fell back) |
| `BOT_AI_FAILED` / `BOT_AI_AUTH_REVOKED` / `BOT_AI_IDLE_TIMEOUT` | direct-engine turn failed / needs re-login / was killed by the idle backstop |
| `BOT_STOP` / `BOT_RESUME_INVALIDATED` | user /stop cancelled a turn / resume tokens dropped after an engine, model, or workspace change |

## CI

`.github/workflows/ci.yml` runs on every push: bot-core installs from scratch and
its CLI creates a bot offline, the vendored wasm proof helper is run against a
known answer, the sandbox suite runs with its scenarios (a pca bot against
personas), the OpenClaw plugin bundle is rebuilt and compared to the committed
`dist/`, and the Rust proof helper builds for native and wasm targets.
