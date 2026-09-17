// Known answers for the shared markdown pipeline. Each case pins the exact
// sanitized HTML, so a change in markdown-it, DOMPurify or our options that
// alters what a message renders as (or what it lets through) is a red test,
// not a surprise in the Room view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { EMPTY_PLACEHOLDER, createMarkdown, labelOf, textOf } from "../lib/markdown.mjs";

const md = createMarkdown(new JSDOM("").window);

const cases = [
  ["a table sits in its own scroll box and keeps its column alignment", "| a | b |\n|:--|--:|\n| 1 | 2 |",
    "<div class=\"md-table\"><table>\n<thead>\n<tr>\n<th style=\"text-align:left\">a</th>\n<th style=\"text-align:right\">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td style=\"text-align:left\">1</td>\n<td style=\"text-align:right\">2</td>\n</tr>\n</tbody>\n</table></div>\n"],
  ["fenced code is highlighted under its language and a Copy button, and its content is escaped", "```js\nconst x = 1 < 2;\n```",
    "<div class=\"md-code\"><div class=\"md-code-head\"><span>js</span><button type=\"button\" data-copy=\"\">Copy</button></div><pre><code class=\"language-js\"><span class=\"hljs-keyword\">const</span> x = <span class=\"hljs-number\">1</span> &lt; <span class=\"hljs-number\">2</span>;\n</code></pre></div>\n"],
  ["fenced code without a language is escaped, not highlighted", "```\nx < y\n```",
    "<div class=\"md-code\"><div class=\"md-code-head\"><span>code</span><button type=\"button\" data-copy=\"\">Copy</button></div><pre><code>x &lt; y\n</code></pre></div>\n"],
  ["a nested list", "- one\n  - two\n- three",
    "<ul>\n<li>one\n<ul>\n<li>two</li>\n</ul>\n</li>\n<li>three</li>\n</ul>\n"],
  ["a task list is disabled checkboxes; `[x]` without a space is text", "- [x] done\n- [ ] todo\n- [x]nospace",
    "<ul>\n<li class=\"md-task\"><input type=\"checkbox\" disabled=\"\" checked=\"\"> done</li>\n<li class=\"md-task\"><input type=\"checkbox\" disabled=\"\"> todo</li>\n<li>[x]nospace</li>\n</ul>\n"],
  ["inline code with angle brackets is escaped, not markup", "use `<b>` here",
    "<p>use <code>&lt;b&gt;</code> here</p>\n"],
  ["a script tag is text", "<script>alert(1)</script> hi",
    "<p>&lt;script&gt;alert(1)&lt;/script&gt; hi</p>\n"],
  ["a javascript: link is not a link", "[x](javascript:alert(1))",
    "<p>[x](javascript:alert(1))</p>\n"],
  ["a raw URL is linkified, opens in a new tab with noopener", "see https://example.com/a?b=1 now",
    "<p>see <a href=\"https://example.com/a?b=1\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com/a?b=1</a> now</p>\n"],
  ["inline bold, italic, strikethrough and a markdown link", "**b** _i_ ~~s~~ [l](https://x.y)",
    "<p><strong>b</strong> <em>i</em> <s>s</s> <a href=\"https://x.y\" target=\"_blank\" rel=\"noopener noreferrer\">l</a></p>\n"],
  ["a heading, and a newline is a line break", "# Title\n\ntext\nnext",
    "<h1>Title</h1>\n<p>text<br>\nnext</p>\n"],
  ["an image is a link to its URL, never a fetch", "![alt](https://x.y/a.png)",
    "<p><a href=\"https://x.y/a.png\" target=\"_blank\" rel=\"noopener noreferrer\">alt</a></p>\n"],
  // The tag is text (the onclick never becomes an attribute); the URL inside it is still linkified.
  ["raw HTML in the message is escaped", "<a href=\"https://x.y\" onclick=\"steal()\">x</a>",
    "<p>&lt;a href=\"<a href=\"https://x.y\" target=\"_blank\" rel=\"noopener noreferrer\">https://x.y</a>\" onclick=\"steal()\"&gt;x&lt;/a&gt;</p>\n"],
  ["mark and spoiler, with markdown inside a spoiler", "==hot== and ||secret **bold**|| and <tg-spoiler>s</tg-spoiler>",
    "<p><mark>hot</mark> and <span class=\"md-spoiler\" tabindex=\"0\">secret <strong>bold</strong></span> and <span class=\"md-spoiler\" tabindex=\"0\">s</span></p>\n"],
  ["the named inline tags", "<u>u</u> <ins>i</ins> H<sub>2</sub>O x<sup>2</sup> <mark>m</mark>",
    "<p><u>u</u> <ins>i</ins> H<sub>2</sub>O x<sup>2</sup> <mark>m</mark></p>\n"],
  // An agent writes generics in prose; a parse-then-sanitize pipeline would eat the <T>.
  ["any other tag is text and loses nothing, and a named tag with an attribute is not that tag", "use Vec<T> and <b>bold</b> and <u onclick=\"x()\">y</u>",
    "<p>use Vec&lt;T&gt; and &lt;b&gt;bold&lt;/b&gt; and &lt;u onclick=\"x()\"&gt;y&lt;/u&gt;</p>\n"],
  ["code-shaped prose is not formatting", "if a == b and c == d or a || b || c",
    "<p>if a == b and c == d or a || b || c</p>\n"],
  ["unclosed syntax is text: a streamed answer renders before its last line exists", "streamed ==mark and ||spoiler and $math and <u>under",
    "<p>streamed ==mark and ||spoiler and $math and &lt;u&gt;under</p>\n"],
  ["inline math is MathML, and a price is not math", "$x^2$ costs $5 or $10",
    "<p><span class=\"katex\"><math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding=\"application/x-tex\">x^2</annotation></semantics></math></span> costs $5 or $10</p>\n"],
  ["block math", "$$E = mc^2$$",
    "<div class=\"md-math\"><span class=\"katex\"><math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding=\"application/x-tex\">E = mc^2</annotation></semantics></math></span></div>\n"],
  ["KaTeX commands that make links stay off", "$\\href{javascript:alert(1)}{x}$",
    "<p><span class=\"katex\"><math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow><mstyle mathcolor=\"#cc0000\"><mtext>\\href</mtext></mstyle></mrow><annotation encoding=\"application/x-tex\">\\href{javascript:alert(1)}{x}</annotation></semantics></math></span></p>\n"],
  ["a footnote's anchors carry the message id, so two messages on one page do not collide", "a[^1]\n\n[^1]: note",
    "<p>a<sup class=\"footnote-ref\"><a href=\"#fn-m1-1\" id=\"fnref-m1-1\">[1]</a></sup></p>\n<hr class=\"footnotes-sep\">\n<section class=\"footnotes\">\n<ol class=\"footnotes-list\">\n<li id=\"fn-m1-1\" class=\"footnote-item\"><p>note <a href=\"#fnref-m1-1\" class=\"footnote-backref\">↩︎</a></p>\n</li>\n</ol>\n</section>\n"],
  ["a link inside the page stays in this tab", "[top](#fn-m1-1)",
    "<p><a href=\"#fn-m1-1\">top</a></p>\n"],
  ["a details block: inline markdown in the summary, blocks in the body", "<details open><summary>T **b**</summary>\n\n- one\n\n</details>\n\nafter",
    "<details open=\"\">\n<summary>T <strong>b</strong></summary>\n<ul>\n<li>one</li>\n</ul>\n</details>\n<p>after</p>\n"],
  ["a details block still streaming closes at the end of the message", "<details><summary>T</summary>\n\nstill streaming",
    "<details>\n<summary>T</summary>\n<p>still streaming</p>\n</details>\n"],
  ["a /command is a button; a path, a URL and code are not", "send /reset or (/help), not /usr/bin or a/b or https://x.y/start or `/code`",
    "<p>send <button type=\"button\" class=\"md-command\" data-command=\"/reset\">/reset</button> or (<button type=\"button\" class=\"md-command\" data-command=\"/help\">/help</button>), not /usr/bin or a/b or <a href=\"https://x.y/start\" target=\"_blank\" rel=\"noopener noreferrer\">https://x.y/start</a> or <code>/code</code></p>\n"],
];

