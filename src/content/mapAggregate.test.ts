import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heatAt, heatGridSize } from "@/lib/heatField";
import type { MapCountLayer, ReplayMapGrids, StatRecord } from "./bindings";
import {
  type AggregateMatch,
  aggregateLayer,
  aggregateStarts,
  decodeReplayGrids,
  defCategories,
  FRAMES_PER_SLICE,
  filterChoices,
  filterMatches,
  layerLegend,
  MAP_GRID_RESOLUTION,
  mapMatches,
  matchesWithStarts,
  matchFormat,
  NO_FILTERS,
  type ReplayCounts,
  WHOLE,
  windowSlices,
} from "./mapAggregate";

const WORLD = { worldWidth: 8192, worldHeight: 8192 };
// A cell is 32 elmos each way and the grid is 256 by 256.
const CELL = 32;
const cellAt = (row: number, col: number) => row * 256 + col;
const middle = (n: number) => (n + 0.5) * CELL;

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/** Pack entries the way `map_grids.rs` does: `[cell, slice, count, def?]`. */
function layer(entries: [number, number, number, number?][]): MapCountLayer {
  const n = entries.length;
  const cell = new Uint32Array(n);
  const slice = new Uint16Array(n);
  const count = new Uint16Array(n);
  const def = new Uint32Array(n);
  entries.forEach(([c, s, k, d], i) => {
    cell[i] = c;
    slice[i] = s;
    count[i] = k;
    def[i] = d ?? 0;
  });
  const packed = (a: ArrayBufferView) => base64(new Uint8Array(a.buffer));
  return {
    entries: n,
    cell: packed(cell),
    slice: packed(slice),
    count: packed(count),
    def: entries.some((e) => e[3] !== undefined) ? packed(def) : undefined,
    total: entries.reduce((sum, e) => sum + e[2], 0),
    offMap: 0,
  };
}

function replay(
  over: Partial<ReplayMapGrids> & { path: string },
): ReplayCounts {
  return decodeReplayGrids({
    remixed: false,
    mapName: "Some Map 1.0",
    gameType: "Some Game 1.0",
    lastFrame: 10 * FRAMES_PER_SLICE,
    incomplete: false,
    starts: [],
    buildings: layer([]),
    orders: layer([]),
    unitAimed: 0,
    custom: 0,
    fromCache: false,
    ...over,
  });
}

/** Two matches. The quiet one gave 10 orders in the north west over ten
 *  minutes, in its first minute. The busy one gave 100 in the south east over
 *  twenty, in its thirteenth. */
const QUIET = cellAt(50, 50);
const BUSY = cellAt(200, 200);
const quiet = () =>
  replay({
    path: "/demos/quiet.sdfz",
    lastFrame: 10 * FRAMES_PER_SLICE,
    orders: layer([[QUIET, 0, 10]]),
  });
const busy = () =>
  replay({
    path: "/demos/busy.sdfz",
    lastFrame: 20 * FRAMES_PER_SLICE,
    orders: layer([[BUSY, 12, 100]]),
  });
const at = (field: Parameters<typeof heatAt>[0] | null, cell: number) =>
  field ? heatAt(field, middle(cell % 256), middle(Math.floor(cell / 256))) : 0;

describe("the grid and the slice are the ones Rust counts on", () => {
  const rust = readFileSync(
    "crates/tauri-plugin-coilbox-content/src/demo/map_grids.rs",
    "utf8",
  );

  it("has the resolution map_grids.rs has", () => {
    const found = rust.match(/pub const GRID_RESOLUTION: u32 = (\d+);/);
    expect(Number(found?.[1])).toBe(MAP_GRID_RESOLUTION);
  });

  it("has the slice length map_grids.rs has", () => {
    const found = rust.match(
      /pub const FRAMES_PER_SLICE: i32 = (\d+) \* (\d+);/,
    );
    expect(Number(found?.[1]) * Number(found?.[2])).toBe(FRAMES_PER_SLICE);
  });

  it("gives the sizes the Rust test asserts for the same maps", () => {
    expect(heatGridSize(8192, 8192)).toEqual({ width: 256, height: 256 });
    expect(heatGridSize(8192, 4096)).toEqual({ width: 256, height: 128 });
    expect(heatGridSize(6144, 10240)).toEqual({ width: 154, height: 256 });
  });
});

