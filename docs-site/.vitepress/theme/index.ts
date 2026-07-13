import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import HeroNetwork from "./HeroNetwork.vue";
import "./custom.css";

// Default VitePress theme + the Polkadot design tokens (custom.css), with an
// animated network illustration rendered into the home hero image slot.
export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "home-hero-image": () => h(HeroNetwork),
    }),
};
