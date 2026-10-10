// @vitest-environment happy-dom
/**
 * The map's two layers about the units each player started with (#1160): that
 * they cannot be switched on without an analysis, what they read, what they
 * label and list, and what they say a starting unit is.
 *
 * Nothing is painted. The test environment has no canvas context, so this
 * asserts the DOM: toggles, notes, the labels at the ends of the paths and the
 * list of units lost. How a track is built is `replayStartUnits.test.ts`.
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
  DemoBuildOrders,
  DemoInfo,
  GameItem,
  StoredReplayAnalysis,
  UnitDatasetEntry,
} from "../../bindings";

let HIDE: string[] = [];
let ORDERS: DemoBuildOrders;
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
  contentDemoBuildOrders: async () => ORDERS,
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
  useUnitsyncUnitBuildpics: () => ({ units: {}, errors: [] }),
}));
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../usePrimaryPlayer", () => ({ usePrimaryPlayer: () => "" }));
vi.mock("../../useMatchStats", () => ({
  useMatchStats: () => ({ data: null, loading: false, error: null }),
}));
vi.mock("../../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => <div data-testid="preview-3d" />,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const { ReplayMap } = await import("./ReplayMap");
const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { resetReplayEventReadsForTests } = await import("../../replayEventRead");
const { resetReplayAnalysisForTests, seedReplayAnalysisForTests } =
  await import("../../replayAnalysis");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

const SEC = 30;

const INFO = {
  gameId: "game-a",
  gameType: "Some Game 1.0",
  remixed: false,
  durationSec: 600,
  winningAllyTeams: [],
  winnersKnown: false,
  players: [
    {
      name: "Alice",
      team: 0,
      allyTeam: 0,
      spectator: false,
      rgbColor: [1, 0, 0],
    },
    {
      name: "Bob",
      team: 1,
      allyTeam: 1,
      spectator: false,
      rgbColor: [0, 0, 1],
    },
  ],
  ais: [],
  allyTeams: [],
  startPositions: [{ team: 0, x: 1024, y: 0, z: 512 }],
} as unknown as DemoInfo;

const HEIGHTMAP = { width: 513, height: 513 };

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

/**
 * Two starting units, shaped like a real run's lines. Alice's walks, stands
 * still, and is replaced by the game's script at 2:00. Bob's walks and is
 * destroyed by Alice at 8:00. A tank is nobody's starting unit.
 */
const MATCH = [
  {
    kind: "unit_created",
    frame: 0,
    unit: 13532,
    def: 30,
    team: 0,
    x: 600,
    y: 0,
    z: 3000,
    startUnit: true,
  },
  {
    kind: "unit_created",
    frame: 0,
    unit: 2693,
    def: 31,
    team: 1,
    x: 3500,
    y: 0,
    z: 900,
    startUnit: true,
  },
  {
    kind: "unit_created",
    frame: 40,
    unit: 77,
    def: 2,
    team: 0,
    x: 620,
    y: 0,
    z: 3020,
    builder: 13532,
  },
  {
    kind: "start_unit_position",
    frame: 60,
    unit: 13532,
    team: 0,
    x: 700,
    z: 2900,
  },
  {
    kind: "start_unit_position",
    frame: 120,
    unit: 2693,
    team: 1,
    x: 3400,
    z: 1000,
  },
  {
    kind: "unit_destroyed",
    frame: 120 * SEC,
    unit: 13532,
    def: 30,
    team: 0,
    x: 700,
    y: 0,
    z: 2900,
    startUnit: true,
    weapon: -21,
  },
  {
    kind: "start_unit_position",
    frame: 300 * SEC,
    unit: 2693,
    team: 1,
    x: 2000,
    z: 2000,
  },
  {
    kind: "unit_destroyed",
    frame: 400 * SEC,
    unit: 77,
    def: 2,
    team: 0,
    x: 1,
    y: 0,
    z: 1,
    attackerTeam: 1,
  },
  {
    kind: "unit_destroyed",
    frame: 480 * SEC,
    unit: 2693,
    def: 31,
    team: 1,
    x: 2100,
    y: 0,
    z: 2100,
    startUnit: true,
    attacker: 77,
    attackerTeam: 0,
    weapon: 4,
  },
];

/**
 * The same match as a logger that follows a replacement writes it: Alice's
 * unit is swapped for unit 500 at 2:00, which walks on and is alive at the end.
 */
const UPGRADED = [
  ...MATCH.slice(0, 5),
  {
    kind: "unit_created",
    frame: 120 * SEC,
    unit: 500,
    def: 32,
    team: 0,
    x: 700,
    y: 0,
    z: 2900,
  },
  {
    kind: "start_unit_replaced",
    frame: 120 * SEC,
    unit: 13532,
    by: 500,
    team: 0,
    x: 700,
    z: 2900,
  },
  ...MATCH.slice(5),
  {
    kind: "start_unit_position",
    frame: 500 * SEC,
    unit: 500,
    team: 0,
    x: 1500,
    z: 2500,
  },
];

