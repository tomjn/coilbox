import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import {
  type GroundShading,
  ROAD_MODE,
  ROAD_STATE_ROWS,
  type RoadMode,
  TOWN_STATE_ROWS,
  type TownShading,
} from "./groundShader";
import { buildRoadMask, ROAD_REACH, type RoadLine } from "./roadMask";
import { planRoads, sceneSeed } from "./roadNetwork";
import { roadLinks } from "./roads";
import type { HeightGrid, TerrainSurface } from "./terrain";
import {
  buildTownIndex,
  leavingAngle,
  planTowns,
  type Town,
  townDataTexels,
} from "./towns";

/**
 * The textures that paint roads into a terrain map's ground, built once when
 * the map is drawn, and the per-road state the shader reads from them. The
 * routing and the mask are pure (`roadNetwork.ts`, `roadMask.ts`). This only
 * puts them on the GPU and keeps the state texture current.
 */

/** How one road is drawn now. */
export interface RoadStyle {
  /** False hides the road altogether, as fog does. */
  shown: boolean;
  mode: RoadMode;
  /** The state's colour. Not read for {@link ROAD_MODE.plain}. */
  color: THREE.Color;
  /** How strongly the state shows, 0 to 1. */
  strength: number;
  emphasised: boolean;
}

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

export interface GroundLayer {
  shading: GroundShading;
  /** The roads, in `roadLinks` order. */
  roads: RoadLine[];
  /** The towns by node index, or empty when none are drawn. */
  towns: Town[];
  /** Restyle road `k`. Takes effect at {@link commit}. */
  setRoadStyle: (k: number, style: RoadStyle) => void;
  /** Restyle the town of node `i`. Takes effect at {@link commit}. */
  setTownStyle: (i: number, style: TownStyle) => void;
  /** Send the road and town states to the GPU. */
  commit: () => void;
}

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

/**
 * Build the roads and, with `withTowns`, a town at every node. Towns are
 * left off for a hand-made map, whose painted picture may show its own, and
 * in performance mode.
 */
