// @vitest-environment happy-dom
/**
 * The map's layers drawn from an analysed replay's events (#1160): that they
 * cannot be switched on without an analysis and say why, what each state says,
 * what a layer reads and when, and how the time window counts them.
 *
 * Nothing is painted. The test environment has no canvas context, so this
 * asserts the DOM: toggles, notes, legends, readouts and the canvases that are
 * mounted. Where a death lands on the grid is `replayEventLayers.test.ts`.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  BuildOrder,
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

const MIN = 60 * 30;

const INFO = {
  gameId: "game-a",
  gameType: "Some Game 1.0",
  remixed: false,
  durationSec: 1800,
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

const stored = (over: Partial<StoredReplayAnalysis> = {}) =>
  ({
    state: "current",
    sizeBytes: 10,
    kind: "analysis",
    gameId: "game-a",
    analysedAtMs: 5,
    map: "Some Map",
    counts: {},
    disagreements: [],
    ...over,
  }) as StoredReplayAnalysis;

const analysed = (over: Partial<StoredReplayAnalysis> = {}) =>
  seedReplayAnalysisForTests({ analyses: [stored(over)] });

const unit = (over: Record<string, unknown>) => ({
  kind: "unit_destroyed",
  frame: 0,
  unit: 1,
  def: 1,
  team: 1,
  x: 0,
  y: 0,
  z: 0,
  ...over,
});

/** Three deaths. Two are close, one has no attacker, and one is late. */
const DEATHS = [
  unit({ frame: 900, x: 1024, z: 2048, attackerTeam: 0 }),
  unit({ frame: 1200, x: 1040, z: 2060, attackerTeam: 0, def: 2 }),
  unit({ frame: 20 * MIN, x: 3000, z: 1000 }),
];

/** Definition ids count from 1. A factory, a tank, and a wall. */
const UNITS = [
  {
    name: "factory",
    fullName: "Land Factory",
    buildOptions: ["tank"],
    stats: { builder: true, metalCost: 600 },
  },
  { name: "tank", fullName: "Tank", mobile: true, stats: { metalCost: 100 } },
  { name: "wall", fullName: "Wall", stats: { weapons: [{}], metalCost: 20 } },
] as unknown as UnitDatasetEntry[];

const FINISHED = [
  unit({
    kind: "unit_finished",
    team: 0,
    def: 1,
    frame: 600,
    x: 1024,
    z: 2048,
  }),
  unit({ kind: "unit_finished", team: 0, def: 2, frame: 700, x: 500, z: 500 }),
  unit({
    kind: "unit_finished",
    team: 1,
    def: 3,
    frame: 20 * MIN,
    x: 3000,
    z: 1000,
  }),
];

const game = (name: string): GameItem => ({
  name,
  primaryArchive: { name: `${name}.sdz` },
  dependencyArchives: [],
  info: {},
});

const order = (over: Partial<BuildOrder>): BuildOrder => ({
  frame: 0,
  player: 0,
  team: 0,
  origin: { kind: "selection" },
  unitDefId: 1,
  count: 1,
  slot: { kind: "append" },
  builders: 1,
  options: 0,
  ...over,
});

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
/** The map's help entry, opened. What the layers mean is said there. */
const help = () => {
  fireEvent.click(screen.getByRole("button", { name: "About the map" }));
  return within(screen.getByRole("dialog"));
};
const layer = (name: string) =>
  document.querySelector(`[data-layer="${name}"]`);

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
    lastFrame: 30 * MIN,
    incomplete: false,
  };
});

