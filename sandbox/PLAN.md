# polkadot-chat-sandbox — build plan

A local replica of the Polkadot chat network with every participant under our
control. No phone, no testnet, no identity backend, no proofs. Driven from a
terminal by an agent and from a browser by a person, over one control API.
bot-core plugs in as one more client and gets tested against an independent
implementation of the same protocol.

Status: goals and scope agreed 2026-09-05. Lives in this repo under `sandbox/`.
Plain Node ESM, no build step, like bot-core. The web UI is a small Vite app
under `sandbox/ui/` with its own build, like `docs/`.

## Goals

1. Run the whole network locally: statement store, the People-chain state the
   clients read, and the identity backend's username service.
2. Mint and register any number of users ("personas"), each with one or more
   devices, and drive them by command: request, accept, decline, send text,
   reply, react, edit, leave.
3. See the wire: every statement with its topic, channel, signer, expiry,
   decrypted payload where the sandbox holds the key, and its fetch/ACK state.
4. Break things on purpose: drop or delay statements, hold subscription dumps,
   kill and restart the node, move the clock past expiries.
5. Attach a bot-core bot unchanged (`pca ... --network sandbox`) and run
   scripted scenarios against it as tests.
6. A web UI on the same API, for message rendering (markdown and friends) and
   richer interactions, plus a wire inspector.

## Non-goals (v1)

- Pairing with a phone. Personas are minted locally.
- Device-sync over WebRTC, calls, Coinage.
- HOP attachments. That is v1.5, after the text path is proven.
- Pointing personas at a real testnet. The engine is a real client, so this is
  possible later, but registration there needs the real proof path.

## Design rules

- **Personas do not use bot-core's transport.** They use
  `@novasamatech/statement-store` and `@novasamatech/host-chat`, the SDKs
  behind Polkadot Desktop. Two independent implementations check each other.
  A bug shared by both would be invisible, so never "fix" a persona by
  importing from `bot-core/`.
- **One daemon owns all state.** The CLI (`pcs`) and the web UI are thin
  clients of its HTTP/WS API. The CLI prints JSON with `--json`, which is the
  default when stdout is not a TTY.
- **The mock node must behave like the real one** on the rules the protocol
  depends on: one statement per (signer, channel); replacement only by a strictly
  higher expiry (equal is rejected, `channelPriorityTooLow`); `noAllowance` for unregistered signers; per-account statement
  allowance; subscription initial dump then live pushes; `remaining` paging.
  Pin it with golden vectors (see References).
- **Fault injection is a first-class API**, not test-only hacks, so the UI can
  show it and scenarios can script it.
- Small helpers over abstractions. Comments explain why, usually a protocol
  fact. JSON-line logging via `log(event, extra)` like bot-core.
- Never log or persist a secret outside the sandbox state directory, which is
  0600 and gitignored. Sandbox seeds are still secrets: a persona could be
  pointed at a real network later.

## Architecture

```
sandbox/
  daemon.mjs           starts everything: store node, directory, personas, API
  cli.mjs              `pcs` — thin JSON client of the API
  lib/
    store-node.mjs     statement-store node (moved from bot-core/test, extended)
    directory.mjs      "chain state": accounts, usernames, identifier keys, allowances
    persona.mjs        one user: identity keys, devices, contacts, requests, rooms
    device.mjs         one device: statement account, X25519 key, sessions, subscriptions
    requests.mjs       chat-request topics, send, subscribe, validate (port of web M2)
    chat.mjs           identity channel + multi-device session + content mapping (port of web M3)
    api.mjs            HTTP + WS control API, event stream
    faults.mjs         drop/delay/hold/clock controls, applied inside store-node
    state.mjs          persistence of personas and node contents (optional)
  scenarios/           scripted sequences, runnable as tests
  test/                unit and scenario tests (node --test)
  ui/                  Vite app: personas, rooms, message rendering, wire inspector
  fixtures/            golden vectors (iOS topic vectors, chat-v2 conformance)
```

Control API, one process, default `http://127.0.0.1:7788`, every route
under `/api` (S4 answer 6; the bare paths were dropped in S5):

| area | calls |
|---|---|
| node | `GET /node` (url, stats), `GET /wire?topic=&signer=&peer=` (decoded statements), `POST /node/restart` |
| directory | `GET/POST /accounts`, `POST /accounts/:id/register` (username, identifier key, allowance), `GET /consumers/:account` (what bot-core reads) |
| personas | `POST /personas` (name, devices), `GET /personas/:name`, `POST /personas/:name/devices` |
| requests | `POST /personas/:name/requests` (to), `GET /personas/:name/requests`, `POST /personas/:name/requests/:id/accept|decline` |
| messages | `POST /personas/:name/rooms/:peer/messages` (text, replyTo, edit, react), `GET /personas/:name/rooms/:peer` (messages with status), `POST .../read` |
| faults | `POST /faults` (kind, match, count), `DELETE /faults/:id`, `POST /clock` (offset) |
| events | `GET /events` (WS or SSE): every state change and every wire event |
| scenarios | `POST /scenarios/run` (file), `GET /scenarios/:run` |

