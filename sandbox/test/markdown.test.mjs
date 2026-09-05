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
  ["a table", "| a | b |\n|---|---|\n| 1 | 2 |",
    "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n"],
  ["fenced code keeps its language and escapes its content", "```js\nconst x = 1 < 2;\n```",
    "<pre><code class=\"language-js\">const x = 1 &lt; 2;\n</code></pre>\n"],
  ["a nested list", "- one\n  - two\n- three",
    "<ul>\n<li>one\n<ul>\n<li>two</li>\n</ul>\n</li>\n<li>three</li>\n</ul>\n"],
  ["inline code with angle brackets is escaped, not markup", "use `<b>` here",
    "<p>use <code>&lt;b&gt;</code> here</p>\n"],
  ["a script tag is text", "<script>alert(1)</script> hi",
    "<p>&lt;script&gt;alert(1)&lt;/script&gt; hi</p>\n"],
  ["a javascript: link is not a link", "[x](javascript:alert(1))",
    "<p>[x](javascript:alert(1))</p>\n"],
  ["a raw URL is linkified, opens in a new tab with noopener", "see https://example.com/a?b=1 now",
    "<p>see <a href=\"https://example.com/a?b=1\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com/a?b=1</a> now</p>\n"],
  ["inline bold, italic and a markdown link", "**b** _i_ [l](https://x.y)",
    "<p><strong>b</strong> <em>i</em> <a href=\"https://x.y\" target=\"_blank\" rel=\"noopener noreferrer\">l</a></p>\n"],
  ["a heading, and a newline is a line break", "# Title\n\ntext\nnext",
    "<h1>Title</h1>\n<p>text<br>\nnext</p>\n"],
  ["an image is a link to its URL, never a fetch", "![alt](https://x.y/a.png)",
    "<p><a href=\"https://x.y/a.png\" target=\"_blank\" rel=\"noopener noreferrer\">alt</a></p>\n"],
  // The tag is text (the onclick never becomes an attribute); the URL inside it is still linkified.
  ["raw HTML in the message is escaped", "<a href=\"https://x.y\" onclick=\"steal()\">x</a>",
    "<p>&lt;a href=\"<a href=\"https://x.y\" target=\"_blank\" rel=\"noopener noreferrer\">https://x.y</a>\" onclick=\"steal()\"&gt;x&lt;/a&gt;</p>\n"],
];

for (const [name, input, expected] of cases) {
  test(`markdown: ${name}`, () => { assert.equal(md.render(input), expected); });
}

test("markdown: empty, whitespace-only and missing text render the placeholder", () => {
  const placeholder = `<p class="md-empty">${EMPTY_PLACEHOLDER}</p>`;
  assert.equal(md.render(""), placeholder);
  assert.equal(md.render("  \n "), placeholder);
  assert.equal(md.render(null), placeholder);
  assert.equal(md.render(undefined), placeholder);
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
