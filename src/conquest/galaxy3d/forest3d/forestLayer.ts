/**
 * The trees of a terrain map, as real shapes standing on the ground. The map
 * is cut into square tiles, and each tile draws each kind of tree it holds in
 * one call, every tree a copy of that kind's shape. A tile seen from far off
 * draws the same trees in fewer triangles.
 *
 * The layer also gives the terrain picture what the trees do to the ground:
 * where the canopy stands over it and where their shadows fall, as
 * {@link ForestLayer.cover}. The picture draws the forest floor from that, so
 * the ground and the trees always agree.
 */
import * as THREE from "three";
import { type PlanetId, planetOf } from "../../planets";
import type { RoadLine } from "../roadMask";
import {
  createMarginSurface,
  TERRAIN_SUN,
  type TerrainSurface,
  VIEW_FOV_DEGREES,
} from "../terrain";
import { outerRingColor, type TerrainExtension } from "../terrainMesh";
import { type Town, townEdge } from "../towns";
import type { TownGround } from "../towns3d/layout";
import { type ForestFrame, treeMaterial } from "./material";
import {
  type Forest,
  type ForestGround,
  forestCoverPixels,
  plantForest,
  SPECIES,
} from "./placement";
import { treeGeometry } from "./trees";

export interface ForestLayer {
  /** Canopy in red and tree shadow in green, over the extension's picture. */
  cover: THREE.DataTexture;
  /** How many trees stand on the map. */
  count: number;
  /** Call before each draw, with the height of the view in pixels. */
  update(camera: THREE.PerspectiveCamera, viewHeight: number): void;
}

export interface ForestOptions {
  planet: PlanetId;
  /** The same seed plants the same forest. */
  seed: number;
  towns?: Town[];
  /** Circles nothing grows in, such as a landmark's site. */
  cleared?: { x: number; z: number; radius: number }[];
  roads?: RoadLine[];
  riverEdge?: TownGround["riverEdge"];
}

/** The name of every tree mesh, so a probe can find them. */
export const FOREST_NAME = "forest-trees";
/** The side of a tile, in world units. */
const TILE = 8;
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
/** A tree this tall, drawn fewer pixels high than `NEAR_PIXELS`, takes its far shape. */
const TYPICAL_TREE = 0.25;
const NEAR_PIXELS = 12;

/**
 * Plant a generated map and build its trees into `scene`. Answers undefined
 * for a map with no biome weights or a planet where nothing grows.
 */
