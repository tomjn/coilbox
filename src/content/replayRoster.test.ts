import { describe, expect, it } from "vitest";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  ReplayAi,
  ReplayPlayer,
  TeamStatSample,
} from "./bindings";
import {
  ariaSort,
  buildRoster,
  cellValue,
  nextSort,
  parseRating,
  type RosterRow,
  rosterMetrics,
  rowApm,
  sortRows,
  teamFinals,
} from "./replayRoster";

/**
 * No metric is named here: `metricRegistry.test.ts` forbids it, so the keys are
 * read off the sample type, as `matchStats.test.ts` does.
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
const KEYS = Object.keys(sample(0)).filter((k) => k !== "frame") as MetricKey[];
const [KEY_A, KEY_B] = KEYS;

function metric(key: MetricKey, over: Partial<Metric> = {}): Metric {
  return {
    key,
    label: `Label ${key}`,
    group: "military",
    unit: "count",
    roster: true,
    headline: false,
    surfaced: true,
    ...over,
  };
}

function player(
  name: string,
  team: number | undefined,
  allyTeam: number,
  over: Partial<ReplayPlayer> = {},
): ReplayPlayer {
  return { name, team, allyTeam, spectator: false, ...over };
}

function ai(team: number, allyTeam: number): ReplayAi {
  return { name: "AI 1", shortName: "BARb", team, allyTeam } as ReplayAi;
}

function info(over: Partial<DemoInfo>): DemoInfo {
  return {
    players: [],
    ais: [],
    winnersKnown: false,
    winningAllyTeams: [],
    ...over,
  } as unknown as DemoInfo;
}

function samplesOf(...figures: Partial<Record<MetricKey, number>>[]) {
  return figures.map((f, i) => ({ ...sample(i * 450), ...f }));
}

describe("buildRoster", () => {
  it("makes one row of a team two players share, so its total shows once", () => {
    const { rows } = buildRoster(
      info({
        players: [player("A", 0, 0), player("B", 0, 0), player("C", 1, 1)],
      }),
    );
    expect(rows.map((r) => [r.team, r.seats.length])).toEqual([
      [0, 2],
      [1, 1],
    ]);
  });

  it("seats a bot like a person, on its side, and keeps spectators out of the rows", () => {
    const roster = buildRoster(
      info({
        players: [
          player("A", 0, 0),
          player("Watcher", 5, 0, { spectator: true }),
        ],
        ais: [ai(1, 1)],
      }),
    );
    expect(roster.rows.map((r) => [r.team, r.allyTeam])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(roster.spectators.map((s) => s.name)).toEqual(["Watcher"]);
  });

  it("orders sides ascending and gives a seat with no team a row of its own", () => {
    const roster = buildRoster(
      info({
        players: [
          player("Late", 3, 2),
          player("X", undefined, 1),
          player("Y", undefined, 1),
          player("Early", 0, 0),
        ],
      }),
    );
    expect(roster.sides).toEqual([0, 1, 2]);
    expect(roster.rows.map((r) => r.seats.length)).toEqual([1, 1, 1, 1]);
    expect(new Set(roster.rows.map((r) => r.key)).size).toBe(4);
  });
});

describe("teamFinals", () => {
  it("is each team's last sample, for the registry's roster metrics only", () => {
    const trailer: DemoTrailer = {
      winningAllyTeams: [],
      teamStatPeriodSec: 15,
      teams: [
        { team: 0, samples: samplesOf({ [KEY_A]: 5 }, { [KEY_A]: 40 }) },
        { team: 1, samples: samplesOf({ [KEY_A]: 7 }) },
      ],
    };
    const finals = teamFinals(trailer, [metric(KEY_A)]);
    expect(finals.get(0)).toEqual({ [KEY_A]: 40 });
    expect(finals.get(1)).toEqual({ [KEY_A]: 7 });
  });

  it("leaves out a team with no samples, which is not a total of zero", () => {
    const trailer: DemoTrailer = {
      winningAllyTeams: [],
      teamStatPeriodSec: 15,
      teams: [
        { team: 0, samples: [] },
        { team: 1, samples: samplesOf({ [KEY_A]: 1 }) },
      ],
    };
    const finals = teamFinals(trailer, [metric(KEY_A)]);
    expect(finals.has(0)).toBe(false);
    expect(finals.has(1)).toBe(true);
  });
});

describe("rosterMetrics", () => {
  it("is whatever the registry flags for the roster and surfaces", () => {
    const metrics = [
      metric(KEY_A),
      metric(KEY_B, { roster: false }),
      metric(KEYS[2], { surfaced: false }),
      metric(KEYS[3]),
    ];
    expect(rosterMetrics(metrics).map((m) => m.key)).toEqual([KEY_A, KEYS[3]]);
  });
});

describe("rowApm", () => {
  const row = (...seats: RosterRow["seats"]): RosterRow => ({
    key: "t0",
    allyTeam: 0,
    team: 0,
    seats,
  });
  const human = (apm?: number) => ({
    kind: "player" as const,
    player: player("P", 0, 0, { apm }),
  });

  it("is the player's figure, and none when the decoder gave none", () => {
    expect(rowApm(row(human(120)))).toBe(120);
    expect(rowApm(row(human(undefined)))).toBeUndefined();
  });

  it("is the busier player's on a shared team, and none for a bot", () => {
    expect(rowApm(row(human(80), human(150)))).toBe(150);
    expect(rowApm(row({ kind: "ai", ai: ai(0, 0) }))).toBeUndefined();
  });
});

describe("sorting", () => {
  const rows: RosterRow[] = [0, 1, 2, 3].map((team) => ({
    key: `t${team}`,
    allyTeam: team % 2,
    team,
    seats: [],
  }));
  const finals = new Map<number, Record<string, number>>([
    [0, { [KEY_A]: 10 }],
    [1, { [KEY_A]: 300 }],
    [2, { [KEY_A]: 20 }],
    // Team 3 has no samples.
  ]);
  const column = { kind: "metric" as const, key: KEY_A };
  const teams = (r: RosterRow[]) => r.map((x) => x.team);

  it("keeps the grouped order with no column sorted", () => {
    expect(teams(sortRows(rows, null, finals))).toEqual([0, 1, 2, 3]);
  });

  it("puts the biggest first, across sides", () => {
    expect(teams(sortRows(rows, { column, dir: "desc" }, finals))).toEqual([
      1, 2, 0, 3,
    ]);
  });

  it("puts a team with no value last in both directions", () => {
    expect(teams(sortRows(rows, { column, dir: "asc" }, finals))).toEqual([
      0, 2, 1, 3,
    ]);
    expect(sortRows(rows, { column, dir: "desc" }, finals).at(-1)?.team).toBe(
      3,
    );
  });

  it("reads a cell from the team's final", () => {
    expect(cellValue(rows[1], column, finals)).toBe(300);
    expect(cellValue(rows[3], column, finals)).toBeUndefined();
  });

  it("steps biggest first, smallest first, then back to grouped", () => {
    const first = nextSort(null, column);
    expect(first).toEqual({ column, dir: "desc" });
    const second = nextSort(first, column);
    expect(second).toEqual({ column, dir: "asc" });
    expect(nextSort(second, column)).toBeNull();
    expect(nextSort(second, { kind: "apm" })).toEqual({
      column: { kind: "apm" },
      dir: "desc",
    });
  });

  it("names the sorted column for aria-sort and no other", () => {
    const sort = { column, dir: "desc" as const };
    expect(ariaSort(sort, column)).toBe("descending");
    expect(ariaSort({ column, dir: "asc" }, column)).toBe("ascending");
    expect(ariaSort(sort, { kind: "apm" })).toBe("none");
    expect(ariaSort(null, column)).toBe("none");
  });
});

describe("parseRating", () => {
  it("reads the number a lobby decorates", () => {
    expect(parseRating("[25.0]")).toBe(25);
    expect(parseRating("(30.5)")).toBe(30.5);
    expect(parseRating("[µ=12.3, σ=8.3]")).toBe(12.3);
    expect(parseRating("-4")).toBe(-4);
  });

  it("finds no rating where there is no number", () => {
    expect(parseRating(undefined)).toBeUndefined();
    expect(parseRating("")).toBeUndefined();
    expect(parseRating("n/a")).toBeUndefined();
  });
});
