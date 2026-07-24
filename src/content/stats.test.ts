import { describe, expect, it } from "vitest";
import type { StatPlayer, StatRecord } from "./bindings";
import {
  allPlayers,
  filterPlayers,
  guessPrimaryPlayer,
  isGenuineMatch,
  profileFor,
  relationTo,
  replaysFor,
} from "./stats";

let seq = 0;

function rec(
  map: string,
  players: StatPlayer[],
  opts: { winnersKnown?: boolean; remixed?: boolean } = {},
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
    remixed: opts.remixed ?? false,
    ingestedAt: 0,
    players,
  };
}

function p(
  name: string,
  won: boolean | undefined,
  side = "Armada",
  spectator = false,
  allyTeam?: number,
): StatPlayer {
  return { name, won, side, spectator, allyTeam };
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

describe("filterPlayers", () => {
  const players = [
    { name: "Alice", games: 5 },
    { name: "bob", games: 3 },
    { name: "Charlie", games: 1 },
  ];

  it("returns everything for an empty query", () => {
    expect(filterPlayers(players, "")).toEqual(players);
    expect(filterPlayers(players, "   ")).toEqual(players);
  });

  it("matches case-insensitively by substring, preserving order", () => {
    expect(filterPlayers(players, "AL")).toEqual([{ name: "Alice", games: 5 }]);
    expect(filterPlayers(players, "rl")).toEqual([
      { name: "Charlie", games: 1 },
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterPlayers(players, "zzz")).toEqual([]);
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

  it("reports the most recent game's start time as lastPlayedMs", () => {
    const records = [rec("A", [p("me", true)]), rec("B", [p("me", false)])];
    expect(profileFor(records, "me").lastPlayedMs).toBe(records[1].startTimeMs);
    expect(profileFor([], "me").lastPlayedMs).toBe(0);
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

describe("replaysFor", () => {
  it("lists every replay the player appears in, most-recent-first", () => {
    const records = [
      rec("A", [p("me", true)]),
      rec("B", [p("me", false)]),
      rec("C", [p("foe", true)]),
    ];
    const replays = replaysFor(records, "me");
    expect(replays).toEqual([
      {
        filename: records[1].filename,
        mapName: "B",
        gameType: "BAR",
        startTimeMs: records[1].startTimeMs,
        won: false,
      },
      {
        filename: records[0].filename,
        mapName: "A",
        gameType: "BAR",
        startTimeMs: records[0].startTimeMs,
        won: true,
      },
    ]);
  });

  it("excludes spectator appearances and reports an undefined result when unknown", () => {
    const records = [
      rec("A", [p("me", undefined, "Armada", true)]),
      rec("B", [p("me", undefined)], { winnersKnown: false }),
    ];
    const replays = replaysFor(records, "me");
    expect(replays).toEqual([
      {
        filename: records[1].filename,
        mapName: "B",
        gameType: "BAR",
        startTimeMs: records[1].startTimeMs,
        won: undefined,
      },
    ]);
  });

  it("is empty for a player with no games", () => {
    expect(replaysFor([], "me")).toEqual([]);
  });
});

describe("relationTo", () => {
  it("splits shared games into together and against, from me's wins", () => {
    const records = [
      // Together, I won.
      rec("A", [
        p("me", true, "Armada", false, 0),
        p("ally", true, "Cortex", false, 0),
      ]),
      // Against, I won.
      rec("B", [
        p("me", true, "Armada", false, 0),
        p("foe", false, "Cortex", false, 1),
      ]),
      // Against, I lost.
      rec("C", [
        p("me", false, "Armada", false, 0),
        p("foe", true, "Cortex", false, 1),
      ]),
      // A game without foe or ally — not shared.
      rec("D", [p("me", true)]),
    ];
    const withAlly = relationTo(records, "me", "ally");
    expect(withAlly).toMatchObject({
      gamesShared: 1,
      gamesTogether: 1,
      winsTogether: 1,
      gamesAgainst: 0,
      winsAgainst: 0,
    });

    const withFoe = relationTo(records, "me", "foe");
    expect(withFoe).toMatchObject({
      gamesShared: 2,
      gamesTogether: 0,
      gamesAgainst: 2,
      winsAgainst: 1,
    });
  });

  it("counts a shared game toward gamesShared even with an unknown ally team", () => {
    const records = [rec("A", [p("me", true), p("foe", false)])];
    const rel = relationTo(records, "me", "foe");
    expect(rel.gamesShared).toBe(1);
    expect(rel.gamesTogether).toBe(0);
    expect(rel.gamesAgainst).toBe(0);
  });

  it("ignores spectators and reports the most recent shared game", () => {
    const records = [
      rec("A", [
        p("me", true, "Armada", false, 0),
        p("foe", false, "Cortex", false, 1),
      ]),
      rec("B", [
        p("me", true, "Armada", false, 0),
        p("foe", false, "Cortex", false, 1),
      ]),
      rec("C", [
        p("me", true, "Armada", false, 0),
        p("foe", undefined, "Cortex", true, 1),
      ]),
    ];
    const rel = relationTo(records, "me", "foe");
    expect(rel.gamesShared).toBe(2);
    expect(rel.lastPlayedMs).toBe(records[1].startTimeMs);
  });

  it("tallies common maps by me's win", () => {
    const records = [
      rec("Comet", [
        p("me", true, "Armada", false, 0),
        p("foe", false, "Cortex", false, 1),
      ]),
      rec("Comet", [
        p("me", false, "Armada", false, 0),
        p("foe", true, "Cortex", false, 1),
      ]),
    ];
    const rel = relationTo(records, "me", "foe");
    expect(rel.commonMaps).toEqual([{ key: "Comet", games: 2, wins: 1 }]);
  });

  it("is empty when the players have never shared a game", () => {
    const records = [rec("A", [p("me", true)]), rec("B", [p("foe", true)])];
    const rel = relationTo(records, "me", "foe");
    expect(rel).toMatchObject({
      gamesShared: 0,
      gamesTogether: 0,
      gamesAgainst: 0,
      lastPlayedMs: 0,
      commonMaps: [],
    });
  });
});

describe("remix/refight exclusion (#466)", () => {
  it("isGenuineMatch is false for a remixed record", () => {
    const remixed = rec("A", [p("me", true)], { remixed: true });
    expect(isGenuineMatch(remixed, new Set())).toBe(false);
  });

  it("isGenuineMatch is false for a filename tagged as a refight", () => {
    const refought = rec("A", [p("me", true)]);
    expect(isGenuineMatch(refought, new Set([refought.filename]))).toBe(false);
  });

  it("isGenuineMatch is true for an ordinary record", () => {
    const genuine = rec("A", [p("me", true)]);
    expect(isGenuineMatch(genuine, new Set())).toBe(true);
  });

  it("allPlayers excludes remixed and refought games from the count", () => {
    const genuine = rec("A", [p("me", true)]);
    const remixed = rec("B", [p("me", false)], { remixed: true });
    const refought = rec("C", [p("me", true)]);
    const records = [genuine, remixed, refought];
    expect(allPlayers(records, new Set([refought.filename]))).toEqual([
      { name: "me", games: 1 },
    ]);
  });

  it("profileFor drops a remix from games, wins, and favourite maps", () => {
    const records = [
      rec("Comet", [p("me", true)]),
      rec("Valles Marineris", [p("me", true)], { remixed: true }),
    ];
    const prof = profileFor(records, "me");
    expect(prof.games).toBe(1);
    expect(prof.wins).toBe(1);
    expect(prof.favouriteMaps).toEqual([{ key: "Comet", games: 1, wins: 1 }]);
  });

  it("profileFor drops a refought record given its filename", () => {
    const genuine = rec("Comet", [p("me", true)]);
    const refought = rec("Comet", [p("me", false)]);
    const records = [genuine, refought];
    const prof = profileFor(records, "me", new Set([refought.filename]));
    expect(prof.games).toBe(1);
    expect(prof.losses).toBe(0);
  });

  it("relationTo excludes remixed/refought shared games", () => {
    const genuine = rec("A", [
      p("me", true, "Armada", false, 0),
      p("foe", false, "Cortex", false, 1),
    ]);
    const remixed = rec(
      "B",
      [p("me", false, "Armada", false, 0), p("foe", true, "Cortex", false, 1)],
      { remixed: true },
    );
    const records = [genuine, remixed];
    const rel = relationTo(records, "me", "foe");
    expect(rel.gamesShared).toBe(1);
    expect(rel.gamesAgainst).toBe(1);
    expect(rel.winsAgainst).toBe(1);
  });

  it("replaysFor keeps remix/refight records visible but flags them", () => {
    const genuine = rec("A", [p("me", true)]);
    const remixed = rec("B", [p("me", true)], { remixed: true });
    const refought = rec("C", [p("me", true)]);
    const records = [genuine, remixed, refought];
    const replays = replaysFor(records, "me", new Set([refought.filename]));
    expect(replays).toHaveLength(3);
    const byFilename = new Map(replays.map((r) => [r.filename, r]));
    expect(byFilename.get(genuine.filename)?.excludedReason).toBeUndefined();
    expect(byFilename.get(remixed.filename)?.excludedReason).toBe("remix");
    expect(byFilename.get(refought.filename)?.excludedReason).toBe("refight");
  });
});