describe("a replay with no analysis", () => {
  it("shows the toggles but will not turn them on, and says the replay has not been analysed", () => {
    show();
    for (const name of ["Deaths", "Buildings finished"]) {
      expect((toggle(name) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId("event-block").textContent).toMatch(
      /This replay has not been analysed/,
    );
    // The reason is on each switch that cannot be used, and the long
    // explanation of what the layers draw from is in the help.
    expect(toggle("Deaths").parentElement?.getAttribute("title")).toMatch(
      /This replay has not been analysed/,
    );
    expect(screen.queryByText(/draw events from an analysis/)).toBeNull();
    expect(help().getByText(/draw events from an analysis/)).toBeTruthy();
    fireEvent.click(toggle("Deaths"));
    expect(toggle("Deaths").dataset.state).toBe("off");
    expect(eventsRead).not.toHaveBeenCalled();
    expect(layer("deaths")).toBeNull();
  });

  it("points at the analysis section on the page", () => {
    const scroll = vi.fn();
    show();
    const section = document.getElementById("replay-analysis") as HTMLElement;
    section.scrollIntoView = scroll;
    fireEvent.click(
      screen.getByRole("button", { name: /go to the analysis section/i }),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("does not point anywhere when the distribution hides the run", () => {
    HIDE = ["analytics.run"];
    show();
    expect(screen.getByTestId("event-block").textContent).toMatch(
      /cannot analyse replays/,
    );
    expect(
      screen.queryByRole("button", { name: /go to the analysis section/i }),
    ).toBeNull();
  });

  it("keeps a layer chosen on another replay when another toggle is pressed", () => {
    localStorage.setItem(
      "coilbox.replayMap.layers",
      JSON.stringify({ deaths: true }),
    );
    show();
    expect(toggle("Deaths").dataset.state).toBe("off");
    fireEvent.click(toggle("Bases"));
    expect(
      JSON.parse(localStorage.getItem("coilbox.replayMap.layers") ?? "{}"),
    ).toMatchObject({ deaths: true, bases: true });
    expect(eventsRead).not.toHaveBeenCalled();
  });
});

describe("a replay whose analysis cannot be drawn", () => {
  it("says the playback did not reproduce the match when it diverged", () => {
    analysed({ state: "diverged" });
    show();
    expect((toggle("Deaths") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("event-block").textContent).toMatch(
      /The playback did not reproduce the recorded match, so what it recorded was thrown away and there is nothing to draw/,
    );
    expect(eventsRead).not.toHaveBeenCalled();
  });

  it("says a remix has no analysis of its own", () => {
    analysed();
    show({ ...INFO, remixed: true } as DemoInfo);
    expect((toggle("Deaths") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("event-block").textContent).toMatch(
      /remix has no analysis of its own/,
    );
  });
});

describe("deaths", () => {
  it("reads only the deaths, and only once the layer is on", async () => {
    analysed();
    EVENTS = [...DEATHS, ...FINISHED];
    show();
    expect(eventsRead).not.toHaveBeenCalled();
    expect((toggle("Deaths") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    expect(eventsRead).toHaveBeenCalledTimes(1);
    expect(eventsRead).toHaveBeenCalledWith({
      gameId: "game-a",
      kinds: ["unit_destroyed"],
    });
  });

  it("draws the layer and a legend that reads in deaths", async () => {
    analysed();
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Deaths"));
    expect(
      await screen.findByText(/Most is 2 deaths within 128 elmos of one spot/),
    ).toBeTruthy();
    expect(screen.getByText("Where units died")).toBeTruthy();
    expect(layer("deaths")).toBeTruthy();
    expect(screen.queryByText(/orders within/)).toBeNull();
    expect(screen.getByText(/3 units died/)).toBeTruthy();
    expect(screen.queryByText(/no attacker recorded/)).toBeNull();
    expect(help().getByText(/1 death has no attacker recorded/)).toBeTruthy();
  });

  it("says where its numbers come from and that they are events", async () => {
    analysed();
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    expect(screen.queryByText(/playing the match back/)).toBeNull();
    const said = help();
    expect(said.getByText(/playing the match back/)).toBeTruthy();
    expect(said.getByText(/These are events, not orders/)).toBeTruthy();
    expect(
      said.getByText(/reproduced the recorded match exactly/),
    ).toBeTruthy();
  });

  it("counts every player's deaths and does not change when a player is lit", async () => {
    analysed();
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText(/Most is 2 deaths/);
    fireEvent.click(
      screen.getByRole("button", { name: /Start position of Alice/ }),
    );
    expect(screen.getByText(/Most is 2 deaths/)).toBeTruthy();
    expect(help().getByText(/Every player's deaths are counted/)).toBeTruthy();
  });

  it("says so, and draws nothing, when nothing died", async () => {
    analysed();
    EVENTS = [];
    show();
    fireEvent.click(toggle("Deaths"));
    expect(
      await screen.findByText(/No unit died in this analysis/),
    ).toBeTruthy();
    expect(layer("deaths")).toBeNull();
    expect(screen.queryByText("Least")).toBeNull();
  });

  it("says when the events cannot be read", async () => {
    analysed();
    EVENTS = DEATHS;
    eventsRead.mockImplementationOnce(() => {
      throw new Error("gone");
    });
    show();
    fireEvent.click(toggle("Deaths"));
    expect(
      await screen.findByText(/events could not be read from this replay/),
    ).toBeTruthy();
  });

  it("repeats the events table's line about an older logger", async () => {
    analysed({ state: "outdated" });
    EVENTS = DEATHS;
    show();
    expect(screen.queryByText(/older logger/)).toBeNull();
    fireEvent.click(toggle("Deaths"));
    expect(
      await screen.findByText(
        "This analysis was recorded by an older logger and may lack newer kinds of event.",
      ),
    ).toBeTruthy();
    expect(layer("deaths")).toBeTruthy();
  });

  it("is gone with the spatial layers when a profile hides them", () => {
    HIDE = ["analytics.spatialLayers"];
    analysed();
    show();
    expect(screen.queryByRole("button", { name: "Deaths" })).toBeNull();
    expect(screen.queryByTestId("event-block")).toBeNull();
    expect(eventsRead).not.toHaveBeenCalled();
  });
});

describe("metal cost", () => {
  it("is offered only when the installed game states costs, and is not the default", async () => {
    analysed();
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    expect(screen.queryByRole("radio", { name: "Metal cost lost" })).toBeNull();
  });

  it("weights each death by cost and says the picture is a different one", async () => {
    analysed();
    EVENTS = DEATHS;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    expect(
      screen.getByRole("radio", { name: "Units lost" }).dataset.state,
    ).toBe("on");
    fireEvent.click(screen.getByRole("radio", { name: "Metal cost lost" }));
    // The first two deaths are a factory (600) and a tank (100), 700 together.
    expect(
      await screen.findByText(
        /Most is 700 metal of units lost within 128 elmos of one spot/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Where metal was lost")).toBeTruthy();
    expect(screen.queryByText(/where value was lost/)).toBeNull();
    const said = help();
    expect(
      said.getByText(/where value was lost and not where units died/),
    ).toBeTruthy();
    // The third death is of a unit the game costs too, so none count nothing.
    expect(said.queryByText(/no stated cost/)).toBeNull();
  });

  it("warns when the costs come from another build", async () => {
    analysed();
    EVENTS = DEATHS;
    GAMES = [game("Some Game 2.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    fireEvent.click(screen.getByRole("radio", { name: "Metal cost lost" }));
    expect(
      await screen.findByText(
        /Costs come from Some Game 2\.0, a different build/,
      ),
    ).toBeTruthy();
  });
});

describe("buildings finished", () => {
  it("reads only the finished units, and draws the buildings and not the units that move", async () => {
    analysed();
    EVENTS = [...DEATHS, ...FINISHED];
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Buildings finished"));
    expect(await screen.findByText(/2 buildings finished/)).toBeTruthy();
    expect(eventsRead).toHaveBeenCalledWith({
      gameId: "game-a",
      kinds: ["unit_finished"],
    });
    expect(screen.queryByText(/finished unit that moves/)).toBeNull();
    expect(
      help().getByText(/1 finished unit that moves is not drawn/),
    ).toBeTruthy();
    expect(layer("finished")).toBeTruthy();
    // Each shape is a kind of building, as the orders' key lists them.
    expect(screen.getByText("Factory")).toBeTruthy();
    expect(screen.getByText("Defence")).toBeTruthy();
  });

  it("says how to tell it from an order", async () => {
    analysed();
    EVENTS = FINISHED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Buildings finished"));
    await screen.findByText(/2 buildings finished|1 building finished/);
    expect(
      screen.queryByText(/An outline is one finished building/),
    ).toBeNull();
    const said = help();
    expect(said.getByText(/An outline is one finished building/)).toBeTruthy();
    expect(
      said.getByText(
        /a fill alone is an order with no building finished there/,
      ),
    ).toBeTruthy();
  });

  it("needs the game installed, and says so, because a building cannot be told from a unit", async () => {
    analysed();
    EVENTS = FINISHED;
    show();
    fireEvent.click(toggle("Buildings finished"));
    expect(
      await screen.findByText(
        /Some Game 1\.0 is not installed, so nothing says which finished units are buildings, so this layer needs the game installed/,
      ),
    ).toBeTruthy();
    expect(layer("finished")).toBeNull();
  });

  it("shares one read of the events with deaths asked for beside it", async () => {
    analysed();
    EVENTS = [...DEATHS, ...FINISHED];
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    fireEvent.click(toggle("Buildings finished"));
    await screen.findByText(/2 buildings finished/);
    expect(eventsRead).toHaveBeenCalledTimes(2);
    expect(eventsRead.mock.calls.map(([a]) => a.kinds)).toEqual([
      ["unit_destroyed"],
      ["unit_finished"],
    ]);
  });
});

describe("the time window with events", () => {
  const press = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name }));

  it("counts deaths in deaths, and says the window is when each happened", async () => {
    analysed();
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Deaths"));
    expect(await screen.findByText(/3 of 3 deaths/)).toBeTruthy();
    expect(
      screen.getByText(/Events from|The whole match, 0:00 to 30:00/),
    ).toBeTruthy();
    expect(
      screen.queryByText(/The window is when each event happened/),
    ).toBeNull();
    expect(
      help().getByText(
        /The window is when each event happened in the playback\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/of \d+ orders/)).toBeNull();
  });

  it("narrows the layer and its legend to the window", async () => {
    analysed();
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText(/3 of 3 deaths/);
    press("First 5 minutes");
    // Both close deaths are before five minutes and the late one is not.
    expect(await screen.findByText(/2 of 3 deaths/)).toBeTruthy();
    expect(
      screen.getByText(
        /Most is 2 deaths within 128 elmos of one spot in this window/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Events from 0:00 to 5:00/)).toBeTruthy();
    // The late death is at 20 minutes, which is outside the last five.
    press("Last 5 minutes");
    expect(await screen.findByText(/0 of 3 deaths/)).toBeTruthy();
    press("Whole match");
    expect(await screen.findByText(/3 of 3 deaths/)).toBeTruthy();
  });

  it("says none happened, and draws nothing, for an empty window", async () => {
    analysed();
    EVENTS = DEATHS.slice(0, 2);
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText(/2 of 2 deaths/);
    press("Last 5 minutes");
    expect(await screen.findByText(/0 of 2 deaths/)).toBeTruthy();
    expect(layer("deaths")).toBeNull();
    expect(screen.queryByText("Least")).toBeNull();
    expect(screen.queryByText(/No unit died/)).toBeNull();
  });

  it("states orders and events apart and does not add them up", async () => {
    analysed();
    EVENTS = DEATHS;
    ORDERS = {
      orders: [
        order({ frame: 300, position: { x: 1024, y: 0, z: 2048 } }),
        order({ frame: 400, position: { x: 1040, y: 0, z: 2060 } }),
      ],
      players: [{ player: 0, name: "Alice" }],
      removals: 0,
      lastFrame: 30 * MIN,
      incomplete: false,
    };
    show();
    fireEvent.click(toggle("Buildings ordered"));
    fireEvent.click(toggle("Deaths"));
    expect(await screen.findByText(/2 of 2 orders/)).toBeTruthy();
    expect(screen.getByText(/3 of 3 deaths/)).toBeTruthy();
    expect(screen.queryByText(/5 of 5/)).toBeNull();
    expect(
      help().getByText(
        /For orders the window is when each was given, not when anything was built\. For events it is when each happened in the playback\./,
      ),
    ).toBeTruthy();
    press("First 5 minutes");
    expect(
      await screen.findByText(/Orders given and events from 0:00 to 5:00/),
    ).toBeTruthy();
    expect(screen.getByText(/2 of 2 orders/)).toBeTruthy();
    expect(screen.getByText(/2 of 3 deaths/)).toBeTruthy();
  });

  it("leaves the orders' own readout alone when only an order layer is on", async () => {
    analysed();
    ORDERS = {
      orders: [order({ frame: 300, position: { x: 1024, y: 0, z: 2048 } })],
      players: [{ player: 0, name: "Alice" }],
      removals: 0,
      lastFrame: 30 * MIN,
      incomplete: false,
    };
    show();
    fireEvent.click(toggle("Buildings ordered"));
    expect(await screen.findByText(/1 of 1 orders/)).toBeTruthy();
    expect(
      screen.queryByText(/The window is when an order was given/),
    ).toBeNull();
    expect(
      help().getByText(
        /The window is when an order was given, not when anything was built\./,
      ),
    ).toBeTruthy();
    await waitFor(() => expect(eventsRead).not.toHaveBeenCalled());
  });
});

describe("damage dealt", () => {
  // The map is 4096 elmos square, so the grid is 256 cells a side.
  const HEADER = {
    kind: "header",
    gridWidth: 256,
    gridHeight: 256,
    damageFrames: 450,
  };
  const cell = (col: number, row: number) => row * 256 + col;
  const DAMAGE = [
    HEADER,
    {
      kind: "damage",
      frame: 0,
      team: 0,
      target: 1,
      at: [cell(200, 40), 300, cell(201, 40), 100],
      origin: [cell(20, 220), 400],
    },
    {
      kind: "damage",
      frame: 20 * MIN,
      team: 1,
      target: 0,
      at: [cell(20, 220), 50],
      origin: [cell(200, 40), 50],
      off: 7,
    },
    { kind: "damage", frame: 20 * MIN, target: 0, at: [cell(30, 30), 25] },
    {
      kind: "damage",
      frame: 20 * MIN,
      team: 0,
      target: 0,
      at: [5, 10],
      origin: [5, 10],
    },
  ];

  it("reads the header and the damage, and only once the layer is on", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = [...DEATHS, ...DAMAGE];
    show();
    expect(eventsRead).not.toHaveBeenCalled();
    fireEvent.click(toggle("Damage dealt"));
    await screen.findByText("Where damage landed");
    expect(eventsRead).toHaveBeenCalledTimes(1);
    expect(eventsRead).toHaveBeenCalledWith({
      gameId: "game-a",
      kinds: ["header", "damage"],
    });
  });

  it("draws where damage landed, with a legend that reads in damage", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = DAMAGE;
    show();
    fireEvent.click(toggle("Damage dealt"));
    expect(
      await screen.findByText(
        /Most is 400 damage landed within 128 elmos of one spot/,
      ),
    ).toBeTruthy();
    expect(layer("damage")).toBeTruthy();
    const said = help();
    expect(said.getByText(/492 damage landed\./)).toBeTruthy();
    expect(said.getByText(/25 of it had no attacker/)).toBeTruthy();
    expect(
      said.getByText(/10 of it a player did to their own units/),
    ).toBeTruthy();
    expect(said.getByText(/7 of it landed on a unit off the map/)).toBeTruthy();
    expect(said.getByText(/totals for\s+each 15 seconds/)).toBeTruthy();
  });

  it("draws where it came from when asked", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = DAMAGE;
    show();
    fireEvent.click(toggle("Damage dealt"));
    await screen.findByText("Where damage landed");
    fireEvent.click(screen.getByRole("radio", { name: "Where it came from" }));
    expect(
      await screen.findByText(
        /Most is 400 damage was dealt from within 128 elmos of one spot/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Where damage came from")).toBeTruthy();
  });

  it("is never drawn with deaths, whose colours it shares", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = [...DEATHS, ...DAMAGE];
    show();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    fireEvent.click(toggle("Damage dealt"));
    await screen.findByText("Where damage landed");
    expect(toggle("Deaths").dataset.state).toBe("off");
    expect(layer("deaths")).toBeNull();
    fireEvent.click(toggle("Deaths"));
    await screen.findByText("Where units died");
    expect(toggle("Damage dealt").dataset.state).toBe("off");
    expect(layer("damage")).toBeNull();
  });

  it("narrows to the stretches that begin inside the time window", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = DAMAGE;
    show();
    fireEvent.click(toggle("Damage dealt"));
    await screen.findByText("Where damage landed");
    fireEvent.click(screen.getByRole("button", { name: "First 5 minutes" }));
    expect(
      await screen.findByText(
        /Most is 400 damage landed within 128 elmos of one spot in this window/,
      ),
    ).toBeTruthy();
    expect(
      help().getByText(/400 damage landed\s+in this window\./),
    ).toBeTruthy();
  });

  it("says an older analysis recorded none, and points at the analysis", async () => {
    analysed({ loggerVersion: 3 });
    EVENTS = DEATHS;
    show();
    fireEvent.click(toggle("Damage dealt"));
    expect(
      await screen.findByText(/recorded before coilbox logged damage/),
    ).toBeTruthy();
    expect(layer("damage")).toBeNull();
  });

  it("says so when a match had no damage", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = [HEADER];
    show();
    fireEvent.click(toggle("Damage dealt"));
    expect(await screen.findByText(/No damage was recorded\./)).toBeTruthy();
  });

  it("will not place damage recorded on a grid that is not this map's", async () => {
    analysed({ loggerVersion: 4 });
    EVENTS = [{ ...HEADER, gridWidth: 128 }, ...DAMAGE.slice(1)];
    show();
    fireEvent.click(toggle("Damage dealt"));
    expect(
      await screen.findByText(/recorded on a map of another size/),
    ).toBeTruthy();
    expect(layer("damage")).toBeNull();
  });
});