export function buildGroundLayer(
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  heights: HeightGrid | undefined,
  withTowns = false,
): GroundLayer {
  const roads = planRoads(
    galaxy,
    surface.width,
    surface.height,
    surface.heightScale,
    heights,
  );
  const mask = buildRoadMask(
    roads,
    surface.width,
    surface.height,
    surface.scale,
  );
  // The distances alone, one byte a texel, blended and mipmapped: the one read
  // every pixel of the sheet makes. The whole mask is read only near a road.
  const distances = new Uint8Array(mask.width * mask.height);
  for (let t = 0; t < distances.length; t++) distances[t] = mask.data[t * 4];
  const roadDistance = new THREE.DataTexture(
    distances,
    mask.width,
    mask.height,
    THREE.RedFormat,
  );
  roadDistance.flipY = false;
  roadDistance.magFilter = THREE.LinearFilter;
  roadDistance.minFilter = THREE.LinearMipmapLinearFilter;
  roadDistance.generateMipmaps = true;
  roadDistance.needsUpdate = true;
  const roadMask = new THREE.DataTexture(
    mask.data,
    mask.width,
    mask.height,
    THREE.RGBAFormat,
  );
  roadMask.flipY = false;
  roadMask.magFilter = THREE.NearestFilter;
  roadMask.minFilter = THREE.NearestFilter;
  roadMask.needsUpdate = true;

  const columns = Math.max(1, roads.length);
  const state = new Uint8Array(columns * ROAD_STATE_ROWS * 4);
  // Every road starts drawn and plain.
  for (let k = 0; k < columns; k++) state[(columns + k) * 4] = 255;
  const roadState = new THREE.DataTexture(
    state,
    columns,
    ROAD_STATE_ROWS,
    THREE.RGBAFormat,
  );
  roadState.flipY = false;
  roadState.magFilter = THREE.NearestFilter;
  roadState.minFilter = THREE.NearestFilter;
  roadState.needsUpdate = true;
  disposables.push(roadDistance, roadMask, roadState);

  const towns = withTowns ? planMapTowns(galaxy, surface, roads) : [];
  const townColumns = Math.max(1, towns.length);
  const townState = new Uint8Array(townColumns * TOWN_STATE_ROWS * 4);
  let townShading: TownShading | undefined;
  if (towns.length > 0) {
    const index = buildTownIndex(towns, surface.worldWidth, surface.worldDepth);
    const indexTexture = exact(
      new THREE.DataTexture(
        index.data,
        index.width,
        index.height,
        THREE.RGFormat,
      ),
    );
    const data = exact(
      new THREE.DataTexture(
        townDataTexels(towns),
        townColumns,
        2,
        THREE.RGBAFormat,
        THREE.FloatType,
      ),
    );
    const state = exact(
      new THREE.DataTexture(
        townState,
        townColumns,
        TOWN_STATE_ROWS,
        THREE.RGBAFormat,
      ),
    );
    disposables.push(indexTexture, data, state);
    townShading = {
      index: indexTexture,
      indexSize: [index.width, index.height],
      data,
      state,
    };
  }

  return {
    roads,
    towns,
    shading: {
      towns: townShading,
      roadDistance,
      roadMask,
      roadMaskSize: [mask.width, mask.height],
      roadState,
      roadReach: ROAD_REACH,
      frame: new THREE.Vector4(
        surface.worldWidth / 2,
        surface.worldDepth / 2,
        surface.worldWidth,
        surface.worldDepth,
      ),
    },
    setRoadStyle: (k, style) => {
      if (k < 0 || k >= roads.length) return;
      const top = k * 4;
      scratch.copy(style.color).convertLinearToSRGB();
      state[top] = byte(scratch.r);
      state[top + 1] = byte(scratch.g);
      state[top + 2] = byte(scratch.b);
      state[top + 3] =
        style.mode === ROAD_MODE.plain ? 0 : byte(style.strength);
      const low = (columns + k) * 4;
      state[low] = style.shown ? 255 : 0;
      state[low + 1] = style.mode;
      state[low + 2] = style.emphasised ? 255 : 0;
    },
    setTownStyle: (i, style) => {
      if (!townShading || i < 0 || i >= towns.length) return;
      const top = i * 4;
      const ring = style.ring;
      if (ring) scratch.copy(ring.color).convertLinearToSRGB();
      townState[top] = ring ? byte(scratch.r) : 0;
      townState[top + 1] = ring ? byte(scratch.g) : 0;
      townState[top + 2] = ring ? byte(scratch.b) : 0;
      townState[top + 3] = ring ? byte(ring.strength) : 0;
      const low = (townColumns + i) * 4;
      townState[low] = style.hidden ? 255 : 0;
      townState[low + 1] = ring?.thick ? 255 : 0;
    },
    commit: () => {
      roadState.needsUpdate = true;
      if (townShading) townShading.state.needsUpdate = true;
    },
  };
}

/** How far along a road its direction into a town is read, in world units. */
const ENTRY_REACH = 1;

/** A town at every node, sized by its roads and shaped by where they go. */
function planMapTowns(
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  roads: RoadLine[],
): Town[] {
  const toWorld = (x: number, y: number) => surface.mapToWorldXZ(x, y);
  const index = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  const entries: number[][] = galaxy.nodes.map(() => []);
  roadLinks(galaxy).forEach(({ a, b }, k) => {
    const line = roads[k]?.line;
    if (!line || line.length < 2) return;
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia !== undefined) {
      entries[ia].push(leavingAngle(line, toWorld, ENTRY_REACH));
    }
    if (ib !== undefined) {
      entries[ib].push(leavingAngle([...line].reverse(), toWorld, ENTRY_REACH));
    }
  });
  return planTowns(
    galaxy.nodes.map((n, i) => {
      const [x, z] = toWorld(n.pos[0], n.pos[1]);
      return { x, z, capital: n.kind === "capital", roads: entries[i] };
    }),
    sceneSeed(galaxy),
  );
}
