import { describe, expect, it } from "vitest";
import type { StatRecord } from "./bindings";
import {
  type AggregateMatch,
  mapMatches,
  matchesElsewhere,
  matchFormat,
  type ReplayCounts,
} from "./mapAggregate";
import {
  clusterScale,
  clusterStarts,
  declaredTolerance,
  factionCounts,
  joinStarts,
  lengthSummary,
  nearestDeclared,
  placeRecords,
  sharedFormat,
  teamRecord,
  withResult,
} from "./mapRecords";

type Seat = {
  name?: string;
  team?: number;
  allyTeam?: number;
  side?: string;
  won?: boolean;
  spectator?: boolean;
};

function record(
  over: Partial<StatRecord> & { filename: string; seats?: Seat[] },
): StatRecord {
  const { seats, ...rest } = over;
  return {
    path: `/demos/${over.filename}`,
    mapName: "Some Map 1.0",
    gameType: "Some Game 1.0",
    engineVersion: "2025.06.19",
    durationSec: 1200,
    startTimeMs: 1,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: true,
    winningAllyTeams: [0],
    remixed: false,
    players: (
      seats ?? [
        { team: 0, allyTeam: 0 },
        { team: 1, allyTeam: 1 },
      ]
    ).map((s, i) => ({ name: s.name ?? `P${i}`, spectator: false, ...s })),
    ais: [],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
    ...rest,
  };
}

function matchOf(r: StatRecord): AggregateMatch {
  return {
    record: r,
    playerCount: r.players.filter((p) => !p.spectator).length + r.ais.length,
    format: matchFormat(r),
    analysis: "none",
  };
}

function counts(
  r: StatRecord,
  starts: { team: number; x: number; z: number }[],
): ReplayCounts {
  return { path: r.path, starts } as ReplayCounts;
}

const WORLD = { worldWidth: 8192, worldHeight: 8192 };

describe("declaredTolerance", () => {
  it("is half the smallest distance between two declared positions", () => {
    const declared = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
      { x: 0, z: 3000 },
    ];
    expect(declaredTolerance(declared)).toBe(500);
  });

  it("is null with fewer than two distinct positions", () => {
    expect(declaredTolerance([])).toBeNull();
    expect(declaredTolerance([{ x: 5, z: 5 }])).toBeNull();
    expect(
      declaredTolerance([
        { x: 5, z: 5 },
        { x: 5, z: 5 },
      ]),
    ).toBeNull();
  });
});

describe("nearestDeclared", () => {
  const declared = [
    { x: 0, z: 0 },
    { x: 1000, z: 0 },
    { x: 0, z: 3000 },
  ];
  const tolerance = declaredTolerance(declared);

  it("puts a start on the declared position it is near", () => {
    expect(nearestDeclared({ x: 100, z: 50 }, declared, tolerance)).toBe(0);
    expect(nearestDeclared({ x: 990, z: 10 }, declared, tolerance)).toBe(1);
    expect(nearestDeclared({ x: 499, z: 0 }, declared, tolerance)).toBe(0);
    expect(nearestDeclared({ x: 501, z: 0 }, declared, tolerance)).toBe(1);
  });

  it("leaves a start exactly between two positions at neither", () => {
    expect(nearestDeclared({ x: 500, z: 0 }, declared, tolerance)).toBeNull();
  });

  it("leaves a start far from every position at none", () => {
    expect(
      nearestDeclared({ x: 4000, z: 4000 }, declared, tolerance),
    ).toBeNull();
    expect(nearestDeclared({ x: 0, z: 1500 }, declared, tolerance)).toBeNull();
  });

  it("assigns nothing with no tolerance", () => {
    expect(nearestDeclared({ x: 0, z: 0 }, declared, null)).toBeNull();
  });
});

describe("clusterScale", () => {
  it("is 1/32 of the shorter side", () => {
    expect(clusterScale({ worldWidth: 8192, worldHeight: 4096 })).toBe(128);
  });
  it("is null for a map with no size", () => {
    expect(clusterScale({ worldWidth: 0, worldHeight: 4096 })).toBeNull();
  });
});

