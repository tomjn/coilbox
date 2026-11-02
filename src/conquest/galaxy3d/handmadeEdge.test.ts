import { describe, expect, it } from "vitest";
import {
  apronHeights,
  apronPicture,
  apronPixels,
  commonEdgeColor,
  flatGrid,
  surroundExtension,
  surroundFit,
} from "./handmadeEdge";
import type { HeightGrid } from "./terrain";

/** A 4 by 3 grid, a ridge of 0.8 down its west column and 0.2 elsewhere. */
const ridge: HeightGrid = {
  data: Float32Array.from({ length: 12 }, (_, i) => (i % 4 === 0 ? 0.8 : 0.2)),
  width: 4,
  height: 3,
};

describe("apronPixels", () => {
  it("is a short share of the longer side", () => {
    expect(apronPixels({ width: 160, height: 96 })).toBe(13);
    expect(apronPixels({ width: 96, height: 1024 })).toBe(82);
  });

  it("is never less than two pixels", () => {
    expect(apronPixels({ width: 4, height: 3 })).toBe(2);
  });
});

describe("apronHeights", () => {
  const margin = 4;
  const out = apronHeights(ridge, margin);
  const at = (x: number, y: number) => out.data[y * out.width + x];

  it("widens the grid by the margin on every side", () => {
    expect(out.width).toBe(4 + 2 * margin);
    expect(out.height).toBe(3 + 2 * margin);
  });

  it("keeps the map's own heights in the middle", () => {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(at(x + margin, y + margin)).toBe(ridge.data[y * 4 + x]);
      }
    }
  });

  it("starts at the edge's height and falls steadily to the frame's lowest", () => {
    const row = margin + 1;
    const west = [0, 1, 2, 3, 4].map((x) => at(margin - x, row));
    expect(west[0]).toBeCloseTo(0.8);
    for (let i = 1; i < west.length; i++) {
      expect(west[i]).toBeLessThan(west[i - 1]);
    }
    expect(west[4]).toBeCloseTo(0.2);
    expect(at(0, row)).toBeCloseTo(0.2);
  });

  it("never rises above the edge it continues", () => {
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        expect(at(x, y)).toBeLessThanOrEqual(0.8 + 1e-6);
        expect(at(x, y)).toBeGreaterThanOrEqual(0.2 - 1e-6);
      }
    }
  });

  it("leaves a low edge low", () => {
    const flat: HeightGrid = {
      data: new Float32Array(9),
      width: 3,
      height: 3,
    };
    expect(apronHeights(flat, 2).data.every((h) => h === 0)).toBe(true);
  });
});

describe("apronPicture", () => {
  // 2 by 1: a red pixel and a blue one.
  const picture = {
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
    width: 2,
    height: 1,
  };

  it("widens the picture in step with the heightmap's apron", () => {
    // The heightmap is 4 by 2 with 2 pixels of apron, so half a pixel of
    // picture per heightmap pixel across and down.
    const wide = apronPicture(picture, 4, 2, 2);
    expect(wide.width).toBe(2 + 2 * 1);
    expect(wide.height).toBe(1 + 2 * 1);
  });

  it("colours each pixel past the frame from the nearest edge pixel", () => {
    const wide = apronPicture(picture, 2, 1, 1);
    const px = (x: number, y: number) =>
      Array.from(
        wide.data.subarray(
          (y * wide.width + x) * 4,
          (y * wide.width + x) * 4 + 4,
        ),
      );
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(2, 1)).toEqual([0, 0, 255, 255]);
    expect(px(3, 2)).toEqual([0, 0, 255, 255]);
  });
});

describe("flatGrid", () => {
  it("follows the sheet's shape with 64 pixels along the longer side", () => {
    expect(flatGrid(90, 60)).toMatchObject({ width: 64, height: 43 });
    expect(flatGrid(60, 90)).toMatchObject({ width: 43, height: 64 });
  });

  it("is flat", () => {
    expect(flatGrid(10, 10).data.every((h) => h === 0)).toBe(true);
  });
});

