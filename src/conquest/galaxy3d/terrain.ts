import type { GalaxyDoc, GalaxyNode } from "../model";
import {
  layoutNodes,
  type PlayBounds,
  playBounds,
  playExtentFor,
  type WorldPos,
} from "./layout";

/**
 * The terrain sheet's maths: a map of land drawn as a flat sheet carrying the
 * map picture, raised where a heightmap says so. Everything here is pure and
 * free of three.js so it unit-tests without WebGL. `terrainMesh.ts` turns a
 * {@link TerrainSurface} into a mesh, and `terrainLoad.ts` reads a heightmap
 * URL into a {@link HeightGrid}.
 *
 * Three coordinate spaces are in play:
 *
 * - Map units. What the document stores: `terrain.width` by `terrain.height`,
 *   origin at the top left of the map image, x right, y down. A node's `pos`
 *   and its outline points are in map units when the document has a terrain.
 * - World units. What three.js draws. The sheet is centred on the origin, map
 *   x runs along world +X, map y runs along world +Z, and height is world +Y.
 *   One factor, {@link TerrainSurface.scale}, converts all three axes, so a
 *   hill is as tall against its width on screen as it is in the document.
 * - Heightmap values. 0 to 1, where 0 is black and 1 is white.
 *
 * How a heightmap value becomes height: a pixel's value from 0 (black) to 1
 * (white) is multiplied by `terrain.heightScale`, which is the height of a
 * white pixel in map units. Black is ground level, height 0. When the document
 * gives no `heightScale` it is {@link DEFAULT_HEIGHT_SCALE_FRACTION} of the
 * map's longer side. The first and last pixels of each heightmap row and
 * column sit on the edges of the map, and values between pixels are blended.
 *
 * Anything that stands on the map (markers, roads, labels, placed models)
 * should take its position from {@link TerrainSurface.mapToWorld} or its
 * height from {@link TerrainSurface.groundHeightAt}. Both read the same
 * triangles the mesh draws, so an object placed with them sits on the drawn
 * surface exactly, neither sunk into a hill nor floating over a valley.
 */

/** The terrain block of a map document. */
export type TerrainSpec = NonNullable<GalaxyDoc["terrain"]>;

/**
 * Height of a white heightmap pixel when the document gives no `heightScale`,
 * as a fraction of the map's longer side. A 1000 unit wide map gets peaks 50
 * units tall. Chosen by eye from the numbers, not tuned on screen.
 */
export const DEFAULT_HEIGHT_SCALE_FRACTION = 0.05;

/** Most mesh segments along the sheet's longer side. */
export const TERRAIN_MAX_SEGMENTS = 256;

/**
 * How far above the ground a node's anchor is placed, in world units. The
 * point markers draw their disc 0.2 and their ring 0.4 below the anchor, so
 * this keeps both just clear of the surface.
 */
export const MARKER_LIFT = 0.6;

/** The closest the camera may come to the ground beneath it, in world units. */
export const CAMERA_CLEARANCE = 2;

/**
 * Raw height pixels, top row first. Two layouts are read:
 *
 * - `width * height * 4` values: RGBA bytes as a canvas or `ImageData` gives
 *   them. Height is the red channel, 0 to 255.
 * - `width * height` values: one height per pixel. A float array (or a plain
 *   array) holds 0 to 1. An integer typed array holds 0 to its largest value,
 *   so 255 for a `Uint8Array` and 65535 for a `Uint16Array`.
 */
export interface HeightPixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** Heights from 0 to 1, one per pixel, top row first. */
export interface HeightGrid {
  data: Float32Array;
  width: number;
  height: number;
}

/** The largest value a single-channel pixel array can hold. */
function singleChannelMax(data: ArrayLike<number>): number {
  if (!ArrayBuffer.isView(data)) return 1;
  if (data instanceof Float32Array || data instanceof Float64Array) return 1;
  const bytes = (data as unknown as { BYTES_PER_ELEMENT: number })
    .BYTES_PER_ELEMENT;
  return 2 ** (8 * bytes) - 1;
}

/**
 * Read raw pixels into a {@link HeightGrid}. Throws when the dimensions are
 * not positive whole numbers or the array length matches neither layout
 * described on {@link HeightPixels}.
 */
