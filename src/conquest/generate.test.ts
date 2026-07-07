import { describe, expect, it } from "vitest";
import { type GenerateOptions, generateGalaxy } from "./generate";
import { parseGalaxyJson } from "./model";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));
const ais = [
  { kind: "native" as const, shortName: "BARb", name: "BARbarIAn" },
  { kind: "lua" as const, shortName: "STAI" },
];

const base: GenerateOptions = {
  seed: 1234,
  game: { shortname: "TG" },
  maps,
  ais,
  nodeCount: 16,
  factionCount: 2,
};

describe("generateGalaxy", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateGalaxy(base, "t0");
    const b = generateGalaxy(base, "t0");
    expect(a).toEqual(b);
    expect(a.generated?.seed).toBe(1234);
  });

  it("survives its own validator (round-trips parseGalaxyJson)", () => {
    for (const seed of [1, 7, 99, 2026]) {
      const doc = generateGalaxy({ ...base, seed }, "t0");
      expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
    }
  });

  it("gives every faction exactly one capital it owns, all playable", () => {
    for (const seed of [3, 44, 555]) {
      const doc = generateGalaxy({ ...base, seed, factionCount: 3 }, "t0");
      expect(doc.factions).toHaveLength(4);
      expect(doc.playableFactionIds).toEqual(doc.factions.map((f) => f.id));
      for (const f of doc.factions) {
        const capitals = doc.nodes.filter(
          (n) => n.kind === "capital" && n.owner === f.id,
        );
        expect(capitals).toHaveLength(1);
      }
    }
  });

  it("produces a fully connected lane graph", () => {
    for (const seed of [5, 66, 777]) {
      const doc = generateGalaxy({ ...base, seed, nodeCount: 24 }, "t0");
      const adj = new Map<string, string[]>(doc.nodes.map((n) => [n.id, []]));
      for (const [a, b] of doc.links) {
        adj.get(a)?.push(b);
        adj.get(b)?.push(a);
      }
      const seen = new Set<string>([doc.nodes[0].id]);
      const queue = [doc.nodes[0].id];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === undefined) break;
        for (const n of adj.get(cur) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect(seen.size).toBe(doc.nodes.length);
    }
  });

  it("ramps difficulty away from the player capital and maxes enemy capitals", () => {
    const doc = generateGalaxy(base, "t0");
    const playerCapital = doc.nodes.find(
      (n) => n.kind === "capital" && n.owner === "player",
    );
    expect(playerCapital?.difficulty).toBe(1);
    for (const n of doc.nodes) {
      if (n.kind === "capital" && n.owner !== "player") {
        expect(n.difficulty).toBe(5);
      }
    }
  });

  it("assigns every node an installed map, biased bigger for harder", () => {
    const doc = generateGalaxy(base, "t0");
    const names = new Set(maps.map((m) => m.name));
    for (const n of doc.nodes) expect(names.has(n.battle.mapName)).toBe(true);
    const area = (name: string) => {
      const m = maps.find((mm) => mm.name === name);
      return (m?.width ?? 0) * (m?.height ?? 0);
    };
    const easy = doc.nodes.filter((n) => n.difficulty === 1);
    const hard = doc.nodes.filter((n) => n.difficulty === 5);
    const avg = (ns: typeof easy) =>
      ns.reduce((s, n) => s + area(n.battle.mapName), 0) / ns.length;
    expect(avg(hard)).toBeGreaterThan(avg(easy));
  });

  it("clamps node and faction counts", () => {
    const doc = generateGalaxy(
      { ...base, nodeCount: 500, factionCount: 9 },
      "t0",
    );
    expect(doc.nodes).toHaveLength(40);
    expect(doc.factions).toHaveLength(4);
  });
});
