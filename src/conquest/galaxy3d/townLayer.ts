import type * as THREE from "three";
import type { GalaxyDoc } from "../model";
import type { RoadLine } from "./roadMask";
import { sceneSeed } from "./roadNetwork";
import type { TerrainSurface } from "./terrain";
import {
  clipRoads,
  planTowns,
  roadEntries,
  type Town,
  withStreets,
} from "./towns";

/**
 * The towns of a generated terrain map, planned from its roads, and the state
 * each one is drawn in. Where the towns go and how big they are is pure
 * (`towns.ts`). The 3D buildings are drawn by `towns3d/townModelLayer.ts`.
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
    /**
     * A landmark's ring only, which stands in for its badge: the faction
     * shape it is drawn as, 0 or left out for round.
     */
    sides?: number;
    /** A landmark's ring only: how many times a town's ring it is wide. */
    weight?: number;
  };
}

/** How far along a road its direction into a town is read, in world units. */
const ENTRY_REACH = 1;

/**
 * A town at every node, sized by its roads and shaped by where they go, and
 * the roads cut where they reach a town, so a road stops at the town's edge
 * and its state is never drawn over the houses. Each town's main streets run
 * on from where its roads stop. Give the result's roads to the ground layer
 * in place of `roads`.
 */
export function townsOnRoads(
  galaxy: GalaxyDoc,
  surface: Pick<TerrainSurface, "mapToWorldXZ">,
  roads: RoadLine[],
): { towns: Town[]; roads: RoadLine[] } {
  const toWorld = (x: number, y: number) => surface.mapToWorldXZ(x, y);
  // Every road and every crossing's track to its landing ends on an anchor.
  const entries = roadEntries(
    galaxy.nodes.map((n) => [n.pos[0], n.pos[1]]),
    roads.map((r) => r.line),
    toWorld,
    ENTRY_REACH,
  );
  const planned = planTowns(
    galaxy.nodes.map((n, i) => {
      const [x, z] = toWorld(n.pos[0], n.pos[1]);
      return { x, z, capital: n.kind === "capital", roads: entries[i] };
    }),
    sceneSeed(galaxy),
  );
  const { pieces, arrivals } = clipRoads(
    roads.map((r) => r.line),
    planned,
    toWorld,
  );
  return {
    towns: withStreets(planned, arrivals),
    roads: roads.flatMap((road, k) =>
      pieces[k].map((line) => ({ ...road, line })),
    ),
  };
}
