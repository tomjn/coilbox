import { describe, expect, it } from "vitest";
import type { DemoInfo, Metric, MetricKey } from "./bindings";
import type { ChartRow, ChartSeries } from "./matchStats";
import {
  csvNumber,
  csvText,
  matchStatsCsv,
  matchStatsCsvFileName,
} from "./matchStatsCsv";

/** A made-up key: `metricRegistry.test.ts` forbids a real one outside the bindings. */
const metric = {
  key: "someMetric" as MetricKey,
  label: "Some metric",
  group: "economy",
  unit: "metal",
  roster: true,
  headline: true,
  surfaced: true,
} as Metric;

const info = {
  gameId: "0123abcd",
  mapName: "Tabula 2.1",
  // 2026-10-10T12:34:56Z
  startTimeMs: Date.UTC(2026, 9, 10, 12, 34, 56),
} as DemoInfo;

const line = (id: string, label: string): ChartSeries => ({
  id,
  label,
  color: "#ffffff",
  samples: [],
});

describe("csvText", () => {
  it("leaves plain text alone", () => {
    expect(csvText("Alice")).toBe("Alice");
  });

  it("quotes a field with a comma", () => {
    expect(csvText("Smith, J")).toBe('"Smith, J"');
  });

  it("doubles a quote inside a quoted field", () => {
    expect(csvText('The "Real" Bob')).toBe('"The ""Real"" Bob"');
  });

  it("quotes a field with a newline of either kind", () => {
    expect(csvText("a\nb")).toBe('"a\nb"');
    expect(csvText("a\r\nb")).toBe('"a\r\nb"');
  });

  it("prefixes a quote to text a spreadsheet would run as a formula", () => {
    expect(csvText("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvText("+1")).toBe("'+1");
    expect(csvText("-bob")).toBe("'-bob");
    expect(csvText("@cmd")).toBe("'@cmd");
    expect(csvText("\tx")).toBe("'\tx");
  });

  it("neutralises first, then quotes, so both rules apply to one name", () => {
    expect(csvText('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it("leaves a sign that is not first", () => {
    expect(csvText("a-b=c")).toBe("a-b=c");
  });
});

describe("csvNumber", () => {
  it("keeps a leading minus, because it is the number", () => {
    expect(csvNumber(-12.5)).toBe("-12.5");
  });

  it("writes a dot decimal with no separators and every digit", () => {
    expect(csvNumber(1234567.891234)).toBe("1234567.891234");
  });

  it("writes zero as 0, including negative zero", () => {
    expect(csvNumber(0)).toBe("0");
    expect(csvNumber(-0)).toBe("0");
  });

  it("leaves a missing reading empty rather than zero", () => {
    expect(csvNumber(null)).toBe("");
    expect(csvNumber(undefined)).toBe("");
    expect(csvNumber(Number.NaN)).toBe("");
    expect(csvNumber(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("matchStatsCsv", () => {
  const series = [line("team0", "Alice"), line("team1", 'Bob, the "Builder"')];
  const rows: ChartRow[] = [
    { timeSec: 0, team0: 0, team1: null },
    { timeSec: 30.5, team0: 1500.123456, team1: -3 },
  ];
  const out = matchStatsCsv({
    info,
    metric,
    mode: "cumulative",
    view: "players",
    series,
    rows,
  });
  const lines = out.split("\r\n");

  it("has a column only for the lines it is given, so a line unchecked in the roster is not in the file", () => {
    // The chart hands over the lines it draws, and rows still carry every line.
    const drawn = matchStatsCsv({
      info,
      metric,
      mode: "cumulative",
      view: "players",
      series: [series[1]],
      rows,
    }).split("\r\n");
    expect(
      drawn[0].startsWith('match_time_sec,"Bob, the ""Builder""",game_id'),
    ).toBe(true);
    expect(drawn[1].startsWith("0,,0123abcd")).toBe(true);
    expect(drawn.join("")).not.toContain("Alice");
  });

  it("has a header, one row per sample, and ends with a line break", () => {
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe("");
  });

  it("puts match time in seconds first, then a column per line, then provenance", () => {
    expect(lines[0]).toBe(
      'match_time_sec,Alice,"Bob, the ""Builder""",game_id,map,started_utc,metric,unit,view,values',
    );
  });

  it("writes the figures at full precision and the provenance on every row", () => {
    expect(lines[1]).toBe(
      "0,0,,0123abcd,Tabula 2.1,2026-10-10T12:34:56.000Z,Some metric,metal,players,cumulative",
    );
    expect(lines[2]).toBe(
      "30.5,1500.123456,-3,0123abcd,Tabula 2.1,2026-10-10T12:34:56.000Z,Some metric,metal,players,cumulative",
    );
  });

  it("names the view and the value mode on screen", () => {
    const teams = matchStatsCsv({
      info,
      metric,
      mode: "perMinute",
      view: "teams",
      series,
      rows,
    });
    expect(teams.split("\r\n")[1]).toContain(",teams,per minute");
  });

  it("leaves the game id empty when the replay has none", () => {
    const bare = matchStatsCsv({
      info: { ...info, gameId: undefined },
      metric,
      mode: "cumulative",
      view: "players",
      series,
      rows,
    });
    expect(bare.split("\r\n")[1]).toContain(",,Tabula 2.1,");
  });

  it("guards a player name that opens like a formula", () => {
    const risky = matchStatsCsv({
      info,
      metric,
      mode: "cumulative",
      view: "players",
      series: [line("team0", "=cmd()")],
      rows: [{ timeSec: 1, team0: -5 }],
    });
    const [head, row] = risky.split("\r\n");
    expect(head.startsWith("match_time_sec,'=cmd(),")).toBe(true);
    expect(row.startsWith("1,-5,")).toBe(true);
  });
});

describe("matchStatsCsvFileName", () => {
  it("is built from the map, the date and the metric", () => {
    expect(matchStatsCsvFileName(info, metric)).toBe(
      "tabula-2-1-2026-10-10-some-metric.csv",
    );
  });

  it("leaves nothing a file system refuses", () => {
    const awkward = { ...info, mapName: 'A/B:C*D?"E<F>G|H\\I' } as DemoInfo;
    expect(matchStatsCsvFileName(awkward, metric)).toMatch(/^[a-z0-9-]+\.csv$/);
  });

  it("drops a part that slugs to nothing and a date the file lacks", () => {
    const odd = { ...info, mapName: "地図", startTimeMs: 0 } as DemoInfo;
    expect(matchStatsCsvFileName(odd, metric)).toBe("some-metric.csv");
  });
});
