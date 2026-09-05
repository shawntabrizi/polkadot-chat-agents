# Decisions

Design choices made while building the sandbox, with the evidence that
drove them. One entry per decision; newest last.

## D1 — An empty initial dump is one empty page, not silence (S2)

**Context.** The S0 review (questions.md, S0 answer 2) concluded from
`substrate/client/rpc/src/statement/mod.rs` (`send_in_chunks` breaks on an
empty chunk) that the real node sends *no* `newStatements` event when a new
subscription matches nothing, so bot-core's poll sweep — the SDK's
`getStatements`, which resolves only on a page with `remaining` 0 or absent
— would hang until `BOT_QUERY_TIMEOUT_MS`. S2 was to make the node faithful
(send nothing) and fix bot-core's sweep.

**Evidence.** The empty page is sent one layer below the RPC. In the
polkadot-sdk checkout (`99c8ed2a2fea`, 2026-07-30),
`substrate/client/statement-store/src/lib.rs`, `Store::subscribe_statement`:

```rust
if existing_statements.is_empty() {
    subscription_sender
        .send_blocking(StatementEvent::NewStatements { statements: vec![], remaining: Some(0) })
        .ok();
}
Ok((existing_statements, subscription_sender, subscription_stream))
```

`subscription_stream` is what the RPC pipes to the client
(`PendingSubscription::from(pending).pipe_from_stream(subscription_stream, ..)`),
and `send_in_chunks` writes into the same `subscription_sender`. So the client
receives exactly one `{ statements: [], remaining: 0 }` page and then live
pushes. `git log -S'existing_statements.is_empty()'` dates the block to PR
#11139 (2026-02-24, "make subscription return statement event instead of
bytes") — the same change that introduced the `remaining` field and the
`newStatements` event shape the SDK decodes. No node that speaks the event
format lacks the empty page.

**What depends on it.** More than the sweep: `createSession`'s `init()` in
`@novasamatech/statement-store` awaits `queryStatements` on the session's own
outgoing topic before activating, and that topic is empty for every new chat.
Making the sandbox node silent on an empty dump stalled every persona
session at init (sandbox e2e and cli tests went red the moment it was tried,
2026-09-05). Polkadot Desktop and the web client run on the same SDK against
real nodes, which is consistent with the source: the page is sent.

**Decision.** The store node keeps the S0 behaviour (one empty page,
`remaining: 0`). bot-core's sweep needs no change; the "empty-dump sweep
timeout" is not a defect. The S0 answer is corrected in questions.md (S2).

**If a deployed node ever sends nothing.** The clean bot-core fix is known
and was not applied: include the bot's own heartbeat topic in every filter it
opens (sweep batches and subscription groups), since the heartbeat statement
is always in the store (one channel slot, never expires). Every dump then has
at least one statement, a page with nothing routable is the empty result,
and a timeout means the node is down — a strictly better signal than today's
"empty or down?" ambiguity. It stays unapplied because the premise is false
for every node that speaks the event format.

## D2 — One markdown pipeline, sanitized, images as links (S4)

**Context.** The Room view and the daemon's `?format=html` route must show
a message identically, and a message is data from a peer, never markup.

**Decision.** `sandbox/lib/markdown.mjs`, plain ESM imported by both the
Vite app and the daemon: markdown-it with `html: false` (raw HTML is
escaped text), `linkify: true` (a bare URL is a link, as the phone shows
it), `breaks: true` (a newline in a chat message is a line break); every
link gets `target="_blank" rel="noopener noreferrer"`; an image token
renders as a link to its URL (the viewer never fetches a URL a message
names); the result goes through DOMPurify bound to the caller's window —
the browser's in the app, a jsdom window on the daemon, made on first use
because `pcs` imports the API module on every call. `test/markdown.test.mjs`
pins the exact HTML of every construct the task named and of the three
things that must not get through (a script tag, a `javascript:` link, raw
HTML with a handler). `test/room-html.test.mjs` proves the route's body is
byte-for-byte the pipeline's output.

## D3 — The UI talks under `/api`; the daemon serves the built app (S4)

**Context.** The UI needs live reload during work and a single origin when
deployed, and it must never hold a second copy of the API's semantics.

**Decision.** The daemon strips a leading `/api` before routing (so
`pcs`, the tests and the UI hit one table), and serves `sandbox/ui/dist` at
`/` when the build exists (files under the directory only; the API's paths
win). `npm run dev` in `sandbox/ui` proxies `/api` to a daemon
(`PCS_URL`, default `http://127.0.0.1:7788`), SSE included. The UI is one
`EventSource` on `/api/events`; every screen refetches on the events that
concern it and nothing polls.

## D4 — One API prefix (S5)

**Context.** D3 accepted every route both bare (`/personas`, used by `pcs`,
the tests and bot-core's sandbox directory client) and under `/api` (used
by the UI). Two spellings of one table invite drift, and the bare paths
shadowed the built UI's static files. S4 answer 6 asked for one prefix.

**Decision.** The daemon answers only under `/api`; a request outside it is
a static file of the built UI or a 404. `pcs`, the scenario client, the
tests, `sandbox/ui/e2e/acceptance.mjs` and bot-core (`lib/people-directory.mjs`,
`pca create --network sandbox`'s `GET /api/node`, the transport e2e's
registration) all call `/api/...`. Clients that take a route relative to the
API root (`sandbox.get("/personas/alice")` in a scenario, `api.ts` in the UI)
keep their short form; the prefix is added in one place per client.

## D5 — The paseo profile is the same daemon with three seams swapped (S6)

**Context.** PLAN.md S6: the sandbox on the real Paseo Next network, so
personas chat with deployed bots and with a phone; `mock` unchanged.

**Decision.** One daemon, one API, one CLI; the network is a profile
(`lib/network.mjs`, endpoints from bot-core's `lib/network-config.mjs`
PASEO entry) that swaps three seams:

- *statement store*: the SDK's adapter over `createLazyClient(getWsProvider
  (peopleEndpoints))`, as on the mock, only the URL differs;
- *directory*: `lib/chain-directory.mjs`, `Resources.Consumers` and
  `UsernameOwnerOf` through the sandbox's own papi (the unsafe api, no
  descriptors: two storage reads do not justify a second descriptor set
  and a papi-version coupling with bot-core), plus the identity backend's
  `GET /api/v1/usernames?prefix=` with every hit checked against the chain;
- *HOP*: the profile's Bulletin HOP node, the persona's upload signer
  provisioned through bot-core's `lib/testnet-file-allowance.mjs`.

Registration reuses bot-core's `lib/register.mjs` (the one place personas
import bot-core's crypto: `deriveIdentityKeys` gives the persona the same
//wallet pair and X25519 key the claim publishes). Every directory read is
async on both profiles (the mock's resolve at once); the wire inspector's
labels come from a synchronous cache of what the sandbox has seen.

**The wire on a real network** is `lib/seen-store.mjs`: the statements the
personas' clients submitted or received, mirrored from the papi client the
SDK talks over (never from the SDK itself), kept in the store node's
read-side shape so `pcs wire --decode` and the inspector are unchanged.

**Refusals, not modes.** Faults, the clock, node restarts and the pool view
answer `409` off-mock; nothing is emulated.
