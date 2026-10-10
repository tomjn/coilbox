import { describe, expect, it } from "vitest";
import type { Metric, MetricKey, StatPlayer, StatRecord } from "./bindings";
import {
  formatRateValue,
  leftOutNote,
  median,
  playerRateGames,
  rateRows,
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
    expect(leftOutNote(r)).toContain("2 with no team totals");
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

  it("gives every player on a shared team the whole total and says so", () => {
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
