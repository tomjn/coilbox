import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  type AchievementResult,
  evaluateAchievements,
} from "./achievements";
import type { StatPlayer, StatRecord } from "./bindings";
import { playerGameFacts } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;

let seq = 0;

/** A record whose single game happens at an explicit time (chronological control). */
function rec(
  map: string,
  players: StatPlayer[],
  opts: {
    winnersKnown?: boolean;
    remixed?: boolean;
    startTimeMs?: number;
  } = {},
): StatRecord {
  seq += 1;
  return {
    filename: `r${seq}.sdfz`,
    path: `/demos/r${seq}.sdfz`,
    mapName: map,
    gameType: "BAR",
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: opts.startTimeMs ?? seq * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: opts.winnersKnown ?? true,
    winningAllyTeams: [0],
    remixed: opts.remixed ?? false,
    ais: [],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
    players,
  };
}

function p(
  name: string,
  won: boolean | undefined,
  side = "Armada",
  spectator = false,
): StatPlayer {
  return { name, won, side, spectator };
}

/** Evaluate straight from a chronological list of the player's own games. */
function facts(
  games: { won?: boolean; map?: string; side?: string; startTimeMs?: number }[],
) {
  return games.map((g, i) => ({
    startTimeMs: g.startTimeMs ?? i * 1000,
    mapName: g.map ?? `map${i}`,
    gameType: "BAR",
    side: g.side,
    won: g.won,
  }));
}

