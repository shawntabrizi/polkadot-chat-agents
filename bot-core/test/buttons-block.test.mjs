import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonsFallbackText, parseButtonsBlock, validateButtons } from "../lib/buttons-block.mjs";
import { buttonPressText, createSentButtons } from "../lib/button-presses.mjs";

const block = (json) => `Pick one\n\n\`\`\`buttons\n${typeof json === "string" ? json : JSON.stringify(json)}\n\`\`\`\n`;
const rowsOf = (n, width = 1) => Array.from({ length: n }, (_, r) => Array.from({ length: width }, (_, i) => ({ label: `B${r}${i}`, action: { command: `c${r}${i}` } })));

test("a valid trailing block becomes rows; the text keeps what came before it", () => {
  const parsed = parseButtonsBlock(block({
    rows: [
      [{ label: "Echo", action: { command: "echo hi" } }, { label: "Colour", action: { callback: "base64:AQI=" } }],
      [{ label: "Docs", action: { url: "https://polkadot.com" } }, { label: "More", action: { callback: "page-2" } }],
    ],
    oneShot: true,
  }));
  assert.equal(parsed.text, "Pick one");
  assert.equal(parsed.oneShot, true);
  assert.deepEqual(parsed.rows[0][0], { label: "Echo", action: { command: "echo hi" } });
  assert.deepEqual(parsed.rows[0][1].action.callback, Uint8Array.of(1, 2), "base64: prefix gives raw bytes");
  assert.deepEqual(parsed.rows[1][0].action, { url: "https://polkadot.com" });
  assert.deepEqual(parsed.rows[1][1].action.callback, new TextEncoder().encode("page-2"), "plain callback is UTF-8");
  assert.equal(parseButtonsBlock(block({ rows: rowsOf(1) })).oneShot, false, "oneShot defaults to false");
});

// An invalid block must stay visible as text: dropping it would silently
// lose the brain's choices, and sending it half-parsed would show wrong ones.
test("an invalid or misplaced block is left as text (null)", () => {
  assert.equal(parseButtonsBlock("plain answer"), null);
  assert.equal(parseButtonsBlock(block("{not json")), null);
  assert.equal(parseButtonsBlock(block({ rows: [] })), null);
  assert.equal(parseButtonsBlock(block({ rows: [[{ label: "x", action: { tx: "00" } }]] })), null, "tx is not for brains");
  assert.equal(parseButtonsBlock(block({ rows: [[{ label: "x", action: { url: "http://insecure.example" } }]] })), null, "https or polkadotapp only");
  assert.equal(parseButtonsBlock(block({ rows: [[{ label: "x", action: { command: "a", url: "https://a.b" } }]] })), null, "one action per button");
  assert.equal(parseButtonsBlock(block({ rows: rowsOf(1), oneShot: "yes" })), null);
  assert.equal(parseButtonsBlock(`${block({ rows: rowsOf(1) })}and then more text`), null, "the block must END the reply");
  assert.equal(parseButtonsBlock("text ```buttons\n{\"rows\":[[{\"label\":\"a\",\"action\":{\"command\":\"b\"}}]]}\n```"), null, "the fence must start a line");
});

test("limits: 8 rows x 4 buttons, 40-character labels, 256-byte callbacks", () => {
  assert.ok(parseButtonsBlock(block({ rows: rowsOf(8, 4) })));
  assert.equal(parseButtonsBlock(block({ rows: rowsOf(9) })), null);
  assert.equal(parseButtonsBlock(block({ rows: rowsOf(1, 5) })), null);
  const label = (text) => ({ rows: [[{ label: text, action: { command: "x" } }]] });
  assert.ok(validateButtons(label("é".repeat(40))), "40 characters, not bytes");
  assert.equal(validateButtons(label("x".repeat(41))), null);
  assert.equal(validateButtons(label("   ")), null);
  const callback = (text) => ({ rows: [[{ label: "x", action: { callback: text } }]] });
  assert.ok(validateButtons(callback("x".repeat(256))));
  assert.equal(validateButtons(callback("x".repeat(257))), null);
  assert.equal(validateButtons(callback("base64:not base64!")), null);
});

test("the fallback is the text, then the labels as a numbered list in row order", () => {
  const { text, rows } = parseButtonsBlock(block({ rows: [[{ label: "Echo", action: { command: "e" } }, { label: "Colour", action: { callback: "c" } }], [{ label: "Docs", action: { url: "https://polkadot.com" } }]] }));
  assert.equal(buttonsFallbackText(text, rows), "Pick one\n\n1. Echo\n2. Colour\n3. Docs");
  assert.equal(buttonsFallbackText("", rows), "1. Echo\n2. Colour\n3. Docs");
});

// Spec 0006 recipient rule: a press counts only for a message the bot sent,
// and only from the peer it went to.
test("a press resolves only for the bot's own buttons message to that peer", () => {
  const sent = createSentButtons({ cap: 2 });
  sent.record("alice", "BTN-1", [[{ label: "Echo" }, { label: "Colour" }]]);
  assert.equal(sent.label("alice", "BTN-1", 0, 1), "Colour");
  assert.equal(sent.label("bob", "BTN-1", 0, 1), null, "another peer's press is foreign");
  assert.equal(sent.label("alice", "BTN-X", 0, 0), null, "unknown message id");
  assert.equal(sent.label("alice", "BTN-1", 1, 0), null, "no such button");
  const restored = createSentButtons();
  restored.restore("alice", JSON.parse(JSON.stringify(sent.snapshot("alice"))));
  assert.equal(restored.label("alice", "BTN-1", 0, 0), "Echo", "presses after a restart still resolve");
  sent.record("alice", "BTN-2", [[{ label: "a" }]]);
  sent.record("alice", "BTN-3", [[{ label: "b" }]]);
  assert.equal(sent.label("alice", "BTN-1", 0, 0), null, "bounded per peer: the oldest is evicted");
  assert.equal(buttonPressText("Colour", Uint8Array.of(1, 2)), "[button] Colour (payload: 0102)");
  assert.equal(buttonPressText("Echo", new Uint8Array(0)), "[button] Echo");
});
