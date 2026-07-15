# polkadot-chat-agents

Run an AI chat bot that people can message from the Polkadot app. The bot's
replies can come from a headless coding-agent CLI (Claude, Codex, or OpenCode —
which itself reaches many providers) or from an agent framework such as Hermes or
OpenClaw.

Polkadot app chat has no chat server. Messages travel over the Statement Store, a
decentralized store-and-forward layer, and conversations are end-to-end encrypted.
A bot is therefore just a process with an outbound connection to a public RPC
node. It needs no public IP, no webhook, and no hosting platform, and can run on a
laptop or a small VPS.

```
Polkadot app (phone) <-> Statement Store (Paseo) <-> bot-core <-> brain
```

The "brain" is either a model CLI that bot-core invokes directly, or an agent
framework connected through a small HTTP bridge. Two reference bots run in
production: one on Hermes with Codex, one on OpenClaw with Claude.

## Requirements

- Node.js 22 or newer. The registration proof ships precompiled (wasm), so no
  other toolchain is needed.
- The Polkadot app on a phone, with an account.
- For an AI brain: the model's CLI installed and logged in on the machine the bot
  runs on. bot-core invokes the CLI without forwarding its own secret
  environment. A deployed CLI is authenticated through its persistent OAuth home.

## Create and run a bot

```bash
npm install
npm run create -- mycoolbot --brain claude --owner yourname.42
npm start -- mycoolbot --greet
```

Every subcommand works this way from the repo root (`npm run list`, `npm run info
-- mycoolbot`, ... — the `--` separates npm's arguments from the bot's). For a
real `pca` command without the npm ceremony, run `npm link` once inside
`bot-core/`; the docs below use the short `pca` form.

`create` generates the bot's identity, registers a username on the network, and
restricts the bot so only the `--owner` account can message it. The owner can be
given as an app username, an SS58 address, or a 32-byte account id in hex.

The command prints a link and a username (for example `mycoolbot.07`). Open the
link, or search for the username in the Polkadot app, and send a message.
Registration is usually confirmed within a few minutes; `pca info
mycoolbot` re-checks.

A private bot created for the default Paseo testnet gets a derived Bulletin
file-delivery account. The local `pca` CLI automatically provisions its fixed
testnet allowance during normal onboarding, including refreshing an allowance
that is close to expiry. Use `pca storage mycoolbot status` for a read-only
check, and run `pca storage mycoolbot grant` only when capacity actually needs
provisioning. An interrupted, uncertain, or unverified faucet submission remains
guarded locally: check `status`, then use `pca storage mycoolbot recover` rather
than retrying a grant. It authorizes that derived account, not the bot's chat
wallet.
Public bots deliberately do not receive this finite-allowance profile. This
convenience is Paseo-testnet-only; production allocation remains an operator
authorization flow.

The number suffix is a network-assigned discriminator, since base names are not
unique. Pass `--digits NN` to request a specific one; if it is taken, `create`
says so before registering anything.

If a reply takes longer than about five seconds, the bot sends a configurable
"thinking" acknowledgement so the chat does not appear stalled. Session state is
persisted per bot, so conversations continue across restarts.

## Run it on a server

`deploy` targets any machine reachable over SSH that has Docker installed:

```bash
pca deploy mycoolbot --host root@your-server

pca status mycoolbot
pca logs mycoolbot -f
pca stop mycoolbot
```

`deploy` uploads bot-core, generates a compose file and environment, starts the
container with a persistent state volume, and waits for the bot to come online.
Add `--dry-run` to preview the generated files without deploying.

Direct engines (`echo`, `claude`, `codex`, `opencode`) deploy as a single
container with the transport state isolated from the non-root agent CLI and a
persistent workspace it works in. After a direct deployment, use the printed
one-time CLI login command. Bridge bots deploy together with their agent
framework as a two-container stack: `--harness openclaw` requires no interactive
steps if the server has Claude CLI credentials, and `--harness hermes` prints
the one login command it cannot automate. See [docs/HARNESSES.md](docs/HARNESSES.md).

