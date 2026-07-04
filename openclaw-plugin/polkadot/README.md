# OpenClaw channel plugin: Polkadot

Lets an [OpenClaw](https://github.com/openclaw/openclaw) agent chat over the
**Polkadot app**. It's a thin channel plugin over the `bot-core` HTTP bridge:
it long-polls `GET /inbound`, dispatches each message into OpenClaw's agent, and
sends the agent's reply back with `POST /send`.

```
Polkadot app ⇄ bot-core (--brain hermes) ⇄ HTTP bridge ⇄ this plugin ⇄ OpenClaw agent
```

## Setup

1. Run `bot-core` in bridge mode so it exposes the bridge:
   ```bash
   pca create mybot --brain hermes --owner <your-address>   # "hermes" = external-agent bridge mode
   pca run mybot                                             # bridge on http://127.0.0.1:8799
   ```
2. Install this channel plugin into OpenClaw:
   ```bash
   openclaw plugins install <path-or-npm-spec>
   openclaw plugins enable polkadot
   ```
3. Configure the channel (in `openclaw.json` under `channels.polkadot`, or env):
   ```jsonc
   "channels": {
     "polkadot": {
       "enabled": true,
       "bridgeUrl": "http://127.0.0.1:8799",   // or set POLKADOT_BRIDGE_URL
       "dmPolicy": "closed",                    // open | pairing | closed
       "allowFrom": ["<peer account-id hex>"]   // who may DM the agent
     }
   }
   ```
4. Start OpenClaw's gateway. Message your bot in the Polkadot app — OpenClaw answers.

`allowFrom` here is defense-in-depth; `bot-core`'s own `--owner` allowlist already
gates senders before they reach the bridge.

## Status

Built against the OpenClaw channel-plugin SDK (`pluginApi >= 2026.6.11`), modeled
on the in-repo `raft` (structure) and `clickclack` (polling + outbound) channels:
`gateway.startAccount` runs the long-poll loop; `channelRuntime.inbound.run` +
`buildContext` dispatch each message; `delivery.deliver` routes the agent's reply
to `POST /send`; `outbound.attachedResults.sendText` sends directly.

**Not yet verified against a live OpenClaw install** (same status the Hermes plugin
had before it was deployed) — this is the reference implementation to drop in and
validate with `openclaw plugins inspect polkadot`. If your OpenClaw version expects
`base.setup`/`base.configSchema`, add them per your SDK version; the manifest's
`channelConfigs.polkadot.schema` covers discovery-time config.
