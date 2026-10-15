import { describe, expect, it } from "vitest";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  TeamStatSample,
} from "./bindings";
import {
  activityPath,
  activitySeries,
  countInRange,
  filterByFrame,
  frameIndexes,
  PRESET_MINUTES,
  toWindow,
  WHOLE_MATCH,
  windowPoints,
  windowPresets,
  windowRange,
} from "./replayTimeWindow";

const FPS = 30;
const MINUTE = 60;

describe("windowRange", () => {
  it("keeps everything for the whole match", () => {
    expect(windowRange(null, 600)).toBe(WHOLE_MATCH);
  });

  it("turns seconds into frames at 30 a second", () => {
    expect(windowRange({ startSec: 60, endSec: 120 }, 600)).toEqual({
      from: 60 * FPS,
      to: 120 * FPS,
    });
  });

  it("reaches back over pregame frames when it starts at zero", () => {
    const range = windowRange({ startSec: 0, endSec: 300 }, 600);
    expect(-1).toBeGreaterThanOrEqual(range.from);
    expect(range.to).toBe(300 * FPS);
  });

  it("reaches on past the end of the match when it ends there", () => {
    const range = windowRange({ startSec: 300, endSec: 600 }, 600);
    expect(range.to).toBe(Number.POSITIVE_INFINITY);
    expect(range.from).toBe(300 * FPS);
  });
});

describe("toWindow", () => {
  it("is null when the thumbs span the whole match", () => {
    expect(toWindow(0, 600, 600)).toBeNull();
  });

  it("clamps to the match", () => {
    expect(toWindow(-20, 100, 600)).toEqual({ startSec: 0, endSec: 100 });
    expect(toWindow(500, 900, 600)).toEqual({ startSec: 500, endSec: 600 });
  });

  it("keeps the window at least a second wide", () => {
    expect(toWindow(100, 100, 600)).toEqual({ startSec: 100, endSec: 101 });
    expect(toWindow(600, 600, 600)).toEqual({ startSec: 599, endSec: 600 });
  });

  it("round trips through windowRange", () => {
    const window = toWindow(125, 410, 600);
    expect(window).toEqual({ startSec: 125, endSec: 410 });
    const range = windowRange(window, 600);
    expect(range.from / FPS).toBe(125);
    expect(range.to / FPS).toBe(410);
  });
});

describe("filterByFrame", () => {
  const orders = [
    { frame: -1, name: "pregame" },
    { frame: 0, name: "first" },
    { frame: 1800, name: "one minute" },
    { frame: 1801, name: "just after" },
    { frame: 9000, name: "five minutes" },
  ];

  it("returns the same list for the whole match", () => {
    expect(filterByFrame(orders, WHOLE_MATCH)).toBe(orders);
  });

  it("keeps both ends of the window", () => {
    const range = windowRange({ startSec: 60, endSec: 300 }, 600);
    expect(filterByFrame(orders, range).map((o) => o.name)).toEqual([
      "one minute",
      "just after",
      "five minutes",
    ]);
  });

  it("counts pregame orders in a window that starts at zero and in no other", () => {
    const opening = windowRange({ startSec: 0, endSec: 60 }, 600);
    expect(filterByFrame(orders, opening).map((o) => o.name)).toEqual([
      "pregame",
      "first",
      "one minute",
    ]);
    const later = windowRange({ startSec: 1, endSec: 60 }, 600);
    expect(filterByFrame(orders, later).map((o) => o.name)).not.toContain(
      "pregame",
    );
  });

  it("is empty for a window nothing was given in", () => {
    const range = windowRange({ startSec: 400, endSec: 500 }, 600);
    expect(filterByFrame(orders, range)).toEqual([]);
  });
});

describe("the filter over flat arrays", () => {
  const frames = Int32Array.from([-1, 0, 900, 1800, 2700]);
  const positions = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const range = windowRange({ startSec: 30, endSec: 60 }, 600);

  it("lists the indexes inside the window", () => {
    expect([...frameIndexes(frames, range)]).toEqual([2, 3]);
    expect([...frameIndexes(frames, WHOLE_MATCH)]).toEqual([0, 1, 2, 3, 4]);
  });

  it("counts them", () => {
    expect(countInRange(frames, range)).toBe(2);
    expect(countInRange(frames, WHOLE_MATCH)).toBe(5);
  });

  it("keeps the positions of the points inside, in pairs", () => {
    const kept = windowPoints({ positions }, frames, range);
    expect(Array.from(kept.positions)).toEqual([5, 6, 7, 8]);
    expect(kept.weights).toBeUndefined();
  });

  it("keeps each kept point's weight with it", () => {
    const weights = Float32Array.from([10, 20, 30, 40, 50]);
    const kept = windowPoints({ positions, weights }, frames, range);
    expect(Array.from(kept.weights ?? [])).toEqual([30, 40]);
  });

  it("hands back the same points for the whole match", () => {
    const points = { positions };
    expect(windowPoints(points, frames, WHOLE_MATCH)).toBe(points);
  });

  it("gives an empty set for a window with nothing in it", () => {
    const empty = windowPoints(
      { positions },
      frames,
      windowRange({ startSec: 400, endSec: 500 }, 600),
    );
    expect(empty.positions.length).toBe(0);
  });
});

