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
✓ alice registered as 0xcaa8d88d… with 1 device(s)
  device 1: 0x86cdfacc…

$ pcs user add bob --devices 2
✓ bob registered as 0x682e8d8c… with 2 device(s)
  device 1: 0x78a90152…
  device 2: 0x8cf63162…

$ pcs request alice bob
✓ alice → bob: request a0fa3836-115f-4c78-8cb2-0001d682678f

$ pcs requests bob
→ from alice pending  a0fa3836-115f-4c78-8cb2-0001d682678f

$ pcs accept bob
✓ bob accepted the request from alice on device 1

$ pcs send alice bob hi
✓ alice → bob: sent  id 9451f431-d92a-4851-be0c-35a96c7af01e

$ pcs inbox bob --device 2
→ bob ⇄ alice (device 2)  1 unread
09:14:41 ·: chat accepted
  id accepted:a0fa3836-115f-4c78-8cb2-0001d682678f
09:14:43 alice: hi [on #1,#2 acked #1,#2 unread]
  id 9451f431-d92a-4851-be0c-35a96c7af01e

$ pcs wire --peer alice
→ alice#1  chat request  seq 25434880  547B
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
✓ alice registered as 0x445fb972… with 2 device(s)
  device 1: 0x648c1981…
  device 2: 0xacd3f487…

$ pca create echobot --brain echo --public --network sandbox --port 18797
→ Creating bot "echobot"…
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
→ Status of "echobot" (local)…
✓ "echobot" is running locally.
  echobot · reaching the network

$ pcs request alice echobot --welcome hello bot
✓ alice → echobot: request 96c8ed4a-ad20-4daa-a6ce-fe1de847390c

$ pcs send alice echobot from my second device --device 2
✓ alice → echobot: sent  id a5c04ada-2b37-4d6b-a54d-5f8c21a41b68

$ pcs react alice echobot 7AD5D9AC-1618-45B1-9EE3-9199AFF01E99 👍
✓ alice reacted 👍 on 7AD5D9AC-1…

$ pcs inbox alice --device 2
→ alice ⇄ echobot (device 2)  3 unread
10:02:29 alice: hello bot [delivered from #1]
  id 96c8ed4a-ad20-4daa-a6ce-fe1de847390c
10:02:29 ·: chat accepted
  id accepted:96c8ed4a-ad20-4daa-a6ce-fe1de847390c
10:02:32 alice: from my second device [delivered from #2]
  id a5c04ada-2b37-4d6b-a54d-5f8c21a41b68
10:02:32 echobot: Echo: from my second device [on #1,#2 acked #1,#2 unread] 👍
  id 7AD5D9AC-1618-45B1-9EE3-9199AFF01E99

$ pcs wire --peer alice
→ alice#1  chat request  seq 25437749  559B
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
✓ bob registered as 0x52238aa0… with 1 device(s)
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
→ bob ⇄ devclient
10:02:39 devclient: hello bob [on #1]
  id 17FD73AA-9563-4AD2-BB86-E388762859B9
10:02:42 ·: chat accepted
  id accepted:17FD73AA-9563-4AD2-BB86-E388762859B9

$ pcs wire --peer bob
→ devclient  chat request  seq 25437759  526B
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

## S4 — Web UI (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1), 76 tests in 10 files, on the
final tree. New since S3: the markdown pipeline's known answers and the
html room route:

```
✔ markdown: a table
✔ markdown: fenced code keeps its language and escapes its content
✔ markdown: a nested list
✔ markdown: inline code with angle brackets is escaped, not markup
✔ markdown: a script tag is text
✔ markdown: a javascript: link is not a link
✔ markdown: a raw URL is linkified, opens in a new tab with noopener
✔ markdown: inline bold, italic and a markdown link
✔ markdown: a heading, and a newline is a line break
✔ markdown: an image is a link to its URL, never a fetch
✔ markdown: raw HTML in the message is escaped
✔ markdown: empty, whitespace-only and missing text render the placeholder
✔ markdown: textOf and labelOf split content into text and a neutral label
✔ the html room route renders a table and a code block through the shared pipeline
✔ the html room route escapes what is not markdown: names, labels and a script in the text
ℹ tests 76
ℹ pass 76
ℹ fail 0
ℹ duration_ms 67009.139458
```

The run has 14 `STORE_NODE_SUBMIT_REFUSED` lines, the same 13 provoked
by the store-node unit tests plus one benign `channelPriorityTooLow` as
recorded for S3.

`cd sandbox/ui && npm run check` (tsc --noEmit, vitest, vite build):

```
 Test Files  3 passed (3)
      Tests  10 passed (10)
dist/index.html                   0.67 kB
dist/assets/index-*.css          48.96 kB
dist/assets/index-*.js          364.27 kB
```

The three vitest files cover what transforms data: `message-status`
(sending/sent/delivered/failed with the sending device; receivedBy and
ackedBy per device), `quote` (a reply's one-line quote, truncation,
textless targets, a missing target) and `MarkdownCell` (a table and a
fenced block render, a script and a `javascript:` link do not, empty text
shows the placeholder).

`cd bot-core && npm test` on the final tree:

```
ℹ tests 417
ℹ pass 417
ℹ fail 0
ℹ duration_ms 73654.81325
```

bot-core is untouched by S4; the run proves the daemon it starts for its
transport e2e (now with the static and `/api` handling) still serves it.

### The acceptance session

`cd sandbox/ui && npm run build && npm run acceptance`
(`sandbox/ui/e2e/acceptance.mjs`): a daemon on a random port serving
`sandbox/ui/dist`, `pcs user add alice --devices 2`, `pca create echobot
--brain echo --public --network sandbox` and `pca run echobot` through the
scenario runner's bot helper, then headless Chromium (Playwright 1.62.1,
the cached build 1234) driving the built app:

1. Personas: alice with her two devices online (`docs/images/s4-personas.png`).
2. Requests: the search box finds `echobot` in the directory with a `bot`
   label; "Send request" with the welcome "hello bot"; the outgoing row
   goes to `accepted`; the bot's persisted roster holds both devices
   (`docs/images/s4-requests.png`).
3. Chats: the Room view for echobot; the composer receives, with
   Shift+Enter for the line breaks and Enter to send:

   ```
   Here is a table and some code:

   | feature | status |
   |---|---|
   | tables | rendered |
   | code | rendered |

   ```js
   const echo = (s) => `Echo: ${s}`;
   ```
   ```

   The echo comes back and renders as a table (`.md table td` "rendered")
   and a code block (`.md pre code.language-js`); its status line reads
   `on #1,#2 · acked #1,#2`; alice's own row renders the same table and
   reads `delivered from #1` (`docs/images/s4-room-markdown.png`).
4. Still in the room: Reply on the echo, "thanks", Enter — the outgoing
   row carries the one-line quote of the echo and goes to `delivered from
   #1`; 👍 on the echo — the reaction pill shows on it
   (`BOT_RECEIVED_REACTION` in the bot's log); Edit on alice's own message,
   the text replaced by `Edited:` and a two-column table, Enter — the row
   shows `edited` and the new table. The bot answered the reply and the
   edit too (`Echo: thanks`, `Echo: Edited: …`, both `on #1,#2 · acked
   #1,#2`).
5. Wire: peer filter `alice`, the `session echobot#1→alice /request`
   statement opened in the detail panel with its decoded message and the
   ACKs from both devices (`docs/images/s4-wire.png`). Then the controls:
   a `drop` fault from `echobot` with count 2 — the fault row shows `hits
   0/2` and the event log shows the `fault` event; `+10 s` — the node line
   reads `clock +10000 ms`; `Reset clock` — `clock +0 ms`; `Clear all` —
   "No faults." and `GET /faults` is empty.
6. The same room in a second browser page with `colorScheme: "dark"`
   (Berlin Night through `prefers-color-scheme`; no switcher):
   `docs/images/s4-room-dark.png`.
7. `GET /personas/alice/rooms/echobot?format=html`, as an agent would
   read it (styles and the earlier rows elided; the file is exactly what
   `test/room-html.test.mjs` asserts the shape of). Alice's row is the
   edited one; the echo carries her reaction:

```html
<article data-id="74f07553-6664-48ec-ade1-7b99117ebce7" data-direction="outgoing" data-status="delivered" data-type="text">
<header><span class="who">alice</span><time datetime="2026-09-05T11:32:15.023Z">11:32:15</time><span>(edited)</span></header>
<div class="md"><p>Edited:</p>
<table>
<thead>
<tr>
<th>a</th>
<th>b</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
</tr>
</tbody>
</table>
</div>
<footer>delivered from #1</footer>
</article>
<article data-id="60DEC09C-90DA-4A0A-AE62-D551BBB56130" data-direction="incoming" data-status="received" data-type="text">
<header><span class="who">echobot</span><time datetime="2026-09-05T11:32:15.039Z">11:32:15</time></header>
<div class="md"><p>Echo: Here is a table and some code:</p>
<table>
<thead>
<tr>
<th>feature</th>
<th>status</th>
</tr>
</thead>
<tbody>
<tr>
<td>tables</td>
<td>rendered</td>
</tr>
<tr>
<td>code</td>
<td>rendered</td>
</tr>
</tbody>
</table>
<pre><code class="language-js">const echo = (s) =&gt; `Echo: ${s}`;
</code></pre>
</div>
<footer>on #1,#2 acked #1,#2 <span class="reactions">👍</span></footer>
</article>
```

The script asserts on that response too (an incoming article with a
`<table>` holding `rendered` and a `<pre><code class="language-js">`),
then stops the bot, the daemon and the browser. `pgrep` is clean after
the run. Separately, `npm run dev` was started against a daemon on
another port and `curl` through it returned `/api/personas`, created a
persona with `POST /api/personas`, and streamed the `persona` event from
`/api/events`.

### A regression the sandbox caught in its own tree

The first version of the html route imported `room-html.mjs` (and so
jsdom) at the top of `lib/api.mjs`. `cli.mjs` imports `daemon.mjs`, which
imports the API module, so every `pcs` subprocess loaded jsdom: 442 ms per
`pcs` start instead of 241 ms. With that in place
`scenarios/device-removed.mjs` passed 1 of 5 runs (the base commit
03f6b0d, same node_modules, 5/5; the whole suite showed it as the one
failure). Its "and was ACKed" check reads the fan-out slot's ACKs right
after `BOT_PEER_DEVICE_REMOVED`, and the bot ACKs after it logs that
event. The lazy import (commit `81ca880`) restored 241 ms and 5/5, and the
full suite went 76/76. Why *slower* `pcs` loses that race is not
explained, only measured; questions.md S4.4 asks whether the scenario
should wait for the ACK instead.

### Deviations from PLAN.md and the task, and why

- **No component library, no Tailwind.** The design skill's setup is
  Tailwind v4 + shadcn; the task said no component library. The UI applies
  the skill's rules in plain CSS over the copied token bundle
  (questions.md S4.2). Theme: Berlin Day / Berlin Night by OS preference,
  because nobody was there to choose (S4.1).
- **The polkadot-chat-web screens were not copied.** Their structure
  (Chats → Room, Requests, Search) and behaviours (Enter sends, quick
  reactions, edit own text, mark read on view, reply quoting) were reused;
  their code reads Dexie tables and a chat manager, which the sandbox UI
  does not have — it reads the control API and an SSE stream. Search is a
  box on the Requests screen, as the task describes; there is no Settings
  or Pair screen (the Personas screen shows what Settings showed).
- **Markdown images render as links**, never `<img>` (questions.md S4.3).
- **The html route lives in `lib/room-html.mjs`**, with the page template
  and jsdom; `lib/markdown.mjs` stays free of Node-only imports so Vite can
  bundle it for the browser. The pipeline is shared as the task asked.
- **`/api` is accepted in addition to the bare paths**, not instead
  (questions.md S4.6).
- **Playwright is a devDependency of `sandbox/ui` only** and runs from
  `npm run acceptance`, not from CI: CI builds the UI and runs its vitest
  and tsc; the browser run needs a `pca` bot and a browser binary and is
  the documented acceptance, run by hand.

### What is verified

- Every construct the task named renders through one pipeline with the
  exact HTML pinned; the route and the view share it; own messages render
  the same way; empty and unknown content show a neutral placeholder or
  label; a script tag, a `javascript:` link and raw HTML with a handler
  never become markup; links open in a new tab with `noopener`.
- The screens over the API with live updates from the SSE stream, driven
  by the script above: a request opened from the directory search and
  accepted by a bot; the room with per-device status lines, reply with its
  quote, a reaction, an edit of an own message; the wire filtered by peer
  with a statement's decoded detail and ACKs; a fault set and cleared, the
  clock moved and reset, the event log filling; the dark theme.
- No seed or private key is fetched or shown: the UI only calls routes
  that already returned public halves (`persona.toJSON`,
  `device.toJSON`); `GET /wire` is unchanged.

### What is not verified

- `Restart node` and `Reset store` were not clicked in the acceptance
  run (they call `POST /node/restart` and `/node/reset`, which S3's tests
  and `pcs node` cover); neither were `delay` and `hold-dump` faults from
  the form, the signer and channel filters on the wire, the slot-history
  panel's content, adding a device or a persona from the form, or
  Decline. Those paths were only type-checked and built.
- Removing a reaction (clicking the pill) and Escape to cancel a reply
  were not exercised.
- The UI was only run in Chromium (headless). No other browser.
- No phone talked to the sandbox; the persona is still the SDK behind
  Polkadot Desktop.

## S5 — HOP attachments (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1), 89 tests in 13 files, on the final
tree. New since S4: the HOP node's rules and fault hooks, the persona's HOP
client round trip, attachments between two personas over the daemon, the
`pcs` attachment and pool commands, the rows' edit history, and four
scenarios:

```
✔ hop_submit: a signed entry from an allowed account is stored; the allowance, the proof and the caps are checked
✔ hop_claim and hop_ack: recipient-signed, read-only until every recipient acked, then the entry is gone
✔ bot-core's by-name params run the same checks as the spec's positional ones
✔ faults: refuse, drop, corrupt, delay and cut hit a claim once each and are events
✔ a frame over the cap closes the socket; putFile stores a fixture without a signer
✔ upload then download: three chunks and the metadata, byte-exact, every entry claimed once and acked
✔ download refuses what it cannot trust: a wrong ticket, a corrupt chunk, a size over the cap
✔ ticket derivation matches the spec: keyed blake2b for the AEAD key and the signer seed
✔ alice sends a photo to bob (2 devices): one claim, one placeholder, bytes served, the pool and the wire show metadata only
✔ scenario attachment-from-bot.mjs
✔ scenario attachment-to-bot.mjs
✔ scenario hop-faults.mjs
✔ scenario poison-attachment-batch.mjs
ℹ tests 89
ℹ pass 89
ℹ fail 0
ℹ duration_ms 83212.07175
```

The run has the same 14 `STORE_NODE_SUBMIT_REFUSED` lines as S3/S4 and 22
`HOP_NODE_REFUSED` lines: every one provoked on purpose (the node's unit
tests, the client's refusal tests, the fault scenarios).

`cd sandbox/ui && npm run check` (tsc --noEmit, vitest, vite build):

```
 Test Files  4 passed (4)
      Tests  17 passed (17)
dist/index.html                   0.67 kB
dist/assets/index-*.css          49.32 kB
dist/assets/index-*.js          369.76 kB
```

The new vitest file is `attachment-view.test.ts`: an image the viewing
device holds renders inline from the daemon's own media route and nothing
else (by MIME, even when the sender declared a general file), a non-image
file is a download link, a sibling device's claim is the placeholder even
though the persona's disk has the bytes, a claim in flight and a failure
are text that never names the message's URL.

`cd bot-core && npm test` on the final tree (bot-core last changed in the
D commits; the transport e2e is the ported one):

```
ℹ tests 418
ℹ pass 413
ℹ fail 0
ℹ skipped 5
ℹ duration_ms 19207.753458
```

The five skips are `test/workspaces.test.mjs`'s uid-gated cases on this
machine (present before S5). The run took 19 s instead of S4's 74 s: the
ported e2e waits for rows and events instead of the device client's fixed
8 s windows. Each sandbox commit was made on a tree whose sandbox suite and
UI check were green; each bot-core commit on a tree whose bot-core suite
was green.

### The acceptance session: alice ↔ echobot with attachments (pcs)

`pcs up` on port 7799, a bot created and run through `pca` (the sandbox
HOP node becomes its upload node; its upload signer is registered for the
Bulletin allowance), alice with two devices. Human (TTY) output; the 1×1
PNG fixture from the tests and a 24-byte text file; ids abbreviated where
the CLI abbreviates them.

```
$ pca create echobot --brain echo --public --network sandbox --port 8811
→ Creating bot "echobot"…
✓ Generated your bot's identity
→ Registering your bot in the sandbox…
✓ Registered as echobot
✓ Confirmed — your bot is live and people can message it!
  Start it:  pca run echobot

$ pca run echobot          # (in another terminal)

$ pcs user add alice --devices 2
✓ alice registered as 0x74510201… with 2 device(s)
  device 1: 0x78a42037…
  device 2: 0xde73b38f…

$ pcs request alice echobot --welcome hello
✓ alice → echobot: request cc1011eb-1f50-415a-be0d-9e5d10e72613

$ pcs send alice echobot --attach photo.png --caption "look at this"
✓ alice → echobot: sent  id c7498483-48ac-4f7f-b351-5863df0dd34e
  image image/png 1 KB 1×1  1 chunk(s) on ws://127.0.0.1:61625  id 0x3cd6ea7c…

$ pcs inbox alice --peer echobot
→ alice ⇄ echobot  2 unread
17:00:49 alice: hello [delivered from #1]
17:00:49 ·: chat accepted
17:00:49 echobot: Echo: hello [on #1 acked #1 unread]
17:00:52 alice: look at this [delivered from #1]
  📎 image image/png 1 KB 1×1 [sent, media 3cd6ea7c694e5f0b7992fb4dde6344f9a4a299f395fb34b9868ab87baf1c2cbf]
17:00:52 echobot: Echo: look at this [on #1,#2 acked #1,#2 unread]

$ pcs send alice echobot --attach notes.txt --caption "/file put notes.txt"
✓ alice → echobot: sent  id 80d7981f-ab82-4c20-991d-f2ee98397604
  general text/plain 1 KB  1 chunk(s) on ws://127.0.0.1:61625  id 0x414a861d…

$ pcs send alice echobot "/file get notes.txt" --device 2
✓ alice → echobot: sent  id b3592f66-4bef-4e6d-8f71-65ebf04dba68

$ pcs inbox alice --peer echobot --device 1
…
17:00:56 echobot: Saved notes.txt (24 B). [on #1,#2 acked #1,#2 unread]
17:00:59 alice: /file get notes.txt [delivered from #2]
17:00:59 echobot: notes.txt [on #1,#2 acked #1,#2 unread]
  📎 general text/plain 1 KB [claimed on #1, media b9127593030a966373f382300d3b06cbb18836274c4ceefbacb5ae00b8d99228]

$ pcs inbox alice --peer echobot --device 2
…
17:00:59 echobot: notes.txt [on #1,#2 acked #1,#2 unread]
  📎 general text/plain 1 KB [claimed by device 1]

$ pcs hop
→ HOP node ws://127.0.0.1:61625: 0 entries holding 0B of 67108864B
  0x03a3a6c0…  chunk 1/1 of alice ⇄ echobot  98B  by alice  claimed ×1  acked  gone (acked)
  0x3cd6ea7c…  metadata of alice ⇄ echobot  70B  by alice  claimed ×1  acked  gone (acked)
  0xbc600273…  chunk 1/1 of alice ⇄ echobot  52B  by alice  claimed ×1  acked  gone (acked)
  0x414a861d…  metadata of alice ⇄ echobot  70B  by alice  claimed ×1  acked  gone (acked)
  0x60aa4f45…  chunk 1/1 of alice ⇄ echobot  52B  by echobot  claimed ×1  acked  gone (acked)
  0xb9127593…  metadata of alice ⇄ echobot  70B  by echobot  claimed ×1  acked  gone (acked)

$ pcs wire --peer alice --decode --channel "session echobot#1→alice /request"
→ echobot  session echobot#1→alice /request  seq 25462860  629B  replaced ×3
  topic session echobot#1→alice
  request A5CDA6A0-B…  1 message(s)  for alice#1,alice#2  acked by alice#1 (success), alice#2 (success)
    richText "notes.txt" +1 attachment(s)  id 08771A45-E…

$ grep -E 'MEDIA|HOP_|FILE' bot.log      # the bot's side
{"event":"BOT_HOP_UPLOAD_CONFIGURED","account":"0x30445b70…","host":"127.0.0.1","maxBytes":52428800}
{"event":"HOP_DOWNLOADED","host":"127.0.0.1","id":"0x3cd6ea7c694e5f0b","bytes":70,"chunks":1}
{"event":"BOT_MEDIA_DOWNLOADED","id":"3cd6ea7c694e5f0b","mime":"image/png","bytes":70}
{"event":"HOP_DOWNLOADED","host":"127.0.0.1","id":"0x414a861d7f05ca67","bytes":24,"chunks":1}
{"event":"BOT_MEDIA_DOWNLOADED","id":"414a861d7f05ca67","mime":"text/plain","bytes":24}
{"event":"BOT_FILE_SAVED","peer":"74510201…","path":"notes.txt","bytes":24,"replaced":false}
{"event":"HOP_UPLOADED","host":"127.0.0.1","id":"0xb9127593030a9663","bytes":24,"chunks":1}
{"event":"BOT_SENT_FILE","to":"74510201…","mime":"text/plain","bytes":24}
{"event":"BOT_FILE_DELIVERED","peer":"74510201…","path":"notes.txt","bytes":24}
```

Read it against the protocol: every upload is one chunk plus a metadata
entry, signed by the sender's Bulletin account (alice's minted key, the
bot's `//allowance//bulletin//chat`); every entry was claimed exactly once
and acked, after which the pool dropped its bytes ("gone (acked)") — the
bot downloaded each of alice's files once, and only one of alice's devices
claimed the bot's file; the other shows the placeholder. The bot's log
never contains a ticket; neither does any `pcs` output. No process was
left behind after the session.

### The browser session (headless Chromium)

`cd sandbox/ui && npm run build && npm run acceptance` — the S4 script,
extended: after the markdown, reply, reaction and edit steps, `pcs send
alice echobot --attach gradient.png --caption "a photo for you"` (a 240×120
PNG the script builds) while the Room view is open:

1. alice's outgoing row renders the image inline from
   `./api/personas/alice/media/<id>`; the echo of the caption arrives with
   `on #1,#2 · acked #1,#2`; `BOT_MEDIA_DOWNLOADED` in the bot's log.
2. `/file put gradient.png` (with the same photo attached) → `Saved
   gradient.png (73 KB).`; `/file get gradient.png` typed in the composer →
   the bot's rich text `gradient.png` arrives on both devices and renders
   the image inline on device 1, the device that claimed
   (`docs/images/s5-room-attachment.png`).
3. The device selector switched to device 2: the same row shows
   `general · image/png · 73 KB — claimed by device 1` in a dashed
   placeholder, no image (`docs/images/s5-room-placeholder.png`).
4. Wire: the HOP pool panel lists the six entries (alice's two uploads,
   the bot's one; chunk/metadata, owner `alice ⇄ echobot`, signer, claimed
   ×1, acked, gone); a `corrupt` fault is added from the form and shows as
   `#1 corrupt on claim hits 0/1`, the `hop` fault event is in the log
   (`docs/images/s5-wire-hop.png`); then cleared.

The S4 steps and screenshots were re-run unchanged. No process was left
behind after the run.

### bot-core defects found and fixed

| finding | commit |
|---|---|
| A follow-up that arrived while the previous turn settled was answered twice. The session receive path journals the message (`oweReply`), then awaits the critical persist; a turn settling on that peer meanwhile runs `pumpOwed()`, which enqueues the fresh entry and runs the brain; the receive path enqueues it again. Two answers with different ids — a phone shows the bot answering twice. The device client's 8 s windows never got there; the persona sends its follow-up as the opener's turn ends and hit it on every run. Ids journaled but not yet enqueued are now in `owedInAdmission`, which the pump skips; the ported restart test pins one answer per message. | `409b2fb` fix(transport) |
| A claim the node answered `RateLimited` (1020) or `PoolFull` (1002) — "retry later" in the spec's error table — failed at once; only transport losses were retried. Those two codes now take the same single reconnect-and-resume retry; NotFound and the other refusals stay final, integrity failures never retry. Found by `scenarios/hop-faults.mjs`; pinned by a hop-client unit test. | `61eef61` fix(hop) |
| A bot stopped after its answer reached the peer but before the store answered its submit answered the question again after the restart, under a new id. The store pushes to subscribers before it replies to the submitter; `settleOwed` runs after the submit returns; the journal held the question only, so the restart ran the brain again. CI hit it on the ported restart tests (`2 !== 1`: two "Echo: before-restart" rows); a real crash there does the same to a phone, and with an LLM the second answer differs. The owed entry now journals the answer (id, exact bytes, superseded ids), durably, before the lane submits it; a restart re-sends a journaled answer under the same ids and runs the brain only for entries without one. Reproduced deterministically by `scenarios/restart-with-sent-reply.mjs` with the new `delaySubmitReply` node fault (two rows before the fix, one after). | fix(transport): journal the answer |

Also changed in bot-core, not defects: the sandbox profile's
`insecureEndpoints` now covers the HOP node (`hopAllowInsecure`), `pca
create --network sandbox` saves the daemon's HOP node and registers the
bot's upload signer (`e4b0d16`); the T3ams media test uploads a fresh copy
for its wrong-hash check because an acked single-recipient entry is gone
on a spec-faithful node; the hop-client tests use the node's fault hooks;
the sandbox callers use `/api` (`2a924e8`).

Observed, not fixed (questions.md S5): `/file get` returns every vault
file as `FileMeta::general`, a photo included — a phone renders a document
card, not an image; the sandbox viewers render inline by MIME for what
they hold. The stamped upload node carries a trailing slash
(`new URL(...).toString()`). The opener path has the same journal-then-
await window as the fixed session path; its `owedReplies.has &&
!queuedOwed.has` guard prevents a second brain run, but a bridge admission
reservation can be counted twice there (not reproduced).

### test-client-device.mjs

Retired: deleted from the tree, `package.json` `files`, the CI syntax
check, `CLAUDE.md`, `docs/guide/testing.md`, `protocol.md` and
`PLAN.md`. Every bot-core offline test that spawned it now drives a
sandbox persona through the daemon's API (`startPersona` in
`test/transport.e2e.test.mjs`). No assertion was weakened; these got
stronger:

- restart survival pins the persisted roster's device account as the
  persona's *device* account (the device client's device account equaled
  its identity account) and one answer per message across the restart;
- the attachment test reads `BOT_RECEIVED_TEXT.attachments` and the
  media file by the persona's identifier, and asserts the bot's log holds
  no ticket;
- the bridge test asserts the reply row's quote target, the persona's row
  for the bot's edit (`editedAt`, new text), the bot's outbound reaction
  on the persona's row, and the attachment's `width`/`height`/`kind`;
- the bridge `/files` test asserts the persona claimed the returned file
  (`claimedBy`, bytes byte-exact) and that every pool entry was claimed
  once and acked;
- the live-reply tests read every frame the placeholder showed from the
  row's `editHistory` (the device client printed each `[BOT EDIT]` line;
  the persona keeps them), and the never-ACK peer is a node fault on the
  persona's two response channels instead of `--no-ack`.

No case could not be ported. The live-network use (`--seed-hex` against a
real node) stays with `test-client.mjs`, the identity-channel client.

### Invariants that did not hold

- **Every inbound message is answered once** did not hold in bot-core
  when a follow-up landed as the previous turn settled (the first row of
  the defect table). Fixed. It also did not hold across a restart when the
  process died between the store's push of its answer and the store's
  reply to the submit (third row; found by CI after the S5 review, held
  open by the `delaySubmitReply` fault in the new scenario). Fixed.
- **A download failure is a note, never a dropped message** held for
  every fault; the retry policy was narrower than the spec's error table
  (second row). Fixed.
- Every other CLAUDE.md invariant the scenarios target held: the poison
  attachment never blocked its batch, every request was ACKed, the bot's
  file went through the outbound lane, the claim ticket never left the
  encrypted message on either side.

### Deviations from PLAN.md and the task, and why

- **A persona signs uploads with one minted Bulletin key**, not a
  per-device statement key (questions.md S5.1). The task asked for "the
  persona's own allowance account"; the spec's `SP(A)` wording may mean
  per device.
- **The sandbox node's acks remove entries** (the spec's non-custodial
  pool), so a second download of the same entry is `NotFound`. bot-core's
  T3ams test assumed a re-claim after an ack; it now uploads again.
- **ChaCha20-Poly1305, not the spec's AES-GCM** (questions.md S5.2): every
  deployed client uses ChaCha20.
- **The persona's HOP dialect is the spec's signed, positional one**, not
  the desktop SDK checkout's unsigned `[data, recipients, "0x"]`
  (questions.md S5.4). The node also accepts bot-core's by-name form.
- **`poison-attachment-batch` drops the bot's first ACK** so the SDK
  extends the un-ACKed batch and both messages ride one statement, as
  the device client's single submit did; the SDK has no other way to put
  two messages in one statement.
- **Viewers render an attachment inline by MIME**, not by the sender's
  FileMeta kind, because bot-core returns vault files as `general`.
- **`hop-faults` uses a mock brain that echoes its prompt** so the note
  bot-core rendered for the brain is readable in alice's inbox; an echo
  brain would echo only the caption.
- **The HOP pool cap is 64 MiB**, a sandbox choice: room for one largest
  durable file (`BOT_FILE_MAX_BYTES`, 50 MB); the spec's example pool
  status is not a documented limit.
- **A `refuse` fault answers `RateLimited`**, the one refusal a client
  should retry; the other refusals are reached through `drop`
  (`NotFound`) and a wrong ticket (`NotRecipient`).

### What is verified

- The HOP node against the spec's rules with known answers, and against
  two independent clients (bot-core's `hop-client.mjs`, the persona's
  `lib/hop.mjs`), which also interoperate through it in both directions.
- Attachments persona↔persona and persona↔bot (both directions), one
  claim per persona, the placeholder on the other device, bytes served
  from each holder's own media dir (0600), the pool listing and the wire
  decoding without a ticket, the five fault hooks and bot-core's response
  to each, the size cap on send.
- The UI: images inline from the local media route only, download links,
  placeholders, the HOP panel and its faults; driven by the script above.

### What is not verified

- No phone talked to the sandbox; the persona is the SDK behind Polkadot
  Desktop with a spec-dialect HOP client, not the app.
- RFC-0001's inline root entries and on-chain fallback are not modelled;
  a lost chunk after the metadata ack is unrecoverable here, as it is in
  bot-core.
- Video FileMeta is encoded (`duration: 0`) but no video was sent.
- The Wire screen's HOP fault form was exercised for `corrupt` only; the
  other kinds were driven through `pcs` and the API.
- The delayed-claim fault was exercised in the node's unit test, not
  against bot-core (its per-download deadline is 120 s).
- S4 question 4's open note — why slower `pcs` start-up lost the
  device-removed race — was not investigated beyond replacing the sharp
  check with the bounded wait; the measured latency is in the scenario's
  log line.

## S6 — `paseo` profile: the sandbox on Paseo Next (2026-09-05)

### What was verified (offline, CI)

`cd sandbox && npm test` (Node v24.13.1) on the final tree: 103 tests in 17
files, every scenario on the mock. New since S5:

```
✔ mock is the default; paseo mirrors bot-core's PASEO profile; a typo is refused
✔ consumer, identityOf and usernameOwner read Resources through papi and remember what they saw
✔ search asks the identity backend and checks every hit against the chain
✔ remember keeps the public half of a persona or an attached bot for the labels
✔ the default username is the name when the backend takes it, else a padded one, else nothing
✔ a minted record holds the keys a single-device identity needs, and keysOf derives them as bot-core would
✔ claim, wait, pending, resume, attested — one claim in total; a reset claims a new username
✔ the Bulletin allowance is provisioned through bot-core's testnet helper; failure is recorded, not thrown
✔ markChainReset leaves records registered on this genesis alone and marks attached bots too
✔ on paseo: faults, clock, node restart/reset, the pool and local registration answer 409 naming the network
✔ on paseo: the node info carries the network and genesis; the wire is what the personas saw; bots attach with their chain state
✔ on the mock, the same routes stay open (the refusal is the network's, not the route's)
ℹ tests 103
ℹ pass 103
ℹ fail 0
```

`cd sandbox/ui && npm run check`: tsc, 17 vitest tests, vite build.
`cd bot-core && npm test`: 420 tests, 415 pass, 5 skipped (the uid-gated
`workspaces.test.mjs` cases), including the new `deriveIdentityKeys` and
`reregisterIdentity` tests and the `register --again` flow against the
mock sandbox directory.

### The chain, first

Paseo People Next was reset since S5's descriptors were generated:
genesis `0xc5af1826…` → `0x4a2b5b73…` (`next-people-paseo` 3002000,
finalized block 167495 during this session). Bulletin Paseo Next kept its
genesis (`0x8cfe6717…`) but its runtime moved, so `pca storage <bot>
status` failed with `Incompatible runtime entry
Storage(TransactionStorage.Authorizations)` until the descriptors were
regenerated (`papi update paseoPeopleNext bulletinPaseoNextV2`, `npm run
prepare`, commit `47528ab`). After it:

```
$ pca storage codebot status
→ Checking Bulletin Paseo Next v2 file allowance…
  allowance: 5FxibxxzpFj7qwQDoQ3BntaWPhyvhW6EiDcKnCTo1HWUfyYq
  storage:   not authorized
```

On the reset chain: 2814 `Resources.Consumers`, 2816 `PeopleLite.LitePeople`
(2814 attested by `5GCF223UbXNZ…`, 2 by fee). None of this machine's paseo
bots is among them (`codebot.03`, `hermesbot.54`, `openclawbot.49`), nor
`macbot.78`, nor the owner's phone (`shawntabrizi.01` ASSIGNED on the
backend, `shawntabrizi.02` RESERVED since 2026-09-04T18:31, both absent
on chain).

### (a) `pca register macbot --again`

Blocked twice, precisely:

1. **macbot is not on this machine.** `~/.pca/bots/` holds
   `macbot-workspace/` (empty) and no `macbot/` with a seed; the VPS runbook
   does not list it either. The backend has `macbot.78` ASSIGNED to
   `5DXPWoMyS7HS7cfv98jGT4mUUXgNMgo7XvxZSvBMTfvHhxxQ` at old-chain block
   659047; the chain has no `Consumers` entry for it.
2. So the command was exercised on `openclawbot` (local, `openclawbot.49`,
   the same situation: ASSIGNED on the backend at block 658192, absent on
   chain). What the backend does on a second claim:

```
$ pca register openclawbot --again --wait 240
→ Checking the chain for openclawbot.49…
⚠ The identity backend refused a second claim of openclawbot.49: 409 Conflict: {"error":"Preferred digits 49 already taken for username openclawbot"}
  The backend still lists the username as assigned on the old chain, and the chain has no record of this bot.
  Let the backend assign a new number:  pca register openclawbot --again --new-number   (or pick one: --digits <NN>)
  The bot's account and keys stay the same; only the number after the dot changes. Tell its contacts.

$ pca register openclawbot --again --new-number --wait 240
→ Checking the chain for openclawbot.49…
⚠ The backend assigned openclawbot.19; openclawbot.49 is no longer this bot's name. Tell its contacts.
→ Waiting for the network to confirm (up to 240s)…
.............................................
⚠ Not confirmed yet — this can take a few minutes. Check or retry:  pca register openclawbot
→ Provisioning Bulletin Paseo Next v2 file allowance…
⚠ The public Paseo Next v2 faucet may have accepted this allowance grant. Do not retry it yet.
  Wait for finalization, then check:  pca storage openclawbot status
  After verifying the result, clear the local guard:  pca storage openclawbot recover

$ pca storage openclawbot status
  storage:   active through block 1952095 (201458 blocks remaining); 1000 transactions and 95.3 MiB remain
$ pca storage openclawbot recover
✓ Verified allowance is sufficient; cleared the local recovery guard.
```

The backend keeps `openclawbot.49` ASSIGNED (old chain) beside
`openclawbot.19` RESERVED (`GET /api/v1/usernames?prefix=openclawbot`),
and `openclawbot.19` **stayed RESERVED for the rest of the session** (polled
every two minutes; `Resources.Consumers` for the account stayed empty). The
reason is on the chain: the attester the backend advertises
(`GET /api/v1/attester` → `0x86aac84d…` = `5F7H1LkZi8rnSH8PvUsp4LD2WkvcpnjkyQyvLPu1ntbhNr5T`)
has `PeopleLite.AttestationAllowance` 0 and balance 0 on the reset chain;
the only attester with an allowance is `5GCF223U…` (997186 left), which
attested the 2814 migrated accounts. Every claim a client signs covers the
advertised attester, so nothing the client does can change the outcome.
This is the identity backend's to fix (questions.md S6.1). So: `--again`
succeeds or reports exactly why not — here it reported the backend's 409
verbatim, then claimed a new number that the backend does not attest.

### (b) `pcs up --network paseo`, `pcs user add alice`

Human output is JSON here because the commands ran without a TTY.

```
$ pcs up --network paseo --dir <scratch>/paseo-state --port 7799
{"event":"SANDBOX_UP","url":"http://127.0.0.1:7799","network":"paseo","genesis":"0x4a2b5b737de1da59e209b0000a876ec2fa20035dc34fd292a848da32d255ad48","storeUrl":"wss://paseo-people-next-system-rpc.polkadot.io","hopUrl":"wss://paseo-hop-next-0.polkadot.io",…,"personas":[]}

$ pcs user add alice --wait 150
{ "name": "alice", "account": "0x1a8137d1…", "username": "sandboxalice.41",
  "registration": { "username": "sandboxalice.41", "status": "claimed", "genesis": "0x4a2b5b73…",
                    "claimedAt": "2026-09-05T19:14:18.841Z", "attestedAt": null, "bulletin": "failed" },
  "devices": [ { "index": 1, "account": "0x1a8137d1…", … } ] }
daemon log:
  SANDBOX_PERSONA_UP {"name":"alice","account":"0x1a8137d1…","devices":1,"username":"sandboxalice"}
  SANDBOX_PERSONA_CLAIMED {"name":"alice","username":"sandboxalice.41","again":false}
  SANDBOX_PERSONA_BULLETIN_FAILED {"address":"5HK4TU5r9m1B…","error":"The Bulletin Paseo Next v2 Faucet submission may have reached the chain, but finalization could not be confirmed…"}
  SANDBOX_PERSONA_PENDING {"name":"alice","username":"sandboxalice.41"}
```

`alice` is too short for a username, so the claim was `sandboxalice` and
the backend assigned `.41`; the device account equals the identity account
(single-device); the mnemonic went to
`paseo-state/personas/alice/identity.json` (0600). Attestation did not land
(the backend does not attest, see (a)); the faucet's answer came after the
helper's 30 s deadline. The daemon was then stopped and started again:

```
$ pcs up --network paseo --dir <scratch>/paseo-state --port 7799
{"event":"SANDBOX_UP",…,"personas":["alice"]}
$ pcs user list
alice  sandboxalice.41  claimed  (Bulletin allowance: failed)
$ pcs user add alice --wait 30                    # resume: no second claim
{ "username": "sandboxalice.41", "status": "claimed", …, "bulletin": "authorized" }
  SANDBOX_PERSONA_RESUME {"name":"alice","status":"claimed","bulletin":"failed"}
  SANDBOX_PERSONA_BULLETIN {"address":"5HK4TU5r9m1B…","action":"already-authorized"}
  SANDBOX_PERSONA_PENDING {"name":"alice","username":"sandboxalice.41"}
```

The persona survived the restart with its state; the resume made no new
claim (the backend still lists one `sandboxalice.41`), re-read the
Bulletin chain and found the faucet grant had landed. The fix for the
first run's `failed` — re-reading the chain for 90 s after an unconfirmed
submit — landed after this run (commit `4974744`).

The rest of the profile, live:

```
$ pcs bot attach openclawbot
{ "name": "openclawbot", "username": "openclawbot.19", "onChain": false, "needsReregistration": true, "networkProfile": "paseo", … }
$ pcs user find shawntabrizi
[ { "username": "shawntabrizi.01", "account": "0xdaf98cb2…", "status": "ASSIGNED", "onChain": false },
  { "username": "shawntabrizi.02", "account": "0x486a22fe…", "status": "RESERVED", "onChain": false } ]
$ pcs user find macbot
[ { "username": "macbot.78", "account": "0x40961ce0…", "status": "ASSIGNED", "onChain": false } ]
$ pcs fault drop --from alice
✗ a fault is available on the mock network only; this sandbox runs on Paseo Next v2 (paseo)
$ pcs clock +2h
✗ the clock is available on the mock network only; this sandbox runs on Paseo Next v2 (paseo)
$ pcs node restart
✗ a node restart is available on the mock network only; this sandbox runs on Paseo Next v2 (paseo)
$ pcs hop
✗ the HOP pool view is available on the mock network only; this sandbox runs on Paseo Next v2 (paseo)
$ pcs user add bob --devices 2
✗ a persona on Paseo Next v2 is single-device (the identity account is its device; only the phone can mint a second one)
```

The UI served by that daemon (`docs/images/s6-paseo-personas.png`,
`s6-paseo-wire.png`): the rail badge reads `paseo`; Personas shows
`sandboxalice.41 · attestation pending · Bulletin allowance authorized` and
no "Add device"; Wire shows "Faults, the clock and node restarts exist on
the mock network only; the wire shows what the personas' subscriptions
saw." and no fault form (checked by the screenshot script: 0 "Add fault"
controls).