export function heightGridFromPixels(pixels: HeightPixels): HeightGrid {
  const { data, width, height } = pixels;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(`heightmap size ${width} by ${height} is not usable`);
  }
  const count = width * height;
  const out = new Float32Array(count);
  if (data.length === count * 4) {
    for (let i = 0; i < count; i++) out[i] = data[i * 4] / 255;
  } else if (data.length === count) {
    const max = singleChannelMax(data);
    for (let i = 0; i < count; i++) {
      out[i] = Math.min(1, Math.max(0, data[i] / max));
    }
  } else {
    throw new Error(
      `heightmap has ${data.length} values, expected ${count} or ${count * 4} for ${width} by ${height}`,
    );
  }
  return { data: out, width, height };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The height from 0 to 1 at a point of the grid, blended between the four
 * nearest pixels. `u` and `v` run 0 to 1 across the map, left to right and top
 * to bottom, and are clamped, so a point off the map reads the nearest edge.
 */
export function sampleHeightGrid(
  grid: HeightGrid,
  u: number,
  v: number,
): number {
  const x = clamp01(u) * (grid.width - 1);
  const y = clamp01(v) * (grid.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number) => grid.data[py * grid.width + px];
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return top + (bottom - top) * fy;
}

/**
 * A terrain sheet laid out in world space: the one mapping between map units
 * and world units, plus the ground height. Build it with
 * {@link createTerrainSurface}, or read it off {@link layoutStrategicMap}.
 */
export interface TerrainSurface {
  /** Map size in map units. */
  readonly width: number;
  readonly height: number;
  /** World units per map unit, the same on all three axes. */
  readonly scale: number;
  /** Sheet size in world units, along world X and world Z. */
  readonly worldWidth: number;
  readonly worldDepth: number;
  /** Height of a white heightmap pixel in map units, after the default. */
  readonly heightScale: number;
  /** The highest ground on the sheet in world units. 0 for a flat sheet. */
  readonly maxHeight: number;
  /** Mesh segments along map x and map y. A flat sheet has one of each. */
  readonly segmentsX: number;
  readonly segmentsY: number;
  /**
   * Ground height in world units at each mesh vertex, top row first,
   * `(segmentsX + 1) * (segmentsY + 1)` values.
   */
  readonly vertexHeights: Float32Array;
  /** The sheet's edges in world X and Z, for clamping a pan. */
  readonly bounds: PlayBounds;
  /** Map position to world `[x, z]`. Does not clamp to the sheet. */
  mapToWorldXZ(mapX: number, mapY: number): [number, number];
  /** World x and z back to a map position `[mapX, mapY]`. */
  worldToMap(worldX: number, worldZ: number): [number, number];
  /**
   * Ground height in world units at a map position. A position off the sheet
   * reads the nearest edge.
   */
  groundHeightAt(mapX: number, mapY: number): number;
  /** {@link groundHeightAt} for a point already in world x and z. */
  groundHeightAtWorld(worldX: number, worldZ: number): number;
  /**
   * Map position to a world `[x, y, z]` on the surface, `lift` world units
   * above the ground.
   */
  mapToWorld(mapX: number, mapY: number, lift?: number): WorldPos;
}

/**
 * Lay a terrain out in world space so its longer side spans `worldExtent`
 * world units, centred on the origin. `heights` raises it and may be left out
 * for a flat sheet. `maxSegments` caps the mesh detail along the longer side.
 */
