# Open questions for the owner

Questions only the owner can answer. Each one names what was done meanwhile.

## S0

1. **Channel replacement on equal expiry.** The task and `PLAN.md` say a new
   statement replaces the old one when its expiry is *equal or higher*. The
   real node (`polkadot-sdk` checkout of 2026-07-30,
   `substrate/client/statement-store/src/lib.rs`, `SubmitIndex::insert`)
   rejects `expiry <= existing` with `channelPriorityTooLow`, and its own unit
   test asserts "Equal priority should be rejected". The chat spec
   (`chat-spec/base-spec.md`, field table and the `submit_statement` note)
   says the same, and the SDK's session keeps `Expiry(A, B)` strictly
   increasing for that reason. The node implements the real rule: **strictly
   greater replaces, equal is rejected**. Is the plan's wording a typo, or is
   there a deployed node version that accepts equal expiries?

2. **Empty initial dump.** The real RPC (`substrate/client/rpc/src/statement/mod.rs`,
   `send_in_chunks`) sends *no* `newStatements` event when nothing matches a
   new subscription. The SDK's `getStatements` — which bot-core's poll sweep
   uses through `queryStatements` — only resolves on a page whose `remaining`
   is 0 or absent, so against that node an empty poll never completes. The
   sandbox node keeps sending one empty page (`remaining: 0`) so bot-core's
   tests stay green. Which behaviour does the deployed node have? If it
   really sends nothing, bot-core's poll path needs a fix before the sandbox
   node can be made faithful here.

3. **Signature verification (`badProof`).** Not modelled in S0. It would make
   the node an independent check of every client's signing (bot-core's
   vendored codec and the SDK's prover) at the cost of one more pinned
   dependency (`@scure/sr25519`, already a devDependency for the tests).
   Add it in S1 with the directory, or keep the node proof-blind?

4. **`startMockStatementNode` name.** Kept as instructed. Rename to
   `startStoreNode` when bot-core's tests are next touched?

### Answers (owner review, 2026-09-05)

1. Plan wording was wrong; fixed in PLAN.md. Strictly greater replaces, equal
   is rejected. Node behaviour stays.
2. Confirmed against `substrate/client/rpc/src/statement/mod.rs`
   (`send_in_chunks` breaks on an empty chunk, sends nothing) and
   `@novasamatech/sdk-statement` (`getStatements` resolves only on a page with
   `remaining` 0 or absent). So bot-core's poll of an empty topic batch times
   out at `BOT_QUERY_TIMEOUT_MS` against a real node. That is a bot-core
   defect the mock hid. S1 makes the node faithful (no event on an empty dump)
   and S2 fixes bot-core's sweep so it does not depend on a page arriving.
   The existing e2e tests may go red in between; that is the point.
3. Yes, add `badProof` in S1 together with the directory.
4. Rename to `startStoreNode` in S1 and update bot-core's two imports then.

S0 review: accepted. Both suites re-run green here (sandbox 11/11, bot-core
416/416). The rules were checked against the polkadot-sdk checkout.

## S1

1. **`deviceAdded` fan-out and bot-core.** Android's PApp announces every
   one of its devices with `deviceAdded` on the multi-device session once a
   contact has no pending request (`ContactDeviceFanOutService`, both the
   accepting and the requesting side, including the device the peer already
   knows). The personas do the same, and that is how alice learns bob's
   device 2 in the acceptance. `docs/explanation/protocol.md` lists what
   bot-core does with `DeviceChatAccepted` but not with `deviceAdded` /
   `deviceRemoved` (17/18). When a two-device persona accepts a bot's
   request in S2, a bot that ignores `deviceAdded` wraps its answers for
   device 1 only. Should S2 make bot-core apply the roster variants (as the
   web client and Android do), or is single-device addressing accepted for
   bots for now? Meanwhile the personas fan out like the phone.

2. **Sibling devices on the identity session.** Every device of a persona
   opens the identity session with each contact (all must receive an accept
   and the SDK opens the subscription only through a session). The SDK's
   `init` restores "own" outgoing batches from the shared identity topic by
   decrypting with K(A,B), which every sibling can — so device 2 adopts
   device 1's un-acked identity batch as its own. Harmless while siblings
   never post there (only the accepting device does), and the peer dedups by
   messageId; it would duplicate messages under a second signer if a sibling
   posted before the ACK. Accept as an SDK quirk of the sandbox, or should
   sibling devices only listen (no `createSession`, a raw subscription)?
   Meanwhile: every device runs the session, only the acting device posts.

