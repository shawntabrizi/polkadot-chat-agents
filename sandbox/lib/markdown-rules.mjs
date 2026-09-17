// The syntax the message pipeline adds on top of CommonMark + GFM tables and
// strikethrough (which markdown-it has built in). The target is what an AI
// agent writes unprompted and what Telegram's Rich Markdown renders:
//
//   ==marked==  ||spoiler||  <u> <ins> <sub> <sup> <mark> <tg-spoiler>
//   $inline math$   $$block math$$   ```math fences
//   - [ ] task lists      <details><summary>…</summary> … </details>
//   /commands as tappable buttons
//
// Raw HTML stays OFF in markdown-it. The tags above are recognised by name,
// one by one; every other `<…>` is text. An agent that writes `Vec<T>` must
// not lose the `<T>`, which a parse-then-sanitize pipeline would drop.
//
// Every rule leaves unclosed syntax as plain text, except `<details>`, which
// closes at the end of the message: a streamed answer is rendered many times
// before its last line exists.
//
// Plain ESM with no Node-only import, because Vite bundles it for the browser.

// markdown-it's text rule stops at a fixed set of characters, and an inline
// rule only ever runs where the text rule stopped. `|` is not in that set, so
// `||spoiler||` needs a text rule that also stops there.
const TERMINATORS = new Set("\n!#$%&*+-:<=>@[\\]^_`{}~|");
function text(state, silent) {
  let pos = state.pos;
  while (pos < state.posMax && !TERMINATORS.has(state.src[pos])) pos++;
  if (pos === state.pos) return false;
  if (!silent) state.pending += state.src.slice(state.pos, pos);
  state.pos = pos;
  return true;
}

// `open … close` around inline content that is parsed again, so `||**x**||`
// nests. Content that starts or ends with a space is not a pair: `a == b` and
// `a || b` are code-shaped prose, not formatting.
function pair(md, name, open, close, tag, attrs, { spaces = false } = {}) {
  md.inline.ruler.after("backticks", name, (state, silent) => {
    const start = state.pos;
    if (!state.src.startsWith(open, start)) return false;
    const from = start + open.length;
    const to = state.src.indexOf(close, from);
    if (to < 0 || to === from || to + close.length > state.posMax) return false;
    if (!spaces && (/\s/.test(state.src[from]) || /\s/.test(state.src[to - 1]))) return false;
    if (!silent) {
      const opening = state.push(`${name}_open`, tag, 1);
      opening.attrs = attrs.map((a) => [...a]);
      const max = state.posMax;
      state.pos = from;
      state.posMax = to;
      state.md.inline.tokenize(state);
      state.posMax = max;
      state.push(`${name}_close`, tag, -1);
    }
    state.pos = to + close.length;
    return true;
  });
}

const SPOILER = [["class", "md-spoiler"], ["tabindex", "0"]];
// name in the message -> [tag in the page, attrs]
const INLINE_TAGS = { u: ["u", []], ins: ["ins", []], sub: ["sub", []], sup: ["sup", []], mark: ["mark", []], "tg-spoiler": ["span", SPOILER] };

// `$x^2$`. The pandoc rule keeps prices out: the opening `$` has a non-space
// after it, the closing `$` a non-space before it and no digit after it, so
// "$5 or $10" is text.
function mathInline(state, silent) {
  const start = state.pos;
  if (state.src[start] !== "$" || state.src[start + 1] === "$" || /\s/.test(state.src[start + 1] ?? " ")) return false;
  let end = start;
  for (;;) {
    end = state.src.indexOf("$", end + 1);
    if (end < 0 || end >= state.posMax) return false;
    if (state.src[end - 1] === "\\") continue;
    if (/\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] ?? "")) continue;
    break;
  }
  if (!silent) state.push("math_inline", "math", 0).content = state.src.slice(start + 1, end);
  state.pos = end + 1;
  return true;
}

// `$$ … $$`, on one line or across lines.
function mathBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = (n) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  const first = line(startLine);
  if (!first.startsWith("$$")) return false;
  const lines = [];
  let last = startLine;
  const head = first.slice(2).trim();
  if (head.endsWith("$$")) lines.push(head.slice(0, -2));
  else {
    lines.push(head);
    for (last = startLine + 1; last < endLine; last++) {
      const t = line(last).trim();
      if (t.endsWith("$$")) { lines.push(t.slice(0, -2)); break; }
      lines.push(t);
    }
    if (last >= endLine) return false;
  }
  if (silent) return true;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = lines.join("\n").trim();
  token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

