import type { UnitDatasetEntry } from "../content/bindings";

/**
 * What a warpath's player can build from the start, and what comes with each
 * unlock, chosen by what units do rather than by where they sit in the build
 * tree.
 *
 * The player starts with a land factory, a sea factory where the game has one,
 * an energy building that needs no geothermal vent, a metal extractor, a radar,
 * an armed defence and a wall. Every factory they hold comes with an armed unit
 * and a builder, and every builder comes with an energy building, an extractor
 * and a radar of its own tier, so nothing they unlock has an empty build menu.
 */

/** What the starting build list and unlocks read about one unit. */
export interface UnitFacts {
  mobile: boolean;
  armed: boolean;
  /** Can build and has something to build. */
  builds: boolean;
  flies: boolean;
  /** Can only stand in water. */
  seaOnly: boolean;
  needGeo: boolean;
  wall: boolean;
  energy: boolean;
  extractor: boolean;
  /** Makes metal some other way. A game that runs its extractors from a gadget
   * declares no `extractsMetal`, so this stands in for one there. */
  makesMetal: boolean;
  radar: boolean;
  metalCost: number;
  energyCost: number;
}

function num(stats: Record<string, unknown>, key: string): number {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** The facts for every unit in a dataset, by lowercased name. */
export function unitFactsFor(
  units: UnitDatasetEntry[],
): Map<string, UnitFacts> {
  const out = new Map<string, UnitFacts>();
  for (const u of units) {
    const s = u.stats ?? {};
    const mobile = u.mobile === true;
    out.set(u.name.toLowerCase(), {
      mobile,
      armed: Array.isArray(s.weapons) && s.weapons.length > 0,
      builds: s.builder === true && (u.buildOptions?.length ?? 0) > 0,
      flies: s.canFly === true,
      seaOnly: (u.minWaterDepth ?? 0) > 0,
      needGeo: s.needGeo === true,
      wall: !mobile && s.isFeature === true,
      energy:
        num(s, "energyMake") > 0 ||
        num(s, "windGenerator") > 0 ||
        num(s, "energyUpkeep") < 0,
      extractor: num(s, "extractsMetal") > 0,
      makesMetal: num(s, "metalMake") > 0 || num(s, "makesMetal") > 0,
      radar: num(s, "radarDistance") > 0,
      metalCost: num(s, "metalCost"),
      energyCost: num(s, "energyCost"),
    });
  }
  return out;
}

type Kind =
  | "land-factory"
  | "sea-factory"
  | "energy"
  | "metal"
  | "radar"
  | "defence"
  | "wall"
  | "fighter"
  | "builder";

/** What the player always starts able to build. */
const START_KINDS: Kind[] = [
  "land-factory",
  "sea-factory",
  "energy",
  "metal",
  "radar",
  "defence",
  "wall",
];

/** What a builder brings with it, so it has something of its own to build. */
const BUILDER_KINDS: Kind[] = ["energy", "metal", "radar"];

/** The read-only view of the build graph the rules need. */
export interface KitGraph {
  /** Lowercased unit -> build options. */
  edges: Map<string, string[]>;
  facts: Map<string, UnitFacts>;
  /** Units in a stable order, the build tree's breadth-first order, which
   * breaks cost ties by how early the game lists them. */
  order: string[];
}

function matches(
  kind: Kind,
  unit: string,
  f: UnitFacts,
  graph: KitGraph,
): boolean {
  const building = !f.mobile;
  switch (kind) {
    case "land-factory":
    case "sea-factory": {
      if (!building || !f.builds) return false;
      if (kind === "sea-factory") return f.seaOnly;
      // An air plant builds only things that fly.
      return (
        !f.seaOnly &&
        (graph.edges.get(unit) ?? []).some((o) => {
          const of = graph.facts.get(o);
          return of?.mobile && !of.flies;
        })
      );
    }
    case "energy":
      return building && f.energy && !f.needGeo && !f.seaOnly && !f.armed;
    case "metal":
      return building && f.extractor && !f.needGeo && !f.seaOnly;
    case "radar":
      return building && f.radar && !f.armed && !f.seaOnly;
    case "defence":
      return building && f.armed && !f.needGeo && !f.seaOnly;
    case "wall":
      return f.wall && !f.seaOnly;
    case "fighter":
      return f.mobile && f.armed && !f.builds;
    case "builder":
      return f.mobile && f.builds;
  }
}

/** A metal source for a game whose extractors declare no `extractsMetal`. */
function isFallbackMetal(f: UnitFacts): boolean {
  return !f.mobile && f.makesMetal && !f.needGeo && !f.seaOnly && !f.armed;
}

/**
 * The cheapest of `options` that is a `kind`, or undefined. Cheapest by metal,
 * then energy, then by the graph's order.
 */
function cheapest(
  kind: Kind,
  options: string[],
  graph: KitGraph,
): string | undefined {
  const rank = new Map(graph.order.map((u, i) => [u, i]));
  const found = options.filter((o) => {
    const f = graph.facts.get(o);
    return f !== undefined && rank.has(o) && matches(kind, o, f, graph);
  });
  const pool =
    found.length > 0 || kind !== "metal"
      ? found
      : options.filter((o) => {
          const f = graph.facts.get(o);
          return f !== undefined && rank.has(o) && isFallbackMetal(f);
        });
  pool.sort((a, b) => {
    // biome-ignore lint/style/noNonNullAssertion: filtered to units with facts
    const fa = graph.facts.get(a)!;
    // biome-ignore lint/style/noNonNullAssertion: filtered to units with facts
    const fb = graph.facts.get(b)!;
    return (
      fa.metalCost - fb.metalCost ||
      fa.energyCost - fb.energyCost ||
      (rank.get(a) ?? 0) - (rank.get(b) ?? 0)
    );
  });
  return pool[0];
}

/** Whether a unit is a factory: a building that builds. */
function isFactory(f: UnitFacts | undefined): boolean {
  return !!f && !f.mobile && f.builds;
}

/**
 * `units` with what they bring added, repeated until nothing more comes: a
 * factory brings its cheapest armed unit and its cheapest builder, and a builder
 * brings an energy building, an extractor and a radar. A builder takes these
 * from what only it builds when it can, so a second tier builder brings second
 * tier buildings. `roots` are the start units, whose own build list is that
 * baseline and which never bring anything themselves.
 */
export function withWhatTheyBring(
  units: Iterable<string>,
  graph: KitGraph,
  roots: string[],
): Set<string> {
  const out = new Set(units);
  const rootSet = new Set(roots);
  const baseline = new Set(roots.flatMap((r) => graph.edges.get(r) ?? []));
  const done = new Set<string>();
  const queue = [...out];
  const add = (unit: string | undefined) => {
    if (unit && !out.has(unit) && !rootSet.has(unit)) {
      out.add(unit);
      queue.push(unit);
    }
  };
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
    const unit = queue.shift()!;
    if (done.has(unit) || rootSet.has(unit)) continue;
    done.add(unit);
    const f = graph.facts.get(unit);
    const options = graph.edges.get(unit) ?? [];
    if (isFactory(f)) {
      add(cheapest("fighter", options, graph));
      add(cheapest("builder", options, graph));
    } else if (f?.mobile && f.builds) {
      const own = options.filter((o) => !baseline.has(o));
      for (const kind of BUILDER_KINDS) {
        add(cheapest(kind, own, graph) ?? cheapest(kind, options, graph));
      }
    }
  }
  return out;
}

/**
 * What the player starts able to build: the start units, one of each start
 * kind, and what those bring. A kind the start units cannot build is looked for
 * among what the starting builders build.
 */
export function starterKit(graph: KitGraph, roots: string[]): Set<string> {
  const rootOptions = [
    ...new Set(roots.flatMap((r) => graph.edges.get(r) ?? [])),
  ];
  const picks = new Map<Kind, string>();
  for (const kind of START_KINDS) {
    const unit = cheapest(kind, rootOptions, graph);
    if (unit) picks.set(kind, unit);
  }
  let kit = withWhatTheyBring([...roots, ...picks.values()], graph, roots);
  const missing = START_KINDS.filter((k) => !picks.has(k));
  if (missing.length > 0) {
    const fromBuilders = [
      ...new Set(
        [...kit]
          .filter((u) => {
            const f = graph.facts.get(u);
            return f?.mobile && f.builds && !roots.includes(u);
          })
          .flatMap((u) => graph.edges.get(u) ?? []),
      ),
    ];
    const extra = missing
      .map((kind) => cheapest(kind, fromBuilders, graph))
      .filter((u): u is string => !!u);
    kit = withWhatTheyBring([...kit, ...extra], graph, roots);
  }
  return kit;
}
