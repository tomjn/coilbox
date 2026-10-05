import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import type { GroundLayer } from "./groundLayer";
import { sceneSeed } from "./roadNetwork";
import type { TerrainSurface } from "./terrain";
import { TOWN_STATE_ROWS, townMaterial } from "./townShader";
import {
  buildableAt,
  buildTownIndex,
  planTowns,
  roadEntries,
  type Town,
  townDataTexels,
  townPatches,
} from "./towns";

/**
 * A town at every location of a generated terrain map, drawn on patches of
 * ground laid over the terrain (`townShader.ts`), and the state each one is
 * drawn in. Where the towns go and how big they are is pure (`towns.ts`).
 * This puts them on the GPU, once per map.
 */

/** How one town is drawn now. */
export interface TownStyle {
  /** Hidden by fog: drawn dim and grey. */
  hidden: boolean;
  /** The ring round the town's edge, or none. */
  ring?: {
    color: THREE.Color;
    /** 0 to 1. */
    strength: number;
    /** True for the thick ring of a selected town. */
    thick: boolean;
  };
}

export interface TownLayer {
  /** The towns by node index. */
  towns: Town[];
  /** Restyle the town of node `i`. Takes effect at {@link commit}. */
  setTownStyle: (i: number, style: TownStyle) => void;
  /** Send the town states to the GPU. */
  commit: () => void;
}

/** How far along a road its direction into a town is read, in world units. */
const ENTRY_REACH = 1;
/** How far above the terrain the patches lie, in world units. */
const PATCH_LIFT = 0.005;
/**
 * Drawn after the province fills (`provinceLayer.ts`, -3), so a town keeps its
 * own colours inside an owner's tint, and before the borders (-2).
 */
const TOWN_ORDER = -2.5;
/** The steps the ground's slope is judged over, in world units. */
const SLOPE_STEP = 0.25;

const scratch = new THREE.Color();
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** A texture read texel by texel, never blended. */
function exact(texture: THREE.DataTexture): THREE.DataTexture {
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export function buildTownLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  ground: Pick<GroundLayer, "roads" | "shading">,
): TownLayer {
  const towns = planMapTowns(galaxy, surface, ground.roads);
  const columns = Math.max(1, towns.length);
  const state = new Uint8Array(columns * TOWN_STATE_ROWS * 4);

  // A heightmap pixel of 1 in 255 is the lowest land, so half that is sea.
  const sea = (0.5 / 255) * surface.heightScale * surface.scale;
  const index = buildTownIndex(
    towns,
    surface.worldWidth,
    surface.worldDepth,
    undefined,
    buildableAt((x, z) => surface.groundHeightAtWorld(x, z), sea, SLOPE_STEP),
  );
  // The town in each texel is read exactly, and the ground's fitness blended.
  const indexTexture = new THREE.DataTexture(
    index.data,
    index.width,
    index.height,
    THREE.RGBAFormat,
  );
  indexTexture.flipY = false;
  indexTexture.magFilter = THREE.LinearFilter;
  indexTexture.minFilter = THREE.LinearFilter;
  indexTexture.needsUpdate = true;
  const data = exact(
    new THREE.DataTexture(
      townDataTexels(towns),
      columns,
      2,
      THREE.RGBAFormat,
      THREE.FloatType,
    ),
  );
  const stateTexture = exact(
    new THREE.DataTexture(state, columns, TOWN_STATE_ROWS, THREE.RGBAFormat),
  );
  const patches = townPatches(towns, surface, PATCH_LIFT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(patches.positions, 3));
  geo.setAttribute("town", new THREE.BufferAttribute(patches.town, 1));
  geo.setIndex(new THREE.BufferAttribute(patches.index, 1));
  const mat = townMaterial({
    index: indexTexture,
    indexSize: [index.width, index.height],
    data,
    state: stateTexture,
    roadDistance: ground.shading.roadDistance,
    roadReach: ground.shading.roadReach,
    frame: ground.shading.frame,
  });
  disposables.push(indexTexture, data, stateTexture, geo, mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "towns";
  mesh.renderOrder = TOWN_ORDER;
  mesh.raycast = () => {};
  if (towns.length > 0) scene.add(mesh);

  return {
    towns,
    setTownStyle: (i, style) => {
      if (i < 0 || i >= towns.length) return;
      const top = i * 4;
      const ring = style.ring;
      if (ring) scratch.copy(ring.color).convertLinearToSRGB();
      state[top] = ring ? byte(scratch.r) : 0;
      state[top + 1] = ring ? byte(scratch.g) : 0;
      state[top + 2] = ring ? byte(scratch.b) : 0;
      state[top + 3] = ring ? byte(ring.strength) : 0;
      const low = (columns + i) * 4;
      state[low] = style.hidden ? 255 : 0;
      state[low + 1] = ring?.thick ? 255 : 0;
    },
    commit: () => {
      stateTexture.needsUpdate = true;
    },
  };
}

/** A town at every node, sized by its roads and shaped by where they go. */
function planMapTowns(
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  roads: GroundLayer["roads"],
): Town[] {
  const toWorld = (x: number, y: number) => surface.mapToWorldXZ(x, y);
  // Every road and every crossing's track to its landing ends on an anchor.
  const entries = roadEntries(
    galaxy.nodes.map((n) => [n.pos[0], n.pos[1]]),
    roads.map((r) => r.line),
    toWorld,
    ENTRY_REACH,
  );
  return planTowns(
    galaxy.nodes.map((n, i) => {
      const [x, z] = toWorld(n.pos[0], n.pos[1]);
      return { x, z, capital: n.kind === "capital", roads: entries[i] };
    }),
    sceneSeed(galaxy),
  );
}
