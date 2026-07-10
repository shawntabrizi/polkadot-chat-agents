// Long-answer chunking: split one reply into parts that each fit a byte cap,
// so a long agent answer becomes several chat bubbles instead of one oversized
// statement submit (the node rejects anything over the account's statement
// allowance) or one unreadable wall of text.
//
// Split preference, in order: paragraph boundary (blank line), line boundary,
// hard byte split inside a single overlong line (never inside a UTF-8 code
// point). A split inside a fenced code block closes the fence at the cut and
// re-opens it (same marker + info string) at the top of the next part, so
// every part renders as valid markdown on its own. Pure function; unit-tested.

const byteLen = (s) => Buffer.byteLength(s, "utf8");

// Fence open/close markers: ``` or ~~~ (3+), optionally indented, with an
// info string on open. A closing line uses the same character, at least as
// long, and nothing but whitespace after.
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

// Hard-split one overlong line at UTF-8-safe boundaries (never inside a code
// point; surrogate pairs stay together).
const splitLineByBytes = (line, maxBytes) => {
  const pieces = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) { // iterates by code point
    const b = byteLen(ch);
    if (curBytes + b > maxBytes && cur) { pieces.push(cur); cur = ""; curBytes = 0; }
    cur += ch;
    curBytes += b;
  }
  if (cur) pieces.push(cur);
  return pieces;
};

export const splitMessageText = (text, maxBytes) => {
  const cap = Math.max(256, Number(maxBytes) || 0);
  if (byteLen(text) <= cap) return [text];

  const parts = [];
  let cur = []; // lines of the part being built
  let curBytes = 0;
  let fence = null; // { close: "```", reopen: "```lang" } while inside a fence
  let lastBlank = -1; // index in cur of the last blank line outside any fence

  const pushLine = (line, lineBytes) => {
    if (fence == null && line.trim() === "") lastBlank = cur.length;
    cur.push(line);
    curBytes += lineBytes + (cur.length > 1 ? 1 : 0); // +1 for the joining "\n"
  };

  const emit = (lines) => {
    // Trim blank edges: parts are separate messages, separators add nothing.
    let start = 0, end = lines.length;
    while (start < end && lines[start].trim() === "") start += 1;
    while (end > start && lines[end - 1].trim() === "") end -= 1;
    if (end > start) parts.push(lines.slice(start, end).join("\n"));
  };

  // Cut the current part. Prefer the last paragraph boundary (only when not
  // inside a fence — a fence cut must close/re-open instead).
  const cut = () => {
    if (fence == null && lastBlank > 0) {
      emit(cur.slice(0, lastBlank));
      cur = cur.slice(lastBlank + 1); // drop the blank separator itself
    } else if (fence != null) {
      emit([...cur, fence.close]);
      cur = [fence.reopen];
    } else {
      emit(cur);
      cur = [];
    }
    curBytes = cur.reduce((n, l, i) => n + byteLen(l) + (i > 0 ? 1 : 0), 0);
    lastBlank = -1;
  };

  for (const line of text.split("\n")) {
    const m = FENCE_RE.exec(line);
    if (m) {
      if (fence == null) fence = { close: m[1] + m[2], reopen: line };
      else if (m[2][0] === fence.close.trim()[0] && m[2].length >= fence.close.trim().length && m[3].trim() === "") fence = null;
    }
    // Reserve room for a fence-close line so a mid-fence cut still fits.
    const reserve = fence != null ? byteLen(fence.close) + 1 : 0;
    let lineBytes = byteLen(line);
    if (cur.length > 0 && curBytes + 1 + lineBytes + reserve > cap) cut();
    // A single line beyond the cap: hard-split it (fence reserve kept so the
    // close/re-open lines fit around the pieces).
    if (lineBytes + reserve > cap) {
      const pieces = splitLineByBytes(line, cap - reserve - (fence ? byteLen(fence.reopen) + 1 : 0));
      for (const piece of pieces.slice(0, -1)) { pushLine(piece, byteLen(piece)); cut(); }
      const last = pieces[pieces.length - 1] ?? "";
      lineBytes = byteLen(last);
      pushLine(last, lineBytes);
      continue;
    }
    pushLine(line, lineBytes);
  }
  emit(cur);
  return parts.length ? parts : [text.slice(0, cap)];
};
