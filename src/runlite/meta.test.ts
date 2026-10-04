import { describe, expect, it } from "vitest";
import {
  awardFinishedRuns,
  awardMeta,
  loadoutById,
  seedSeen,
  unlockedLoadouts,
  unlocksFor,
} from "./meta";
import {
  emptyMeta,
  emptyRecord,
  type RogueliteMeta,
  type RogueliteRun,
} from "./model";

function run(
  status: "won" | "lost",
  ascension = 0,
  deepest = 4,
  shortname = "ba",
): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension,
      game: { shortname },
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

const BA = "ba";
const own = (meta: RogueliteMeta, game = BA) => meta.games[game];

describe("awardMeta", () => {
  it("counts a played run and its depth on a loss", () => {
    const next = own(awardMeta(emptyMeta, run("lost", 0, 3), "r1"));
    expect(next.stats.runs).toBe(1);
    expect(next.stats.wins).toBe(0);
    expect(next.stats.deepest).toBe(3);
    expect(next.ascensionTier).toBe(0); // no tier for a loss
  });

  it("a win unlocks the first loadout and the next ascension tier", () => {
    const next = own(awardMeta(emptyMeta, run("won"), "r1"));
    expect(next.stats.wins).toBe(1);
    expect(next.loadouts).toContain("vanguard");
    expect(next.ascensionTier).toBe(1);
  });

  it("ascension only advances by winning at least at the current ceiling", () => {
    const meta: RogueliteMeta = {
      ...emptyMeta,
      games: { ba: { ...emptyRecord, ascensionTier: 2 } },
    };
    // Winning at tier 0 while the ceiling is 2 doesn't advance it.
    expect(own(awardMeta(meta, run("won", 0), "r1")).ascensionTier).toBe(2);
    // Winning at tier 2 does.
    expect(own(awardMeta(meta, run("won", 2), "r2")).ascensionTier).toBe(3);
  });

  it("unlocks more loadouts as wins accumulate", () => {
    let meta = emptyMeta;
    for (let i = 0; i < 3; i++) {
      meta = awardMeta(
        meta,
        run("won", own(meta)?.ascensionTier ?? 0),
        `r${i}`,
      );
    }
    expect(own(meta).stats.wins).toBe(3);
    expect(own(meta).loadouts).toEqual(
      expect.arrayContaining(["vanguard", "air", "recon"]),
    );
  });

  it("unlocks an event pool after enough runs", () => {
    let meta = emptyMeta;
    meta = awardMeta(meta, run("lost"), "r1");
    meta = awardMeta(meta, run("lost"), "r2");
    expect(own(meta).eventPools).toContain("anomalies");
  });

  it("a win in one game unlocks nothing in another", () => {
    const meta = awardMeta(emptyMeta, run("won", 0, 4, "zk"), "r1");
    expect(unlocksFor(meta, "zk").loadouts).toContain("vanguard");
    expect(unlocksFor(meta, "zk").ascensionTier).toBe(1);
    expect(unlocksFor(meta, "ba")).toEqual({
      loadouts: [],
      eventPools: [],
      ascensionTier: 0,
    });
    expect(meta.games.ba).toBeUndefined();
  });

  it("keys games by lower case shortname", () => {
    const meta = awardMeta(emptyMeta, run("won", 0, 4, " BA "), "r1");
    expect(Object.keys(meta.games)).toEqual(["ba"]);
  });

  it("counts the same finished run once", () => {
    const once = awardMeta(emptyMeta, run("won"), "r1");
    const twice = awardMeta(once, run("won"), "r1");
    expect(twice).toBe(once);
    expect(own(twice).stats.runs).toBe(1);
    expect(own(twice).seen).toEqual(["r1"]);
  });

  it("counts two runs with different ids twice", () => {
    let meta = awardMeta(emptyMeta, run("lost"), "r1");
    meta = awardMeta(meta, run("lost"), "r2");
    expect(own(meta).stats.runs).toBe(2);
  });

  it("puts a run with no shortname in the legacy record, once", () => {
    const once = awardMeta(emptyMeta, run("won", 0, 4, "  "), "r1");
    expect(once.legacy.stats.runs).toBe(1);
    expect(once.legacy.loadouts).toContain("vanguard");
    expect(once.games).toEqual({});
    expect(awardMeta(once, run("won", 0, 4, ""), "r1")).toBe(once);
  });

  it("does not touch a document from a newer version", () => {
    const newer = { ...emptyMeta, schemaVersion: 3 };
    expect(awardMeta(newer, run("won"), "r1")).toBe(newer);
  });

  it("does not change the legacy record when a game's run is counted", () => {
    const meta = awardMeta(legacyMeta, run("won", 1), "r1");
    expect(meta.legacy).toBe(legacyMeta.legacy);
  });
});

