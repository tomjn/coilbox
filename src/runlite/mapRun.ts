import { handmadeMapRefFor } from "../challenge/mapRef";
import { generateCities } from "../conquest/cities";
import type {
  GalaxyDoc,
  GameRef,
  NodeBattleSpec,
  NodeScenario,
} from "../conquest/model";
import { hashString, mulberry32, type Rng } from "../conquest/rng";
import { generateTerritories } from "../conquest/territories";
import {
  assembleRun,
  bakeNode,
  chooseNodeType,
  type GenerateRunOpts,
  generateRun,
  planUnlocks,
} from "./generate";
import type {
  EncounterSpec,
  RogueliteRun,
  RunEdge,
  RunLength,
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
  if (!dist.has(goalId)) {
    throw new MapRouteError(
      `The goal "${label(map, goalId)}" cannot be reached from the start "${label(map, startId)}".`,
    );
  }
  return routeFrom(map, adj, dist, startId, goalId);
}

/** The route to `goalId`, given the links from the start to every location
 * (`dist`). The goal must be one of the locations `dist` reaches. */
function routeFrom(
  map: RouteMap,
  adj: Map<string, string[]>,
  dist: Map<string, number>,
  startId: string,
  goalId: string,
): MapRoute {
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

/** How much choice of route a run gives. */
export interface RouteChoice {
  /** The fewest choices the player can meet on the way to the goal, whichever
   * way they go. A choice is a location with two or more steps onward. */
  fewest: number;
  /** How many locations on the route offer a choice. */
  points: number;
}

/**
 * Count the choices on a set of forward steps. `order` lists the locations
 * with every location before the ones its steps lead to, as
 * {@link MapRoute.locations} and a run's nodes sorted by column both do.
 */
export function choiceOnSteps(
  order: string[],
  edges: readonly (readonly [string, string])[],
): RouteChoice {
  const onward = new Map<string, string[]>();
  for (const [a, b] of edges) onward.set(a, [...(onward.get(a) ?? []), b]);
  const fewestFrom = new Map<string, number>();
  let points = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const steps = onward.get(order[i]) ?? [];
    if (steps.length === 0) {
      fewestFrom.set(order[i], 0);
      continue;
    }
    const here = steps.length >= 2 ? 1 : 0;
    points += here;
    fewestFrom.set(
      order[i],
      here + Math.min(...steps.map((id) => fewestFrom.get(id) ?? 0)),
    );
  }
  return { fewest: fewestFrom.get(order[0]) ?? 0, points };
}

/** The choice of route a map route gives. */
export function routeChoice(route: MapRoute): RouteChoice {
  return choiceOnSteps(route.locations, route.edges);
}

/**
 * Choose the start and the goal of a generated map. They are two locations
 * with the most links between them, so the run is as long as the map allows.
 * Among those pairs, taken in both directions, the one whose route gives the
 * most choice wins: first by the fewest choices the player can meet, then by
 * how many locations offer one. Where several still tie, `rng` picks.
 *
 * The furthest pair alone is not enough. On 200 Territories maps of 12
 * provinces a pair picked from the furthest by the seed gave a route with no
 * choice anywhere on 87, and picking the furthest pair with the most choice
 * gives one on 73. The 73 are maps where no furthest pair has a choice, which
 * {@link generateStyledRun} deals with by trying another map.
 *
 * Only the furthest pairs are looked at, with no shorter pair allowed in
 * exchange for more choice, because the map sizes in {@link LAND_RUN_SIZES}
 * were chosen from the length of the furthest route.
 */
export function pickEnds(map: RouteMap, rng: Rng): [string, string] {
  const adj = neighbours(map);
  const dists = new Map(map.nodes.map((n) => [n.id, distancesFrom(adj, n.id)]));
  let furthest = 0;
  let pairs: [string, string][] = [];
  for (const from of map.nodes) {
    for (const to of map.nodes) {
      const d = dists.get(from.id)?.get(to.id);
      if (d === undefined || d < furthest) continue;
      if (d > furthest) {
        furthest = d;
        pairs = [];
      }
      pairs.push([from.id, to.id]);
    }
  }
  if (furthest === 0) {
    throw new MapRouteError("The map has no two locations joined by a link.");
  }

  let best: RouteChoice = { fewest: -1, points: -1 };
  let widest: [string, string][] = [];
  for (const [from, to] of pairs) {
    const dist = dists.get(from) ?? new Map<string, number>();
    const choice = routeChoice(routeFrom(map, adj, dist, from, to));
    const order = choice.fewest - best.fewest || choice.points - best.points;
    if (order < 0) continue;
    if (order > 0) {
      best = choice;
      widest = [];
    }
    widest.push([from, to]);
  }
  return widest[Math.min(widest.length - 1, Math.floor(rng() * widest.length))];
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
  /** The battle the author set for a location, by location id. It is used when
   * the location turns out to be a fight: its map and whatever else it gives
   * replace the generated encounter's, and what it leaves out stays as
   * generated. Its `disabledUnits` are kept on the encounter and joined with
   * the run's own disabled set at launch. */
  battles?: Record<string, NodeBattleSpec>;
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
  return handmadeMapRefFor(map);
}