describe("unpacking a replay's counts", () => {
  it("reads the columns and keeps them out of an enumeration", () => {
    const got = replay({
      path: "/demos/a.sdfz",
      buildings: layer([
        [cellAt(1, 2), 0, 3, 42],
        [cellAt(3, 4), 7, 1, 9],
      ]),
    });
    expect(Array.from(got.buildings.cell)).toEqual([258, 772]);
    expect(Array.from(got.buildings.slice)).toEqual([0, 7]);
    expect(Array.from(got.buildings.count)).toEqual([3, 1]);
    expect(Array.from(got.buildings.def ?? [])).toEqual([42, 9]);
    expect(got.orders.def).toBeNull();
    expect(Object.keys(got.buildings)).toEqual(["entries", "total", "offMap"]);
    expect(got.deaths).toBeNull();
  });

  it("refuses a column that does not line up with the others", () => {
    const bad = { ...layer([[1, 0, 1]]), entries: 2 };
    expect(() => replay({ path: "/demos/a.sdfz", orders: bad })).toThrow();
  });
});

describe("scaling each match before adding", () => {
  it("share: each match adds up to one, so the busy match is no brighter", () => {
    const got = aggregateLayer([quiet(), busy()], "orders", WORLD, {
      normalise: "share",
      window: WHOLE,
    });
    expect(got.contributing).toBe(2);
    expect(got.events).toBe(110);
    // Each match is all in one spot, and the mean of two is half a match.
    expect(got.atPeak).toBeCloseTo(0.5, 5);
    expect(at(got.field, QUIET)).toBeCloseTo(at(got.field, BUSY), 5);
    expect(at(got.field, QUIET)).toBeGreaterThan(0);
  });

  it("rate: events a minute, so the busy match is five times brighter and not ten", () => {
    const got = aggregateLayer([quiet(), busy()], "orders", WORLD, {
      normalise: "rate",
      window: WHOLE,
    });
    // 10 over 10 minutes is 1 a minute, 100 over 20 is 5. Halved by the mean.
    expect(at(got.field, BUSY) / at(got.field, QUIET)).toBeCloseTo(5, 4);
    expect(got.atPeak).toBeCloseTo(2.5, 5);
  });

  it("peak: each match's busiest spot is one, and there is no count to state", () => {
    const got = aggregateLayer([quiet(), busy()], "orders", WORLD, {
      normalise: "peak",
      window: WHOLE,
    });
    expect(at(got.field, QUIET)).toBeCloseTo(0.5, 5);
    expect(at(got.field, BUSY)).toBeCloseTo(0.5, 5);
    expect(got.atPeak).toBeNull();
  });

  it("share and peak differ when a match is spread over two places", () => {
    // 9 orders in one place and 1 in another, far apart.
    const spread = replay({
      path: "/demos/spread.sdfz",
      orders: layer([
        [QUIET, 0, 9],
        [BUSY, 0, 1],
      ]),
    });
    const share = aggregateLayer([spread], "orders", WORLD, {
      normalise: "share",
      window: WHOLE,
    });
    const peak = aggregateLayer([spread], "orders", WORLD, {
      normalise: "peak",
      window: WHOLE,
    });
    expect(share.atPeak).toBeCloseTo(0.9, 5);
    expect(at(peak.field, QUIET)).toBeCloseTo(1, 5);
    expect(at(peak.field, BUSY)).toBeCloseTo(1 / 9, 5);
  });

  it("says what the brightest spot holds in the words of the mode", () => {
    const options = { normalise: "share", window: WHOLE } as const;
    const got = aggregateLayer([quiet(), busy()], "orders", WORLD, options);
    expect(layerLegend("orders", got, "share", WHOLE)).toBe(
      "on average 50% of a match's orders within 256 elmos of one spot, across 2 matches",
    );
    const rate = aggregateLayer([quiet(), busy()], "orders", WORLD, {
      normalise: "rate",
      window: WHOLE,
    });
    expect(layerLegend("orders", rate, "rate", WHOLE)).toBe(
      "on average 2.5 orders a minute within 256 elmos of one spot, across 2 matches",
    );
    const peak = aggregateLayer([quiet()], "orders", WORLD, {
      normalise: "peak",
      window: { kind: "first", minutes: 5 },
    });
    expect(
      layerLegend("orders", peak, "peak", { kind: "first", minutes: 5 }),
    ).toBe(
      "where the most matches were at their own busiest in the first 5 minutes, across 1 match. Each match is scaled to its busiest spot, so this is not a count",
    );
  });
});

