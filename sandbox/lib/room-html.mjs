// A room as one self-contained HTML page, for `GET /personas/:name/rooms/:peer?format=html`.
// An agent asserts on rendering here without a browser: every message body
// goes through the same `lib/markdown.mjs` pipeline the Room view uses, and
// the page's own text (names, times, labels) is escaped by hand.

import { JSDOM } from "jsdom";

import { createMarkdown, labelOf, textOf } from "./markdown.mjs";

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
const when = (ms) => new Date(ms).toISOString();

// Enough style to read a table and a code block; nothing the UI does not also do.
const STYLE = `
body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; color: #16181d; background: #f7f7f8; max-width: 720px; }
h1 { font-size: 16px; margin: 0 0 16px; }
article { margin: 8px 0; padding: 10px 12px; border-radius: 12px; background: #fff; }
article[data-direction="outgoing"] { background: #ececef; }
article[data-direction="system"] { background: none; text-align: center; color: #6b7280; }
header { font-size: 12px; color: #6b7280; display: flex; gap: 8px; }
.md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
.md table { border-collapse: collapse; } .md th, .md td { border-bottom: 1px solid #d9dbe0; padding: 4px 8px; text-align: left; }
.md pre { background: #f0f1f3; padding: 8px; border-radius: 8px; overflow-x: auto; } .md code { font-family: ui-monospace, monospace; font-size: 12px; }
.quote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid #d9dbe0; color: #6b7280; }
figure.attachment { margin: 6px 0 0; } figure.attachment img { display: block; max-width: 100%; height: auto; border-radius: 8px; } figcaption, .attachment { font-size: 12px; color: #6b7280; }
.placeholder { padding: 8px; border: 1px dashed #d9dbe0; border-radius: 8px; }
.md-empty, .label { color: #6b7280; font-style: italic; }
footer { font-size: 12px; color: #6b7280; }
`;

/** A renderer with its own jsdom window; make one per daemon and reuse it. */
export function createRoomRenderer() {
  const md = createMarkdown(new JSDOM("").window);
  const byId = (messages) => new Map(messages.map((m) => [m.messageId, m]));

  const quote = (target) => {
    if (!target) return `<blockquote class="quote">(message not available)</blockquote>`;
    const text = textOf(target.content);
    return `<blockquote class="quote">${text != null ? escape(text) : escape(labelOf(target.content))}</blockquote>`;
  };
  const status = (m) => {
    if (m.direction === "outgoing") return `${m.status}${m.device ? ` from #${m.device}` : ""}`;
    if (m.direction === "incoming") return `on #${m.receivedBy.join(",#")}${m.ackedBy.length ? ` acked #${m.ackedBy.join(",#")}` : ""}${m.read ? "" : " unread"}`;
    return "";
  };
  // An attachment: an image this device holds (sent, or claimed by it when
  // the page is a device's view) renders inline from the daemon's own media
  // route (never a URL the message named); any other held file is a download
  // link; a sibling device's claim, a claim in flight and a failure are text.
  // `../media/<id>` resolves under /api/personas/<name>/.
  const attachment = (device) => (a, i) => {
    const what = `${escape(a.kind)} ${escape(a.mimeType)} ${a.fileSize} bytes`;
    const held = a.mediaId && (a.status === "sent" || (a.status === "claimed" && (device == null || a.claimedBy === device)));
    if (held && a.kind === "image") return `<figure class="attachment" data-index="${i}" data-status="${escape(a.status)}"><img src="../media/${escape(a.mediaId)}" alt="${what}"${a.width ? ` width="${a.width}" height="${a.height}"` : ""}><figcaption>${what}</figcaption></figure>`;
    if (held) return `<p class="attachment" data-index="${i}" data-status="${escape(a.status)}"><a href="../media/${escape(a.mediaId)}" download>${what}</a></p>`;
    const state = a.status === "claimed" ? `claimed by device ${a.claimedBy}` : a.status === "claiming" ? `claiming on device ${a.claimedBy}` : a.status === "failed" ? `failed on device ${a.claimedBy}: ${a.error}` : "not claimed";
    return `<p class="attachment placeholder" data-index="${i}" data-status="${escape(a.status)}">${what} — ${escape(state)}</p>`;
  };
  const article = (view, m, all) => {
    const who = m.direction === "incoming" ? view.peerName ?? view.peer : m.direction === "system" ? "" : view.persona;
    const text = textOf(m.content);
    const attachments = (m.content.attachments ?? []).map(attachment(view.device ?? null)).join("\n");
    const body = text != null || m.content.type === "text" || m.content.type === "reply"
      ? `<div class="md">${md.render(text)}</div>`
      : attachments ? "" : `<div class="label">${escape(labelOf(m.content))}</div>`;
    const reply = m.content.type === "reply" ? quote(all.get(m.content.messageId)) : "";
    const reactions = m.reactions.length ? `<span class="reactions">${m.reactions.map((r) => `${escape(r.emoji)}${r.by === "me" ? "" : "·peer"}`).join(" ")}</span>` : "";
    return `<article data-id="${escape(m.messageId)}" data-direction="${m.direction}" data-status="${escape(m.status)}" data-type="${escape(m.content.type)}">
<header><span class="who">${escape(who)}</span><time datetime="${when(m.timestamp)}">${when(m.timestamp).slice(11, 19)}</time>${m.editedAt ? "<span>(edited)</span>" : ""}</header>
${reply}${body}${attachments ? `\n${attachments}` : ""}
<footer>${escape(status(m))}${reactions ? ` ${reactions}` : ""}</footer>
</article>`;
  };

  return {
    md,
    /** The page for one room view (`GET /personas/:name/rooms/:peer` JSON shape). */
    renderRoom(view) {
      const all = byId(view.messages);
      const title = `${view.persona} ⇄ ${view.peerName ?? view.peer}`;
      return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>${STYLE}</style></head>
<body><h1>${escape(title)}${view.room?.unreadCount ? ` · ${view.room.unreadCount} unread` : ""}</h1>
<main>
${view.messages.map((m) => article(view, m, all)).join("\n")}
</main></body></html>
`;
    },
  };
}
