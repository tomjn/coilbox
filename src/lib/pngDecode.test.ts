// @vitest-environment happy-dom

import { zlibSync } from "fflate";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodePng,
  fullyTransparent,
  fullyTransparentPngPixels,
} from "./pngDecode";
import { restoreFullyTransparent } from "./springTexture";

/** A PNG chunk. The decoder never checks a CRC, so this writes none. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/**
 * Encode `pixels` (rows of `channels` bytes a pixel) as an 8-bit PNG of
 * `colourType`, filtering row `y` with filter `y % 5` so every filter is used.
 */
function encodePng(
  width: number,
  height: number,
  pixels: number[],
  colourType: number,
  { depth = 8, interlace = 0 } = {},
): Uint8Array {
  const channels = colourType === 6 ? 4 : colourType === 4 ? 2 : 3;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 ? 0 : pixels[y * stride + x];
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const left = at(x - channels, y);
      const above = at(x, y - 1);
      const corner = at(x - channels, y - 1);
      const paeth = () => {
        const p = left + above - corner;
        const [a, b, c] = [left, above, corner].map((v) => Math.abs(p - v));
        return a <= b && a <= c ? left : b <= c ? above : corner;
      };
      const predicted = [0, left, above, (left + above) >> 1, paeth()][filter];
      raw[y * (stride + 1) + 1 + x] = (at(x, y) - predicted) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([depth, colourType, 0, 0, interlace], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let filled = 0;
  for (const part of parts) {
    out.set(part, filled);
    filled += part.length;
  }
  return out;
}

/** A 7 by 6 RGBA picture with colour everywhere and alpha 0 everywhere, the
 *  shape of the converted `armsolar_dead.3do` sheet in issue #4238. */
function transparentArtwork(): number[] {
  const pixels: number[] = [];
  for (let i = 0; i < 7 * 6; i++)
    pixels.push((i * 37) & 255, (i * 11 + 5) & 255, 255 - i, 0);
  return pixels;
}

describe("decodePng", () => {
  it("keeps the colour of a PNG whose alpha is 0 everywhere", () => {
    const pixels = transparentArtwork();
    const decoded = decodePng(encodePng(7, 6, pixels, 6));
    expect(decoded?.width).toBe(7);
    expect(decoded?.height).toBe(6);
    expect([...(decoded?.data ?? [])]).toEqual(pixels);
  });

  it("expands grey with alpha to RGBA", () => {
    const decoded = decodePng(encodePng(2, 1, [10, 0, 200, 128], 4));
    expect([...(decoded?.data ?? [])]).toEqual([
      10, 10, 10, 0, 200, 200, 200, 128,
    ]);
  });

  it("leaves every other PNG to the webview", () => {
    expect(decodePng(encodePng(1, 1, [1, 2, 3], 2))).toBeUndefined();
    expect(
      decodePng(encodePng(1, 1, [1, 2, 3, 0], 6, { depth: 16 })),
    ).toBeUndefined();
    expect(
      decodePng(encodePng(1, 1, [1, 2, 3, 0], 6, { interlace: 1 })),
    ).toBeUndefined();
    expect(decodePng(new Uint8Array(64))).toBeUndefined();
  });
});

describe("fullyTransparent", () => {
  it("is true only when no pixel has any alpha", () => {
    expect(
      fullyTransparent(new Uint8ClampedArray([9, 9, 9, 0, 9, 9, 9, 0])),
    ).toBe(true);
    expect(
      fullyTransparent(new Uint8ClampedArray([9, 9, 9, 0, 9, 9, 9, 1])),
    ).toBe(false);
  });
});

describe("fullyTransparentPngPixels", () => {
  afterEach(() => vi.unstubAllGlobals());

  const serve = (bytes: Uint8Array) =>
    vi.stubGlobal("fetch", async () => new Response(bytes));

  it("decodes a PNG with no alpha anywhere", async () => {
    const pixels = transparentArtwork();
    serve(encodePng(7, 6, pixels, 6));
    const decoded = await fullyTransparentPngPixels(
      "coilbox://localhost/legotex/a.png",
    );
    expect([...(decoded?.data ?? [])]).toEqual(pixels);
  });

  it("leaves a PNG with any alpha to the webview", async () => {
    const pixels = transparentArtwork();
    pixels[3] = 255;
    serve(encodePng(7, 6, pixels, 6));
    expect(
      await fullyTransparentPngPixels("coilbox://localhost/legotex/b.png"),
    ).toBeUndefined();
  });
});

describe("restoreFullyTransparent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A 2D canvas that reads back what the webview decoded: on macOS, nothing
   *  at all for a PNG whose alpha is 0 everywhere. */
  function webviewDecodes(alpha: number) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = new ImageData(w, h);
        data.data[3] = alpha;
        return data;
      },
    } as unknown as CanvasRenderingContext2D);
  }

  it("puts back the colour of a texture with no alpha anywhere", async () => {
    const pixels = transparentArtwork();
    vi.stubGlobal(
      "fetch",
      async () => new Response(encodePng(7, 6, pixels, 6)),
    );
    webviewDecodes(0);
    const texture = new THREE.Texture({ width: 7, height: 6 });
    const version = texture.version;

    await restoreFullyTransparent(texture, "coilbox://localhost/legotex/c.png");

    const image = texture.image as ImageData;
    expect([image.width, image.height]).toEqual([7, 6]);
    expect([...image.data]).toEqual(pixels);
    expect(texture.version).toBeGreaterThan(version);
  });

  it("leaves a texture with any alpha as the webview decoded it", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    webviewDecodes(255);
    const decoded = { width: 7, height: 6 };
    const texture = new THREE.Texture(decoded);

    await restoreFullyTransparent(texture, "coilbox://localhost/legotex/d.png");

    expect(texture.image).toBe(decoded);
    expect(fetch).not.toHaveBeenCalled();
  });
});
