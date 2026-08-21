import { describe, expect, it } from "vitest";
import {
  applyChallengeMaps,
  type GenerateOptions,
  generateGalaxy,
  regenerateGalaxy,
  restoreChallengeMap,
  substituteExcludedMaps,
} from "./generate";
import { parseGalaxyJson } from "./model";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: GenerateOptions = {
  seed: 1234,
  game: { shortname: "TG" },
  maps,
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

  // #376: challenge sharing rests entirely on "same seed + settings -> same
  // galaxy". Proven here rather than assumed: same seed round-trips to an
  // identical doc (above), and a different seed changes the outcome.
  it("differs for a different seed", () => {
    const a = generateGalaxy({ ...base, seed: 1 }, "t0");
    const b = generateGalaxy({ ...base, seed: 2 }, "t0");
    expect(a).not.toEqual(b);
  });

  it("pins no AI to a faction, leaving the pick to node difficulty", () => {
    const doc = generateGalaxy({ ...base, factionCount: 3 }, "t0");
    for (const f of doc.factions) {
      expect(f.aiKey).toBeUndefined();
    }
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

  it("varies spacing between seeds (jittered acceptance distance)", () => {
    const a = generateGalaxy({ ...base, seed: 1 }, "t0");
    const b = generateGalaxy({ ...base, seed: 2 }, "t0");
    expect(a.nodes.map((n) => n.pos)).not.toEqual(b.nodes.map((n) => n.pos));
    // Nearest-neighbour distances are not uniform: spread should be visible.
    const nn = (doc: typeof a) =>
      doc.nodes.map((n) =>
        Math.min(
          ...doc.nodes
            .filter((m) => m.id !== n.id)
            .map((m) => Math.hypot(m.pos[0] - n.pos[0], m.pos[1] - n.pos[1])),
        ),
      );
    const d = nn(a);
    expect(Math.max(...d) / Math.min(...d)).toBeGreaterThan(1.5);
  });

  it("caps node count to the named pool when limitToNamed is set", () => {
    const starNames = Array.from({ length: 20 }, (_, i) => `Star ${i}`);
    const doc = generateGalaxy(
      { ...base, nodeCount: 60, names: { starNames, limitToNamed: true } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(20);
    expect(doc.generated?.nodeCount).toBe(20);
    // Every star has a unique base name — no numeral/synthesized fallback.
    const namesOut = doc.nodes.map((n) => n.name);
    expect(new Set(namesOut).size).toBe(20);
    for (const n of namesOut) expect(starNames.includes(n)).toBe(true);
  });

  it("leaves node count alone when the pool is larger than the request", () => {
    const starNames = Array.from({ length: 40 }, (_, i) => `Star ${i}`);
    const doc = generateGalaxy(
      { ...base, nodeCount: 16, names: { starNames, limitToNamed: true } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(16);
  });

  it("floors a tiny capped pool at the generator minimum", () => {
    const doc = generateGalaxy(
      {
        ...base,
        nodeCount: 40,
        names: { starNames: ["Solo"], limitToNamed: true },
      },
      "t0",
    );
    expect(doc.nodes).toHaveLength(8);
  });

  it("ignores limitToNamed when unset (default overflow)", () => {
    const starNames = Array.from({ length: 12 }, (_, i) => `Star ${i}`);
    const doc = generateGalaxy(
      { ...base, nodeCount: 30, names: { starNames } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(30);
  });

  it("clamps node and faction counts (cap raised to 80)", () => {
    const doc = generateGalaxy(
      { ...base, nodeCount: 500, factionCount: 9 },
      "t0",
    );
    expect(doc.nodes).toHaveLength(80);
    expect(doc.factions).toHaveLength(4);
  });

  const connected = (doc: ReturnType<typeof generateGalaxy>): boolean => {
    const adj = new Map<string, string[]>(doc.nodes.map((n) => [n.id, []]));
    for (const [a, b] of doc.links) {
      adj.get(a)?.push(b);
      adj.get(b)?.push(a);
    }
    const seen = new Set([doc.nodes[0].id]);
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
    return seen.size === doc.nodes.length;
  };

  it("keeps every layout connected and deterministic", () => {
    for (const layout of ["scatter", "spiral", "clusters", "ring"] as const) {
      for (const seed of [11, 222, 3003]) {
        const opts = { ...base, seed, layout, nodeCount: 40 };
        const a = generateGalaxy(opts, "t0");
        const b = generateGalaxy(opts, "t0");
        expect(a).toEqual(b);
        expect(connected(a)).toBe(true);
      }
    }
  });

  it("resolves a random layout deterministically from the seed", () => {
    const opts = { ...base, layout: "random" as const };
    expect(generateGalaxy(opts, "t0")).toEqual(generateGalaxy(opts, "t0"));
  });

  it("sets the theatre skin and fog flag from options", () => {
    const doc = generateGalaxy(
      { ...base, skin: "theatre", fogOfWar: true },
      "t0",
    );
    expect(doc.theme?.skin).toBe("theatre");
    expect(doc.rules?.fogOfWar).toBe(true);
    // Still valid after its own validator.
    expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
  });

  it("startingSystems=1 gives each faction only its capital, keeping a frontier", () => {
    const doc = generateGalaxy({ ...base, startingSystems: 1 }, "t0");
    for (const f of doc.factions) {
      const owned = doc.nodes.filter((n) => n.owner === f.id);
      expect(owned).toHaveLength(1);
      expect(owned[0].kind).toBe("capital");
    }
    // The player capital still touches at least one non-player node to attack.
    const cap = doc.nodes.find((n) => n.owner === "player");
    const adj = new Set<string>();
    for (const [a, b] of doc.links) {
      if (a === cap?.id) adj.add(b);
      if (b === cap?.id) adj.add(a);
    }
    const attackable = [...adj].some(
      (id) => doc.nodes.find((n) => n.id === id)?.owner !== "player",
    );
    expect(attackable).toBe(true);
  });

  it("persists the generation knobs for reroll", () => {
    const doc = generateGalaxy(
      {
        ...base,
        layout: "ring",
        skin: "theatre",
        startingSystems: 2,
        fogOfWar: true,
      },
      "t0",
    );
    expect(doc.generated).toEqual({
      seed: 1234,
      nodeCount: 16,
      factionCount: 2,
      layout: "ring",
      skin: "theatre",
      startingSystems: 2,
      fogOfWar: true,
    });
    const defaults = generateGalaxy(base, "t0");
    expect(defaults.generated?.layout).toBe("scatter");
    expect(defaults.generated?.skin).toBe("galaxy");
    expect(defaults.generated?.startingSystems).toBeUndefined();
    expect(defaults.generated?.fogOfWar).toBeUndefined();
  });

  it("applies faction presets in order", () => {
    const doc = generateGalaxy(
      {
        ...base,
        factionCount: 1,
        names: {
          factions: [
            { name: "Cortex", color: "#112233", side: "Core" },
            { name: "Arm", side: "Armada" },
          ],
        },
      },
      "t0",
    );
    expect(doc.factions[0].name).toBe("Cortex");
    expect(doc.factions[0].color).toBe("#112233");
    expect(doc.factions[0].side).toBe("Core");
    expect(doc.factions[1].name).toBe("Arm");
    expect(doc.factions[1].side).toBe("Armada");
  });
});

describe("regenerateGalaxy", () => {
  it("rerolls in place: same id/title/createdAt/knobs, new positions", () => {
    const doc = generateGalaxy({ ...base, id: "keep-id", title: "Keep" }, "t0");
    const re = regenerateGalaxy(doc, { maps }, 999, "t1");
    expect(re).not.toBeNull();
    expect(re?.id).toBe("keep-id");
    expect(re?.title).toBe("Keep");
    expect(re?.createdAt).toBe("t0");
    expect(re?.updatedAt).toBe("t1");
    expect(re?.generated?.seed).toBe(999);
    expect(re?.generated?.nodeCount).toBe(16);
    expect(re?.nodes.map((n) => n.pos)).not.toEqual(
      doc.nodes.map((n) => n.pos),
    );
  });

  it("returns null for docs without persisted knobs", () => {
    const doc = generateGalaxy(base, "t0");
    const legacy = { ...doc, generated: { seed: 1 } };
    expect(regenerateGalaxy(legacy, { maps }, 5, "t1")).toBeNull();
  });
});

describe("substituteExcludedMaps", () => {
  const doc = generateGalaxy(base, "t0");
  const banned = (name: string) => name === "Map 0" || name === "Map 5";

  it("returns the same doc when nothing is excluded", () => {
    expect(substituteExcludedMaps(doc, maps, () => false)).toBe(doc);
  });

  it("re-points every node on an excluded map", () => {
    const next = substituteExcludedMaps(doc, maps, banned);
    expect(next.nodes.some((n) => banned(n.battle.mapName))).toBe(false);
    expect(next).not.toBe(doc);
  });

  it("leaves nodes on allowed maps untouched", () => {
    const next = substituteExcludedMaps(doc, maps, banned);
    for (const [i, node] of doc.nodes.entries()) {
      if (!banned(node.battle.mapName)) {
        expect(next.nodes[i].battle.mapName).toBe(node.battle.mapName);
      }
    }
  });

  it("picks the same replacement every time, so a briefing is stable", () => {
    const a = substituteExcludedMaps(doc, maps, banned);
    const b = substituteExcludedMaps(doc, maps, banned);
    expect(a.nodes.map((n) => n.battle.mapName)).toEqual(
      b.nodes.map((n) => n.battle.mapName),
    );
  });

  it("drops the old map's download hint along with the map", () => {
    const withHint = {
      ...doc,
      nodes: doc.nodes.map((n) => ({
        ...n,
        battle: {
          ...n.battle,
          mapName: "Map 0",
          mapDownload: { springName: "Map 0" },
        },
      })),
    };
    const next = substituteExcludedMaps(withHint, maps, banned);
    expect(next.nodes.every((n) => n.battle.mapDownload === undefined)).toBe(
      true,
    );
  });

  it("leaves the galaxy alone when every installed map is excluded", () => {
    expect(substituteExcludedMaps(doc, maps, () => true)).toBe(doc);
  });
});

describe("applyChallengeMaps", () => {
  const doc = generateGalaxy(base, "t0");
  const named = Object.fromEntries(
    doc.nodes.map((n, i) => [n.id, `Map ${i % maps.length}`]),
  );

  it("returns the same doc when the challenge names no maps", () => {
    expect(applyChallengeMaps(doc, undefined, maps)).toBe(doc);
  });

  it("puts every system on the map the challenge names", () => {
    const next = applyChallengeMaps(doc, named, maps);
    for (const node of next.nodes) {
      expect(node.battle.mapName).toBe(named[node.id]);
      expect(node.battle.mapSubstitutedFrom).toBeUndefined();
    }
  });

  it("resolves the same maps on two installs with different map pools", () => {
    // Same seed, different installed maps: the generated draw differs, the
    // named maps do not.
    const other = generateGalaxy({ ...base, maps: maps.slice(0, 5) }, "t0");
    expect(other.nodes.map((n) => n.battle.mapName)).not.toEqual(
      doc.nodes.map((n) => n.battle.mapName),
    );
    const a = applyChallengeMaps(doc, named, maps);
    const b = applyChallengeMaps(other, named, maps);
    expect(b.nodes.map((n) => n.battle.mapName)).toEqual(
      a.nodes.map((n) => n.battle.mapName),
    );
  });

  it("substitutes a named map this install does not have, and says so", () => {
    const without = maps.filter((m) => m.name !== "Map 3");
    const next = applyChallengeMaps(doc, named, without);
    const swapped = next.nodes.filter((n) => n.battle.mapSubstitutedFrom);
    expect(swapped.length).toBeGreaterThan(0);
    for (const node of next.nodes) {
      expect(node.battle.mapName).not.toBe("Map 3");
      if (named[node.id] === "Map 3") {
        expect(node.battle.mapSubstitutedFrom).toBe("Map 3");
      } else {
        expect(node.battle.mapSubstitutedFrom).toBeUndefined();
      }
    }
  });

  it("picks the same stand-in every time", () => {
    const without = maps.filter((m) => m.name !== "Map 3");
    const a = applyChallengeMaps(doc, named, without);
    const b = applyChallengeMaps(doc, named, without);
    expect(a.nodes.map((n) => n.battle.mapName)).toEqual(
      b.nodes.map((n) => n.battle.mapName),
    );
  });

  it("keeps the named map when this install has no maps at all", () => {
    const next = applyChallengeMaps(doc, named, []);
    for (const node of next.nodes) {
      expect(node.battle.mapName).toBe(named[node.id]);
      expect(node.battle.mapSubstitutedFrom).toBeUndefined();
    }
  });

  it("drops the old map's download hint along with the map", () => {
    const withHint = {
      ...doc,
      nodes: doc.nodes.map((n) => ({
        ...n,
        battle: {
          ...n.battle,
          mapName: "Retired Map",
          mapDownload: { springName: "Retired Map" },
        },
      })),
    };
    const next = applyChallengeMaps(withHint, named, maps);
    expect(next.nodes.every((n) => n.battle.mapDownload === undefined)).toBe(
      true,
    );
  });

  it("ignores names for systems the galaxy does not have", () => {
    const next = applyChallengeMaps(doc, { "node-999": "Map 1" }, maps);
    expect(next).toBe(doc);
  });
});

describe("restoreChallengeMap", () => {
  const doc = generateGalaxy(base, "t0");
  const named = Object.fromEntries(doc.nodes.map((n) => [n.id, "Map 3"]));
  const without = maps.filter((m) => m.name !== "Map 3");
  const substituted = applyChallengeMaps(doc, named, without);
  const first = substituted.nodes[0];

  it("puts the system back on the map the challenge named", () => {
    expect(first.battle.mapSubstitutedFrom).toBe("Map 3");
    const next = restoreChallengeMap(substituted, first.id);
    const node = next.nodes.find((n) => n.id === first.id);
    expect(node?.battle.mapName).toBe("Map 3");
    expect(node?.battle.mapSubstitutedFrom).toBeUndefined();
  });

  it("touches only the system asked for", () => {
    const next = restoreChallengeMap(substituted, first.id);
    for (const node of next.nodes) {
      if (node.id === first.id) continue;
      expect(node.battle.mapSubstitutedFrom).toBe("Map 3");
      expect(node.battle.mapName).not.toBe("Map 3");
    }
  });

  it("drops the stand-in's download hint with the stand-in", () => {
    const withHint = {
      ...substituted,
      nodes: substituted.nodes.map((n) => ({
        ...n,
        battle: { ...n.battle, mapDownload: { springName: n.battle.mapName } },
      })),
    };
    const next = restoreChallengeMap(withHint, first.id);
    expect(
      next.nodes.find((n) => n.id === first.id)?.battle.mapDownload,
    ).toBeUndefined();
  });

  it("leaves the galaxy alone for a system that is not standing in", () => {
    expect(restoreChallengeMap(doc, doc.nodes[0].id)).toBe(doc);
  });

  it("leaves the galaxy alone for a system it does not have", () => {
    expect(restoreChallengeMap(substituted, "node-999")).toBe(substituted);
  });
});
