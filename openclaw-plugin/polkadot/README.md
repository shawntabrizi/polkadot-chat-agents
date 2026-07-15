# OpenClaw channel plugin: Polkadot

Lets an [OpenClaw](https://github.com/openclaw/openclaw) agent chat over the
**Polkadot app**. It's a thin channel plugin over the `bot-core` HTTP bridge:
it authenticates to and long-polls `GET /inbound`, dispatches each leased
message into OpenClaw's agent, acknowledges the lease after a successful
handoff, and sends replies back with `POST /send`.

```
Polkadot app ⇄ bot-core (--brain bridge) ⇄ HTTP bridge ⇄ this plugin ⇄ OpenClaw agent
```

## Setup

1. Run `bot-core` in bridge mode so it exposes the bridge:
   ```bash
   pca create mybot --brain bridge --owner <your-address>   # "bridge" = external-agent bridge mode
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
       "bridgeToken": "<BOT_BRIDGE_TOKEN>",    // or set POLKADOT_BRIDGE_TOKEN
       // Optional: only for OpenClaw attached results that are not a reply
       // to an active inbound delivery (or POLKADOT_BRIDGE_PROACTIVE_TOKEN).
       "bridgeProactiveToken": "<BOT_BRIDGE_PROACTIVE_TOKEN>",
       "dmPolicy": "closed",                    // open | pairing | closed
       "allowFrom": ["<peer account-id hex>"]   // who may DM the agent
     }
   }
   ```
4. Start OpenClaw's gateway. Message your bot in the Polkadot app — OpenClaw answers.

`allowFrom` here is defense-in-depth; `bot-core`'s own `--owner` allowlist already
gates senders before they reach the bridge.

`bridgeToken` must match `BOT_BRIDGE_TOKEN` for the bot-core process. Keep it
in the gateway secret store or `POLKADOT_BRIDGE_TOKEN`, not in a checked-in
configuration file.

For a T3ams bridge bot, ordinary gateway replies carry their leased
`delivery_id` and `lease_id`, so they do not need another credential.
`bridgeProactiveToken` is optional and is used only by OpenClaw's generic
attached-results sender, which can run outside such a delivery. It must match
the distinct 32+ character `BOT_BRIDGE_PROACTIVE_TOKEN` secret and is sent as
`x-bridge-proactive-token` alongside the normal bridge authorization. Leave it
unset unless those proactive results are needed.

In T3ams mode, the bridge supports DMs and workspace channels, including
threads, live replies, media, and files. Native ad-hoc T3ams groups are not
supported yet.

## Status

**Validated end-to-end against a live OpenClaw 2026.6.11 gateway** (Polkadot app →
bot-core → this plugin → OpenClaw → claude-cli → reply). Built on the channel-plugin
SDK (`pluginApi >= 2026.6.11`): `gateway.startAccount` runs the long-poll loop;
`channelRuntime.inbound.run` + `buildContext` dispatch each message;
`delivery.deliver` routes the agent's reply to `POST /send`.

Field notes from that validation:
- The plugin ships compiled JS (`dist/index.js`, committed) so a normal
  `openclaw plugins install <path-or-git>` works. After editing the TS source,
  rebuild with `npm run build` (esbuild bundle; `openclaw/*` stays external).
- Plugin files must be owned by root or the gateway's uid, or loading is blocked.
- `dmPolicy: "allowlist"` + `allowFrom` is the recommended locked-down config.
- Run the gateway in a container as a non-root user: set `gateway.mode: "local"`
  in `openclaw.json` and `OPENCLAW_GATEWAY_TOKEN` in the environment; a non-root
  user avoids the claude CLI's root guard (no IS_SANDBOX needed).
