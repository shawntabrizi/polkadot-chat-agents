import { defineConfig } from "vitepress";

// polkadot-chat-agents documentation site.
// Structure follows Diátaxis: Guide (learn) · Reference (facts) · Explanation (why).
export default defineConfig({
  title: "Polkadot Chat Agents",
  description:
    "Run AI agents as chat bots in the Polkadot app — over the Statement Store, end-to-end encrypted, no chat server.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  // GitHub Pages project site is served under /polkadot-chat-agents/.
  base: "/polkadot-chat-agents/",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/polkadot-chat-agents/favicon.svg" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  ],

  themeConfig: {
    logo: { light: "/logo-symbol-dark.svg", dark: "/logo-symbol-light.svg" },
    siteTitle: "Polkadot Chat Agents",

    nav: [
      { text: "Guide", link: "/guide/introduction", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/configuration", activeMatch: "/reference/" },
      { text: "Explanation", link: "/explanation/architecture", activeMatch: "/explanation/" },
      { text: "npm", link: "https://www.npmjs.com/package/polkadot-chat-agents" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting started",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Create your first bot", link: "/guide/first-bot" },
            { text: "Deploy to a server", link: "/guide/deploy" },
            { text: "Private & public bots", link: "/guide/access" },
          ],
        },
        {
          text: "Working with a bot",
          items: [
            { text: "Brains & engines", link: "/guide/brains" },
            { text: "Projects & worktrees", link: "/guide/projects" },
            { text: "In-chat commands", link: "/guide/commands" },
            { text: "Agent frameworks", link: "/guide/harnesses" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Configuration (env vars)", link: "/reference/configuration" },
            { text: "CLI commands", link: "/reference/cli" },
            { text: "Bridge HTTP API", link: "/reference/bridge" },
          ],
        },
      ],
      "/explanation/": [
        {
          text: "Explanation",
          items: [
            { text: "How it works", link: "/explanation/how-it-works" },
            { text: "Architecture", link: "/explanation/architecture" },
            { text: "Live replies", link: "/explanation/live-replies" },
            { text: "Roadmap", link: "/explanation/roadmap" },
            { text: "Chat protocol feedback", link: "/explanation/app-feedback" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/shawntabrizi/polkadot-chat-agents" },
    ],

    editLink: {
      pattern:
        "https://github.com/shawntabrizi/polkadot-chat-agents/edit/master/docs-site/:path",
      text: "Edit this page on GitHub",
    },

    search: { provider: "local" },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Runs on the Polkadot Statement Store · no chat server.",
    },
  },
});
