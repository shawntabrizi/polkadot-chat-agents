# Acceptance record

One entry per milestone: what was run, the summary lines, what is verified
and what is not.

## S0 — Store node and scaffold (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1):

```
✔ channel replacement: only a strictly greater expiry replaces; equal or lower is channelPriorityTooLow
✔ noAllowance: a signer outside the allowance set is rejected; null allows everyone
✔ accountFull: a full account evicts its lowest expiry only for a higher newcomer
✔ initial dumps are paged with a correct remaining count; live pushes carry none
✔ list() filters by topic, signer and channel and never needs a key
✔ invalid submits: no proof, already expired, undecodable
✔ fault drop: matching submits are answered new but never stored, for count hits
✔ fault delay: the submit is stored and answered only after ms
✔ fault holdDump: a matching subscription gets nothing until released
✔ clock offset: expiry checks follow the node clock, stored statements expire
✔ restart drops every connection and keeps the store; reset wipes it
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

`cd bot-core && npm test` against the moved node (bot-core code unchanged,
only the import path):

```
ℹ tests 416
ℹ suites 1
ℹ pass 416
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 73839.283208
```

No `STORE_NODE_SUBMIT_REFUSED` line in the run: the new rules never
refused a bot-core submit. The suite was run again after the last node
fix (channel-less statements never occupy a slot) with the same result.

Three full bot-core runs were made. Runs 1 and 3 were 416/416. Run 2 had
one failure, `test/workspaces.test.mjs` "worktree subprocess timeout reaps
a stalled command": its fake `git rev-parse` took longer than the 500 ms
timeout under the concurrent e2e load and reported "not a git repository"
instead of the timeout. That file never touches the store node and passed
3/3 when run alone; it is a pre-existing timing sensitivity, not an S0
regression.

### Rules pinned to sources

| rule | source |
|---|---|
| replace only on strictly greater expiry; `channelPriorityTooLow { submitted_expiry, min_expiry }` | `polkadot-sdk/substrate/client/statement-store/src/lib.rs` `SubmitIndex::insert`; `chat-spec/base-spec.md` |
| resubmit of a stored statement is `known` | `Store::submit` duplicate check |
| `invalid/alreadyExpired` when `now >= expiry >> 32` | `Store::submit` step 1 |
| `invalid/noProof` | `Store::submit` step 4 |
| `rejected/noAllowance` | `Store::submit` step 5 |
| count limit evicts lowest expiry, else `accountFull { submitted_expiry, min_expiry }` | `SubmitIndex::insert` constraint loop |
| result JSON: `status`/`reason` camelCase tags, snake_case fields, u64 as bare integers | `sp_statement_store::store_api` serde attributes; Android `SubmitStatementResult.kt` |
| dump pages carry `remaining`, live pushes do not | `sc_rpc::statement::send_in_chunks`; `subscription.rs` `notify_matching_filters` |
| undecodable submit is a JSON-RPC error 7001 "Statement store error: ..." | `sc_rpc_api::statement::error` |

### Not verified / not modelled

- `badProof` (signature verification), `dataTooLarge`, `storeFull`,
  `encodingTooLarge`: not implemented (see `docs/questions.md`).
- Empty initial dump: the node sends one empty page; the real node sends
  nothing (question 2 in `docs/questions.md`).
- Live-push behaviour on channel replacement: the node pushes every stored
  statement; `PLAN.md` notes the real node is unreliable here. Unchanged
  from the old mock, to be modelled in S3 with the fault work.
- No live-network comparison was run; every rule above is pinned to source,
  not to a recorded exchange with a deployed node.

## S1 — Directory, personas, text between two personas (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1), 46 tests in 7 files:

```
✔ toWire encodes every outgoing variant as the apps expect
✔ fromWire maps rows, effects, roster variants, ignores and unknown tags
✔ identity channel carries deviceChatAccepted, roster fan-out and plain content; drops legacy chatAccepted
✔ peer session delivers a text to every device of a two-device peer, reports the ack, dedups the re-sent batch
✔ peer session rejects a send with no known device and picks up a device added to the roster
✔ engine records a verified incoming request and answers accept with deviceChatAccepted carrying this device
✔ engine drops a request whose sender is unknown on chain or whose proof is wrong; decline is local
✔ engine sends a request the peer can decode and turns the peer accept into a contact; the channel survives a restart
✔ engine: accept creates the room with the welcome message (read), the system row and the device fan-out
✔ engine: sends text sending → sent → delivered on the ack; applies the peer's text, reaction, edit, reply; counts unread
✔ engine: declines a call offer with dataChannelClosed, shows a bot welcome on the identity session, fails without a session
✔ pcs: user add/list, request, requests, accept, send, inbox --device, react, edit, wire --peer
✔ identifier key container is 0x00 || pk || pad, and readers ignore the padding
✔ register publishes the container, maps the username and grants the allowance
✔ usernames are unique; an account may rotate its key but not its name
✔ allow grants a device account bandwidth without making it messageable
✔ alice (1 device) and bob (2 devices): request, accept, text, reply from device 2, reaction, edit
✔ device keys: a complete, self-consistent set, fresh every time
✔ identity keys: sr25519 account and an X25519 chat key pair
✔ a persona registers its identity and every device account, and never exposes a secret
✔ messages: the room is created with the first message and counts unread incoming rows
✔ messages: a duplicate id is one row; each receiving device is remembered
✔ messages: a room lists in timestamp order and keeps peers apart
✔ messages: reactions toggle per emoji and side; edits touch text rows only
✔ messages: a batch ack moves outgoing rows sent before it to delivered, nothing else
✔ contacts: one entry per device, re-announced keys replace, username and key refresh
✔ requests: added once, status moves, pending lookup per peer and direction, newest first
✔ state changes are observable, which is how sibling devices follow each other
✔ getCurrentDay counts days from the shared epoch and is null before it
✔ discovery topics match the iOS vectors
✔ round trip: reaches the recipient on its discovery topics and decodes with the identity chat key
✔ accepts the bot-core form with an outer Bytes() wrapper; garbage is null, not a throw
✔ subscribeToIncomingRequests delivers existing and later requests once each, and only ours
✔ intake records a verified request once and drops unknown senders and bad proofs
✔ channel replacement: only a strictly greater expiry replaces; equal or lower is channelPriorityTooLow
✔ noAllowance: a signer outside the allowance set is rejected; null allows everyone
✔ accountFull: a full account evicts its lowest expiry only for a higher newcomer
✔ initial dumps are paged with a correct remaining count; live pushes carry none
✔ list() filters by topic, signer and channel and never needs a key
✔ invalid submits: no proof, bad proof, already expired, undecodable
✔ watch(): stored and refused events carry signer, channel and replacement
✔ fault drop: matching submits are answered new but never stored, for count hits
✔ fault delay: the submit is stored and answered only after ms
✔ fault holdDump: a matching subscription gets nothing until released
✔ clock offset: expiry checks follow the node clock, stored statements expire
✔ restart drops every connection and keeps the store; reset wipes it
ℹ tests 46
ℹ pass 46
ℹ fail 0
```

The store-node tests are the S0 set plus `badProof` (an alice-signed
statement claiming bob's account, a valid signature over changed data, an
unverifiable signer) and `watch()`. The persona, requests and chat tests are
ports of the web client's specs and run on the SDK's in-memory adapter (with
one real-node behaviour added in `test/helpers.mjs`: a fresh subscription
dumps what already matches — the SDK's sessions rely on it when a roster
change re-opens their subscription, and the store node does it). The e2e
test starts the daemon on random ports and drives everything through the
HTTP API, with personas connected to the store node over WebSocket through
papi and the SDK adapter — the same path Polkadot Desktop uses. The CLI test
spawns `pcs` as a child process against such a daemon and parses `--json`.

`cd bot-core && npm test` against the renamed node with `badProof` enforced
(run after the node follow-ups commit, again after the last commit):

```
ℹ tests 416
ℹ pass 416
ℹ fail 0
```

Both runs 416/416, exit 0.

No `STORE_NODE_SUBMIT_REFUSED` line in either run: every statement bot-core
submits carries a proof the node verifies.

### The acceptance session

`pcs up --dir <scratch>/state --port 7788` in one terminal (the state dir
was created mode 0700 with a 0600 `daemon.json`), then in another, with a
TTY so the human output is shown. About one second passed between `accept`
and `send` and between `send` and `inbox`, as when a person types.

```
$ pcs user add alice
✓ alice registered as 0xcaa8d88d… with 1 device(s)
  device 1: 0x86cdfacc…

