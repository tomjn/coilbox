import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import {
  type GroundShading,
  ROAD_MODE,
  ROAD_STATE_ROWS,
  type RoadMode,
} from "./groundShader";
import { planProvinceRoads } from "./provinceRoads";
import { buildRoadMask, ROAD_REACH, type RoadLine } from "./roadMask";
import { planRoads, sceneSeed } from "./roadNetwork";
import { routeGrid } from "./roadRoute";
import type { RoadLink } from "./roads";
import type { HeightGrid, TerrainSurface } from "./terrain";

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

export interface GroundLayer {
  shading: GroundShading;
  /**
   * The roads, in `roadLinks` order, then the extra tracks, each as the
   * pieces it is painted in. A piece's `index` is its road's state.
   */
  roads: RoadLine[];
  /**
   * The roads between neighbouring provinces' towns, in order, from state
   * index {@link firstProvince}. Empty unless asked for.
   */
  provinceRoads: RoadLink[];
  /** The state index of the first road between provinces. */
  firstProvince: number;
  /** The state index of the first extra track. */
  firstExtra: number;
  /** Restyle road `k`. Takes effect at {@link commit}. */
  setRoadStyle: (k: number, style: RoadStyle) => void;
  /** Send the road states to the GPU. */
  commit: () => void;
}

const scratch = new THREE.Color();
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

export function buildGroundLayer(
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  heights: HeightGrid | undefined,
  /**
   * Tracks painted after the roads, each with a state of its own, such as a
   * sea crossing's track from a location down to its landing point.
   */
  extra: readonly Omit<RoadLine, "index">[] = [],
  /**
   * Reshape the roads and tracks before they are painted, keeping each one's
   * index, as `townsOnRoads` cuts them where they reach a town.
   */
  shape?: (roads: RoadLine[]) => RoadLine[],
  /**
   * Also join the towns of every two neighbouring provinces by a road. Only
   * where towns are drawn, since the roads run from town to town.
   */
  provinceRoads = false,
): GroundLayer {
  const grid = routeGrid(
    surface.width,
    surface.height,
    surface.heightScale,
    sceneSeed(galaxy),
    heights,
  );
  const linkRoads = planRoads(
    galaxy,
    surface.width,
    surface.height,
    surface.heightScale,
    heights,
    grid,
  );
  const firstProvince = linkRoads.length;
  const between = provinceRoads
    ? planProvinceRoads(galaxy, grid, firstProvince)
    : { links: [], roads: [] };
  const firstExtra = firstProvince + between.roads.length;
  const planned = [
    ...linkRoads,
    ...between.roads,
    ...extra.map((t, j) => ({
      line: t.line,
      surface: t.surface,
      index: firstExtra + j,
    })),
  ];
  const roads = shape ? shape(planned) : planned;
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

  // One state per planned road, whatever pieces it was cut into.
  const columns = Math.max(1, planned.length);
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

  return {
    roads,
    provinceRoads: between.links,
    firstProvince,
    firstExtra,
    shading: {
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
      if (k < 0 || k >= planned.length) return;
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
    commit: () => {
      roadState.needsUpdate = true;
    },
  };
}