export function buildForestLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  extension: TerrainExtension,
  opts: ForestOptions,
): ForestLayer | undefined {
  const planet = planetOf(opts.planet);
  const biomes = extension.biomes;
  if (!biomes || !planet.forest || surface.maxHeight <= 0) return undefined;
  const slots = (pattern: string) =>
    planet.biomes.flatMap((b, k) => (b.pattern === pattern ? [k] : []));
  const forestSlots = slots("forest");
  const taigaSlots = slots("taiga");
  const grassSlots = slots("grass");
  if (forestSlots.length + taigaSlots.length === 0) return undefined;

  // The rectangle the extension's picture covers, as the sheet's picture
  // coordinates place it in buildTerrainMesh.
  const margin = createMarginSurface(
    surface,
    extension.heights,
    extension.margin,
  );
  const down = extension.heights.height;
  const mapRows = down - 2 * extension.margin;
  const padX = (extension.margin / margin.mapPixels) * surface.worldWidth;
  const padZ = (extension.margin / mapRows) * surface.worldDepth;
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
  const [fr, fg, fb] = outerRingColor(extension.image);
  const frame: ForestFrame = {
    halfX: surface.worldWidth / 2,
    halfZ: surface.worldDepth / 2,
    width: surface.worldWidth,
    depth: surface.worldDepth,
    haze,
    far: new THREE.Color().setRGB(
      fr / 255,
      fg / 255,
      fb / 255,
      THREE.SRGBColorSpace,
    ),
  };

  // Roads, as cells nothing grows in.
  const roadCols = Math.ceil((picture.maxX - picture.minX) / ROAD_CELL);
  const roadRows = Math.ceil((picture.maxZ - picture.minZ) / ROAD_CELL);
  const onRoad = new Uint8Array(roadCols * roadRows);
  const reach = Math.ceil(ROAD_CLEAR / ROAD_CELL);
  for (const road of opts.roads ?? []) {
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

  const towns = opts.towns ?? [];
  const cleared = opts.cleared ?? [];
  const cubed = new Float64Array(8);
  const ground: ForestGround = {
    minX: Math.max(
      picture.minX,
      -frame.halfX - haze * HAZE_PLANTED * frame.width,
    ),
    maxX: Math.min(
      picture.maxX,
      frame.halfX + haze * HAZE_PLANTED * frame.width,
    ),
    minZ: Math.max(
      picture.minZ,
      -frame.halfZ - haze * HAZE_PLANTED * frame.depth,
    ),
    maxZ: Math.min(
      picture.maxZ,
      frame.halfZ + haze * HAZE_PLANTED * frame.depth,
    ),
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
      const share = (list: number[]) => {
        let sum = 0;
        for (const s of list) sum += cubed[s];
        return total > 0 ? sum / total : 0;
      };
      out[0] = share(forestSlots);
      out[1] = share(taigaSlots);
      out[2] = share(grassSlots);
    },
    riverEdge: opts.riverEdge,
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

  const forest = plantForest(
    ground,
    opts.seed,
    TERRAIN_SUN,
    planet.forest.turning,
  );

  const long = Math.max(
    picture.maxX - picture.minX,
    picture.maxZ - picture.minZ,
  );
  const texel = Math.max(COVER_TEXEL, long / COVER_MAX);
  const coverWidth = Math.ceil((picture.maxX - picture.minX) / texel);
  const coverHeight = Math.ceil((picture.maxZ - picture.minZ) / texel);
  const cover = new THREE.DataTexture(
    forestCoverPixels(forest, picture, coverWidth, coverHeight, TERRAIN_SUN),
    coverWidth,
    coverHeight,
    THREE.RGFormat,
  );
  cover.flipY = false;
  cover.unpackAlignment = 1;
  cover.magFilter = THREE.LinearFilter;
  cover.minFilter = THREE.LinearFilter;
  cover.needsUpdate = true;
  disposables.push(cover);

  const tiles = buildTiles(scene, disposables, forest, planet, frame, ground);
  const half = Math.tan((VIEW_FOV_DEGREES * Math.PI) / 360);
  return {
    cover,
    count: forest.count,
    update(camera, viewHeight) {
      for (const tile of tiles) {
        const d = Math.max(
          0.1,
          camera.position.distanceTo(tile.centre) - tile.radius,
        );
        const near =
          (TYPICAL_TREE * viewHeight) / (2 * d * half) >= NEAR_PIXELS;
        for (const m of tile.near) m.visible = near;
        for (const m of tile.far) m.visible = !near;
      }
    },
  };
}

interface Tile {
  centre: THREE.Vector3;
  radius: number;
  near: THREE.Mesh[];
  far: THREE.Mesh[];
}

function buildTiles(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  forest: Forest,
  planet: ReturnType<typeof planetOf>,
  frame: ForestFrame,
  ground: ForestGround,
): Tile[] {
  const shapes = SPECIES.map((s) => {
    const near = treeGeometry(s, false);
    const far = treeGeometry(s, true);
    const material = treeMaterial(
      planet,
      { conifer: s.conifer, pale: s.id === "birch" },
      frame,
    );
    disposables.push(near, far, material);
    return { near, far, material };
  });

  const cols = Math.max(1, Math.ceil((ground.maxX - ground.minX) / TILE));
  const rows = Math.max(1, Math.ceil((ground.maxZ - ground.minZ) / TILE));
  // The trees of each tile, by kind.
  const lists = new Map<number, number[]>();
  for (let t = 0; t < forest.count; t++) {
    const i = Math.min(
      cols - 1,
      Math.floor((forest.x[t] - ground.minX) / TILE),
    );
    const j = Math.min(
      rows - 1,
      Math.floor((forest.z[t] - ground.minZ) / TILE),
    );
    const key = (j * cols + i) * SPECIES.length + forest.species[t];
    const list = lists.get(key);
    if (list) list.push(t);
    else lists.set(key, [t]);
  }

  const tiles = new Map<number, Tile>();
  const bounds = new Map<number, THREE.Box3>();
  for (const [key, list] of lists) {
    const kind = key % SPECIES.length;
    const tileKey = (key - kind) / SPECIES.length;
    const n = list.length;
    const at = new Float32Array(n * 3);
    const size = new Float32Array(n * 3);
    const tree = new Float32Array(n * 4);
    const box = bounds.get(tileKey) ?? new THREE.Box3();
    bounds.set(tileKey, box);
    list.forEach((t, k) => {
      at.set([forest.x[t], forest.y[t], forest.z[t]], k * 3);
      size.set([forest.width[t], forest.height[t], forest.turn[t]], k * 3);
      tree.set(
        [
          forest.pick[t],
          forest.turning[t],
          forest.shade[t],
          (forest.pick[t] * 7.31 + forest.turn[t]) % 1,
        ],
        k * 4,
      );
      const r = forest.width[t];
      box.expandByPoint(
        new THREE.Vector3(forest.x[t] - r, forest.y[t], forest.z[t] - r),
      );
      box.expandByPoint(
        new THREE.Vector3(
          forest.x[t] + r,
          forest.y[t] + forest.height[t] * 1.2,
          forest.z[t] + r,
        ),
      );
    });
    const attrs = {
      aAt: new THREE.InstancedBufferAttribute(at, 3),
      aSize: new THREE.InstancedBufferAttribute(size, 3),
      aTree: new THREE.InstancedBufferAttribute(tree, 4),
    };
    const tile = tiles.get(tileKey) ?? {
      centre: new THREE.Vector3(),
      radius: 0,
      near: [],
      far: [],
    };
    tiles.set(tileKey, tile);
    const shape = shapes[kind];
    for (const [base, into] of [
      [shape.near, tile.near],
      [shape.far, tile.far],
    ] as const) {
      const g = new THREE.InstancedBufferGeometry();
      for (const name of ["position", "normal", "up", "foliage"])
        g.setAttribute(name, base.getAttribute(name));
      for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, a);
      g.instanceCount = n;
      disposables.push(g);
      const mesh = new THREE.Mesh(g, shape.material);
      mesh.name = FOREST_NAME;
      // Decoration: picking goes to the map and what stands on it.
      mesh.raycast = () => {};
      scene.add(mesh);
      into.push(mesh);
    }
  }
  // Each mesh is culled by its tile's own bounds, which hold every tree in it.
  for (const [tileKey, tile] of tiles) {
    const sphere = (bounds.get(tileKey) as THREE.Box3).getBoundingSphere(
      new THREE.Sphere(),
    );
    tile.centre.copy(sphere.center);
    tile.radius = sphere.radius;
    for (const m of [...tile.near, ...tile.far])
      m.geometry.boundingSphere = sphere;
  }
  return [...tiles.values()];
}