for (const [name, input, expected] of cases) {
  test(`markdown: ${name}`, () => { assert.equal(md.render(input, { id: "m1" }), expected); });
}

test("markdown: empty, whitespace-only and missing text render the placeholder", () => {
  const placeholder = `<p class="md-empty">${EMPTY_PLACEHOLDER}</p>`;
  assert.equal(md.render(""), placeholder);
  assert.equal(md.render("  \n "), placeholder);
  assert.equal(md.render(null), placeholder);
  assert.equal(md.render(undefined), placeholder);
});

test("markdown: fenced math is block math", () => {
  assert.equal(md.render("```math\nE = mc^2\n```"), md.render("$$E = mc^2$$"));
});

test("markdown: nested details close in order, and text before a closing tag stays in its block", () => {
  const html = md.render("<details><summary>outer</summary>\n\n<details>\ninner\n</details>\nlast</details>\n\nafter");
  assert.equal(html, "<details>\n<summary>outer</summary>\n<details>\n<p>inner</p>\n</details>\n<p>last</p>\n</details>\n<p>after</p>\n");
});

test("markdown: plain() is what the message says on one line, and keeps a spoiler shut", () => {
  assert.equal(md.plain("## T\n\n**b** ||secret|| `c` $x^2$ [l](https://x.y)\n\n| a |\n|---|\n| 1 |\n\n```js\nlet a;\n```"), "T b ▒▒▒▒ c x2 l a 1 let a;");
  assert.equal(md.plain(null), "");
});

test("markdown: textOf and labelOf split content into text and a neutral label", () => {
  assert.equal(textOf({ type: "text", text: "hi" }), "hi");
  assert.equal(textOf({ type: "reply", messageId: "m", text: "re" }), "re");
  assert.equal(textOf({ type: "richText", text: null, attachments: [] }), null);
  assert.equal(textOf({ type: "contactAdded" }), null);
  assert.equal(labelOf({ type: "contactAdded" }), "Chat accepted");
  assert.equal(labelOf({ type: "callDeclined" }), "Call declined");
  assert.equal(labelOf({ type: "unsupported", tag: "coinagePayment" }), "Unsupported message (coinagePayment)");
  assert.equal(labelOf({ type: "richText", text: null, attachments: [{}] }), "1 attachment(s)");
  assert.equal(labelOf({ type: "somethingNew" }), "Unknown message (somethingNew)");
  assert.equal(labelOf(undefined), "Unknown message");
});
