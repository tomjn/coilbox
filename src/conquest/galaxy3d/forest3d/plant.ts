/**
 * Plant the forest of a generated map from plain data, so the land worker can
 * do it. Planting reads the ground at every cell of the map, which on the
 * main thread held the page still for seconds. `forestLayer.ts` turns what
 * this answers into meshes.
 */
import { type BiomePattern, type PlanetId, planetOf } from "../../planets";
import type { RiverField } from "../../rivers";
import type { RoadLine } from "../roadMask";
import {
  createMarginSurface,
  createTerrainSurface,
  type HeightGrid,
  TERRAIN_SUN,
  type TerrainSpec,
} from "../terrain";
import type { BiomePixels } from "../terrainMesh";
import { type Town, townEdge } from "../towns";
import { riverEdgeReader } from "../towns3d/layout";
import {
  type Forest,
  type ForestGround,
  forestCoverPixels,
  plantForest,
} from "./placement";

/** Everything planting reads, as data a worker can be sent. */
export interface ForestPlantInput {
  /** The sheet, laid out as the view lays it out. See `createTerrainSurface`. */
  sheet: {
    spec: Pick<TerrainSpec, "width" | "height" | "heightScale">;
    extent: number;
    /** The levelled heights the view draws. */
    heights: HeightGrid;
    maxSegments: number;
  };
  /** The heights past the map's edge, with `margin` pixels each side. */
  extensionHeights: HeightGrid;
  margin: number;
  /** The generator's weights. Without them nothing is planted. */
  biomes?: BiomePixels;
  /** The size of the extension's picture, which the river field covers. */
  picture: { width: number; height: number };
  rivers?: { field: RiverField };
  planet: PlanetId;
  /** The same seed plants the same forest. */
  seed: number;
  towns: Town[];
  /** Circles nothing grows in, such as a landmark's site. */
  cleared: { x: number; z: number; radius: number }[];
  roads: RoadLine[];
}

/** A planted forest, and the picture of what it does to the ground. */
export interface PlantedForest {
  forest: Forest;
  /** The rectangle trees were planted over, in world units. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** How far past the map the haze reaches, as a share of the map. */
  haze: number;
  /** Canopy then tree shadow, two bytes a pixel, over the extension's picture. */
  cover: { data: Uint8Array; width: number; height: number };
}

/** World units a pixel of the cover picture spans, and its longest side. */
const COVER_TEXEL = 0.04;
const COVER_MAX = 4096;
/** How far past a town's edge the trees stand back, as a share of the edge. */
const TOWN_CLEAR = 1.1;
/** How far each side of a road's line nothing grows, in world units. */
const ROAD_CLEAR = 0.12;
const ROAD_CELL = 0.08;
/** How much of the haze past the map's edge is planted. Further out a tree is lost in it. */
const HAZE_PLANTED = 0.75;

