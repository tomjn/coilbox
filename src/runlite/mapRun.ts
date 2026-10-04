import { generateCities } from "../conquest/cities";
import type { GalaxyDoc, GameRef } from "../conquest/model";
import { hashString, mulberry32, type Rng } from "../conquest/rng";
import { generateTerritories } from "../conquest/territories";
import {
  assembleRun,
  bakeNode,
  chooseNodeType,
  type GenerateRunOpts,
  planUnlocks,
} from "./generate";
import type {
  RogueliteRun,
  RunEdge,
  RunMapRef,
  RunNode,
  RunNodeType,
} from "./model";

/**
 * A run across a land map. A run is a forward-only graph in columns, and a map
 * is locations joined by links with no direction. This file turns one into the
 * other: every location is ranked by how many links it is from the start, the
 * rank is the column, and the player may only step to a neighbour one rank
 * further on. `./progress.ts` reads nothing but the edges and the column, so
 * its rules apply unchanged.
 *
 * A location on no route from the start to the goal is scenery. It has no run
 * node, so nothing in the run can reach it.
 */

/** A map that cannot carry a run, with a message fit to show the player. */
export class MapRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapRouteError";
  }
}

/** The part of a map document a route is worked out from. */
export type RouteMap = Pick<GalaxyDoc, "nodes" | "links">;

export interface MapRoute {
  startId: string;
  goalId: string;
  /** Links from the start, for each location on a route. Scenery has no entry. */
  rank: Map<string, number>;
  /** The locations on a route, nearest the start first, then in map order. */
  locations: string[];
  /** Every step the player may take, each to a location one rank further on. */
  edges: [string, string][];
}

/** Each location's neighbours, in map order. Links to a location the map does
 * not have are left out. */
function neighbours(map: RouteMap): Map<string, string[]> {
  const order = new Map(map.nodes.map((n, i) => [n.id, i]));
  const sets = new Map<string, Set<string>>(
    map.nodes.map((n) => [n.id, new Set<string>()]),
  );
  for (const [a, b] of map.links) {
    if (a === b) continue;
    const fromA = sets.get(a);
    const fromB = sets.get(b);
    if (!fromA || !fromB) continue;
    fromA.add(b);
    fromB.add(a);
  }
  const at = (id: string) => order.get(id) ?? 0;
  return new Map(
    [...sets].map(([id, set]) => [id, [...set].sort((a, b) => at(a) - at(b))]),
  );
}

/** Links from `from` to every location that can be reached from it. */
function distancesFrom(
  adj: Map<string, string[]>,
  from: string,
): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const next = (dist.get(id) ?? 0) + 1;
    for (const nb of adj.get(id) ?? []) {
      if (dist.has(nb)) continue;
      dist.set(nb, next);
      queue.push(nb);
    }
  }
  return dist;
}

/** What to call a location in a message: its name, with the id as a fallback. */
function label(map: RouteMap, id: string): string {
  return map.nodes.find((n) => n.id === id)?.name || id;
}

/**
 * Work out the forward routes from one location to another. Throws a
 * {@link MapRouteError} naming both when the goal cannot be reached.
 */
export function routeAcrossMap(
  map: RouteMap,
  startId: string,
  goalId: string,
): MapRoute {
  const adj = neighbours(map);
  for (const id of [startId, goalId]) {
    if (!adj.has(id)) {
      throw new MapRouteError(`The map has no location "${id}".`);
    }
  }
  if (startId === goalId) {
    throw new MapRouteError(
      `The start and the goal are both "${label(map, startId)}". They must be different locations.`,
    );
  }
  const dist = distancesFrom(adj, startId);
  const goalRank = dist.get(goalId);
  if (goalRank === undefined) {
    throw new MapRouteError(
      `The goal "${label(map, goalId)}" cannot be reached from the start "${label(map, startId)}".`,
    );
  }

  // Walk back from the goal one rank at a time. What the walk reaches is on a
  // route, and everything else is scenery.
  const onRoute = new Set<string>([goalId]);
  const queue = [goalId];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const before = (dist.get(id) ?? 0) - 1;
    for (const nb of adj.get(id) ?? []) {
      if (dist.get(nb) !== before || onRoute.has(nb)) continue;
      onRoute.add(nb);
      queue.push(nb);
    }
  }

  const rankOf = (id: string) => dist.get(id) ?? 0;
  const locations = map.nodes
    .map((n) => n.id)
    .filter((id) => onRoute.has(id))
    .sort((a, b) => rankOf(a) - rankOf(b));
  const edges: [string, string][] = [];
  for (const id of locations) {
    for (const nb of adj.get(id) ?? []) {
      if (onRoute.has(nb) && rankOf(nb) === rankOf(id) + 1)
        edges.push([id, nb]);
    }
  }
  return {
    startId,
    goalId,
    rank: new Map(locations.map((id) => [id, rankOf(id)])),
    locations,
    edges,
  };
}

