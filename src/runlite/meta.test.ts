import { describe, expect, it } from "vitest";
import { awardMeta, loadoutById, unlockedLoadouts } from "./meta";
import { emptyMeta, type RogueliteMeta, type RogueliteRun } from "./model";

function run(status: "won" | "lost", ascension = 0, deepest = 4): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension,
      game: { shortname: "ba" },
      factionId: "p",
      skin: "galaxy",
    },
    nodes: [
      { id: "start", type: "start", col: 0, row: 0 },
      { id: "n", type: "battle", col: deepest, row: 0 },
    ],
    edges: [["start", "n"]],
    progress: {
      currentNodeId: "n",
      visited: ["start", "n"],
      hull: status === "won" ? 50 : 0,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status,
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("awardMeta", () => {
  it("counts a played run and its depth on a loss", () => {
    const next = awardMeta(emptyMeta, run("lost", 0, 3));
    expect(next.stats.runs).toBe(1);
    expect(next.stats.wins).toBe(0);
    expect(next.stats.deepest).toBe(3);
    expect(next.ascensionTier).toBe(0); // no tier for a loss
  });

  it("a win unlocks the first loadout and the next ascension tier", () => {
    const next = awardMeta(emptyMeta, run("won"));
    expect(next.stats.wins).toBe(1);
    expect(next.loadouts).toContain("vanguard");
    expect(next.ascensionTier).toBe(1);
  });

  it("ascension only advances by winning at least at the current ceiling", () => {
    const meta: RogueliteMeta = { ...emptyMeta, ascensionTier: 2 };
    // Winning at tier 0 while the ceiling is 2 doesn't advance it.
    expect(awardMeta(meta, run("won", 0)).ascensionTier).toBe(2);
    // Winning at tier 2 does.
    expect(awardMeta(meta, run("won", 2)).ascensionTier).toBe(3);
  });

  it("unlocks more loadouts as wins accumulate", () => {
    let meta = emptyMeta;
    for (let i = 0; i < 3; i++)
      meta = awardMeta(meta, run("won", meta.ascensionTier));
    expect(meta.stats.wins).toBe(3);
    expect(meta.loadouts).toEqual(
      expect.arrayContaining(["vanguard", "air", "recon"]),
    );
  });

  it("unlocks an event pool after enough runs", () => {
    let meta = emptyMeta;
    meta = awardMeta(meta, run("lost"));
    meta = awardMeta(meta, run("lost"));
    expect(meta.eventPools).toContain("anomalies");
  });
});

describe("loadouts", () => {
  it("offers only the default until unlocked", () => {
    expect(unlockedLoadouts(emptyMeta).map((l) => l.id)).toEqual(["standard"]);
  });

  it("includes unlocked doctrines", () => {
    const meta: RogueliteMeta = { ...emptyMeta, loadouts: ["air"] };
    const ids = unlockedLoadouts(meta).map((l) => l.id);
    expect(ids).toContain("standard");
    expect(ids).toContain("air");
  });

  it("loadoutById falls back to the default", () => {
    expect(loadoutById("nope").id).toBe("standard");
    expect(loadoutById("air").branchIndex).toBe(1);
  });
});