export function createTerrainSurface(
  spec: Pick<TerrainSpec, "width" | "height" | "heightScale">,
  worldExtent: number,
  heights?: HeightGrid,
  maxSegments: number = TERRAIN_MAX_SEGMENTS,
): TerrainSurface {
  const { width, height } = spec;
  const longSide = Math.max(width, height);
  const scale = worldExtent / longSide;
  const worldWidth = width * scale;
  const worldDepth = height * scale;
  const heightScale =
    spec.heightScale !== undefined &&
    Number.isFinite(spec.heightScale) &&
    spec.heightScale >= 0
      ? spec.heightScale
      : longSide * DEFAULT_HEIGHT_SCALE_FRACTION;

  // No more segments than the heightmap has gaps between pixels, and no more
  // than the cap, shared between the axes in proportion to the map's shape.
  const segmentsFor = (side: number, pixels: number): number =>
    Math.max(
      1,
      Math.min(pixels - 1, Math.round((maxSegments * side) / longSide)),
    );
  const segmentsX = heights ? segmentsFor(width, heights.width) : 1;
  const segmentsY = heights ? segmentsFor(height, heights.height) : 1;

  const cols = segmentsX + 1;
  const vertexHeights = new Float32Array(cols * (segmentsY + 1));
  let maxHeight = 0;
  if (heights) {
    const toWorld = heightScale * scale;
    for (let j = 0; j <= segmentsY; j++) {
      for (let i = 0; i <= segmentsX; i++) {
        const h =
          sampleHeightGrid(heights, i / segmentsX, j / segmentsY) * toWorld;
        vertexHeights[j * cols + i] = h;
        if (h > maxHeight) maxHeight = h;
      }
    }
  }

  const mapToWorldXZ = (mapX: number, mapY: number): [number, number] => [
    (mapX - width / 2) * scale,
    (mapY - height / 2) * scale,
  ];
  const worldToMap = (worldX: number, worldZ: number): [number, number] => [
    worldX / scale + width / 2,
    worldZ / scale + height / 2,
  ];

  // Reads the same two triangles per cell that `terrainTriangles` hands the
  // mesh, split along the diagonal from the cell's top right to bottom left.
  const groundHeightAt = (mapX: number, mapY: number): number => {
    if (maxHeight === 0) return 0;
    const x = clamp01(mapX / width) * segmentsX;
    const y = clamp01(mapY / height) * segmentsY;
    const i = Math.min(segmentsX - 1, Math.floor(x));
    const j = Math.min(segmentsY - 1, Math.floor(y));
    const fx = x - i;
    const fy = y - j;
    const h00 = vertexHeights[j * cols + i];
    const h10 = vertexHeights[j * cols + i + 1];
    const h01 = vertexHeights[(j + 1) * cols + i];
    const h11 = vertexHeights[(j + 1) * cols + i + 1];
    if (fx + fy <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fy;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fy);
  };
  const groundHeightAtWorld = (worldX: number, worldZ: number): number => {
    const [mapX, mapY] = worldToMap(worldX, worldZ);
    return groundHeightAt(mapX, mapY);
  };

  return {
    width,
    height,
    scale,
    worldWidth,
    worldDepth,
    heightScale,
    maxHeight,
    segmentsX,
    segmentsY,
    vertexHeights,
    bounds: {
      minX: -worldWidth / 2,
      maxX: worldWidth / 2,
      minZ: -worldDepth / 2,
      maxZ: worldDepth / 2,
    },
    mapToWorldXZ,
    worldToMap,
    groundHeightAt,
    groundHeightAtWorld,
    mapToWorld: (mapX, mapY, lift = 0) => {
      const [x, z] = mapToWorldXZ(mapX, mapY);
      return [x, groundHeightAt(mapX, mapY) + lift, z];
    },
  };
}

/**
 * Triangle indices for a sheet of `segmentsX` by `segmentsY` cells whose
 * vertices run top row first. Each cell splits along the diagonal from its
 * top right to its bottom left, and every triangle faces world +Y. The ground
 * height query assumes this split, so the mesh must use these indices.
 */
export function terrainTriangles(
  segmentsX: number,
  segmentsY: number,
): Uint32Array {
  const cols = segmentsX + 1;
  const out = new Uint32Array(segmentsX * segmentsY * 6);
  let o = 0;
  for (let j = 0; j < segmentsY; j++) {
    for (let i = 0; i < segmentsX; i++) {
      const topLeft = j * cols + i;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + cols;
      const bottomRight = bottomLeft + 1;
      out[o++] = topLeft;
      out[o++] = bottomLeft;
      out[o++] = topRight;
      out[o++] = topRight;
      out[o++] = bottomLeft;
      out[o++] = bottomRight;
    }
  }
  return out;
}

/** Share of the light that reaches a slope facing away from the sun. */
export const SHADE_AMBIENT = 0.45;

/**
 * Direction to the sun, as world `[x, y, z]` before normalising: high in the
 * north west of the map, the convention for shaded relief on a printed map.
 */
const SUN: [number, number, number] = [-1, 1.5, -1];

/** {@link SUN} normalised, for the terrain shader. */
export const TERRAIN_SUN: [number, number, number] = (() => {
  const length = Math.hypot(SUN[0], SUN[1], SUN[2]);
  return [SUN[0] / length, SUN[1] / length, SUN[2] / length];
})();

/**
 * The ground's normal and height at every heightmap pixel, as RGBA bytes for
 * a texture laid over the sheet, top row first. Red, green and blue hold the
 * world normal's x, y and z, mapped from -1 to 1 onto 0 to 255. Alpha holds
 * the height, 0 to 255. It is read at the heightmap's own resolution, so the
 * light picks out ridges finer than the mesh.
 */
