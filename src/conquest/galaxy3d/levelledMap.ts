/**
 * A terrain map laid out on ground that is level under its towns, so the
 * buildings stand on it. The roads are routed and the towns planned on the
 * map's own heights, then the ground is levelled under the towns and the map
 * is laid out again on the result. No GPU work happens here.
 */
import type { GalaxyDoc } from "../model";
import { type CrossingPlan, planCrossings } from "./crossingPlan";
import { type GroundPlan, planGround } from "./groundLayer";
import {
  type HeightGrid,
  layoutStrategicMap,
  type StrategicLayout,
} from "./terrain";
import type { TerrainExtension } from "./terrainMesh";
import { townsOnRoads } from "./townLayer";
import type { Town } from "./towns";
import { levelGround } from "./towns3d/level";

export interface LevelledMap {
  /** Built from the levelled heights. */
  layout: StrategicLayout;
  /** Levelled, or the very grid passed in. */
  heights: HeightGrid | undefined;
  extension: TerrainExtension | undefined;
  crossingPlan: CrossingPlan | undefined;
  /** Set for a terrain map. */
  plan: GroundPlan | undefined;
  /** Set when towns are drawn. */
  towns: Town[] | undefined;
}

export function layoutLevelledMap(
  galaxy: GalaxyDoc,
  heights: HeightGrid | undefined,
  extension: TerrainExtension | undefined,
  opts: {
    maxSegments: number;
    drawTowns: boolean;
    /** Leave rivers out of road routing, as performance mode does. */
    routeRivers: boolean;
    /** Locations not to level, by node index. */
    skip: ReadonlySet<number>;
  },
): LevelledMap {
  const first = layoutStrategicMap(galaxy, heights, opts.maxSegments);
  const surface = first.surface;
  if (!surface) {
    return {
      layout: first,
      heights,
      extension,
      crossingPlan: undefined,
      plan: undefined,
      towns: undefined,
    };
  }

  const crossingPlan = planCrossings(galaxy, surface);
  const planned: { towns?: Town[] } = {};
  const plan = planGround(
    galaxy,
    surface,
    heights,
    crossingPlan.tracks,
    opts.drawTowns
      ? (roads) => {
          const shaped = townsOnRoads(galaxy, surface, roads);
          planned.towns = shaped.towns;
          return shaped.roads;
        }
      : undefined,
    opts.drawTowns,
    crossingPlan.landLinks,
    opts.routeRivers ? extension : undefined,
  );
  const towns = planned.towns;

  if (!heights || !towns) {
    return { layout: first, heights, extension, crossingPlan, plan, towns };
  }
  const levelled = levelGround(
    { heights, extension },
    towns.filter((town) => !opts.skip.has(town.node)),
    { worldWidth: surface.worldWidth, worldDepth: surface.worldDepth },
  );
  return {
    layout: layoutStrategicMap(galaxy, levelled.heights, opts.maxSegments),
    heights: levelled.heights,
    extension: levelled.extension,
    crossingPlan,
    plan,
    towns,
  };
}
