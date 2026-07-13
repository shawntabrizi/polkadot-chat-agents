# Chat feedback for the Polkadot app team — from the AI-agent frontier

We run AI coding agents (Claude Code, Codex, opencode, and agent frameworks)
as chat peers in the Polkadot app, over the statement-store chat protocol
(this repo). Agents are the most demanding chat participant that exists: they
produce long, structured, formatted answers; they stream progress; they send
and want to receive files; and they answer within seconds at any hour. That
makes them a great stress test of the chat surface — everything below comes
from things our bots actually do today and where the app or protocol limits
them.

Sources cross-referenced: the protocol spec (`paritytech/chat-spec`
`base-spec.md` v0.16 + `mds.md` v0.2), its open RFC PRs (#3 = RFC-0001 file
transfer, #4 = RFC-0002 message compaction), and the iOS PAPP v1 Q3 scope
(July 2026). Items already planned are marked — this document asks for what
is *missing*, not what is in flight.

Layer legend: **App** = client rendering/UX, **Spec** = `chat-spec` change,
**Runtime** = chain/backend/infra.

---

## 1. Markdown rendering (App + small Spec fix) — the headline ask

**Today.** Every AI model emits markdown by default: bold, headings, bullet
and numbered lists, tables, inline code, fenced code blocks, links. The spec
already carries it — `RichTextContent.text` is annotated "markdown based
text" (kind 15) — but the iOS app renders the string as plain text. Users see
literal `**bold**`, `| tables |` and triple-backtick fences. We can strip
markdown bot-side, but that produces strictly worse answers (a diff or a
table has no good plain-text form), and it throws away structure the model
produced for a reason.

**Ask (App).** Render a markdown subset in chat bubbles, in rough priority
order of what agents emit:

1. Inline: bold, italic, `inline code`, links (with confirmation on tap).
2. Fenced code blocks: monospace, horizontally scrollable, a copy button,
   optional language tag display. For a coding agent this is the single
   highest-value item after plain bold.
3. Lists (bulleted, numbered) and block quotes.
4. Headings (rendered as bold is fine).
5. Tables — hardest to render on narrow screens; a scrollable monospace
   fallback is acceptable.

**Ask (Spec).** `RichTextContent.text: String? // markdown based text` is the
entire definition. Pin it down: which dialect (CommonMark subset is the
obvious choice), which features receivers MUST render vs MAY degrade to
plain text, and the degradation rule (show raw text, never drop content).
Without this, two clients will disagree about what a message looks like.

**Status: not in the v1 backlog.** Nothing in the Q3 scope covers message
rendering.

## 2. Streaming answers pollute edit history (App, then Spec)

**Today.** Slow agent turns post a placeholder ("thinking…") and edit it in
place with progress lines until the final answer replaces it — the same
edit-in-place trick every AI chat product uses. The protocol supports this
well (edits carry full replacement text). But the app records **every edit as
a row in the message's edit-history screen**, so a 60-second agent turn
leaves ~6 junk history entries ("⏳ working · 24s · step 3 …"). We already
throttle edits hard (3s minimum, escalating to 15s) mostly because of this.

**Ask (App).** Collapse or cap self-edit history for rapid successive edits,
or show history only for the final-vs-first delta.

**Ask (Spec, later).** Consider an explicit "ephemeral/draft" flag on
`EditContent` (or a new content kind) meaning "this revision is transient —
render it, don't archive it". That would let streaming clients update at
typing speed instead of protocol-etiquette speed.

**Status: not planned.**

## 3. Sending files from a bot (Runtime + Spec) — transport works, provisioning is missing

**Today.** Bot-core now sends files: it performs HOP `hop_submit`, encrypts
chunks under a fresh ticket, signs with the app-compatible
`//allowance//bulletin//chat` account, and embeds the reference in rich text.
The remaining operator gap is storage provisioning. The deployed bot seed can
derive and use that signer, but cannot create an allowance by itself: the
People-chain `Resources.claim_long_term_storage` call carries a current
`AsResources(ClaimLongTermStorage)` Bandersnatch person proof derived from the
original mnemonic, not from the deployable mini-secret.

**Ask (Runtime).** Publish the supported bot/operator flow: a read-only
Bulletin allowance query, then an explicit local, mnemonic-held claim flow (or,
preferably, an owner-to-bot storage delegation mechanism). It should describe
expiry, renewal, status, HOP endpoint selection, and what capacity each claim
actually grants. Bots must not need person-proof material on a VPS just to send
a file.

**Related, planned — but neither covers this.** RFC-0001 (spec PR #3:
versioned pool blobs, inline small files, `bitswap_v1_get` fallback after
HOP's 24h retention) and backlog #26/#27 improve the *format and download*
side; both assume the sender can already upload. **Endorsed; please land
them.** But note the dependency this creates: RFC-0002 (message compaction)
overflows a sender's message backlog to a HOP upload — so once it lands,
upload allowance stops being a "file feature" and becomes a prerequisite for
*basic messaging under backlog*. The operator allocation/delegation path should
be solved before or with RFC-0002, not after.

## 4. Push notifications for bot replies (Runtime + Spec)

**Today.** The spec's push flow (`notify(peer.pushToken, encrypted, PushId)`,
Appendix B) assumes the sender is an app that received the peer's push token
and can reach the push backend. A headless bot has neither documented: how a
non-app sender obtains/uses a peer's push token, and whether the notification
backend accepts submissions from arbitrary (bot) identities, are unspecified.
Net effect: a user asks the agent a slow question, locks their phone, and
never learns the answer arrived. This is the single biggest UX gap for the
"ask your agent something and walk away" flow.

**Status: partially planned.** Backlog #16 reworks push for Identity Backend
v2 ("should be smart contract … validator should limit the notifications").
**Ask:** include headless/bot senders in that design explicitly — rate-limited
push submission for registered lite persons — and specify the token-exchange
step in the spec (today it's one sentence: "peers exchange their respective
push tokens").

## 5. Statement size and allowance floors (Spec + Runtime) — publish the numbers

**Today.** The spec suggests 4 KB per statement (SHOULD); the current
people-chain runtime grants a lite person 500 KiB / 50 statements; and the
backlog (#23) says these raised limits "would need to be turned down" for
release. Bot operators need to size message chunking against a *guaranteed*
floor, not the current test-net generosity. (Our bots split long answers at
4,000 bytes and always keep exactly one statement per channel slot, per the
spec's extend-the-current-request rule — so we're compatible with a
turn-down, but only because we guessed conservatively.)

**Ask (Spec/Runtime).** Publish the post-release per-statement and
per-account (count + total bytes) floors as normative numbers in the spec,
and treat them as a compatibility promise. If the answer is "4 KB per
statement", say so in MUST language.

**Related, planned.** RFC-0002 message compaction (spec PR #4, backlog #23)
solves the offline-backlog half of this — undelivered messages overflow to a
HOP batch behind a fixed-size reference. From our experience building the
sender-side equivalent (bounded outbound queue with batch extension), this
RFC addresses a real problem and the design is right. **Endorsed.** Note it
also fixes "a single message larger than the statement limit is rejected
outright", which matters for agents even when the peer is online.

## 6. Message lifecycle gaps: delete, typing (Spec + App)

- **No delete/unsend.** `MessageContent` has no delete kind (kinds 0–18
  checked, v0.16). Agents occasionally need to retract (wrong-chat, oversized,
  or superseded content); humans want it too. The serverless design splits
  the semantics cleanly into a strong path and a cooperative path, and the
  spec should define both:
  - *Undelivered — real deletion.* While a message sits in the sender's
    outstanding request statement, the sender can re-submit the channel slot
    without it (channel replacement), removing the ciphertext from the store
    entirely — the recipient never sees it. The spec should bless this: a
    delete of an un-ACKed message MUST drop it from the outstanding request.
    (The sender can't distinguish fetched-but-not-ACKed, so UX says "probably
    never seen", not "certainly".)
  - *Delivered — cooperative tombstone.* Once fetched and decrypted, the
    plaintext lives in the peer's local database; deletion becomes a
    `deleted(messageId)` content kind that a compliant client honors:
    receiver MUST tombstone ("message deleted"), MUST propagate the tombstone
    across its own devices via mds, SHOULD collapse the message's edit
    history. Same trust-the-client model as Signal/WhatsApp delete-for-
    everyone and Matrix redactions — E2EE forces it regardless of transport.
  - *Honesty requirements.* Statements are publicly readable ciphertext until
    they expire or are replaced (a copied blob can't be recalled, and the
    static session keys mean deletion is not forward secrecy); the push
    payload already carried the content; and the counterparty may run a
    non-compliant client. UX MUST present delete-for-everyone as a request,
    not a guarantee. The serverless upside deserves stating too: statements
    expire and there is no server archive, so once both clients comply the
    message exists nowhere legitimate.
- **No typing/working indicator.** There is no presence or typing signal in
  the protocol. We simulate "the agent is working" with placeholder edits,
  which costs statements and edit-history rows (see §2). A lightweight,
  non-persisted signal kind (explicitly excluded from history and dedup-safe)
  would serve both humans and bots. This is a nice-to-have; the placeholder
  workaround is acceptable.

**Status: neither is planned.**

## 7. Bot registration without a centralized verifier (Runtime)

**Today.** To be messageable at all, a bot account must appear in
`Resources::Consumers` with an identifier key, which requires lite-person
attestation through Parity's identity backend. It works (this repo automates
it), but it's a centralized gate on creating agents.

**Ask (Runtime).** A consumer-delegation extrinsic in the `individuality`
runtime — let a full person register identifier keys for delegate accounts,
the way `set_statement_store_account` already delegates statement bandwidth.
Then "my agent" is something a person mints, not something a verifier grants.

**Status: adjacent work planned** (backlog #7–#10, Identity Backend v2 /
decentralized IB) — ask that bot/delegate registration be an explicit use
case in that design.

## 8. Smaller app-side asks, in one place (App)

- **Command affordance.** Bots speak `/commands` (`/help`, `/stop`,
  `/model`, `/project`). The app has no command discovery surface — a user
  has to know to type `/help`. Even a minimal "shortcuts" chip row fed by a
  bot-declared command list (could ride a `chatAccepted` extension or a new
  content kind) would help. Low priority; Telegram proves the pattern.
- **Link tap = open, with preview.** Agents send URLs (PRs, docs); today they
  are inert text (also subsumed by §1 markdown links).
- **"Bot" identity badge.** Anything registered as a lite person via the
  agent path could carry a visual marker; sets user expectations (instant
  replies, no human) and is honest UX.

**Status: not planned.**

## 9. Coordination request: the X25519 + ChaCha20-Poly1305 migration (Spec)

Backlog #22 migrates chat encryption from P-256 ECDH + AES-GCM. This breaks
every wire-compatible implementation (including this repo's — we will happily
migrate). Two asks: **spec-first** — land the new key-exchange/encryption in
`chat-spec` before or with the app release, not after; and **versioned
coexistence** — the session-init handshake should negotiate or at least
signal the scheme, so third-party clients get a migration window instead of a
flag day. The spec already versions message content; key exchange deserves
the same.

---

## What already works well (keep it this way)

Credit where due — from implementing a full third-party client: the
per-device session model, ACK-or-resend delivery, channel-replacement
semantics (one statement per channel slot, extend-don't-clobber), the
ticket-derived attachment crypto, and reactions/replies/edits all compose
cleanly and are implementable from the spec plus app source. RFC-0001 and
RFC-0002 both fix real problems we independently hit. The single biggest gap
between "chat app" and "great agent surface" is §1 — markdown rendering —
which is app-side, self-contained, and needs no protocol change to start.

## Planned-work cross-reference

| Our item | Backlog / RFC | Their status |
|---|---|---|
| §3 file download robustness, inline small files | RFC-0001 (PR #3), #26, #27 | RFC open; #26/#27 P0 ready for development |
| §5 offline backlog / oversized messages | RFC-0002 (PR #4), #23 | RFC open; #23 P0 ready for development |
| §4 push rework | #16 | P0, blocked by Identity Backend v2 |
| §7 decentralized identity | #7–#10 | P0, partly blocked |
| §9 encryption migration | #22 | P0, ready for development |
| Group chat (bots in groups — future interest) | #48–#51 | P1, spec needed |
| §6 delete/unsend | RFC-0003 (PR #5) | RFC opened from this document's asks |
| §1 markdown, §2 edit history, §6 typing, §8 UX affordances | — | **not planned — this document's core asks** |