export function terrainNormalPixels(
  surface: TerrainSurface,
  grid: HeightGrid,
  /** World units the grid covers, when it reaches past the sheet. The sheet's
   * own size when left out. */
  span: { width: number; depth: number } = {
    width: surface.worldWidth,
    depth: surface.worldDepth,
  },
): Uint8Array {
  const { width, height, data } = grid;
  const out = new Uint8Array(width * height * 4);
  const toWorld = surface.heightScale * surface.scale;
  const stepX = span.width / Math.max(1, width - 1);
  const stepZ = span.depth / Math.max(1, height - 1);
  const byte = (v: number) => Math.round((v * 0.5 + 0.5) * 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Slope from the neighbours either side, one sided at the edge.
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      const slopeX =
        x1 === x0
          ? 0
          : ((data[y * width + x1] - data[y * width + x0]) * toWorld) /
            ((x1 - x0) * stepX);
      const slopeZ =
        y1 === y0
          ? 0
          : ((data[y1 * width + x] - data[y0 * width + x]) * toWorld) /
            ((y1 - y0) * stepZ);
      const length = Math.hypot(slopeX, 1, slopeZ);
      const o = (y * width + x) * 4;
      out[o] = byte(-slopeX / length);
      out[o + 1] = byte(1 / length);
      out[o + 2] = byte(-slopeZ / length);
      out[o + 3] = Math.round(clamp01(data[y * width + x]) * 255);
    }
  }
  return out;
}

/** The strategic view's vertical field of view, in degrees. */
export const VIEW_FOV_DEGREES = 50;

/**
 * How much of the furthest top-down view past the map's edge the land beyond
 * it covers before it has faded into the background. At the furthest zoom the
 * fade then fills half the space past the edge and the background fills the
 * rest, so the land beyond ends in a long fade and not at a line. A design
 * value: wider costs generation time. A margin of 200 pixels added 54 to 94 ms
 * to a map's generation on an M1 Pro, depending on its layout.
 */
const MARGIN_SHARE_OF_VIEW = 0.5;

/**
 * Map pixels of land to draw past every side of a generated map, for a map of
 * `nodeCount` locations whose picture is `pixels` across.
 *
 * The pan stops at the map's edge and the furthest zoom is the
 * `maxDistance` of {@link terrainCameraLimits}. Looking straight down from
 * there, centred on the edge, the view reaches `maxDistance * tan(fov / 2)`
 * world units past it. The land beyond fades out over
 * {@link MARGIN_SHARE_OF_VIEW} of that. A tilted view sees to the horizon,
 * which no margin could cover, and the same fade hides the end there.
 */
export function terrainMarginPixels(nodeCount: number, pixels: number): number {
  const sheet = playExtentFor(nodeCount);
  const half = Math.tan((VIEW_FOV_DEGREES * Math.PI) / 360);
  const furthest = Math.max(
    GALAXY_MAX_DISTANCE,
    (sheet / (2 * half)) * FIT_MARGIN,
  );
  const reach = (furthest * half) / sheet;
  return Math.ceil(reach * MARGIN_SHARE_OF_VIEW * pixels);
}

/**
 * The ground past the sheet's edge as well as on it: heights for a grid that
 * holds the map's heightmap in its middle with `margin` pixels round it.
 */
export interface MarginSurface {
  /** Pixels of the grid past every side of the map. */
  readonly margin: number;
  /** The heightmap's pixels across the map alone. */
  readonly mapPixels: number;
  readonly grid: HeightGrid;
  /** World units the margin reaches past the sheet's sides, along X and Z. */
  readonly reachX: number;
  readonly reachZ: number;
  /** Ground height in world units at any world x and z, clamped to the grid. */
  heightAtWorld(worldX: number, worldZ: number): number;
}

/**
 * Lay a heightmap with a margin round it out in world space, at the same
 * spacing and height as `surface`. On the sheet it reads the same heights the
 * sheet does.
 */