/**
 * Choose the start and the goal of a generated map: the two locations with the
 * most links between them. Where several pairs tie, `rng` picks one, and it
 * picks which end is the start.
 */
export function pickEnds(map: RouteMap, rng: Rng): [string, string] {
  const adj = neighbours(map);
  let best = 0;
  let pairs: [string, string][] = [];
  map.nodes.forEach((from, i) => {
    const dist = distancesFrom(adj, from.id);
    for (const to of map.nodes.slice(i + 1)) {
      const d = dist.get(to.id);
      if (d === undefined || d < best) continue;
      if (d > best) {
        best = d;
        pairs = [];
      }
      pairs.push([from.id, to.id]);
    }
  });
  if (best === 0) {
    throw new MapRouteError("The map has no two locations joined by a link.");
  }
  const [a, b] =
    pairs[Math.min(pairs.length - 1, Math.floor(rng() * pairs.length))];
  return rng() < 0.5 ? [a, b] : [b, a];
}

/** The kinds a location between the start and the goal can be. */
export type MapRunKind = Exclude<RunNodeType, "start" | "boss">;

export const MAP_RUN_KINDS: readonly MapRunKind[] = [
  "battle",
  "elite",
  "shop",
  "event",
  "reward",
];

export interface GenerateMapRunOpts extends GenerateRunOpts {
  /** The map to cross. Any document with nodes and links: provinces, cities or
   * a mix. `length` is not used, because the map decides how long the run is. */
  map: GalaxyDoc;
  /** How the saved run finds the map again. Left out, {@link runMapRefFor}
   * works it out from the document. */
  mapRef?: RunMapRef;
  /** The start and the goal, by location id. Give both or neither. Left out,
   * the seed picks the two locations furthest apart. */
  startId?: string;
  goalId?: string;
  /** The kind of a location, by location id, for a map whose author chose it.
   * A location not listed gets its kind from the seed. The start and the goal
   * are always the start and the boss. */
  kinds?: Record<string, MapRunKind>;
}

/**
 * How to find a map again, read off its document. A generated map says so in
 * `terrain.image` (`generated:<style>`) and carries its settings in
 * `generated`. Anything else is taken to be hand-made and is found by id.
 */
export function runMapRefFor(map: GalaxyDoc): RunMapRef {
  const g = map.generated;
  const image = map.terrain?.image ?? "";
  if (g && image.startsWith("generated:")) {
    return {
      source: "generated",
      style: image.slice("generated:".length),
      seed: g.seed,
      nodeCount: g.nodeCount ?? map.nodes.length,
      ...(g.layout ? { layout: g.layout } : {}),
    };
  }
  return { source: "handmade", id: map.id };
}

/** A map to cross, with the Warpath markings a hand-made one carries. */
export interface RunMapSource {
  map: GalaxyDoc;
  startId?: string;
  goalId?: string;
  kinds?: Record<string, MapRunKind>;
}

/** Finds a hand-made map by id. Null when this install does not have it. */
export type HandmadeMapLookup = (id: string) => RunMapSource | null;

const MAP_LAYOUTS = ["scatter", "spiral", "clusters", "ring", "random"];

/** The generators a map can be built again with, by the style it records. */
const MAP_GENERATORS: Record<
  string,
  typeof generateTerritories | typeof generateCities
> = {
  territories: generateTerritories,
  cities: generateCities,
};

