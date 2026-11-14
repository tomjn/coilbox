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
import { type TerrainSurface, VIEW_FOV_DEGREES } from "../terrain";
import { outerRingColor, type TerrainExtension } from "../terrainMesh";
import {
  CACTUS_STEM,
  DEAD_WOOD,
  type ForestFrame,
  treeMaterial,
} from "./material";
import { type Forest, SPECIES } from "./placement";
import type { PlantedForest } from "./plant";
import { treeGeometry } from "./trees";

export interface ForestLayer {
  /** Canopy in red and tree shadow in green, over the extension's picture. */
  cover: THREE.DataTexture;
  /** How many trees stand on the map. */
  count: number;
  /** Call before each draw, with the height of the view in pixels. */
  update(camera: THREE.PerspectiveCamera, viewHeight: number): void;
}

/** The name of every tree mesh, so a probe can find them. */
export const FOREST_NAME = "forest-trees";
/** The side of a tile, in world units. */
const TILE = 8;
/** A tree this tall, drawn fewer pixels high than `NEAR_PIXELS`, takes its far shape. */
const TYPICAL_TREE = 0.25;
const NEAR_PIXELS = 12;

/**
 * Build a planted forest's trees into `scene`. See `plant.ts` for the
 * planting, which the land worker does.
 */
export function buildForestLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  extension: TerrainExtension,
  planetId: PlanetId,
  planted: PlantedForest,
): ForestLayer {
  const planet = planetOf(planetId);
  const { forest } = planted;
  const [fr, fg, fb] = outerRingColor(extension.image);
  const frame: ForestFrame = {
    halfX: surface.worldWidth / 2,
    halfZ: surface.worldDepth / 2,
    width: surface.worldWidth,
    depth: surface.worldDepth,
    haze: planted.haze,
    far: new THREE.Color().setRGB(
      fr / 255,
      fg / 255,
      fb / 255,
      THREE.SRGBColorSpace,
    ),
  };

  const cover = new THREE.DataTexture(
    planted.cover.data,
    planted.cover.width,
    planted.cover.height,
    THREE.RGFormat,
  );
  cover.flipY = false;
  cover.unpackAlignment = 1;
  cover.magFilter = THREE.LinearFilter;
  cover.minFilter = THREE.LinearFilter;
  cover.needsUpdate = true;
  disposables.push(cover);

  const tiles = buildTiles(
    scene,
    disposables,
    forest,
    planet,
    frame,
    planted.bounds,
  );
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

/** One tree to draw: where it stands, its size and turn, and its own shade 0 to 1. */
export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  turn: number;
  pick: number;
}

/**
 * One mesh that draws `trees` as copies of `shape`, for a few trees outside
 * the forest such as a town's street trees. The caller disposes the geometry.
 */
export function instancedTrees(
  shape: THREE.BufferGeometry,
  material: THREE.Material,
  trees: readonly TreeInstance[],
): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  for (const name of ["position", "normal", "up", "foliage"])
    g.setAttribute(name, shape.getAttribute(name));
  const at = new Float32Array(trees.length * 3);
  const size = new Float32Array(trees.length * 3);
  const tree = new Float32Array(trees.length * 4);
  const box = new THREE.Box3();
  trees.forEach((t, k) => {
    at.set([t.x, t.y, t.z], k * 3);
    size.set([t.width, t.height, t.turn], k * 3);
    tree.set([t.pick, 0, 0, (t.pick * 7.31 + t.turn) % 1], k * 4);
    box.expandByPoint(new THREE.Vector3(t.x - t.width, t.y, t.z - t.width));
    box.expandByPoint(
      new THREE.Vector3(t.x + t.width, t.y + t.height * 1.2, t.z + t.width),
    );
  });
  g.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 3));
  g.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 3));
  g.setAttribute("aTree", new THREE.InstancedBufferAttribute(tree, 4));
  g.instanceCount = trees.length;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, material);
  mesh.raycast = () => {};
  return mesh;
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
  ground: PlantedForest["bounds"],
): Tile[] {
  const shapes = SPECIES.map((s) => {
    const near = treeGeometry(s, false);
    const far = treeGeometry(s, true);
    const material = treeMaterial(
      planet,
      {
        conifer: s.conifer,
        pale: s.id === "birch",
        rock: s.look === "rock",
        stem:
          s.look === "cactus"
            ? CACTUS_STEM
            : s.look === "wood"
              ? DEAD_WOOD
              : undefined,
      },
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
