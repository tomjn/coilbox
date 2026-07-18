import { describe, expect, it } from "vitest";
import {
  type GenBuildGraph,
  type GenerateRunOpts,
  type GenRunMap,
  generateRun,
} from "./generate";
import { isBattleNode, parseRunJson, type RogueliteRun } from "./model";

const MAPS: GenRunMap[] = [
  { name: "Small A", size: 64 },
  { name: "Small B", size: 100 },
  { name: "Medium", size: 256 },
  { name: "Large", size: 576 },
  { name: "Huge", size: 1024 },
];

// A tiny commander build graph: commander -> two plants -> a few units each.
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
  names: new Map<string, string>([
    ["vplant", "Vehicle Plant"],
    ["aplant", "Aircraft Plant"],
  ]),
};

function opts(over: Partial<GenerateRunOpts> = {}): GenerateRunOpts {
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
    now: "2026-07-18T00:00:00.000Z",
    ...over,
  };
}

/** Nodes reachable from `start` following forward edges. */
function reachable(run: RogueliteRun): Set<string> {
  const adj = new Map<string, string[]>();
  for (const [a, b] of run.edges) {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  }
  const seen = new Set<string>(["start"]);
  const q = ["start"];
  while (q.length) {
    const n = q.shift() as string;
    for (const next of adj.get(n) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        q.push(next);
      }
    }
  }
  return seen;
}

describe("generateRun", () => {
  it("is deterministic from the seed", () => {
    const a = JSON.stringify(generateRun(opts()));
    const b = JSON.stringify(generateRun(opts()));
    expect(a).toBe(b);
  });

  it("differs by seed", () => {
    const a = JSON.stringify(generateRun(opts({ seed: 1 })));
    const b = JSON.stringify(generateRun(opts({ seed: 2 })));
    expect(a).not.toBe(b);
  });

  it("produces a valid run that round-trips through parseRunJson", () => {
    const run = generateRun(opts());
    const parsed = parseRunJson(JSON.stringify(run));
    expect(parsed).not.toBeNull();
    expect(parsed?.nodes.length).toBe(run.nodes.length);
    expect(parsed?.edges.length).toBe(run.edges.length);
  });

  it("starts at a start node and ends in a single terminal boss", () => {
    const run = generateRun(opts());
    expect(run.nodes[0]).toMatchObject({ id: "start", type: "start", col: 0 });
    const bosses = run.nodes.filter((n) => n.type === "boss");
    expect(bosses).toHaveLength(1);
    const boss = bosses[0];
    // The boss is in the last column and has no outgoing edge.
    const maxCol = Math.max(...run.nodes.map((n) => n.col));
    expect(boss.col).toBe(maxCol);
    expect(run.edges.some(([from]) => from === boss.id)).toBe(false);
  });

  it("has no dead ends and every node is reachable from start", () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const run = generateRun(opts({ seed }));
      const seen = reachable(run);
      // Every node reachable.
      for (const n of run.nodes) {
        expect(seen.has(n.id), `node ${n.id} unreachable (seed ${seed})`).toBe(
          true,
        );
      }
      // No dead ends: every non-boss node has an outgoing edge.
      for (const n of run.nodes) {
        if (n.type === "boss") continue;
        expect(
          run.edges.some(([from]) => from === n.id),
          `node ${n.id} is a dead end (seed ${seed})`,
        ).toBe(true);
      }
    }
  });

  it("all edges ascend columns (forward-only DAG)", () => {
    const run = generateRun(opts());
    const col = new Map(run.nodes.map((n) => [n.id, n.col]));
    for (const [a, b] of run.edges) {
      expect((col.get(a) ?? 0) < (col.get(b) ?? 0)).toBe(true);
    }
  });

  it("battle nodes carry an encounter with a map from the pool", () => {
    const run = generateRun(opts());
    const names = new Set(MAPS.map((m) => m.name));
    for (const n of run.nodes) {
      if (isBattleNode(n.type)) {
        expect(n.battle).toBeDefined();
        expect(names.has(n.battle?.mapName ?? "")).toBe(true);
      }
    }
  });

  it("seeds a buildable starter arsenal and gates the rest", () => {
    const run = generateRun(opts());
    expect(run.startUnit).toBe("com");
    expect(run.progress.unlockedUnits).toContain("com");
    // Starter kit is the shallowest BFS units, capped.
    expect(run.progress.unlockedUnits.length).toBeGreaterThan(0);
    expect(run.progress.unlockedUnits).toContain("vplant");
  });

  it("longer runs have more columns", () => {
    const q = generateRun(opts({ length: "quick" }));
    const l = generateRun(opts({ length: "long" }));
    const qCols = Math.max(...q.nodes.map((n) => n.col));
    const lCols = Math.max(...l.nodes.map((n) => n.col));
    expect(lCols).toBeGreaterThan(qCols);
  });

  it("a loadout pre-unlocks a commander build branch", () => {
    const base = generateRun(opts());
    // branch 0 = the first of the commander's build options (mex), branch 2 =
    // vplant, whose branch pulls in tank/scout/con.
    const withVplant = generateRun(opts({ loadoutBranch: 2 }));
    expect(withVplant.progress.unlockedUnits.length).toBeGreaterThanOrEqual(
      base.progress.unlockedUnits.length,
    );
    expect(withVplant.progress.unlockedUnits).toContain("vplant");
    expect(withVplant.progress.unlockedUnits).toContain("tank");
  });

  it("falls back to perk-only rewards without a build graph", () => {
    const run = generateRun(opts({ build: undefined }));
    expect(run.startUnit).toBeUndefined();
    expect(run.progress.unlockedUnits).toEqual([]);
    for (const n of run.nodes) {
      if (n.type === "reward") {
        for (const o of n.reward?.options ?? []) {
          expect(o.kind).toBe("perk");
        }
      }
    }
  });
});