/** The user's real shape: 1 run, 1 win, column 8, tier 1, Armoured vanguard. */
const legacyMeta: RogueliteMeta = {
  ...emptyMeta,
  legacy: {
    ...emptyRecord,
    loadouts: ["vanguard"],
    ascensionTier: 1,
    stats: { runs: 1, wins: 1, deepest: 8 },
  },
};

describe("what a game offers, with a legacy record", () => {
  it("shows the legacy unlocks in every game", () => {
    for (const game of ["ba", "zk", "anything"]) {
      expect(unlocksFor(legacyMeta, game).loadouts).toEqual(["vanguard"]);
      expect(unlocksFor(legacyMeta, game).ascensionTier).toBe(1);
    }
  });

  it("is the union of legacy and the game's own loadouts and event pools", () => {
    const meta: RogueliteMeta = {
      ...legacyMeta,
      legacy: { ...legacyMeta.legacy, eventPools: ["anomalies"] },
      games: {
        ba: {
          ...emptyRecord,
          loadouts: ["air", "vanguard"],
          eventPools: ["warlords"],
        },
      },
    };
    const ba = unlocksFor(meta, "BA");
    expect(ba.loadouts.sort()).toEqual(["air", "vanguard"]);
    expect(ba.eventPools.sort()).toEqual(["anomalies", "warlords"]);
    expect(unlocksFor(meta, "zk").loadouts).toEqual(["vanguard"]);
  });

  it("takes the higher of the legacy tier and the game's own as the ceiling", () => {
    const meta: RogueliteMeta = {
      ...legacyMeta,
      legacy: { ...legacyMeta.legacy, ascensionTier: 3 },
      games: {
        ba: { ...emptyRecord, ascensionTier: 1 },
        zk: { ...emptyRecord, ascensionTier: 4 },
      },
    };
    expect(unlocksFor(meta, "ba").ascensionTier).toBe(3);
    expect(unlocksFor(meta, "zk").ascensionTier).toBe(4);
  });

  it("a win at the legacy ceiling raises the game's own tier past it", () => {
    const meta: RogueliteMeta = {
      ...legacyMeta,
      legacy: { ...legacyMeta.legacy, ascensionTier: 3 },
      games: { ba: { ...emptyRecord, ascensionTier: 1 } },
    };
    // Below the ceiling of 3: nothing.
    expect(own(awardMeta(meta, run("won", 2), "r1")).ascensionTier).toBe(1);
    // At the ceiling: one above the legacy tier, not one above the game's own.
    const after = awardMeta(meta, run("won", 3), "r2");
    expect(own(after).ascensionTier).toBe(4);
    expect(unlocksFor(after, "ba").ascensionTier).toBe(4);
    expect(unlocksFor(after, "zk").ascensionTier).toBe(3);
  });

  it("counts only the game's own wins towards a new loadout", () => {
    // Two legacy wins hold vanguard and air everywhere. Recon needs 3 wins in
    // the game itself, and the legacy wins do not count towards them.
    const meta: RogueliteMeta = {
      ...emptyMeta,
      legacy: {
        ...emptyRecord,
        loadouts: ["vanguard", "air"],
        stats: { runs: 2, wins: 2, deepest: 5 },
      },
    };
    let next = awardMeta(meta, run("won", 0), "r1");
    expect(unlocksFor(next, "ba").loadouts).not.toContain("recon");
    next = awardMeta(next, run("won", 0), "r2");
    expect(unlocksFor(next, "ba").loadouts).not.toContain("recon");
    next = awardMeta(next, run("won", 0), "r3");
    expect(unlocksFor(next, "ba").loadouts).toContain("recon");
    // Held through legacy the whole time.
    expect(unlocksFor(meta, "ba").loadouts).toEqual(["vanguard", "air"]);
    expect(unlocksFor(next, "zk").loadouts).toEqual(["vanguard", "air"]);
  });
});