describe("the window of match time", () => {
  it("covers each match on its own clock", () => {
    const ten = 10 * FRAMES_PER_SLICE;
    expect(windowSlices(WHOLE, ten)).toEqual({ lo: 0, hi: 10, minutes: 10 });
    expect(windowSlices({ kind: "first", minutes: 5 }, ten)).toEqual({
      lo: 0,
      hi: 4,
      minutes: 5,
    });
    // A match of ten and a half minutes: its last five whole slices.
    expect(
      windowSlices({ kind: "last", minutes: 5 }, ten + FRAMES_PER_SLICE / 2),
    ).toEqual({ lo: 6, hi: 10, minutes: 4.5 });
    expect(windowSlices({ kind: "range", from: 5, to: 8 }, ten)).toEqual({
      lo: 5,
      hi: 7,
      minutes: 3,
    });
  });

  it("misses a match that ended before it starts", () => {
    expect(
      windowSlices({ kind: "range", from: 30, to: 35 }, 20 * 1800),
    ).toBeNull();
  });

  it("keeps only the matches with something in the window, and counts them", () => {
    const first = aggregateLayer([quiet(), busy()], "orders", WORLD, {
      normalise: "share",
      window: { kind: "first", minutes: 5 },
    });
    // The busy match's orders are in its thirteenth minute.
    expect(first.available).toBe(2);
    expect(first.contributing).toBe(1);
    expect(first.events).toBe(10);
    expect(at(first.field, BUSY)).toBe(0);
    expect(at(first.field, QUIET)).toBeGreaterThan(0);

    const late = aggregateLayer([quiet(), busy()], "orders", WORLD, {
      normalise: "share",
      window: { kind: "range", from: 30, to: 35 },
    });
    expect(late.field).toBeNull();
    expect(late.contributing).toBe(0);
    expect(late.available).toBe(2);
  });
});

describe("how many matches are behind each layer", () => {
  const withBuildings = replay({
    path: "/demos/a.sdfz",
    gameType: "Some Game 1.0",
    // Definition 1 is a defence and 2 an economy building in this build.
    buildings: layer([
      [QUIET, 0, 4, 1],
      [BUSY, 0, 6, 2],
    ]),
    orders: layer([[QUIET, 0, 30]]),
    deaths: { layer: layer([[BUSY, 3, 5]]), unattacked: 1, noPosition: 2 },
  });
  const otherBuild = replay({
    path: "/demos/b.sdfz",
    gameType: "Some Game 2.0",
    // The same ids, which mean other units in this build.
    buildings: layer([[QUIET, 0, 8, 1]]),
    orders: layer([[QUIET, 0, 30]]),
  });
  const nothing = replay({ path: "/demos/c.sdfz" });
  const all = [withBuildings, otherBuild, nothing];
  const categories = (game: string) =>
    game === "Some Game 1.0"
      ? ([undefined, "defence", "economy"] as const)
      : undefined;
  const options = { normalise: "share", window: WHOLE, categories } as const;

  it("counts every match read for a stream layer, and the ones with data", () => {
    const orders = aggregateLayer(all, "orders", WORLD, options);
    expect([orders.available, orders.contributing]).toEqual([3, 2]);
    const buildings = aggregateLayer(all, "buildings", WORLD, options);
    expect([buildings.available, buildings.contributing]).toEqual([3, 2]);
  });

  it("counts only analysed matches for deaths", () => {
    const deaths = aggregateLayer(all, "deaths", WORLD, options);
    expect([deaths.available, deaths.contributing]).toEqual([1, 1]);
    expect(deaths.events).toBe(5);
    expect(withBuildings.deathsUnattacked).toBe(1);
    expect(withBuildings.deathsNoPosition).toBe(2);
  });

  it("has no deaths layer at all when no match is analysed", () => {
    const deaths = aggregateLayer(
      [otherBuild, nothing],
      "deaths",
      WORLD,
      options,
    );
    expect(deaths).toMatchObject({
      field: null,
      available: 0,
      contributing: 0,
    });
  });

  it("keeps one category, and only from a match whose build is installed", () => {
    const defence = aggregateLayer(all, "defence", WORLD, options);
    // The other build's id 1 is not known to be a defence, so it is left out
    // and counted, and so is the match with no game the table knows.
    expect(defence.unclassified).toBe(1);
    expect(defence.available).toBe(2);
    expect(defence.contributing).toBe(1);
    expect(defence.events).toBe(4);
    expect(at(defence.field, QUIET)).toBeGreaterThan(0);
    expect(at(defence.field, BUSY)).toBe(0);

    const economy = aggregateLayer(all, "economy", WORLD, options);
    expect(economy.events).toBe(6);
    expect(at(economy.field, QUIET)).toBe(0);
  });

  it("leaves every match out of a category layer when no build is installed", () => {
    const defence = aggregateLayer(all, "defence", WORLD, {
      normalise: "share",
      window: WHOLE,
      categories: () => undefined,
    });
    expect(defence).toMatchObject({
      field: null,
      available: 0,
      unclassified: 3,
    });
  });

  it("numbers a build's categories from one", () => {
    const table = defCategories([
      { mobile: false, buildOptions: [], stats: { weapons: [{}] } },
    ] as never);
    expect(table[0]).toBeUndefined();
    expect(table[1]).toBe("defence");
  });

  it("is empty with no matches", () => {
    const got = aggregateLayer([], "orders", WORLD, options);
    expect(got).toMatchObject({ field: null, available: 0, contributing: 0 });
    expect(layerLegend("orders", got, "share", WHOLE)).toBe("");
  });
});