`pcs` mirrors it one to one:

```
pcs up [--dir ~/.pca/sandbox/default] [--port 7788]
pcs user add alice [--devices 2]        # mint + register
pcs user list
pcs request alice bob                    # alice opens a chat with bob
pcs requests bob                         # pending for bob
pcs accept bob <id> | pcs decline bob <id>
pcs send alice bob "hello" [--reply <msgId>] [--device 2]
pcs react alice bob <msgId> 👍 | pcs edit alice bob <msgId> "text"
pcs inbox bob [--peer alice] [--unread]
pcs wire [--peer alice] [--signer <acct>] [--raw]
pcs fault drop --from alice --count 1 | pcs fault hold-dump --for bob | pcs fault clear
pcs clock +2h | pcs node restart
pcs bot attach <pca-bot-name>            # registers the bot's account in the directory
pcs scenario run scenarios/echo-roundtrip.mjs
pcs events                               # tail the event stream as JSON lines
```

## bot-core changes

bot-core reads two things from the network that the sandbox must provide:
the statement store (already an arbitrary endpoint via `BOT_ENDPOINT`) and
People-chain state (`Resources.Consumers` for identifier keys in `index.mjs`;
`Resources.UsernameOwnerOf`, `System.Number`,
`TransactionStorage.Authorizations` in `cli.mjs`).

- Add a **people-directory seam**: `bot-core/lib/people-directory.mjs` with
  `createChainDirectory(peopleApi)` and `createSandboxDirectory(url)`, both
  exposing `identifierKeyFor(account)` and `usernameOwner(name)`. `index.mjs`
  and `cli.mjs` call the seam, never papi directly. This replaces the
  `BOT_PEER_IDENTIFIER_KEYS` pin list in the e2e tests.
- Add a **`sandbox` network profile** in `lib/network-config.mjs`
  (`ws://` allowed, `BOT_SANDBOX_URL` for the directory). `pca create --network
  sandbox` registers through the directory instead of the bandersnatch proof
  and identity backend. `pca info`, `run`, `status` work as today.
- **Move `test/mock-statement-node.mjs` into `sandbox/lib/store-node.mjs`**
  and import it from bot-core's e2e test. One node implementation, extended
  once. Same for `mock-hop-node.mjs` in v1.5.
- **Retire `test-client-device.mjs` in favour of `pcs`** once S2 proves parity.
  It has a known bug: it keys the multi-device envelope by the bot's identity
  account, not the device account from `deviceChatAccepted`, so a peer whose
  device account differs from its identity account cannot decrypt its
  follow-ups. Do not fix it twice.

Per this repo's rules, these are replacements, not modes layered on top.

## Milestones

Each ends with a commit, `npm test` green in both `bot-core/` and `sandbox/`,
and the acceptance check recorded in `sandbox/docs/acceptance.md`.

### S0 — Store node and scaffold

- `sandbox/package.json`, `node --test` wiring, `.gitignore` for state dirs.
- Move the mock node to `sandbox/lib/store-node.mjs`; bot-core e2e imports it.
- Extend it: expiry and priority replacement rules (strictly greater replaces), `noAllowance` for signers
  not in an allowance set, per-account statement count limit, `remaining`
  paging on initial dumps, a decoded read-side (`list({topic, signer,
  channel})`) for the inspector, and fault hooks (`drop`, `delay`, `holdDump`,
  `clock`).
- Known-answer tests for the replacement rules taken from
  `docs/explanation/protocol.md` and the SDK's error types in
  `statement-store/src/adapter/rpc.ts` (data too large, expiry too low,
  account full, no proof, bad proof).
- Acceptance: `bot-core` `npm test` passes unchanged against the moved node.

### S1 — Directory, personas, text between two personas

- `directory.mjs`: accounts with username, RFC-0004 identifier-key container,
  allowance; `register` grants the allowance set the node checks.
- `persona.mjs` and `device.mjs`: identity from a random seed, identity chat
  X25519 key, N devices each with sr25519 statement seed and device X25519
  key. Each device runs its own subscriptions.
