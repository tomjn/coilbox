// @vitest-environment happy-dom
/**
 * Issue #5308. The timeline dock's metric lane draws the metric the statistics
 * chart has picked, and a choice made in either place changes both. Rendered with
 * the real chart and the real roster, so the properties that matter are checked
 * where they happen. recharts is replaced by a stub that prints each real line,
 * because it draws nothing without a measured container.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  TeamStatSample,
} from "../../bindings";
import { METRIC_LABEL } from "../../metricLabels";

let TRAILER: DemoTrailer;
let METRICS: Metric[] = [];

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTrailer: () => Promise.resolve({ trailer: TRAILER }),
    contentMetricRegistry: () => Promise.resolve({ metrics: METRICS }),
  };
});
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../usePrimaryPlayer", () => ({ usePrimaryPlayer: () => "" }));
vi.mock("recharts", () => {
  const Wrap = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Nothing = () => null;
  return {
    ResponsiveContainer: Wrap,
    LineChart: Wrap,
    // Only a real line has a name. The halo and the hit lines do not.
    Line: (p: { dataKey: string; stroke: string; name?: string }) =>
      p.name ? (
        <i data-line={p.dataKey} data-stroke={p.stroke} data-name={p.name} />
      ) : null,
    CartesianGrid: Nothing,
    Legend: Nothing,
    Tooltip: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    usePlotArea: () => undefined,
    useXAxisScale: () => undefined,
    useXAxisInverseScale: () => undefined,
    useYAxisScale: () => undefined,
  };
});

const { ReplayRoster } = await import("./ReplayRoster");
const { MatchStatsSection } = await import("./MatchStatsSection");
const { MetricLaneLabel, MetricLanePlot, useMetricLane } = await import(
  "./ReplayMetricLane"
);
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");
const { MatchClockProvider } = await import("../../useMatchClock");

/** No metric is named here: `metricRegistry.test.ts` forbids it. */
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
const [FIRST, SECOND] = KEYS;
const LABEL_FIRST = i18n._(METRIC_LABEL[FIRST]);
const LABEL_SECOND = i18n._(METRIC_LABEL[SECOND]);

function metric(key: MetricKey, over: Partial<Metric> = {}): Metric {
  return {
    key,
    label: `Metric ${KEYS.indexOf(key)}`,
    group: "military",
    unit: "count",
    roster: true,
    headline: false,
    surfaced: true,
    ...over,
  };
}

/** The first metric climbs by a different amount for each team, the second is
 *  the same for all, so the two metrics draw different shapes. */
function trailerWith(finals: number[], samples = true): DemoTrailer {
  return {
    winningAllyTeams: [],
    teamStatPeriodSec: 15,
    teams: finals.map((final, team) => ({
      team,
      samples: samples
        ? [
            sample(0),
            { ...sample(450), [FIRST]: final, [SECOND]: 10 },
            { ...sample(900), [FIRST]: final * 2, [SECOND]: 10 },
          ]
        : [],
    })),
  };
}

const seat = (name: string, team: number, allyTeam: number) => ({
  name,
  team,
  allyTeam,
  spectator: false,
  rgbColor: [team / 4, 0.5, 0.5],
});

function twoVTwo(): DemoInfo {
  return {
    players: [
      seat("Ann", 0, 0),
      seat("Ben", 1, 0),
      seat("Cat", 2, 1),
      seat("Dan", 3, 1),
    ],
    ais: [],
    winnersKnown: false,
    winningAllyTeams: [],
    mapName: "Map",
    durationSec: 30,
  } as unknown as DemoInfo;
}

/** The dock's two halves of the lane, without the rest of the dock. */
function LaneProbe({
  info,
  replayPath,
  stats = true,
}: {
  info: DemoInfo;
  replayPath: string;
  stats?: boolean;
}) {
  const lane = useMetricLane(info, stats ? replayPath : null, 30);
  if (!lane) return <p data-testid="no-lane">no lane</p>;
  return (
    <>
      <MetricLaneLabel lane={lane} id="lane-label" />
      <MetricLanePlot lane={lane} />
    </>
  );
}

