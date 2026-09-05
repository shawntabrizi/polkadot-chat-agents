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