/**
 * Get the map a run was made on. A generated map is built again from its
 * settings, which gives the same locations, outlines and links every time. A
 * hand-made one is asked of `handmade`. Null when the map cannot be had: a
 * style this version has no generator for, or a hand-made map that is missing.
 */
export function resolveRunMap(
  ref: RunMapRef,
  game: GameRef,
  handmade?: HandmadeMapLookup,
): RunMapSource | null {
  if (ref.source === "handmade") return handmade?.(ref.id) ?? null;
  if (!Object.hasOwn(MAP_GENERATORS, ref.style)) return null;
  const generate = MAP_GENERATORS[ref.style];
  const layout = MAP_LAYOUTS.includes(ref.layout ?? "")
    ? (ref.layout as "scatter" | "spiral" | "clusters" | "ring" | "random")
    : undefined;
  try {
    return {
      map: generate(
        {
          seed: ref.seed,
          game,
          // Battle maps and factions are the run's own, so the map needs none.
          maps: [],
          nodeCount: ref.nodeCount,
          factionCount: 1,
          layout,
        },
        new Date(0).toISOString(),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Generate a run across a map. The route comes from {@link routeAcrossMap}, and
 * each location on it gets its kind and content from the same code that fills
 * a column run, with the same rules: the first step is always a battle, one
 * location before the goal is a depot, and no depot follows another.
 *
 * The random draws come from a stream of their own, so a column run of the same
 * seed is not changed by this existing. Throws a {@link MapRouteError} when
 * the map cannot carry a run.
 */
export function generateMapRun(opts: GenerateMapRunOpts): RogueliteRun {
  const { map } = opts;
  const rng = mulberry32(hashString(`warpath-map:${opts.seed >>> 0}`));
  if ((opts.startId === undefined) !== (opts.goalId === undefined)) {
    throw new MapRouteError(
      "A map needs both a start and a goal, or neither of them.",
    );
  }
  const [startId, goalId] =
    opts.startId !== undefined && opts.goalId !== undefined
      ? [opts.startId, opts.goalId]
      : pickEnds(map, rng);
  const route = routeAcrossMap(map, startId, goalId);
  const cols = (route.rank.get(goalId) ?? 0) + 1;

  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  for (const [a, b] of route.edges) {
    after.set(a, [...(after.get(a) ?? []), b]);
    before.set(b, [...(before.get(b) ?? []), a]);
  }

  // The depot before the boss: the first location one step short of the goal.
  // The author's kind for it wins, and so does the rule about the first step.
  const restId = route.locations.find(
    (id) => route.rank.get(id) === cols - 2 && id !== startId,
  );
  const kinds = opts.kinds ?? {};
  const willRest = (id: string) => id === restId && kinds[id] === undefined;

  const planner = opts.build ? planUnlocks(opts.build) : null;
  const usedUnlocks = new Set<string>();
  const typeOf = new Map<string, RunNodeType>();
  const rowsUsed = new Map<number, number>();
  const nodes: RunNode[] = route.locations.map((id) => {
    const col = route.rank.get(id) ?? 0;
    const row = rowsUsed.get(col) ?? 0;
    rowsUsed.set(col, row + 1);

    let type: RunNodeType;
    if (id === startId) type = "start";
    else if (id === goalId) type = "boss";
    else if (kinds[id] !== undefined) type = kinds[id];
    else {
      const shopBefore = (before.get(id) ?? []).some(
        (b) => typeOf.get(b) === "shop",
      );
      const shopAfter = (after.get(id) ?? []).some(
        (a) => kinds[a] === "shop" || willRest(a),
      );
      type = chooseNodeType(
        rng,
        col,
        cols,
        willRest(id) && !shopBefore,
        !shopBefore && !shopAfter,
      );
    }
    typeOf.set(id, type);

    const node: RunNode = { id, type, col, row, location: id };
    bakeNode(rng, opts, planner, usedUnlocks, node, cols);
    return node;
  });

  const edges: RunEdge[] = route.edges.map(([a, b]) => [a, b]);
  return assembleRun(
    opts,
    planner,
    nodes,
    edges,
    startId,
    opts.mapRef ?? runMapRefFor(map),
  );
}
