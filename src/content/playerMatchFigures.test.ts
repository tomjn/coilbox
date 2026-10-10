import { describe, expect, it } from "vitest";
import type {
  Metric,
  MetricKey,
  MetricRatio,
  StatPlayer,
  StatRecord,
} from "./bindings";
import {
  formatRateValue,
  leftOutNote,
  median,
  playerRateGames,
  rateRows,
  ratioRows,
  trendSeries,
} from "./playerMatchFigures";

/** Made-up keys: `metricRegistry.test.ts` forbids real ones outside the bindings. */
function metric(key: string): Metric {
  return {
    key: key as MetricKey,
    label: key,
    group: "military",
    unit: "count",
    roster: true,
    headline: false,
    surfaced: true,
  };
}
const alpha = metric("alpha");
const beta = metric("beta");

function seat(name: string, team: number | undefined, won?: boolean) {
  return { name, team, spectator: false, won } as StatPlayer;
}

function game(over: Partial<StatRecord> & { filename: string }): StatRecord {
  return {
    path: over.filename,
    mapName: "M",
    gameType: "G",
    durationSec: 600,
    startTimeMs: 1000,
    winnersKnown: true,
    winningAllyTeams: [],
    remixed: false,
    ais: [],
    statsKnown: true,
    players: [seat("me", 0, true)],
    teamTotals: [{ team: 0, totals: { alpha: 1000 } }],
    ...over,
  } as StatRecord;
}

describe("playerRateGames", () => {
  it("divides the player's own team's total by the match's minutes", () => {
    const r = playerRateGames([game({ filename: "a" })], "me", [alpha]);
    expect(r.counted).toBe(1);
    expect(r.list[0].minutes).toBe(10);
    expect(r.list[0].rates.alpha).toBe(100);
  });

  it("keeps team 0 and a real zero", () => {
    const g = game({
      filename: "a",
      teamTotals: [{ team: 0, totals: { alpha: 0 } }],
    });
    const r = playerRateGames([g], "me", [alpha]);
    expect(r.counted).toBe(1);
    expect(r.list[0].rates.alpha).toBe(0);
  });

  it("leaves out and counts games with no team id, no totals or no length", () => {
    const r = playerRateGames(
      [
        game({ filename: "ok", startTimeMs: 1 }),
        game({
          filename: "noteam",
          players: [seat("me", undefined, true)],
        }),
        game({ filename: "unmeasured", statsKnown: false, teamTotals: [] }),
        game({ filename: "zero", durationSec: 0 }),
        game({ filename: "nan", durationSec: Number.NaN }),
      ],
      "me",
      [alpha],
    );
    expect(r.games).toBe(5);
    expect(r.counted).toBe(1);
    expect(r.leftOutNoTotals).toBe(2);
    expect(r.leftOutNoLength).toBe(2);
    expect(leftOutNote(r)).toContain("2 with no figures");
    expect(leftOutNote(r)).toContain("2 with no usable length");
    for (const g of r.list)
      for (const v of Object.values(g.rates))
        expect(Number.isFinite(v)).toBe(true);
  });

  it("ignores games the player was not in or only watched", () => {
    const watched = game({
      filename: "w",
      players: [{ name: "me", spectator: true } as StatPlayer, seat("x", 0)],
    });
    const absent = game({ filename: "x", players: [seat("x", 0)] });
    const r = playerRateGames([watched, absent], "me", [alpha]);
    expect(r.games).toBe(0);
    expect(leftOutNote(r)).toBeNull();
  });

  it("uses the same genuine match filter as the other counts", () => {
    const r = playerRateGames(
      [
        game({ filename: "real" }),
        game({ filename: "remix", remixed: true }),
        game({ filename: "again" }),
      ],
      "me",
      [alpha],
      new Set(["again"]),
    );
    expect(r.games).toBe(1);
    expect(r.list.map((g) => g.filename)).toEqual(["real"]);
  });

  it("gives every player sharing one engine team the whole total and says so", () => {
    const g = game({
      filename: "coop",
      players: [seat("me", 0, true), seat("pal", 0, true)],
    });
    const mine = playerRateGames([g], "me", [alpha]);
    const theirs = playerRateGames([g], "pal", [alpha]);
    expect(mine.list[0].rates.alpha).toBe(100);
    expect(theirs.list[0].rates.alpha).toBe(100);
    expect(mine.sharedTeamGames).toBe(1);
    const solo = playerRateGames([game({ filename: "s" })], "me", [alpha]);
    expect(solo.sharedTeamGames).toBe(0);
  });

  it("does not count allies on separate engine teams as sharing", () => {
    const g = game({
      filename: "allies",
      players: [
        { ...seat("me", 0, true), allyTeam: 0 },
        { ...seat("pal", 1, true), allyTeam: 0 },
      ],
      teamTotals: [
        { team: 0, totals: { alpha: 1000 } },
        { team: 1, totals: { alpha: 300 } },
      ],
    });
    const mine = playerRateGames([g], "me", [alpha]);
    const theirs = playerRateGames([g], "pal", [alpha]);
    expect(mine.list[0].rates.alpha).toBe(100);
    expect(theirs.list[0].rates.alpha).toBe(30);
    expect(mine.sharedTeamGames).toBe(0);
    expect(theirs.sharedTeamGames).toBe(0);
  });

  it("orders games by start time", () => {
    const r = playerRateGames(
      [
        game({ filename: "late", startTimeMs: 30 }),
        game({ filename: "early", startTimeMs: 10 }),
      ],
      "me",
      [alpha],
    );
    expect(r.list.map((g) => g.filename)).toEqual(["early", "late"]);
  });
});

