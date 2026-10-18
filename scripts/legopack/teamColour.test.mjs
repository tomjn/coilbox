import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { decodePng } from "../../src/lib/pngDecode";
import {
  decodeRgbPng,
  encodeRgbaPng,
  inTeamColourColumn,
  maskAtlas,
  maskPixel,
} from "./teamColour.mjs";

/** The engine's mix, `mix(rgb, teamColour, alpha)`, in 8 bits. */
function engineDraws([r, g, b, a], teamColour) {
  return [r, g, b].map((value, at) =>
    Math.round(value * (1 - a / 255) + (teamColour[at] * a) / 255),
  );
}

/** A tiny 8-bit RGB PNG, rows unfiltered, the kind KaiserJ's atlas is. */
function rgbPng(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(
      rgb.subarray(y * width * 3, (y + 1) * width * 3),
      y * (width * 3 + 1) + 1,
    );
  }
  // Chunk CRCs are not checked by the decoder under test, so zeros will do.
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "latin1");
    Buffer.from(body).copy(out, 8);
    return out;
  };
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

describe("maskPixel", () => {
  it("turns pure red into all team colour", () => {
    expect(maskPixel(255, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("leaves a pixel with no red in it alone", () => {
    expect(maskPixel(30, 30, 30)).toEqual([30, 30, 30, 0]);
    expect(maskPixel(10, 200, 40)).toEqual([10, 200, 40, 0]);
  });

  it("draws a darker red as a darker team colour", () => {
    const blue = [0, 0, 200];
    expect(engineDraws(maskPixel(128, 0, 0), blue)).toEqual([0, 0, 100]);
  });

  it("gives a red player back every pixel exactly as drawn", () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [200, 0, 0],
      [255, 180, 180],
      [240, 120, 60],
      [90, 20, 30],
      [255, 254, 254],
    ]) {
      expect(engineDraws(maskPixel(r, g, b), [255, 0, 0])).toEqual([r, g, b]);
    }
  });
});

describe("inTeamColourColumn", () => {
  it("is the first third of the atlas, as colourwayOf counts it", () => {
    expect(inTeamColourColumn(0, 2048)).toBe(true);
    expect(inTeamColourColumn(682, 2048)).toBe(true);
    expect(inTeamColourColumn(683, 2048)).toBe(false);
    expect(inTeamColourColumn(2047, 2048)).toBe(false);
  });
});

describe("maskAtlas", () => {
  it("masks red in the first column only", () => {
    const rgb = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0]);
    const rgba = maskAtlas({ width: 3, height: 1, rgb });
    expect([...rgba]).toEqual([0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0]);
  });

  it("survives a PNG round trip", () => {
    const rgb = new Uint8Array(6 * 2 * 3).map((_, at) => (at * 37) % 256);
    const image = decodeRgbPng(rgbPng(6, 2, rgb));
    expect([...image.rgb]).toEqual([...rgb]);

    const rgba = maskAtlas(image);
    const decoded = decodePng(encodeRgbaPng(6, 2, rgba));
    expect(decoded?.width).toBe(6);
    expect([...(decoded?.data ?? [])]).toEqual([...rgba]);
  });

  it("refuses an atlas that already has an alpha channel", () => {
    const already = encodeRgbaPng(1, 1, new Uint8Array([1, 2, 3, 4]));
    expect(() => decodeRgbPng(already)).toThrow(/RGB PNG with no alpha/);
  });
});

describe("the bundled atlas", () => {
  const pack = JSON.parse(
    readFileSync(
      new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
      "utf8",
    ),
  );
  const atlas = decodePng(
    readFileSync(
      new URL("../../src-tauri/legoparts/atlas.png", import.meta.url),
    ),
  );

  it("has an alpha channel", () => {
    expect(atlas).toBeDefined();
  });

  it("marks team colour in the first column and nowhere else", () => {
    const { width, height, data } = atlas;
    let masked = 0;
    let stray = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        if (inTeamColourColumn(x, width)) masked += 1;
        else stray += 1;
      }
    }
    expect(stray).toBe(0);
    expect(masked).toBeGreaterThan(0);
  });

  it("draws every swatch's own colourway, with the team colour one all team colour", () => {
    const { width, height, data } = atlas;
    for (const swatch of pack.swatches) {
      // UVs run up from the bottom and pixel rows down from the top.
      const x = Math.floor(((swatch.uv.min[0] + swatch.uv.max[0]) / 2) * width);
      const y = Math.floor(
        (1 - (swatch.uv.min[1] + swatch.uv.max[1]) / 2) * height,
      );
      const alpha = data[(y * width + x) * 4 + 3];
      expect(alpha).toBe(swatch.id === "green" ? 255 : 0);
    }
  });
});
