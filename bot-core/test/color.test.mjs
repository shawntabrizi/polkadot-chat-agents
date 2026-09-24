import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import jpeg from "jpeg-js";
import { UNSUPPORTED_IMAGE_REPLY, colorName, createColorSwatch, dominantColor, parseHexColor, swatchPng, textColorFor } from "../lib/color.mjs";
import { decodePng, makePng } from "../lib/png.mjs";

// The pcdcolor bot (BOT_COLOR_SWATCH=1): a hex code or an image is answered
// with a generated swatch and no brain turn, a brain answer's hex code
// becomes a swatch, and every path sends exactly ONE message (the statement
// budget), falling back to text when Bulletin cannot take the image.

test("hex parsing: #RRGGBB, #RGB and a bare mixed 6-hex word; words, numbers and wrong lengths are not colours", () => {
  const cases = {
    "#ff8800": "#FF8800",
    "make it #FF8800 please": "#FF8800",
    "#f80": "#FF8800",
    "(#0a0)": "#00AA00",
    "ff8800": "#FF8800",
    "try 00ff7f.": "#00FF7F",
    "#abc and #123456": "#AABBCC", // the first one wins
    // Words spelled with a-f only, and plain numbers: not colours without "#".
    decade: null, facade: null, "123456": null, "call 555123 now": null,
    // Wrong lengths and glued tokens.
    "#12345": null, "#1234567": null, "#abcd": null, "#ab": null,
    "a#ff8800": null, "ff8800x": null, "0xff8800": null, "&#123456;": null,
    "": null, "no colour here": null,
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(parseHexColor(text), want, JSON.stringify(text));
  assert.equal(parseHexColor(undefined), null);
});

test("colour names are exact CSS matches only", () => {
  assert.equal(colorName("#008080"), "Teal");
  assert.equal(colorName("#FF8C00"), "Dark Orange");
  assert.equal(colorName("#00FFFF"), "Aqua"); // aqua and cyan share a value: the first wins
  assert.equal(colorName("#FF8800"), null); // near Dark Orange is not Dark Orange
});

// Walk the chunks with node's own zlib.crc32, not lib/png.mjs's table: a
// wrong CRC or length would make phones and the desktop reject the image.
const chunksOf = (png) => {
  const b = Buffer.from(png);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    assert.ok(off + 12 + len <= b.length, `${type} overruns the file`);
    assert.equal(zlib.crc32(b.subarray(off + 4, off + 8 + len)), b.readUInt32BE(off + 8 + len), `${type} CRC`);
    chunks.push({ type, data: b.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  assert.equal(off, b.length, "no trailing bytes");
  return chunks;
};

test("swatch PNG: valid chunks and CRCs, 512x512 8-bit RGB, at most 20 KB for any colour", () => {
  for (const hex of ["#FF8800", "#000000", "#FFFFFF", "#008080", "#123456", "#FEDCBA"]) {
    const png = swatchPng(hex);
    assert.ok(png.length <= 20 * 1024, `${hex}: ${png.length} bytes`);
    const chunks = chunksOf(png);
    assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
    const ihdr = chunks[0].data;
    assert.equal(ihdr.length, 13);
    assert.deepEqual([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ...ihdr.subarray(8)], [512, 512, 8, 2, 0, 0, 0]);
    assert.equal(chunks[2].data.length, 0);
    // The image data inflates to exactly 512 rows of (filter byte + 512 RGB).
    assert.equal(zlib.inflateSync(chunks[1].data).length, 512 * (1 + 512 * 3));
  }
});

test("swatch pixels: the colour fills it, the border is darker, the code is drawn in a contrasting ink", () => {
  const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3)];
  const orange = decodePng(swatchPng("#FF8800"));
  assert.deepEqual(px(orange, 256, 100), [255, 136, 0]);
  assert.deepEqual(px(orange, 0, 0), [179, 95, 0]);
  assert.deepEqual(px(orange, 511, 300), [179, 95, 0]);
  const count = (img, rgb) => { let n = 0; for (let i = 0; i < img.data.length; i += 3) if (img.data[i] === rgb[0] && img.data[i + 1] === rgb[1] && img.data[i + 2] === rgb[2]) n += 1; return n; };
  // Light colours get black text, dark colours white: the code stays readable.
  assert.deepEqual(textColorFor([255, 136, 0]), [0, 0, 0]);
  assert.deepEqual(textColorFor([0, 0, 128]), [255, 255, 255]);
  assert.ok(count(orange, [0, 0, 0]) > 1000, "black text on orange");
  const navy = decodePng(swatchPng("#000080"));
  assert.ok(count(navy, [255, 255, 255]) > 1000, "white text on navy");
  // The text sits in the bottom band only.
  for (let y = 0; y < 400; y += 1) assert.notDeepEqual(px(orange, 256, y), [0, 0, 0]);
});

// A PNG with a chosen filter per row, so the decoder's unfilter is checked
// against all five filter types (makePng writes filter 0 only).
const filteredPng = (width, height, channels, pixel, filterOf) => {
  const stride = width * channels;
  const img = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) img.set(pixel(x, y), y * stride + x * channels);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const f = filterOf(y);
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i += 1) {
      const x = img[y * stride + i];
      const a = i >= channels ? img[y * stride + i - channels] : 0;
      const b = y > 0 ? img[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? img[(y - 1) * stride + i - channels] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { png, img };
};

test("PNG decoder: all five row filters, RGB and RGBA, round-trip exactly", () => {
  for (const channels of [3, 4]) {
    const pixel = (x, y) => [(x * 37 + y * 11) & 255, (x * 5 + y * 91) & 255, (x ^ y) & 255, 255 - x].slice(0, channels);
    const { png, img } = filteredPng(23, 10, channels, pixel, (y) => y % 5);
    const got = decodePng(png);
    assert.deepEqual([got.width, got.height, got.channels], [23, 10, channels]);
    assert.deepEqual(got.data, img);
  }
});

test("PNG decoder refuses what it cannot read: bad CRC, palette, 16-bit, interlaced, not a PNG", () => {
  const good = Buffer.from(makePng(4, 4, () => [1, 2, 3]));
  const badCrc = Buffer.from(good); badCrc[good.length - 20] ^= 0xff;
  assert.throws(() => decodePng(badCrc), /CRC mismatch/);
  const withHeader = (depth, color, interlace) => {
    const b = Buffer.from(good);
    b[24] = depth; b[25] = color; b[28] = interlace;
    b.writeUInt32BE(zlib.crc32(b.subarray(12, 29)), 29);
    return b;
  };
  assert.throws(() => decodePng(withHeader(8, 3, 0)), /8-bit non-interlaced RGB or RGBA/);
  assert.throws(() => decodePng(withHeader(16, 2, 0)), /8-bit non-interlaced RGB or RGBA/);
  assert.throws(() => decodePng(withHeader(8, 2, 1)), /8-bit non-interlaced RGB or RGBA/);
  assert.throws(() => decodePng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), /not a PNG/);
});

