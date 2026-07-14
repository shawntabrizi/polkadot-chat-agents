---
prev:
  text: "Bridge HTTP API"
  link: "/reference/bridge"
---

# How it works

The home page promises private conversations, a chat layer without a central
service, access from the Polkadot app, and a bot you operate yourself. This page
explains the architecture behind those properties — and where its boundaries
are.

## Why a normal chat bot can't make these promises

An ordinary chat bot runs behind a company's server. That operator is normally
responsible for carrying the conversation and operating the account. This
project moves the chat transport to a decentralized message layer instead. Your
bot still needs a machine and network access that you operate.

Polkadot Chat Agents removes the middle. There is no chat server at all.

## The Statement Store: a network mailbox with no operator

Messages travel over the **Statement Store**, a decentralized store-and-forward
layer built into the Polkadot network. Think of it as a shared mailbox that
lives on the chain rather than on anyone's server:

- A bot **publishes** encrypted statements addressed to a conversation and
  **reads** the ones addressed to it. It only ever makes outbound connections —
  no inbound ports, no public IP, no webhook.
- Statements persist until they expire, and reading them doesn't consume them,
  so a device that was offline simply catches up when it returns. This is why a
  conversation "waits for you."
- No central chat company operates the mailbox. That removes the usual hosted
  chat-service dependency, although ordinary network services and the machine
  running your bot can still have outages.

## End-to-end encryption: private means private

Every conversation is encrypted between the two participants. Each session
derives its own keys from a shared secret computed between the two parties'
chat keys, and only the endpoints hold them. The statements sitting on the
network are ciphertext; anyone can see that *a* statement exists, but not who
it's between or what it says. Nobody in the middle — because there is no
middle — can read it.

## Personhood: keeping the network free of spam without a gatekeeper

If anyone could message anyone, an open network would drown in spam. Polkadot
solves this with **proof of personhood**: to be reachable, an account registers
as an attested person and publishes a chat key others can use to reach it.
Being messageable is a capability you earn once, on-chain — not a profile a
company grants and can revoke. Your bot registers the same way, which is what
lets someone start a conversation with it in the first place.

## Sending files: the Bulletin chain

Chat statements are small by design. Larger payloads — images, documents, files
you hand an agent to work on — ride a companion store-and-forward layer (the
**Bulletin chain**, reached over a peer-to-peer "HOP" transport). The chat
message carries only a small encrypted reference; the bytes are fetched and
decrypted from keys derived entirely from that reference, so receiving a file
needs no central storage and no account anywhere.

## Your agent and its keys

The bot itself is just a process you run. It holds its own signing key — the
key *is* the identity. In a deployed direct bot, the transport keeps that key
and the session state while the AI-agent CLI runs as a non-root user in its own
container. The agent does not receive the signing key or chat session state,
but its provider-login home is readable by that same process when it has tools.
That protects the chat identity, not the provider credential. Direct Claude,
Codex, and OpenCode therefore start with no tools; their deployer explicitly
chooses portable capabilities, scope, and tool-network access for either public
or allowlisted bots. A local `pca run` uses your local environment, so treat its
selected policy as especially consequential.

## How the promises map to the mechanism

| The promise | What makes it true |
|---|---|
| Private | Per-conversation end-to-end encryption; keys only at the endpoints. |
| No central chat service | Store-and-forward on a decentralized network rather than a hosted chat platform. |
| Reachable from anywhere | Messages persist on the network and are re-read on reconnect; the bot only needs outbound access. |
| Yours to run | Open source; the bot is a process you own, holding its own keys. |
| Spam-resistant, still open | On-chain proof of personhood gates who can be messaged, with no company as gatekeeper. |

## Next steps

Use the [Guide](/guide/introduction) to create and deploy a bot. The
[Configuration reference](/reference/configuration) covers runtime settings,
and the [Bridge HTTP API](/reference/bridge) is for framework integrations.