// <details [open]><summary>inline markdown</summary>
// block markdown
// </details>
const DETAILS_OPEN = /^<details(\s+open)?\s*>\s*(?:<summary>(.*?)<\/summary>)?(.*)$/;
const DETAILS_CLOSE = "</details>";
function details(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = (n) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  const m = DETAILS_OPEN.exec(line(startLine));
  if (!m) return false;
  if (silent) return true;

  const inline = (type, tag, content) => {
    state.push(`${type}_open`, tag, 1).map = [startLine, startLine + 1];
    const token = state.push("inline", "", 0);
    token.content = content;
    token.map = [startLine, startLine + 1];
    token.children = [];
    state.push(`${type}_close`, tag, -1);
  };
  const open = state.push("details_open", "details", 1);
  open.block = true;
  if (m[1]) open.attrs = [["open", ""]];
  if (m[2] != null) inline("summary", "summary", m[2].trim());

  let rest = m[3].trim();
  let closeLine = startLine;
  if (rest.endsWith(DETAILS_CLOSE)) rest = rest.slice(0, -DETAILS_CLOSE.length).trim();
  else {
    // The matching close, counting nested blocks. None yet (a streamed
    // answer): the block runs to the end.
    let depth = 1;
    for (closeLine = startLine + 1; closeLine < endLine; closeLine++) {
      const t = line(closeLine);
      depth += (t.match(/<details[\s>]/g) ?? []).length - (t.match(/<\/details>/g) ?? []).length;
      if (depth <= 0) break;
    }
  }
  if (rest) inline("paragraph", "p", rest);
  if (closeLine > startLine) {
    const closed = closeLine < endLine;
    // Text before the closing tag on its line belongs to the block.
    const lineEnd = closed ? state.eMarks[closeLine] : 0;
    if (closed) state.eMarks[closeLine] = state.src.lastIndexOf(DETAILS_CLOSE, lineEnd);
    const parentType = state.parentType;
    const lineMax = state.lineMax;
    state.parentType = "details";
    state.lineMax = closed ? closeLine + 1 : endLine;
    state.md.block.tokenize(state, startLine + 1, state.lineMax);
    state.parentType = parentType;
    state.lineMax = lineMax;
    if (closed) state.eMarks[closeLine] = lineEnd;
  }
  state.push("details_close", "details", -1).block = true;
  open.map = [startLine, Math.min(closeLine + 1, endLine)];
  state.line = open.map[1];
  return true;
}

// `- [ ] todo` and `- [x] done`: a disabled checkbox in front of the item.
function taskLists(state) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const first = tokens[i].children?.[0];
    const m = first?.type === "text" ? /^\[([ xX])\]\s+/.exec(first.content) : null;
    if (!m) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" disabled${m[1] === " " ? "" : " checked"}> `;
    tokens[i].children.unshift(box);
    tokens[i - 2].attrJoin("class", "md-task");
  }
}

// `/command`: a button the room sends on a tap, as Telegram does. Bounded by
// whitespace or sentence punctuation, so `/usr/bin` and `and/or` are text.
// Runs after text_join, or `/my_cmd` is still three tokens.
const COMMAND = /(^|[\s(])(\/[a-zA-Z][a-zA-Z0-9_]{0,31})(?=$|[\s.,;:!?)])/g;
function commands(state) {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out = [];
    let links = 0;
    for (const token of block.children) {
      if (token.type === "link_open") links++;
      if (token.type === "link_close") links--;
      if (token.type !== "text" || links > 0 || !token.content.includes("/")) { out.push(token); continue; }
      let last = 0;
      for (const m of token.content.matchAll(COMMAND)) {
        const at = m.index + m[1].length;
        const before = new state.Token("text", "", 0);
        before.content = token.content.slice(last, at);
        const button = new state.Token("command", "button", 0);
        button.content = m[2];
        out.push(before, button);
        last = at + m[2].length;
      }
      if (last === 0) { out.push(token); continue; }
      const after = new state.Token("text", "", 0);
      after.content = token.content.slice(last);
      out.push(after);
    }
    block.children = out;
  }
}

/** Installs every rule above. Rendering of `math_*` and `command` tokens is the pipeline's. */
export function richRules(md) {
  md.inline.ruler.at("text", text);
  pair(md, "mark", "==", "==", "mark", []);
  pair(md, "spoiler", "||", "||", "span", SPOILER);
  for (const [name, [tag, attrs]] of Object.entries(INLINE_TAGS)) pair(md, `tag_${name}`, `<${name}>`, `</${name}>`, tag, attrs, { spaces: true });
  md.inline.ruler.after("backticks", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.block.ruler.before("fence", "details", details, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.core.ruler.after("inline", "task_lists", taskLists);
  md.core.ruler.after("text_join", "commands", commands);
}
