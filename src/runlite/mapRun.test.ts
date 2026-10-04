import { describe, expect, it } from "vitest";
import { runIdentity, warpathIdentity } from "../challenge/identity";
import { generateCities } from "../conquest/cities";
import type { GalaxyDoc, GalaxyNode } from "../conquest/model";
import { mulberry32 } from "../conquest/rng";
import { generateTerritories } from "../conquest/territories";
import {
  decodeWarpathChallenge,
  encodeWarpathChallenge,
  runFromChallenge,
} from "./challenge";
import {
  type GenBuildGraph,
  type GenRunMap,
  generateRun,
  substituteExcludedMaps,
} from "./generate";
import {
  type GenerateMapRunOpts,
  generateMapRun,
  MapRouteError,
  pickEnds,
  type RouteMap,
  resolveRunMap,
  routeAcrossMap,
  runMapRefFor,
} from "./mapRun";
import { parseRunJson, type RogueliteRun } from "./model";
import {
  applyEvent,
  applyReward,
  deepestColumn,
  leaveNode,
  nextChoices,
  resolveBattle,
} from "./progress";

const NOW = "2026-07-18T00:00:00.000Z";

const MAPS: GenRunMap[] = [
  { name: "Small", size: 64 },
  { name: "Medium", size: 256 },
  { name: "Huge", size: 1024 },
];

const BUILD: GenBuildGraph = {
  startUnit: "com",
  edges: new Map<string, string[]>([
    ["com", ["mex", "solar", "vplant", "aplant"]],
    ["mex", []],
    ["solar", []],
    ["vplant", ["tank", "scout", "con"]],
    ["aplant", ["fighter", "bomber"]],
    ["con", ["radar", "llt"]],
    ["tank", []],
    ["scout", []],
    ["fighter", []],
    ["bomber", []],
    ["radar", []],
    ["llt", []],
  ]),
  names: new Map<string, string>(),
};

function place(id: string, name = id): GalaxyNode {
  return {
    id,
    name,
    pos: [0, 0],
    owner: "neutral",
    difficulty: 1,
    battle: { mapName: "" },
  };
}

function routeMap(ids: string[], links: [string, string][]): RouteMap {
  return { nodes: ids.map((id) => place(id, `The ${id}`)), links };
}

