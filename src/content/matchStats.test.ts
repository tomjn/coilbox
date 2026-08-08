import { describe, expect, it } from "vitest";
import { PALETTE, rgbToHex } from "@/play/participants";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricGroup,
  MetricKey,
  ReplayPlayer,
  TeamStatSample,
} from "./bindings";
import {
  allySeries,
  type ChartSeries,
  chartRows,
  defaultChartView,
  defaultMetric,
  END_LABEL_MAX_SERIES,
  endPoints,
  formatChartValue,
  formatDuration,
  formatRate,
  formatTotal,
  hasStatistics,
  headlineTotals,
  lastPointIndex,
  matchTotal,
  metricGroups,
  PLAYERS_VIEW_MAX_SERIES,
  perMinuteRows,
  resultLabel,
  seatCount,
  secondsPerFrame,
  spreadLabels,
  TOOLTIP_ROW_LIMIT,
  teamSeries,
  teamTotal,
  tooltipRows,
} from "./matchStats";

/**
 * No metric is named here either. `metricRegistry.test.ts` forbids it, and the
 * point of the section is that it works for whatever the registry publishes, so
 * these take their keys from the sample type instead of spelling two of them out.
 */

function sample(frame: number): TeamStatSample {
  return {
    frame,
    metalUsed: 0,
    energyUsed: 0,
    metalProduced: 0,
    energyProduced: 0,
    metalExcess: 0,
    energyExcess: 0,
    metalReceived: 0,
    energyReceived: 0,
    metalSent: 0,
    energySent: 0,
    damageDealt: 0,
    damageReceived: 0,
    unitsProduced: 0,
    unitsDied: 0,
    unitsReceived: 0,
    unitsSent: 0,
    unitsCaptured: 0,
    unitsOutCaptured: 0,
    unitsKilled: 0,
  };
}

/** Every metric key, in the order the samples declare them. `frame` is the x axis. */
const KEYS = Object.keys(sample(0)).filter((k) => k !== "frame") as MetricKey[];
const [KEY_A, KEY_B] = KEYS;

/** A sample carrying one figure, so a total can be traced back to a sample. */
function at(frame: number, key: MetricKey, value: number): TeamStatSample {
  const s = sample(frame);
  s[key] = value;
  return s;
}

function trailer(teams: TeamStatSample[][], periodSec = 15): DemoTrailer {
  return {
    winningAllyTeams: [],
    teamStatPeriodSec: periodSec,
    teams: teams.map((samples, team) => ({ team, samples })),
  };
}

function metric(
  key: MetricKey,
  label: string,
  headline: boolean,
  group: MetricGroup = "military",
): Metric {
  return {
    key,
    label,
    group,
    unit: "count",
    roster: true,
    headline,
    surfaced: true,
  };
}

function player(name: string, spectator: boolean): ReplayPlayer {
  return { name, spectator };
}

function info(over: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "105",
    startTimeMs: 0,
    durationSec: 600,
    wallclockSec: 600,
    mapName: "Comet Catcher Remake",
    gameType: "Beyond All Reason test",
    winningAllyTeams: [],
    winnersKnown: false,
    numAllyTeams: 2,
    allyTeams: [],
    players: [],
    ais: [],
    modOptions: {},
    ...over,
  };
}

