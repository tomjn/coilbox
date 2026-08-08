import { describe, expect, it } from "vitest";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  ReplayPlayer,
  TeamStatSample,
} from "./bindings";
import {
  formatDuration,
  formatTotal,
  hasStatistics,
  headlineTotals,
  matchTotal,
  resultLabel,
  seatCount,
  teamTotal,
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

function trailer(teams: TeamStatSample[][]): DemoTrailer {
  return {
    winningAllyTeams: [],
    teamStatPeriodSec: 15,
    teams: teams.map((samples, team) => ({ team, samples })),
  };
}

function metric(key: MetricKey, label: string, headline: boolean): Metric {
  return {
    key,
    label,
    group: "military",
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
