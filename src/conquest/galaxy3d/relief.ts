import { type HeightGrid, sampleHeightGrid } from "./terrain";
import type { ColorPixels } from "./terrainMesh";

/** The longest side of a relief picture, in pixels. */
const RELIEF_SIDE = 512;
/** How steep the ground reads, as a multiple of its height over a pixel. */
const STEEPEN = 40;
/** Light from the north west and above, as the map's own sun does. */
const LIGHT = (() => {
  const l = [-1, -1, 1.4];
  const n = Math.hypot(l[0], l[1], l[2]);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

/**
 * The map's picture shaded by its heights, as a flat preview for while the
 * 3D view is built. At most {@link RELIEF_SIDE} pixels on its longer side.
 */
export function reliefPixels(
  color: ColorPixels,
  heights: HeightGrid,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const scale = Math.min(1, RELIEF_SIDE / Math.max(color.width, color.height));
  const width = Math.max(1, Math.round(color.width * scale));
  const height = Math.max(1, Math.round(color.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  const du = 1 / width;
  const dv = 1 / height;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const cy = Math.min(color.height - 1, Math.floor(v * color.height));
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const dx =
        (sampleHeightGrid(heights, u + du, v) -
          sampleHeightGrid(heights, u - du, v)) *
        STEEPEN;
      const dy =
        (sampleHeightGrid(heights, u, v + dv) -
          sampleHeightGrid(heights, u, v - dv)) *
        STEEPEN;
      const n = Math.hypot(dx, dy, 1);
      const lit = Math.max(0, (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / n);
      const shade = 0.35 + 0.65 * lit;
      const cx = Math.min(color.width - 1, Math.floor(u * color.width));
      const from = (cy * color.width + cx) * 4;
      const to = (y * width + x) * 4;
      data[to] = color.data[from] * shade;
      data[to + 1] = color.data[from + 1] * shade;
      data[to + 2] = color.data[from + 2] * shade;
      data[to + 3] = 255;
    }
  }
  return { data, width, height };
}