describe("formatDuration", () => {
  it("counts minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("grows an hours field rather than counting to 90 minutes", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});

describe("resultLabel", () => {
  it("says the winner is unknown rather than calling it a draw", () => {
    expect(resultLabel(info({ winnersKnown: false }))).toBe("Unknown");
  });

  it("reports a game over that nobody won", () => {
    expect(resultLabel(info({ winnersKnown: true }))).toBe("Nobody won");
  });

  it("names every winning ally team", () => {
    const decided = info({ winnersKnown: true, winningAllyTeams: [0, 2] });
    expect(resultLabel(decided)).toBe("Ally 0, Ally 2 won");
  });
});

describe("seatCount", () => {
  it("counts the bots and leaves the spectators out", () => {
    const match = info({
      players: [player("a", false), player("b", false), player("cast", true)],
      ais: [{ name: "AI 1", shortName: "BARb" }],
    });
    expect(seatCount(match)).toBe(3);
  });
});

describe("hasStatistics", () => {
  it("is false when the engine measured nothing", () => {
    expect(hasStatistics(trailer([[], [], []]))).toBe(false);
  });

  it("is true as soon as one team has a sample", () => {
    expect(hasStatistics(trailer([[], [sample(30)]]))).toBe(true);
  });
});

describe("a match total", () => {
  it("is the last sample, because every field is a running total", () => {
    const series = [at(0, KEY_A, 10), at(450, KEY_A, 40), at(900, KEY_A, 90)];
    expect(teamTotal(series, KEY_A)).toBe(90);
  });

  it("is zero for a team the engine recorded nothing for", () => {
    expect(teamTotal([], KEY_A)).toBe(0);
  });

  it("adds up the teams", () => {
    const t = trailer([
      [at(0, KEY_A, 5), at(450, KEY_A, 30)],
      [at(0, KEY_A, 1), at(450, KEY_A, 12)],
      [],
    ]);
    expect(matchTotal(t, KEY_A)).toBe(42);
  });
});

describe("formatTotal", () => {
  it("leaves a figure small enough to read", () => {
    expect(formatTotal(0)).toBe("0");
    expect(formatTotal(512)).toBe("512");
    expect(formatTotal(9999.4)).toBe("9,999");
  });

  it("shortens thousands and millions", () => {
    expect(formatTotal(12_345)).toBe("12.3k");
    expect(formatTotal(150_000)).toBe("150k");
    expect(formatTotal(1_234_567)).toBe("1.2M");
  });

  it("drops a trailing zero decimal", () => {
    expect(formatTotal(12_000_000)).toBe("12M");
  });
});

describe("headlineTotals", () => {
  const t = trailer([
    [at(0, KEY_A, 2), at(450, KEY_A, 2_000_000)],
    [at(0, KEY_B, 3), at(450, KEY_B, 40)],
  ]);
  const registry = [
    metric(KEY_A, "Alpha", true),
    metric(KEYS[2], "Gamma", false),
    metric(KEY_B, "Beta", true),
  ];

  it("takes the tiles from the registry's flag, in registry order", () => {
    expect(headlineTotals(t, registry).map((h) => h.metric.label)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("totals each one across the teams", () => {
    const tiles = headlineTotals(t, registry);
    expect(tiles.map((h) => h.value)).toEqual([2_000_000, 40]);
    expect(tiles.map((h) => h.text)).toEqual(["2M", "40"]);
  });

  it("skips a metric the registry publishes but hides", () => {
    const hidden = [{ ...metric(KEY_A, "Alpha", true), surfaced: false }];
    expect(headlineTotals(t, hidden)).toEqual([]);
  });
});

describe("metricGroups", () => {
  // Deliberately not in alphabetical order: the real registry's groups happen to
  // come out economy, military, units either way, so a fixture in that order
  // can't tell "registry order" from "sorted".
  const registry = [
    metric(KEY_A, "Alpha", false, "units"),
    metric(KEY_B, "Beta", true, "economy"),
    metric(KEYS[2], "Gamma", false, "units"),
    metric(KEYS[3], "Delta", false, "military"),
  ];

  it("orders groups by where the registry first mentions them", () => {
    expect(metricGroups(registry).map((g) => g.group)).toEqual([
      "units",
      "economy",
      "military",
    ]);
  });

  it("keeps registry order inside a group", () => {
    const units = metricGroups(registry)[0];
    expect(units.metrics.map((m) => m.label)).toEqual(["Alpha", "Gamma"]);
  });

  it("gives every group a heading", () => {
    expect(metricGroups(registry).map((g) => g.label)).toEqual([
      "Units",
      "Economy",
      "Military",
    ]);
  });

  it("leaves out a metric the registry hides", () => {
    const hidden = registry.map((m) =>
      m.group === "economy" ? { ...m, surfaced: false } : m,
    );
    expect(metricGroups(hidden).map((g) => g.group)).toEqual([
      "units",
      "military",
    ]);
  });
});

describe("defaultMetric", () => {
  it("opens on the first headline, which the tiles already lead with", () => {
    const registry = [
      metric(KEY_A, "Alpha", false),
      metric(KEY_B, "Beta", true),
      metric(KEYS[2], "Gamma", true),
    ];
    expect(defaultMetric(registry)?.label).toBe("Beta");
  });

  it("falls back to the first offered metric when none is a headline", () => {
    expect(defaultMetric([metric(KEY_A, "Alpha", false)])?.label).toBe("Alpha");
  });

  it("skips a hidden metric even when it is the only headline", () => {
    const registry = [
      { ...metric(KEY_A, "Alpha", true), surfaced: false },
      metric(KEY_B, "Beta", false),
    ];
    expect(defaultMetric(registry)?.label).toBe("Beta");
  });

  it("is undefined when the registry offers nothing", () => {
    expect(defaultMetric([])).toBeUndefined();
  });
});

describe("teamSeries", () => {
  const measured = trailer([
    [at(0, KEY_A, 1), at(450, KEY_A, 5)],
    [],
    [at(0, KEY_A, 2), at(450, KEY_A, 9)],
  ]);

  it("leaves out a team the engine measured nothing for", () => {
    expect(teamSeries(measured, info()).map((s) => s.id)).toEqual([
      "team0",
      "team2",
    ]);
  });

  it("names a line after the seat that held the team", () => {
    const match = info({
      players: [{ name: "sprung", spectator: false, team: 0 }],
      ais: [{ name: "AI 1", shortName: "BARb", team: 2 }],
    });
    expect(teamSeries(measured, match).map((s) => s.label)).toEqual([
      "sprung",
      "BARb",
    ]);
  });

  it("says how many other seats share a line under shared control", () => {
    const match = info({
      players: [
        { name: "sprung", spectator: false, team: 0 },
        { name: "mate", spectator: false, team: 0 },
      ],
    });
    expect(teamSeries(measured, match)[0].label).toBe("sprung +1");
  });

  it("ignores a spectator, who held no team", () => {
    const match = info({
      players: [
        { name: "cast", spectator: true, team: 0 },
        { name: "sprung", spectator: false, team: 0 },
      ],
    });
    expect(teamSeries(measured, match)[0].label).toBe("sprung");
  });

  it("falls back to the team number when nobody is recorded on it", () => {
    expect(teamSeries(measured, info())[1].label).toBe("Team 2");
  });

  it("takes the line's colour from the seat", () => {
    const match = info({
      players: [
        { name: "sprung", spectator: false, team: 0, rgbColor: [1, 0, 0] },
      ],
    });
    expect(teamSeries(measured, match)[0].color).toBe("#ff0000");
  });

  it("replaces a team recorded as black, which is nobody's choice", () => {
    const match = info({
      players: [
        { name: "sprung", spectator: false, team: 0, rgbColor: [0, 0, 0] },
      ],
    });
    expect(teamSeries(measured, match)[0].color).toBe(rgbToHex(PALETTE[0]));
  });

  it("gives a team with no recorded colour a palette one", () => {
    const colors = teamSeries(measured, info()).map((s) => s.color);
    expect(colors).toEqual([rgbToHex(PALETTE[0]), rgbToHex(PALETTE[2])]);
  });
});

describe("allySeries", () => {
  /**
   * A 2v2 with the sides interleaved through the team numbering, and every team
   * on a different power of two, so no wrong grouping can add up to a right
   * answer and a fixture in team order can't pass by accident.
   */
  const twoOnTwo = trailer([
    [at(0, KEY_A, 1), at(450, KEY_A, 10)],
    [at(0, KEY_A, 2), at(450, KEY_A, 20)],
    [at(0, KEY_A, 4), at(450, KEY_A, 40)],
    [at(0, KEY_A, 8), at(450, KEY_A, 80)],
  ]);

  /** Teams 0 and 2 against teams 1 and 3. */
  const fourSeats = (over: Partial<DemoInfo> = {}) =>
    info({
      players: [
        { name: "a", spectator: false, team: 0, allyTeam: 0 },
        { name: "b", spectator: false, team: 1, allyTeam: 1 },
        { name: "c", spectator: false, team: 2, allyTeam: 0 },
        { name: "d", spectator: false, team: 3, allyTeam: 1 },
      ],
      ...over,
    });

  /** Two measured teams, for the cases about one side or one seat. */
  const pair = trailer([[at(0, KEY_A, 3)], [at(0, KEY_A, 5)]]);

  /** Both of `pair`'s teams on the same side. */
  const oneSide = info({
    players: [
      { name: "a", spectator: false, team: 0, allyTeam: 0 },
      { name: "b", spectator: false, team: 1, allyTeam: 0 },
    ],
  });

  it("adds up the teams on a side, and only those", () => {
    const sides = allySeries(twoOnTwo, fourSeats());
    expect(sides.map((s) => s.id)).toEqual(["ally0", "ally1"]);
    expect(sides.map((s) => s.samples.map((p) => p[KEY_A]))).toEqual([
      [5, 50],
      [10, 100],
    ]);
  });

  it("adds up a real match the way a person does with a calculator", () => {
    // Greenhaven, read out of the decoder: teams 0 and 1 were one side, and
    // these are their figures at four of the frames the engine sampled. The
    // expected column was added up by hand from the same two lists.
    const real = trailer([
      [
        at(1800, KEY_A, 177.93333435058594),
        at(4500, KEY_A, 2847.468505859375),
        at(9000, KEY_A, 27216.3828125),
        at(14850, KEY_A, 103667.1640625),
      ],
      [
        at(1800, KEY_A, 299.9994201660156),
        at(4500, KEY_A, 4576.6015625),
        at(9000, KEY_A, 46115.00390625),
        at(14850, KEY_A, 223599.4375),
      ],
    ]);
    expect(allySeries(real, oneSide)[0].samples.map((s) => s[KEY_A])).toEqual([
      477.93275451660156, 7424.070068359375, 73331.38671875, 327266.6015625,
    ]);
  });

  it("adds every field, not only the one being charted", () => {
    const carry = (frame: number, a: number, b: number) => {
      const s = at(frame, KEY_A, a);
      s[KEY_B] = b;
      return s;
    };
    const two = trailer([[carry(450, 1, 5)], [carry(450, 2, 7)]]);
    const merged = allySeries(two, oneSide)[0].samples[0];
    expect([merged.frame, merged[KEY_A], merged[KEY_B]]).toEqual([450, 3, 12]);
  });

  it("names a side by how the match went for it", () => {
    const decided = fourSeats({ winnersKnown: true, winningAllyTeams: [1] });
    expect(allySeries(twoOnTwo, decided).map((s) => s.label)).toEqual([
      "Team 1",
      "Team 2 (won)",
    ]);
  });

  it("claims no result the file doesn't know", () => {
    expect(allySeries(twoOnTwo, fourSeats()).map((s) => s.label)).toEqual([
      "Team 1",
      "Team 2",
    ]);
  });

  it("puts the sides in ally-team order whatever the teams are numbered", () => {
    const reversed = fourSeats({
      players: [
        { name: "a", spectator: false, team: 0, allyTeam: 1 },
        { name: "b", spectator: false, team: 1, allyTeam: 0 },
        { name: "c", spectator: false, team: 2, allyTeam: 1 },
        { name: "d", spectator: false, team: 3, allyTeam: 0 },
      ],
    });
    expect(allySeries(twoOnTwo, reversed).map((s) => s.id)).toEqual([
      "ally0",
      "ally1",
    ]);
    // Ally 0 is teams 1 and 3 here, so its figures are the other pair's.
    expect(allySeries(twoOnTwo, reversed)[0].samples[0][KEY_A]).toBe(10);
  });

  it("counts a bot, which holds a team and a side like anybody else", () => {
    const vsBot = info({
      players: [{ name: "a", spectator: false, team: 0, allyTeam: 0 }],
      ais: [{ name: "AI 1", shortName: "BARb", team: 1, allyTeam: 0 }],
    });
    const sides = allySeries(pair, vsBot);
    expect(sides.map((s) => s.id)).toEqual(["ally0"]);
    expect(sides[0].samples[0][KEY_A]).toBe(8);
  });

  it("ignores a spectator, who is on a side but holds no team", () => {
    const cast = info({
      players: [
        { name: "cast", spectator: true, team: 0, allyTeam: 1 },
        { name: "a", spectator: false, team: 0, allyTeam: 0 },
        { name: "b", spectator: false, team: 1, allyTeam: 0 },
      ],
    });
    expect(allySeries(pair, cast).map((s) => s.id)).toEqual(["ally0"]);
  });

  it("leaves out a team the engine measured nothing for", () => {
    const partial = trailer([[at(0, KEY_A, 1)], [], [at(0, KEY_A, 4)], []]);
    const sides = allySeries(partial, fourSeats());
    expect(sides.map((s) => s.id)).toEqual(["ally0"]);
    expect(sides[0].samples[0][KEY_A]).toBe(5);
  });

  it("keeps a team the file gives no side for as a line of its own", () => {
    const missing = fourSeats({
      players: [
        { name: "a", spectator: false, team: 0, allyTeam: 0 },
        { name: "b", spectator: false, team: 1, allyTeam: 1 },
        { name: "c", spectator: false, team: 2, allyTeam: 0 },
      ],
    });
    const sides = allySeries(twoOnTwo, missing);
    expect(sides.map((s) => s.id)).toEqual(["ally0", "ally1", "team3"]);
    expect(sides[2].label).toBe("Team 3");
    // Its own samples, not a copy and not merged into anybody.
    expect(sides[2].samples).toBe(twoOnTwo.teams[3].samples);
  });

  it("holds a member's last figure once it stops being recorded", () => {
    const stops = trailer([
      [at(0, KEY_A, 1), at(450, KEY_A, 2), at(900, KEY_A, 3)],
      [at(0, KEY_A, 10), at(450, KEY_A, 20)],
    ]);
    // A running total can't fall. Dropping the stopped team would read as a
    // side that un-spent what it had already spent.
    expect(allySeries(stops, oneSide)[0].samples.map((s) => s[KEY_A])).toEqual([
      11, 22, 23,
    ]);
  });

  it("has nothing from a member before its first sample", () => {
    const late = trailer([
      [at(0, KEY_A, 1), at(450, KEY_A, 2)],
      [at(450, KEY_A, 20)],
    ]);
    expect(allySeries(late, oneSide)[0].samples.map((s) => s[KEY_A])).toEqual([
      1, 22,
    ]);
  });

  it("takes a side's colour from one of its own members", () => {
    const colored = info({
      players: [
        {
          name: "a",
          spectator: false,
          team: 0,
          allyTeam: 0,
          rgbColor: [1, 0, 0],
        },
        {
          name: "b",
          spectator: false,
          team: 1,
          allyTeam: 1,
          rgbColor: [0, 0, 1],
        },
      ],
    });
    expect(allySeries(pair, colored).map((s) => s.color)).toEqual([
      "#ff0000",
      "#0000ff",
    ]);
  });

  it("does not draw two sides in the same green", () => {
    // Which member a side's colour comes from is down to team numbering, and
    // these two are a chart with one line on it drawn twice.
    const sameish = info({
      players: [
        {
          name: "a",
          spectator: false,
          team: 0,
          allyTeam: 0,
          rgbColor: [0.05, 0.95, 0.5],
        },
        {
          name: "b",
          spectator: false,
          team: 1,
          allyTeam: 1,
          rgbColor: [0.05, 0.83, 0.62],
        },
      ],
    });
    const [first, second] = allySeries(pair, sameish);
    expect(first.color).toBe("#0df280");
    expect(second.color).toBe(rgbToHex(PALETTE[0]));
  });
});

describe("defaultChartView", () => {
  const lines = (count: number, prefix: string): ChartSeries[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${prefix}${i}`,
      label: "",
      color: "#000000",
      samples: [],
    }));

  it("is for a match with more lines than anyone can tell apart", () => {
    // The issue's wording, kept as a number the chart reads rather than a
    // threshold typed into the component.
    expect(PLAYERS_VIEW_MAX_SERIES).toBe(4);
  });

  it("opens a duel on the players, not on two sides of one", () => {
    expect(defaultChartView(lines(2, "team"), lines(2, "ally"))).toBe(
      "players",
    );
  });

  it("opens a 2v2 on the players, which is still four readable lines", () => {
    expect(defaultChartView(lines(4, "team"), lines(2, "ally"))).toBe(
      "players",
    );
  });

  it("opens a 3v3 on the sides", () => {
    expect(defaultChartView(lines(6, "team"), lines(2, "ally"))).toBe("teams");
  });

  it("opens an 8v8 on the sides", () => {
    expect(defaultChartView(lines(16, "team"), lines(2, "ally"))).toBe("teams");
  });

  it("opens a free-for-all on the players, since sides of one merge nothing", () => {
    // Sixteen lines called "Team 1" to "Team 16" is the same smear with the
    // names taken off it.
    expect(defaultChartView(lines(16, "team"), lines(16, "ally"))).toBe(
      "players",
    );
  });
});

describe("secondsPerFrame", () => {
  it("measures the frame step against the recorded period", () => {
    const t = trailer([[sample(0), sample(450)]], 15);
    expect(secondsPerFrame(t)).toBeCloseTo(1 / 30);
  });

  it("reads a period the engine was not run at 30 frames a second for", () => {
    const t = trailer([[sample(0), sample(300)]], 15);
    expect(secondsPerFrame(t)).toBeCloseTo(1 / 20);
  });

  it("falls back to the engine's rate when there is no step to measure", () => {
    expect(secondsPerFrame(trailer([[sample(0)]], 15))).toBeCloseTo(1 / 30);
    expect(secondsPerFrame(trailer([[sample(0), sample(450)]], 0))).toBeCloseTo(
      1 / 30,
    );
  });
});

describe("chartRows", () => {
  const series = () =>
    teamSeries(
      trailer([
        [at(0, KEY_A, 1), at(450, KEY_A, 4), at(900, KEY_A, 9)],
        [at(0, KEY_A, 2), at(900, KEY_A, 20)],
      ]),
      info(),
    );

  it("puts each sample frame at its match time", () => {
    const rows = chartRows(series(), KEY_A, 1 / 30);
    expect(rows.map((r) => r.timeSec)).toEqual([0, 15, 30]);
  });

  it("carries a running total across a frame the series never sampled", () => {
    const rows = chartRows(series(), KEY_A, 1 / 30);
    expect(rows.map((r) => r.team0)).toEqual([1, 4, 9]);
    // team1 has no sample at frame 450, and its running total there is still 2.
    expect(rows.map((r) => r.team1)).toEqual([2, 2, 20]);
  });

  it("stops a line rather than running it on flat past its last sample", () => {
    const short = teamSeries(
      trailer([
        [at(0, KEY_A, 1), at(450, KEY_A, 4), at(900, KEY_A, 9)],
        [at(0, KEY_A, 2), at(450, KEY_A, 5)],
      ]),
      info(),
    );
    expect(chartRows(short, KEY_A, 1 / 30).map((r) => r.team1)).toEqual([
      2,
      5,
      null,
    ]);
  });

  it("has no line before a series' first sample", () => {
    const late = teamSeries(
      trailer([[at(0, KEY_A, 1), at(450, KEY_A, 4)], [at(450, KEY_A, 7)]]),
      info(),
    );
    expect(chartRows(late, KEY_A, 1 / 30).map((r) => r.team1)).toEqual([
      null,
      7,
    ]);
  });

  it("is empty when nothing is plotted", () => {
    expect(chartRows([], KEY_A, 1 / 30)).toEqual([]);
  });
});

describe("perMinuteRows", () => {
  /** One team, sampled every 15 seconds at 30 frames a second. */
  const quarterMinute = (values: number[]) =>
    teamSeries(
      trailer([values.map((v, i) => at(i * 450, KEY_A, v))], 15),
      info(),
    );

  const rates = (series: ChartSeries[], secPerFrame = 1 / 30) =>
    perMinuteRows(chartRows(series, KEY_A, secPerFrame));

  it("is the rise since the sample before, scaled to a minute", () => {
    // 90 in a quarter of a minute is 360 a minute.
    const rows = rates(quarterMinute([1006, 1096, 1300]));
    expect(rows.map((r) => r.team0)).toEqual([360, 360, 816]);
  });

  it("reads the period rather than assuming one", () => {
    // Sampled every 30 seconds instead of every 15: the same rise is half the
    // rate. A fixed 15-second period would report double.
    const half = trailer(
      [[at(0, KEY_A, 0), at(900, KEY_A, 90), at(1800, KEY_A, 300)]],
      30,
    );
    const rows = rates(teamSeries(half, info()), secondsPerFrame(half));
    expect(rows.map((r) => r.timeSec)).toEqual([0, 30, 60]);
    expect(rows.map((r) => r.team0)).toEqual([180, 180, 420]);
  });

  it("gives the first point the second's rate, not a zero", () => {
    // A zero at minute zero reads as a stall, in the one chart that exists to
    // show a stall.
    const rows = rates(quarterMinute([0, 200, 260]));
    expect(rows[0].team0).toBe(800);
    expect(rows[0].team0).toBe(rows[1].team0);
  });

  it("gives a line that starts late its own second rate", () => {
    const late = teamSeries(
      trailer(
        [
          [at(0, KEY_A, 1), at(450, KEY_A, 2), at(900, KEY_A, 3)],
          [at(450, KEY_A, 10), at(900, KEY_A, 40)],
        ],
        15,
      ),
      info(),
    );
    expect(rates(late).map((r) => r.team1)).toEqual([null, 120, 120]);
  });

  it("has no rate after a line stops being recorded", () => {
    const stops = teamSeries(
      trailer(
        [
          [at(0, KEY_A, 1), at(450, KEY_A, 2), at(900, KEY_A, 3)],
          [at(0, KEY_A, 10), at(450, KEY_A, 20)],
        ],
        15,
      ),
      info(),
    );
    expect(rates(stops).map((r) => r.team1)).toEqual([40, 40, null]);
  });

  it("has nothing to show for a series sampled once", () => {
    // One sample is no rate at all, and a zero would claim it was measured.
    expect(rates(quarterMinute([5])).map((r) => r.team0)).toEqual([null]);
  });

  it("keeps the times it was given and leaves the totals alone", () => {
    const totals = chartRows(quarterMinute([1, 5, 20]), KEY_A, 1 / 30);
    const before = JSON.stringify(totals);
    const derived = perMinuteRows(totals);
    expect(derived.map((r) => r.timeSec)).toEqual([0, 15, 30]);
    expect(JSON.stringify(totals)).toBe(before);
  });

  it("gives the same answer whether sides are summed before or after", () => {
    // What #1138 needs: it adds two teams' running totals into one series, and
    // that has to be the same line as adding their two rates.
    const both = teamSeries(
      trailer(
        [
          [at(0, KEY_A, 0), at(450, KEY_A, 30), at(900, KEY_A, 100)],
          [at(0, KEY_A, 5), at(450, KEY_A, 45), at(900, KEY_A, 60)],
        ],
        15,
      ),
      info(),
    );
    const apart = rates(both);
    const summed = rates([
      {
        ...both[0],
        id: "side",
        samples: both[0].samples.map((s, i) =>
          at(s.frame, KEY_A, s[KEY_A] + both[1].samples[i][KEY_A]),
        ),
      },
    ]);
    expect(summed.map((r) => r.side)).toEqual(
      apart.map((r) => (r.team0 as number) + (r.team1 as number)),
    );
  });
});

describe("tooltipRows", () => {
  /** `count` teams, each ending on a bigger figure than the last. */
  const many = (count: number) =>
    teamSeries(
      trailer(
        Array.from({ length: count }, (_, i) => [at(0, KEY_A, (i + 1) * 10)]),
      ),
      info(),
    );

  it("reads down from whoever is winning the metric", () => {
    const series = many(3);
    const [row] = chartRows(series, KEY_A, 1 / 30);
    expect(tooltipRows(series, row).rows.map((r) => r.value)).toEqual([
      30, 20, 10,
    ]);
  });

  it("caps a big match at a dozen rows and counts the rest", () => {
    const series = many(16);
    const [row] = chartRows(series, KEY_A, 1 / 30);
    const { rows, hidden } = tooltipRows(series, row);
    expect(rows).toHaveLength(TOOLTIP_ROW_LIMIT);
    expect(hidden).toBe(16 - TOOLTIP_ROW_LIMIT);
    // The cap keeps the top of the list, which is the part being read.
    expect(rows[0].value).toBe(160);
  });

  it("leaves out a series with no value at that moment", () => {
    const series = teamSeries(
      trailer([[at(0, KEY_A, 3), at(450, KEY_A, 6)], [at(450, KEY_A, 9)]]),
      info(),
    );
    const [first] = chartRows(series, KEY_A, 1 / 30);
    expect(tooltipRows(series, first).rows.map((r) => r.id)).toEqual(["team0"]);
  });

  it("carries the line's own colour and name", () => {
    const match = info({
      players: [
        { name: "sprung", spectator: false, team: 0, rgbColor: [0, 0, 1] },
      ],
    });
    const series = teamSeries(trailer([[at(0, KEY_A, 3)]]), match);
    const [row] = chartRows(series, KEY_A, 1 / 30);
    expect(tooltipRows(series, row).rows[0]).toEqual({
      id: "team0",
      label: "sprung",
      color: "#0000ff",
      value: 3,
    });
  });
});

describe("the end-point labels", () => {
  it("are for a duel or a small team game, not a 16-player FFA", () => {
    // The issue's wording, kept as a number the chart reads rather than a
    // threshold typed into the component.
    expect(END_LABEL_MAX_SERIES).toBe(4);
  });

  it("land on the end of a line, not the end of the chart", () => {
    const series = teamSeries(
      trailer([
        [at(0, KEY_A, 1), at(450, KEY_A, 4), at(900, KEY_A, 9)],
        [at(0, KEY_A, 2), at(450, KEY_A, 5)],
      ]),
      info(),
    );
    const rows = chartRows(series, KEY_A, 1 / 30);
    expect(lastPointIndex(rows, "team0")).toBe(2);
    expect(lastPointIndex(rows, "team1")).toBe(1);
  });

  it("has nowhere to land for a line that is never drawn", () => {
    expect(lastPointIndex([], "team0")).toBe(-1);
  });

  it("take a line's last drawn figure, not the chart's last row", () => {
    const series = teamSeries(
      trailer([
        [at(0, KEY_A, 1), at(450, KEY_A, 4), at(900, KEY_A, 9)],
        [at(0, KEY_A, 2), at(450, KEY_A, 5)],
      ]),
      info(),
    );
    const rows = chartRows(series, KEY_A, 1 / 30);
    expect(endPoints(series, rows)).toEqual([
      {
        id: "team0",
        label: "Team 0",
        color: expect.any(String),
        timeSec: 30,
        value: 9,
      },
      {
        id: "team1",
        label: "Team 1",
        color: expect.any(String),
        timeSec: 15,
        value: 5,
      },
    ]);
  });

  it("skips a line that was never drawn", () => {
    const series = teamSeries(trailer([[at(0, KEY_A, 1)]]), info());
    expect(endPoints(series, [])).toEqual([]);
  });
});

describe("spreadLabels", () => {
  const at_ = (id: string, y: number) => ({ id, y });

  it("leaves labels alone when they already clear each other", () => {
    const out = spreadLabels([at_("a", 10), at_("b", 60)], 14, 0, 200);
    expect(out).toEqual([at_("a", 10), at_("b", 60)]);
  });

  it("pushes a duel's two labels apart rather than printing one on the other", () => {
    const out = spreadLabels([at_("a", 100), at_("b", 102)], 14, 0, 200);
    expect(out.map((l) => l.y)).toEqual([100, 114]);
  });

  it("returns them top to bottom whatever order they arrive in", () => {
    const out = spreadLabels([at_("b", 102), at_("a", 100)], 14, 0, 200);
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("keeps the stack inside the plot rather than off the bottom", () => {
    const out = spreadLabels([at_("a", 195), at_("b", 198)], 14, 0, 200);
    expect(out.map((l) => l.y)).toEqual([186, 200]);
  });

  it("keeps the top label inside the plot", () => {
    expect(spreadLabels([at_("a", -5)], 14, 0, 200)[0].y).toBe(0);
  });
});

describe("formatChartValue", () => {
  it("does not round a gridline into a different figure", () => {
    // The bug this exists for: `formatTotal` calls 1,050,000 "1.1M", and evenly
    // spaced gridlines then read as unevenly spaced ones.
    expect(formatTotal(1_050_000)).toBe("1.1M");
    expect(formatChartValue(1_050_000)).toBe("1.05M");
  });

  it("shortens one axis the same way all the way up it", () => {
    expect([8_000, 16_000, 24_000, 32_000].map(formatChartValue)).toEqual([
      "8k",
      "16k",
      "24k",
      "32k",
    ]);
  });

  it("drops a trailing zero decimal", () => {
    expect(formatChartValue(1_400_000)).toBe("1.4M");
    expect(formatChartValue(350_000)).toBe("350k");
    expect(formatChartValue(12_000_000)).toBe("12M");
  });

  it("leaves a figure small enough to read", () => {
    expect(formatChartValue(0)).toBe("0");
    expect(formatChartValue(276)).toBe("276");
  });
});

describe("formatRate", () => {
  it("keeps a small rate's gridlines apart", () => {
    // A team that killed twenty units in eight minutes is plotted in single
    // digits, and the cumulative formatter rounds those ticks together.
    expect([0, 1.2, 2.4, 3.6].map(formatChartValue)).toEqual([
      "0",
      "1",
      "2",
      "4",
    ]);
    expect([0, 1.2, 2.4, 3.6].map(formatRate)).toEqual([
      "0",
      "1.2",
      "2.4",
      "3.6",
    ]);
  });

  it("does not print decimals a whole figure hasn't got", () => {
    expect(formatRate(4)).toBe("4");
    expect(formatRate(12)).toBe("12");
  });

  it("reads a big rate the way the rest of the chart does", () => {
    expect(formatRate(360)).toBe("360");
    expect(formatRate(5_900.4)).toBe("5.9k");
    expect(formatRate(1_050_000)).toBe("1.05M");
  });
});
