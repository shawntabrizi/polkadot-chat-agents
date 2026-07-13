# Live replies: one evolving message instead of "thinking…" + answer

Status: implemented (bot-core lifecycle + bridge auto-upgrade + Hermes
`edit_message`; see "Implementation notes" at the bottom). This document keeps
the research and constraints that produced the design.

## Problem this solved

Before live replies, a slow turn produced a throwaway "thinking..." text after
`BOT_THINKING_AFTER_MS`, then the answer as a separate bubble. The thinking
message never resolved, and the conversation looked stalled between the two.
Mature bridges (Takopi, Hermes, OpenClaw, Claude's own remote surfaces) converge
on one better pattern: post a placeholder and edit it through the turn until it
becomes the answer.

bot-core now implements the Polkadot-native version. The rest of this page
records the constraints that shaped it.

## What the research established

Sources: Takopi source (`~/Documents/GitHub/takopi`), Hermes gateway source
(deployed container), OpenClaw TypeScript source (github.com/openclaw/openclaw),
the mobile app source (`polkadot-app-ios-v2`), and Anthropic's remote-session
docs. Full details in the session that produced this doc; the load-bearing
facts:

**How the app treats edits (kind 12):**
- The edit mutates the original bubble in place, live, with an "edited" badge;
  no new bubble. Out-of-order edits are safe (highest timestamp wins).
- Every edit is persisted forever and becomes a row in a user-openable
  edit-history screen. 50 streaming edits = 50 diff rows. **Edit count per
  turn must stay small.**
- Kind 12 is in the app's notifiable set, but chat pushes are sender-generated
  (via the notify relay) and the bot never calls it — so bot edits page nobody
  today. **If the bot ever gains push support, edits must be excluded.**
- An edit whose target message was never received renders nothing at all (it
  is stored but invisible; no placeholder is created).

**What edits cost on the statement store:**
- One current statement occupies each (signer, channel) slot. Before an ACK,
  bot-core can losslessly extend that statement into a superset batch; later
  messages queue behind it.
- An edit sent before the app fetched its placeholder can still replace the
  placeholder in that slot, leaving an invisible dangling edit. A bot-created
  placeholder therefore waits for its ACK before the first edit.
- Submitting faster than the app's fetch cadence is pure waste; ~one edit per
  few seconds is the useful ceiling.

**The patterns worth copying:**
- *Takopi*: instant placeholder posted as a reply, edited in place; edits are
  event-driven with latest-wins coalescing and skip-if-unchanged; header line
  `label · engine · elapsed · step N`; rolling window of the last few actions
  with status glyphs (`▸ ↻ ✓ ✗`), thinking rendered as one-line notes; all
  progress edits silent, final pings once; follow-ups queue per session.
- *Hermes*: dual-clock flush (edit when ≥0.8s elapsed OR ≥24 new chars),
  adaptive backoff on flood errors (double interval up to 10s), tool progress
  in a separate editable bubble throttled at 1.5s; **its whole streaming
  machinery activates automatically once an adapter implements
  `edit_message`**.
- *OpenClaw*: waits 5s before showing a progress draft (fast turns never see
  machinery), single-flight throttled draft loop keeping only the newest text,
  transient progress draft strictly separated from final block delivery,
  everything gated on a `supportsEdit` capability flag.
- *Claude remote*: always show what's happening now; stream, don't batch;
  collapse detail, surface decisions; notify only on completion/blocked.

## Implemented design

### Turn lifecycle (bot-core, all brains)

```
t=0     inbound message ACKed (existing), brain starts
t<5s    brain finishes fast -> ONE normal message, no machinery (most turns)
t=5s    placeholder sent: the configured BOT_THINKING_TEXT
        -> record its messageId + requestId, await the app's session ACK
ACKed   edits unlocked
t=5s+   heartbeat and tool progress may edit it to: "⏳ working · 24s · step 3
                                  ▸ reading the docs you sent
                                  ▸ searching my notes"
done    final edit: placeholder becomes the answer text (spinner dropped)
error   final edit: placeholder becomes the error/apology
```

- The 5s delay is OpenClaw's insight: fast turns (the majority) should never
  see progress machinery. It reuses the existing `thinkingAfterMs` knob.
- The final answer **edits the placeholder** rather than being a new message.
  (Takopi deletes the placeholder and sends the final fresh so Telegram pings
  once — but our protocol has no delete, and bot messages don't push today, so
  edit-in-place avoids a leftover progress bubble and costs nothing.)
- If the placeholder is never ACKed (app offline), skip all progress edits and
  send the final as a plain message: it simply replaces the unfetched
  placeholder in the channel slot — clean degradation, user sees only the
  answer.
- Long answers: first chunk edits the placeholder, remainder as follow-up
  messages, split on paragraph boundaries (re-open code fences across splits).
  Implemented: `lib/chunk.mjs` (`BOT_REPLY_CHUNK_BYTES`, default 4000) splits;
  the parts ride the per-peer outbound lane (`lib/outbound-lanes.mjs`) so they
  arrive in order and never clobber each other in the channel slot.

### Edit cadence (protocol guardrails, enforced in bot-core)

- Min interval between edit submits for one target message: **3s** (config
  `BOT_LIVE_EDIT_MIN_MS`), latest-wins coalescing (a newer frame replaces the
  queued one), skip-if-unchanged. The interval doubles every three edits up to
  `BOT_LIVE_EDIT_MAX_MS` (15s by default); there is no fixed edit-count cap.
- Bot-created placeholders are gated on their own ACK. A bridge edit of an
  existing message is treated as already deliverable, so its lane is throttled
  but does not wait for a new ACK.

### Implementation

1. **Outbound ACK tracking:** outbound lanes resolve a submitted request once
   the matching session response arrives. Live placeholders use that signal to
   unlock edits.
2. **Live-message outbox**: per-peer single-flight editor with the throttle,
   coalescing, and ACK gate above. `sendMessage` and the bridge both
   route edits through it.
3. **Thinking-ack replacement**: `armThinking` sends the placeholder via the
   outbox and hands the turn a live-message handle; direct brains finish by
   editing it (or sending plain if no placeholder was needed).

### Bridge surface (harnesses)

- `POST /send { chat_id, text, edit_of }` already exists; edits now pass
  through the outbox (throttled/coalesced; bot-created placeholders are
  ACK-gated — harnesses may fire at Hermes' native 0.8s cadence and bot-core
  down-samples safely).
- `GET /health` advertises
  `live: { supportsEdit: true, minEditMs, placeholderAfterMs }` so adapters can
  gate features.

### Framework behavior

- **bot-core lifecycle:** direct brains and harnesses get a placeholder that
  becomes a final edit for slow turns; error states resolve it too.
- **Hermes:** its adapter implements `edit_message` through `/send` plus
  `edit_of`, so Hermes can stream progress while bot-core applies the safe
  cadence.
- **OpenClaw:** its channel currently sends plain replies only. Its first plain
  send still auto-upgrades the bot-core placeholder into the final answer, but
  it does not expose native edit streaming yet.
- **Direct brains:** stream-json tool actions become the short progress lines
  shown above.

## Failure modes addressed

- Thinking message that never resolves — placeholder always
  reaches a terminal state (answer, error, or timeout text).
- App offline mid-stream — channel replacement converges to the latest frame;
  un-ACKed placeholder degrades to a plain final message.
- Harness spamming edits — bot-core outbox throttles and coalesces.
- Edit-history bloat — escalating cadence and latest-wins coalescing reduce
  intermediate frames, though there is not yet a fixed per-turn count cap.
- Push spam — non-issue today (bot sends no pushes); documented as a guard for
  the day push support lands.

## Long-term: notify-on-final (blocked on protocol support)

Takopi's default is the better end state: progress stays silent, the FINAL
answer arrives as a fresh message that pings the user once, and the
placeholder is deleted. We cannot do that today — the protocol has no message
delete, and the bot does not send push notifications at all (pushes are
sender-generated via the notify relay). When either lands, revisit:

- bot gains push support -> keep final-as-edit but have the bot call the
  notify relay once per turn (for the final only; edits must stay excluded
  from notification or streaming breaks).
- protocol gains delete -> full Takopi pattern becomes available: delete the
  placeholder, send the final fresh (new bubble, one ping, no "edited" badge,
  no edit-history residue).

## Explicitly out of scope

- Typing indicators (no protocol surface), message deletion (no kind),
  inline buttons/cancel controls (no protocol surface — `/stop` command is the
  nearest equivalent), per-token streaming (edit-history + cadence constraints
  make it net-negative on this transport).

## Implementation notes

- `bot-core/lib/live-reply.mjs` — the outbox: ACK gate, escalating throttle
  (`BOT_LIVE_EDIT_MIN_MS` doubling every 3 edits up to `BOT_LIVE_EDIT_MAX_MS`),
  latest-wins coalescing, skip-identical, finalize-as-edit with plain-message
  fallback (`BOT_LIVE_FINAL_ACK_WAIT_MS`), harness edit lanes. Progress
  renderer: `⏳ working · 24s · step 3` + rolling `▸ action` lines.
- `bot-core/index.mjs` — placeholder lifecycle in `armThinking`/
  `deliverToChat`/`beginTurnProgress` (the direct-engine brain reaches these
  through the agent runtime's `chat` surface), heartbeat frames
  (`BOT_LIVE_HEARTBEAT_MS`), tool events as progress lines
  (`BOT_LIVE_PROGRESS=0` disables tool-action frames), bridge auto-upgrade (first plain
  `/send` finalizes the open placeholder; a `reply_to`/`edit_of` send retires
  it to `✓`), `edit_of` routed through the throttled lane, `/health.live`
  capability advertisement. The peer's session-response ACKs are consumed by
  the outbound lanes (`lib/outbound-lanes.mjs`); live replies gate edits on
  the lane's per-message `delivered` promise.
- Hermes adapter implements `edit_message`, which switches on Hermes's own
  progressive streaming; bot-core down-samples its ~0.8s edit cadence.
- OpenClaw needs no plugin change: its first block send is auto-upgraded.
  (Its native draft/edit streaming interfaces are not exposed to simple
  chat-channel plugins — revisit if that SDK surface appears.)
- The mobile-app-shaped test client ACKs bot requests (`--no-ack` to simulate
  an unreachable peer); e2e covers the full lifecycle, the no-ACK fallback,
  and bridge auto-upgrade + throttled harness edits.
