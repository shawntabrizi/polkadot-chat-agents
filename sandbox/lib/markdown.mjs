// The one markdown pipeline for message text: the browser UI and the daemon's
// `?format=html` room route render through this same module, so what an
// agent asserts on over HTTP is what a person sees in the Room view.
//
// markdown-it with raw HTML off (a message is data, not markup), linkify on
// (a bare URL becomes a link, as the phone shows it), breaks on (a newline in
// a chat message is a line break). Every link opens in a new tab and carries
// rel="noopener noreferrer". The output then goes through DOMPurify against
// the given `window` (the browser's, or a jsdom window on the daemon) so a
// message can never inject markup or a javascript: URL into the page.
//
// Plain ESM with no Node-only import, because Vite bundles it for the browser.

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const NOOPENER = "noopener noreferrer";

/** What an empty or unrenderable message shows instead of nothing. */
export const EMPTY_PLACEHOLDER = "(empty message)";

/**
 * A renderer bound to one DOM (`window`) for sanitizing.
 * @param {Window} window the browser's `window`, or a jsdom window on Node
 */
export function createMarkdown(window) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  // No images: a message must not make the viewer fetch an arbitrary URL.
  // `![alt](url)` becomes a link to the URL, opened on purpose or not at all.
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    const alt = token.content || src;
    return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="${NOOPENER}">${md.utils.escapeHtml(alt)}</a>`;
  };
  // Links leave the sandbox UI; a new tab keeps the room open and noopener
  // keeps the opened page away from it.
  const renderLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", NOOPENER);
    return renderLink(tokens, idx, options, env, self);
  };
  const purify = DOMPurify(window);
  // DOMPurify drops `target` unless asked; it keeps `rel`. javascript: and
  // data: hrefs never survive its URI check, and markdown-it refuses them
  // before that (they render as text).
  const sanitize = (html) => purify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });

  return {
    /**
     * Sanitized HTML for one message text. Empty or whitespace-only text
     * renders the placeholder so a row is never blank.
     * @param {string | null | undefined} text
     * @returns {string}
     */
    render(text) {
      if (typeof text !== "string" || text.trim() === "") return `<p class="md-empty">${EMPTY_PLACEHOLDER}</p>`;
      return sanitize(md.render(text));
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
