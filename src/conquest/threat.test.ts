import { describe, expect, it } from "vitest";
import { type GenerateOptions, generateGalaxy } from "./generate";
import { newConquestState, parseGalaxyJson } from "./model";
import { enemyRound, turnRng } from "./rules";
import { MAX_THREAT_LEVEL, readThreatLevel, threatAggression } from "./threat";

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
  factionCount: 3,
};

describe("threatAggression", () => {
  it("leaves aggression exactly as it was at level 0", () => {
    for (const a of [0, 0.3, 0.35, 0.4999, 0.5, 1]) {
      expect(Object.is(threatAggression(a, 0), a)).toBe(true);
    }
  });

  it("raises aggression at every level above 0", () => {
    for (const a of [0.3, 0.35, 0.5]) {
      let last = a;
      for (let level = 1; level <= MAX_THREAT_LEVEL; level++) {
        const next = threatAggression(a, level);
        expect(next).toBeGreaterThan(last);
        last = next;
      }
    }
  });

  it("tops out at 1, the most the run logic accepts", () => {
    expect(threatAggression(0.3, MAX_THREAT_LEVEL)).toBe(1);
    expect(threatAggression(0.5, MAX_THREAT_LEVEL)).toBe(1);
  });

  it("never lowers a preset that is already above the level's value", () => {
    expect(threatAggression(1, 1)).toBe(1);
  });
});

describe("readThreatLevel", () => {
  it("reads a missing, bad or negative level as 0", () => {
    for (const v of [undefined, null, "2", Number.NaN, -1, 0]) {
      expect(readThreatLevel(v)).toBe(0);
    }
  });

  it("rounds and caps at the top level", () => {
    expect(readThreatLevel(1.4)).toBe(1);
    expect(readThreatLevel(99)).toBe(MAX_THREAT_LEVEL);
  });
});

describe("generateGalaxy with a threat level", () => {
  it("is byte for byte today's galaxy at level 0", () => {
    const today = generateGalaxy(base, "t0");
    expect(
      JSON.stringify(generateGalaxy({ ...base, threatLevel: 0 }, "t0")),
    ).toBe(JSON.stringify(today));
    expect(
      JSON.stringify(generateGalaxy({ ...base, threatLevel: undefined }, "t0")),
    ).toBe(JSON.stringify(today));
    expect(today.generated?.threatLevel).toBeUndefined();
  });

  it("changes only faction aggression and the recorded level above 0", () => {
    const today = generateGalaxy(base, "t0");
    const hard = generateGalaxy({ ...base, threatLevel: 2 }, "t0");
    expect(hard.nodes).toEqual(today.nodes);
    expect(hard.links).toEqual(today.links);
    expect(hard.generated).toEqual({ ...today.generated, threatLevel: 2 });
    expect(hard.factions.map((f) => ({ ...f, aggression: 0 }))).toEqual(
      today.factions.map((f) => ({ ...f, aggression: 0 })),
    );
  });

  it("raises each opponent's aggression with the level and leaves the player's", () => {
    for (const seed of [1, 7, 99, 2026]) {
      const docs = [0, 1, 2, 3].map((threatLevel) =>
        generateGalaxy({ ...base, seed, threatLevel }, "t0"),
      );
      for (const doc of docs) {
        expect(doc.factions[0].id).toBe("player");
        expect(doc.factions[0].aggression).toBe(0);
      }
      for (let i = 1; i < docs.length; i++) {
        for (let f = 1; f < docs[i].factions.length; f++) {
          expect(docs[i].factions[f].aggression ?? 0).toBeGreaterThan(
            docs[i - 1].factions[f].aggression ?? 0,
          );
          expect(docs[i].factions[f].aggression ?? 0).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("applies the level to a preset's aggression", () => {
    const doc = generateGalaxy(
      {
        ...base,
        threatLevel: 1,
        names: {
          factions: [
            { name: "P", color: "#111111" },
            { name: "A", color: "#222222", aggression: 0.1 },
          ],
        },
      },
      "t0",
    );
    expect(doc.factions[1].aggression).toBeCloseTo(0.1 + 0.9 / 3, 10);
  });

  it("survives its own validator with the level recorded", () => {
    const doc = generateGalaxy({ ...base, threatLevel: 3 }, "t0");
    expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
    expect(parseGalaxyJson(JSON.stringify(doc))?.generated?.threatLevel).toBe(
      3,
    );
  });

  it("makes opponents open more incursions against the player", () => {
    // The only thing aggression does in a run is weight an attack on an owned
    // system against a neutral one (`enemyRound`). Count the player's systems
    // that come under attack in the first round, over many seeds.
    const attacked = (threatLevel: number) => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const galaxy = generateGalaxy({ ...base, seed, threatLevel }, "t0");
        const state = newConquestState(galaxy, { seed }, "t0");
        total += enemyRound(galaxy, state, turnRng(state), "t0").state
          .incursions.length;
      }
      return total;
    };
    const counts = [0, 1, 2, 3].map(attacked);
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[3]).toBeGreaterThan(counts[2]);
  });
});
