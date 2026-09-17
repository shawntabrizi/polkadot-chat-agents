// The one markdown pipeline for message text: the browser UI and the daemon's
// `?format=html` room route render through this same module, so what an
// agent asserts on over HTTP is what a person sees in the Room view.
//
// The profile is what an AI agent writes unprompted, and what Telegram's Rich
// Markdown renders: CommonMark, GFM tables and strikethrough, task lists,
// LaTeX math, highlighted code, ==mark==, ||spoiler||, a few named
// inline tags, <details> blocks and tappable /commands (`markdown-rules.mjs`).
//
// markdown-it with raw HTML off (a message is data, not markup), linkify on
// (a bare URL becomes a link, as the phone shows it), breaks on (a newline in
// a chat message is a line break). Every link out opens in a new tab and
// carries rel="noopener noreferrer". The output then goes through DOMPurify
// against the given `window` (the browser's, or a jsdom window on the daemon)
// so a message can never inject markup or a javascript: URL into the page.
//
// The HTML is inert. What a tap does is the view's business, keyed on two
// attributes: `data-copy` (a code block's Copy button) and `data-command`
// (a /command). A spoiler opens on focus, in CSS alone.
//
// Plain ESM with no Node-only import, because Vite bundles it for the browser.

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import MarkdownIt from "markdown-it";

import { richRules } from "./markdown-rules.mjs";

const NOOPENER = "noopener noreferrer";

/** What an empty or unrenderable message shows instead of nothing. */
export const EMPTY_PLACEHOLDER = "(empty message)";

/**
 * A renderer bound to one DOM (`window`) for sanitizing.
 * @param {Window} window the browser's `window`, or a jsdom window on Node
 */
export function createMarkdown(window) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  md.use(richRules);
  const escape = md.utils.escapeHtml;

  // No images: a message must not make the viewer fetch an arbitrary URL.
  // `![alt](url)` becomes a link to the URL, opened on purpose or not at all.
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    const alt = token.content || src;
    return `<a href="${escape(src)}" target="_blank" rel="${NOOPENER}">${escape(alt)}</a>`;
  };
  // Links leave the sandbox UI; a new tab keeps the room open and noopener
  // keeps the opened page away from it.
  const renderLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", NOOPENER);
    return renderLink(tokens, idx, options, env, self);
  };
  // A table scrolls sideways inside its own box; the bubble never grows.
  md.renderer.rules.table_open = () => `<div class="md-table"><table>\n`;
  md.renderer.rules.table_close = () => `</table></div>\n`;
  // MathML only: the browser draws it, so there is no KaTeX stylesheet or
  // font to ship, and the daemon's page gets the same markup.
  const math = (tex, displayMode) => katex.renderToString(tex, { output: "mathml", displayMode, throwOnError: false, strict: "ignore" });
  md.renderer.rules.math_inline = (tokens, idx) => math(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) => `<div class="md-math">${math(tokens[idx].content, true)}</div>\n`;
  md.renderer.rules.command = (tokens, idx) => `<button type="button" class="md-command" data-command="${escape(tokens[idx].content)}">${escape(tokens[idx].content)}</button>`;
  // A code block: its language and a Copy button above the (highlighted) code.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0] ?? "";
    if (lang === "math") return `<div class="md-math">${math(token.content.trim(), true)}</div>\n`;
    const known = lang !== "" && hljs.getLanguage(lang) != null;
    const code = known ? hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value : escape(token.content);
    return `<div class="md-code"><div class="md-code-head"><span>${escape(lang || "code")}</span><button type="button" data-copy="">Copy</button></div>`
      + `<pre><code${lang ? ` class="language-${escape(lang)}"` : ""}>${code}</code></pre></div>\n`;
  };

  const purify = DOMPurify(window);
  // DOMPurify drops `target` unless asked; it keeps `rel`. javascript: and
  // data: hrefs never survive its URI check, and markdown-it refuses them
  // before that (they render as text).
  const sanitize = (html) => purify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true }, ADD_TAGS: ["semantics", "annotation"], ADD_ATTR: ["target", "encoding"] });

  /**
   * Sanitized HTML for one message text. Empty or whitespace-only text
   * renders the placeholder so a row is never blank.
   * @param {string | null | undefined} text
   * @returns {string}
   */
  const render = (text) => {
    if (typeof text !== "string" || text.trim() === "") return `<p class="md-empty">${EMPTY_PLACEHOLDER}</p>`;
    return sanitize(md.render(text));
  };

  return {
    render,
    /**
     * The message as one line of plain text, for a chat-list preview or a
     * reply quote: what the markup says, without the markup.
     * @param {string | null | undefined} text
     * @returns {string}
     */
    plain(text) {
      if (typeof text !== "string") return "";
      const box = window.document.createElement("div");
      box.innerHTML = render(text);
      for (const el of box.querySelectorAll("annotation, .md-code-head")) el.remove();
      // A preview must not give away what the message hides.
      for (const el of box.querySelectorAll(".md-spoiler")) el.textContent = "▒▒▒▒";
      return (box.textContent ?? "").replace(/\s+/g, " ").trim();
    },
  };
}

/**
 * The text a message content carries, or null when it has none (a call, a
 * system row, an unsupported kind). The room view renders text through
 * `render()` and everything else through a neutral label.
 * @param {{ type: string, text?: string | null, tag?: string, attachments?: unknown[] }} content
 */
export function textOf(content) {
  if (!content) return null;
  switch (content.type) {
    case "text":
    case "reply":
    case "richText":
      return content.text ?? null;
    default:
      return null;
  }
}

/** One line for a non-text row (system and unsupported kinds). */
export function labelOf(content) {
  switch (content?.type) {
    case "contactAdded": return "Chat accepted";
    case "leftChat": return "Left the chat";
    case "callOffer": return "Call offered";
    case "callDeclined": return "Call declined";
    case "unsupported": return `Unsupported message (${content.tag})`;
    case "richText": return content.attachments?.length ? `${content.attachments.length} attachment(s)` : null;
    default: return content?.type ? `Unknown message (${content.type})` : "Unknown message";
  }
}