## T3ams bots

T3ams is an optional transport for bots that should receive DMs and workspace
mentions from the T3ams SPA. Create one with `--transport t3ams`; it uses the
same brains, account, and Statement Store connection as the default transport.
Native ad-hoc T3ams groups are not supported yet; use a workspace channel for a
shared bot conversation.
The BCTS SDK is currently a **local package**, not a public npm dependency: build
and pack it from `t3ams-spa/packages/bcts`, install that tarball into
`bot-core`, then run or deploy the bot. Do not use `npm install @t3ams/bcts`.

The operator flow—DotNS registration, local SDK packaging, Statement Store
allowance, private account-to-device signing-key pins, auto-accepted DM pairs,
workspace invitations, mention-only channel replies, and private-channel key
grants—is documented in
[docs/T3AMS.md](docs/T3AMS.md).

T3ams direct brains keep a single message bubble live while they think, report
tool progress, and finish. Its authenticated framework bridge can do the same
through message edits, reactions, and typing signals. Rich-text attachment
references are authenticated and constrained before they reach a brain or a
bridge; see the T3ams guide for Bulletin media, private-state, and file-vault
requirements. Direct Claude, Codex, and OpenCode turns can also return bounded
generated photos, documents, and other files as native attachments.

## Brains

Direct engines run a headless coding-agent CLI as an autonomous agent — verbatim
prompts, native session memory (`--resume`), and deployer-selected portable
`read`, `write`, and `bash` capabilities in their container runtime.

| `--brain` | Replies come from | Reaches | Authentication |
|---|---|---|---|
| `claude` | the `claude` CLI | Claude models | Claude Code login |
| `codex` | the `codex` CLI | OpenAI models | ChatGPT/Codex login |
| `opencode` | the `opencode` CLI | many providers via `--model provider/model` | `opencode auth login` |
| `echo` | bot-core itself (repeats the message) | — | none |
| `bridge` | an agent framework over the HTTP bridge | — | the framework's |

`opencode` is the many-models path — one engine reaches Anthropic, OpenAI,
Google, xAI, OpenRouter, local models, etc. In-chat: `/stop` cancels the current
turn, `/reset` starts a fresh session, `/model` switches model, `/reasoning`
dials thinking depth (claude/codex), `/usage` shows tokens and cost spent.

`--model` pins the model (`BOT_AI_MODEL`; a `provider/model` slug for opencode) —
set it at `create` (saved) or override per run. `BOT_AI_CMD`/`BOT_AI_ARGS` wire in
a custom CLI that speaks claude-shaped stream-json.
Because an AI brain spends your quota, `create` refuses to leave one open to
arbitrary senders unless `--public` is passed. `/model` always shows the active
model, but chat-side switching is locked by default. The operator can approve a
small set with `pca model <bot> allow model-a,model-b`, or explicitly open it
for an allowlisted bot with `pca model <bot> open`. Public bots can only use an
approved set (`BOT_AI_ALLOWED_MODELS=a,b`); unrestricted switching is never
allowed for them.

In chat, direct-brain bots answer `/help`, `/reset`, `/model <name>`,
`/reasoning <level>`, `/project`, `/usage`, and `/ping` instantly themselves;
bridge bots leave their other slash-commands to the framework. Ordinary files
you send are downloaded into a private per-turn workspace directory and removed
after the turn, so "here's the spec, implement it" works with a photo or
document attached. Caption one attachment `/file put <path>` to retain it in a
private per-chat vault; `/file ls`, `/file info`, `/file rm`, and `/file get`
manage it. File return needs an operator-pinned HOP node and an active Bulletin
allowance. The named private Paseo profile provisions its testnet allowance
locally; other networks need separate operator provisioning.