3. **ACK code for a mixed batch.** The web client's `respondToRequests`
   answers per message, so with the SDK's sticky `responded` flag the first
   message's status decides the batch's code. The personas answer per
   request: `success` when anything decoded, `decodingFailed` only when
   nothing did. bot-core ACKs the batch on delivery regardless. Is
   "success if anything decoded" the semantics S3's poisoned-batch scenario
   should assert against, or should a partially undecodable batch be
   NACKed? Meanwhile the personas ACK success.

4. **Persistence before S2.** Personas and node contents live in memory;
   `pcs up` twice gives a fresh network. `scenarios/bot-restart.mjs` (S2)
   restarts the bot, not the daemon, so this may wait — unless the owner
   wants `pcs up` to reload personas from the state dir first. Meanwhile
   nothing is persisted; the state dir only holds `daemon.json`.

### Answers (owner review, 2026-09-05)

1. Yes. S2 runs the echo-roundtrip scenario against a two-device persona. If
   bot-core addresses device 1 only, fix bot-core to apply `deviceAdded` /
   `deviceRemoved` to the roster (it already has an `extraDevices` seam in
   `buildSession`). That is the sandbox doing its job.
2. Keep as is. Only the accepting device posts on the identity session, like
   the phone. Siblings listen. Add a guard so a sibling never submits on it.
3. Mirror bot-core: a batch is ACKed when at least one message decoded;
   `decodingFailed` only when none did. The S3 poisoned-batch scenario
   asserts exactly that on both sides.
4. No persistence before S2.

S1 review: accepted. Re-run here: sandbox 46/46, bot-core 416/416. The
PLAN.md pcs transcript was replayed against a live daemon: text reached both
bob devices with ACKs from both, alice's row went to `delivered`, the wire
view labels both channels, no secret appears in the daemon log, and the state
dir is 0700 with daemon.json 0600.

## S2

1. **S0 answer 2 was wrong: the node sends an empty page.** The RPC's
   `send_in_chunks` does send nothing on an empty dump, but
   `Store::subscribe_statement` in `substrate/client/statement-store/src/lib.rs`
   sends `NewStatements { statements: [], remaining: Some(0) }` on the same
   stream first (polkadot-sdk `99c8ed2a2fea`; the block dates to PR #11139,
   2026-02-24, the change that introduced the event format itself). Making
   the sandbox node silent stalled every SDK session at `init()` (it awaits
   `queryStatements` on its own, still empty, outgoing topic) — so a silent
   node would break Polkadot Desktop too, which is further evidence the page
   is real. S2 therefore keeps the S0 behaviour and changes nothing in
   bot-core; the evidence and the fix bot-core would need if a deployed node
   ever differed are in `docs/decisions.md` (D1). Is any deployed node older
   than PR #11139? If so it also lacks the `newStatements` event shape the
   SDK and bot-core decode, so it could not serve either client anyway.

