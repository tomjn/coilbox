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

describe("matchStatsCsv column names", () => {
  const csv = (series: ChartSeries[], allSeries?: ChartSeries[], i = info) =>
    matchStatsCsv({
      info: i,
      metric,
      mode: "cumulative",
      view: "players",
      series,
      allSeries,
      rows: [],
    }).split("\r\n")[0];
  const firstColumns = (header: string, n: number) =>
    header.split(",").slice(1, 1 + n);

  it("adds the team number to two players with one name", () => {
    const head = csv([line("team0", "Bob"), line("team3", "Bob")]);
    expect(firstColumns(head, 2)).toEqual(["Bob (team 0)", "Bob (team 3)"]);
  });

  it("adds the team number to all three players with one name", () => {
    const head = csv([
      line("team0", "Bob"),
      line("team1", "Bob"),
      line("team2", "Bob"),
    ]);
    expect(firstColumns(head, 3)).toEqual([
      "Bob (team 0)",
      "Bob (team 1)",
      "Bob (team 2)",
    ]);
  });

  it("leaves a name that does not collide as it was", () => {
    const head = csv([
      line("team0", "Bob"),
      line("team1", "Bob"),
      line("team2", "Alice"),
    ]);
    expect(firstColumns(head, 3)[2]).toBe("Alice");
  });

  it("renames a player named like a fixed column", () => {
    const head = csv([
      line("team0", "map"),
      line("team1", "match_time_sec"),
      line("team2", "game_id"),
    ]);
    expect(firstColumns(head, 3)).toEqual([
      "map (team 0)",
      "match_time_sec (team 1)",
      "game_id (team 2)",
    ]);
    const names = head.split(",");
    expect(new Set(names).size).toBe(names.length);
  });

  it("still quotes and guards the final header text", () => {
    const head = csv([line("team0", "=x"), line("team1", "=x")]);
    expect(firstColumns(head, 2)).toEqual(["'=x (team 0)", "'=x (team 1)"]);
    const comma = csv([line("team0", "a,b"), line("team1", "a,b")]);
    expect(
      comma.startsWith('match_time_sec,"a,b (team 0)","a,b (team 1)"'),
    ).toBe(true);
  });

  it("gives a player the same header whether or not a namesake is unchecked", () => {
    const bob0 = line("team0", "Bob");
    const bob1 = line("team1", "Bob");
    const both = csv([bob0, bob1], [bob0, bob1]);
    const onlyFirst = csv([bob0], [bob0, bob1]);
    const onlySecond = csv([bob1], [bob0, bob1]);
    expect(firstColumns(onlyFirst, 1)).toEqual(["Bob (team 0)"]);
    expect(firstColumns(onlySecond, 1)).toEqual(["Bob (team 1)"]);
    expect(firstColumns(both, 2)).toEqual(["Bob (team 0)", "Bob (team 1)"]);
  });

  it("lists the member teams of a side's line", () => {
    const sides = {
      ...info,
      players: [
        { name: "A", team: 1, allyTeam: 0 },
        { name: "B", team: 4, allyTeam: 0 },
        { name: "C", team: 2, allyTeam: 1 },
      ],
      ais: [],
    } as unknown as DemoInfo;
    const head = csv(
      [line("ally0", "Red"), line("ally1", "Red")],
      undefined,
      sides,
    );
    // The comma in the first name makes it a quoted field.
    expect(
      head.startsWith('match_time_sec,"Red (teams 1, 4)",Red (team 2),'),
    ).toBe(true);
  });

  it("writes a file with no collisions as it was before", () => {
    expect(
      csv([line("team0", "Alice"), line("team1", 'Bob, the "Builder"')]),
    ).toBe(
      'match_time_sec,Alice,"Bob, the ""Builder""",game_id,map,started_utc,metric,unit,view,values',
    );
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
