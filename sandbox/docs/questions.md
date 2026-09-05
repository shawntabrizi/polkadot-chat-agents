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
