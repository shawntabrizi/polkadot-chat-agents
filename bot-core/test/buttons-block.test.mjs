import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonsFallbackText, parseButtonsBlock, toTxIntent, validateButtons } from "../lib/buttons-block.mjs";
import { decodeOpaqueMessageAt, decodeTxIntent, encodeOpaqueButtonsMessage } from "../vendor/app-chat-codec.mjs";
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
  assert.equal(parseButtonsBlock(block({ rows: [[{ label: "x", action: { tx: "00" } }]] })), null, "tx is an object, never raw bytes");
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

// Spec 0007 bot rule: a bot produces a tx button through the fenced block,
// and pca encodes it. The spec's own example must parse and encode.
const specTx = {
  chainId: `0x${"ab".repeat(32)}`,
  calls: [{ kind: 1, to: `0x${"11".repeat(20)}`, data: "0xdc29f1de", value: "10000000000" }],
  display: { title: "Top up", description: "Adds 1 PAS to your balance with Guide", amount: "1", asset: "PAS" },
  expiresAt: 1720000000000,
};

test("a tx action in the block becomes a TxIntent that encodes as Action tag 3", () => {
  const parsed = parseButtonsBlock(block({ rows: [[{ label: "Top up 1 PAS", action: { tx: specTx } }]] }));
  assert.ok(parsed, "the spec 0007 example is a valid block");
  const intent = parsed.rows[0][0].action.tx;
  assert.equal(intent.dryRunRequired, true, "dryRunRequired defaults to true (v1 requires it)");
  assert.equal(intent.calls[0].value, 10_000_000_000n);
  assert.deepEqual(intent.calls[0].data, Uint8Array.of(0xdc, 0x29, 0xf1, 0xde));
  const m = decodeOpaqueMessageAt(encodeOpaqueButtonsMessage({ text: parsed.text, rows: parsed.rows }), 0).value;
  const back = decodeTxIntent(m.rows[0][0].action.tx);
  assert.deepEqual(back.calls[0].to, new Uint8Array(20).fill(0x11));
  assert.equal(back.display.description, specTx.display.description);
  assert.equal(back.expiresAt, 1_720_000_000_000n);
});

// A malformed intent must stay text: a half-valid intent is a button that
// signs something other than what the brain meant.
test("a tx action that breaks a spec 0007 rule leaves the block as text", () => {
  const bad = (patch) => toTxIntent({ ...specTx, ...patch });
  const call = (patch) => bad({ calls: [{ ...specTx.calls[0], ...patch }] });
  assert.ok(toTxIntent(specTx));
  assert.equal(bad({ dryRunRequired: false }), null, "no signing without a dry-run");
  assert.equal(bad({ chainId: "0x1234" }), null, "chainId is a 32-byte genesis hash");
  assert.equal(bad({ expiresAt: 0 }), null);
  assert.equal(bad({ calls: [] }), null);
  assert.equal(bad({ calls: Array.from({ length: 9 }, () => specTx.calls[0]) }), null);
  assert.equal(bad({ extra: 1 }), null, "unknown keys are refused");
  assert.equal(bad({ display: { title: "x".repeat(61) } }), null);
  assert.equal(bad({ display: { title: "ok", description: "x".repeat(281) } }), null);
  assert.equal(call({ to: undefined }), null, "a Revive call needs a contract address");
  assert.equal(call({ to: "0x1234" }), null);
  assert.equal(call({ data: "deadbeef" }), null, "data is 0x hex");
  assert.equal(call({ value: "-1" }), null);
  assert.equal(call({ value: 1.5 }), null);
  assert.equal(call({ value: (1n << 128n).toString() }), null, "value is a u128");
  assert.equal(call({ kind: 0, gasRefTime: 1 }), null, "gas fields are for Revive calls only");
  assert.ok(call({ kind: 0, to: undefined, data: "0x0a03" }), "a raw call needs no to");
  assert.equal(toTxIntent({ ...specTx, calls: [{ ...specTx.calls[0], gasRefTime: "5", storageDepositLimit: 7 }] }).calls[0].gasRefTime, 5n);
});
