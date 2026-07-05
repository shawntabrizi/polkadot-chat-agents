# Working on polkadot-chat-agents

Read `docs/DESIGN.md` before changing transport or session code — several
behaviors exist because of hard-won protocol facts (per-device session channels,
ACK-or-resend, batch decoding, deterministic session rebuild).

## Conventions

- Plain Node ESM (`.mjs`), no TypeScript and no build step in `bot-core`. The
  OpenClaw plugin is TypeScript but ships a committed `dist/` bundle — run
  `npm run build` in `openclaw-plugin/polkadot` after editing it, and commit the
  updated bundle (CI diffs it).
- `bot-core/vendor/` is vendored transport/codec code. Do not refactor it;
  change it only for protocol-level fixes, and keep the diff minimal.
- Match the existing style: small helpers over abstractions, comments explain
  why (usually a protocol constraint), JSON-line logging via `log(event, extra)`.
- Keep `cli.mjs` output friendly to non-technical users: the `ok/step/note/warn/
  fail` helpers, no raw stack traces, no blockchain jargon in the happy path.

## Invariants to preserve

- Follow-ups must be polled on every device session, not just the identity
  session, and every inbound request must be ACKed (the app resends until it
  sees one).
- One undecodable message in a batch must not prevent decoding the rest.
- Session state (`BOT_STATE_DIR/session-state.json`) must survive restarts:
  persist peer devices and the dedup set; rebuild sessions on startup before
  polling.
- Never log or commit seeds, session keys, or model credentials. `secret.json`
  and `session-state.json` are mode 0600 and gitignored.
- Only one process may serve a bot identity at a time.

## Testing

- `node --check` each changed `.mjs` file.
- Transport changes: run an `echo`-brain bot and drive it with
  `bot-core/test-client.mjs`. Anything touching session or inbound handling must
  also pass `bot-core/test-client-device.mjs`, which reproduces how the mobile
  app actually sends (see `docs/TESTING.md`).
- Do not claim a fix works without an end-to-end reproduction; log output alone
  is not verification.
- Registration changes: the proof helper must produce byte-identical output via
  wasm and native (`tools/bandersnatch-cli`; CI has a known-answer test).

## Registration proof (wasm)

`pca create` runs the bandersnatch lite-person proof from
`bot-core/vendor/summit-bandersnatch-cli.wasm` via `node:wasi`. After changing
`tools/bandersnatch-cli`, rebuild and re-vendor:

```bash
cargo build --release --target wasm32-wasip1 --manifest-path tools/bandersnatch-cli/Cargo.toml
cp tools/bandersnatch-cli/target/wasm32-wasip1/release/summit-bandersnatch-cli.wasm bot-core/vendor/
```

## Housekeeping

- Commit incrementally as work lands, not in one batch at the end.
- Test bots and identities are cheap; kill stray local bot processes when done
  (a leftover echo bot chatting with a deployed bot creates an infinite loop).
