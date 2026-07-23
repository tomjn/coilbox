import { describe, expect, it } from "vitest";
import type { StatPlayer, StatRecord } from "./bindings";
import { allPlayers, guessPrimaryPlayer, profileFor } from "./stats";

let seq = 0;

function rec(
  map: string,
  players: StatPlayer[],
  opts: { winnersKnown?: boolean } = {},
): StatRecord {
  seq += 1;
  return {
    filename: `r${seq}.sdfz`,
    path: `/demos/r${seq}.sdfz`,
    mapName: map,
    gameType: "BAR",
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: seq * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: opts.winnersKnown ?? true,
    winningAllyTeams: [0],
    remixed: false,
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

describe("allPlayers", () => {
  it("counts non-spectator appearances, most-played first", () => {
    const records = [
      rec("A", [p("me", true), p("foe", false)]),
      rec("B", [p("me", false), p("foe", true)]),
      rec("C", [p("me", true), p("spec", undefined, "Armada", true)]),
    ];
    expect(allPlayers(records)).toEqual([
      { name: "me", games: 3 },
      { name: "foe", games: 2 },
    ]);
  });
});

describe("guessPrimaryPlayer", () => {
  it("picks the most-played name", () => {
    const records = [
      rec("A", [p("me", true), p("foe", false)]),
      rec("B", [p("me", false)]),
    ];
    expect(guessPrimaryPlayer(records)).toBe("me");
  });

  it("is undefined for an empty library", () => {
    expect(guessPrimaryPlayer([])).toBeUndefined();
  });
});

describe("profileFor", () => {
  it("computes games, win rate, and favourite maps", () => {
    const records = [
      rec("Comet", [p("me", true)]),
      rec("Comet", [p("me", false)]),
      rec("Delta", [p("me", true)]),
    ];
    const prof = profileFor(records, "me");
    expect(prof.games).toBe(3);
    expect(prof.decided).toBe(3);
    expect(prof.wins).toBe(2);
    expect(prof.losses).toBe(1);
    expect(prof.winRate).toBeCloseTo(2 / 3);
    expect(prof.favouriteMaps[0]).toEqual({ key: "Comet", games: 2, wins: 1 });
  });

  it("excludes undecided games from win rate but counts them as played", () => {
    const records = [
      rec("A", [p("me", true)]),
      rec("B", [p("me", undefined)], { winnersKnown: false }),
    ];
    const prof = profileFor(records, "me");
    expect(prof.games).toBe(2);
    expect(prof.decided).toBe(1);
    expect(prof.winRate).toBe(1);
  });

  it("has a null win rate when nothing is decided", () => {
    const prof = profileFor(
      [rec("A", [p("me", undefined)], { winnersKnown: false })],
      "me",
    );
    expect(prof.winRate).toBeNull();
  });

  it("tracks current streak (signed) and longest win streak", () => {
    // Chronological by startTimeMs: win, win, loss, win.
    const records = [
      rec("A", [p("me", true)]),
      rec("B", [p("me", true)]),
      rec("C", [p("me", false)]),
      rec("D", [p("me", true)]),
    ];
    const prof = profileFor(records, "me");
    expect(prof.currentStreak).toBe(1); // last game was a win, preceded by a loss
    expect(prof.longestWinStreak).toBe(2);
  });

  it("reports a losing current streak as negative", () => {
    const records = [
      rec("A", [p("me", true)]),
      rec("B", [p("me", false)]),
      rec("C", [p("me", false)]),
    ];
    expect(profileFor(records, "me").currentStreak).toBe(-2);
  });

  it("tallies factions used", () => {
    const records = [
      rec("A", [p("me", true, "Armada")]),
      rec("B", [p("me", false, "Cortex")]),
      rec("C", [p("me", true, "Armada")]),
    ];
    const prof = profileFor(records, "me");
    expect(prof.factions[0]).toEqual({ key: "Armada", games: 2, wins: 2 });
    expect(prof.factions[1]).toEqual({ key: "Cortex", games: 1, wins: 0 });
  });
});