const decoded = (w, h, pixel) => decodePng(makePng(w, h, pixel));

test("dominant colour: the larger area wins, not the brighter or the first", () => {
  // 70 % teal on the right, 30 % red on the left.
  const r = dominantColor(decoded(100, 50, (x) => (x < 30 ? [220, 20, 20] : [0, 128, 128])));
  assert.equal(r.dominant, "#008080");
  // The plain average mixes both: 0.3 * red + 0.7 * teal.
  assert.equal(r.average, "#426060"); // [66, 95.6, 95.6]
});

test("dominant colour: a white page or black frame is skipped unless it is more than 60 % of the image", () => {
  // 55 % white page, 25 % blue, 20 % yellow: blue is the colour of the image.
  const page = dominantColor(decoded(100, 100, (x) => (x < 55 ? [250, 250, 250] : x < 80 ? [30, 60, 200] : [240, 200, 20])));
  assert.equal(page.dominant, "#1E3CC8");
  // 80 % black: black is the image.
  const night = dominantColor(decoded(100, 100, (x) => (x < 80 ? [5, 5, 5] : [200, 30, 30])));
  assert.equal(night.dominant, "#050505");
  // Transparent pixels do not count.
  const rgba = { width: 2, height: 1, channels: 4, data: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255]) };
  assert.equal(dominantColor(rgba).dominant, "#0000FF");
  assert.equal(dominantColor({ width: 1, height: 1, channels: 4, data: new Uint8Array([1, 2, 3, 0]) }), null);
});

// A seeded generator: the noise is the same on every run.
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 0x1000000;

test("dominant colour: a photo-like noise image has a stable average, and a large image is downsampled", () => {
  const noisy = (seed) => { const r = rng(seed); return decoded(300, 200, () => [100, 150, 50].map((m) => Math.max(0, Math.min(255, Math.round(m + (r() - 0.5) * 120))))); };
  const [a, b] = [dominantColor(noisy(1)), dominantColor(noisy(2))];
  const ch = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const [x, y] of ch(a.average).map((v, i) => [v, ch(b.average)[i]])) assert.ok(Math.abs(x - y) <= 1, `${a.average} vs ${b.average}`);
  ch(a.average).forEach((v, i) => assert.ok(Math.abs(v - [100, 150, 50][i]) <= 2, a.average));
  // 2048 x 1024: sampled every 4th pixel, the stripes still weigh 3:1.
  const big = dominantColor({ width: 2048, height: 1024, channels: 3, data: makeStripes(2048, 1024) });
  assert.equal(big.dominant, "#C81E1E");
});
const makeStripes = (w, h) => {
  const d = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) d.set(x < w * 0.75 ? [200, 30, 30] : [30, 30, 200], (y * w + x) * 3);
  return d;
};

// The feature with fake transports. `sent` records every outbound message.
const feature = ({ imageFails = false, files = {} } = {}) => {
  const sent = [];
  const f = createColorSwatch({
    sendImage: async (peer, o) => { if (imageFails) throw new Error("Bulletin attachments are not configured on this bot"); sent.push({ kind: "image", peer, ...o }); },
    sendText: async (peer, text) => { sent.push({ kind: "text", peer, text }); },
    readFile: (p) => files[p],
  });
  return { f, sent };
};
const centre = (png) => { const img = decodePng(png); const i = (256 * 512 + 256) * 3; return `#${[...img.data.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`; };