let path = 0;
function mount(stats = true) {
  const info = twoVTwo();
  const replayPath = `/replays/${++path}.sdfz`;
  return render(
    <MemoryRouter>
      <MatchClockProvider durationSec={info.durationSec}>
        <SeriesEmphasisProvider>
          <ReplayRoster info={info} replayPath={replayPath} />
          <MatchStatsSection info={info} replayPath={replayPath} part="chart" />
          <LaneProbe info={info} replayPath={replayPath} stats={stats} />
        </SeriesEmphasisProvider>
      </MatchClockProvider>
    </MemoryRouter>,
  );
}

const plot = () => screen.getByTestId("metric-lane-plot");
const laneLines = () => [...plot().querySelectorAll("path")];
const chartLines = () => [
  ...document.querySelectorAll<HTMLElement>("[data-line]"),
];
/** The lane's label, which is a select showing the metric's name. */
const laneLabel = (metric: string) =>
  screen.getByRole("combobox", { name: `Metric in the timeline: ${metric}` });
const chartPicker = () =>
  screen.getByRole("combobox", { name: "Charted metric" });

async function choose(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  localStorage.clear();
  METRICS = [metric(FIRST, { headline: true }), metric(SECOND)];
  TRAILER = trailerWith([100, 900, 300, 50]);
});
afterEach(cleanup);

describe("the dock's metric lane", () => {
  it("draws the chart's opening metric, a line for each of the chart's lines in the chart's colours", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));
    expect(plot().getAttribute("aria-label")).toBe(
      `${LABEL_FIRST}, running total`,
    );
    expect(laneLines().map((p) => p.getAttribute("stroke"))).toEqual(
      chartLines().map((l) => l.dataset.stroke),
    );
  });

  it("changes the chart when a metric is picked from the lane's label", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));
    const before = laneLines().map((p) => p.getAttribute("d"));

    await choose(laneLabel(LABEL_FIRST), LABEL_SECOND);

    await waitFor(() =>
      expect(plot().getAttribute("aria-label")).toBe(
        `${LABEL_SECOND}, running total`,
      ),
    );
    expect(laneLines().map((p) => p.getAttribute("d"))).not.toEqual(before);
    expect(chartPicker().textContent).toBe(LABEL_SECOND);
  });

  it("changes the lane when a metric is picked in the chart", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));

    await choose(chartPicker(), LABEL_SECOND);

    await waitFor(() =>
      expect(plot().getAttribute("aria-label")).toBe(
        `${LABEL_SECOND}, running total`,
      ),
    );
    // The label names the metric now picked.
    expect(laneLabel(LABEL_SECOND)).toBeTruthy();
  });

  it("follows the chart's Cumulative or Per minute choice", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));
    const cumulative = laneLines().map((p) => p.getAttribute("d"));

    fireEvent.click(screen.getByRole("radio", { name: "Per minute" }));

    await waitFor(() =>
      expect(plot().getAttribute("aria-label")).toBe(
        `${LABEL_FIRST}, per minute`,
      ),
    );
    expect(laneLines().map((p) => p.getAttribute("d"))).not.toEqual(cumulative);
  });

  it("follows the chart's Players or Teams choice", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));

    fireEvent.click(screen.getByRole("radio", { name: "Teams" }));

    await waitFor(() => expect(laneLines()).toHaveLength(2));
    expect(laneLines().map((p) => p.getAttribute("stroke"))).toEqual(
      chartLines().map((l) => l.dataset.stroke),
    );
  });

  it("leaves out a player the roster has unchecked, as the chart does", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));
    const before = laneLines().map((p) => p.getAttribute("stroke"));

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show Ben on the chart" }),
    );

    await waitFor(() => expect(laneLines()).toHaveLength(3));
    // Ben's colour goes with him and nobody else is repainted.
    expect(laneLines().map((p) => p.getAttribute("stroke"))).toEqual(
      before.filter((_, i) => i !== 1),
    );
  });

  it("is not there for a replay with no statistics", async () => {
    TRAILER = trailerWith([100, 900, 300, 50], false);
    mount();
    expect(await screen.findByTestId("no-lane")).toBeTruthy();
    expect(screen.queryByTestId("metric-lane-plot")).toBeNull();
  });

  it("is not there when the profile hides statistics", async () => {
    mount(false);
    expect(await screen.findByTestId("no-lane")).toBeTruthy();
  });
});
