// Colour swatches (BOT_COLOR_SWATCH=1, the pcdcolor demo bot). A user hex
// code or an image is answered here without a brain turn; a brain answer
// that names a hex code goes out as a swatch image with a caption. Every
// path sends ONE message (the attachment, or the text fallback when Bulletin
// is unavailable). No image model: the swatch is drawn pixel by pixel and
// encoded by lib/png.mjs; the dominant colour of an image is a histogram.
// A JPEG is decoded by jpeg-js (pure JavaScript, owner-approved dependency).
import jpeg from "jpeg-js";
import { decodePng, makePng } from "./png.mjs";

// ---------- hex codes ----------
// "#RRGGBB" or "#RGB" as a token; a bare 6-hex-digit token only when it
// mixes digits and letters ("ff8800"), so "decade" and "123456" stay words
// and numbers.
const HASH_HEX = /(?<![\w#&])#([0-9a-f]{6}|[0-9a-f]{3})(?![\w])/i;
const BARE_HEX = /(?<![\w#&])([0-9a-f]{6})(?![\w])/gi;

// The first colour token in `text`: { hex: "#RRGGBB", raw } or null.
const findHex = (text) => {
  const s = String(text ?? "");
  const m = HASH_HEX.exec(s);
  if (m) return { hex: normalizeHex(m[1]), raw: m[0] };
  for (const b of s.matchAll(BARE_HEX)) {
    if (/[0-9]/.test(b[1]) && /[a-f]/i.test(b[1])) return { hex: normalizeHex(b[1]), raw: b[0] };
  }
  return null;
};
/** The first colour in `text` as "#RRGGBB" (upper case), or null. */
export const parseHexColor = (text) => findHex(text)?.hex ?? null;
const normalizeHex = (h) => `#${(h.length === 3 ? [...h].map((c) => c + c).join("") : h).toUpperCase()}`;
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

// CSS named colours (CSS Color 4), for "the colour name if known": an exact
// match only. The first name wins where two share a value (aqua/cyan).
const CSS_NAMES = "AliceBlue F0F8FF AntiqueWhite FAEBD7 Aqua 00FFFF Aquamarine 7FFFD4 Azure F0FFFF Beige F5F5DC Bisque FFE4C4 Black 000000 BlanchedAlmond FFEBCD Blue 0000FF BlueViolet 8A2BE2 Brown A52A2A BurlyWood DEB887 CadetBlue 5F9EA0 Chartreuse 7FFF00 Chocolate D2691E Coral FF7F50 CornflowerBlue 6495ED Cornsilk FFF8DC Crimson DC143C DarkBlue 00008B DarkCyan 008B8B DarkGoldenrod B8860B DarkGray A9A9A9 DarkGreen 006400 DarkKhaki BDB76B DarkMagenta 8B008B DarkOliveGreen 556B2F DarkOrange FF8C00 DarkOrchid 9932CC DarkRed 8B0000 DarkSalmon E9967A DarkSeaGreen 8FBC8F DarkSlateBlue 483D8B DarkSlateGray 2F4F4F DarkTurquoise 00CED1 DarkViolet 9400D3 DeepPink FF1493 DeepSkyBlue 00BFFF DimGray 696969 DodgerBlue 1E90FF FireBrick B22222 FloralWhite FFFAF0 ForestGreen 228B22 Fuchsia FF00FF Gainsboro DCDCDC GhostWhite F8F8FF Gold FFD700 Goldenrod DAA520 Gray 808080 Green 008000 GreenYellow ADFF2F Honeydew F0FFF0 HotPink FF69B4 IndianRed CD5C5C Indigo 4B0082 Ivory FFFFF0 Khaki F0E68C Lavender E6E6FA LavenderBlush FFF0F5 LawnGreen 7CFC00 LemonChiffon FFFACD LightBlue ADD8E6 LightCoral F08080 LightCyan E0FFFF LightGoldenrodYellow FAFAD2 LightGray D3D3D3 LightGreen 90EE90 LightPink FFB6C1 LightSalmon FFA07A LightSeaGreen 20B2AA LightSkyBlue 87CEFA LightSlateGray 778899 LightSteelBlue B0C4DE LightYellow FFFFE0 Lime 00FF00 LimeGreen 32CD32 Linen FAF0E6 Maroon 800000 MediumAquamarine 66CDAA MediumBlue 0000CD MediumOrchid BA55D3 MediumPurple 9370DB MediumSeaGreen 3CB371 MediumSlateBlue 7B68EE MediumSpringGreen 00FA9A MediumTurquoise 48D1CC MediumVioletRed C71585 MidnightBlue 191970 MintCream F5FFFA MistyRose FFE4E1 Moccasin FFE4B5 NavajoWhite FFDEAD Navy 000080 OldLace FDF5E6 Olive 808000 OliveDrab 6B8E23 Orange FFA500 OrangeRed FF4500 Orchid DA70D6 PaleGoldenrod EEE8AA PaleGreen 98FB98 PaleTurquoise AFEEEE PaleVioletRed DB7093 PapayaWhip FFEFD5 PeachPuff FFDAB9 Peru CD853F Pink FFC0CB Plum DDA0DD PowderBlue B0E0E6 Purple 800080 RebeccaPurple 663399 Red FF0000 RosyBrown BC8F8F RoyalBlue 4169E1 SaddleBrown 8B4513 Salmon FA8072 SandyBrown F4A460 SeaGreen 2E8B57 Seashell FFF5EE Sienna A0522D Silver C0C0C0 SkyBlue 87CEEB SlateBlue 6A5ACD SlateGray 708090 Snow FFFAFA SpringGreen 00FF7F SteelBlue 4682B4 Tan D2B48C Teal 008080 Thistle D8BFD8 Tomato FF6347 Turquoise 40E0D0 Violet EE82EE Wheat F5DEB3 White FFFFFF WhiteSmoke F5F5F5 Yellow FFFF00 YellowGreen 9ACD32";
const NAMES = new Map();
{
  const parts = CSS_NAMES.split(" ");
  for (let i = 0; i < parts.length; i += 2) {
    const hex = `#${parts[i + 1]}`;
    if (!NAMES.has(hex)) NAMES.set(hex, parts[i].replace(/([a-z])([A-Z])/g, "$1 $2"));
  }
}
/** "Dark Orange" for "#FF8C00"; null for a value with no CSS name. */
export const colorName = (hex) => NAMES.get(hex) ?? null;

// ---------- the swatch ----------
// 5x7 glyphs, one 5-bit row per entry (bit 4 = leftmost pixel).
const GLYPHS = {
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
};
export const SWATCH_SIZE = 512;
const SCALE = 6; // one font pixel = 6x6 image pixels: "#RRGGBB" is 246 px wide
const ADVANCE = 6; // 5 columns + 1 blank

// Relative luminance (sRGB, WCAG): black text on light colours, white on dark.
const luminance = ([r, g, b]) => {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const textColorFor = (rgb) => (luminance(rgb) > 0.179 ? [0, 0, 0] : [255, 255, 255]);

/** A 512x512 PNG of `hex`: a 1-pixel darker border and the code at the bottom. */
export function swatchPng(hex) {
  const fill = hexToRgb(hex);
  const border = fill.map((v) => Math.round(v * 0.7));
  const ink = textColorFor(fill);
  const label = hex.toUpperCase();
  const textW = (label.length * ADVANCE - 1) * SCALE;
  const x0 = Math.floor((SWATCH_SIZE - textW) / 2);
  const y0 = SWATCH_SIZE - 32 - 7 * SCALE;
  const inText = (x, y) => {
    if (y < y0 || y >= y0 + 7 * SCALE || x < x0 || x >= x0 + textW) return false;
    const col = Math.floor((x - x0) / SCALE), row = Math.floor((y - y0) / SCALE);
    const glyph = GLYPHS[label[Math.floor(col / ADVANCE)]];
    const gx = col % ADVANCE;
    return gx < 5 && glyph != null && ((glyph[row] >> (4 - gx)) & 1) === 1;
  };
  const edge = SWATCH_SIZE - 1;
  return makePng(SWATCH_SIZE, SWATCH_SIZE, (x, y) => (x === 0 || y === 0 || x === edge || y === edge ? border : inText(x, y) ? ink : fill));
}

export const swatchCaption = (hex, name = colorName(hex)) => (name ? `${hex} — ${name}` : hex);

// ---------- the dominant colour of an image ----------
const MAX_SIDE = 512;
const SKIP_EXTREME_UNLESS = 0.6;

/**
 * { dominant, average } ("#RRGGBB") of decoded pixels. The image is sampled
 * down to at most 512 px on the long side, pixels under half alpha are
 * ignored, and the colours go into a 4-bit-per-channel histogram. The
 * dominant colour is the mean of the fullest bin; near-white and near-black
 * bins (a page, a background) only win when they hold more than 60 % of the
 * pixels. The average is the plain mean of every counted pixel.
 */
export function dominantColor({ width, height, channels, data }) {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / MAX_SIDE));
  const bins = new Map(); // bin -> [count, r, g, b]
  let total = 0;
  const sum = [0, 0, 0];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      if (channels === 4 && data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) ?? [0, 0, 0, 0];
      bin[0] += 1; bin[1] += r; bin[2] += g; bin[3] += b;
      bins.set(key, bin);
      total += 1; sum[0] += r; sum[1] += g; sum[2] += b;
    }
  }
  if (total === 0) return null;
  const extreme = (key) => {
    const q = [key >> 8, (key >> 4) & 15, key & 15];
    return q.every((v) => v >= 14) || q.every((v) => v <= 1);
  };
  let best = null, bestAny = null;
  for (const [key, bin] of bins) {
    if (!bestAny || bin[0] > bestAny[0]) bestAny = bin;
    if ((!extreme(key) || bin[0] > SKIP_EXTREME_UNLESS * total) && (!best || bin[0] > best[0])) best = bin;
  }
  const pick = best ?? bestAny; // only extremes, none over 60 %: the fullest anyway
  return {
    dominant: rgbToHex([pick[1] / pick[0], pick[2] / pick[0], pick[3] / pick[0]]),
    average: rgbToHex(sum.map((v) => v / total)),
  };
}

export const UNSUPPORTED_IMAGE_REPLY = "Please send a PNG or JPEG image.";
const isPng = (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
// RGBA pixels; the 50 MP cap matches decodePng's limit.
const decodeJpeg = (bytes) => {
  const { width, height, data } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 50 });
  return { width, height, channels: 4, data };
};