function byId(results: AchievementResult[], id: string): AchievementResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no achievement ${id}`);
  return r;
}

describe("evaluateAchievements - empty library", () => {
  it("returns every achievement unearned at zero progress", () => {
    const results = evaluateAchievements([]);
    expect(results).toHaveLength(ACHIEVEMENTS.length);
    for (const r of results) {
      expect(r.earned).toBe(false);
      expect(r.current).toBe(0);
      expect(r.earnedAtMs).toBeUndefined();
    }
  });
});

describe("games-played milestones", () => {
  it("earns First game on the first game and dates it", () => {
    const results = evaluateAchievements(
      facts([{ startTimeMs: 5000 }, { startTimeMs: 6000 }]),
    );
    const first = byId(results, "games-first");
    expect(first.earned).toBe(true);
    expect(first.current).toBe(2);
    expect(first.earnedAtMs).toBe(5000);
  });

  it("counts wins and losses alike toward games played", () => {
    const results = evaluateAchievements(
      facts(Array.from({ length: 10 }, (_, i) => ({ won: i % 2 === 0 }))),
    );
    const ten = byId(results, "games-10");
    expect(ten.earned).toBe(true);
    expect(ten.current).toBe(10);
    // Unearned higher tier still reports progress.
    expect(byId(results, "games-50").earned).toBe(false);
    expect(byId(results, "games-50").current).toBe(10);
  });

  it("dates games-10 by the tenth game", () => {
    const games = facts(
      Array.from({ length: 12 }, (_, i) => ({ startTimeMs: (i + 1) * 1000 })),
    );
    expect(byId(evaluateAchievements(games), "games-10").earnedAtMs).toBe(
      10000,
    );
  });
});

describe("win milestones", () => {
  it("earns First win only on a win, not a loss", () => {
    const lossOnly = evaluateAchievements(facts([{ won: false }]));
    expect(byId(lossOnly, "win-first").earned).toBe(false);

    const withWin = evaluateAchievements(
      facts([{ won: false }, { won: true, startTimeMs: 9000 }]),
    );
    const win = byId(withWin, "win-first");
    expect(win.earned).toBe(true);
    expect(win.earnedAtMs).toBe(9000);
  });

  it("does not count undecided games as wins", () => {
    const results = evaluateAchievements(
      facts([{ won: undefined }, { won: undefined }, { won: undefined }]),
    );
    expect(byId(results, "win-first").earned).toBe(false);
    expect(byId(results, "win-first").current).toBe(0);
  });
});

describe("win streaks", () => {
  it("earns On a roll on three straight wins and dates the third", () => {
    const results = evaluateAchievements(
      facts([
        { won: true, startTimeMs: 1000 },
        { won: true, startTimeMs: 2000 },
        { won: true, startTimeMs: 3000 },
      ]),
    );
    const streak = byId(results, "streak-3");
    expect(streak.earned).toBe(true);
    expect(streak.current).toBe(3);
    expect(streak.earnedAtMs).toBe(3000);
  });

  it("breaks the run on a loss", () => {
    const results = evaluateAchievements(
      facts([{ won: true }, { won: true }, { won: false }, { won: true }]),
    );
    expect(byId(results, "streak-3").earned).toBe(false);
    expect(byId(results, "streak-3").current).toBe(2);
  });

  it("skips undecided games without breaking the run", () => {
    const results = evaluateAchievements(
      facts([{ won: true }, { won: undefined }, { won: true }, { won: true }]),
    );
    expect(byId(results, "streak-3").earned).toBe(true);
    expect(byId(results, "streak-3").current).toBe(3);
  });
});

describe("variety", () => {
  it("counts distinct maps and dates the fifth distinct map", () => {
    const results = evaluateAchievements(
      facts([
        { map: "A", startTimeMs: 1000 },
        { map: "A", startTimeMs: 2000 },
        { map: "B", startTimeMs: 3000 },
        { map: "C", startTimeMs: 4000 },
        { map: "D", startTimeMs: 5000 },
        { map: "E", startTimeMs: 6000 },
      ]),
    );
    const maps = byId(results, "maps-5");
    expect(maps.earned).toBe(true);
    expect(maps.current).toBe(5);
    expect(maps.earnedAtMs).toBe(6000);
  });

  it("counts distinct factions, ignoring empty sides", () => {
    const results = evaluateAchievements(
      facts([
        { side: "Armada" },
        { side: "" },
        { side: "Cortex" },
        { side: "Legion" },
      ]),
    );
    const factions = byId(results, "factions-3");
    expect(factions.earned).toBe(true);
    expect(factions.current).toBe(3);
  });
});

describe("activity", () => {
  it("earns Busy week for 10 games inside a 7-day window", () => {
    const results = evaluateAchievements(
      facts(
        Array.from({ length: 10 }, (_, i) => ({
          startTimeMs: i * (DAY_MS / 2), // 10 games across 4.5 days
        })),
      ),
    );
    const busy = byId(results, "week-10");
    expect(busy.earned).toBe(true);
    expect(busy.current).toBe(10);
  });

  it("does not earn Busy week when 10 games straddle more than 7 days", () => {
    const results = evaluateAchievements(
      facts(
        Array.from({ length: 10 }, (_, i) => ({ startTimeMs: i * DAY_MS })),
      ),
    );
    const busy = byId(results, "week-10");
    expect(busy.earned).toBe(false);
    // The busiest window holds 7 games (days 0 through 6, a span under 7 days).
    expect(busy.current).toBe(7);
  });
});

describe("genuine-match filter (via playerGameFacts)", () => {
  it("excludes remixed and refought reruns from the games it counts", () => {
    seq = 0;
    const records = [
      rec("A", [p("me", true)]),
      rec("B", [p("me", true)], { remixed: true }),
      rec("C", [p("me", true)]),
    ];
    // r3.sdfz is a refight rerun (best-effort filename provenance).
    const refights = new Set(["r3.sdfz"]);
    const results = evaluateAchievements(
      playerGameFacts(records, "me", refights),
    );
    // Only the one genuine game counts, so First game is earned but not more.
    expect(byId(results, "games-first").earned).toBe(true);
    expect(byId(results, "win-first").current).toBe(1);
  });

  it("counts genuine wins toward win achievements", () => {
    seq = 0;
    const records = [
      rec("A", [p("me", true)]),
      rec("B", [p("me", false)]),
      rec("C", [p("me", true)]),
    ];
    const results = evaluateAchievements(playerGameFacts(records, "me"));
    expect(byId(results, "win-first").earned).toBe(true);
    expect(byId(results, "games-first").current).toBe(3);
  });

  it("treats unknown-winner games as undecided, not wins", () => {
    seq = 0;
    const records = [
      rec("A", [p("me", undefined)], { winnersKnown: false }),
      rec("B", [p("me", undefined)], { winnersKnown: false }),
    ];
    const results = evaluateAchievements(playerGameFacts(records, "me"));
    expect(byId(results, "games-first").earned).toBe(true);
    expect(byId(results, "win-first").earned).toBe(false);
  });
});