describe("commonEdgeColor", () => {
  // 5 by 3: a sea edge with one hill pixel on it, and land in the middle.
  const width = 5;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const hill = x === 2 && y === 0;
      // The sea's grain varies by a level or two and still counts as one.
      const sea = [24 + (x % 2), 58, 96, 255];
      data.set(
        hill ? [200, 200, 200, 255] : edge ? sea : [100, 160, 80, 255],
        (y * width + x) * 4,
      );
    }
  }

  it("is the sea's colour, not pulled towards the hill on the frame", () => {
    const [r, g, b] = commonEdgeColor({ data, width, height });
    expect(r).toBeGreaterThanOrEqual(24);
    expect(r).toBeLessThanOrEqual(25);
    expect([g, b]).toEqual([58, 96]);
  });
});

describe("surroundFit", () => {
  const map = {
    picture: { width: 160, height: 96 },
    heightmap: { width: 160, height: 96 },
  };

  it("reads the margin from the sizes", () => {
    expect(
      surroundFit(map, {
        picture: { width: 382, height: 318 },
        heightmap: { width: 382, height: 318 },
      }),
    ).toEqual({ margin: 111, pictureX: 111, pictureY: 111 });
  });

  it("scales the margin to a finer picture", () => {
    expect(
      surroundFit(
        { ...map, picture: { width: 1600, height: 960 } },
        {
          picture: { width: 1800, height: 1160 },
          heightmap: { width: 180, height: 116 },
        },
      ),
    ).toEqual({ margin: 10, pictureX: 100, pictureY: 100 });
  });

  it.each([
    ["no wider", { width: 160, height: 96 }],
    ["narrower", { width: 150, height: 86 }],
    ["uneven between its sides", { width: 181, height: 117 }],
    ["wider by more than it is taller", { width: 200, height: 116 }],
  ])("refuses a heightmap that is %s", (_, heightmap) => {
    expect(
      surroundFit(map, { picture: { width: 382, height: 318 }, heightmap }),
    ).toEqual({ wrong: "heightmap" });
  });

  it("says what size the picture should be", () => {
    expect(
      surroundFit(map, {
        picture: { width: 300, height: 300 },
        heightmap: { width: 382, height: 318 },
      }),
    ).toEqual({ wrong: "picture", expected: { width: 382, height: 318 } });
  });
});

describe("surroundExtension", () => {
  const pixels = (width: number, height: number, value: number) => ({
    data: new Uint8ClampedArray(width * height * 4).fill(value),
    width,
    height,
  });
  const grid = (width: number, height: number, value: number): HeightGrid => ({
    data: new Float32Array(width * height).fill(value),
    width,
    height,
  });

  it("draws the map's own picture and heights in the middle", () => {
    const land = surroundExtension(
      pixels(2, 2, 200),
      grid(2, 2, 0.75),
      pixels(4, 4, 10),
      grid(4, 4, 0.25),
    );
    expect(land?.margin).toBe(1);
    expect([...(land?.heights.data ?? [])]).toEqual([
      0.25, 0.25, 0.25, 0.25, 0.25, 0.75, 0.75, 0.25, 0.25, 0.75, 0.75, 0.25,
      0.25, 0.25, 0.25, 0.25,
    ]);
    const red = (x: number, y: number) => land?.image.data[(y * 4 + x) * 4];
    expect(red(0, 0)).toBe(10);
    expect(red(1, 1)).toBe(200);
    expect(red(2, 2)).toBe(200);
    expect(red(3, 2)).toBe(10);
  });

  it("gives nothing for a surround that does not fit", () => {
    expect(
      surroundExtension(
        pixels(2, 2, 200),
        grid(2, 2, 0.75),
        pixels(5, 4, 10),
        grid(5, 4, 0.25),
      ),
    ).toBeNull();
  });
});
