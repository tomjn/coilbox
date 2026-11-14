import { describe, expect, it } from "vitest";
import { reliefPixels } from "./relief";
import type { HeightGrid } from "./terrain";

const grey = (width: number, height: number) => ({
  data: new Uint8ClampedArray(width * height * 4).fill(200),
  width,
  height,
});

const grid = (side: number, at: (x: number, y: number) => number) => {
  const data = new Float32Array(side * side);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) data[y * side + x] = at(x, y);
  return { data, width: side, height: side } satisfies HeightGrid;
};

describe("reliefPixels", () => {
  it("keeps to 512 pixels on the longer side, in the picture's shape", () => {
    const out = reliefPixels(
      grey(2048, 1024),
      grid(8, () => 0.5),
    );
    expect([out.width, out.height]).toEqual([512, 256]);
  });

  it("shades flat ground evenly", () => {
    const out = reliefPixels(
      grey(16, 16),
      grid(8, () => 0.5),
    );
    const reds = new Set<number>();
    for (let k = 0; k < out.data.length; k += 4) reds.add(out.data[k]);
    expect(reds.size).toBe(1);
  });

  it("lights a slope facing the north west more than one facing away", () => {
    // Rising to the east: its face looks west, towards the light.
    const east = reliefPixels(
      grey(16, 16),
      grid(16, (x) => x / 15),
    );
    const west = reliefPixels(
      grey(16, 16),
      grid(16, (x) => 1 - x / 15),
    );
    const middle = (8 * 16 + 8) * 4;
    expect(east.data[middle]).toBeGreaterThan(west.data[middle]);
  });
});