describe("clusterStarts", () => {
  const scale = 256;

  it("puts two starts a little apart in one group", () => {
    const groups = clusterStarts(
      [
        { x: 1000, z: 1000 },
        { x: 1100, z: 1000 },
      ],
      scale,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toEqual([0, 1]);
    expect(groups[0].x).toBe(1050);
    expect(groups[0].radius).toBe(50);
  });

  it("puts two starts far apart in two groups", () => {
    const groups = clusterStarts(
      [
        { x: 1000, z: 1000 },
        { x: 5000, z: 1000 },
      ],
      scale,
    );
    expect(groups).toHaveLength(2);
  });

  it("joins starts through a chain of near neighbours", () => {
    const groups = clusterStarts(
      [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
        { x: 400, z: 0 },
      ],
      scale,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].radius).toBe(200);
  });

  it("gives the same groups, centres and keys in any order", () => {
    const points = [
      { x: 1000, z: 1000 },
      { x: 1100, z: 1040 },
      { x: 1010, z: 1000 },
      { x: 5000, z: 3000 },
      { x: 5050, z: 3010 },
      { x: 7000, z: 100 },
      { x: 1000, z: 1000 },
    ];
    const describe_ = (list: typeof points) =>
      clusterStarts(list, scale).map((c) => ({
        key: c.key,
        x: c.x,
        z: c.z,
        radius: c.radius,
        size: c.members.length,
      }));
    const forward = describe_(points);
    const backward = describe_([...points].reverse());
    const shuffled = describe_([2, 5, 0, 6, 3, 1, 4].map((i) => points[i]));
    expect(forward).toHaveLength(3);
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("keeps a group's key when a start is added beside it", () => {
    const before = [
      { x: 1000, z: 1000 },
      { x: 1040, z: 1010 },
    ];
    const keyBefore = clusterStarts(before, scale)[0].key;
    expect(keyBefore).toBe("c3:3");
    const after = clusterStarts([...before, { x: 1010, z: 990 }], scale);
    expect(after).toHaveLength(1);
    expect(after[0].key).toBe(keyBefore);
    expect(after[0].members).toHaveLength(3);
  });

  it("does not rename the other groups when a start is added elsewhere", () => {
    const before = [
      { x: 1000, z: 1000 },
      { x: 5000, z: 3000 },
    ];
    const keys = clusterStarts(before, scale).map((c) => c.key);
    const after = clusterStarts([...before, { x: 7000, z: 7000 }], scale);
    expect(after.map((c) => c.key)).toEqual(expect.arrayContaining(keys));
    expect(after).toHaveLength(3);
  });

  it("gives two groups with centres in one cell different keys", () => {
    const groups = clusterStarts(
      [
        { x: 10, z: 10 },
        { x: 200, z: 250 },
      ],
      scale,
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key)).toEqual(["c0:0", "c0:0.2"]);
  });

  it("returns nothing for no starts", () => {
    expect(clusterStarts([], scale)).toEqual([]);
  });
});

describe("joinStarts", () => {
  const two = [
    { team: 0, x: 100, z: 100 },
    { team: 1, x: 7000, z: 7000 },
  ];

  it("joins a start to its result through the team and the side", () => {
    const r = record({ filename: "a", winningAllyTeams: [1] });
    const got = joinStarts([matchOf(r)], new Map([[r.path, counts(r, two)]]));
    expect(got.joined).toBe(1);
    expect(got.starts.map((s) => [s.team, s.side, s.outcome])).toEqual([
      [0, 1, "lost"],
      [1, 2, "won"],
    ]);
  });

  it("leaves a match with no team ids out and counts it", () => {
    const r = record({
      filename: "old",
      seats: [{ allyTeam: 0 }, { allyTeam: 1 }],
    });
    const got = joinStarts([matchOf(r)], new Map([[r.path, counts(r, two)]]));
    expect(got.starts).toEqual([]);
    expect(got.noTeamIds).toBe(1);
  });

  it("never reads an absent team id as team 0", () => {
    const r = record({
      filename: "old",
      seats: [{ allyTeam: 0 }, { allyTeam: 1 }],
      winningAllyTeams: [0],
    });
    const got = joinStarts(
      [matchOf(r)],
      new Map([[r.path, counts(r, [{ team: 0, x: 1, z: 1 }])]]),
    );
    expect(got.starts).toEqual([]);
    expect(got.noTeamIds).toBe(1);
  });

  it("counts a match with no result as taken and as neither won nor lost", () => {
    const r = record({
      filename: "a",
      winnersKnown: false,
      winningAllyTeams: [],
    });
    const got = joinStarts([matchOf(r)], new Map([[r.path, counts(r, two)]]));
    expect(got.starts.map((s) => s.outcome)).toEqual([
      "no-result",
      "no-result",
    ]);
  });

  it("joins an AI team's start and marks it", () => {
    const r = record({
      filename: "ai",
      seats: [{ team: 0, allyTeam: 0 }],
      ais: [{ name: "Bot", shortName: "Bot", team: 1, allyTeam: 1 }],
      winningAllyTeams: [1],
    });
    const got = joinStarts([matchOf(r)], new Map([[r.path, counts(r, two)]]));
    expect(got.starts.map((s) => [s.team, s.byAi, s.outcome])).toEqual([
      [0, false, "lost"],
      [1, true, "won"],
    ]);
  });

  it("lists a team shared by two players once", () => {
    const r = record({
      filename: "shared",
      seats: [
        { team: 0, allyTeam: 0 },
        { team: 0, allyTeam: 0 },
        { team: 1, allyTeam: 1 },
        { team: 1, allyTeam: 1 },
      ],
    });
    const got = joinStarts([matchOf(r)], new Map([[r.path, counts(r, two)]]));
    expect(got.starts).toHaveLength(2);
    expect(got.starts[0].side).toBe(1);
  });

  it("counts a start whose team nobody held", () => {
    const r = record({ filename: "a" });
    const got = joinStarts(
      [matchOf(r)],
      new Map([[r.path, counts(r, [...two, { team: 7, x: 5, z: 5 }])]]),
    );
    expect(got.starts).toHaveLength(2);
    expect(got.noSeat).toBe(1);
  });

  it("counts a match not read and a match with no start", () => {
    const a = record({ filename: "a" });
    const b = record({ filename: "b" });
    const got = joinStarts(
      [matchOf(a), matchOf(b)],
      new Map([[b.path, counts(b, [])]]),
    );
    expect(got.unread).toBe(1);
    expect(got.noStarts).toBe(1);
  });

  it("gives no side number to a free for all", () => {
    const r = record({
      filename: "ffa",
      seats: [
        { team: 0, allyTeam: 0 },
        { team: 1, allyTeam: 1 },
        { team: 2, allyTeam: 2 },
      ],
    });
    const got = joinStarts(
      [matchOf(r)],
      new Map([[r.path, counts(r, [{ team: 2, x: 1, z: 1 }])]]),
    );
    expect(got.starts[0].side).toBeNull();
  });
});

describe("placeRecords", () => {
  const declared = [
    { x: 1000, z: 1000 },
    { x: 3000, z: 1000 },
  ];

  /** One match of two teams: team 0 starts at `a`, team 1 at `b`. */
  function duel(
    name: string,
    a: [number, number],
    b: [number, number],
    winner: 0 | 1 | null,
  ) {
    const r = record({
      filename: name,
      winnersKnown: winner !== null,
      winningAllyTeams: winner === null ? [] : [winner],
    });
    return {
      m: matchOf(r),
      c: counts(r, [
        { team: 0, x: a[0], z: a[1] },
        { team: 1, x: b[0], z: b[1] },
      ]),
    };
  }

  it("counts taken, with a result and won, by declared position and group", () => {
    const list = [
      duel("1", [1000, 1000], [3000, 1000], 0),
      duel("2", [1010, 990], [3000, 1000], 0),
      duel("3", [3000, 1000], [1000, 1000], 1),
      duel("4", [1000, 1000], [3010, 1010], null),
      // Neither is near a declared position: a group of two and one more.
      duel("5", [5000, 5000], [5040, 5030], 0),
      duel("6", [7000, 200], [5010, 5000], 1),
    ];
    const joined = joinStarts(
      list.map((x) => x.m),
      new Map(list.map((x) => [x.m.record.path, x.c])),
    );
    const got = placeRecords(joined.starts, declared, WORLD);
    const by = Object.fromEntries(got.places.map((p) => [p.place.key, p]));

    // Declared position 1: starts from matches 1, 2 (team 0), 3 (team 1),
    // 4 (team 0). Wins: 1 and 2 by team 0, 3 by team 1, 4 has no result.
    expect(by.d1).toMatchObject({ taken: 4, known: 3, won: 3 });
    expect(by.d1.place.number).toBe(1);
    // Declared position 2: 1 (team 1, lost), 2 (team 1, lost),
    // 3 (team 0, lost), 4 (team 1, no result).
    expect(by.d2).toMatchObject({ taken: 4, known: 3, won: 0 });
    expect(by.d2.place.number).toBe(2);
    expect(got.atDeclared).toBe(8);

    // The group round (5000, 5000): match 5 team 0 (won), match 5 team 1 (lost),
    // match 6 team 1 (won).
    const group = got.places.find(
      (p) => p.place.kind === "cluster" && p.taken === 3,
    );
    expect(group).toMatchObject({ taken: 3, known: 3, won: 2 });
    expect(group?.place.number).toBe(3);
    expect(group?.place.key).toBe("c19:19");
    // The lone start at (7000, 200) is a group of one, numbered after.
    const lone = got.places.find((p) => p.taken === 1);
    expect(lone?.place).toMatchObject({
      number: 4,
      radius: 0,
      x: 7000,
      z: 200,
    });
    expect(got.grouped).toBe(4);
    expect(got.ungrouped).toBe(0);
    expect(got.tolerance).toBe(1000);
  });

  it("splits a position by side", () => {
    const list = [
      duel("1", [1000, 1000], [3000, 1000], 0),
      duel("2", [3000, 1000], [1000, 1000], 0),
      duel("3", [1000, 1000], [3000, 1000], null),
    ];
    const joined = joinStarts(
      list.map((x) => x.m),
      new Map(list.map((x) => [x.m.record.path, x.c])),
    );
    const d1 = placeRecords(joined.starts, declared, WORLD).places.find(
      (p) => p.place.key === "d1",
    );
    // Position 1 was team 1 in matches 1 and 3 and team 2 in match 2.
    expect(d1?.sides[0]).toEqual({ taken: 2, known: 1, won: 1 });
    expect(d1?.sides[1]).toEqual({ taken: 1, known: 1, won: 0 });
    expect(d1).toMatchObject({ taken: 3, known: 2, won: 1 });
  });

  it("counts starts taken by an AI", () => {
    const r = record({
      filename: "ai",
      seats: [{ team: 0, allyTeam: 0 }],
      ais: [{ name: "Bot", shortName: "Bot", team: 1, allyTeam: 1 }],
    });
    const joined = joinStarts(
      [matchOf(r)],
      new Map([
        [
          r.path,
          counts(r, [
            { team: 0, x: 1000, z: 1000 },
            { team: 1, x: 3000, z: 1000 },
          ]),
        ],
      ]),
    );
    const got = placeRecords(joined.starts, declared, WORLD);
    expect(got.places.map((p) => p.byAi).sort()).toEqual([0, 1]);
  });

  it("groups everything on a map that declares no positions", () => {
    const list = [
      duel("1", [1000, 1000], [6000, 6000], 0),
      duel("2", [1050, 1000], [6000, 6050], 1),
    ];
    const joined = joinStarts(
      list.map((x) => x.m),
      new Map(list.map((x) => [x.m.record.path, x.c])),
    );
    const got = placeRecords(joined.starts, [], WORLD);
    expect(got.tolerance).toBeNull();
    expect(got.places).toHaveLength(2);
    expect(got.places.every((p) => p.place.kind === "cluster")).toBe(true);
    expect(got.places.map((p) => p.place.number).sort()).toEqual([1, 2]);
    expect(got.places.map((p) => p.taken)).toEqual([2, 2]);
  });

  it("says how many starts it could not group on a map with no size", () => {
    const list = [duel("1", [1000, 1000], [6000, 6000], 0)];
    const joined = joinStarts(
      list.map((x) => x.m),
      new Map(list.map((x) => [x.m.record.path, x.c])),
    );
    const got = placeRecords(joined.starts, [], {
      worldWidth: 0,
      worldHeight: 0,
    });
    expect(got.places).toEqual([]);
    expect(got.ungrouped).toBe(2);
  });
});

describe("teamRecord and withResult", () => {
  it("counts which team won over matches of two teams", () => {
    const list = [
      matchOf(record({ filename: "a", winningAllyTeams: [0] })),
      matchOf(record({ filename: "b", winningAllyTeams: [1] })),
      matchOf(record({ filename: "c", winningAllyTeams: [1] })),
      matchOf(
        record({ filename: "d", winnersKnown: false, winningAllyTeams: [] }),
      ),
      matchOf(
        record({
          filename: "e",
          seats: [
            { team: 0, allyTeam: 0 },
            { team: 1, allyTeam: 1 },
            { team: 2, allyTeam: 2 },
          ],
        }),
      ),
    ];
    expect(teamRecord(list)).toEqual({
      twoSides: 4,
      decided: 3,
      team1Won: 1,
      team2Won: 2,
      other: 1,
    });
    expect(withResult(list)).toBe(4);
  });
});

describe("sharedFormat", () => {
  it("is the arrangement when every match has it, and null otherwise", () => {
    const duelMatch = matchOf(record({ filename: "a" }));
    const ffa = matchOf(
      record({
        filename: "b",
        seats: [
          { team: 0, allyTeam: 0 },
          { team: 1, allyTeam: 1 },
          { team: 2, allyTeam: 2 },
        ],
      }),
    );
    expect(sharedFormat([duelMatch, duelMatch])).toBe("duel");
    expect(sharedFormat([duelMatch, ffa])).toBeNull();
    expect(sharedFormat([])).toBeNull();
  });
});

describe("lengthSummary", () => {
  const len = (...secs: number[]) =>
    secs.map((s, i) => matchOf(record({ filename: `m${i}`, durationSec: s })));

  it("gives the median of an odd count and the range", () => {
    expect(lengthSummary(len(600, 1800, 1200))).toEqual({
      matches: 3,
      noLength: 0,
      median: 1200,
      shortest: 600,
      longest: 1800,
    });
  });

  it("gives the middle of the two middle lengths for an even count", () => {
    expect(lengthSummary(len(600, 1000, 1400, 4000)).median).toBe(1200);
  });

  it("leaves out a match whose header holds no length, and says so", () => {
    const got = lengthSummary(len(0, 900));
    expect(got).toMatchObject({ matches: 1, noLength: 1, median: 900 });
  });

  it("is empty for no matches", () => {
    expect(lengthSummary([])).toEqual({
      matches: 0,
      noLength: 0,
      median: null,
      shortest: null,
      longest: null,
    });
  });
});

describe("factionCounts", () => {
  it("counts every player's faction, with games apart from results", () => {
    const list = [
      matchOf(
        record({
          filename: "a",
          seats: [
            { team: 0, allyTeam: 0, side: "Alpha", won: true },
            { team: 1, allyTeam: 1, side: "Beta", won: false },
            { team: 2, allyTeam: 1, side: "Beta", won: false },
            { team: 3, allyTeam: 1, spectator: true, side: "Alpha" },
            { team: 4, allyTeam: 1, side: "" },
          ],
        }),
      ),
      matchOf(
        record({
          filename: "b",
          winnersKnown: false,
          winningAllyTeams: [],
          seats: [
            { team: 0, allyTeam: 0, side: "Alpha" },
            { team: 1, allyTeam: 1, side: "Beta" },
          ],
        }),
      ),
    ];
    expect(factionCounts(list)).toEqual([
      { faction: "Beta", games: 3, decided: 2, wins: 0 },
      { faction: "Alpha", games: 2, decided: 1, wins: 1 },
    ]);
  });
});

describe("the matches a map counts", () => {
  it("leaves refights out of the map and counts them, and counts the other maps", () => {
    const records = [
      record({ filename: "a", gameId: "1" }),
      record({ filename: "refight", gameId: "2" }),
      record({ filename: "z", gameId: "3", mapName: "Other Map" }),
      record({ filename: "y", gameId: "4", mapName: "Other Map" }),
    ];
    const got = mapMatches(
      records,
      "Some Map 1.0",
      new Map(),
      new Set(["refight"]),
    );
    expect(got.matches.map((m) => m.record.filename)).toEqual(["a"]);
    expect(got.refights).toBe(1);
    const rest = matchesElsewhere(
      records,
      "Some Map 1.0",
      new Map(),
      new Set(["y"]),
    );
    expect(rest.matches.map((m) => m.record.filename)).toEqual(["z"]);
    expect(rest.refights).toBe(1);
  });
});
