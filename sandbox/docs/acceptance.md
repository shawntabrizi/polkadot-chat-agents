# Acceptance record

One entry per milestone: what was run, the summary lines, what is verified
and what is not.

## S0 — Store node and scaffold (2026-09-05)

### What was verified

`cd sandbox && npm test` (Node v24.13.1):

```
✔ channel replacement: only a strictly greater expiry replaces; equal or lower is channelPriorityTooLow
✔ noAllowance: a signer outside the allowance set is rejected; null allows everyone
✔ accountFull: a full account evicts its lowest expiry only for a higher newcomer
✔ initial dumps are paged with a correct remaining count; live pushes carry none
✔ list() filters by topic, signer and channel and never needs a key
✔ invalid submits: no proof, already expired, undecodable
✔ fault drop: matching submits are answered new but never stored, for count hits
✔ fault delay: the submit is stored and answered only after ms
✔ fault holdDump: a matching subscription gets nothing until released
✔ clock offset: expiry checks follow the node clock, stored statements expire
✔ restart drops every connection and keeps the store; reset wipes it
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

`cd bot-core && npm test` against the moved node (bot-core code unchanged,
only the import path):

```
ℹ tests 416
ℹ suites 1
ℹ pass 416
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 73839.283208
```

No `STORE_NODE_SUBMIT_REFUSED` line in the run: the new rules never
refused a bot-core submit. The suite was run again after the last node
fix (channel-less statements never occupy a slot) with the same result.

Three full bot-core runs were made. Runs 1 and 3 were 416/416. Run 2 had
one failure, `test/workspaces.test.mjs` "worktree subprocess timeout reaps
a stalled command": its fake `git rev-parse` took longer than the 500 ms
timeout under the concurrent e2e load and reported "not a git repository"
instead of the timeout. That file never touches the store node and passed
3/3 when run alone; it is a pre-existing timing sensitivity, not an S0
regression.

### Rules pinned to sources

| rule | source |
|---|---|
| replace only on strictly greater expiry; `channelPriorityTooLow { submitted_expiry, min_expiry }` | `polkadot-sdk/substrate/client/statement-store/src/lib.rs` `SubmitIndex::insert`; `chat-spec/base-spec.md` |
| resubmit of a stored statement is `known` | `Store::submit` duplicate check |
| `invalid/alreadyExpired` when `now >= expiry >> 32` | `Store::submit` step 1 |
| `invalid/noProof` | `Store::submit` step 4 |
| `rejected/noAllowance` | `Store::submit` step 5 |
| count limit evicts lowest expiry, else `accountFull { submitted_expiry, min_expiry }` | `SubmitIndex::insert` constraint loop |
| result JSON: `status`/`reason` camelCase tags, snake_case fields, u64 as bare integers | `sp_statement_store::store_api` serde attributes; Android `SubmitStatementResult.kt` |
| dump pages carry `remaining`, live pushes do not | `sc_rpc::statement::send_in_chunks`; `subscription.rs` `notify_matching_filters` |
| undecodable submit is a JSON-RPC error 7001 "Statement store error: ..." | `sc_rpc_api::statement::error` |

### Not verified / not modelled

- `badProof` (signature verification), `dataTooLarge`, `storeFull`,
  `encodingTooLarge`: not implemented (see `docs/questions.md`).
- Empty initial dump: the node sends one empty page; the real node sends
  nothing (question 2 in `docs/questions.md`).
- Live-push behaviour on channel replacement: the node pushes every stored
  statement; `PLAN.md` notes the real node is unreliable here. Unchanged
  from the old mock, to be modelled in S3 with the fault work.
- No live-network comparison was run; every rule above is pinned to source,
  not to a recorded exchange with a deployed node.
