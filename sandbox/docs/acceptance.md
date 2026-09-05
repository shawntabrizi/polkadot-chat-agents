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
