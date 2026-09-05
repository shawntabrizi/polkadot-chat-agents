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
