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

## D6 — Every testnet is one row of bot-core's network table (S6b)

**Context.** S6b adds Products Devnet beside Paseo Next. Devnet's identity
backend admits a claim only with a bearer minted by proving the wallet key
(`identityRegistrationAuth: "client-proof"`); everything else differs by
endpoint only.

**Decision.** `lib/network.mjs` builds each testnet profile by one rule
from bot-core's `lib/network-config.mjs` entry — endpoints, HOP nodes,
Bulletin RPC, the allowance helper's profile id, and the registration auth
mode. The daemon has one testnet path; the only per-profile behaviour is
the auth mode, read from the table, so a third testnet is a third row.
Operator credentials for the backend (`PCA_IDENTITY_TOKEN`,
`PCA_IDENTITY_VOUCHER`) come from the daemon's environment, as for `pca`,
never from a flag or the API; the session lives in the persona's 0600
record only until the claim is in.

**The identity backend has one client.** bot-core's `lib/register.mjs`
holds the claim, the session and now the username search (paging, the
rate limit, the proof-of-compute puzzle, the chain's padded form of a
name); the sandbox's chain directory calls it rather than keeping a second
implementation of the same route — the backend is not the chat protocol
under test, so the "two implementations" rule does not apply to it.

## D7 — Registration presence is the chain's answer, never the genesis (2026-09-09)

**Context.** Products Devnet migrated on 2026-09-08 (X25519 chat keys,
refreshed pseudonym contexts; People runtime 2004003 → 2005001) and wiped
every lite-person registration **without a genesis change**:
`Resources.Consumers` went from 278 entries to a dozen, every pre-update
username is gone from `UsernameOwnerOf`. S6's reset detection keyed on the
genesis hash (`markChainReset`) and saw nothing; alice and
`sandboxechodev.90` stayed "attested" in the state dir while the chain
held nothing for them. Bulletin's authorization extent gained `extra`
(descriptors regenerated in `98a17a4`).

**Decision.** The genesis is recorded only to explain a reset. Whether a
registration exists is read back from the chain — `Consumers(account)` for
the identifier key, `UsernameOwnerOf(username)` for the name
(`lib/registration.mjs` `checkRegistration`) — on `pcs up`, on every `pcs
user list` and `pcs bot list`, and on `pcs bot attach`. A record the chain
does not hold is marked with the chain's reason; a claim the chain attested
meanwhile is promoted. Registering again goes through bot-core's
`reregisterIdentity` (the chain first, the old number first, the backend's
pick when it refuses), so `pcs user register <name>` and `pca register
<bot> --again` behave the same. bot-core's `pca info` and `pca status` make
the same one read (`registrationOnChain`) on a named profile.

`Consumers` now carries `credibility`; the directory exposes it (`pcs bot
list`, `/api/consumers/:account`, the wire labels' cache). Paseo Next's
value has the same shape (verified live), so one decoder serves both.

The community apps moved to the GitHub org
`Polkadot-Community-Foundation` (`polkadot-android-community`,
`polkadot-desktop-community`; the `paritytech` repositories are upstream).

## D8 — The message profile is Telegram's Rich Markdown, and tags are named, not parsed (2026-09-17)

**Context.** D2's pipeline rendered CommonMark and tables. An AI agent
writes more than that unprompted (task lists, LaTeX, footnotes, `<details>`,
`<sub>`), and the reference for a good bot chat, Telegram's Rich Markdown
(Bot API 10.1, `#rich-message-formatting-options`), renders all of it. A
wide table also stretched the bubble and pushed the pane off the screen.

**Decision.** `lib/markdown-rules.mjs` adds, on top of D2: `==mark==`,
`||spoiler||`, the inline tags `<u> <ins> <sub> <sup> <mark> <tg-spoiler>`,
`$…$` / `$$…$$` / ` ```math ` (KaTeX, MathML output only: no stylesheet or
font to ship, and the daemon's page gets the same markup), task lists,
`<details><summary>` blocks with markdown inside, highlighted code under a
language label and a Copy button (`highlight.js` common set), and `/command`
as a button the room sends on a tap. Four choices behind that:

- **Raw HTML stays off.** Telegram parses arbitrary HTML and keeps the tags
  it knows. Here each supported tag is recognised by name and everything
  else is text, because a parse-then-sanitize pipeline drops the `<T>` of
  `Vec<T>`, and agents write generics in prose all the time. D2's rule
  holds: a message is data, never markup.
- **Unclosed syntax is text; an unclosed `<details>` closes at the end.** A
  streamed answer is rendered many times before its last line exists.
- **The HTML is inert.** Copy and /command are attributes (`data-copy`,
  `data-command`) that the Room view acts on; the `?format=html` page shows
  the same markup with nothing wired. A spoiler opens on focus, in CSS.
- **A table scrolls in its own box** (`.md-table`, cells keep words whole
  and wrap at 32ch), the grid tracks are `minmax(0, …)`, and the
  Conversation panes are fixed at 390 × 844 so a message is judged at phone
  width. A box with more to its right fades at that edge.

**Footnotes are out, for now** (removed 2026-09-17, to be addressed later).
Telegram's Rich Markdown has them (`[^id]`), and the first cut of this
profile rendered them with `markdown-it-footnote`. They were removed for
simplicity and for a conflict: a footnote is an in-page `#` link, and
Polkadot Desktop routes with hash history, so that link navigates the app
away from the chat. They also made `render()` take a message id (anchors
must be unique when many messages share a page), which every caller then had
to thread through. No client decided how a footnote should look on a phone
either (a list at the end, or a popup on the mark). Until then the syntax is
text; a definition that is only a URL is a CommonMark link reference, so its
mark becomes a link to that URL.

Images stay links (D2). Not taken from Telegram: media blocks, collages,
maps, custom emoji, date-time entities and `<tg-button>` — buttons need a
callback content kind on the wire first. Chat-list previews and reply
quotes show `plain()`: the text without its markup, a spoiler kept shut.

`test/markdown.test.mjs` pins the HTML of every construct and of what must
not get through. An app has no HTML, so `test/fixtures/markdown-profile.json`
says the same as a neutral tree (`{ type, … }` nodes, text as strings), read
off the pipeline's output by `test/markdown-profile.mjs`. That file is the
acceptance list for the apps; its test fails when the pipeline and the list
disagree.