export function createMarginSurface(
  surface: TerrainSurface,
  grid: HeightGrid,
  margin: number,
): MarginSurface {
  const mapPixels = grid.width - 2 * margin;
  const mapRows = grid.height - 2 * margin;
  const pixelX = surface.worldWidth / Math.max(1, mapPixels - 1);
  const pixelZ = surface.worldDepth / Math.max(1, mapRows - 1);
  const toWorld = surface.heightScale * surface.scale;
  return {
    margin,
    mapPixels,
    grid,
    reachX: margin * pixelX,
    reachZ: margin * pixelZ,
    heightAtWorld: (worldX, worldZ) => {
      const px = margin + (worldX / surface.worldWidth + 0.5) * (mapPixels - 1);
      const pz = margin + (worldZ / surface.worldDepth + 0.5) * (mapRows - 1);
      return (
        sampleHeightGrid(
          grid,
          px / Math.max(1, grid.width - 1),
          pz / Math.max(1, grid.height - 1),
        ) * toWorld
      );
    },
  };
}

/**
 * Geometry for the ground past the sheet's edge: a ring of cells round it out
 * to the margin's reach, at twice the sheet's spacing. The ring's inner
 * vertices are the sheet's own edge vertices at the sheet's own heights, so
 * the two meet with no gap and no overlap. `uvs` place each vertex on a
 * picture that holds the map's in its middle with the same margin round it.
 */
export function marginGeometry(
  surface: TerrainSurface,
  margin: MarginSurface,
): { positions: Float32Array; uvs: Float32Array; index: Uint32Array } {
  const { segmentsX, segmentsY, worldWidth, worldDepth } = surface;
  const axis = (segments: number, size: number, reach: number): number[] => {
    const inner = Array.from(
      { length: segments + 1 },
      (_, i) => (i / segments) * size - size / 2,
    );
    const step = (2 * size) / segments;
    const outer = Math.max(1, Math.ceil(reach / step));
    const before: number[] = [];
    const after: number[] = [];
    for (let k = outer; k >= 1; k--) {
      const d = Math.min(reach, k * step);
      before.push(-size / 2 - d);
      after.unshift(size / 2 + d);
    }
    return [...before, ...inner, ...after];
  };
  const xs = axis(segmentsX, worldWidth, margin.reachX);
  const zs = axis(segmentsY, worldDepth, margin.reachZ);
  const firstX = xs.indexOf(-worldWidth / 2);
  const firstZ = zs.indexOf(-worldDepth / 2);
  const cols = xs.length;
  const rows = zs.length;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const across = margin.mapPixels + 2 * margin.margin;
  const down = margin.grid.height;
  const mapRows = down - 2 * margin.margin;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = xs[i];
      const z = zs[j];
      const si = i - firstX;
      const sj = j - firstZ;
      const onSheet = si >= 0 && si <= segmentsX && sj >= 0 && sj <= segmentsY;
      const y = onSheet
        ? surface.vertexHeights[sj * (segmentsX + 1) + si]
        : margin.heightAtWorld(x, z);
      const v = j * cols + i;
      positions.set([x, y, z], v * 3);
      // The same placement the sheet's picture coordinates use, widened.
      const u = x / worldWidth + 0.5;
      const w = z / worldDepth + 0.5;
      uvs.set(
        [
          (u * margin.mapPixels + margin.margin) / across,
          (w * mapRows + margin.margin) / down,
        ],
        v * 2,
      );
    }
  }
  const cells: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const si = i - firstX;
      const sj = j - firstZ;
      if (si >= 0 && si < segmentsX && sj >= 0 && sj < segmentsY) continue;
      const topLeft = j * cols + i;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + cols;
      const bottomRight = bottomLeft + 1;
      cells.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }
  return { positions, uvs, index: Uint32Array.from(cells) };
}

/** Orbit limits for a terrain map, in the terms `OrbitControls` takes. */
export interface TerrainCameraLimits {
  /** 0, so the camera can look straight down and the map reads as 2D. */
  minPolarAngle: number;
  /** The lowest tilt, short of the horizon so the view never goes edge on. */
  maxPolarAngle: number;
  minDistance: number;
  /** Far enough to see the whole sheet from straight above. */
  maxDistance: number;
}

/** The zoom range the galaxy view uses, kept as the floor for a terrain map. */
const GALAXY_MIN_DISTANCE = 25;
export const GALAXY_MAX_DISTANCE = 220;
/** The galaxy view's lowest tilt, in radians from straight down. */
const GALAXY_MAX_POLAR = 1.25;
/** Room left around the sheet at the furthest zoom. */
const FIT_MARGIN = 1.25;

/**
 * Camera limits for a terrain map. The furthest zoom is the distance at which
 * the sheet's longer side fills a view `fovDegrees` tall, with a margin, and
 * never less than the galaxy view's own furthest zoom.
 */
