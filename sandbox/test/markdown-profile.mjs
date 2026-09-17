// The message profile as a tree that names no HTML: what a Kotlin or Swift
// client compares its own parser against. `markdown.test.mjs` pins the HTML of
// this pipeline; an app has no HTML, so `fixtures/markdown-profile.json` says
// the same thing as `{ type, children }` nodes with text as plain strings.
//
// The tree is read off the pipeline's sanitized HTML, so it can only say what
// the reference really renders.

const INLINE = { strong: "bold", em: "italic", s: "strike", u: "underline", ins: "underline", mark: "mark", sub: "subscript", sup: "superscript", code: "code" };
const has = (el, name) => el.classList?.contains(name);

function nodeOf(el) {
  const tag = el.tagName.toLowerCase();
  const kids = () => childrenOf(el);
  if (INLINE[tag]) return { type: INLINE[tag], children: kids() };
  if (/^h[1-6]$/.test(tag)) return { type: "heading", level: Number(tag[1]), children: kids() };
  if (has(el, "md-spoiler")) return { type: "spoiler", children: kids() };
  if (has(el, "md-command")) return { type: "command", name: el.dataset.command };
  if (has(el, "katex-error")) return { type: "math", display: false, tex: el.textContent, error: true };
  if (has(el, "katex")) return { type: "math", display: el.querySelector("math")?.getAttribute("display") === "block", tex: el.querySelector("annotation")?.textContent ?? "" };
  if (has(el, "md-math")) return nodeOf(el.firstElementChild);
  if (has(el, "md-code")) {
    const code = el.querySelector("code");
    return { type: "code_block", language: /language-(\S+)/.exec(code.className)?.[1] ?? null, text: code.textContent };
  }
  if (has(el, "md-table")) {
    const cells = (row) => [...row.children].map((cell) => childrenOf(cell));
    const head = el.querySelector("thead tr");
    return {
      type: "table",
      align: [...head.children].map((th) => /text-align:\s*(\w+)/.exec(th.getAttribute("style") ?? "")?.[1] ?? null),
      header: cells(head),
      rows: [...el.querySelectorAll("tbody tr")].map(cells),
    };
  }
  switch (tag) {
    case "p": return { type: "paragraph", children: kids() };
    case "br": return { type: "break" };
    case "hr": return { type: "rule" };
    case "blockquote": return { type: "quote", children: kids() };
    case "ul": case "ol": return { type: "list", ordered: tag === "ol", items: [...el.children].map(nodeOf) };
    case "li": {
      const box = has(el, "md-task") ? el.querySelector(":scope > input") : null;
      return { type: "item", ...(box ? { task: box.checked } : {}), children: kids() };
    }
    case "a": return { type: "link", href: el.getAttribute("href"), children: kids() };
    case "pre": return { type: "code_block", language: null, text: el.textContent };
    case "details": {
      const summary = el.querySelector(":scope > summary");
      return { type: "details", open: el.hasAttribute("open"), summary: summary ? childrenOf(summary) : [], children: childrenOf(el).filter((n) => n.type !== "summary") };
    }
    case "summary": return { type: "summary" };
    case "input": return null;
    default: throw new Error(`markdown profile: no neutral name for <${tag} class="${el.className}">`);
  }
}

// A newline in the HTML is the renderer's own (a line break in the message is
// a `break` node), so text is what is left without them.
function childrenOf(el) {
  const out = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      let text = child.textContent.replace(/\n/g, "");
      if (child.previousSibling?.nodeName === "INPUT") text = text.trimStart();
      if (text === "") continue;
      if (typeof out[out.length - 1] === "string") out[out.length - 1] += text;
      else out.push(text);
    } else if (child.nodeType === 1) {
      const node = nodeOf(child);
      if (node) out.push(node);
    }
  }
  return out;
}

/**
 * The neutral tree of one message text.
 * @param {{ render(text: string): string }} md a `createMarkdown(window)` renderer
 * @param {Window} window the DOM `md` was bound to
 * @param {string} text
 */
export function structureOf(md, window, text) {
  const box = window.document.createElement("div");
  box.innerHTML = md.render(text);
  return childrenOf(box);
}