function mapDoc(ids: string[], links: [string, string][]): GalaxyDoc {
  return {
    schemaVersion: 1,
    id: "hand-map",
    type: "conquest-galaxy",
    title: "Hand map",
    description: "",
    game: { shortname: "ba" },
    playerFactionId: "player",
    factions: [{ id: "player", name: "You", color: "#ffffff" }],
    ...routeMap(ids, links),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function generated(
  style: "territories" | "cities",
  seed: number,
  nodeCount = 24,
): GalaxyDoc {
  const generate = style === "cities" ? generateCities : generateTerritories;
  return generate(
    {
      seed,
      game: { shortname: "ba" },
      maps: [],
      nodeCount,
      factionCount: 2,
      layout: "random",
    },
    NOW,
  );
}

const territories = (seed: number, nodeCount?: number) =>
  generated("territories", seed, nodeCount);

function opts(
  map: GalaxyDoc,
  over: Partial<GenerateMapRunOpts> = {},
): GenerateMapRunOpts {
  return {
    seed: 123,
    length: "standard",
    difficulty: 2,
    game: { shortname: "ba" },
    factionId: "player",
    side: "ARM",
    skin: "galaxy",
    maps: MAPS,
    build: BUILD,
    enemyAiKey: "native:BARb",
    now: NOW,
    map,
    ...over,
  };
}

/** Every route from the start, as lists of node ids, each ending where the
 * run offers no further step. */
function routesOf(run: RogueliteRun): string[][] {
  const next = new Map<string, string[]>();
  for (const [a, b] of run.edges) next.set(a, [...(next.get(a) ?? []), b]);
  const out: string[][] = [];
  const walk = (path: string[]) => {
    const steps = next.get(path[path.length - 1]) ?? [];
    if (steps.length === 0) out.push(path);
    for (const step of steps) walk([...path, step]);
  };
  walk([run.progress.currentNodeId]);
  return out;
}

//   a - b - d - f     g is a dead end beside the route, h is behind the
//   |   |   |         start, and x - y is an island of its own.
//   h   c - e
//       |
//       g
const IDS = ["a", "b", "c", "d", "e", "f", "g", "h", "x", "y"];
const LINKS: [string, string][] = [
  ["a", "b"],
  ["b", "d"],
  ["d", "f"],
  ["b", "c"],
  ["c", "e"],
  ["e", "d"],
  ["c", "g"],
  ["h", "a"],
  ["x", "y"],
];

describe("routeAcrossMap", () => {
  const route = routeAcrossMap(routeMap(IDS, LINKS), "a", "f");

  it("ranks each location on a route by its links from the start", () => {
    expect(Object.fromEntries(route.rank)).toEqual({ a: 0, b: 1, d: 2, f: 3 });
    expect(route.locations).toEqual(["a", "b", "d", "f"]);
  });

  it("keeps only the steps to a neighbour one rank further on", () => {
    expect(route.edges).toEqual([
      ["a", "b"],
      ["b", "d"],
      ["d", "f"],
    ]);
  });

  it("leaves out what is on no route: a longer way round, a dead end, what lies behind the start and an island", () => {
    for (const id of ["c", "e", "g", "h", "x", "y"]) {
      expect(route.rank.has(id)).toBe(false);
    }
  });

  it("keeps every shortest way when there are several", () => {
    const diamond = routeAcrossMap(
      routeMap(
        ["s", "l", "r", "g"],
        [
          ["g", "l"],
          ["s", "l"],
          ["r", "s"],
          ["r", "g"],
          ["l", "r"],
        ],
      ),
      "s",
      "g",
    );
    expect(diamond.locations).toEqual(["s", "l", "r", "g"]);
    // The link between l and r joins two of the same rank, so it is no step.
    expect(diamond.edges).toEqual([
      ["s", "l"],
      ["s", "r"],
      ["l", "g"],
      ["r", "g"],
    ]);
  });

  it("refuses a goal that cannot be reached, naming both locations", () => {
    const attempt = () => routeAcrossMap(routeMap(IDS, LINKS), "a", "y");
    expect(attempt).toThrow(MapRouteError);
    expect(attempt).toThrow(
      'The goal "The y" cannot be reached from the start "The a".',
    );
  });

  it("refuses a start and goal that are one location, and an id the map lacks", () => {
    const map = routeMap(IDS, LINKS);
    expect(() => routeAcrossMap(map, "a", "a")).toThrow(/both "The a"/);
    expect(() => routeAcrossMap(map, "a", "nowhere")).toThrow(
      'The map has no location "nowhere".',
    );
  });
});

describe("pickEnds", () => {
  it("picks the two locations with the most links between them", () => {
    const line = routeMap(
      ["m", "n", "o", "p"],
      [
        ["n", "o"],
        ["m", "n"],
        ["o", "p"],
      ],
    );
    for (let seed = 0; seed < 8; seed++) {
      expect(pickEnds(line, mulberry32(seed)).sort()).toEqual(["m", "p"]);
    }
  });

  it("breaks a tie from the seed, the same way each time", () => {
    // A ring of six: three pairs sit opposite each other.
    const ids = ["r0", "r1", "r2", "r3", "r4", "r5"];
    const ring = routeMap(
      ids,
      ids.map((id, i): [string, string] => [id, ids[(i + 1) % 6]]),
    );
    const picks = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const ends = pickEnds(ring, mulberry32(seed));
      expect(pickEnds(ring, mulberry32(seed))).toEqual(ends);
      expect(Math.abs(ids.indexOf(ends[0]) - ids.indexOf(ends[1]))).toBe(3);
      picks.add(ends.join(">"));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("refuses a map with no links", () => {
    expect(() => pickEnds(routeMap(["a", "b"], []), mulberry32(1))).toThrow(
      MapRouteError,
    );
  });
});

describe("generateMapRun on generated maps", () => {
  const cases = (["territories", "cities"] as const).flatMap((style) =>
    [1, 2, 3, 7, 42, 99, 1234, 20260718].map((seed) => ({
      style,
      seed,
      map: generated(style, seed, 16 + (seed % 3) * 12),
    })),
  );

  for (const { style, seed, map } of cases) {
    describe(`${style}, seed ${seed}, ${map.nodes.length} locations`, () => {
      const run = generateMapRun(opts(map, { seed }));
      const byId = new Map(run.nodes.map((n) => [n.id, n]));
      const typeOf = (id: string) => byId.get(id)?.type;
      const routes = routesOf(run);

      it("starts and ends at the two locations furthest apart", () => {
        const start = run.nodes.filter((n) => n.type === "start");
        const boss = run.nodes.filter((n) => n.type === "boss");
        expect(start).toHaveLength(1);
        expect(boss).toHaveLength(1);
        expect(run.progress.currentNodeId).toBe(start[0].id);
        // Whichever furthest pair another seed picks, it is no further apart.
        const [a, b] = pickEnds(map, mulberry32(0));
        expect(boss[0].col).toBe(routeAcrossMap(map, a, b).rank.get(b));
        expect(boss[0].col).toBeGreaterThan(1);
      });

      it("ends every route from the start at the goal", () => {
        expect(routes.length).toBeGreaterThan(0);
        for (const route of routes) {
          expect(typeOf(route[route.length - 1])).toBe("boss");
        }
      });

      it("has no step back or sideways, and every step is a link of the map", () => {
        const joined = new Set(
          map.links.flatMap(([a, b]) => [`${a} ${b}`, `${b} ${a}`]),
        );
        for (const [a, b] of run.edges) {
          expect(byId.get(b)?.col).toBe((byId.get(a)?.col ?? 0) + 1);
          const from = byId.get(a)?.location;
          const to = byId.get(b)?.location;
          expect(joined.has(`${from} ${to}`)).toBe(true);
        }
      });

      it("never puts two depots one after the other", () => {
        for (const [a, b] of run.edges) {
          expect(typeOf(a) === "shop" && typeOf(b) === "shop").toBe(false);
        }
      });

      it("opens with a battle, and gives each kind its content", () => {
        for (const n of run.nodes) {
          if (n.col === 1 && n.type !== "boss") expect(n.type).toBe("battle");
          if (n.type === "battle" || n.type === "elite" || n.type === "boss") {
            expect(n.battle?.mapName).toBeTruthy();
          }
          if (n.type === "reward") expect(n.reward).toBeDefined();
          if (n.type === "event") expect(n.event).toBeDefined();
          if (n.type === "shop") expect(n.shop).toBeDefined();
        }
      });

      it("gives every node a location of the map, each a different one", () => {
        const known = new Set(map.nodes.map((n) => n.id));
        const used = run.nodes.map((n) => n.location ?? "");
        for (const at of used) expect(known.has(at)).toBe(true);
        expect(new Set(used).size).toBe(used.length);
      });

      it("leaves scenery out of reach: no node, and no step leads to it", () => {
        const onRoute = new Set(run.nodes.map((n) => n.location));
        const scenery = map.nodes.filter((n) => !onRoute.has(n.id));
        for (const s of scenery) {
          expect(byId.has(s.id)).toBe(false);
          expect(run.edges.flat()).not.toContain(s.id);
        }
        // Every node is on a route, so nothing that has a node is scenery.
        const walked = new Set(routes.flat());
        for (const n of run.nodes) expect(walked.has(n.id)).toBe(true);
      });

      it("is the same run from the same seed", () => {
        expect(generateMapRun(opts(map, { seed }))).toEqual(run);
      });

      it("survives a save and a load with its locations and its map", () => {
        const loaded = parseRunJson(JSON.stringify(run));
        expect(loaded?.nodes.map((n) => n.location)).toEqual(
          run.nodes.map((n) => n.location),
        );
        expect(loaded?.settings.map).toEqual(run.settings.map);
        expect(loaded?.edges).toEqual(run.edges);
      });

      it("rebuilds the map it was made on from what the run stores", () => {
        const ref = run.settings.map;
        if (!ref) throw new Error("a map run stores its map");
        expect(ref).toEqual(runMapRefFor(map));
        const rebuilt = resolveRunMap(ref, run.settings.game)?.map;
        expect(rebuilt?.nodes.map((n) => [n.id, n.pos, n.outline])).toEqual(
          map.nodes.map((n) => [n.id, n.pos, n.outline]),
        );
        expect(rebuilt?.links).toEqual(map.links);
        expect(rebuilt?.linkKinds).toEqual(map.linkKinds);
        expect(rebuilt?.terrain).toEqual(map.terrain);
        expect(rebuilt?.generated?.layout).toBe(map.generated?.layout);
      });
    });
  }

  it("gives a different run for a different seed on one map", () => {
    const map = cases[0].map;
    const a = generateMapRun(opts(map, { seed: 5 }));
    const b = generateMapRun(opts(map, { seed: 6 }));
    expect(a).not.toEqual(b);
  });

  it("stores a map reference and not the map", () => {
    const { map } = cases[4];
    const run = generateMapRun(opts(map, { seed: 42 }));
    const saved = JSON.stringify(run);
    expect(saved).not.toContain("outline");
    expect(run.settings.map).toEqual({
      source: "generated",
      style: "territories",
      seed: 42,
      nodeCount: map.nodes.length,
      layout: "random",
    });
  });

  it("can be played from the start to a win at the goal with no way back", () => {
    const { map, seed } = cases[3];
    let run = generateMapRun(opts(map, { seed }));
    const seen = new Set([run.progress.currentNodeId]);
    for (let guard = 0; run.progress.status === "active"; guard++) {
      if (guard > 100) throw new Error("the run never ended");
      const choices = nextChoices(run);
      expect(choices.length).toBeGreaterThan(0);
      for (const c of choices) expect(seen.has(c.id)).toBe(false);
      const node = choices[0];
      if (node.battle) run = resolveBattle(run, node.id, "victory", NOW);
      else if (node.reward) run = applyReward(run, node.id, 0, NOW);
      else if (node.event) run = applyEvent(run, node.id, 1, NOW);
      else run = leaveNode(run, node.id, NOW);
      expect(run.progress.currentNodeId).toBe(node.id);
      seen.add(node.id);
    }
    expect(run.progress.status).toBe("won");
    const goal = run.nodes.find((n) => n.type === "boss");
    expect(run.progress.currentNodeId).toBe(goal?.id);
    expect(deepestColumn(run)).toBe(goal?.col);
  });

  it("swaps an excluded battle map by depth, as a column run does", () => {
    const { map, seed } = cases[2];
    const run = generateMapRun(opts(map, { seed }));
    const swapped = substituteExcludedMaps(run, MAPS, (m) => m === "Small");
    for (const n of swapped.nodes) expect(n.battle?.mapName).not.toBe("Small");
  });
});

describe("generateMapRun with a chosen start, goal and kinds", () => {
  //        b1 - c1
  //   a <            > z      and s, which hangs off a and is scenery.
  //        b2 - c2
  const map = mapDoc(
    ["a", "b1", "b2", "c1", "c2", "z", "s"],
    [
      ["a", "b1"],
      ["a", "b2"],
      ["b1", "c1"],
      ["b2", "c2"],
      ["c1", "z"],
      ["c2", "z"],
      ["a", "s"],
    ],
  );

  it("runs from the given start to the given goal", () => {
    const run = generateMapRun(opts(map, { startId: "z", goalId: "a" }));
    expect(run.progress.currentNodeId).toBe("z");
    expect(run.nodes.find((n) => n.type === "boss")?.location).toBe("a");
    expect(run.nodes.map((n) => n.location)).not.toContain("s");
    expect(run.settings.map).toEqual({ source: "handmade", id: "hand-map" });
  });

  it("makes a location the kind its author chose, on every seed", () => {
    for (let seed = 0; seed < 30; seed++) {
      const run = generateMapRun(
        opts(map, {
          seed,
          startId: "a",
          goalId: "z",
          kinds: { b1: "shop", c2: "event", s: "elite", a: "shop" },
        }),
      );
      const typeAt = (at: string) =>
        run.nodes.find((n) => n.location === at)?.type;
      expect(typeAt("b1")).toBe("shop");
      expect(run.nodes.find((n) => n.location === "b1")?.shop).toBeDefined();
      expect(typeAt("c2")).toBe("event");
      // The start stays the start, and scenery gets no node.
      expect(typeAt("a")).toBe("start");
      expect(typeAt("s")).toBeUndefined();
      // c1 follows the author's depot, so the seed never makes it one.
      expect(typeAt("c1")).not.toBe("shop");
    }
  });

  it("puts a depot one step short of the goal when the author chose no kinds", () => {
    for (let seed = 0; seed < 30; seed++) {
      const run = generateMapRun(
        opts(map, { seed, startId: "a", goalId: "z" }),
      );
      const types = run.nodes.filter((n) => n.col === 2).map((n) => n.type);
      expect(types[0]).toBe("shop");
    }
  });

  it("refuses one end without the other", () => {
    expect(() => generateMapRun(opts(map, { startId: "a" }))).toThrow(
      MapRouteError,
    );
  });

  it("refuses a goal cut off from the start, naming both", () => {
    const cut = mapDoc(["a", "b", "z"], [["a", "b"]]);
    expect(() =>
      generateMapRun(opts(cut, { startId: "a", goalId: "z" })),
    ).toThrow('The goal "The z" cannot be reached from the start "The a".');
  });
});

describe("resolveRunMap", () => {
  it("asks for a hand-made map by id", () => {
    const map = mapDoc(["a", "b"], [["a", "b"]]);
    const found = resolveRunMap(
      { source: "handmade", id: "hand-map" },
      { shortname: "ba" },
      (id) => (id === "hand-map" ? { map, startId: "a", goalId: "b" } : null),
    );
    expect(found?.map).toBe(map);
    expect(found?.startId).toBe("a");
  });

  it("is null for a hand-made map nobody can find and a style with no generator", () => {
    const game = { shortname: "ba" };
    expect(resolveRunMap({ source: "handmade", id: "gone" }, game)).toBeNull();
    expect(
      resolveRunMap(
        { source: "generated", style: "moonscape", seed: 1, nodeCount: 12 },
        game,
      ),
    ).toBeNull();
    // A style that names something every object has is still no generator.
    expect(
      resolveRunMap(
        { source: "generated", style: "constructor", seed: 1, nodeCount: 12 },
        game,
      ),
    ).toBeNull();
  });
});

describe("a map run as a challenge", () => {
  const map = territories(42);
  const run = generateMapRun(opts(map, { seed: 42, difficulty: 3 }));

  it("carries its map in the code and rebuilds the same run on import", () => {
    const decoded = decodeWarpathChallenge(encodeWarpathChallenge(run));
    if (!decoded.ok) throw new Error("expected a successful decode");
    expect(decoded.settings.map).toEqual(run.settings.map);
    const imported = runFromChallenge(decoded.settings, {
      maps: MAPS,
      build: BUILD,
      enemyAiKey: "native:BARb",
    });
    expect(imported.nodes).toEqual(run.nodes);
    expect(imported.edges).toEqual(run.edges);
    expect(runIdentity(imported)).toBe(runIdentity(run));
  });

  it("refuses to import when the map cannot be had", () => {
    expect(() =>
      runFromChallenge(
        { ...run.settings, map: { source: "handmade", id: "gone" } },
        { maps: MAPS },
      ),
    ).toThrow(/cannot find or rebuild/);
  });

  it("has an identity of its own, apart from a column run of the same settings", () => {
    const { map: _map, ...plain } = run.settings;
    expect(warpathIdentity(run.settings)).not.toBe(warpathIdentity(plain));
  });
});

describe("Galaxy and Theatre runs", () => {
  const base = {
    seed: 777,
    length: "standard" as const,
    difficulty: 3,
    game: { shortname: "ba" },
    factionId: "player",
    maps: MAPS,
    build: BUILD,
    now: NOW,
  };

  it("keep the column layout and store no map or location", () => {
    for (const skin of ["galaxy", "theatre"] as const) {
      const run = generateRun({ ...base, skin });
      expect(run.settings.map).toBeUndefined();
      expect("map" in run.settings).toBe(false);
      expect(run.nodes.some((n) => "location" in n)).toBe(false);
      expect(run.nodes[0]).toEqual({
        id: "start",
        type: "start",
        col: 0,
        row: 0,
      });
      expect(Math.max(...run.nodes.map((n) => n.col))).toBe(8);
    }
  });

  it("load a run saved before maps existed with nothing added to it", () => {
    const run = generateRun({ ...base, skin: "galaxy" });
    const loaded = parseRunJson(JSON.stringify(run));
    expect(loaded?.settings).toEqual(run.settings);
    expect(loaded?.nodes.some((n) => "location" in n)).toBe(false);
    expect("map" in (loaded?.settings ?? {})).toBe(false);
  });

  it("keep the identity they had before maps existed", () => {
    const run = generateRun({ ...base, skin: "galaxy" });
    expect(runIdentity(run)).toBe(
      JSON.stringify([
        "warpath",
        "ba",
        777,
        "standard",
        3,
        0,
        "player",
        null,
        "galaxy",
      ]),
    );
  });
});
