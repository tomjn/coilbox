/**
 * Gives the atlas the alpha channel an s3o texture has to carry.
 *
 * The engine reads an s3o's first texture's alpha as the team colour mask, 0
 * for the texture's own colour and 1 for the player's (`ModelFragProg.glsl`
 * in RecoilEngine). A PNG with no alpha channel loads as fully opaque, which is
 * a unit drawn entirely in team colour (issue #4164). KaiserJ's atlas has no
 * alpha, so the pack ships it with an alpha of 0 everywhere: no team colour at
 * all, and the parts' own colours. An atlas that already has an alpha channel
 * has a mask somebody drew, and is kept as it is.
 *
 * Only 8-bit RGB and RGBA PNGs without interlacing are read. That covers
 * KaiserJ's atlas, and anything else is refused by name rather than guessed at.
 */

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGB = 2;
const RGBA = 6;

/**
 * The atlas as an RGBA PNG: unchanged when it already has an alpha channel,
 * and with an alpha of 0 added when it has none.
 *
 * @param {Uint8Array} bytes the atlas PNG
 * @returns {{ bytes: Uint8Array, addedAlpha: boolean }}
 */
export function withTeamColourMask(bytes) {
  const png = readPng(bytes);
  if (png.colourType === RGBA) return { bytes, addedAlpha: false };

  const { width, height } = png;
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0, q = 0; p < png.pixels.length; p += 3, q += 4) {
    rgba[q] = png.pixels[p];
    rgba[q + 1] = png.pixels[p + 1];
    rgba[q + 2] = png.pixels[p + 2];
  }
  return { bytes: writePng(width, height, rgba, 4), addedAlpha: true };
}

/**
 * The PNG's size, colour type and unfiltered pixels.
 *
 * @param {Uint8Array} bytes
 */
export function readPng(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("the atlas must be a PNG");
  }

  let header = null;
  const data = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colourType: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "tRNS") {
      throw new Error(
        "the atlas has a tRNS chunk, which is transparency rather than a team colour mask",
      );
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }

  if (!header) throw new Error("the atlas PNG has no IHDR chunk");
  const { width, height, bitDepth, colourType, interlace } = header;
  if (bitDepth !== 8 || (colourType !== RGB && colourType !== RGBA)) {
    throw new Error(
      `the atlas must be an 8-bit RGB or RGBA PNG, and this one has colour type ${colourType} at ${bitDepth} bits`,
    );
  }
  if (interlace !== 0) throw new Error("the atlas PNG must not be interlaced");

  const channels = colourType === RGBA ? 4 : 3;
  const pixels = unfilter(
    inflateSync(Buffer.concat(data)),
    width,
    height,
    channels,
  );
  return { width, height, colourType, channels, pixels };
}

/** Undo PNG's per-row filters, giving the raw pixels with no filter bytes. */
function unfilter(filtered, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    const row = filtered.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const at = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[at + x - channels] : 0;
      const up = y > 0 ? out[at - stride + x] : 0;
      const corner =
        y > 0 && x >= channels ? out[at - stride + x - channels] : 0;
      out[at + x] = (row[x] + predict(filter, left, up, corner)) & 0xff;
    }
  }
  return out;
}

function predict(filter, left, up, corner) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, corner);
    default:
      throw new Error(`the atlas PNG uses an unknown row filter, ${filter}`);
  }
}

function paeth(left, up, corner) {
  const p = left + up - corner;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - corner);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : corner;
}

/**
 * An 8-bit RGB or RGBA PNG, by `channels`. Each row takes whichever filter
 * leaves the smallest sum of bytes, the heuristic the PNG specification
 * suggests, so the atlas does not grow much past the size it came in at.
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels
 * @param {3 | 4} channels
 */
export function writePng(width, height, pixels, channels) {
  const stride = width * channels;
  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const at = y * stride;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? pixels[at + x - channels] : 0;
        const up = y > 0 ? pixels[at - stride + x] : 0;
        const corner =
          y > 0 && x >= channels ? pixels[at - stride + x - channels] : 0;
        const value =
          (pixels[at + x] - predict(filter, left, up, corner)) & 0xff;
        candidate[x] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        filtered[y * (stride + 1)] = filter;
        candidate.copy(filtered, y * (stride + 1) + 1);
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? RGBA : RGB;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
