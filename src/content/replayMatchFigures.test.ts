import { describe, expect, it } from "vitest";
import type { Metric, MetricKey, StatRecord } from "./bindings";
import {
  columnMetrics,
  compareFigures,
  figureBasis,
  formatFigure,
  isOverMinimum,
  libraryMetrics,
  MIN_LENGTH_OPTIONS,
  matchFigure,
  metricSortValue,
  parseMetricSort,
} from "./replayMatchFigures";

/**
 * The keys here are made up on purpose. `metricRegistry.test.ts` forbids a real
 * metric key anywhere outside the bindings, and nothing in the module under test
 * should care which metric it is holding.
 */
const key = (k: string) => k as MetricKey;

function metric(over: Partial<Omit<Metric, "key">> & { key: string }): Metric {
  return {
    label: over.key,
    group: "military",
    unit: "count",
    roster: true,
    headline: false,
    surfaced: true,
    ...over,
    key: key(over.key),
  };
}

function record(over: Partial<StatRecord>): StatRecord {
  return {
    statsKnown: true,
    teamTotals: [],
    ...over,
  } as StatRecord;
}

const teams = (...values: number[]) =>
  values.map((v, team) => ({ team, totals: { alpha: v } }));

describe("matchFigure", () => {
  const fight = metric({ key: "alpha", unit: "damage" });
  const economy = metric({ key: "alpha", unit: "metal" });

  it("sums every team for a fight metric", () => {
    const r = record({ teamTotals: teams(100, 250) });
    expect(matchFigure(r, fight)).toBe(350);
    expect(figureBasis(fight)).toBe("match total");
  });

  it("takes the best team for an economy metric", () => {
    const r = record({ teamTotals: teams(100, 250) });
    expect(matchFigure(r, economy)).toBe(250);
    expect(figureBasis(economy)).toBe("best team");
  });

  it("is unknown, not zero, for a replay that measured nothing", () => {
    expect(matchFigure(undefined, fight)).toBeUndefined();
    expect(
      matchFigure(record({ statsKnown: false, teamTotals: [] }), fight),
    ).toBeUndefined();
    expect(matchFigure(record({ teamTotals: [] }), fight)).toBeUndefined();
  });

  it("is a real zero when the teams measured zero", () => {
    expect(matchFigure(record({ teamTotals: teams(0, 0) }), fight)).toBe(0);
  });

  it("is unknown when no team has this metric", () => {
    const other = metric({ key: "beta", unit: "damage" });
    expect(
      matchFigure(record({ teamTotals: teams(5) }), other),
    ).toBeUndefined();
  });
});

describe("matchFigure for a named player", () => {
  const fight = metric({ key: "alpha", unit: "damage" });
  const economy = metric({ key: "alpha", unit: "metal" });
  const seat = (name: string, team?: number, spectator = false) => ({
    name,
    team,
    spectator,
  });
  const played = (...players: ReturnType<typeof seat>[]) =>
    record({
      teamTotals: teams(100, 250),
      players: players as unknown as StatRecord["players"],
    });

  it("is the player's own army, whatever the metric counts", () => {
    const r = played(seat("Ann", 0), seat("Ben", 1));
    expect(matchFigure(r, fight, "Ann")).toBe(100);
    expect(matchFigure(r, economy, "Ann")).toBe(100);
    expect(matchFigure(r, fight, "Ben")).toBe(250);
    expect(figureBasis(fight, "Ann")).toBe("Ann's own total");
  });

  it("treats team 0 as a team", () => {
    const r = played(seat("Ann", 0));
    expect(matchFigure(r, fight, "Ann")).toBe(100);
  });

  it("is unknown when the player was not in the match", () => {
    const r = played(seat("Ben", 1));
    expect(matchFigure(r, fight, "Ann")).toBeUndefined();
  });

  it("is unknown for a player who only watched", () => {
    const r = played(seat("Ann", 0, true));
    expect(matchFigure(r, fight, "Ann")).toBeUndefined();
  });

  it("is unknown, never team 0, when an old record has no team id", () => {
    const r = played(seat("Ann"), seat("Ben", 1));
    expect(matchFigure(r, fight, "Ann")).toBeUndefined();
  });

  it("is unknown when the team has no figure for the metric", () => {
    const r = record({
      teamTotals: [{ team: 1, totals: { alpha: 5 } }],
      players: [seat("Ann", 0)] as unknown as StatRecord["players"],
    });
    expect(matchFigure(r, fight, "Ann")).toBeUndefined();
  });

  it("is unknown for a replay that measured nothing, and for no record", () => {
    const r = record({
      statsKnown: false,
      teamTotals: [],
      players: [seat("Ann", 0)] as unknown as StatRecord["players"],
    });
    expect(matchFigure(r, fight, "Ann")).toBeUndefined();
    expect(matchFigure(undefined, fight, "Ann")).toBeUndefined();
  });

  it("is a real zero when the player's team measured zero", () => {
    const r = record({
      teamTotals: teams(0, 9),
      players: [seat("Ann", 0)] as unknown as StatRecord["players"],
    });
    expect(matchFigure(r, fight, "Ann")).toBe(0);
  });

  it("sorts rows with no figure for the player last, in both directions", () => {
    const rows = {
      mid: played(seat("Ann", 0)),
      high: record({
        teamTotals: teams(500),
        players: [seat("Ann", 0)] as unknown as StatRecord["players"],
      }),
      away: played(seat("Ben", 1)),
      old: played(seat("Ann")),
      none: record({ statsKnown: false, players: [seat("Ann", 0)] as never }),
    };
    const order = (dir: "asc" | "desc") =>
      Object.entries(rows)
        .sort(([, a], [, b]) =>
          compareFigures(
            matchFigure(a, fight, "Ann"),
            matchFigure(b, fight, "Ann"),
            dir,
          ),
        )
        .map(([name]) => name);
    expect(order("desc").slice(0, 2)).toEqual(["high", "mid"]);
    expect(order("asc").slice(0, 2)).toEqual(["mid", "high"]);
    for (const dir of ["asc", "desc"] as const) {
      expect(order(dir).slice(2).sort()).toEqual(["away", "none", "old"]);
    }
  });
});