test("a user hex code is answered with a swatch and no brain turn", async () => {
  const { f, sent } = feature();
  let brainTurns = 0;
  const turn = async (msg) => { if (!(await f.handleInbound("peer", msg))) brainTurns += 1; };
  await turn({ text: "what about #ff8800?" });
  await turn({ text: "#008080" });
  assert.equal(brainTurns, 0);
  assert.deepEqual(sent.map((s) => [s.kind, s.mime, s.caption]), [["image", "image/png", "#FF8800"], ["image", "image/png", "#008080 — Teal"]]);
  assert.equal(centre(sent[0].bytes), "#FF8800");
  // No hex code: the brain answers, nothing is sent here.
  await turn({ text: "I feel calm today" });
  assert.equal(brainTurns, 1);
  assert.equal(sent.length, 2);
});

test("the brain's hex code becomes the swatch; its bold name and reason make the caption", async () => {
  const { f, sent } = feature();
  const fallback = [];
  await f.deliverReply("peer", "**Teal** `#008080` — calm and steady.", async (t) => fallback.push(t));
  assert.equal(fallback.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].caption, "#008080 — Teal\ncalm and steady.");
  assert.equal(centre(sent[0].bytes), "#008080");
  // A name the CSS list does not know still comes from the brain's bold text.
  await f.deliverReply("peer", "**Sunset Ember** `#ff5a1f` — warm.", async (t) => fallback.push(t));
  assert.equal(sent[1].caption, "#FF5A1F — Sunset Ember\nwarm.");
  // No hex code in the answer: the ordinary text reply, no image.
  await f.deliverReply("peer", "I could not pick a colour.", async (t) => fallback.push(t));
  assert.deepEqual(fallback, ["I could not pick a colour."]);
  assert.equal(sent.length, 2);
});

test("without Bulletin the reply falls back to ONE text message", async () => {
  const { f, sent } = feature({ imageFails: true });
  await f.handleInbound("peer", { text: "#ff8800" });
  assert.deepEqual(sent, [{ kind: "text", peer: "peer", text: "#FF8800" }]);
  const fallback = [];
  await f.deliverReply("peer", "**Teal** `#008080` — calm.", async (t) => fallback.push(t));
  assert.deepEqual(fallback, ["**Teal** `#008080` — calm."]);
  assert.equal(sent.length, 1);
});

test("an image gets a swatch of its dominant colour; a GIF or a failed fetch gets one text reply", async () => {
  const png = makePng(40, 40, (x) => (x < 30 ? [0, 128, 128] : [255, 255, 255]));
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
  const { f, sent } = feature({ files: { "/m/a.png": png, "/m/b.gif": gif } });
  let brainTurns = 0;
  const turn = async (msg) => { if (!(await f.handleInbound("peer", msg))) brainTurns += 1; };
  // An image with a caption that holds a hex code: the image wins.
  await turn({ text: "#ff0000", attachments: [{ fileKind: "image", mime: "image/png", downloaded: true, path: "/m/a.png" }] });
  await turn({ text: "", attachments: [{ fileKind: "image", mime: "image/gif", downloaded: true, path: "/m/b.gif" }] });
  await turn({ text: "", attachments: [{ fileKind: "image", mime: "image/png", downloaded: false, error: "gateway timeout" }] });
  assert.equal(brainTurns, 0);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].kind, "image");
  assert.match(sent[0].caption, /^Dominant #008080 · average #[0-9A-F]{6}$/);
  assert.equal(centre(sent[0].bytes), "#008080");
  assert.deepEqual(sent[1], { kind: "text", peer: "peer", text: UNSUPPORTED_IMAGE_REPLY });
  assert.deepEqual(sent[2], { kind: "text", peer: "peer", text: "I could not fetch that image: gateway timeout" });
});

// Phone photos are JPEG: the bot must read them, not refuse them. The photo
// is mostly teal on a white page, so the page must not win and the teal must
// survive lossy compression close enough to land in the same colour.
test("a JPEG photo gets a swatch of its dominant colour", async () => {
  const width = 64, height = 48;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(x < 48 ? [0, 128, 128, 255] : [255, 255, 255, 255], (y * width + x) * 4);
  }
  const photo = jpeg.encode({ width, height, data }, 90).data;
  const { f, sent } = feature({ files: { "/m/p.jpg": new Uint8Array(photo) } });
  assert.equal(await f.handleInbound("peer", { text: "", attachments: [{ fileKind: "image", mime: "image/jpeg", downloaded: true, path: "/m/p.jpg" }] }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "image");
  const [, dominant] = /^Dominant (#[0-9A-F]{6}) · average #[0-9A-F]{6}$/.exec(sent[0].caption);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(dominant.slice(i, i + 2), 16));
  assert.ok(r <= 8 && Math.abs(g - 128) <= 8 && Math.abs(b - 128) <= 8, `dominant ${dominant} is not teal`);
  assert.equal(centre(sent[0].bytes), dominant);
});
