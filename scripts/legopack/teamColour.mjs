/**
 * Adds the team colour mask to KaiserJ's parts atlas (issue #4364).
 *
 *   bun run lego:atlas --atlas <lego2skin2048_2-2.png> [--out <atlas.png>]
 *
 * The atlas is three columns of the same panels. KaiserJ painted the first one
 * red to mark the team colour set, and shipped it with no alpha channel, so the
 * engine has no mask to read. In the release thread Forboding Angel, whose
 * Evolution RTS was built from this kit, wrote "The red pieces ARE teamcolor"
 * and turned the red into a mask by hand.
 *
 * This does the same by rule, so the result can be rebuilt. The engine draws an
 * s3o's first texture as `mix(rgb, teamColour, alpha)`. Each pixel of the first
 * column is split into how red it is and what is left over. The red becomes the
 * alpha and the rest becomes the colour, scaled so that a red player sees the
 * atlas exactly as KaiserJ drew it. Any other player sees their own colour where
 * the red was, darker where the red was darker, and paler where it was paler.
 * Pixels that are not red, such as the black and grey pieces drawn in the first
 * column, and everything in the tan and grey columns, keep an alpha of 0.
 *
 * The input must be the original RGB atlas. The output's colour has had the
 * red taken out, so a PNG that already has an alpha channel is refused rather
 * than masked a second time. The original is the file `pack.json` names under `source.atlas`, with the
 * sha256 under `source.atlasSha256`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The atlas columns, as `colourwayOf` in categorise.mjs counts them. */
const COLUMNS = 3;

/**
 * One pixel of the team colour column, split into colour and mask.
 *
 * `red` is how far the red channel stands above the other two. That much of
 * pure red becomes alpha. What is left is `(max(g, b), g, b)`, which is the
 * colour drawn under the team colour, divided by `1 - alpha` so the engine's
 * mix gives it back at full strength. The division cannot pass 255, because
 * `max(g, b)` is never more than `255 - red`.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {[number, number, number, number]}
 */
export function maskPixel(r, g, b) {
  const rest = Math.max(g, b);
  const alpha = Math.max(0, r - rest);
  if (alpha === 0) return [r, g, b, 0];
  if (alpha === 255) return [0, 0, 0, 255];
  const scale = 255 / (255 - alpha);
  const keep = (value) => Math.min(255, Math.round(value * scale));
  return [keep(rest), keep(g), keep(b), alpha];
}

/**
 * Whether pixel column `x` of an atlas `width` wide samples the team colour
 * column, judged at the pixel's centre the way `colourwayOf` judges a part's u.
 *
 * @param {number} x
 * @param {number} width
 */
export function inTeamColourColumn(x, width) {
  return Math.floor(((x + 0.5) / width) * COLUMNS) === 0;
}

/**
 * The atlas with its team colour mask, as RGBA pixels row major from the top.
 *
 * @param {{ width: number, height: number, rgb: Uint8Array }} image
 * @returns {Uint8Array}
 */
export function maskAtlas({ width, height, rgb }) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 3;
      const to = (y * width + x) * 4;
      const r = rgb[from];
      const g = rgb[from + 1];
      const b = rgb[from + 2];
      const pixel = inTeamColourColumn(x, width)
        ? maskPixel(r, g, b)
        : [r, g, b, 0];
      rgba.set(pixel, to);
    }
  }
  return rgba;
}

/**
 * The pixels of an 8-bit truecolour PNG with no alpha and no interlacing, which
 * is what KaiserJ's atlas is. Anything else is refused rather than guessed at.
 *
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, rgb: Uint8Array }}
 */
export function decodeRgbPng(bytes) {
  if (!SIGNATURE.every((byte, at) => bytes[at] === byte)) {
    throw new Error("the atlas is not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (bytes[24] !== 8 || bytes[25] !== 2 || bytes[28] !== 0) {
    throw new Error(
      "the atlas must be an 8-bit RGB PNG with no alpha and no interlacing, as KaiserJ's original is",
    );
  }
  const idat = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  if (raw.length < (stride + 1) * height) {
    throw new Error("the atlas's pixel data is short");
  }
  const rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rgb.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? out[i - 3] : 0;
      const up = above ? above[i] : 0;
      const corner = above && i >= 3 ? above[i - 3] : 0;
      out[i] = (line[i] + predict(filter, left, up, corner)) & 255;
    }
  }
  return { width, height, rgb };
}

/**
 * What a PNG filter adds back to a byte.
 *
 * @param {number} filter
 * @param {number} left
 * @param {number} up
 * @param {number} corner
 */
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
    case 4: {
      const p = left + up - corner;
      const pl = Math.abs(p - left);
      const pu = Math.abs(p - up);
      const pc = Math.abs(p - corner);
      if (pl <= pu && pl <= pc) return left;
      return pu <= pc ? up : corner;
    }
    default:
      throw new Error(
        `the atlas uses PNG filter ${filter}, which does not exist`,
      );
  }
}

/**
 * An 8-bit RGBA PNG. Each row is filtered with whichever of PNG's five filters
 * leaves the smallest sum of bytes, the usual rule, which keeps the file near
 * the size of the original.
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 */
export function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = Number.POSITIVE_INFINITY;
    for (let filter = 0; filter <= 4; filter++) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? line[i - 4] : 0;
        const up = above ? above[i] : 0;
        const corner = above && i >= 4 ? above[i - 4] : 0;
        const value = (line[i] - predict(filter, left, up, corner)) & 255;
        candidate[i] = value;
        cost += value < 128 ? value : 256 - value;
      }
      if (cost < best) {
        best = cost;
        raw[y * (stride + 1)] = filter;
        raw.set(candidate, y * (stride + 1) + 1);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * KaiserJ's RGB atlas in, the masked RGBA atlas out, both as PNG bytes.
 *
 * @param {Uint8Array} bytes
 */
export function teamColourAtlas(bytes) {
  const image = decodeRgbPng(bytes);
  return encodeRgbaPng(image.width, image.height, maskAtlas(image));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const atlas = value("--atlas");
  const out = value("--out") ?? "src-tauri/legoparts/atlas.png";
  if (!atlas) {
    console.error(
      "usage: bun run lego:atlas --atlas <lego2skin2048_2-2.png> [--out <atlas.png>]",
    );
    process.exit(1);
  }
  const written = teamColourAtlas(readFileSync(atlas));
  writeFileSync(out, written);
  console.log(`wrote ${out} (${written.length} bytes)`);
}