$ pcs user add bob --devices 2
✓ bob registered as 0x682e8d8c… with 2 device(s)
  device 1: 0x78a90152…
  device 2: 0x8cf63162…

$ pcs request alice bob
✓ alice → bob: request a0fa3836-115f-4c78-8cb2-0001d682678f

$ pcs requests bob
→ from alice pending  a0fa3836-115f-4c78-8cb2-0001d682678f

$ pcs accept bob
✓ bob accepted the request from alice on device 1

$ pcs send alice bob hi
✓ alice → bob: sent  id 9451f431-d92a-4851-be0c-35a96c7af01e

$ pcs inbox bob --device 2
→ bob ⇄ alice (device 2)  1 unread
09:14:41 ·: chat accepted
  id accepted:a0fa3836-115f-4c78-8cb2-0001d682678f
09:14:43 alice: hi [on #1,#2 acked #1,#2 unread]
  id 9451f431-d92a-4851-be0c-35a96c7af01e

$ pcs wire --peer alice
→ alice#1  chat request  seq 25434880  547B
  topic request→bob
  topic request→bob day 294
  topic 0x16f0a37f86ce53a35eabff90fed2a9298e137395bbc3e54eb886ad7badf294a8
→ bob#1  identity bob→alice /request  seq 25434881  379B
  topic identity bob→alice
→ bob#1  session bob#1→alice /request  seq 25434883  583B  replaced ×1
  topic session bob#1→alice
→ alice#1  identity alice→bob /response  seq 25434881  228B
  topic identity alice→bob
→ alice#1  session alice#1→bob /response  seq 25434882  445B
  topic session alice#1→bob
→ alice#1  session alice#1→bob /request  seq 25434884  497B  replaced ×1
  topic session alice#1→bob
→ bob#1  session bob#1→alice /response  seq 25434885  352B  replaced ×1
  topic session bob#1→alice
→ bob#2  session bob#2→alice /response  seq 25434883  352B  replaced ×1
  topic session bob#2→alice
```

Reading it:

- `inbox bob --device 2` shows alice's text `on #1,#2 acked #1,#2`: both
  bob devices decrypted the one statement and each acknowledged it on its
  own response channel (`session bob#1→alice /response`,
  `session bob#2→alice /response` in the wire). The row is `unread` because
  unread is per persona and cleared by the API's `read` call, which the CLI
  does not make.
- `wire --peer alice` shows the text as `alice#1  session alice#1→bob
  /request`: the statement on alice's device session towards bob, the topic
  every bob device derives from alice's device key and bob's identity key
  (mds.md `SessionId(D(A), B)`), wrapped for both bob devices. `replaced ×1`
  because the slot first held alice's device fan-out; the store keeps one
  statement per (signer, channel).
- The request rides bob's discovery topics (`request→bob`, the day topic)
  plus its ephemeral channel topic, which no label covers by design.
- The accept rides `identity bob→alice /request` (identity session, signed
  by bob#1), and alice acknowledges it on `identity alice→bob /response`.
- bob#1's `session bob#1→alice /request` (`replaced ×1`) is the fan-out:
  `deviceAdded` for bob#1 then bob#2, the second extending the first. That
  is how alice learned device 2 before sending.

### What is not verified

- No phone or bot-core bot talked to a persona yet. Interop rests on the
  ported web client (which does talk to phones and to bot-core) and on the
  shared SDK; S2 attaches bot-core.
- Persistence: nothing but `daemon.json` is written to the state dir; a
  daemon restart forgets personas and node contents.
- WS reconnect: the web client rebuilds its sessions after a drop because
  raw `statement_subscribeStatement` subscriptions do not survive one. The
  daemon has no equivalent yet; `pcs node restart` (S3) will need it.
- The wire view does not decrypt payloads or match ACKs to messages (S3).
- Empty initial dump stays as in S0 (one empty page), by the S0 answer: it
  changes in S2 together with the bot-core fix.

## S2 — bot-core attached (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1), 48 tests in 8 files; the two new
ones are the scenarios, each on a fresh daemon with a bot created and run
through `pca`:

```
✔ toWire encodes every outgoing variant as the apps expect
✔ fromWire maps rows, effects, roster variants, ignores and unknown tags
✔ identity channel carries deviceChatAccepted, roster fan-out and plain content; drops legacy chatAccepted
✔ peer session delivers a text to every device of a two-device peer, reports the ack, dedups the re-sent batch
✔ peer session rejects a send with no known device and picks up a device added to the roster
✔ engine records a verified incoming request and answers accept with deviceChatAccepted carrying this device
✔ engine drops a request whose sender is unknown on chain or whose proof is wrong; decline is local
✔ engine sends a request the peer can decode and turns the peer accept into a contact; the channel survives a restart
✔ engine: accept creates the room with the welcome message (read), the system row and the device fan-out
✔ engine: sends text sending → sent → delivered on the ack; applies the peer's text, reaction, edit, reply; counts unread
✔ engine: declines a call offer with dataChannelClosed, shows a bot welcome on the identity session, fails without a session
✔ pcs: user add/list, request, requests, accept, send, inbox --device, react, edit, wire --peer
✔ identifier key container is 0x00 || pk || pad, and readers ignore the padding
✔ register publishes the container, maps the username and grants the allowance
✔ usernames are unique; an account may rotate its key but not its name
✔ allow grants a device account bandwidth without making it messageable
✔ alice (1 device) and bob (2 devices): request, accept, text, reply from device 2, reaction, edit
✔ device keys: a complete, self-consistent set, fresh every time
✔ identity keys: sr25519 account and an X25519 chat key pair
✔ a persona registers its identity and every device account, and never exposes a secret
✔ messages: the room is created with the first message and counts unread incoming rows
✔ messages: a duplicate id is one row; each receiving device is remembered
✔ messages: a room lists in timestamp order and keeps peers apart
✔ messages: reactions toggle per emoji and side; edits touch text rows only
✔ messages: a batch ack moves outgoing rows sent before it to delivered, nothing else
✔ contacts: one entry per device, re-announced keys replace, username and key refresh
✔ requests: added once, status moves, pending lookup per peer and direction, newest first
✔ state changes are observable, which is how sibling devices follow each other
✔ getCurrentDay counts days from the shared epoch and is null before it
✔ discovery topics match the iOS vectors
✔ round trip: reaches the recipient on its discovery topics and decodes with the identity chat key
✔ accepts the bot-core form with an outer Bytes() wrapper; garbage is null, not a throw
✔ subscribeToIncomingRequests delivers existing and later requests once each, and only ours
✔ intake records a verified request once and drops unknown senders and bad proofs
✔ scenario bot-restart.mjs
✔ scenario echo-roundtrip.mjs
✔ channel replacement: only a strictly greater expiry replaces; equal or lower is channelPriorityTooLow
✔ noAllowance: a signer outside the allowance set is rejected; null allows everyone
✔ accountFull: a full account evicts its lowest expiry only for a higher newcomer
✔ initial dumps are paged with a correct remaining count; live pushes carry none
✔ list() filters by topic, signer and channel and never needs a key
✔ invalid submits: no proof, bad proof, already expired, undecodable
✔ watch(): stored and refused events carry signer, channel and replacement
✔ fault drop: matching submits are answered new but never stored, for count hits
✔ fault delay: the submit is stored and answered only after ms
✔ fault holdDump: a matching subscription gets nothing until released
✔ clock offset: expiry checks follow the node clock, stored statements expire
✔ restart drops every connection and keeps the store; reset wipes it
ℹ tests 48
ℹ pass 48
ℹ fail 0
ℹ duration_ms 32969.063709
```

`cd bot-core && npm test`, every transport e2e test now against a sandbox
daemon (store node + directory) with both identities registered, the
identifier-key lookup going through `lib/people-directory.mjs` — the path a
deployed bot uses — instead of a pin list:

```
ℹ tests 417
ℹ suites 1
ℹ pass 417
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 74155.352625
```

The 417th test is `create --network sandbox registers through the sandbox
directory and runs against its store node` (an in-process mock of the
control API). Both suites were run once more on the final tree with the
same result; no `STORE_NODE_SUBMIT_REFUSED` line in either run.

### The acceptance session: alice ↔ echo bot

`pcs up --dir <scratch>/acc/state --port 7797` in one terminal, then (with
`PCA_SANDBOX_URL=http://127.0.0.1:7797`, TTY output, `pca run echobot` in a
third terminal after `create`). About three seconds passed between
`request`, `send` and `react`.

```
$ pcs user add alice --devices 2
✓ alice registered as 0x445fb972… with 2 device(s)
  device 1: 0x648c1981…
  device 2: 0xacd3f487…

$ pca create echobot --brain echo --public --network sandbox --port 18797
→ Creating bot "echobot"…
✓ Generated your bot's identity
→ Registering your bot in the sandbox…
✓ Registered as echobot
→ Waiting for the network to confirm (up to 180s)…

✓ Confirmed — your bot is live and people can message it!

Open — anyone can message it.
Message your bot in the Polkadot app:
  polkadotapp://chat?id=0:0x0cbd484bd1cb2308426f6e41e00f64b7d71985e66edda636035c8fd164aa9834&force=false&chatId=0cbd484bd1cb2308426f6e41e00f64b7d71985e66edda636035c8fd164aa9834
  or search: echobot

  Start it:  pca run echobot

$ pca status echobot
→ Status of "echobot" (local)…
✓ "echobot" is running locally.
  echobot · reaching the network

$ pcs request alice echobot --welcome hello bot
✓ alice → echobot: request 96c8ed4a-ad20-4daa-a6ce-fe1de847390c

$ pcs send alice echobot from my second device --device 2
✓ alice → echobot: sent  id a5c04ada-2b37-4d6b-a54d-5f8c21a41b68

$ pcs react alice echobot 7AD5D9AC-1618-45B1-9EE3-9199AFF01E99 👍
✓ alice reacted 👍 on 7AD5D9AC-1…

$ pcs inbox alice --device 2
→ alice ⇄ echobot (device 2)  3 unread
10:02:29 alice: hello bot [delivered from #1]
  id 96c8ed4a-ad20-4daa-a6ce-fe1de847390c
10:02:29 ·: chat accepted
  id accepted:96c8ed4a-ad20-4daa-a6ce-fe1de847390c
10:02:32 alice: from my second device [delivered from #2]
  id a5c04ada-2b37-4d6b-a54d-5f8c21a41b68
10:02:32 echobot: Echo: from my second device [on #1,#2 acked #1,#2 unread] 👍
  id 7AD5D9AC-1618-45B1-9EE3-9199AFF01E99

$ pcs wire --peer alice
→ alice#1  chat request  seq 25437749  559B
  topic request→echobot
  topic request→echobot day 294
  topic 0xbee29decf39dea15334d6675db482aca2281bb1736bbe945f0e93630f1e25893
→ echobot  identity echobot→alice /request  seq 25437749  443B
  topic identity echobot→alice
→ alice#1  identity alice→echobot /response  seq 25437750  244B
  topic identity alice→echobot
→ alice#2  session alice#2→echobot /request  seq 25437752  424B
  topic session alice#2→echobot
→ echobot  session echobot#1→alice /request  seq 25437754  538B  replaced ×1
  topic session echobot#1→alice
→ alice#1  session alice#1→echobot /response  seq 25437754  368B  replaced ×1
  topic session alice#1→echobot
→ alice#2  session alice#2→echobot /response  seq 25437753  368B
  topic session alice#2→echobot
→ alice#1  session alice#1→echobot /request  seq 25437756  444B  replaced ×2
  topic session alice#1→echobot
→ echobot  session echobot#1→alice /response  seq 25437756  445B  replaced ×3
  topic session echobot#1→alice

### bot events
   1 "event":"BOT_BRIDGE_LISTENING"
   1 "event":"BOT_LISTENING"
   3 "event":"BOT_PEER_DEVICE_ADDED"
   1 "event":"BOT_RECEIVED_OPENER"
   1 "event":"BOT_RECEIVED_REACTION"
   1 "event":"BOT_RECEIVED_TEXT"
   2 "event":"BOT_SENT_TEXT"
   1 "event":"BOT_STARTING"
   1 "event":"BOT_SUBSCRIBED"
```

Reading it:

- `pca create … --network sandbox` asked the daemon for its store node,
  registered the bot through the directory (no proof, no backend, no wait)
  and wrote a config with `networkProfile: "sandbox"`, `endpoint:
  ws://127.0.0.1:59649`, `backendUrl: http://127.0.0.1:7797`. `pca status`
  read the bot's `/health` as for any local bot.
- `inbox alice --device 2` shows what device 2 received: alice's own rows
  (`delivered` = the bot ACKed them, `from #2` for the device-2 send) and
  the bot's answer `Echo: from my second device [on #1,#2 acked #1,#2]` —
  one statement, decrypted and ACKed by both of her devices, with her 👍 on
  it. The echo of the opener is not in this view: it reached device 1 only,
  because the bot answered the request before alice's fan-out told it about
  device 2 (protocol ordering; a phone's sibling devices see the same gap).
- `wire --peer alice`: the accept on `identity echobot→alice /request`;
  alice's device-2 text on `session alice#2→echobot /request`; the bot's
  answers on `session echobot#1→alice /request` (`replaced ×1`: the second
  answer took the slot after the first was ACKed) and its ACKs on
  `session echobot#1→alice /response` (`replaced ×3`: one slot, one ACK per
  request from either device). Every signer is labelled; the bot's channels
  are derived from alice's keys and the bot's public keys in her roster.
- The bot's log: one opener, three `BOT_PEER_DEVICE_ADDED` (alice#1 from the
  request, then her fan-out of #1 and #2), one text, one reaction, two
  answers — the reaction was recorded, not answered.

### test-client-device.mjs against a persona (the known bug, reproduced once)

The device client played the phone, bob (one device) played the peer. bob's
device statement account differs from his identity account, as a phone's
does.

```
$ pcs user add bob
✓ bob registered as 0x52238aa0… with 1 device(s)
  device 1: 0xc22a2715…
$ curl -X POST /accounts/register (the device client's throwaway identity 0x33…)
{"account":"0x865ac3ec86396d918f8e5ceb72711008a4542c10177856d522ea7250747d8b47","username":"devclient","identifierKey":"0x006a9e22c77d7d150d015469a4ac1138c76b8a004f64c8661357eddff9445d6e3c0000000000000000000000000000000000000000000000000000000000000000"}
$ node test-client-device.mjs --seed-hex 0x33… --bot-account 0x52238aa0cf87b2fa90d346beb448e208a9a8a4272fff1bc3a6424976868f2023 --bot-identifier-key <bob's container> --endpoint ws://127.0.0.1:59649 --wait-secs 6 "hello bob" "follow-up"

$ pcs accept bob   (from another terminal, 3s in)
{
  "requestId": "17FD73AA-9563-4AD2-BB86-E388762859B9",
  "peer": "0x865ac3ec86396d918f8e5ceb72711008a4542c10177856d522ea7250747d8b47",
  "peerUsername": "devclient",
  "peerChatPublicKey": "0x6a9e22c77d7d150d015469a4ac1138c76b8a004f64c8661357eddff9445d6e3c",
  "direction": "incoming",
  "status": "accepted",
  "welcomeMessage": "hello bob",
  "timestamp": 1788602559532,
  "senderDevice": {
    "statementAccountId": "0x865ac3ec86396d918f8e5ceb72711008a4542c10177856d522ea7250747d8b47",
    "encryptionPublicKey": "0xb3894ea39a3398ecbaa5fed2a132e29d14222bf5e7faaf048c8e4a23ba452106"
  },
  "device": 1,
  "createdAt": 1788602559550
}
sender=0x865ac3ec86396d918f8e5ceb72711008a4542c10177856d522ea7250747d8b47 deviceKey=0xb3894ea39a3398ec…
device ownSessionId (bot must poll this): 0x58096fd86525807326fd0fefaea0028e3fe9eabd5bf4abd1f7a6224d5fbad960
[ME opener] hello bob
  [BOT DEVICE] 0xf83c06ac96b4a684…
[ME device-channel] (poison image msg) + "follow-up"

=== replies=0 acks=0 ===
client exit=0

$ pcs inbox bob
→ bob ⇄ devclient
10:02:39 devclient: hello bob [on #1]
  id 17FD73AA-9563-4AD2-BB86-E388762859B9
10:02:42 ·: chat accepted
  id accepted:17FD73AA-9563-4AD2-BB86-E388762859B9

$ pcs wire --peer bob
→ devclient  chat request  seq 25437759  526B
  topic request→bob
  topic request→bob day 294
→ bob#1  identity bob→devclient /request  seq 25437762  379B
  topic identity bob→devclient
→ bob#1  session bob#1→devclient /request  seq 25437763  468B
  topic session bob#1→devclient
→ devclient  session devclient#1→bob /response  seq 25437763  352B
  topic session devclient#1→bob
→ devclient  session devclient#1→bob /request  seq 25437765  481B
  topic session devclient#1→bob
```

The client learned bob's device key (`[BOT DEVICE]`) but keyed its
follow-up envelope by bob's *identity* account; bob's device found no entry
for itself, the SDK dropped the statement as undecodable, bob's inbox holds
only the opener and no ACK for the follow-up exists on the wire
(`replies=0 acks=0`). Exactly the limit PLAN.md describes. The client is
kept (see below); the bug is documented, not fixed.

### bot-core defects the sandbox found

| finding | outcome |
|---|---|
| Empty initial dump: the poll sweep would time out at `BOT_QUERY_TIMEOUT_MS` (S0 answer 2) | **Not a defect.** `Store::subscribe_statement` sends one empty page (`remaining: Some(0)`) below the RPC's `send_in_chunks`; the S0 node was faithful. Evidence and the corrected answer: `docs/decisions.md` D1, `docs/questions.md` S2. Commit `aa7bc92`. No bot-core change. |
| Single-device addressing after a two-device accept (S1 question 1) | **Not a defect.** bot-core folds `deviceAdded` into its roster (`index.mjs`, `BOT_PEER_DEVICE_ADDED`); every answer after the fan-out reached both alice devices with ACKs (echo-roundtrip). `deviceRemoved` (17/18: only 17 is decoded) is still unhandled; no persona sends it yet. |
| Session rebuild after `kill -9` with a reply owed | **Holds.** One answer from the journal, nothing re-received, nothing duplicated (bot-restart). |

Observations that are not defects but worth a look (questions.md S2):

- With `BOT_ACK_TEXT` empty (the echo brain's default) the bot still sends an
  empty text message next to its accept on the identity session; a persona
  shows it as an empty row. A phone likely shows an empty bubble.

### What is verified

- A bot created by `pca create --network sandbox` runs unchanged against
  the sandbox with `pca run`, `status`, `info`; `pcs bot attach` registers a
  bot by hand from `config.json` only.
- Per-device polling and addressing, ACKs both ways, reaction/reply/edit
  handling, and restart survival, all against the SDK behind Polkadot
  Desktop rather than bot-core's own test client.
- The wire view labels a bot's signer and channels.

### What is not verified

- No phone talked to the sandbox; interop with the app still rests on the
  SDK and on the web client's record.
- Poison batches, HOP attachments, `--no-ack`, call offers: still only
  `test-client-device.mjs` in bot-core's suite (S3, v1.5).
- Persistence and faults: unchanged from S1 (S3).
- The first answer after an accept reaches the requester's other devices
  only if it is sent after the fan-out; the sandbox asserts the gap, it
  does not close it.

## S3 — Faults, clock, invariants (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1), 61 tests in 8 files, on the final
tree. New since S2: the store node's fault matching and slot history, the
decoded wire with faults, clock and node restart over the API and `pcs`,
the persona additions (poison batches, call offers, raw sends, device
removal), and nine scenarios, one per invariant:

```
✔ peer session: one undecodable message in a batch is skipped, the rest delivered, the batch ACKed success; an all-poison batch is NACKed
✔ pcs: user add/list, request, requests, accept, send, inbox --device, react, edit, wire --peer
✔ faults, clock and node restart; the wire decodes both directions and matches ACKs per device
✔ fault matching: by topic, by a set of signers, forever with count null; every set/hit/clear is an event
✔ history(): a slot remembers what a replacement, an eviction or the clock pushed out, with the reason
✔ scenario accept-without-welcome.mjs
✔ scenario ack-or-resend.mjs
✔ scenario bot-restart.mjs
✔ scenario call-offer.mjs
✔ scenario channel-clobber.mjs
✔ scenario device-removed.mjs
✔ scenario echo-roundtrip.mjs
✔ scenario every-device-session.mjs
✔ scenario expiry-while-queued.mjs
✔ scenario no-ack-peer.mjs
✔ scenario poison-batch.mjs
ℹ tests 61
ℹ pass 61
ℹ fail 0
ℹ duration_ms 67023.47125
```

`cd bot-core && npm test` on the final tree (the three bot-core commits
below included, the transport e2e against the S3 daemon):

```
ℹ tests 417
ℹ pass 417
ℹ fail 0
```

Both suites were also run after each bot-core commit (417/417 each time)
and the sandbox suite after each sandbox commit's tree. The bot-core run
has no `STORE_NODE_SUBMIT_REFUSED` line. The sandbox run has 14: 13 from
the store-node unit tests, which provoke every rejection on purpose, and
one `channelPriorityTooLow` with a chat-client expiry (`…5061` against
`…5062`) — a persona's superseded submission of an extended batch losing
the slot race to its own extension, which the SDK settles as success and
bot-core would retry with a bumped expiry. Benign, and the rule working.

### The scenarios

One `pcs scenario run` each on the final tree, with the line the scenario
logged. Every scenario asserts on `GET /wire` (decoded payloads, ACK state,
slot history) as well as on the inboxes and the bot's log.

| scenario | invariant | result | what it proved |
|---|---|---|---|
| `ack-or-resend` | every inbound request is ACKed; a resend is answered once | pass (4.5 s) | The node dropped the bot's ACK once (`fault #1`, by bot name and channel label); alice's row stayed `sent`; her next message re-submitted the un-ACKed one as a superset under a new request id; the bot ACKed that and deduped "first": `BOT_RECEIVED_TEXT` ×2 for two messages, one answer row each, the replaced single-message statement in the slot history. |
| `poison-batch` | one undecodable message never aborts the batch | pass (1.9 s) | The device test client's poison rode next to a text; the bot logged `BOT_UNDECODABLE_MESSAGES count 1`, answered the text once, ACKed the batch; the wire shows both in one statement, one marked undecodable, and an ACK on all 3 statements the slot ever held (the poison-only one too). The persona-side rule (success if anything decoded, `decodingFailed` if nothing) is pinned in the peer-session unit test. |
| `channel-clobber` | direct submits clobber the un-fetched slot; outbound lanes never | pass (1.7 s) | Node: two direct submits on one (signer, channel), no fetch between, one statement left, history `[1 replaced, 2 live]`. Bot: 12 bridge `/send` calls at once → 3 statement versions, 1 lane extension, 0 takeovers, all 12 on alice with ACKs, every version a superset of its un-ACKed predecessor. |
| `every-device-session` | follow-ups are polled on every device session | pass (3.1 s) | Three devices, each follow-up on its own `session alice#n→echobot /request`, each received once, answered on all three devices with ACKs from each, each request ACKed by the bot; envelopes name all three recipients; the persisted roster holds three. |
| `expiry-while-queued` | (PLAN.md S3) expiry passing while a message is queued | pass (4.1 s), semantics changed — see below | Every chat statement of both implementations carries `expiresAt: null` (0xffffffff). With the bot stopped, alice's message waited in the store; `clock +2h` expired a hand-planted 60 s statement (history `expired`) and not hers; the restarted bot fetched, answered and ACKed it; her next statement took the slot with sequence 25440559 → 25440561. |
| `no-ack-peer` | one un-ACKed request current per peer, queue behind it, the liveness backstop | pass (10.0 s) | alice's ACKs dropped forever. Nine answers → one statement (8 `BOT_OUTBOUND_EXTENDED`, each version a superset); the tenth queued, not submitted; `BOT_OUTBOUND_TAKEOVER dropped 9 queued 1` 3.0 s after the current statement (`BOT_OUTBOUND_ACK_GRACE_MS=3000`, measured on the bot's own log stamps); then the slot held only "Echo: q10"; q11 extended it and no second takeover fired with nothing queued; alice received all 11 answers once. |
| `call-offer` | dataChannelOffer is ACKed, then declined | pass (2.0 s) | `BOT_CALL_OFFER purpose 0`, `BOT_CALL_DECLINED` naming alice's offer id; the ACK stamped at .975Z, the decline at .979Z; alice's inbox shows the decline under her offer; the brain never ran. |
| `accept-without-welcome` | S2 answer 2: empty `BOT_ACK_TEXT` sends the accept alone | pass (3.3 s) | echobot's identity statement decodes to `[deviceChatAccepted]`, alice sees only `contactAdded`; a second bot with `BOT_ACK_TEXT="Welcome aboard"` sends `[deviceChatAccepted, text]` and bob sees the welcome once. |
| `device-removed` | S2 answer 3: a removed device stops being addressed | pass (2.8 s) | alice removed device 2; device 1 fanned out `deviceRemoved`; `BOT_PEER_DEVICE_REMOVED remaining 1`; the persisted roster went 2 → 1; the next answer's envelope named `alice#1` alone; nothing new from device 2 on the wire. |
| `echo-roundtrip` (S2) | per-device polling, ACKs, reaction/reply/edit | pass (4.9 s) | Unchanged except the welcome assertion: no empty welcome row any more. |
| `bot-restart` (S2) | session rebuild on restart | pass (17.1 s) | Unchanged. |

### bot-core defects found and fixed

| finding | commit |
|---|---|
| An empty `BOT_ACK_TEXT` sent an empty text message next to the accept (an empty bubble on a phone; S2 question 2). Empty now sends the accept alone. | `d10db06` fix(transport) |
| `deviceRemoved` (kind 18) was logged as unsupported; the bot kept wrapping envelopes for the dead device and watching its session topic (S2 question 3). Now applied to the roster, persisted, `BOT_PEER_DEVICE_REMOVED`. Decoded in `index.mjs` from the codec's raw content because `vendor/` is off limits by rule (questions.md S3.4). | `2081211` feat(transport) |
| `test/workspaces.test.mjs` "worktree subprocess timeout reaps a stalled command" raced a fast fake `rev-parse` against the same 500 ms budget under load (S0, S2 runs). Every fake git call now stalls; the probe's error no longer hides a timeout behind "not a git repository". | `a0e94f0` test(workspaces) |

### Invariants that did not hold

None. Every CLAUDE.md invariant the scenarios target held on the first
green run against bot-core; the only bot-core changes were the two
S2-answer items above and the test flake. No scenario is skipped.

### Deviations from PLAN.md, and why

- **`expiry-while-queued` does not assert a re-allocation.** PLAN.md asked
  to "assert the sender re-allocates expiry and the message still lands".
  No chat client re-allocates on expiry: both pin the high word to
  0xffffffff and treat the low word as a sequence (`createExpiryAllocator`
  in the SDK, `expiryFactory` in bot-core), so a clock jump expires nothing
  a chat client wrote. The scenario proves what holds and plants a
  real-expiry statement by hand to show the clock does work. A jump past
  2106 would expire everything with no recovery path in either client — a
  protocol limit, recorded, not exercised (questions.md S3.1).
- **`ack-or-resend` resends through the SDK's extension path**, not a
  timer: the persona re-submits its un-ACKed batch with its next message,
  which is the only resend the SDK has (questions.md S3.2).
- **`every-device-session` sends the three follow-ups one at a time.** A
  device's ACKs share one response channel, so three simultaneous requests
  would race for one ACK slot — an SDK-acknowledged protocol limit, not
  something the bot can fix (questions.md S3.3).
- **No `faults.mjs`.** Faults live inside `store-node.mjs` since S0; the
  API resolves names and labels in `api.mjs`. One less file than PLAN.md's
  tree, nothing missing.
- **`pcs fault hold-dump --for bob`** holds subscriptions that mention
  bob's discovery topic (`request→bob`); session topics are held with
  `--topic <label>`.
- **`POST /node/reset`** exists next to `/node/restart` (the task asked for
  it); both rebuild every persona's transport, because raw statement
  subscriptions do not survive a socket drop.
- **`test-client-device.mjs` is kept**, not deleted: the scenarios cover
  everything it did except a real HOP attachment (`--attach`, eight bot-core
  offline tests) and a live-network send from a real seed. Retire it with
  the HOP sandbox (v1.5); `docs/guide/testing.md` says so.

### What is verified

- Faults by signer set (persona name), channel and topic (hex or label),
  with `count` and `forever`; delay; hold-dump; every set/hit/clear in the
  event stream. Clock offset. Node restart and reset with personas
  recovering their sessions.
- The wire decoded in both directions: persona↔persona, persona→bot
  (opened with the sender device's key), bot→persona (opened with the
  recipient device's key), chat requests addressed to a persona; the
  request/response kind and id, envelope recipients, ACKs per device with
  code and liveness, slot history with reasons. No seed or private key in
  any output (asserted).
- The nine invariant scenarios above, each against a `pca`-created echo
  bot over the real `pca run` path.

### What is not verified

- No phone talked to the sandbox; the persona is still the SDK behind
  Polkadot Desktop, not the app.
- HOP attachments (v1.5); the bot-core offline suite still drives them with
  `test-client-device.mjs`.
- A chat request addressed to a bot cannot be decoded by the inspector (the
  envelope key is the sender's ephemeral one); it is labelled and its ACK
  state is not applicable (requests are never ACKed).
- Live-push behaviour on channel replacement: the node still pushes every
  stored statement; the real node's unreliability here (PLAN.md "Known
  traps") is not modelled. `no-ack-peer` relies on the push to show alice
  every version; against a real node her inbox could miss versions that a
  later takeover dropped. That is what the takeover means, and why it is a
  backstop.