function show(info: DemoInfo = INFO) {
  return render(
    <SeriesEmphasisProvider>
      <div id="replay-analysis">Analysis</div>
      <ReplayMap
        info={info}
        replayPath="/replays/a.sdfz"
        mapName="Some Map"
        minimapUrl="data:image/png;base64,"
        heightmap={HEIGHTMAP}
        preview={null}
      />
    </SeriesEmphasisProvider>,
  );
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const toggle = (name: string) => screen.getByRole("button", { name });
const layer = () => document.querySelector('[data-layer="startUnits"]');
const labels = () =>
  [...document.querySelectorAll("[data-start-unit-label]")].map((el) => [
    el.getAttribute("data-start-unit-label"),
    el.textContent,
  ]);
const notes = () => screen.getByTestId("start-units").textContent ?? "";
/** The map's help entry, opened. What a starting unit is, is said there. */
const help = () => {
  fireEvent.click(screen.getByRole("button", { name: "About the map" }));
  return screen.getByRole("dialog").textContent ?? "";
};

afterEach(() => {
  cleanup();
  resetReplayBuildOrders();
  resetReplayEventReadsForTests();
  resetReplayAnalysisForTests();
  localStorage.clear();
  eventsRead.mockClear();
  HIDE = [];
  GAMES = [];
  DATASET = null;
  EVENTS = [];
  ORDERS = {
    orders: [],
    players: [],
    removals: 0,
    lastFrame: 600 * SEC,
    incomplete: false,
  };
});

describe("a replay with no analysis", () => {
  it("shows both toggles, will not turn them on, and names them in the reason", () => {
    show();
    for (const name of ["Starting unit deaths", "Starting unit paths"]) {
      expect((toggle(name) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(toggle(name));
      expect(toggle(name).dataset.state).toBe("off");
    }
    expect(screen.getByTestId("event-block").textContent).toMatch(
      /This replay has not been analysed/,
    );
    expect(help()).toMatch(
      /Deaths, Damage dealt, Buildings finished and the two starting unit layers draw events from an analysis/,
    );
    expect(eventsRead).not.toHaveBeenCalled();
    expect(layer()).toBeNull();
  });

  it("names neither layer for a commander", () => {
    show();
    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    expect(names.some((name) => /starting unit/i.test(name))).toBe(true);
    expect(names.some((name) => /commander/i.test(name))).toBe(false);
  });
});

describe("an analysis from before starting units were logged", () => {
  it("says there is nothing to draw and points at the analysis section", async () => {
    analysed({ state: "outdated", loggerVersion: 1 });
    EVENTS = MATCH.map(({ startUnit: _flag, ...rest }) => rest);
    const scroll = vi.fn();
    show();
    (document.getElementById("replay-analysis") as HTMLElement).scrollIntoView =
      scroll;
    fireEvent.click(toggle("Starting unit paths"));
    await waitFor(() =>
      expect(notes()).toMatch(
        /recorded before coilbox logged starting units, so there is nothing to draw\. Analyse the replay again/,
      ),
    );
    expect(layer()).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /go to the analysis section/i }),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

describe("starting unit paths", () => {
  it("reads the five kinds a track is built from, once the layer is on", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    expect(eventsRead).not.toHaveBeenCalled();
    fireEvent.click(toggle("Starting unit paths"));
    await screen.findByTestId("start-units");
    expect(eventsRead).toHaveBeenCalledTimes(1);
    expect(eventsRead).toHaveBeenCalledWith({
      gameId: "game-a",
      kinds: [
        "unit_created",
        "unit_destroyed",
        "unit_given",
        "start_unit_position",
        "start_unit_replaced",
      ],
    });
  });

  it("carries a path on through an upgrade, and does not list the upgrade as a loss", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = UPGRADED;
    show();
    fireEvent.click(toggle("Starting unit paths"));
    fireEvent.click(toggle("Starting unit deaths"));
    await screen.findByTestId("start-units");
    // One line for each player, though Alice had two units.
    expect(labels()).toEqual([
      ["0", "Alice"],
      ["1", "Bob"],
    ]);
    expect(notes()).toMatch(/2 starting units recorded\./);
    expect(notes()).toMatch(/1 upgrade\./);
    expect(notes()).toMatch(/1 starting unit was lost/);
    const items = [
      ...document.querySelectorAll('[data-testid="start-units"] li'),
    ].map((li) => li.textContent?.trim());
    expect(items).toEqual(["Bob: destroyed at 8:00 by Alice"]);
    expect(notes()).not.toMatch(/older logger/);
    const said = help();
    expect(said).toMatch(/swapped a starting unit for another unit/);
    expect(said).toMatch(/on exactly the same spot/);
    // Alice's unit was upgraded at 2:00 and is still alive in the last five
    // minutes, so her line is still there.
    fireEvent.click(screen.getByRole("button", { name: "Last 5 minutes" }));
    await waitFor(() =>
      expect(labels().map((l) => l[1])).toEqual(["Alice", "Bob"]),
    );
  });

  it("warns that an older analysis may stop a path at an upgrade", async () => {
    analysed({ loggerVersion: 3 });
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit paths"));
    await screen.findByTestId("start-units");
    expect(notes()).toMatch(
      /older logger, so a path may stop where the unit was upgraded/,
    );
  });

  it("draws one line per starting unit and labels where each ends with its player", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit paths"));
    await screen.findByTestId("start-units");
    expect(layer()).toBeTruthy();
    expect(labels()).toEqual([
      ["0", "Alice"],
      ["1", "Bob"],
    ]);
    const bob = document.querySelector(
      '[data-start-unit-label="1"]',
    ) as HTMLElement;
    // 2100 of 4096 elmos, the place Bob's unit died.
    expect(bob.style.left).toBe(`${(2100 / 4096) * 100}%`);
    expect(bob.style.top).toBe(`${(2100 / 4096) * 100}%`);
  });

  it("says what a starting unit is, and that it is not called a commander", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit paths"));
    await screen.findByTestId("start-units");
    expect(notes()).toMatch(/2 starting units recorded/);
    expect(notes()).not.toMatch(/made by no builder/);
    expect(notes()).not.toMatch(/where the line begins/);
    const said = help();
    expect(said).toMatch(
      /one a player had on the frame their first unit appeared, made by no builder/,
    );
    expect(said).toMatch(/the engine does not say which unit is a commander/);
    expect(said).toMatch(
      /The dot is where the line begins and the name is where it ends/,
    );
    expect(said).toMatch(/playing the match back/);
  });

  it("keeps a path to the time window, and drops a unit that had ended before it", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit paths"));
    await screen.findByTestId("start-units");
    expect(labels().length).toBe(2);
    // Alice's was replaced at 2:00, before the last five minutes of ten.
    fireEvent.click(screen.getByRole("button", { name: "Last 5 minutes" }));
    await waitFor(() => expect(labels().map((l) => l[1])).toEqual(["Bob"]));
    expect(help()).toMatch(/where one starting unit went in this window/);
  });

  it("says so when the analysis holds no starting unit", async () => {
    analysed();
    EVENTS = MATCH.map(({ startUnit: _flag, ...rest }) => rest);
    show();
    fireEvent.click(toggle("Starting unit paths"));
    await waitFor(() =>
      expect(notes()).toMatch(/This analysis recorded no starting unit/),
    );
    expect(layer()).toBeNull();
  });
});

