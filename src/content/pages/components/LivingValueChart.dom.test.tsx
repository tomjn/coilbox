// @vitest-environment happy-dom
/**
 * The value by kind charts under the match chart (#1174): what they say with
 * no analysis, that nothing is read until asked, and what each state of the
 * analysis and of the installed game says.
 *
 * Nothing is plotted. The test environment gives a chart no size, so this
 * asserts the DOM round the plots: reasons, warnings, the legend, the toggle
 * and one panel for each line.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  DemoInfo,
  GameItem,
  StoredReplayAnalysis,
  UnitDatasetEntry,
} from "../../bindings";
import type { ChartSeries } from "../../matchStats";

let HIDE: string[] = [];
let EVENTS: Record<string, unknown>[] = [];
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
const eventsRead = vi.fn();

vi.mock("../../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentReplayAnalysisEvents: async (args: { kinds?: string[] }) => {
    eventsRead(args);
    return {
      total: EVENTS.length,
      events: EVENTS.filter(
        (e) => !args.kinds || args.kinds.includes(e.kind as string),
      ),
    };
  },
}));
vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({ data: { games: GAMES }, loading: false }),
  useUnitsyncUnitDataset: (_e: string, _d: string, archive?: string) =>
    archive && DATASET
      ? { dataset: DATASET, status: "ready" }
      : { dataset: null, status: archive ? "error" : "idle" },
}));
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const { LivingValueChart } = await import("./LivingValueChart");
const { resetReplayEventReadsForTests } = await import("../../replayEventRead");
const { resetReplayAnalysisForTests, seedReplayAnalysisForTests } =
  await import("../../replayAnalysis");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

const INFO = {
  gameId: "game-a",
  gameType: "Some Game 1.0",
  remixed: false,
  durationSec: 60,
  players: [
    { name: "Alice", team: 0, allyTeam: 0, spectator: false },
    { name: "Bob", team: 1, allyTeam: 1, spectator: false },
  ],
  ais: [],
  allyTeams: [],
} as unknown as DemoInfo;

const SERIES = [
  { id: "team0", label: "Alice", color: "#ff0000", samples: [] },
  { id: "team1", label: "Bob", color: "#0000ff", samples: [] },
] as ChartSeries[];

const UNITS = [
  { name: "mex", stats: { metalCost: 50, energyCost: 500, extractsMetal: 1 } },
  { name: "rock", stats: {} },
] as unknown as UnitDatasetEntry[];

const FINISHED = [
  { kind: "unit_finished", frame: 300, unit: 1, def: 1, team: 0 },
  { kind: "unit_finished", frame: 400, unit: 2, def: 2, team: 1 },
  { kind: "unit_created", frame: 10, unit: 1, def: 1, team: 0 },
];

const game = (name: string): GameItem => ({
  name,
  primaryArchive: { name: `${name}.sdz` },
  dependencyArchives: [],
  info: {},
});

const analysed = (over: Partial<StoredReplayAnalysis> = {}) =>
  seedReplayAnalysisForTests({
    analyses: [
      {
        state: "current",
        sizeBytes: 10,
        kind: "analysis",
        gameId: "game-a",
        analysedAtMs: 5,
        loggerVersion: 2,
        map: "Some Map",
        counts: {},
        disagreements: [],
        ...over,
      } as StoredReplayAnalysis,
    ],
  });

function show(info: DemoInfo = INFO) {
  return render(
    <SeriesEmphasisProvider>
      <LivingValueChart
        info={info}
        series={SERIES}
        endSec={60}
        periodSec={15}
      />
    </SeriesEmphasisProvider>,
  );
}

const text = () => screen.getByTestId("living-value").textContent ?? "";
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Show value of living units by kind" }),
  );

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  resetReplayEventReadsForTests();
  resetReplayAnalysisForTests();
  eventsRead.mockClear();
  HIDE = [];
  GAMES = [];
  DATASET = null;
  EVENTS = [];
});

describe("a replay the charts cannot be drawn for", () => {
  it("says a replay with no analysis needs one, and why the replay alone cannot say", () => {
    show();
    expect(text()).toMatch(/Value of living units by kind/);
    expect(text()).toMatch(
      /This needs an analysis, and this replay has not been analysed\. The replay itself records what was produced and lost, not what a player owned at any moment/,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(eventsRead).not.toHaveBeenCalled();
  });

  it("says when this copy of coilbox cannot analyse", () => {
    HIDE = ["analytics.run"];
    show();
    expect(text()).toMatch(/This copy of coilbox cannot analyse replays/);
  });

  it("says a diverged playback left nothing to add up", () => {
    analysed({ state: "diverged" });
    show();
    expect(text()).toMatch(/did not reproduce the recorded match/);
  });

  it("says a remix has no analysis of its own", () => {
    analysed();
    show({ ...INFO, remixed: true } as DemoInfo);
    expect(text()).toMatch(/a remix has no analysis of its own/);
  });
});

describe("an analysed replay", () => {
  it("reads nothing until asked, and then only the kinds the sum needs", async () => {
    analysed();
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    expect(eventsRead).not.toHaveBeenCalled();
    open();
    await screen.findByTestId("living-value");
    await waitFor(() => expect(eventsRead).toHaveBeenCalledTimes(1));
    expect(eventsRead).toHaveBeenCalledWith({
      gameId: "game-a",
      kinds: ["unit_finished", "unit_destroyed", "unit_given"],
    });
  });

  it("draws one panel for each line, with a legend that names every kind", async () => {
    analysed();
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    open();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-value-panel]")).toHaveLength(2),
    );
    expect(
      [...document.querySelectorAll("[data-value-panel] figcaption")].map(
        (f) => f.textContent,
      ),
    ).toEqual(["Alice", "Bob"]);
    const legend = screen.getByRole("list", { name: "Kinds of unit" });
    expect(legend.textContent).toMatch(
      /Economy.*Defence.*Offence.*Builders, factories, sensors and transports.*Unclassified/,
    );
  });

  it("keeps metal and energy as two views and says they are never added", async () => {
    analysed();
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    open();
    await screen.findByRole("radio", { name: "Metal cost" });
    expect(text()).toMatch(
      /The metal cost of each line's finished, living units every 15 seconds/,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Energy cost" }));
    await waitFor(() =>
      expect(text()).toMatch(/The energy cost of each line's/),
    );
    expect(text()).toMatch(/Metal and energy are never added together/);
  });

  it("says how many finished units have no cost", async () => {
    analysed();
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    open();
    await waitFor(() =>
      expect(text()).toMatch(
        /1 of 2 finished units have no cost in the installed game and count nothing/,
      ),
    );
  });

  it("says the game is not installed, and draws nothing", async () => {
    analysed();
    EVENTS = FINISHED;
    show();
    open();
    await waitFor(() =>
      expect(text()).toMatch(
        /Some Game 1\.0 is not installed, so nothing says what a unit costs or what it is for/,
      ),
    );
    expect(document.querySelector("[data-value-panel]")).toBeNull();
  });

  it("warns that costs and kinds come from a different build", async () => {
    analysed();
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.1")];
    DATASET = { units: UNITS };
    show();
    open();
    await waitFor(() =>
      expect(text()).toMatch(
        /played on Some Game 1\.0, which is not installed\. Costs and kinds come from Some Game 1\.1, a different build, and may be wrong/,
      ),
    );
  });

  it("says what an analysis from an older logger gets wrong", async () => {
    analysed({ state: "outdated", loggerVersion: 1 });
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    open();
    await waitFor(() =>
      expect(text()).toMatch(
        /It did not record a unit changing hands, so a unit that was given away or captured is counted for its first owner throughout/,
      ),
    );
  });

  it("says when the events cannot be read", async () => {
    analysed();
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    eventsRead.mockImplementationOnce(() => {
      throw new Error("gone");
    });
    show();
    open();
    await waitFor(() =>
      expect(text()).toMatch(
        /events could not be read from this replay's analysis/,
      ),
    );
  });
});
