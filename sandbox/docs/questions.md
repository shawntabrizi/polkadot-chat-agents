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

## S4

1. **Theme.** The design skill asks which of its five themes a project
   uses and says not to assume. Nobody was there to ask, so the UI ships the
   default pair: Berlin Day, and Berlin Night when the OS prefers dark
   (`prefers-color-scheme`, no switcher). The token bundle is copied as is
   into `sandbox/ui/src/theme`, so a switch to Lisbon, Malta or Tokyo is one
   `data-theme` attribute. Which theme?

2. **No component library, plain CSS.** The skill's setup is Tailwind v4 plus
   shadcn components; the task said "no component library". The UI follows
   the skill's rules (surfaces over borders, the semantic tokens, one focus
   rule, action tokens for buttons, a nav rail with pill selection, no
   modals) in hand-written CSS (`src/styles.css`, ~200 lines) over the
   bundle's `tokens.css`. Keep it that way, or adopt Tailwind + shadcn now
   that there is a UI to carry them?

3. **Markdown images.** `![alt](url)` renders as a link to the URL, never an
   `<img>`, so a message can never make the viewer fetch an arbitrary URL.
   The task listed only text constructs. Should the UI ever show remote
   images (a bot answering with a chart), or is a link the right behaviour
   for a protocol tool?

4. **`scenarios/device-removed.mjs` is timing sensitive.** Its "and was
   ACKed" check reads the fan-out slot's ACKs right after
   `BOT_PEER_DEVICE_REMOVED`, and the bot ACKs after logging that event.
   An extra 200 ms of `pcs` start-up (jsdom imported eagerly by the API
   module, see the S4 acceptance record) flipped it from 5/5 to 1/5; the
   lazy import restored 5/5 without touching the scenario. The mechanism of
   *why slower `pcs` loses the race* is not explained, only measured. Should
   the assertion become a `sandbox.waitFor` on the ACK (an S3 file, not
   changed here), or is a sharp check wanted so that kind of slowdown shows?

5. **Raw accounts on screen.** The design skill says never to surface raw
   identifiers by default. The Personas screen shows the persona's account
   and chat key in full (mono) and device and contact accounts shortened,
   because this is the tool an agent and a person use to read the wire, and
   the wire is made of accounts. Acceptable for the sandbox, or move them
   behind a "details" toggle?

6. **Two path prefixes.** The daemon answers every route bare (`/personas`,
   used by `pcs` and the tests) and under `/api` (used by the UI, because
   the Vite dev server proxies that prefix and the built app is served at
   `/`). One prefix would be cleaner: move `pcs` and the tests to `/api`, or
   keep both?

### Answers (owner review, 2026-09-05)

1. Keep Berlin Day/Night by OS preference until the owner picks a theme.
2. Keep plain CSS over the token bundle. No Tailwind, no shadcn.
3. Links only. A protocol tool must never fetch a URL a peer chose. If a
   chart bot ever needs images, add a per-viewer "load images" toggle then.
4. Make it a bounded `waitFor` (2 s) and log the measured latency. A check
   that fails on CLI start-up time is not measuring the invariant. Keep the
   "why slower pcs loses the race" note open as an S5 investigation.
5. Acceptable for the sandbox. The wire is made of accounts.
6. One prefix. Move `pcs` and the tests to `/api` in S5; drop the bare paths.

S4 review: accepted. Re-run here: sandbox 76/76, sandbox/ui 10/10 with a
clean build, bot-core 417/417. The html route was replayed with hostile
input (`<script>`, a `javascript:` link, raw `<a>`): script gone, the link
rendered as literal text, raw HTML escaped, `https://` linkified with
`rel="noopener noreferrer"`. The Room screenshot shows the echo bot's table
and fenced code rendered on both sides with per-device ACKs.

## S5