describe("formatFigure", () => {
  it("leaves an unknown figure as a dash and formats a known one", () => {
    expect(formatFigure(undefined)).toBe("—");
    expect(formatFigure(0)).toBe("0");
    expect(formatFigure(1_500_000)).toBe("1.5M");
  });
});

describe("compareFigures", () => {
  const order = (values: (number | undefined)[], dir: "asc" | "desc") =>
    [...values].sort((a, b) => compareFigures(a, b, dir));

  it("sorts known figures in the direction asked", () => {
    expect(order([3, 1, 2], "desc")).toEqual([3, 2, 1]);
    expect(order([3, 1, 2], "asc")).toEqual([1, 2, 3]);
  });

  it("puts unknown figures last in either direction", () => {
    expect(order([undefined, 1, 3], "desc")).toEqual([3, 1, undefined]);
    expect(order([undefined, 1, 3], "asc")).toEqual([1, 3, undefined]);
  });

  it("keeps a real zero ahead of an unknown", () => {
    expect(order([undefined, 0, 5], "asc")).toEqual([0, 5, undefined]);
  });
});

describe("metric sort values", () => {
  it("round trips", () => {
    expect(parseMetricSort(metricSortValue("alpha", "asc"))).toEqual({
      key: "alpha",
      dir: "asc",
    });
  });

  it("rejects anything that is not a metric sort", () => {
    expect(parseMetricSort("date-desc")).toBeNull();
    expect(parseMetricSort("metric:alpha:sideways")).toBeNull();
    expect(parseMetricSort("metric::desc")).toBeNull();
  });
});

describe("which metrics a row offers", () => {
  const metrics = [
    metric({ key: "a", headline: true }),
    metric({ key: "b" }),
    metric({ key: "c", roster: false }),
    metric({ key: "d", surfaced: false }),
  ];

  it("offers only surfaced roster metrics, since those are what the store keeps", () => {
    expect(libraryMetrics(metrics).map((m) => m.key)).toEqual(["a", "b"]);
  });

  it("shows the headline metrics plus the one sorted by", () => {
    expect(columnMetrics(metrics, undefined).map((m) => m.key)).toEqual(["a"]);
    expect(columnMetrics(metrics, "b").map((m) => m.key)).toEqual(["a", "b"]);
    expect(columnMetrics(metrics, "c").map((m) => m.key)).toEqual(["a"]);
  });
});

describe("MIN_LENGTH_OPTIONS", () => {
  it("offers no minimum, then each shared length boundary", () => {
    expect(MIN_LENGTH_OPTIONS).toEqual([
      { value: "0", label: "Any length" },
      { value: "1800", label: "Over 30 minutes" },
      { value: "3600", label: "Over 1 hour" },
      { value: "7200", label: "Over 2 hours" },
    ]);
  });
});

describe("isOverMinimum", () => {
  it("passes everything with no minimum", () => {
    expect(isOverMinimum(undefined, 0)).toBe(true);
    expect(isOverMinimum(10, 0)).toBe(true);
  });

  it("needs a known length strictly over the minimum", () => {
    expect(isOverMinimum(3601, 3600)).toBe(true);
    expect(isOverMinimum(3600, 3600)).toBe(false);
    expect(isOverMinimum(undefined, 3600)).toBe(false);
  });
});