2. **Empty welcome next to the accept.** With `BOT_ACK_TEXT` empty (the echo
   brain's default) bot-core still enqueues a text message with empty text
   beside its `deviceChatAccepted` on the identity session; the persona
   shows an empty row (`inbox alice`: `echobot:` with no text) and a phone
   presumably an empty bubble. Should an empty ack text mean "send no
   welcome" rather than "send an empty one"? Meanwhile unchanged.

3. **`deviceRemoved` (kind 18).** bot-core decodes `deviceAdded` (17) and
   applies it; 18 is logged as `BOT_UNSUPPORTED_CONTENT`. No persona sends it
   yet (there is no device-removal command). Add it when the personas can
   remove a device (S3), or leave until a phone is seen sending it?

S2 self-check: sandbox 48/48, bot-core 417/417 on the final tree; no bot
or daemon process left behind (`pgrep` clean after every run).

### Answers (owner review, 2026-09-05)

1. Confirmed in `substrate/client/statement-store/src/lib.rs`
   `subscribe_statement`: an empty dump sends `{statements: [], remaining: 0}`.
   The S0 answer 2 was wrong and is withdrawn. No deployed node predates that
   event format for chat. Node behaviour stays.
2. Not intended. An empty `BOT_ACK_TEXT` must send the accept alone; an empty
   text bubble on a phone is a defect. Fix in bot-core in S3, with a scenario
   asserting the persona sees only `contactAdded` after the accept.
3. Add `deviceRemoved` decoding to bot-core in S3, together with persona
   device removal, and a scenario that a removed device stops receiving.

S2 review: accepted. Re-run here: sandbox 48/48 including both scenarios,
bot-core 417/417 on two of three runs; the one failure was the pre-existing
`workspaces.test.mjs` worktree-timeout race noted in the S0 record, unrelated
to the sandbox. Make that test deterministic in S3. `bot-core/vendor` is
untouched. No papi storage query remains outside `lib/people-directory.mjs`.

## S3

1. **Expiry never passes for a chat statement.** PLAN.md's S3 scenario
   "expiry passing while a message is queued" asked to assert that the
   sender re-allocates its expiry and the message still lands. Neither client
   can: the SDK's allocator and bot-core's `expiryFactory` both pin the high
   word to `0xffffffff` (never expires) and use the low word as a sequence,
   so no clock jump short of the year 2106 expires a chat statement, and a
   jump past it rejects every new one as `alreadyExpired` with no recovery
   path in either client. `scenarios/expiry-while-queued.mjs` therefore
   proves what holds — a queued statement survives `clock +2h`, a
   hand-planted 60 s statement does not, the slot keeps advancing — and the
   2106 case is recorded as a protocol limit, not exercised. Is a real
   expiration ever expected on a chat channel (a future spec change, a
   heartbeat with a TTL), so the sandbox should model it, or is the pinned
   high word settled?

2. **The persona has no resend timer.** The SDK re-submits an un-ACKed batch
   only when a later message extends it, or at session init (it reads its
   own statement back from the store). `ack-or-resend` proves the invariant
   through the extension path (alice's next message carries the un-ACKed one
   again). protocol.md says the app "resends its backlog until it sees an
   ACK": does the phone have a timer-driven resend the persona should mimic
   (a `pcs` option), or is the phone's resend the same extension-or-init
   behaviour?

3. **One response channel per session.** Every ACK a device sends rides its
   single response channel, so the store keeps only the newest; the SDK
   itself notes that reliably ACKing several outstanding requests needs a
   protocol-level fix (`session/core.ts`). `every-device-session` sends the
   three follow-ups one at a time for that reason. Should a concurrent
   variant (three devices sending at once) exist, expected to expose the
   limit and be reported as such?

4. **`deviceRemoved` decoding lives in `index.mjs`, not the codec.** The task
   rule says never touch `bot-core/vendor`; CLAUDE.md allows minimal
   protocol-level fixes there. The kind-18 body (one compact-prefixed
   account) is parsed in `index.mjs` from the codec's `unsupported` raw
   content (`2081211`). Move it into `vendor/app-chat-codec.mjs` next to
   `deviceAdded` the next time the codec is touched?

5. **`test-client-device.mjs` stays.** The scenarios now cover everything it
   did except a real HOP attachment (`--attach`, used by eight bot-core
   offline tests) and sending over a live network from a real seed. Retire
   it with the HOP sandbox (v1.5) and port those tests to the persona API
   then, or port the non-attachment bot-core tests earlier?

S3 self-check: sandbox 61/61 (11 scenarios), bot-core 417/417 on the final
tree; no bot or daemon process left behind.

### Answers (owner review, 2026-09-05)

1. Settled. Chat channels pin the expiry high word; a real expiration on a chat
   channel is not expected. The scenario records the protocol limit.
2. Only via extension or init, like the SDK, until a phone is observed doing
   otherwise. No timer option.
3. Not now. Note the limit in the acceptance record; revisit if a phone shows
   concurrent sends from several devices.
4. Done in this review: kind 18 is decoded in `vendor/app-chat-codec.mjs`
   (minimal diff, protocol-level, as CLAUDE.md allows) and `index.mjs` reads
   `m.kind === "deviceRemoved"`. The hand parser is gone.
5. Retire at v1.5 with the HOP sandbox. Do not port the attachment tests early.

S3 review: accepted. Re-run here: sandbox 61/61 with all eleven scenarios,
bot-core 417/417 before and after the codec move; `ack-or-resend` and
`device-removed` replayed through `pcs scenario run`. `bot-core/vendor`
changed only for the kind-18 decoder.
