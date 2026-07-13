---
prev:
  text: "Bridge HTTP API"
  link: "/reference/bridge"
---

# How it works

The home page makes four promises: your agents are **private**, there's
**nothing to shut down**, they're **reachable from anywhere**, and they're
**yours**. This page explains the architecture that makes each of those true —
and where Polkadot comes in.

## Why a normal chat bot can't make these promises

An ordinary chat bot runs behind a company's server. That server sees every
message, can be subpoenaed or breached, can ban your account, and can be shut
down or blocked. "Private" and "uncensorable" aren't properties it can offer,
because a single operator sits in the middle of every conversation.

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
- No single party owns the mailbox. There's no operator to read your messages,
  ban your account, or take the service down. That's what **nothing to shut
  down** and **uncensorable** actually mean here.

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

## Your AI, in its own sandbox

The bot itself is just a process you run. It holds its own signing key — the
key *is* the identity — and when it runs an AI agent with real tools, that agent
is spawned in a locked-down sandbox with the secrets stripped out. The agent can
do its work; it cannot read the bot's identity or reach the network on its own.
That's why **your keys stay yours**.

## How the promises map to the mechanism

| The promise | What makes it true |
|---|---|
| Private | Per-conversation end-to-end encryption; keys only at the endpoints. |
| Nothing to shut down | Store-and-forward on a decentralized network — no server, no operator, no account. |
| Reachable from anywhere | Messages persist on the network and are re-read on reconnect; the bot only needs outbound access. |
| Yours to run | Open source; the bot is a process you own, holding its own keys. |
| Spam-resistant, still open | On-chain proof of personhood gates who can be messaged, with no company as gatekeeper. |

## Going deeper

This is the conceptual tour. For the protocol-level detail — session channels,
acknowledgements, the outbound-statement model, live-reply editing, and the
security model in full — see [Architecture](/explanation/architecture).