- `requests.mjs` and `chat.mjs`: port from
  `~/Documents/GitHub/polkadot-chat-web/src/domain/{requests,chat,identity}`
  to `.mjs`. Keep the tests; they run on the SDK's in-memory adapter.
- `daemon.mjs`, `api.mjs`, `cli.mjs` for the calls above except faults and
  scenarios.
- Acceptance: `pcs user add alice`, `pcs user add bob --devices 2`,
  `pcs request alice bob`, `pcs accept bob`, `pcs send alice bob hi`,
  `pcs inbox bob --device 2` shows the text delivered and ACKed;
  `pcs wire --peer alice` shows the statement on bob's per-device channel.

### S2 — bot-core attached

- The people-directory seam, the `sandbox` network profile, `pcs bot attach`.
- Scenario `scenarios/echo-roundtrip.mjs`: alice opens a chat with an echo
  bot, sends a follow-up from device 2, reacts, replies, edits; assert the
  bot's answers land on every device and every request was ACKed.
- Scenario `scenarios/bot-restart.mjs`: kill the bot mid-conversation, restart
  with the same state dir, assert no duplicate and no lost reply (the
  CLAUDE.md session-rebuild invariant).
- Acceptance: both scenarios pass under `node --test` in `sandbox/` and are
  wired into CI next to bot-core's tests.

### S3 — Faults, clock, invariants

- `faults.mjs` and `POST /faults`, `POST /clock`, `POST /node/restart`.
- Scenarios for each invariant in `CLAUDE.md`: ACK-or-resend under a dropped
  ACK; a poisoned statement in a batch does not block the rest; a direct
  submit on a request channel clobbers the un-fetched slot (negative test on
  the node, proving why outbound lanes exist); polling every device session;
  expiry passing while a message is queued.
- Wire inspector complete: decoded payloads for every key the sandbox holds,
  ACK state, replacement history per channel.

### S4 — Web UI

- Vite app under `sandbox/ui/`: persona switcher, rooms, message list with
  markdown rendering (inline and block, sanitized), reply, react, edit,
  requests screen, and a wire inspector view with fault controls.
- Reuse the screens from `polkadot-chat-web/src/ui` where they fit; drop the
  Pair screen.
- Acceptance: a bot answering with a table and a code block renders correctly;
  an agent can fetch the rendered HTML of a room via `GET /personas/:name/rooms/:peer?format=html`.

### S5 (v1.5) — HOP attachments

- Move `mock-hop-node.mjs` into the sandbox, add `hop_submit`, `hop_claim`,
  `hop_ack`, Bulletin allowance stand-ins, `pcs send --attach`, and the bot
  file-delivery scenarios.

## References

| topic | read first |
|---|---|
| protocol facts bot-core depends on | `docs/explanation/protocol.md`, `CLAUDE.md` invariants |
| spec | `~/Documents/GitHub/chat-spec/base-spec.md`, `mds.md`, `rfcs/rfc-0004-*` |
| SDK sessions and adapter | `node_modules/@novasamatech/statement-store` (source: `paritytech/triangle-js-sdks`), especially `session/multiDeviceSession.ts`, `session/core.ts`, `adapter/rpc.ts` |
| existing mock node and e2e harness | `bot-core/test/mock-statement-node.mjs`, `bot-core/test/transport.e2e.test.mjs` |
| persona engine to port | `~/Documents/GitHub/polkadot-chat-web/src/domain/{requests,chat,identity,contacts}` and their specs |
| golden vectors | iOS topic vectors in `polkadot-chat-web/src/domain/requests/topics.spec.ts`; `useragent-kit/conformance/chat-v2-golden.json` (private repo, copy into `sandbox/fixtures/` with a source note) |
| how the apps really send | Android `feature/chats` in `~/Documents/GitHub/polkadot-app-android-v2`; the HOP upload path in `polkadot-desktop/src/domains/chat/p2p/file-transfer/gateway.ts` and `triangle-js-sdks/packages/handoff-service` (`bot-core/test-client-device.mjs` was retired in S5) |

## Known traps

- papi probes `rpc_methods` and opens a `chainHead_v1_follow` on connect and
  treats an error as a dead endpoint. The mock node already answers those;
  keep that behaviour when extending it.
- The real node only pushes a statement when it first appears on a topic.
  A channel replacement is not re-broadcast reliably. Model that: pushes on
  first appearance, and let clients poll via a fresh subscription's dump.
- The phone answers a bot-initiated request on the identity session and sends
  text on the multi-device session. Personas must do the same or bot-core is
  tested against the wrong peer.
- Identifier keys on chain are the 65-byte container `0x00 || pk || pad`; the
  SDK unwraps it, bot-core has its own decoder. The directory stores the
  container so both sides read what they would read on chain.