describe("starting unit deaths", () => {
  it("lists each one lost, with when, how and by whom", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit deaths"));
    await screen.findByTestId("start-units");
    expect(notes()).toMatch(/2 starting units were lost/);
    const items = [
      ...document.querySelectorAll('[data-testid="start-units"] li'),
    ].map((li) => li.textContent?.trim());
    expect(items).toEqual([
      "Alice: removed by the game's own script at 2:00",
      "Bob: destroyed at 8:00 by Alice",
    ]);
    expect(layer()).toBeTruthy();
    // Marks only: a path's label belongs to the other layer.
    expect(labels()).toEqual([]);
  });

  it("explains the mark for a unit the game took away and did not replace", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit deaths"));
    await screen.findByTestId("start-units");
    const said = help();
    expect(said).toMatch(/is a starting unit that was destroyed/);
    expect(said).toMatch(
      /the game's own script took away with nothing recorded in its place/,
    );
  });

  it("does not count another unit's death", async () => {
    analysed();
    EVENTS = MATCH;
    show();
    fireEvent.click(toggle("Starting unit deaths"));
    await screen.findByTestId("start-units");
    expect(notes()).not.toMatch(/3 starting units/);
  });

  it("says when none was lost", async () => {
    analysed();
    EVENTS = MATCH.filter((e) => e.kind !== "unit_destroyed");
    show();
    fireEvent.click(toggle("Starting unit deaths"));
    await waitFor(() => expect(notes()).toMatch(/No starting unit was lost\./));
    expect(layer()).toBeNull();
  });

  it("is gone with the spatial layers when a profile hides them", () => {
    HIDE = ["analytics.spatialLayers"];
    analysed();
    show();
    expect(
      screen.queryByRole("button", { name: "Starting unit deaths" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Starting unit paths" }),
    ).toBeNull();
  });
});