/** A map to cross, with the Warpath markings a hand-made one carries. */
export interface RunMapSource {
  map: GalaxyDoc;
  startId?: string;
  goalId?: string;
  kinds?: Record<string, MapRunKind>;
  battles?: Record<string, NodeBattleSpec>;
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

/** The parts of an author's battle an encounter takes, left out where the
 * author gave none. */
function authoredEncounter(battle: NodeBattleSpec): Partial<EncounterSpec> {
  // The download hint always goes with the map name, so the generated map's
  // hint never stays on the author's map.
  const out: Partial<EncounterSpec> = {
    mapName: battle.mapName,
    mapDownload: battle.mapDownload,
  };
  if (battle.enemyAiCount !== undefined) out.enemyAiCount = battle.enemyAiCount;
  if (battle.enemyAiKey !== undefined) out.enemyAiKey = battle.enemyAiKey;
  if (battle.startPosType !== undefined) out.startPosType = battle.startPosType;
  if (battle.handicap !== undefined) out.handicap = battle.handicap;
  if (battle.modOptionValues) out.modOptionValues = battle.modOptionValues;
  if (battle.disabledUnits && battle.disabledUnits.length > 0) {
    out.disabledUnits = battle.disabledUnits;
  }
  return out;
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

  const scenarioAt = new Map(map.nodes.map((n) => [n.id, n.scenario]));
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
    // After the draw, so a run takes the same draws with or without it.
    const authored = opts.battles?.[id];
    if (node.battle && authored) {
      node.battle = { ...node.battle, ...authoredEncounter(authored) };
    }
    // A fight at a location that names a scenario plays the scenario. The
    // encounter stays as the skirmish to fall back on, set on the scenario's
    // map. A depot or an event there has no fight, so it plays nothing.
    const scenario = scenarioAt.get(id);
    if (node.battle && scenario) {
      node.scenario = scenario.file;
      node.battle = {
        ...node.battle,
        mapName: scenario.doc.setup.mapName,
        mapDownload: undefined,
      };
    }
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

/**
 * The scenario a run node plays, read off the map the run was made on. It is
 * undefined for a node that names none, and also when the map is not to hand
 * or its location no longer has that scenario file, in which case the node's
 * own encounter is fought.
 */
export function runNodeScenario(
  map: GalaxyDoc | undefined,
  node: Pick<RunNode, "scenario" | "location">,
): NodeScenario | undefined {
  if (!node.scenario || !map) return undefined;
  const found = map.nodes.find((n) => n.id === node.location)?.scenario;
  return found?.file === node.scenario ? found : undefined;
}

/**
 * How many locations the generated map has for each run length. The map
 * decides how long a land run is, so these are the sizes whose routes come out
 * nearest the column runs of 6, 9 and 13. Measured over seeds 1 to 200 with the
 * layout left to the seed, the median route was 7, 9 and 13 locations long on
 * Cities maps of 18, 28 and 56, and 6, 9 and 13 on Territories maps of 12, 18
 * and 40.
 */
export const LAND_RUN_SIZES: Record<
  "cities" | "territories",
  Record<RunLength, number>
> = {
  cities: { quick: 18, standard: 28, long: 56 },
  territories: { quick: 12, standard: 18, long: 40 },
};

/**
 * How many maps {@link generateStyledRun} builds before it accepts a run with
 * no choice of route. A small Territories map is often close to a tree, where
 * no two of the furthest locations have two ways between them. Over seeds 1 to
 * 200 that was 73 maps of 12 provinces, 25 of 18, 2 of 40, and no Cities map
 * of 18, 28 or 56. The most maps any of those 1200 runs needed was 7. At the
 * worst rate, 73 in 200, sixteen maps in a row fail about once in ten million
 * runs, so the limit is there to end the loop and not to be met.
 */
const LAND_MAP_TRIES = 16;

/**
 * Generate the run a setup asks for, in whichever style it chose. Galaxy and
 * Theatre are the column run. Cities and Territories generate a map at the
 * size the run's length calls for, and cross it. The map goes through
 * {@link resolveRunMap}, the same way an opened run or an imported challenge
 * finds it again, so the map generated here is the one they rebuild.
 *
 * The first map is built from the run's own seed. When the run across it has
 * no location with two steps onward, the next map is tried, each from a seed
 * worked out from the run's seed, and the first run with a choice is the one
 * returned. The run stores the seed of the map it ended on. If every map
 * fails, the run across the first one stands.
 */
export function generateStyledRun(opts: GenerateRunOpts): RogueliteRun {
  const { skin } = opts;
  if (skin !== "cities" && skin !== "territories") return generateRun(opts);
  const runOnMap = (attempt: number): RogueliteRun => {
    const mapRef: RunMapRef = {
      source: "generated",
      style: skin,
      seed:
        attempt === 0
          ? opts.seed
          : hashString(`warpath-map:${opts.seed >>> 0}:${attempt}`),
      nodeCount: LAND_RUN_SIZES[skin][opts.length],
      layout: "random",
    };
    const source = resolveRunMap(mapRef, opts.game);
    if (!source) {
      throw new MapRouteError(
        "The map for this warpath could not be generated.",
      );
    }
    return generateMapRun({ ...opts, ...source, mapRef });
  };
  // The nodes are in column order, which is the order the count wants.
  const hasChoice = (run: RogueliteRun) =>
    choiceOnSteps(
      run.nodes.map((n) => n.id),
      run.edges,
    ).points > 0;

  const first = runOnMap(0);
  if (hasChoice(first)) return first;
  for (let attempt = 1; attempt < LAND_MAP_TRIES; attempt++) {
    const run = runOnMap(attempt);
    if (hasChoice(run)) return run;
  }
  return first;
}
