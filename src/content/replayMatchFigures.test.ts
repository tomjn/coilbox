import { describe, expect, it } from "vitest";
import type { Metric, MetricKey, StatRecord } from "./bindings";
import {
  columnMetrics,
  compareFigures,
  figureBasis,
  formatFigure,
  isOverMinimum,
  libraryMetrics,
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