describe("rateRows", () => {
  const games = playerRateGames(
    [
      game({
        filename: "w1",
        startTimeMs: 1,
        players: [seat("me", 0, true)],
        teamTotals: [{ team: 0, totals: { alpha: 1000, beta: 60 } }],
      }),
      game({
        filename: "w2",
        startTimeMs: 2,
        durationSec: 1200,
        players: [seat("me", 0, true)],
        teamTotals: [{ team: 0, totals: { alpha: 4000 } }],
      }),
      game({
        filename: "l1",
        startTimeMs: 3,
        players: [seat("me", 0, false)],
        teamTotals: [{ team: 0, totals: { alpha: 500, beta: 30 } }],
      }),
      game({
        filename: "none",
        startTimeMs: 4,
        winnersKnown: false,
        players: [seat("me", 0, undefined)],
        teamTotals: [{ team: 0, totals: { alpha: 2000 } }],
      }),
    ],
    "me",
    [alpha, beta],
  ).list;

  it("averages each game's own rate, not total over total minutes", () => {
    const [row] = rateRows(games, [alpha]);
    // Rates are 100, 200, 50 and 200 per minute.
    expect(row.all.mean).toBe(137.5);
    expect(row.all.median).toBe(150);
    expect(row.all.games).toBe(4);
  });

  it("splits by result and keeps an undecided game out of both", () => {
    const [row] = rateRows(games, [alpha]);
    expect(row.wins).toEqual({ games: 2, mean: 150, median: 150 });
    expect(row.losses).toEqual({ games: 1, mean: 50, median: 50 });
  });

  it("counts games per metric, so a missing figure is not a zero", () => {
    const [, row] = rateRows(games, [alpha, beta]);
    expect(row.all.games).toBe(2);
    expect(row.wins.games).toBe(1);
    expect(row.all.mean).toBe(4.5);
  });

  it("has no mean for no games", () => {
    const [row] = rateRows([], [alpha]);
    expect(row.all).toEqual({ games: 0, mean: null, median: null });
    expect(formatRateValue(row.all.mean)).toBe("—");
  });

  it("builds a date ordered trend with only the games that have the figure", () => {
    const t = trendSeries(games, "beta");
    expect(t.map((p) => p.filename)).toEqual(["w1", "l1"]);
    expect(t.map((p) => p.value)).toEqual([6, 3]);
    expect(t.map((p) => p.won)).toEqual([true, false]);
    expect(trendSeries(games, "alpha")).toHaveLength(4);
    expect(trendSeries([], "alpha")).toEqual([]);
  });
});