Direct T3ams agents start with no tools. An operator opts into portable,
lowercase capabilities with `--allowed-tools read,write,bash`, chooses
`--tool-scope workspace|container`, and chooses
`--tool-network none|internet`. `write` includes `read`; `bash` includes both.
The default is no capabilities, workspace scope, and no tool network. `read`
also lets a direct agent inspect a verified attachment staged for its current
turn, while `write` lets it produce returnable files. Workspace scope is the
normal project boundary; container scope deliberately grants the non-root
agent account access to all of its container-visible files, including its
OAuth home. See [the configuration guide](docs/CONFIGURATION.md#tool-policy)
for engine enforcement and boundary tradeoffs. In particular, OpenCode Bash
requires `--tool-network internet`; Claude needs it for container-scoped Bash
but not workspace-scoped Bash, while Codex can keep `none` in either scope.

**Projects.** `pca project <bot> add <alias> <path>` registers a directory the
agent can work in (repeat for more). In chat, `/project <alias>` points your
conversation at that repo, `/project <alias>@<branch>` gives it an isolated
`git worktree` for that branch (created on first use under the bot's workspace),
and `/project default` returns to the shared workspace. Each switch
starts a fresh engine session — a resumed session is only valid in the
directory it started in. Projects are per-peer: two people can work in
different repos with the same bot. (Local `pca run` only: a Docker-deployed
bot can't see paths on your machine.)

`--greet` (on `run` or `deploy`) makes the bot message its owner first: on startup
it opens the chat with each allowlisted owner it has never talked to — a proof of
life, so you don't have to find and message it. It greets each owner once ever,
never into an existing thread, and only allowlisted accounts. Customize the text
with `BOT_GREET_TEXT`.

## Agent frameworks

For a bot with memory, tools, and a persona, run `--brain bridge` and let a
framework drive the conversation through bot-core's authenticated HTTP bridge
(a bounded long-poll `GET /inbound`, lease renewal/ACK endpoints, and `POST /send`). Two
integrations are included and validated:

- Hermes: `hermes-plugin/polkadot/`, a platform adapter that drops into
  `~/.hermes/plugins/`.
- OpenClaw: `openclaw-plugin/polkadot/`, a channel plugin.

The bridge contract is a small authenticated API, so writing an adapter for
another framework is small. Setup recipes and deployment notes are in
[docs/HARNESSES.md](docs/HARNESSES.md).

## Testing without a phone

```bash
node bot-core/test-client.mjs --seed-hex 0x... \
  --bot-account 0x... --bot-identifier-key 0x... "hello"
```

This sends a real message from an attested identity and prints the bot's replies.
`test-client-device.mjs` does the same through per-device session channels, which
is how the mobile app actually sends. See [docs/TESTING.md](docs/TESTING.md).

## Files to protect

`~/.pca/bots/<name>/secret.json` holds the bot's root seed; whoever has it
controls the bot. `~/.pca/bots/<name>/session-state.json` and the server-side
`state/` volume hold session keys for open conversations; `state/files/` holds
the durable peer file vault. `config.json` also holds the bridge token; a
deployed bot's `bot.env` holds the seed and token. All are created with mode
0600. Back them up; do not commit them.

## Repository layout

- `bot-core/` — the transport and the `pca` CLI: identity, session encryption,
  send/receive, persistence, brains, HTTP bridge, deploy and ops commands.
- `hermes-plugin/`, `openclaw-plugin/` — framework adapters.
- `tools/bandersnatch-cli/` — Rust source of the registration proof helper. The
  wasm build is committed at `bot-core/vendor/summit-bandersnatch-cli.wasm`;
  rebuild with `cargo build --release --target wasm32-wasip1`.
- `docs/` — [DESIGN.md](docs/DESIGN.md) (architecture),
  [CONFIGURATION.md](docs/CONFIGURATION.md) (every env var + `bot.env` examples),
  [HARNESSES.md](docs/HARNESSES.md) (framework integrations),
  [TESTING.md](docs/TESTING.md) (headless verification).

The project currently targets the Paseo testnet (`people-next` chain) and uses
Parity's identity backend as the registration verifier.

## License

[MIT](LICENSE)
