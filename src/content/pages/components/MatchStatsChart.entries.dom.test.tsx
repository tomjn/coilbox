// @vitest-environment happy-dom
/**
 * Issue #5321. Commands per minute and the living unit value are entries in the
 * chart's metric list, drawn in its plot area in place of the metric shown
 * before. Rendered through the real section, as `ReplayMetricLane.dom.test.tsx`
 * does, with recharts replaced by a stub that prints each real line.
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
  DemoCommandRates,
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  TeamStatSample,
} from "../../bindings";
import { METRIC_LABEL } from "../../metricLabels";

let TRAILER: DemoTrailer;
let METRICS: Metric[] = [];
let RATES: DemoCommandRates;
const ratesRead = vi.fn();

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTrailer: () => Promise.resolve({ trailer: TRAILER }),
    contentMetricRegistry: () => Promise.resolve({ metrics: METRICS }),
    contentDemoCommandRates: async (args: unknown) => {
      ratesRead(args);
      return RATES;
    },
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
    AreaChart: Wrap,
    Area: Nothing,
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

const { MatchStatsSection } = await import("./MatchStatsSection");
const { MetricLaneLabel, MetricLanePlot, useMetricLane } = await import(
  "./ReplayMetricLane"
);
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");
const { MatchClockProvider } = await import("../../useMatchClock");
const { resetReplayCommandRates } = await import("../../useReplayCommandRates");

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
const [FIRST] = KEYS;
const LABEL_FIRST = i18n._(METRIC_LABEL[FIRST]);

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

function trailerWith(finals: number[]): DemoTrailer {
  return {
    winningAllyTeams: [],
    teamStatPeriodSec: 15,
    teams: finals.map((final, team) => ({
      team,
      samples: [
        sample(0),
        { ...sample(450), [FIRST]: final },
        { ...sample(900), [FIRST]: final * 2 },
      ],
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

const rates = (): DemoCommandRates => ({
  periodSec: 15,
  periodIsDefault: true,
  buckets: 2,
  series: [0, 1, 2, 3].map((team) => ({
    team,
    source: "selection" as const,
    counts: [3 + team, 4 + team],
  })),
  pregame: 0,
  trailing: 0,
  unattributed: 0,
  lastFrame: 900,
  incomplete: false,
});

function LaneProbe({
  info,
  replayPath,
}: {
  info: DemoInfo;
  replayPath: string;
}) {
  const lane = useMetricLane(info, replayPath, 30);
  if (!lane) return null;
  return (
    <>
      <MetricLaneLabel lane={lane} id="lane-label" />
      <MetricLanePlot lane={lane} />
    </>
  );
}

let path = 0;
function mount() {
  const info = twoVTwo();
  const replayPath = `/replays/${++path}.sdfz`;
  return render(
    <MemoryRouter>
      <MatchClockProvider durationSec={info.durationSec}>
        <SeriesEmphasisProvider>
          <MatchStatsSection info={info} replayPath={replayPath} part="chart" />
          <LaneProbe info={info} replayPath={replayPath} />
        </SeriesEmphasisProvider>
      </MatchClockProvider>
    </MemoryRouter>,
  );
}

const chartPicker = () =>
  screen.getByRole("combobox", { name: "Charted metric" });
const chartLines = () => [
  ...document.querySelectorAll<HTMLElement>("[data-line]"),
];
const laneLines = () => [
  ...screen.getByTestId("metric-lane-plot").querySelectorAll("path"),
];
const disabled = (name: string) =>
  (screen.getByRole("radio", { name }) as HTMLButtonElement).disabled;

async function choose(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  localStorage.clear();
  METRICS = [metric(FIRST, { headline: true })];
  TRAILER = trailerWith([100, 900, 300, 50]);
  RATES = rates();
});
afterEach(() => {
  cleanup();
  resetReplayCommandRates();
  ratesRead.mockClear();
});

describe("the chart's two replay entries", () => {
  it("has neither button under the chart, and lists both entries", async () => {
    mount();
    await waitFor(() => expect(chartLines()).toHaveLength(4));
    expect(
      screen.queryByRole("button", { name: "Show commands per minute" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /show value of living units/i }),
    ).toBeNull();
    // Nothing is read until one is picked.
    expect(ratesRead).not.toHaveBeenCalled();

    fireEvent.keyDown(chartPicker(), { key: "ArrowDown" });
    expect(
      await screen.findByRole("option", { name: "Commands per minute" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Living unit value" }),
    ).toBeTruthy();
  });

  it("draws commands per minute in the plot area, one line for each player", async () => {
    mount();
    await waitFor(() => expect(chartLines()).toHaveLength(4));
    const metricLines = chartLines().map((l) => l.dataset.stroke);

    await choose(chartPicker(), "Commands per minute");

    await screen.findByRole("radio", { name: "Player's own" });
    expect(ratesRead).toHaveBeenCalledTimes(1);
    // The metric's lines are gone, and these are the same players in the same
    // colours.
    expect(chartLines()).toHaveLength(4);
    expect(chartLines().map((l) => l.dataset.stroke)).toEqual(metricLines);
    expect(chartPicker().textContent).toBe("Commands per minute");
  });

  it("disables the switches commands per minute has no use for, and no others", async () => {
    mount();
    await waitFor(() => expect(chartLines()).toHaveLength(4));
    expect(disabled("Cumulative")).toBe(false);
    expect(disabled("Table")).toBe(false);

    await choose(chartPicker(), "Commands per minute");

    expect(disabled("Cumulative")).toBe(true);
    expect(disabled("Per minute")).toBe(true);
    expect(disabled("Chart")).toBe(true);
    expect(disabled("Table")).toBe(true);
    expect(disabled("Players")).toBe(false);
    expect(disabled("Teams")).toBe(false);

    await choose(chartPicker(), LABEL_FIRST);
    expect(disabled("Cumulative")).toBe(false);
    expect(disabled("Table")).toBe(false);
  });

  it("shows the living unit value's note in the plot area when there is no analysis", async () => {
    mount();
    await waitFor(() => expect(chartLines()).toHaveLength(4));

    await choose(chartPicker(), "Living unit value");

    expect(
      await screen.findByText(
        /This needs an analysis, and this replay has not been analysed\./,
      ),
    ).toBeTruthy();
    expect(chartLines()).toHaveLength(0);
    expect(disabled("Cumulative")).toBe(true);
    expect(disabled("Table")).toBe(true);
    expect(ratesRead).not.toHaveBeenCalled();
  });

  it("leaves the timeline lane named for the entry and drawing nothing", async () => {
    mount();
    await waitFor(() => expect(laneLines()).toHaveLength(4));

    await choose(chartPicker(), "Commands per minute");

    await screen.findByRole("combobox", {
      name: "Metric in the timeline: Commands per minute",
    });
    expect(laneLines()).toHaveLength(0);
  });
});