// ---- which matches ----------------------------------------------------------

function record(over: Partial<StatRecord> & { filename: string }): StatRecord {
  return {
    path: `/demos/${over.filename}`,
    mapName: "Some Map 1.0",
    gameType: "Some Game 1.0",
    engineVersion: "2025.06.19",
    durationSec: 900,
    startTimeMs: new Date(2026, 5, 15, 12).getTime(),
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: true,
    winningAllyTeams: [0],
    remixed: false,
    players: [
      { name: "One", team: 0, allyTeam: 0, spectator: false },
      { name: "Two", team: 1, allyTeam: 1, spectator: false },
      { name: "Watcher", spectator: true },
    ],
    ais: [],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
    ...over,
  };
}

describe("which files are matches on the map", () => {
  const records = [
    record({ filename: "a.sdfz", gameId: "aa" }),
    record({ filename: "a.remix.sdfz", gameId: "aa", remixed: true }),
    record({ filename: "a.remix-2.sdfz", gameId: "aa", remixed: true }),
    record({ filename: "a-copy.sdfz", gameId: "aa" }),
    record({ filename: "b.sdfz", gameId: "bb" }),
    record({ filename: "c.sdfz" }),
    record({ filename: "d.sdfz" }),
    record({ filename: "other.sdfz", gameId: "cc", mapName: "Some Map 1.1" }),
  ];

  it("counts a match once, leaves remixes out, and does not merge map versions", () => {
    const got = mapMatches(records, "Some Map 1.0", new Map());
    // a-copy sorts before a, so it is the file that stands for match aa.
    expect(got.matches.map((m) => m.record.filename).sort()).toEqual([
      "a-copy.sdfz",
      "b.sdfz",
      "c.sdfz",
      "d.sdfz",
    ]);
    expect(got.remixes).toBe(2);
    expect(got.duplicates).toBe(1);
  });

  it("joins the stored analyses by game id", () => {
    const analyses = new Map([
      ["aa", { state: "current" as const }],
      ["bb", { state: "diverged" as const }],
    ]);
    const got = mapMatches(records, "Some Map 1.0", analyses);
    const by = Object.fromEntries(
      got.matches.map((m) => [m.record.filename, m.analysis]),
    );
    expect(by).toEqual({
      "a-copy.sdfz": "events",
      "b.sdfz": "diverged",
      "c.sdfz": "none",
      "d.sdfz": "none",
    });
  });

  it("counts players and AIs and not spectators", () => {
    const [m] = mapMatches(
      [
        record({
          filename: "a.sdfz",
          ais: [{ name: "AI 1", shortName: "Bot", team: 2, allyTeam: 1 }],
        }),
      ],
      "Some Map 1.0",
      new Map(),
    ).matches;
    expect(m.playerCount).toBe(3);
    expect(m.format).toBe("teams");
  });

  it("names the arrangement of sides", () => {
    const seats = (allies: number[]) =>
      record({
        filename: "x.sdfz",
        players: allies.map((allyTeam, team) => ({
          name: `P${team}`,
          team,
          allyTeam,
          spectator: false,
        })),
      });
    expect(matchFormat(seats([0, 1]))).toBe("duel");
    expect(matchFormat(seats([0, 0, 1, 1]))).toBe("teams");
    expect(matchFormat(seats([0, 1, 2]))).toBe("ffa");
    expect(matchFormat(seats([0, 0]))).toBe("other");
  });
});

