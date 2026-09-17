# Port brief: rich markdown in Polkadot Desktop

As of 2026-09-17. For a Claude Code session opened **in**
`~/Documents/GitHub/polkadot-desktop` (its `.claude/` skills, hooks and LSP
plugin load only there, and its `CLAUDE.md` makes the `architecture` skill
mandatory before any non-trivial change in `src/`).

## Goal

A message text renders as the sandbox renders it (decision D8 in
`decisions.md`): the text part of Telegram's Rich Markdown. No wire change:
`chat-spec/base-spec.md:639` already says `text: String? // markdown based text`.

## Where Desktop is today

- `src/features/chat/ui/partials/MessageBubble.tsx:154` renders the text as a
  plain `<p className="… whitespace-pre-line">` with `getPlainText(message.content)`.
- `src/features/chat/ui/partials/EditHistory.tsx:50` does the same for an
  edit-history row.
- `MessageBubble.tsx:144` shows a reply quote through `getMessagePreview`. It
  must show the text without its markup.
- `package.json` has no markdown, sanitizer, math or highlight package
  (checked: markdown-it, marked, remark, react-markdown, dompurify, katex,
  highlight.js, shiki). Check `@novasamatech/tr-ui` before adding any: the
  repo's rule is to lean on existing dependencies first.

## What to port

The source of truth is this repo, branch `feat/sandbox-rich-markdown`:

| File | What it is |
|---|---|
| `sandbox/lib/markdown.mjs` | The pipeline: markdown-it (raw HTML off, linkify, breaks), renderers for tables, code, math, commands; DOMPurify; `render(text)` and `plain(text)` |
| `sandbox/lib/markdown-rules.mjs` | The added syntax: `==mark==`, `\|\|spoiler\|\|`, the named inline tags, `$math$`, `$$block$$`, task lists, `<details>`, `/commands` |
| `sandbox/ui/src/MarkdownCell.tsx` | The React cell: click delegation for Copy and `/command`, the fade flag on boxes that scroll |
| `sandbox/ui/src/styles.css` (`.md…`) | The styles. Desktop uses Tailwind 4 and `tr-ui` tokens, so translate them; do not copy the file |
| `sandbox/test/markdown.test.mjs` | The acceptance list: each construct, and what must not get through |
| `sandbox/ui/src/MarkdownCell.test.tsx` | The cell's behaviour: a tapped `/command` reaches the room |
| `sandbox/test/fixtures/markdown-profile.json` | The same list as a neutral tree, for a client with no HTML |

Both files in `lib/` are plain ESM with no Node-only import. Packages, exact
versions: `markdown-it` 15.0.1, `dompurify` 3.4.14, `katex` 0.18.7 (MathML output only, so no stylesheet or font),
`highlight.js` 11.12.0 (`lib/common`).

## Decisions that must survive the port

1. Raw HTML stays off. Tags are recognised by name. `Vec<T>` keeps its `<T>`.
2. Unclosed syntax is text. An unclosed `<details>` closes at the end. A
   streamed answer renders at each step.
3. The HTML is inert. The view gives `data-copy` and `data-command` a
   behaviour. A tapped `/command` is sent at once.
4. An image is a link. The viewer never fetches a URL that a message names.
5. A table scrolls sideways in its own box. The bubble never grows.
6. A preview or a quote shows `plain()`, with a spoiler kept shut.

## Not in scope

Footnotes: removed from the profile on 2026-09-17 for simplicity and because
an in-page `#` link conflicts with Desktop's hash router (decision D8); to be
addressed later. Buttons (`<tg-button>`), media blocks, custom emoji and date entities. Buttons
need a callback message kind on the wire, which needs a chat-spec RFC.
No fallback design for other clients: the stack is pre-production.

## Verify

- Unit: port the cases of `sandbox/test/markdown.test.mjs` to a Vitest spec.
- End to end: run the sandbox on a testnet (`pcs up --network devnet`), pair
  Desktop, and send `sandbox`'s demo message from a persona. Compare with the
  sandbox Conversation view at 390 px. `npm run test:e2e:chat` must stay green.

## Open

- The PR target: `paritytech/polkadot-desktop` (this checkout's remote) or
  `Polkadot-Community-Foundation/polkadot-desktop-community` (separate git
  history). `package.json:7` names a third URL,
  `paritytech/polkadot-desktop-community`.
