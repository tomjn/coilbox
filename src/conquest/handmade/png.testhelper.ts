import { inflateSync } from "node:zlib";
import type { ProvincePixels } from "./trace";

/**
 * Decode a PNG to RGBA pixels, for tests. The app decodes through a canvas,
 * and the repo has no PNG library, so this covers what the sample images use
 * and no more: 8 bits per channel, grey, RGB or RGBA, not interlaced.
 */
export function decodePng(bytes: Uint8Array): ProvincePixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  // Chunks follow the 8 byte signature: length, type, body, checksum.
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || ![0, 2, 6].includes(colorType)) {
        throw new Error("decodePng: only 8-bit grey, RGB and RGBA are handled");
      }
      channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
    } else if (type === "IDAT") {
      data.push(body);
    }
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const row = width * channels;
  const lines = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (row + 1)];
    for (let i = 0; i < row; i++) {
      const left = i >= channels ? lines[y * row + i - channels] : 0;
      const up = y > 0 ? lines[(y - 1) * row + i] : 0;
      const upLeft =
        y > 0 && i >= channels ? lines[(y - 1) * row + i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      lines[y * row + i] = (raw[y * (row + 1) + 1 + i] + predicted) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const from = p * channels;
    rgba[p * 4] = lines[from];
    rgba[p * 4 + 1] = channels === 1 ? lines[from] : lines[from + 1];
    rgba[p * 4 + 2] = channels === 1 ? lines[from] : lines[from + 2];
    rgba[p * 4 + 3] = channels === 4 ? lines[from + 3] : 255;
  }
  return { data: rgba, width, height };
}
