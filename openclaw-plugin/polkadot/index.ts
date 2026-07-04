// OpenClaw channel plugin entry point.
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { polkadotPlugin } from "./src/channel.js";

export default defineChannelPluginEntry({
  id: "polkadot",
  name: "Polkadot",
  description: "Polkadot app chat channel — bridges the Polkadot mobile app to OpenClaw via the bot-core HTTP bridge.",
  plugin: polkadotPlugin,
});
