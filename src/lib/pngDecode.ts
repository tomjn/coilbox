/**
 * Reading a PNG's pixels without the webview, for the one picture the webview
 * gets wrong on macOS: a PNG whose alpha is 0 in every pixel (issue #4238).
 *
 * macOS's image decoder hands such a picture back with its colour zeroed as
 * well, in the decode itself, before WebGL or a canvas ever sees it. One pixel
 * of alpha anywhere and the colour comes back intact. Measured on
 * `objects3d/armsolar_dead.3do` out of Balanced Annihilation V15.9.8, whose
 * converted sheet holds 12925 pixels of colour under an alpha of 0: ImageIO's
 * own decode returns 0 of them, and the same sheet with one pixel at alpha 1
 * returns all 12925.
 *
 * Spring reads that alpha as the team-colour mask, so 0 everywhere is an
 * ordinary texture for a unit with no team colour, and the engine draws it in
 * its colours. A unit builder that hands it to the webview draws it black.
 *
 * Only what that case needs: 8 bits a channel, truecolour or grey with alpha,
 * not interlaced. Coilbox's own texture store writes 8-bit RGBA. Anything else
 * answers `undefined`, and the webview's own decode stands.
 */

import { unzlibSync } from "fflate";

import type { TexturePixels } from "./texturePixels";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG colour types with an alpha channel, and their bytes per pixel. */
const CHANNELS: Record<number, number> = { 4: 2, 6: 4 };

/**
 * The RGBA pixels of an 8-bit PNG with an alpha channel, row major from the top
 * left, or `undefined` for any other file.
 */
export function decodePng(bytes: Uint8Array): TexturePixels | undefined {
  if (bytes.length < 33) return undefined;
  if (!SIGNATURE.every((byte, at) => bytes[at] === byte)) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = bytes[24];
  const colourType = bytes[25];
  const interlace = bytes[28];
  const channels = CHANNELS[colourType];
  if (!channels || depth !== 8 || interlace !== 0) return undefined;
  if (width === 0 || height === 0) return undefined;

  const parts: Uint8Array[] = [];
  let size = 0;
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IDAT") {
      parts.push(bytes.subarray(at + 8, at + 8 + length));
      size += length;
    }
    if (type === "IEND") break;
    at += 12 + length;
  }
  const compressed = new Uint8Array(size);
  let filled = 0;
  for (const part of parts) {
    compressed.set(part, filled);
    filled += part.length;
  }

  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch {
    return undefined;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return undefined;

  const rows = unfilter(raw, stride, height, channels);
  if (!rows) return undefined;
  const data = new Uint8ClampedArray(width * height * 4);
  if (channels === 4) {
    data.set(rows);
  } else {
    for (let pixel = 0; pixel < width * height; pixel++) {
      const grey = rows[pixel * 2];
      data[pixel * 4] = grey;
      data[pixel * 4 + 1] = grey;
      data[pixel * 4 + 2] = grey;
      data[pixel * 4 + 3] = rows[pixel * 2 + 1];
    }
  }
  return { width, height, data };
}

/** Undo PNG's per-row filters, or `undefined` for a filter type PNG lacks. */
function unfilter(
  raw: Uint8Array,
  stride: number,
  height: number,
  bpp: number,
): Uint8Array | undefined {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const above = y > 0 ? out[up + x] : 0;
      const corner = x >= bpp && y > 0 ? out[up + x - bpp] : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = above;
          break;
        case 3:
          predicted = (left + above) >> 1;
          break;
        case 4:
          predicted = paeth(left, above, corner);
          break;
        default:
          return undefined;
      }
      out[row + x] = (raw[from + x] + predicted) & 0xff;
    }
  }
  return out;
}

function paeth(left: number, above: number, corner: number): number {
  const estimate = left + above - corner;
  const toLeft = Math.abs(estimate - left);
  const toAbove = Math.abs(estimate - above);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toAbove && toLeft <= toCorner) return left;
  return toAbove <= toCorner ? above : corner;
}

/** Whether every pixel of RGBA `data` has an alpha of 0. */
export function fullyTransparent(data: Uint8ClampedArray): boolean {
  for (let at = 3; at < data.length; at += 4) if (data[at] !== 0) return false;
  return true;
}

/**
 * The pixels of the PNG at `url` when its alpha is 0 in every pixel, which is
 * the one case where they differ from the webview's decode. `undefined` for
 * anything else, including a file that does not answer.
 */
export async function fullyTransparentPngPixels(
  url: string,
): Promise<TexturePixels | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const pixels = decodePng(new Uint8Array(await response.arrayBuffer()));
    return pixels && fullyTransparent(pixels.data) ? pixels : undefined;
  } catch {
    return undefined;
  }
}
