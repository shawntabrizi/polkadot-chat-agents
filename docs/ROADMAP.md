# Roadmap: takopi-derived features worth adopting

A fresh audit of takopi (the reference coding-agent chat bridge) against this
bot, done right after the agent-engine redesign. Everything below is filtered
through OUR transport (Polkadot statement store, 1:1 encrypted DMs) — several of
takopi's capabilities we already solve differently, and several are
Telegram-only and don't apply. This is the prioritized backlog; pick from the top.

## Already solved (do NOT re-adopt)

takopi has these; we have equivalents, often better-suited to our transport:

- **Rate-limit-aware outbox** (takopi's `outbox.py`, Telegram 429 backoff) →
  our `lib/live-reply.mjs` (escalating throttle, latest-wins coalescing) plus
  the statement store's own channel-replacement semantics (a new statement
  replaces the prior one on the channel — coalescing for free). No 429 exists.
- **Per-thread FIFO queueing** (`scheduler.py`) → our per-peer `enqueueWork`
  (serialized per peer, concurrent across peers, `WORK_CAP` backpressure).
- **Sender allowlist** (`allowed_user_ids`) → `BOT_ALLOWED_PEERS`.
- **Chat auto-resume without reply-to** (`chat_sessions.py`) → per-peer
  `peerResume`; every peer is a continuous session by default.
- **Single-instance lock** (`lockfile.py`) → the `bot.pid` O_EXCL pidfile.
- **Process-group teardown, idle handling, verbatim prompts, native resume,
  live progress** → adopted in the engine redesign.

## Not applicable (Telegram/platform-specific)

- Bot command menu (`set_my_commands`), `/trigger` mentions-only, forum topics,
  Telegram-native scheduled messages, inline control buttons — our app is 1:1
  DMs with no command-menu/mention/topic/button surface. `/stop` is our cancel
  lever instead of a button.
- Image-to-agent vision: takopi does NOT do this (it down-converts photos to
  file uploads). We already do better — attachments download to the media store
  and a claude engine can Read the file.

## Recommended, prioritized

### HIGH

1. **✅ DONE — Long-answer chunking + outbound lanes.** Investigation refined
   the premise: the statement cap is the account allowance (500 KiB for a lite
   person, `LitePersonStatementLimit`), and the sharper bug was that the store
   keeps ONE statement per (account, channel) — ANY two quick sends clobbered
   each other. Landed as: `lib/outbound-lanes.mjs` (per-peer ACK-or-extend
   statement queue mirroring the app's `OutgoingRequestQueue`, with a
   `BOT_OUTBOUND_ACK_GRACE_MS` liveness backstop) + `lib/chunk.mjs`
   (`BOT_REPLY_CHUNK_BYTES`, default 4000; paragraph/fence-aware splits) wired
   through `deliverReply` and `POST /send`.

2. **✅ DONE — Multi-project workspaces + git worktrees.**
   `pca project <bot> add <alias> <path>` registry → `BOT_AI_PROJECTS`;
   `/project <alias>[@branch]` (or bare `/<alias>`) picks the turn cwd, with
   per-branch `git worktree` isolation (`lib/workspaces.mjs`, alias/branch
   charset guards + path-escape checks). Per-peer active project persists in
   `session-state.json` (`pj`/`br`); a switch clears the resume token (tokens
   are cwd-scoped). Local `pca run` only — deployed containers can't see host
   paths (deploy-time mounts remain future work).

### MEDIUM

3. **`/file`-style workspace I/O.**
   - *In (buildable now):* copy a user-sent attachment (already downloaded to
     the media store) into the agent's workspace so the agent can act on it
     ("here's the spec, implement it"). Small.
   - *Out (blocked):* pulling a file/artifact from the workspace back to chat
     needs outbound HOP upload, which is the existing backlog item (see
     docs/DESIGN.md "sending files"). Gated on that.

4. **Per-run reasoning/effort control (`/reasoning`).** Cheap given the engine
   table: map an effort level per engine (claude `--effort`, codex
   `-c model_reasoning_effort=…`, opencode `--variant`), a `/reasoning`
   command + `BOT_AI_REASONING` default, stored per peer like `/model`. Lets a
   user dial thinking depth per conversation. Ref `commands/reasoning.py`.

5. **Usage surfacing.** The engines' result events already carry token/cost
   usage (claude/codex/opencode all report it) — neither bot exposes it. Log it
   (`BOT_AI_USAGE {tokens, cost}`) and optionally answer `/usage`. Cheap
   observability; nearly free since the data is already parsed.

6. **Input coalescing.** Debounce rapid consecutive user messages (~1s window)
   into one prompt so a user "thinking out loud" across three bubbles becomes
   one turn. Marginal for our 1:1 app (users rarely burst); do only if it
   proves annoying in practice. Ref `ForwardCoalescer`.

### LOW / audience-dependent

7. **Voice-note transcription.** High value for a mobile audience if the app
   sends voice attachments: transcribe (OpenAI-compatible API) and run the text
   as a turn. Needs a transcription dependency + key. Ref `voice.py`.
8. **`pca doctor`.** Preflight checks (identity registered, RPC reachable, CLI
   installed, key present) — ops polish. Ref `cli/doctor.py`.
9. **Steering** (inject into a running turn without cancelling). codex-app-server
   only in takopi; largely subsumed by our queue + `/stop`. Skip unless a
   concrete need appears.

## Top 5 to do, in order

1. ~~Long-answer chunking~~ ✅ done (as outbound lanes + chunking).
2. ~~Multi-project workspaces + worktrees~~ ✅ done.
3. Attachment → workspace `/file put` (MEDIUM — half-built via the media store).
4. `/reasoning` per-run effort (MEDIUM — cheap given the engine table).
5. Usage surfacing (MEDIUM — nearly free, data already parsed).