export function terrainCameraLimits(
  surface: TerrainSurface,
  fovDegrees: number,
): TerrainCameraLimits {
  const longSide = Math.max(surface.worldWidth, surface.worldDepth);
  const fit = longSide / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  return {
    minPolarAngle: 0,
    maxPolarAngle: GALAXY_MAX_POLAR,
    minDistance: GALAXY_MIN_DISTANCE,
    maxDistance: Math.max(GALAXY_MAX_DISTANCE, fit * FIT_MARGIN),
  };
}

/** Clamp a pan target's world x and z to the sheet. */
export function clampPanToSheet(
  surface: TerrainSurface,
  worldX: number,
  worldZ: number,
): [number, number] {
  const b = surface.bounds;
  return [
    Math.min(b.maxX, Math.max(b.minX, worldX)),
    Math.min(b.maxZ, Math.max(b.minZ, worldZ)),
  ];
}

/**
 * The lowest world y the camera may sit at over a world x and z:
 * {@link CAMERA_CLEARANCE} above the ground there. Off the sheet it follows
 * the nearest edge. Raising the camera to this is what stops a tilt or a zoom
 * from passing through a hill.
 */
export function cameraFloorAt(
  surface: TerrainSurface,
  worldX: number,
  worldZ: number,
  /** The land drawn past the sheet's edge, whose hills the camera must clear
   * too when it looks in from outside the map. */
  margin?: MarginSurface,
): number {
  const ground = surface.groundHeightAtWorld(worldX, worldZ);
  const beyond = margin ? margin.heightAtWorld(worldX, worldZ) : 0;
  return Math.max(ground, beyond) + CAMERA_CLEARANCE;
}

/** A map document's terrain block when it is usable, otherwise `undefined`. */
export function terrainSpecOf(
  galaxy: Pick<GalaxyDoc, "terrain">,
): TerrainSpec | undefined {
  const t = galaxy.terrain;
  if (!t) return undefined;
  const usable = (v: number) => Number.isFinite(v) && v > 0;
  return usable(t.width) && usable(t.height) ? t : undefined;
}

/** Where everything on the strategic map goes, for any kind of map. */
export interface StrategicLayout {
  /** The marker style. A terrain map uses the flat theatre markers. */
  skin: "galaxy" | "theatre";
  /** World units across the play region's longest axis. */
  extent: number;
  /** World position of each node's anchor, keyed by node id. */
  positions: Map<string, WorldPos>;
  /** The region a pan is clamped to. */
  bounds: PlayBounds;
  /** Present for a terrain map only. Absent means a galaxy or theatre map. */
  surface?: TerrainSurface;
}

/**
 * Lay out a map document for the strategic view.
 *
 * A document without a terrain takes the path the view has always used: nodes
 * scaled to fit the play extent by `layoutNodes`, flattened for the theatre
 * skin. A document with a terrain places each node's `pos`, read as map units,
 * on the sheet at ground height plus {@link MARKER_LIFT}, and the sheet's
 * longer side spans the play extent.
 */
export function layoutStrategicMap(
  galaxy: Pick<GalaxyDoc, "terrain" | "theme"> & {
    nodes: Pick<GalaxyNode, "id" | "pos">[];
  },
  heights?: HeightGrid,
  maxSegments: number = TERRAIN_MAX_SEGMENTS,
): StrategicLayout {
  // Bigger galaxies get a proportionally bigger plane (constant density).
  // The backdrop, nebulae and camera framing all scale with it.
  const extent = playExtentFor(galaxy.nodes.length);
  const spec = terrainSpecOf(galaxy);
  if (!spec) {
    // A land style whose document has no terrain has nothing to stand on, so
    // it is drawn as the flat chart.
    const skin =
      (galaxy.theme?.skin ?? "galaxy") === "galaxy" ? "galaxy" : "theatre";
    const positions = layoutNodes(galaxy.nodes, extent);
    // A theatre map is a flat chart: drop the galactic Y jitter.
    if (skin === "theatre") {
      for (const p of positions.values()) p[1] = 0;
    }
    return { skin, extent, positions, bounds: playBounds(positions.values()) };
  }
  const surface = createTerrainSurface(spec, extent, heights, maxSegments);
  const positions = new Map<string, WorldPos>();
  for (const n of galaxy.nodes) {
    positions.set(n.id, surface.mapToWorld(n.pos[0], n.pos[1], MARKER_LIFT));
  }
  return {
    skin: "theatre",
    extent,
    positions,
    bounds: surface.bounds,
    surface,
  };
}
