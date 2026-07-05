# polkadot-chat-agents

**Run your own AI chat bot inside the Polkadot app.** Message it like any contact —
it answers with Claude, GPT, Gemini, Grok, or a full agent framework (Hermes,
OpenClaw) behind it.

No chat server. No webhook. No hosting a platform. Polkadot app chat runs over the
**Statement Store** — a decentralized, end-to-end-encrypted message layer — so your
bot is just a process that connects to a public RPC node, from anywhere: a laptop,
a Raspberry Pi, a $5 VPS.

```
 Polkadot app (phone)  ⇄  Statement Store (Paseo)  ⇄  bot-core  ⇄  your AI
                                                        │
                                     direct brain (claude/codex/gemini/grok CLI)
                                     — or an agent harness (Hermes, OpenClaw)
```

**Status:** working end-to-end. Two reference bots run in production — one driven
by Hermes + Codex, one by OpenClaw + Claude — both chatting from real phones.

## What you need

- **Node.js 20+**. That's it — the identity-proof crypto ships prebuilt (wasm).
- **The Polkadot app** on your phone, with an account (this is who the bot talks to).
- **An AI CLI the bot can use** — e.g. [Claude Code](https://claude.com/claude-code)
  (`claude`), Codex (`codex`), gemini-cli, or grok — logged in on the machine the
  bot runs on. The bot shells out to it; your keys stay with the CLI.

Everything blockchain-y (keys, registration, usernames, encryption) is handled for
you.

## Create your bot (2 commands)

```bash
cd bot-core
npm install        # one-time

# 1. Create it — generates an identity, registers a username on the network,
#    and locks the bot so only YOUR app account can message it.
node cli.mjs create mycoolbot --brain claude --owner <your-polkadot-app-address>

# 2. Run it.
node cli.mjs run mycoolbot
```

`create` prints a link — open it (or search the printed username, e.g.
`mycoolbot.07`) in the Polkadot app and say hi. Registration is usually confirmed
within a few minutes; `node cli.mjs info mycoolbot` re-checks.

Slow model? The bot automatically sends "🤔 One moment — thinking…" if a reply
takes more than ~5s, so chats never feel dropped. Conversations survive restarts —
session state is persisted per bot.

## Put it on a server (1 command)

Any box with Docker + SSH access:

```bash
node cli.mjs deploy mycoolbot --host root@your-server \
  --anthropic-key sk-ant-…                 # claude brain, fully headless
node cli.mjs deploy mycoolbot --host root@your-server --dry-run   # preview first

node cli.mjs status mycoolbot              # running + healthy?
node cli.mjs logs mycoolbot -f             # live logs
node cli.mjs stop mycoolbot
```

`deploy` uploads bot-core, generates a compose file + env, starts the container
(with a persistent state volume), and waits until the bot is online. Direct brains
(`echo`, `claude`) deploy as one container; bridge bots deploy **with their agent
framework** as a two-container stack — `--harness openclaw` is fully headless,
`--harness hermes` prints its one interactive login. Details in
[`docs/HARNESSES.md`](docs/HARNESSES.md).

## Choose a brain

| `--brain` | What answers | Auth |
|---|---|---|
| `claude` | Claude, via the `claude` CLI | Claude Code login or API key |
| `codex` | GPT, via the `codex` CLI | ChatGPT/Codex subscription login |
| `gemini` / `grok` | that model's CLI | its own login |
| `echo` | repeats you — zero-config smoke test | none |
| `hermes` / `bridge` | an external **agent framework** over the local HTTP bridge | the framework's |

Pin a cheap model with `BOT_AI_MODEL` (e.g. `claude-haiku-4-5-20251001`), or wire
any other CLI with `BOT_AI_CMD`/`BOT_AI_ARGS`. AI brains spend your quota, so `pca`
refuses to leave one open to the world unless you pass `--public`.

## Agent frameworks (Hermes, OpenClaw, …)

For a bot with memory, tools, and personality, run `--brain hermes` and let a
harness drive the conversation through bot-core's tiny HTTP bridge
(`GET /inbound` long-poll → `POST /send`). Both integrations are validated live:

- **Hermes** — `hermes-plugin/polkadot/` drops into `~/.hermes/plugins/`.
- **OpenClaw** — `openclaw-plugin/polkadot/` is an OpenClaw channel plugin.

Setup recipes, the bridge contract (write your own adapter in ~50 lines), and
deployment field notes: [`docs/HARNESSES.md`](docs/HARNESSES.md).

## Test without a phone

```bash
node bot-core/test-client.mjs --seed-hex 0x<attested-seed> \
  --bot-account 0x… --bot-identifier-key 0x… "hello"
```

Sends a real message over the network and prints the bot's replies. (There's also
`test-client-device.mjs`, which reproduces the mobile app's multi-device behavior.)

## Keep these safe

- `bots/<name>/secret.json` — the bot's root seed. Anyone with it **is** the bot.
- `bots/<name>/session-state.json` (and the server's `state/` volume) — session
  keys for open conversations.

Both are created `0600` and gitignored — don't commit them, do back them up.

## Layout

- `bot-core/` — the transport + CLI (`cli.mjs` = `pca`): identity, encryption,
  send/receive, session persistence, brains, HTTP bridge, deploy/ops.
- `hermes-plugin/`, `openclaw-plugin/` — harness adapters.
- `tools/bandersnatch-cli/` — Rust source of the registration personhood proof;
  ships prebuilt as `bot-core/vendor/summit-bandersnatch-cli.wasm` (runs via
  node:wasi — users never need a Rust toolchain; rebuild: `cargo build --release
  --target wasm32-wasip1`).
- `docs/` — [`DESIGN.md`](docs/DESIGN.md) (architecture),
  [`HARNESSES.md`](docs/HARNESSES.md) (integrations),
  [`TEST-ROUND-TRIP.md`](docs/TEST-ROUND-TRIP.md) (verification guide).

Currently targets the **Paseo** testnet (`people-next` chain), using Parity's
identity backend as the registration verifier.

## License

[MIT](LICENSE)
