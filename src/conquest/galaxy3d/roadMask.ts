import type { MapXY } from "./roadRoute";

/**
 * The roads of a map as a texture the terrain shader paints them from. Each
 * texel holds how far it lies from the nearest road, so the shader can draw a
 * track with a soft edge at any width, and which road that is, so it can draw
 * the road's state. Built once per map. Pure, so it is tested without WebGL.
 */

/** How a road's surface looks, from the least used to the most. */
export type RoadSurface = "track" | "gravel" | "paved";

/** A road's route and how it is drawn. */
export interface RoadLine {
  /** The route in map units. */
  line: MapXY[];
  surface: RoadSurface;
  /**
   * The road's place in the road state texture, from 0. Left out for scenery,
   * such as a side track, which has no state and always draws.
   */
  index?: number;
}

/** The longest distance from a road the texture records, in world units. */
export const ROAD_REACH = 0.6;

/** Texels along the texture's longer side. */
export const ROAD_MASK_TEXELS = 2048;

/** The surface's byte in the green channel. */
export const SURFACE_BYTE: Record<RoadSurface, number> = {
  track: 0,
  gravel: 128,
  paved: 255,
};

/**
 * RGBA bytes, top row first, covering the map edge to edge. The texel in
 * column `i` and row `j` stands for the map point at the texel's centre:
 * `(i + 0.5) / width * mapWidth`, and the same down the map.
 *
 * - Red: the distance to the nearest road as a share of {@link ROAD_REACH},
 *   255 at that reach or further, so it blends smoothly between texels.
 * - Green: that road's surface, {@link SURFACE_BYTE}.
 * - Blue and alpha: that road's index plus one, high byte then low, or 0 for
 *   scenery or no road. The shader reads these without blending.
 */
export interface RoadMask {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The texture's size for a map, keeping the map's shape. */
export function roadMaskSize(
  mapWidth: number,
  mapHeight: number,
  texels: number = ROAD_MASK_TEXELS,
): { width: number; height: number } {
  const long = Math.max(mapWidth, mapHeight);
  return {
    width: Math.max(1, Math.round((texels * mapWidth) / long)),
    height: Math.max(1, Math.round((texels * mapHeight) / long)),
  };
}

/**
 * Draw `roads` into a mask for a map `mapWidth` by `mapHeight` map units laid
 * out at `scale` world units per map unit. Where two roads are as near as
 * each other, the one given first wins.
 */
export function buildRoadMask(
  roads: RoadLine[],
  mapWidth: number,
  mapHeight: number,
  scale: number,
  texels: number = ROAD_MASK_TEXELS,
): RoadMask {
  const { width, height } = roadMaskSize(mapWidth, mapHeight, texels);
  const texelX = mapWidth / width;
  const texelY = mapHeight / height;
  const reach = ROAD_REACH / scale;
  // The nearest road's squared distance per texel in map units, and which road
  // that is, as the index plus one in the low 16 bits and the surface above.
  const best = new Float32Array(width * height).fill(reach * reach);
  const which = new Int32Array(width * height).fill(-1);

  roads.forEach((road) => {
    const tag =
      (road.index === undefined ? 0 : road.index + 1) |
      (SURFACE_BYTE[road.surface] << 16);
    // A long diagonal stretch would scan a large box for a thin band, so the
    // line is cut into pieces no longer than the reach.
    const line: MapXY[] = [];
    road.line.forEach((p, k) => {
      if (k > 0) {
        const [qx, qy] = road.line[k - 1];
        const pieces = Math.ceil(Math.hypot(p[0] - qx, p[1] - qy) / reach);
        for (let s = 1; s < pieces; s++) {
          const f = s / pieces;
          line.push([qx + (p[0] - qx) * f, qy + (p[1] - qy) * f]);
        }
      }
      line.push(p);
    });
    for (let k = 0; k < line.length - 1; k++) {
      const [ax, ay] = line[k];
      const [bx, by] = line[k + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const inv = len2 === 0 ? 0 : 1 / len2;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / texelX));
      const i1 = Math.min(
        width - 1,
        Math.ceil((Math.max(ax, bx) + reach) / texelX),
      );
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / texelY));
      const j1 = Math.min(
        height - 1,
        Math.ceil((Math.max(ay, by) + reach) / texelY),
      );
      for (let j = j0; j <= j1; j++) {
        const ry = (j + 0.5) * texelY - ay;
        const row = j * width;
        for (let i = i0; i <= i1; i++) {
          const rx = (i + 0.5) * texelX - ax;
          let t = (rx * dx + ry * dy) * inv;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = dx * t - rx;
          const ey = dy * t - ry;
          const d2 = ex * ex + ey * ey;
          const at = row + i;
          if (d2 < best[at]) {
            best[at] = d2;
            which[at] = tag;
          }
        }
      }
    }
  });

  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < width * height; at++) {
    const o = at * 4;
    const tag = which[at];
    if (tag < 0) {
      data[o] = 255;
      continue;
    }
    data[o] = Math.round((Math.sqrt(best[at]) / reach) * 255);
    data[o + 1] = tag >>> 16;
    data[o + 2] = (tag >> 8) & 255;
    data[o + 3] = tag & 255;
  }
  return { data, width, height };
}
