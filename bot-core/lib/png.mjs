// The smallest PNG writer and reader the attachment path needs: a bot reply
// that carries a generated image, the e2e's test image, and the echo brain's
// proof that it decrypted a real image (it reads the dimensions from the
// decrypted bytes, not from the sender's metadata), and the colour bot's
// decoder (lib/color.mjs reads the pixels of an image a user sends).
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** An 8-bit RGB PNG; `pixel(x, y)` returns [r, g, b]. */
export function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** { width, height } from a PNG's IHDR, or null for anything else. */
export function pngDimensions(bytes) {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.length);
  if (b.length < 24 || !b.subarray(0, 8).equals(SIGNATURE) || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Decode an 8-bit, non-interlaced RGB or RGBA PNG to { width, height,
 * channels, data } (data: the unfiltered samples, row after row). Every
 * chunk CRC is checked. Throws on anything else (palette, grey, 16-bit,
 * interlaced): the colour bot asks for another image rather than guess.
 */
export function decodePng(bytes) {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.length);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let off = 8, header = null;
  const idat = [];
  while (off + 12 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (off + 12 + len > b.length) throw new Error("PNG chunk overruns the file");
    if (crc32(b.subarray(off + 4, off + 8 + len)) !== b.readUInt32BE(off + 8 + len)) throw new Error(`PNG ${type} CRC mismatch`);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!header) throw new Error("PNG has no IHDR");
  const { width, height, depth, color, interlace } = header;
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error("only 8-bit non-interlaced RGB or RGBA PNGs are supported");
  if (!width || !height || width * height > 50_000_000) throw new Error("PNG dimensions out of range");
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error("PNG image data has the wrong size");
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[row + i - channels] : 0;
      const up = y > 0 ? out[row - stride + i] : 0;
      const c = y > 0 && i >= channels ? out[row - stride + i - channels] : 0;
      const x = raw[src + i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + up;
      else if (filter === 3) v = x + ((a + up) >> 1);
      else if (filter === 4) v = x + paeth(a, up, c);
      else throw new Error(`PNG filter ${filter} is invalid`);
      out[row + i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