// ---------- the feature ----------
/**
 * sendImage(peerHex, { bytes, mime, caption }) sends one attachment and
 * throws when it cannot (no Bulletin, no authorization); sendText(peerHex,
 * text) is the fallback. readFile(path) returns the bytes of a fetched
 * attachment.
 */
export function createColorSwatch({ sendImage, sendText, readFile, log = () => {} }) {
  const send = async (peerHex, hex, caption, source) => {
    try {
      await sendImage(peerHex, { bytes: swatchPng(hex), mime: "image/png", caption });
      log("BOT_COLOR_SWATCH_SENT", { to: peerHex, hex, source });
    } catch (error) {
      log("BOT_COLOR_SWATCH_FALLBACK", { to: peerHex, hex, source, error: String(error?.message ?? error) });
      await sendText(peerHex, caption);
    }
  };

  const describeImage = (a) => {
    if (!a.downloaded) return { text: `I could not fetch that image: ${a.error ?? "unknown error"}` };
    const bytes = readFile(a.path);
    const decode = isPng(bytes) ? decodePng : isJpeg(bytes) ? decodeJpeg : null;
    if (!decode) return { text: UNSUPPORTED_IMAGE_REPLY };
    let colors;
    try { colors = dominantColor(decode(bytes)); } catch { return { text: UNSUPPORTED_IMAGE_REPLY }; }
    if (!colors) return { text: "That image is fully transparent: there is no colour to read." };
    return { hex: colors.dominant, caption: `Dominant ${colors.dominant} · average ${colors.average}` };
  };

  return {
    /**
     * A user message with an image or a hex code: answer it here (true), no
     * brain turn. Anything else: false, the brain answers.
     */
    async handleInbound(peerHex, msg) {
      const image = (msg.attachments ?? []).find((a) => a.fileKind === "image" || String(a.mime ?? "").startsWith("image/"));
      if (image) {
        const r = describeImage(image);
        if (r.hex) await send(peerHex, r.hex, r.caption, "image");
        else await sendText(peerHex, r.text);
        return true;
      }
      const hex = parseHexColor(msg.text);
      if (!hex) return false;
      await send(peerHex, hex, swatchCaption(hex), "user");
      return true;
    },

    /**
     * The brain's answer. With a hex code in it: a swatch whose caption is
     * "#RRGGBB — <name>" (the brain's **bold** name, else the CSS name) and
     * the rest of the answer on the next line. Without one: fallback(reply).
     */
    async deliverReply(peerHex, reply, fallback) {
      const text = String(reply ?? "");
      const found = findHex(text);
      if (!found) return fallback(text);
      const { hex } = found;
      const bold = /\*\*([^*\n]{1,60})\*\*/.exec(text);
      const name = bold ? bold[1].trim() : colorName(hex);
      // "**Teal** `#008080` — calm and steady." -> "calm and steady."
      const rest = text
        .replace(bold ? bold[0] : "", "")
        .replace(`\`${found.raw}\``, "").replace(found.raw, "")
        .replace(/^[\s—–:,-]+/, "")
        .trim()
        .slice(0, 1000);
      const caption = [swatchCaption(hex, name), rest].filter(Boolean).join("\n");
      try {
        await sendImage(peerHex, { bytes: swatchPng(hex), mime: "image/png", caption });
        log("BOT_COLOR_SWATCH_SENT", { to: peerHex, hex, source: "brain" });
      } catch (error) {
        log("BOT_COLOR_SWATCH_FALLBACK", { to: peerHex, hex, source: "brain", error: String(error?.message ?? error) });
        await fallback(text);
      }
    },
  };
}