describe("the filters", () => {
  const day = (d: number) => new Date(2026, 5, d, 12).getTime();
  const matches: AggregateMatch[] = mapMatches(
    [
      record({ filename: "duel.sdfz", gameId: "a1", startTimeMs: day(1) }),
      record({
        filename: "teams.sdfz",
        gameId: "a2",
        startTimeMs: day(10),
        gameType: "Some Game 2.0",
        players: [0, 0, 1, 1].map((allyTeam, team) => ({
          name: `P${team}`,
          team,
          allyTeam,
          spectator: false,
        })),
      }),
      record({
        filename: "short.sdfz",
        gameId: "a3",
        startTimeMs: day(20),
        durationSec: 12,
      }),
    ],
    "Some Map 1.0",
    new Map([["a2", { state: "current" as const }]]),
  ).matches;
  const names = (got: AggregateMatch[]) => got.map((m) => m.record.filename);

  it("leaves short matches out until asked", () => {
    expect(names(filterMatches(matches, NO_FILTERS))).toEqual([
      "duel.sdfz",
      "teams.sdfz",
    ]);
    expect(
      filterMatches(matches, { ...NO_FILTERS, includeShort: true }),
    ).toHaveLength(3);
  });

  it("keeps a player count", () => {
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, playerCount: 4 })),
    ).toEqual(["teams.sdfz"]);
  });

  it("keeps a game and version", () => {
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, game: "Some Game 1.0" })),
    ).toEqual(["duel.sdfz"]);
  });

  it("keeps an arrangement of sides", () => {
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, format: "duel" })),
    ).toEqual(["duel.sdfz"]);
  });

  it("keeps the analysed matches, or the ones that are not", () => {
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, analysed: "yes" })),
    ).toEqual(["teams.sdfz"]);
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, analysed: "no" })),
    ).toEqual(["duel.sdfz"]);
  });

  it("keeps a range of days, both ends included", () => {
    expect(
      names(
        filterMatches(matches, {
          ...NO_FILTERS,
          from: "2026-06-10",
          to: "2026-06-10",
        }),
      ),
    ).toEqual(["teams.sdfz"]);
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, to: "2026-06-09" })),
    ).toEqual(["duel.sdfz"]);
    expect(
      names(filterMatches(matches, { ...NO_FILTERS, from: "2026-06-02" })),
    ).toEqual(["teams.sdfz"]);
  });

  it("keeps the members of a set", () => {
    expect(
      names(filterMatches(matches, NO_FILTERS, new Set(["teams.sdfz"]))),
    ).toEqual(["teams.sdfz"]);
    expect(filterMatches(matches, NO_FILTERS, new Set())).toEqual([]);
  });

  it("offers what the matches hold", () => {
    expect(filterChoices(matches)).toEqual({
      playerCounts: [2, 4],
      games: ["Some Game 1.0", "Some Game 2.0"],
      formats: ["duel", "teams"],
      short: 1,
    });
  });
});

describe("start positions with their results", () => {
  it("gives every team's start the side it was on and whether that side won", () => {
    const matches = mapMatches(
      [
        record({ filename: "a.sdfz", gameId: "aa", winningAllyTeams: [1] }),
        record({ filename: "b.sdfz", gameId: "bb", winnersKnown: false }),
        record({ filename: "unread.sdfz", gameId: "cc" }),
      ],
      "Some Map 1.0",
      new Map(),
    ).matches;
    const starts = [
      { team: 0, x: 100, z: 200 },
      { team: 1, x: 7000, z: 6000 },
      // A team the record has no seat for.
      { team: 5, x: 1, z: 1 },
    ];
    const counts = new Map([
      ["/demos/a.sdfz", replay({ path: "/demos/a.sdfz", starts })],
      ["/demos/b.sdfz", replay({ path: "/demos/b.sdfz", starts: [starts[0]] })],
    ]);
    const got = aggregateStarts(matches, counts);
    expect(got).toEqual([
      {
        filename: "a.sdfz",
        gameId: "aa",
        team: 0,
        allyTeam: 0,
        x: 100,
        z: 200,
        won: false,
        playerCount: 2,
      },
      {
        filename: "a.sdfz",
        gameId: "aa",
        team: 1,
        allyTeam: 1,
        x: 7000,
        z: 6000,
        won: true,
        playerCount: 2,
      },
      {
        filename: "a.sdfz",
        gameId: "aa",
        team: 5,
        allyTeam: undefined,
        x: 1,
        z: 1,
        won: null,
        playerCount: 2,
      },
      {
        filename: "b.sdfz",
        gameId: "bb",
        team: 0,
        allyTeam: 0,
        x: 100,
        z: 200,
        won: null,
        playerCount: 2,
      },
    ]);
    expect(matchesWithStarts(got)).toBe(2);
  });
});