describe("seedSeen", () => {
  it("adds the finished ids to the legacy record and sets the flag", () => {
    const seeded = seedSeen(emptyMeta, new Set(["a", "b"]));
    expect(seeded.seenSeeded).toBe(true);
    expect(seeded.legacy.seen).toEqual(["a", "b"]);
    expect(seeded.legacy.stats.runs).toBe(0);
  });

  it("does nothing once seeded", () => {
    const seeded = seedSeen(emptyMeta, new Set(["a"]));
    expect(seedSeen(seeded, new Set(["a", "b"]))).toBe(seeded);
  });

  it("never rewrites a document from a newer version", () => {
    const newer: RogueliteMeta = { ...emptyMeta, schemaVersion: 99 };
    expect(seedSeen(newer, new Set(["a"]))).toBe(newer);
  });
});

describe("awardFinishedRuns", () => {
  const none = new Set<string>();
  const seeded = (ids: string[] = []) => seedSeen(emptyMeta, new Set(ids));

  it("seeds from the baseline and then awards a run that ended later", () => {
    const meta = awardFinishedRuns(
      emptyMeta,
      { old: run("won"), fresh: run("won") },
      new Set(["old"]),
    );
    expect(meta.seenSeeded).toBe(true);
    expect(meta.games.ba.seen).toEqual(["fresh"]);
    expect(meta.games.ba.stats.runs).toBe(1);
    expect(meta.legacy.seen).toEqual(["old"]);
  });

  it("never awards a run in the baseline", () => {
    const meta = awardFinishedRuns(
      emptyMeta,
      { old: run("won"), older: run("lost") },
      new Set(["old", "older"]),
    );
    expect(meta.games).toEqual({});
    expect(meta.legacy.stats.runs).toBe(0);
  });

  it("awards a finished run once, however often it is seen", () => {
    const once = awardFinishedRuns(seeded(), { r1: run("won") }, none);
    const twice = awardFinishedRuns(once, { r1: run("won") }, none);
    expect(twice).toBe(once);
    expect(once.games.ba.stats.runs).toBe(1);
  });

  it("does not count a run that is still active", () => {
    const active = run("won");
    active.progress.status = "active";
    const meta = seeded();
    expect(awardFinishedRuns(meta, { r1: active }, none)).toBe(meta);
  });

  it("puts a run with no game in the legacy record", () => {
    const meta = awardFinishedRuns(
      seeded(),
      { r1: run("won", 0, 4, "") },
      none,
    );
    expect(meta.legacy.stats.runs).toBe(1);
    expect(meta.legacy.seen).toEqual(["r1"]);
    expect(meta.games).toEqual({});
  });

  it("does not count a run any record has counted", () => {
    const meta = seeded(["r1"]);
    expect(awardFinishedRuns(meta, { r1: run("won") }, none)).toBe(meta);
  });

  it("writes nothing for a newer document", () => {
    const newer: RogueliteMeta = {
      ...emptyMeta,
      schemaVersion: 99,
      seenSeeded: true,
    };
    expect(awardFinishedRuns(newer, { r1: run("won") }, none)).toBe(newer);
  });
});

describe("loadouts", () => {
  it("offers only the default until unlocked", () => {
    expect(
      unlockedLoadouts(unlocksFor(emptyMeta, "ba")).map((l) => l.id),
    ).toEqual(["standard"]);
  });

  it("includes unlocked doctrines", () => {
    const ids = unlockedLoadouts({ loadouts: ["air"] }).map((l) => l.id);
    expect(ids).toContain("standard");
    expect(ids).toContain("air");
  });

  it("loadoutById falls back to the default", () => {
    expect(loadoutById("nope").id).toBe("standard");
    expect(loadoutById("air").branchIndex).toBe(1);
  });
});