### (c) alice ↔ macbot text and attachments

Not reached. macbot is unavailable (a); the fresh bot:

```
$ pca create sandboxecho --brain echo --network paseo --allow 0x1a8137d1… --wait 150 --port 8833
→ Creating bot "sandboxecho"…
✓ Generated your bot's identity
→ Registering your bot on the network…
✓ Registered as sandboxecho.91
→ Waiting for the network to confirm (up to 150s)…
.............................
⚠ Not confirmed yet — this can take a few minutes. Check or retry:  pca register sandboxecho
→ Provisioning Bulletin Paseo Next v2 file allowance…
⚠ The public Paseo Next v2 faucet may have accepted this allowance grant. Do not retry it yet.
  …
  or search: sandboxecho.91
$ pca storage sandboxecho status      # later: the grant landed; recover cleared the guard
$ pcs bot attach sandboxecho
{ "name": "sandboxecho", "username": "sandboxecho.91", "onChain": false, "needsReregistration": true, … }
$ pcs request alice sandboxecho --welcome "hello from the sandbox"
✗ sandboxecho is not messageable (no identifier key on this chain)
```

Both sides are claimed and both stay RESERVED on the backend; without an
attestation neither has a statement allowance nor an identifier key, so
no message can be sent. The path is complete up to the point the backend
must act. To finish once it does: `pcs user add alice` (resumes, reports
`attested`), `pca register sandboxecho` (resumes), then
`pcs request alice sandboxecho --welcome hi`, `pca run sandboxecho`,
`pcs send alice sandboxecho --attach photo.png --caption look`,
`pcs send alice sandboxecho --attach notes.txt --caption "/file put notes.txt"`,
`pcs send alice sandboxecho "/file get notes.txt"`, `pcs inbox alice`,
`pcs wire --decode`; or the same as one script,
`pcs scenario run scenarios/echo-roundtrip.mjs --network paseo` and
`pcs scenario run scenarios/attachment-to-bot.mjs --network paseo`.

