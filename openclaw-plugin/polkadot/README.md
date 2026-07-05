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

**Validated end-to-end against a live OpenClaw 2026.6.11 gateway** (Polkadot app →
bot-core → this plugin → OpenClaw → claude-cli → reply). Built on the channel-plugin
SDK (`pluginApi >= 2026.6.11`): `gateway.startAccount` runs the long-poll loop;
`channelRuntime.inbound.run` + `buildContext` dispatch each message;
`delivery.deliver` routes the agent's reply to `POST /send`.

Field notes from that validation:
- Package installs need compiled JS (`dist/index.js`); TS source only loads via
  `openclaw plugins install --link <path>` (local dev mode).
- Plugin files must be owned by root or the gateway's uid, or loading is blocked.
- `dmPolicy: "allowlist"` + `allowFrom` is the recommended locked-down config.
- Run the gateway in a container as a non-root user: set `gateway.mode: "local"`
  in `openclaw.json` and `OPENCLAW_GATEWAY_TOKEN` in the environment; a non-root
  user avoids the claude CLI's root guard (no IS_SANDBOX needed).