1. **Who signs a persona's uploads.** base-spec.md ("hop_submit") says peer A
   MUST sign submissions with its statement keypair `SP(A)` — for a
   multi-device user, the sending device's statement account. bot-core signs
   with a derived `//allowance//bulletin//chat` account, and the task asked
   for "the persona's own allowance account". The persona mints one
   sr25519 Bulletin key per persona (`bulletinAccount`, registered with the
   identity like the bot's), not one per device. Should uploads be signed
   per device (SP of the sending device, as the spec reads), which would
   make the Bulletin allowance a per-device grant in the directory too?

2. **AES-GCM in the spec, ChaCha20-Poly1305 everywhere.** base-spec.md
   ("Encryption") says pool entries are AES-256-GCM. Every deployed client
   uses ChaCha20-Poly1305 (`nonce ‖ ciphertext ‖ tag`): the mobile app's
   HandoffService (bot-core's `hop-client.mjs` header), Polkadot Desktop's
   `@novasamatech/handoff-service` (`crypto/encryption.ts`), and now the
   sandbox. The spec text looks stale; is a spec fix in flight, or is there
   a client somewhere that really uses AES-GCM?

3. **Ack-before-chunks and the retry that cannot succeed.** The spec's
   download flow acks the metadata entry before the chunks; a chunk that then
   fails (corrupt bytes, a lost socket past the single retry) leaves the root
   entry removed, so no later retry can succeed without RFC-0001's on-chain
   fallback. `test/hop.test.mjs` pins that consequence. bot-core does the
   same. Should a client defer the metadata ack until the last chunk is
   persisted (the spec's "ack MUST follow durable persistence" reads as
   allowing it), or is the fallback the intended answer?

4. **The desktop's `hop_submit` is unsigned.** The handoff-service checkout
   (`rpc/client.ts`) sends `hop_submit` as `[data, recipients, "0x"]` — no
   signature, no signer, no timestamp — and its download never acks
   ("claim already evicts the entry server-side"). That is an older dialect
   than the spec and than bot-core's. The sandbox node implements the spec
   (signed, five params, ack removes); a desktop build on that SDK could not
   upload to it. Is the desktop already on the signed dialect in a newer SDK,
   or should the node accept the unsigned form too (which would mean no
   Bulletin allowance check for those uploads)?

5. **RateLimited is retried once, like a cut socket.** bot-core retried only
   transport losses; the spec's error table says PoolFull (1002) and
   RateLimited (1020) mean "retry later". The fix gives them the same single
   reconnect-and-resume retry, with no backoff. Should there be a delay
   ("retry after the indicated delay") — and does the real node put that
   delay in the error data, so a client can read it?

6. **A bridge slot can over-count on the opener path.** The duplicate-answer
   race fixed in bot-core (a receive path journals a message, awaits the
   critical persist, and a settling turn pumps the entry meanwhile) had a
   sibling on the opener path: the existing `owedReplies.has &&
   !queuedOwed.has` guard stops the second brain run there, but when the
   pump got to the entry first both sides reserved bridge admission and one
   reservation is never released. Not reproduced, so not changed. Worth a
   test with the bridge brain, or is the reservation count self-healing
   somewhere I did not read?

7. **`trailing slash` on the stamped node URL.** bot-core stamps
   `new URL(BOT_HOP_UPLOAD_NODE).toString()` into the attachment, so
   `ws://127.0.0.1:5000` becomes `ws://127.0.0.1:5000/`. Harmless for the
   allowlist (a host match) and for clients (a URL). The scenario normalizes
   before comparing. Fine as is, or stamp the operator's string verbatim?

S5 self-check: sandbox 89/89 (15 scenarios), sandbox/ui 16/16, bot-core
413 pass / 5 skipped (the uid-gated `workspaces.test.mjs` cases on this
machine) on the tree before D; the D tree's numbers are in acceptance.md.
No bot, daemon, node or dev server left behind.

### Answers (owner review, 2026-09-05)

- Upload signer: per persona is right; the phone holds one Bulletin allowance
  per identity, not per device.
- ChaCha20-Poly1305 over the spec's AES-GCM: follow the deployed clients. File
  a chat-spec correction (RFC-0001 wording) rather than change the sandbox.
- Ack-before-chunks and the desktop's unsigned `hop_submit`: record as
  protocol observations; the sandbox follows the spec's signed dialect.
- RateLimited retries: keep the single retry; add a delay read from the error
  when a node provides one, else 1 s. S6 item.
- Opener-path reservation double count and the trailing slash on the stamped
  upload node: S6 items, not reproduced here.

S5 review: accepted. Merged master into the branch (Room.tsx props + S5
attachment rendering, fixture gains `bulletinAccount`). Re-run here:
sandbox 89/89 with all 15 scenarios, sandbox/ui 31/31 and build, bot-core
413/418 with 5 T3ams SDK tests skipped because `@t3ams/bcts` is not
installed in this checkout (not a regression). `attachment-to-bot` replayed
through `pcs scenario run`. `bot-core/vendor` untouched.
`test-client-device.mjs` is gone and CLAUDE.md no longer names it.

### After the review: the CI failure on the restart tests

8. **When should an answered entry leave the journal.** The fix settles
   an owed entry once its answer is on the node (the submit returned), as
   before; the answer is journaled so the crash window before that return
   is a harmless re-send. Settling on the peer's ACK instead would also
   cover a restart that replaces an un-fetched statement in the slot with
   a later message (the lane's in-memory "current" does not survive a
   restart, so the old reply is lost if the peer never fetched it). It was
   not done: the journal is the bounded budget that admits every peer's
   messages, and one peer offline for days would pin it. Is that restart
   hazard worth a separate, per-peer "un-ACKed current statement" record?

9. **A `/file` command in bridge mode never settles its owed entry.**
   bot-core answers `/file …` itself, so the message never enters the
   harness queue and no lease ACK ever removes it; `enqueueOwed` settles
   only for direct runtimes. The entry stays journaled until a restart runs
   the command again (`/file rm` then answers "No saved file exists"). With
   the answer journal, the restart now re-sends the recorded answer instead
   of re-running the command, so the visible effect is gone, but the entry
   still never leaves the journal in a bridge bot's lifetime. Not reproduced
   in a scenario; noted from reading `handleInbound`.

## S6

1. **The identity backend does not attest on the reset Paseo Next chain.**
   `GET /api/v1/attester` returns `0x86aac84d…` (`5F7H1LkZi8rn…`), whose
   `PeopleLite.AttestationAllowance` on the reset chain is 0 and whose
   balance is 0. Every account on the reset chain (2814 `Consumers`, 2814
   `LitePeople`) was attested by `5GCF223UbXNZ…` (allowance 997186), which
   looks like a batch migration (backend records updated in bulk at
   2026-09-01T09 and again at 2026-09-05T19). Live claims stay `RESERVED`:
   `shawntabrizi.02` (the owner's phone, since 2026-09-04T18:31),
   `openclawbot.19` (this session's `pca register --again --new-number`),
   `sandboxalice.41` (this session's `pcs user add alice`). Every claim a
   client signs names the attester the backend advertises
   (`consumerRegistrationSignature` covers it), so even if `5GCF…` attested
   them the on-chain check would fail. Who owns the backend's attester
   provisioning, and is `5F7H…` meant to get an allowance, or should
   `/attester` advertise `5GCF…`?

2. **A second claim after a reset cannot keep its number.** The backend
   refuses the old digits even to the account that owns them (`409
   Preferred digits 49 already taken for username openclawbot`) and keeps
   the old record `ASSIGNED` beside the new `RESERVED` one, so a bot comes
   back under a new name. Is there (or should there be) a backend path to
   re-attest an existing ASSIGNED record on a new chain, so `macbot.78`
   stays `macbot.78`?

3. **macbot's seed is not on this machine.** `~/.pca/bots/` holds
   `macbot-workspace/` (empty) and no `macbot/`; its username is ASSIGNED
   to `5DXPWoMyS7HS…` on the backend and absent on chain. Where does macbot
   live (the VPS runbook lists hermesbot, openclawbot, codebot, dotbot,
   claudebot)? `pca register macbot --again` was run on `openclawbot`
   (local, `openclawbot.49`, same situation) instead; it is now
   `openclawbot.19`, pending.

4. **Self-registration with a fee.** The research report proved
   `PeopleLite.register_with_fee` (75 PAS, no attester) on a fork; the reset
   chain has two `Fee`-method lite people. It would make personas and bots
   independent of the backend, at the cost of PAS per identity and a
   hand-encoded extrinsic (papi 3 may encode it; 2.1.7 could not encode
   `attest`). Worth a profile option, or is the backend the only sanctioned
   path?

5. **Username defaults.** A short persona name registers as
   `sandbox<name>` (`sandboxalice.41`); `--username` overrides. Fine, or
   should short names be refused so the network username is always
   chosen on purpose?

6. **`pca info` stays offline for a confirmed bot.** A live "is it still on
   the chain?" check would make `pca info paseobot` in the unit tests hit
   the real network, so the reset is only detected by `pca register <bot>
   --again` (which reads the chain first). Should `pca info` get a
   `--check` flag that reads the chain on request?

### Answers (owner review, 2026-09-05)

1. Raised with the owner; the attester `143a9g1d…` (`0x86aac84d…`) has
   allowance 0 and balance 0 on the reset chain, verified here. Until the
   backend is re-provisioned nothing on Paseo Next can be attested.
2. Unknown; ask the backend owners together with 1.
3. macbot was deleted by the owner on 2026-09-04 (`pca delete macbot --yes`
   in shell history, followed by a `pca create` that left no directory).
   Not an agent action. Re-create it once attestation works.
4. Yes, as a later option: `register_with_fee` needs 75 PAS per identity and
   a funded account; keep the backend path as default.
5. Keep the `sandbox` prefix; it marks throwaway identities on a shared chain.
6. Yes, `pca info --check`, small; S7 or later.

S6 review: accepted. Re-run here: sandbox 103/103, sandbox/ui 31/31 and
build, bot-core 415/420 with the 5 T3ams SDK skips. Live messaging on Paseo
Next is blocked by the backend, not by the sandbox.