### (d) The phone check — the owner's

Precondition: the identity backend attests again (S6.1), and
`shawntabrizi.02` (RESERVED since 2026-09-04) is attested — `pcs user find
shawntabrizi` shows `onChain: true` for it.

1. `pcs up --network paseo` (the default state dir keeps alice), then
   `pcs user add alice` until it reports `attested`.
2. `pcs request alice shawntabrizi.02 --welcome "hello from the sandbox"`
   — the phone shows a request from `sandboxalice.41`.
3. Accept it on the phone; `pcs requests alice` shows `accepted`;
   `pcs inbox alice` shows the "chat accepted" row.
4. Phone → sandbox: send a text, react to the welcome message, send a
   photo. `pcs inbox alice --peer shawntabrizi.02` shows the text, the
   reaction on the welcome row, and the photo `claimed on #1` with a
   `media` id; `pcs wire --decode --peer alice` shows the phone's
   statements on `session shawntabrizi.02#1→alice /request` and alice's
   ACKs.
5. Sandbox → phone: `pcs send alice shawntabrizi.02 "hi phone"`,
   `pcs react alice shawntabrizi.02 <phone message id> 👍`,
   `pcs send alice shawntabrizi.02 --attach photo.png --caption "from alice"`
   — the phone shows each; `pcs inbox alice` shows `delivered` after the
   phone's ACK.
