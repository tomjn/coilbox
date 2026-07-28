/**
 * Minimal PNG encoder, and a reader for the uncompressed 24-bit BMPs the parts
 * atlas ships as.
 *
 * Written rather than pulled in because the converter runs once and this is the
 * only image work it does. Adaptive filtering is worth the extra 60 lines: on
 * the parts atlas it roughly halves the file against no filtering.
 */

import { deflateSync } from "node:zlib";

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, rgb: Uint8Array }} rows top down
 */
export function readBmp(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error("not a BMP file");
  }

  const dataOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);

  if (bitsPerPixel !== 24 || compression !== 0) {
    throw new Error(
      `only uncompressed 24-bit BMPs are supported, got ${bitsPerPixel}bpp compression ${compression}`,
    );
  }

  // A positive height means the rows are stored bottom up.
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;
  const stride = (width * 3 + 3) & ~3;

  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const source = dataOffset + (bottomUp ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const from = source + x * 3;
      const to = (y * width + x) * 3;
      // BMP stores BGR.
      rgb[to] = bytes[from + 2];
      rgb[to + 1] = bytes[from + 1];
      rgb[to + 2] = bytes[from];
    }
  }
  return { width, height, rgb };
}

/**
 * @param {{ width: number, height: number, rgb: Uint8Array }} image
 * @returns {Buffer} an 8-bit RGB PNG
 */
export function encodePng({ width, height, rgb }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10, 11, 12 stay 0: deflate, adaptive filtering, no interlace.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filter(width, height, rgb), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Prefix each scanline with the filter that minimises the sum of absolute
 * differences, which is the heuristic the PNG spec itself suggests.
 */
function filter(width, height, rgb) {
  const stride = width * 3;
  const out = Buffer.alloc(height * (stride + 1));
  const candidate = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const previous = row - stride;
    let bestType = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let type = 0; type < 5; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? rgb[row + i - 3] : 0;
        const b = y > 0 ? rgb[previous + i] : 0;
        const c = y > 0 && i >= 3 ? rgb[previous + i - 3] : 0;
        const value = (rgb[row + i] - predictor(type, a, b, c)) & 0xff;
        candidate[i] = value;
        // Signed distance from zero, the spec's heuristic.
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        candidate.copy(best);
      }
    }

    out[y * (stride + 1)] = bestType;
    best.copy(out, y * (stride + 1) + 1);
  }
  return out;
}

function predictor(type, a, b, c) {
  switch (type) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    default:
      return paeth(a, b, c);
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