/** Plant a generated map. Undefined for flat ground or no biome weights. */
export function plantMapForest(
  input: ForestPlantInput,
): PlantedForest | undefined {
  const { spec, extent, heights, maxSegments } = input.sheet;
  const surface = createTerrainSurface(spec, extent, heights, maxSegments);
  const biomes = input.biomes;
  if (!biomes || surface.maxHeight <= 0) return undefined;
  const planet = planetOf(input.planet);
  const slots = (...patterns: BiomePattern[]) =>
    planet.biomes.flatMap((b, k) => (patterns.includes(b.pattern) ? [k] : []));
  // In the order `ForestGround.cover` fills them.
  const shareSlots = [
    slots("forest"),
    slots("taiga"),
    slots("grass"),
    slots("scrub"),
    slots("rock", "scree", "mesa", "basalt", "flows"),
    slots("tundra", "regolith", "ash", "dust", "earth", "cracked"),
    slots("tundra"),
  ];
  // Something grows where there is forest or scrub. A world with scrub and
  // no forest is a dry one.
  const wooded = shareSlots[0].length + shareSlots[1].length > 0;
  const alive = wooded || shareSlots[3].length > 0;

  // The rectangle the extension's picture covers, as the sheet's picture
  // coordinates place it in buildTerrainMesh.
  const margin = createMarginSurface(
    surface,
    input.extensionHeights,
    input.margin,
  );
  const down = input.extensionHeights.height;
  const mapRows = down - 2 * input.margin;
  const padX = (input.margin / margin.mapPixels) * surface.worldWidth;
  const padZ = (input.margin / mapRows) * surface.worldDepth;
  const picture = {
    minX: -surface.worldWidth / 2 - padX,
    maxX: surface.worldWidth / 2 + padX,
    minZ: -surface.worldDepth / 2 - padZ,
    maxZ: surface.worldDepth / 2 + padZ,
  };
  const haze = Math.min(
    margin.reachX / surface.worldWidth,
    margin.reachZ / surface.worldDepth,
  );
  const halfX = surface.worldWidth / 2;
  const halfZ = surface.worldDepth / 2;

  // Roads, as cells nothing grows in.
  const roadCols = Math.ceil((picture.maxX - picture.minX) / ROAD_CELL);
  const roadRows = Math.ceil((picture.maxZ - picture.minZ) / ROAD_CELL);
  const onRoad = new Uint8Array(roadCols * roadRows);
  const reach = Math.ceil(ROAD_CLEAR / ROAD_CELL);
  for (const road of input.roads) {
    for (let k = 1; k < road.line.length; k++) {
      const [ax, az] = surface.mapToWorldXZ(...road.line[k - 1]);
      const [bx, bz] = surface.mapToWorldXZ(...road.line[k]);
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(bx - ax, bz - az) / (ROAD_CELL / 2)),
      );
      for (let s = 0; s <= steps; s++) {
        const i = Math.floor(
          (ax + ((bx - ax) * s) / steps - picture.minX) / ROAD_CELL,
        );
        const j = Math.floor(
          (az + ((bz - az) * s) / steps - picture.minZ) / ROAD_CELL,
        );
        for (let dj = -reach; dj <= reach; dj++)
          for (let di = -reach; di <= reach; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && ii < roadCols && jj >= 0 && jj < roadRows)
              onRoad[jj * roadCols + ii] = 1;
          }
      }
    }
  }

  const { towns, cleared } = input;
  const cubed = new Float64Array(8);
  const plantedX = haze * HAZE_PLANTED * surface.worldWidth;
  const plantedZ = haze * HAZE_PLANTED * surface.worldDepth;
  const ground: ForestGround = {
    minX: Math.max(picture.minX, -halfX - plantedX),
    maxX: Math.min(picture.maxX, halfX + plantedX),
    minZ: Math.max(picture.minZ, -halfZ - plantedZ),
    maxZ: Math.min(picture.maxZ, halfZ + plantedZ),
    height: (x, z) => margin.heightAtWorld(x, z),
    // A heightmap pixel of 1 in 255 is the lowest land, so half that is sea.
    seaLevel: (0.5 / 255) * surface.heightScale * surface.scale,
    maxHeight: surface.maxHeight,
    cover(x, z, out) {
      const u = (x - picture.minX) / (picture.maxX - picture.minX);
      const v = (z - picture.minZ) / (picture.maxZ - picture.minZ);
      const i = Math.min(
        biomes.width - 1,
        Math.max(0, Math.floor(u * biomes.width)),
      );
      const j = Math.min(
        biomes.height - 1,
        Math.max(0, Math.floor(v * biomes.height)),
      );
      const k = (j * biomes.width + i) * 4;
      // Sharpened as the terrain picture sharpens them, so the trees stop
      // where the picture's forest does.
      let total = 0;
      for (let s = 0; s < 8; s++) {
        const w = (s < 4 ? biomes.a[k + s] : biomes.b[k + s - 4]) / 255;
        cubed[s] = w * w * w;
        total += cubed[s];
      }
      shareSlots.forEach((list, n) => {
        let sum = 0;
        for (const s of list) sum += cubed[s];
        out[n] = total > 0 ? sum / total : 0;
      });
    },
    riverEdge: riverEdgeReader(
      input.rivers,
      input.picture,
      input.margin,
      surface,
    ),
    blocked(x, z) {
      const i = Math.floor((x - picture.minX) / ROAD_CELL);
      const j = Math.floor((z - picture.minZ) / ROAD_CELL);
      if (onRoad[j * roadCols + i]) return true;
      for (const c of cleared)
        if (Math.hypot(x - c.x, z - c.z) < c.radius) return true;
      for (const t of towns) {
        const dx = x - t.x;
        const dz = z - t.z;
        const d = Math.hypot(dx, dz);
        // 1.27 is the most a town's edge reaches past its radius.
        if (d > t.radius * 1.27 * TOWN_CLEAR) continue;
        if (d < townEdge(t, Math.atan2(dz, dx)) * TOWN_CLEAR) return true;
      }
      return false;
    },
  };

  const forest = plantForest(ground, input.seed, TERRAIN_SUN, {
    autumn: planet.forest?.turning,
    alive,
    arid: alive && !wooded,
  });

  const long = Math.max(
    picture.maxX - picture.minX,
    picture.maxZ - picture.minZ,
  );
  const texel = Math.max(COVER_TEXEL, long / COVER_MAX);
  const width = Math.ceil((picture.maxX - picture.minX) / texel);
  const height = Math.ceil((picture.maxZ - picture.minZ) / texel);
  return {
    forest,
    bounds: {
      minX: ground.minX,
      maxX: ground.maxX,
      minZ: ground.minZ,
      maxZ: ground.maxZ,
    },
    haze,
    cover: {
      data: forestCoverPixels(forest, picture, width, height, TERRAIN_SUN),
      width,
      height,
    },
  };
}
