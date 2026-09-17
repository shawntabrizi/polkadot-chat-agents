import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMessageText } from "../lib/chunk.mjs";

const byteLen = (s) => Buffer.byteLength(s, "utf8");

test("short text is returned as a single part", () => {
  assert.deepEqual(splitMessageText("hello", 4000), ["hello"]);
});

test("splits at paragraph boundaries and preserves all content", () => {
  const paras = Array.from({ length: 10 }, (_, i) => `paragraph ${i} ${"x".repeat(120)}`);
  const text = paras.join("\n\n");
  const parts = splitMessageText(text, 300);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(byteLen(p) <= 300, `part exceeds cap: ${byteLen(p)}`);
  // No paragraph is torn apart, and nothing is lost or reordered.
  assert.deepEqual(parts.flatMap((p) => p.split("\n\n")), paras);
});

test("falls back to line boundaries inside one huge paragraph", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i} ${"y".repeat(50)}`);
  const text = lines.join("\n");
  const parts = splitMessageText(text, 256);
  for (const p of parts) assert.ok(byteLen(p) <= 256);
  assert.deepEqual(parts.flatMap((p) => p.split("\n")), lines);
});

test("re-opens code fences across splits so every part is valid markdown", () => {
  const code = Array.from({ length: 30 }, (_, i) => `const x${i} = ${i}; // ${"pad".repeat(10)}`);
  const text = ["intro", "", "```js", ...code, "```", "", "outro"].join("\n");
  const parts = splitMessageText(text, 400);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(byteLen(p) <= 400);
    // Fences balance within each part.
    const fences = p.split("\n").filter((l) => /^\s*```/.test(l));
    assert.equal(fences.length % 2, 0, `unbalanced fences in part: ${p}`);
  }
  // The language survives on re-opened fences.
  const reopened = parts.slice(1).filter((p) => p.startsWith("```js"));
  assert.ok(reopened.length >= 1);
  // All code lines survive, in order.
  const kept = parts.flatMap((p) => p.split("\n")).filter((l) => l.startsWith("const x"));
  assert.deepEqual(kept, code);
});

test("hard-splits a single overlong line without breaking UTF-8", () => {
  const text = "🎉".repeat(500); // 2000 bytes, no line/paragraph boundaries
  const parts = splitMessageText(text, 300);
  for (const p of parts) {
    assert.ok(byteLen(p) <= 300);
    assert.ok(!p.includes("�"));
    assert.equal(p.length % 2, 0); // surrogate pairs intact
  }
  assert.equal(parts.join(""), text);
});

test("enforces a sane minimum cap", () => {
  const parts = splitMessageText("abc def ghi", 1); // cap clamps to 256
  assert.deepEqual(parts, ["abc def ghi"]);
});

// A part is its own chat message. Rows without their header and delimiter
// rows are not a table: the peer sees lines of pipes.
const tableRows = (part) => part.split("\n").filter((l) => l.startsWith("|"));
const HEADER = "| crate | status |";
const DELIM = "|:------|-------:|";

test("a table cut between rows re-opens with its header, and no row is lost or repeated", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| crate-${i} ${"z".repeat(20)} | ok |`);
  const parts = splitMessageText([HEADER, DELIM, ...rows].join("\n"), 400);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(byteLen(p) <= 400, `part exceeds cap: ${byteLen(p)}`);
    assert.deepEqual(tableRows(p).slice(0, 2), [HEADER, DELIM], `part does not open as a table: ${p}`);
  }
  assert.deepEqual(parts.flatMap((p) => tableRows(p).slice(2)), rows);
});

test("a table that fits in one part moves whole instead of being cut", () => {
  const intro = Array.from({ length: 6 }, (_, i) => `intro line ${i} ${"w".repeat(40)}`).join("\n");
  const table = [HEADER, DELIM, "| a | ok |", "| b | ok |"].join("\n");
  const parts = splitMessageText(`${intro}\n\n${table}\n\noutro`, 360);
  assert.equal(parts.filter((p) => p.includes("|")).length, 1, "the table is in exactly one part");
  assert.ok(parts.some((p) => p.includes(table)));
});

test("a cut that lands between a header and its delimiter row takes the header along", () => {
  const filler = Array.from({ length: 5 }, (_, i) => `filler ${i} ${"v".repeat(40)}`);
  // No blank line before the table, so there is no paragraph boundary to fall back on.
  const text = [...filler, HEADER, DELIM, "| a | ok |"].join("\n");
  const cap = byteLen([...filler, HEADER].join("\n")) + 2;
  const parts = splitMessageText(text, Math.max(256, cap));
  const withTable = parts.filter((p) => p.includes("|"));
  assert.equal(withTable.length, 1);
  assert.deepEqual(tableRows(withTable[0]), [HEADER, DELIM, "| a | ok |"]);
});

test("pipes in prose and a horizontal rule do not start a table", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `a | b line ${i} ${"u".repeat(40)}`);
  const text = [...lines.slice(0, 15), "---", ...lines.slice(15)].join("\n");
  const parts = splitMessageText(text, 300);
  assert.deepEqual(parts.flatMap((p) => p.split("\n")), text.split("\n"));
});