6. Screenshots: the phone's chat, `pcs inbox alice`, the Room view in the
   UI (`http://127.0.0.1:7788`, Chats → shawntabrizi.02).

Result: ______________________________________ (owner)

### Deviations from PLAN.md and the task, and why

- **The chain directory reads through the sandbox's own papi, not
  bot-core's `createChainDirectory`.** Two storage reads did not justify a
  second descriptor set and a papi-version coupling (sandbox 3.1.0,
  bot-core 2.1.7); the unsafe api decodes from the chain's metadata. The
  read contract bot-core's `waitForAttestation` needs is the same.
- **Short persona names register as `sandbox<name>`** (`sandboxalice.41`):
  the backend's rule is six or more letters and the task's `pcs user add
  alice` had to work; `--username` overrides (questions.md S6.5).
- **A re-registration claims without the old number** (persona and bot
  alike): the backend refuses it to the account that owns it, so
  `pcs user add` after a reset takes a new number silently while `pca
  register --again` asks for `--new-number` first — a bot's name is known
  to its contacts, a persona's is not.
- **`pca info` does not re-check a confirmed bot against the chain**: a
  live check would make `pca info paseobot` in bot-core's unit tests hit
  the real network. The reset is detected by `pca register --again`
  (questions.md S6.6).
- **Bulletin allowance: the chain is re-read for 90 s after an
  unconfirmed faucet submit** instead of leaving a guard for an operator
  to recover, because a sandbox persona has no `pca storage` command;
  bot-core's own guard for bots is untouched.