describe("median", () => {
  it("handles odd, even and no values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("ratios", () => {
  const ratio: MetricRatio = {
    key: "gamma",
    label: "Alpha per beta",
    numerator: "alpha" as MetricKey,
    denominator: "beta" as MetricKey,
  };
  const withTotals = (
    filename: string,
    startTimeMs: number,
    alphaTotal: number,
    betaTotal: number,
    won = true,
  ) =>
    game({
      filename,
      startTimeMs,
      players: [seat("me", 0, won)],
      teamTotals: [{ team: 0, totals: { alpha: alphaTotal, beta: betaTotal } }],
    });
  const rowsFor = (records: StatRecord[]) => {
    const data = playerRateGames(records, "me", [alpha, beta], new Set(), [
      ratio,
    ]);
    return { data, row: ratioRows(data.list, [ratio])[0] };
  };

  it("divides one figure by the other for each game and averages the games", () => {
    // The match's length does not enter into it: 10 over 5 and 30 over 10.
    const { data, row } = rowsFor([
      withTotals("a", 1, 10, 5),
      withTotals("b", 2, 30, 10),
    ]);
    expect(data.list.map((g) => g.ratios.gamma)).toEqual([2, 3]);
    expect(row.all.mean).toBe(2.5);
    expect(row.all.median).toBe(2.5);
    expect(row.all.games).toBe(2);
    expect(row.all.noDenominator).toBe(0);
  });

  it("is the mean of each game's ratio, not the ratio of the totals", () => {
    // 1 over 1 and 100 over 10: the mean is 5.5, the ratio of totals is 101 over 11.
    const { row } = rowsFor([
      withTotals("a", 1, 1, 1),
      withTotals("b", 2, 100, 10),
    ]);
    expect(row.all.mean).toBe(5.5);
    expect(row.all.mean).not.toBeCloseTo(101 / 11);
  });

  it("gives a game with nothing underneath no ratio, and counts it", () => {
    const { data, row } = rowsFor([
      withTotals("a", 1, 10, 5),
      withTotals("b", 2, 30, 0),
    ]);
    expect(data.list[1].ratios.gamma).toBeUndefined();
    expect(data.list[1].noDenominator).toEqual(["gamma"]);
    expect(row.all.games).toBe(1);
    expect(row.all.noDenominator).toBe(1);
    expect(row.all.mean).toBe(2);
    expect(Number.isFinite(row.all.mean)).toBe(true);
  });

  it("has no mean, and not a zero, when no game has anything underneath", () => {
    const { row } = rowsFor([
      withTotals("a", 1, 10, 0),
      withTotals("b", 2, 4, 0),
    ]);
    expect(row.all.mean).toBeNull();
    expect(row.all.median).toBeNull();
    expect(row.all.games).toBe(0);
    expect(row.all.noDenominator).toBe(2);
  });

  it("keeps a real zero on top as a ratio of zero", () => {
    const { row } = rowsFor([withTotals("a", 1, 0, 5)]);
    expect(row.all.mean).toBe(0);
    expect(row.all.games).toBe(1);
  });

  it("is not counted for a game that lacks either figure", () => {
    const g = game({
      filename: "a",
      teamTotals: [{ team: 0, totals: { alpha: 10 } }],
    });
    const { data, row } = rowsFor([g]);
    expect(data.list[0].ratios).toEqual({});
    expect(data.list[0].noDenominator).toEqual([]);
    expect(row.all.games).toBe(0);
    expect(row.all.noDenominator).toBe(0);
  });

  it("splits by result with each side counting its own games", () => {
    const { row } = rowsFor([
      withTotals("a", 1, 10, 5, true),
      withTotals("b", 2, 30, 0, false),
      withTotals("c", 3, 8, 2, false),
    ]);
    expect(row.wins.mean).toBe(2);
    expect(row.losses.mean).toBe(4);
    expect(row.losses.noDenominator).toBe(1);
    expect(row.wins.noDenominator).toBe(0);
  });

  it("goes on the trend by its own key, in date order", () => {
    const { data } = rowsFor([
      withTotals("b", 2, 30, 10),
      withTotals("a", 1, 10, 5),
    ]);
    expect(trendSeries(data.list, "gamma").map((p) => p.value)).toEqual([2, 3]);
  });

  it("changes nothing for a registry with no ratios", () => {
    const data = playerRateGames([withTotals("a", 1, 10, 5)], "me", [
      alpha,
      beta,
    ]);
    expect(data.list[0].ratios).toEqual({});
    expect(data.list[0].rates.alpha).toBe(1);
  });
});
