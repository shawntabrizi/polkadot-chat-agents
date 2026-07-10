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