- **The live acceptance stops at the claim** on both sides: the identity
  backend does not attest on the reset chain (S6.1). Everything up to that
  point ran against the real network and is recorded above.

### What is verified

- The paseo daemon against the real network: connect, genesis, persona
  minting and claim through the identity backend (a real proof, a real
  claim: `sandboxalice.41`, `sandboxecho.91`, `openclawbot.19`), the
  Bulletin faucet allowance for a persona's upload signer, persistence
  across a restart, the resume path, the backend search checked against
  the chain, `bot attach` reading the chain, every refusal, the UI.
- The chain reset marking (unit), the re-registration outcomes (unit, and
  the backend's real answers above), the registration flow (unit).
- Nothing in the mock changed: the full suite and every scenario.

### What is not verified

- A message over Paseo Next between a persona and a bot, or a phone: no
  attestation landed for any claim made this week (the phone's included).
- The two scenarios on `--network paseo` (they need an attested persona
  and bot); their mock runs are in the suite.
- A chain reset observed live by the daemon (the unit test marks records;
  the live daemon saw one genesis).
- The bot-core side of the "finalization unknown" faucet answer for a
  persona is handled; for a bot it remains the S5 operator flow.

No bot, daemon or dev server was left behind: `sandboxecho` was created
and attached but never run; the paseo daemon on port 7799 was stopped at
the end (the owner's own `pcs up` on port 7788, pid 27053, started before
this session, was left untouched).

## S6b — `devnet` profile: the sandbox on Products Devnet (2026-09-05)

The point of S6b: Paseo Next's identity backend does not attest (S6.1),
Products Devnet's does, so the live acceptance S6 could not reach — a
persona and a bot exchanging messages over a real testnet — ran here.
The devnet profile is the paseo profile with a different row of
bot-core's network table; the one thing devnet adds is the client-proof
session its backend wants for a username claim.

### What was verified (offline, CI)

`cd sandbox && npm test` (Node v24.13.1) on the final tree: 107 tests, every
scenario on the mock. New or changed since S6:

```
✔ mock is the default and holds no endpoint; a typo is refused
✔ paseo mirrors bot-core's Paseo Next v2 profile; registration auth is none
✔ devnet mirrors bot-core's Polkadot Products Devnet profile; registration auth is client-proof
✔ client-proof: the claim carries a bearer minted with the persona's wallet key; the session is saved before the claim and gone after
✔ client-proof: an issued PCA_IDENTITY_TOKEN skips the exchange; a refusal names the enrollment rules; the voucher is offered only after it
✔ search asks the identity backend's search route, page by page, and checks every hit against the chain
ℹ tests 107  ℹ pass 107  ℹ fail 0
```

`cd sandbox/ui && npm run check`: tsc, 31 vitest tests, vite build.
`cd bot-core && npm test`: 425 tests, 420 pass, 5 skipped (the uid-gated
`workspaces.test.mjs` cases); new: `canonicalUsername`, `searchUsernames`
(paging, 402 proof of compute against the backend's own work vectors, 429
retry) and the `create --digits` taken/free decision through the search.

### (a) `pcs up --network devnet`, `pcs user add alice`

Human output is JSON here because the commands ran without a TTY. The
daemon ran on port 7799 with a scratch state dir (the owner's own mock
daemon holds 7788).

```
$ pcs up --network devnet --dir <scratch>/devnet-state --port 7799
{"event":"SANDBOX_UP","url":"http://127.0.0.1:7799","network":"devnet","genesis":"0xe6c30d6e148f250b887105237bcaa5cb9f16dd203bf7b5b9d4f1da7387cb86ec","storeUrl":"wss://people-paseo.rotko.net","hopUrl":"wss://bullet.sik.rocks",…,"personas":[]}

$ pcs user add alice --wait 240                       # 52 s
{ "name": "alice", "account": "0x0862f804…", "username": "sandboxalice.80",
  "registration": { "username": "sandboxalice.80", "status": "attested", "genesis": "0xe6c30d6e…",
                    "claimedAt": "2026-09-05T19:43:50.799Z", "attestedAt": "2026-09-05T19:44:28.461Z", "bulletin": "authorized" },
  "devices": [ { "index": 1, "account": "0x0862f804…", … } ] }
daemon log:
  SANDBOX_PERSONA_UP       {"name":"alice","account":"0x0862f804…","devices":1,"username":"sandboxalice"}
  SANDBOX_PERSONA_CLAIMED  {"name":"alice","username":"sandboxalice.80","again":false}
  SANDBOX_PERSONA_ATTESTED {"name":"alice","username":"sandboxalice.80"}          # 38 s after the claim
  SANDBOX_PERSONA_BULLETIN {"name":"alice","address":"5H6UtaUGgscy…","detail":null}

$ curl http://127.0.0.1:7799/api/consumers/0x0862f804…        # Resources.Consumers on the devnet People chain
{"account":"0x0862f804…","username":"sandboxalice.80","identifierKey":"0x00d0efc3e7…"}
$ curl '{devnet backend}/api/v1/usernames?prefix=sandboxalice'
[{"candidateAccountId":"5CFhe5c8f8S3…","username":"sandboxalice.80","status":"ASSIGNED","onchainData":{"blockNumber":6497684,…}}]
```

The claim went out with a bearer the daemon minted from alice's own
`//wallet` key (challenge → client proof → token, no voucher, no operator
token); the backend attested it at block 6497684 and the chain holds the
RFC-0004 container (`0x00` + her X25519 key). Her statement allowance is
proven by everything below: every statement she submitted was stored.
The Bulletin faucet answered within the helper's deadline this time.

### (b) `pca create sandboxecho-dev --network devnet`, `pca run`

```
$ pca create sandboxecho-dev --brain echo --network devnet --owner 0x0862f804… --username sandboxechodev --wait 240 --port 8834
→ Creating bot "sandboxecho-dev"…
✓ Generated your bot's identity
→ Registering your bot on the network…
✓ Registered as sandboxechodev.90
→ Waiting for the network to confirm (up to 240s)…
..................
✓ Confirmed — your bot is live and people can message it!
→ Provisioning Bulletin Products Devnet file allowance…
⚠ The public Polkadot Products Devnet faucet may have accepted this allowance grant. Do not retry it yet.
  …
Locked to 1 allowlisted address — only they can message it.
  or search: sandboxechodev.90
                                                       # 2 min 10 s in total
$ pca storage sandboxecho-dev status                   # a minute later
  storage:   active through block 958796 (201567 blocks remaining); 1000 transactions and 95.3 MiB remain
$ pca storage sandboxecho-dev recover
✓ Verified allowance is sufficient; cleared the local recovery guard.

$ pcs bot attach sandboxecho-dev
{ "name": "sandboxecho-dev", "username": "sandboxechodev.90", "account": "0x9e60b889…", "onChain": true, "needsReregistration": false, "networkProfile": "devnet", … }
$ pca run sandboxecho-dev
{"event":"BOT_HOP_UPLOAD_CONFIGURED","host":"bullet.sik.rocks","maxBytes":52428800}
{"event":"BOT_STARTING","endpoint":"wss://people-paseo.rotko.net","username":"sandboxechodev.90","brain":"echo","allowlist":1}
{"event":"BOT_SUBSCRIBED","heartbeatMs":30000}
```

`--username sandboxechodev` because a bot name with a hyphen is not a
username; the backend assigned `.90`.

### (c) alice ↔ sandboxechodev.90: request, accept, text, reply, reaction, an attachment each way

```
$ pcs request alice sandboxecho-dev --welcome "hello from the sandbox on devnet"
{ "requestId": "f7dcba52-…", "to": "0x9e60b889…", "toName": "sandboxechodev.90" }
$ pcs requests alice                                   # 40 s later
[ { "peerUsername": "sandboxechodev.90", "direction": "outgoing", "status": "accepted", "welcomeMessage": "hello from the sandbox on devnet", … } ]
$ pcs send alice sandboxecho-dev "text round trip on devnet"
$ pcs send alice sandboxecho-dev "a reply to your echo" --reply 753653FC-AB5A-4B4C-B526-178BE71C6458
$ pcs react alice sandboxecho-dev 753653FC-AB5A-4B4C-B526-178BE71C6458 👍
$ pcs send alice sandboxecho-dev --attach photo.png --caption "a photo for you"        # 240×120 PNG, 60789 B
  "kind": "image", "mimeType": "image/png", "fileSize": 60789, "wssUrl": "wss://bullet.sik.rocks"
$ pcs send alice sandboxecho-dev --attach notes.txt --caption "/file put notes.txt"
$ pcs send alice sandboxecho-dev "/file get notes.txt"
$ pcs inbox alice                                      # one line per row: direction, text, status, ACKs, attachment
outgoing hello from the sandbox on devnet               delivered
system   contactAdded                                   received
incoming Echo: hello from the sandbox on devnet         received acked [1]  reactions ["👍:me"]
outgoing text round trip on devnet                      delivered
incoming Echo: text round trip on devnet                received acked [1]
outgoing a reply to your echo                           delivered            ↩ 753653FC
incoming Echo: a reply to your echo                     received acked [1]
outgoing a photo for you                                delivered            image image/png 60789B sent media 3c9ee47c…
incoming Echo: a photo for you                          received acked [1]
outgoing /file put notes.txt                            delivered            general text/plain 68B sent media 37ed71c0…
incoming Saved notes.txt (68 B).                        received acked [1]
outgoing /file get notes.txt                            delivered
incoming notes.txt                                      received acked [1]   general text/plain 68B claimed media 8bb1e4e6…
$ cmp notes.txt devnet-state/personas/alice/media/8bb1e4e6….txt && echo byte-identical
byte-identical
bot log:
  BOT_RECEIVED_OPENER {"from":"0862f804…","requestId":"f7dcba52-…","chars":32}   BOT_SENT_TEXT {"chars":38}
  BOT_RECEIVED_TEXT {"chars":25}                                                  BOT_SENT_TEXT {"chars":31}
  BOT_RECEIVED_TEXT {"chars":20,"kind":"reply"}                                   BOT_SENT_TEXT {"chars":26}
  BOT_RECEIVED_REACTION {"emoji":"👍","target":"753653FC-…","removed":false}
  BOT_RECEIVED_TEXT {"chars":15,"kind":"richText","attachments":1}  BOT_MEDIA_DOWNLOADED {"mime":"image/png","bytes":60789}
  BOT_RECEIVED_TEXT {"chars":19,"kind":"richText","attachments":1}  BOT_MEDIA_DOWNLOADED {"mime":"text/plain","bytes":68}  BOT_FILE_SAVED {"path":"notes.txt"}
  BOT_RECEIVED_TEXT {"chars":19}   BOT_SENT_FILE {"mime":"text/plain","bytes":68}   BOT_FILE_DELIVERED {"path":"notes.txt","bytes":68}
```

Every outgoing row is `delivered` (the bot's ACK on the real store), every
incoming one was ACKed by alice's device; both attachments went through
the real Bulletin HOP node under the faucet allowances, and the file the
bot returned is byte-identical. The wire, as alice's subscriptions saw it
(the slots are what the store holds now; `replaced ×N` is the sandbox's
count of what each slot held before):

```
$ pcs wire --decode --peer alice
→ alice#1  chat request  seq 25472886  582B
  topic request→sandboxechodev.90
  topic request→sandboxechodev.90 day 294
  topic 0x78008d168cef19b4330b5e42c2e676d2c98f832e3b9312907285cd69123bf35a
  chat request (addressed to a bot: no key here)
→ sandboxechodev.90  identity sandboxechodev.90→alice /request  seq 25472887  394B
  topic identity sandboxechodev.90→alice
  request 5151E512-B…  1 message(s)  acked by alice#1 (success)
    deviceChatAccepted   id F480A5A7-5…
→ alice#1  identity alice→sandboxechodev.90 /response  seq 25472887  244B
  topic identity alice→sandboxechodev.90
  response to 5151E512-B…  success
→ alice#1  session alice#1→sandboxechodev.90 /request  seq 25473138  422B  replaced ×6
  topic session alice#1→sandboxechodev.90
  request 5rWrRIAVfa…  1 message(s)  for sandboxechodev.90  acked by sandboxechodev.90 (success)
    text "/file get notes.txt"  id 3b5256a7-c…
→ sandboxechodev.90  session sandboxechodev.90#1→alice /response  seq 25473138  352B  replaced ×6
  topic session sandboxechodev.90#1→alice
  response to 5rWrRIAVfa…  success  for alice#1
→ sandboxechodev.90  session sandboxechodev.90#1→alice /request  seq 25473140  538B  replaced ×5
  topic session sandboxechodev.90#1→alice
  request B8415331-0…  1 message(s)  for alice#1  acked by alice#1 (success)
    richText "notes.txt" +1 attachment(s)  id DA62FB85-1…
→ alice#1  session alice#1→sandboxechodev.90 /response  seq 25473140  368B  replaced ×5
  topic session alice#1→sandboxechodev.90
  response to B8415331-0…  success  for sandboxechodev.90
```

### (d) The Conversation screen

`docs/images/s6b-devnet-conversation.png`: the UI served by the devnet
daemon, rail badge `devnet`, alice on the left, `sandboxechodev.90` on the
right (read-only, "as seen by alice"), the rows above including the photo
inline and the returned `notes.txt`.

### The daemon restart

The daemon was stopped and started again on the same state dir (also to
load the search-route change below):

```
$ pcs up --network devnet --dir <scratch>/devnet-state --port 7799
$ pcs user list         → alice  sandboxalice.80  attested, Bulletin allowance authorized
$ pcs bot list          → sandboxecho-dev  sandboxechodev.90  onChain true
$ pcs send alice sandboxecho-dev "still here after the daemon restart"
✗ no chat session with this contact
$ pcs request alice sandboxecho-dev --welcome "hello again after the daemon restart"
$ pcs requests alice    → accepted
$ pcs send alice sandboxecho-dev "text after the restart"
$ pcs inbox alice
outgoing hello again after the daemon restart           delivered
system   contactAdded                                   received
incoming Echo: hello again after the daemon restart     received acked [1]
outgoing text after the restart                         delivered
incoming Echo: text after the restart                   received acked [1]
```

The identity, the registration and the attached bot came back; the chat
state (contact, session, room) did not — a testnet persona persists its
identity record only, as in S6 — so a new request was needed, which the
bot (whose own session state survived) accepted again. Recorded as
questions.md S6b.4.

### The identity backend's search route

Both live backends run `paritytech/device-uniqueness-backend`; the username
read is `GET /api/v1/usernames/search?prefix=&limit=&cursor=`. After the
change (`a80c59f`, `3248e57`), live on devnet:

```
$ pcs user find shawntabrizi
[ { "username": "shawntabrizi.01", "account": "0xd09c501e…", "status": "ASSIGNED", "onChain": true } ]
$ pcs user find sandbox
[ { "username": "sandboxalice.80", "account": "0x0862f804…", "status": "ASSIGNED", "onChain": true },
  { "username": "sandboxechodev.90", "account": "0x9e60b889…", "status": "ASSIGNED", "onChain": true } ]
```

The backend rendered `shawntabrizi.1`; the chain holds
`shawntabrizi.01` (`Resources.UsernameOwnerOf("shawntabrizi.1")` is empty,
`("shawntabrizi.01")` is `5GnEFZQ7PPpk…`; the consumer's `lite_username`
bytes read `shawntabrizi.01`), so every hit is normalised to the padded
form in `canonicalUsername` before the chain check. The proof-of-compute
gate is not enforced on either backend today (a wrong, a reused and a
malformed `Proof-Of-Compute` header all answered 200), so the solver is
verified against the backend's own work vectors, not live. At the time of
this run the retired routes still answered 200 on devnet.

### (e) The phone check — the owner's

`shawntabrizi.01` exists on devnet (`5GnEFZQ7PPpk5i9bQkNqLzmzKqnXPx31PyPx15BeB8EBgQhr`,
`0xd09c501e…`), but its identifier key on chain is `0x04cd8f2f…`: a
pre-RFC-0004 P-256 key. The sandbox (and the app) cannot message it:
`pcs request alice shawntabrizi.01` answers "not messageable (no
identifier key on this chain)". Precondition for the steps below: the
phone re-registers on devnet with an X25519 key (a fresh install or a
re-registration — `pcs user find shawntabrizi` then shows the new name
with `onChain: true`, and `curl {daemon}/api/consumers/<account>` an
`identifierKey` starting `0x00`).

1. `pcs up --network devnet` (the default state dir), then
   `pcs user add alice` — reports `attested` (a new persona) or resumes.
2. `pcs request alice shawntabrizi.NN --welcome "hello from the sandbox"`
   — the phone shows a request from `sandboxalice.NN`.
3. Accept it on the phone; `pcs requests alice` shows `accepted`;
   `pcs inbox alice` shows the "chat accepted" row.
4. Phone → sandbox: send a text, react to the welcome message, send a
   photo. `pcs inbox alice --peer shawntabrizi.NN` shows the text, the
   reaction on the welcome row, and the photo `claimed on #1` with a
   `media` id; `pcs wire --decode --peer alice` shows the phone's
   statements on `session shawntabrizi.NN#1→alice /request` and alice's
   ACKs.
5. Sandbox → phone: `pcs send alice shawntabrizi.NN "hi phone"`,
   `pcs react alice shawntabrizi.NN <phone message id> 👍`,
   `pcs send alice shawntabrizi.NN --attach photo.png --caption "from alice"`
   — the phone shows each; `pcs inbox alice` shows `delivered` after the
   phone's ACK.
6. Screenshots: the phone's chat, `pcs inbox alice`, the Conversation
   screen in the UI (`http://127.0.0.1:7788`, alice | shawntabrizi.NN).

Result: ______________________________________ (owner)

### Deviations from the task, and why

- **The bot is `sandboxechodev.90`, not `sandboxecho-dev`**: a hyphen is
  not a username character, so `--username sandboxechodev` was passed;
  the bot's local name is the one the task named.
- **The phone step stops at its precondition**: the owner's devnet
  identity carries a P-256 key, which nothing in this repo can message;
  the steps are written for after a re-registration.
- **Scope added by the owner mid-task**: the identity backend's search
  route (bot-core and the sandbox), above.
- **No devnet-specific code**: the profile is one rule over bot-core's
  table; the only per-profile behaviour is `identityRegistrationAuth`,
  read from that table.

### What is verified

- The devnet daemon against the real network: connect, genesis, persona
  minting, the client-proof session and claim through the identity
  backend, the attestation (38 s), the Bulletin faucet allowance, `bot
  attach` reading the chain, persistence of the identity across a restart,
  the backend search checked against the chain.
- A real message path over a testnet between a persona and a bot-core
  bot: request and accept, text, reply, reaction, a photo and a file to
  the bot, a file back from the bot, every request ACKed, the wire as the
  persona saw it.
- The registration paths offline: client proof, issued token, voucher
  fallback, refusal message, and no exchange on Paseo Next.

### What is not verified

- The voucher and issued-token paths live (the backend accepted the client
  proof, so neither was needed), and the proof-of-compute gate live (not
  enforced today).
- The phone (P-256 key on devnet; steps written, result blank).
- The two scenarios on `--network devnet` as scripts: the same steps ran
  by hand above; the scenario helper's `pca create` would need the
  `--username` the hyphen-less names avoid, so
  `pcs scenario run scenarios/echo-roundtrip.mjs --network devnet` is a
  live check for a later session.
- A chain reset on devnet (the unit test marks records; the live daemon
  saw one genesis).

No bot, daemon or dev server was left behind: the echo bot (pid 90515) and
the devnet daemon (port 7799) were stopped at the end; `sandboxecho-dev`
remains in `~/.pca/bots` as a registered devnet bot (`sandboxechodev.90`),
locked to alice; the owner's own mock daemon on 7788 was left untouched.
