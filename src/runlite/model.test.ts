import { describe, expect, it } from "vitest";
import {
  parseRunJson,
  parseRunMeta,
  type RogueliteRun,
  reconcileRun,
} from "./model";

function baseRun(): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    settings: {
      seed: 42,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "ba" },
      factionId: "player",
      side: "ARM",
      skin: "galaxy",
    },
    startUnit: "armcom",
    nodes: [
      { id: "n0", type: "start", col: 0, row: 0 },
      {
        id: "n1",
        type: "battle",
        col: 1,
        row: 0,
        battle: {
          mapName: "Comet Catcher",
          enemyAiCount: 1,
          handicap: 0,
          techTier: 1,
        },
      },
      { id: "n2", type: "boss", col: 2, row: 0 },
    ],
    edges: [
      ["n0", "n1"],
      ["n1", "n2"],
    ],
    progress: {
      currentNodeId: "n0",
      visited: ["n0"],
      hull: 100,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

describe("parseRunJson", () => {
  it("round-trips a valid run", () => {
    const run = baseRun();
    const parsed = parseRunJson(JSON.stringify(run));
    expect(parsed).not.toBeNull();
    expect(parsed?.nodes).toHaveLength(3);
    expect(parsed?.edges).toEqual([
      ["n0", "n1"],
      ["n1", "n2"],
    ]);
    expect(parsed?.settings.game.shortname).toBe("ba");
    expect(parsed?.progress.currentNodeId).toBe("n0");
  });

  it("rejects a non-run document", () => {
    expect(
      parseRunJson(JSON.stringify({ type: "conquest-galaxy" })),
    ).toBeNull();
    expect(parseRunJson("not json")).toBeNull();
    expect(parseRunJson(JSON.stringify({ type: "roguelite-run" }))).toBeNull();
  });

  it("rejects a progress pointer into a missing node", () => {
    const run = baseRun();
    run.progress.currentNodeId = "ghost";
    expect(parseRunJson(JSON.stringify(run))).toBeNull();
  });

  it("prunes backwards and dangling edges", () => {
    const run = baseRun();
    // backwards (n1 -> n0), dangling (n1 -> ghost), duplicate (n0 -> n1)
    run.edges = [
      ["n0", "n1"],
      ["n1", "n0"],
      ["n1", "ghost"],
      ["n0", "n1"],
      ["n1", "n2"],
    ];
    const parsed = parseRunJson(JSON.stringify(run));
    expect(parsed?.edges).toEqual([
      ["n0", "n1"],
      ["n1", "n2"],
    ]);
  });

  it("clamps hull to [0, maxHull] and drops invalid perks", () => {
    const run = baseRun();
    run.progress.hull = 500;
    run.progress.perks = [
      { kind: "advantage", value: 0.1, label: "ok" },
      // biome-ignore lint/suspicious/noExplicitAny: intentional malformed input
      { kind: "bogus", value: 1, label: "x" } as any,
    ];
    const parsed = parseRunJson(JSON.stringify(run));
    expect(parsed?.progress.hull).toBe(100);
    expect(parsed?.progress.perks).toHaveLength(1);
  });
});

describe("reconcileRun", () => {
  it("marks a dead-hull run as lost and dedupes visited/unlocks", () => {
    const run = baseRun();
    run.progress.hull = 0;
    run.progress.status = "active";
    run.progress.visited = ["n0", "n0", "n1"];
    run.progress.unlockedUnits = ["armvp", "armvp"];
    const healed = reconcileRun(run);
    expect(healed.progress.status).toBe("lost");
    expect(healed.progress.visited).toEqual(["n0", "n1"]);
    expect(healed.progress.unlockedUnits).toEqual(["armvp"]);
  });

  it("is a no-op for a clean run", () => {
    const run = baseRun();
    expect(reconcileRun(run)).toBe(run);
  });
});

describe("parseRunMeta", () => {
  it("falls back to empty meta on garbage", () => {
    const meta = parseRunMeta("not json");
    expect(meta.ascensionTier).toBe(0);
    expect(meta.stats.runs).toBe(0);
    expect(meta.loadouts).toEqual([]);
  });

  it("reads a stored meta document", () => {
    const meta = parseRunMeta(
      JSON.stringify({
        schemaVersion: 1,
        loadouts: ["air-first"],
        eventPools: [],
        ascensionTier: 3,
        stats: { runs: 10, wins: 4, deepest: 7 },
      }),
    );
    expect(meta.loadouts).toEqual(["air-first"]);
    expect(meta.ascensionTier).toBe(3);
    expect(meta.stats.wins).toBe(4);
  });
});
