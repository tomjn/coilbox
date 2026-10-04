import { describe, expect, it } from "vitest";
import {
  emptyMeta,
  migrateMeta,
  parseRunJson,
  parseRunMeta,
  parseRunStateFile,
  type RogueliteRun,
  reconcileRun,
} from "./model";

function baseRun(): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
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

  it("keeps a stored name and backfills a stable one for older saves", () => {
    const run = baseRun();
    // A save that carries a name round-trips it unchanged.
    expect(parseRunJson(JSON.stringify(run))?.name).toBe("Test Reach");

    // A save predating the field gets a name derived from its seed — and the
    // same seed always yields the same name (so reloads are stable).
    const legacy = baseRun() as Partial<RogueliteRun>;
    delete legacy.name;
    const a = parseRunJson(JSON.stringify(legacy));
    const b = parseRunJson(JSON.stringify(legacy));
    expect(a?.name).toBeTruthy();
    expect(a?.name).toBe(b?.name);
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

describe("parseRunStateFile", () => {
  it("reads a keyed map of runs, healing each", () => {
    const a = baseRun();
    const b = baseRun();
    b.progress.hull = 500; // out of range -> healed to maxHull on read
    const file = parseRunStateFile(
      JSON.stringify({ schemaVersion: 1, runs: { alpha: a, beta: b } }),
    );
    expect(Object.keys(file.runs).sort()).toEqual(["alpha", "beta"]);
    expect(file.runs.beta.progress.hull).toBe(100);
  });

  it("migrates a legacy single-run document into a one-entry map", () => {
    const file = parseRunStateFile(
      JSON.stringify({ schemaVersion: 1, run: baseRun() }),
    );
    const ids = Object.keys(file.runs);
    expect(ids).toHaveLength(1);
    expect(file.runs[ids[0]].settings.seed).toBe(42);
  });

  it("returns an empty map for a null legacy run", () => {
    expect(
      parseRunStateFile(JSON.stringify({ schemaVersion: 1, run: null })).runs,
    ).toEqual({});
  });

  it("reads an empty string and the plugin default as no runs", () => {
    for (const text of ["", "  \n", '{"schemaVersion":1,"runs":{}}']) {
      expect(parseRunStateFile(text).runs).toEqual({});
    }
  });

  it("fails on text that is not JSON", () => {
    expect(() => parseRunStateFile("not json")).toThrow(/not valid JSON/);
    expect(() => parseRunStateFile('{"runs":{"a":')).toThrow(/not valid JSON/);
  });

  it("fails on JSON that is not an object with runs", () => {
    for (const text of ["[]", "null", "42", '"text"', "true"]) {
      expect(() => parseRunStateFile(text)).toThrow(/not a JSON object/);
    }
    expect(() => parseRunStateFile("{}")).toThrow(/no runs/);
    expect(() => parseRunStateFile('{"runs":[]}')).toThrow(/not an object/);
    expect(() => parseRunStateFile('{"runs":"x"}')).toThrow(/not an object/);
  });

  it("fails on a file made by a newer version", () => {
    expect(() =>
      parseRunStateFile(
        JSON.stringify({ schemaVersion: 2, runs: { a: baseRun() } }),
      ),
    ).toThrow(/newer version of coilbox/);
  });

  it("fails when one run cannot be read, naming it", () => {
    expect(() =>
      parseRunStateFile(
        JSON.stringify({
          schemaVersion: 1,
          runs: { good: baseRun(), bad: { type: "roguelite-run" } },
        }),
      ),
    ).toThrow(/\(bad\)/);
  });

  it("fails on a legacy run that cannot be read", () => {
    expect(() =>
      parseRunStateFile(JSON.stringify({ schemaVersion: 1, run: {} })),
    ).toThrow(/cannot be read/);
  });
});

describe("parseRunMeta", () => {
  /** The shape the user's own file has: no game anywhere on it. */
  const OLD = {
    schemaVersion: 1,
    loadouts: ["vanguard"],
    eventPools: [],
    ascensionTier: 1,
    stats: { runs: 1, wins: 1, deepest: 8 },
  };

  it("fails on text that is not JSON, so the file is never replaced", () => {
    expect(() => parseRunMeta("not json")).toThrow();
    expect(() => parseRunMeta('{"schemaVersion":2,')).toThrow();
  });

  it("fails on valid JSON that is not an object", () => {
    for (const text of ["[]", "null", "42", '"text"', "true"]) {
      expect(() => parseRunMeta(text)).toThrow();
    }
  });

  it("reads an empty string as an empty meta", () => {
    for (const text of ["", "  \n"]) {
      const meta = parseRunMeta(text);
      expect(meta.legacy.stats.runs).toBe(0);
      expect(meta.games).toEqual({});
    }
  });

  it("reads the plugin's default document as an empty meta", () => {
    const meta = parseRunMeta(
      '{"schemaVersion":1,"loadouts":[],"eventPools":[],"ascensionTier":0,"stats":{"runs":0,"wins":0,"deepest":0}}',
    );
    expect(meta.legacy.ascensionTier).toBe(0);
    expect(meta.legacy.stats.runs).toBe(0);
    expect(meta.games).toEqual({});
  });

  it("turns an old document into the legacy record and nothing per game", () => {
    const meta = parseRunMeta(JSON.stringify(OLD));
    expect(meta.schemaVersion).toBe(2);
    expect(meta.games).toEqual({});
    expect(meta.legacy).toEqual({
      loadouts: ["vanguard"],
      eventPools: [],
      ascensionTier: 1,
      stats: { runs: 1, wins: 1, deepest: 8 },
      seen: [],
    });
  });

  it("migrating twice changes nothing", () => {
    const once = migrateMeta(OLD);
    expect(migrateMeta(once)).toEqual(once);
    expect(parseRunMeta(JSON.stringify(once))).toEqual(once);
  });

  it("reads the Rust default for a missing file as empty", () => {
    // Mirrors `RunliteMeta::default()` in the plugin: the old shape, empty.
    const meta = parseRunMeta(
      JSON.stringify({
        schemaVersion: 1,
        loadouts: [],
        eventPools: [],
        ascensionTier: 0,
        stats: { runs: 0, wins: 0, deepest: 0 },
      }),
    );
    expect(meta).toEqual(emptyMeta);
  });

  it("reads a current document with its per game records", () => {
    const doc = {
      schemaVersion: 2,
      legacy: OLD,
      games: {
        ba: {
          loadouts: ["air"],
          eventPools: ["anomalies"],
          ascensionTier: 2,
          stats: { runs: 3, wins: 2, deepest: 5 },
          seen: ["a", "b", "c"],
        },
      },
    };
    const meta = parseRunMeta(JSON.stringify(doc));
    expect(meta.games.ba.seen).toEqual(["a", "b", "c"]);
    expect(meta.games.ba.ascensionTier).toBe(2);
    expect(meta.legacy.stats.wins).toBe(1);
  });

  it("keeps a newer document's version so it is not written back", () => {
    const meta = parseRunMeta(
      JSON.stringify({ schemaVersion: 7, legacy: OLD, games: {} }),
    );
    expect(meta.schemaVersion).toBe(7);
    expect(meta.legacy.loadouts).toEqual(["vanguard"]);
  });
});

describe("a run's game choice (issue #3465)", () => {
  it("round-trips the full game name and a declined update", () => {
    const run = baseRun();
    run.settings.game = { shortname: "ZK", pinnedName: "Zero-K v1.14.10.1" };
    run.declinedGameUpdate = "Zero-K v1.15.0.0";
    const parsed = parseRunStateFile(
      JSON.stringify({ schemaVersion: 1, runs: { a: run } }),
    ).runs.a;
    expect(parsed.settings.game).toEqual(run.settings.game);
    expect(parsed.declinedGameUpdate).toBe("Zero-K v1.15.0.0");
    expect(reconcileRun(parsed).declinedGameUpdate).toBe("Zero-K v1.15.0.0");
  });

  it("reads a run saved before the fields existed as unpinned, and writes nothing", () => {
    const run = baseRun();
    const parsed = parseRunJson(JSON.stringify(run));
    expect(parsed?.settings.game.pinnedName).toBeUndefined();
    expect(parsed?.declinedGameUpdate).toBeUndefined();
  });
});