describe("windowPresets", () => {
  const five = PRESET_MINUTES * MINUTE;

  it("offers the first and last five minutes of a long match", () => {
    expect(windowPresets(2400)).toEqual([
      {
        id: "first",
        label: "First 5 minutes",
        window: { startSec: 0, endSec: five },
      },
      {
        id: "last",
        label: "Last 5 minutes",
        window: { startSec: 2400 - five, endSec: 2400 },
      },
    ]);
  });

  it("lets the two overlap in a nine minute match", () => {
    const [first, last] = windowPresets(540);
    expect(first.window).toEqual({ startSec: 0, endSec: 300 });
    expect(last.window).toEqual({ startSec: 240, endSec: 540 });
    expect(last.window.startSec).toBeLessThan(first.window.endSec);
  });

  it("offers neither in a match of five minutes or less, since each is the whole match", () => {
    expect(windowPresets(180)).toEqual([]);
    expect(windowPresets(five)).toEqual([]);
    expect(windowPresets(0)).toEqual([]);
  });

  it("is never the whole match", () => {
    for (const domain of [301, 540, 600, 2400])
      for (const preset of windowPresets(domain))
        expect(
          toWindow(preset.window.startSec, preset.window.endSec, domain),
        ).not.toBeNull();
  });
});

describe("activityPath", () => {
  it("draws from the match start at the left to its end at the right", () => {
    const path = activityPath(
      [
        { timeSec: 0, value: 0 },
        { timeSec: 50, value: 10 },
        { timeSec: 100, value: 5 },
      ],
      100,
    );
    expect(path).toBe(
      "M0.00,100 L0.00,100.00 L50.00,0.00 L100.00,50.00 L100.00,100 Z",
    );
  });

  it("leaves out a point past the end of the match", () => {
    const path = activityPath(
      [
        { timeSec: 50, value: 10 },
        { timeSec: 500, value: 99 },
      ],
      100,
    );
    expect(path).not.toContain("500");
    expect(path).toContain("50.00,0.00");
  });

  it("is null when there is nothing above zero", () => {
    expect(activityPath([], 100)).toBeNull();
    expect(activityPath([{ timeSec: 10, value: 0 }], 100)).toBeNull();
    expect(activityPath([{ timeSec: 10, value: 4 }], 0)).toBeNull();
  });
});

/** No metric is named here, as in `matchStats.test.ts`. */
function blank(frame: number): TeamStatSample {
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

function sample(frame: number, key: MetricKey, value: number): TeamStatSample {
  const s = blank(frame);
  s[key] = value;
  return s;
}

const [KEY, OTHER] = Object.keys(blank(0)).filter(
  (k) => k !== "frame",
) as MetricKey[];

const metric = (key: MetricKey, headline: boolean): Metric => ({
  key,
  label: `Label of ${key}`,
  group: "military",
  unit: "count",
  roster: true,
  headline,
  surfaced: true,
});

const INFO = {
  durationSec: 600,
  allyTeams: [],
  players: [],
  ais: [],
} as unknown as DemoInfo;

/** Two teams, sampled every 15 seconds. */
const TRAILER: DemoTrailer = {
  winningAllyTeams: [],
  teamStatPeriodSec: 15,
  teams: [
    {
      team: 0,
      samples: [0, 450, 900].map((f, i) => sample(f, KEY, [0, 100, 300][i])),
    },
    {
      team: 1,
      samples: [0, 450, 900].map((f, i) => sample(f, KEY, [0, 50, 50][i])),
    },
  ],
};

describe("activitySeries", () => {
  it("sums the registry's lead metric across teams as a rate a minute", () => {
    const series = activitySeries(TRAILER, INFO, [
      metric(OTHER, false),
      metric(KEY, true),
    ]);
    expect(series?.label).toBe(`Label of ${KEY} per minute`);
    // Team 0 rises 100 then 200 in a quarter minute each: 400 then 800 a
    // minute. Team 1 rises 50 then 0: 200 then 0. The first row takes the
    // second's rate, as the chart draws it.
    expect(series?.points).toEqual([
      { timeSec: 0, value: 600 },
      { timeSec: 15, value: 600 },
      { timeSec: 30, value: 800 },
    ]);
  });

  it("follows the registry's headline, not a metric of its own", () => {
    const series = activitySeries(TRAILER, INFO, [
      metric(OTHER, true),
      metric(KEY, false),
    ]);
    expect(series?.label).toBe(`Label of ${OTHER} per minute`);
    expect(series?.points.every((p) => p.value === 0)).toBe(true);
  });

  it("is null for a replay with no statistics", () => {
    const none: DemoTrailer = {
      ...TRAILER,
      teams: [
        { team: 0, samples: [] },
        { team: 1, samples: [] },
      ],
    };
    expect(activitySeries(none, INFO, [metric(KEY, true)])).toBeNull();
    expect(activitySeries(null, INFO, [metric(KEY, true)])).toBeNull();
  });

  it("is null when the registry offers nothing", () => {
    expect(activitySeries(TRAILER, INFO, [])).toBeNull();
  });
});
